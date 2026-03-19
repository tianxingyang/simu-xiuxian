import { createServer, type ServerResponse } from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { config, llmConfig } from './config.js';
import { startBot, stopBot, sendGroupMessage, type BotGroupMessage } from './bot.js';
import type { SimCommand, SimWorkerEvent, LlmCommand, LlmWorkerEvent, WorldContext } from './ipc.js';
import type { StateSnapshot } from './runner.js';
import { initLogger, getLogger } from './logger.js';

initLogger();
const log = getLogger('gateway');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseWsCommand(raw: string): SimCommand | null {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg.type !== 'string') return null;
  switch (msg.type) {
    case 'start':
      return isNum(msg.speed) && isNum(msg.seed) && isNum(msg.initialPop)
        ? { type: 'sim:start', speed: msg.speed, seed: msg.seed, initialPop: msg.initialPop } : null;
    case 'pause': return { type: 'sim:pause' };
    case 'step': return { type: 'sim:step' };
    case 'setSpeed': return isNum(msg.speed) ? { type: 'sim:setSpeed', speed: msg.speed } : null;
    case 'reset':
      return isNum(msg.seed) && isNum(msg.initialPop)
        ? { type: 'sim:reset', seed: msg.seed, initialPop: msg.initialPop } : null;
    case 'ack': return isNum(msg.tickId) ? { type: 'sim:ack', tickId: msg.tickId } : null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const clients = new Set<WebSocket>();
let cachedState: StateSnapshot = { year: 1, running: false, speed: 1, summary: null };

let simReady = false;
let llmReady = false;

let pendingWorldContextCb: ((ctx: WorldContext | null) => void) | null = null;

function requestWorldContext(): Promise<WorldContext | null> {
  if (!simWorker?.connected || !simReady) return Promise.resolve(null);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pendingWorldContextCb = null;
      resolve(null);
    }, 5000);
    pendingWorldContextCb = (ctx) => {
      clearTimeout(timer);
      pendingWorldContextCb = null;
      resolve(ctx);
    };
    simWorker!.send({ type: 'sim:getWorldContext' } as SimCommand);
  });
}

// ---------------------------------------------------------------------------
// Job registry for LLM worker (HTTP + bot)
// ---------------------------------------------------------------------------

let _jobCounter = 0;
let activeReportJobId: string | null = null;

interface PendingJob {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cancelJobId: string;
}

const JOB_TIMEOUT = 150_000;
const pendingJobs = new Map<string, PendingJob>();

function nextJobId(): string {
  return `job-${++_jobCounter}-${Date.now().toString(36)}`;
}

function submitLlmJob(cmd: LlmCommand): { jobId: string; promise: Promise<unknown> } {
  const { jobId } = cmd;

  const promise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      log.warn(`job ${jobId} timed out after ${JOB_TIMEOUT / 1000}s`);
      pendingJobs.delete(jobId);
      sendToLlm({ type: 'job:cancel', jobId });
      reject(new Error('Job timeout'));
    }, JOB_TIMEOUT);
    pendingJobs.set(jobId, { resolve, reject, timer, cancelJobId: jobId });
    sendToLlm(cmd);
  });

  return { jobId, promise };
}

function cancelJob(jobId: string): void {
  const pending = pendingJobs.get(jobId);
  if (pending) {
    log.warn(`job ${jobId} cancelled (client disconnected)`);
    clearTimeout(pending.timer);
    pendingJobs.delete(jobId);
    pending.reject(new Error('Cancelled'));
    sendToLlm({ type: 'job:cancel', jobId });
  }
}

// ---------------------------------------------------------------------------
// Child Process Management
// ---------------------------------------------------------------------------

let simWorker: ChildProcess | null = null;
let llmWorker: ChildProcess | null = null;

const SIM_WORKER_PATH = fileURLToPath(new URL('./processes/sim-worker.ts', import.meta.url));
const LLM_WORKER_PATH = fileURLToPath(new URL('./processes/llm-worker.ts', import.meta.url));

function spawnSim(): ChildProcess {
  const child = fork(SIM_WORKER_PATH, [], {
    execArgv: ['--import', 'tsx/esm'],
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  child.on('message', (msg: SimWorkerEvent) => {
    switch (msg.type) {
      case 'sim:ready':
        simReady = true;
        log.info('sim worker ready');
        // Sync client count and push fresh state to connected clients
        child.send({ type: 'sim:clientCount', count: clients.size } as SimCommand);
        child.send({ type: 'sim:getState' } as SimCommand);
        break;
      case 'sim:state':
        cachedState = msg.state;
        broadcastWs({ type: 'state', ...msg.state });
        break;
      case 'sim:tick': {
        cachedState.running = true;
        if (msg.summaries.length) {
          const last = msg.summaries[msg.summaries.length - 1];
          cachedState.year = last.year;
          cachedState.summary = last;
        }
        const data = JSON.stringify({ type: 'tick', tickId: msg.tickId, summaries: msg.summaries, events: msg.events });
        for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
        break;
      }
      case 'sim:paused':
        cachedState.running = false;
        broadcastWs({ type: 'paused', reason: msg.reason });
        break;
      case 'sim:resetDone':
        cachedState = { year: 1, running: false, speed: cachedState.speed, summary: null };
        broadcastWs({ type: 'reset-done' });
        break;
      case 'sim:worldContext':
        if (pendingWorldContextCb) pendingWorldContextCb(msg.context);
        break;
    }
  });

  child.on('exit', (code) => {
    log.error(`sim worker exited (code=${code}), restarting...`);
    simReady = false;
    simWorker = null;
    setTimeout(() => { simWorker = spawnSim(); }, 1000);
  });

  simWorker = child;
  return child;
}

function spawnLlm(): ChildProcess {
  const child = fork(LLM_WORKER_PATH, [], {
    execArgv: ['--import', 'tsx/esm'],
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  child.on('message', (msg: LlmWorkerEvent) => {
    switch (msg.type) {
      case 'job:ready':
        llmReady = true;
        log.info('llm worker ready');
        break;
      case 'job:result':
      case 'job:error': {
        // Route to HTTP pending jobs
        const pending = pendingJobs.get(msg.jobId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingJobs.delete(msg.jobId);
          if (msg.type === 'job:result') {
            pending.resolve(msg.payload);
          } else {
            pending.reject(new Error(msg.error));
          }
        }
        // Bot jobs also live in pendingJobs — no separate routing needed
        break;
      }
    }
  });

  child.on('exit', (code) => {
    log.error(`llm worker exited (code=${code}), restarting...`);
    llmReady = false;
    llmWorker = null;
    // Fail-fast all pending jobs
    for (const [jobId, pending] of pendingJobs) {
      clearTimeout(pending.timer);
      pending.reject(new Error('LLM worker crashed'));
      pendingJobs.delete(jobId);
    }
    // Bot jobs are in the same pendingJobs map — already handled above
    setTimeout(() => { llmWorker = spawnLlm(); }, 1000);
  });

  llmWorker = child;
  return child;
}

function sendToSim(cmd: SimCommand): boolean {
  if (simWorker?.connected && simReady) {
    simWorker.send(cmd);
    return true;
  }
  return false;
}

function sendToLlm(cmd: LlmCommand): boolean {
  if (llmWorker?.connected && llmReady) {
    llmWorker.send(cmd);
    return true;
  }
  return false;
}

function broadcastWs(data: unknown): void {
  const str = JSON.stringify(data);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(str);
}

function updateClientCount(): void {
  sendToSim({ type: 'sim:clientCount', count: clients.size });
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { status: 'ok', year: cachedState.year, simReady, llmReady });
    return;
  }

  if (url.pathname === '/api/report') {
    if (req.method !== 'POST') { json(res, 405, { status: 'method_not_allowed' }); return; }
    if (!llmReady) { json(res, 503, { status: 'worker_not_ready' }); return; }
    if (activeReportJobId) { log.warn(`report rejected: job ${activeReportJobId} still active`); json(res, 409, { status: 'busy' }); return; }

    const jobId = nextJobId();
    activeReportJobId = jobId;
    let aborted = false;

    req.on('close', () => {
      if (!res.writableEnded) {
        aborted = true;
        cancelJob(jobId);
      }
    });

    requestWorldContext().then(worldContext => {
      if (aborted) return;
      const { promise } = submitLlmJob({ type: 'job:report', jobId, worldContext: worldContext ?? undefined });
      promise
        .then(report => { if (!aborted) json(res, 200, { status: 'ok', report }); })
        .catch(err => {
          if (!aborted) {
            log.error('report error:', err);
            json(res, 500, { status: 'error', error: String(err) });
          }
        })
        .finally(() => { if (activeReportJobId === jobId) activeReportJobId = null; });
    });
    return;
  }

  if (url.pathname === '/api/biography') {
    if (req.method !== 'POST') { json(res, 405, { status: 'method_not_allowed' }); return; }
    if (!llmReady) { json(res, 503, { status: 'worker_not_ready' }); return; }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(body); } catch {
        json(res, 400, { status: 'bad_request', error: 'Invalid JSON' });
        return;
      }
      if (!parsed.name || typeof parsed.name !== 'string') {
        json(res, 400, { status: 'bad_request', error: 'Missing "name" field' });
        return;
      }

      const { jobId, promise } = submitLlmJob({
        type: 'job:biography',
        jobId: nextJobId(),
        name: parsed.name.trim(),
        currentYear: cachedState.year,
      });
      let aborted = false;

      req.on('close', () => {
        if (!res.writableEnded) {
          aborted = true;
          cancelJob(jobId);
        }
      });

      promise
        .then(result => {
          if (aborted) return;
          const r = result as { status: string };
          json(res, r.status === 'error' ? 500 : 200, result);
        })
        .catch(err => {
          if (!aborted) {
            log.error('biography error:', err);
            json(res, 500, { status: 'error', error: 'Internal server error' });
          }
        });
    });
    return;
  }

  if (url.pathname === '/api/config/llm') {
    if (req.method !== 'GET') { json(res, 405, { status: 'method_not_allowed' }); return; }
    json(res, 200, { model: llmConfig.model, baseUrl: llmConfig.baseUrl, hasKey: !!llmConfig.apiKey });
    return;
  }

  json(res, 404, { status: 'not_found' });
});

// ---------------------------------------------------------------------------
// WebSocket Server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', ...cachedState }));
  clients.add(ws);
  updateClientCount();

  ws.on('message', (data) => {
    const cmd = parseWsCommand(data.toString());
    if (!cmd) { log.warn('invalid ws message'); return; }
    sendToSim(cmd);
  });

  ws.on('close', () => {
    clients.delete(ws);
    updateClientCount();
  });

  ws.on('error', (err) => log.warn('ws error:', err));
});

// ---------------------------------------------------------------------------
// Bot Command Routing
// ---------------------------------------------------------------------------

function parseCommand(raw: string, selfId?: number): { cmd: string; arg: string } | null {
  let text = raw;
  if (selfId) {
    text = text.replace(new RegExp(`\\[CQ:at,qq=${selfId}\\]`, 'g'), '');
  }
  text = text.replace(/^\s*\//, '').trim();
  if (!text) return null;
  if (text === '日报') return { cmd: 'report', arg: '' };
  const bioMatch = text.match(/^传记\s+(.+)$/);
  if (bioMatch) return { cmd: 'biography', arg: bioMatch[1].trim() };
  return null;
}

const _busyGroups = new Set<number>();

async function handleBotReport(groupId: number): Promise<void> {
  const worldContext = await requestWorldContext() ?? undefined;
  const gid = String(groupId);
  const jobId = nextJobId();
  log.info(`dispatching bot report job ${jobId} for group ${groupId}`);
  const { promise } = submitLlmJob({ type: 'job:report', jobId, groupId: gid, worldContext });
  const report = await promise as string | null;
  if (report) {
    log.info(`report ready (${report.length} chars), sending to group ${groupId}`);
    sendGroupMessage(groupId, report);
  } else {
    sendGroupMessage(groupId, '暂无可用日报（LLM 未配置或无事件）。');
  }
}

async function handleBotBiography(groupId: number, name: string): Promise<void> {
  const jobId = nextJobId();
  log.info(`dispatching bot biography job ${jobId} for "${name}"`);
  const { promise } = submitLlmJob({ type: 'job:biography', jobId, name, currentYear: cachedState.year });
  const result = await promise as { status: string; biography?: string; error?: string };
  const text = result.biography ?? result.error ?? '传记生成失败。';
  sendGroupMessage(groupId, text);
}

function handleBotMessage(msg: BotGroupMessage): void {
  const parsed = parseCommand(msg.content, msg.selfId);
  if (!parsed) return;

  const { groupId } = msg;
  log.info(`bot command: ${parsed.cmd}${parsed.arg ? ` arg="${parsed.arg}"` : ''} from group ${groupId}`);

  if (_busyGroups.has(groupId)) {
    sendGroupMessage(groupId, '正在生成中，请稍后再试。');
    return;
  }

  _busyGroups.add(groupId);
  sendGroupMessage(groupId, '生成中...');

  let task: Promise<void>;
  switch (parsed.cmd) {
    case 'report':
      task = handleBotReport(groupId);
      break;
    case 'biography':
      task = handleBotBiography(groupId, parsed.arg);
      break;
    default:
      _busyGroups.delete(groupId);
      return;
  }

  task
    .catch(err => {
      log.error(`bot ${parsed.cmd} failed:`, err);
      sendGroupMessage(groupId, `${parsed.cmd === 'report' ? '日报' : '传记'}生成失败，请稍后再试。`);
    })
    .finally(() => _busyGroups.delete(groupId));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

spawnSim();
spawnLlm();

server.listen(config.port, config.host, () => {
  log.info(`http://${config.host}:${config.port}`);
  startBot(handleBotMessage);
});

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

function shutdown(): void {
  log.info('shutting down...');
  stopBot();

  // Cancel all pending jobs (HTTP + bot)
  for (const [jobId, pending] of pendingJobs) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Server shutting down'));
    pendingJobs.delete(jobId);
  }

  if (simWorker) { simWorker.kill('SIGTERM'); simWorker = null; }
  if (llmWorker) { llmWorker.kill('SIGTERM'); llmWorker = null; }
  server.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import { createServer, type ServerResponse } from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { config, llmConfig } from './config.js';
import { startBot, stopBot, sendGroupMessage, type BotGroupMessage } from './bot.js';
import type { SimCommand, SimWorkerEvent, LlmCommand, LlmWorkerEvent, WorldContext, ChatMessage } from './ipc.js';
import type { StateSnapshot } from './runner.js';
import type { ChatResult } from './chat.js';
import { LEVEL_NAMES } from '../src/constants/index.js';
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
// mem_query IPC bridge (LLM worker -> gateway -> sim worker -> back)
// ---------------------------------------------------------------------------

const pendingMemQueries = new Map<string, { jobId: string }>();

function handleMemQueryFromLlm(jobId: string, queryId: string, expression: string): void {
  if (!simWorker?.connected || !simReady) {
    sendToLlm({ type: 'tool:memQueryResult', jobId, queryId, error: 'Sim worker not ready' });
    return;
  }
  pendingMemQueries.set(queryId, { jobId });
  simWorker.send({ type: 'sim:evalQuery', queryId, expression } as SimCommand);
}

function handleQueryResultFromSim(queryId: string, result?: unknown, error?: string): void {
  const pending = pendingMemQueries.get(queryId);
  if (!pending) return;
  pendingMemQueries.delete(queryId);
  sendToLlm({ type: 'tool:memQueryResult', jobId: pending.jobId, queryId, result, error });
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
      case 'sim:queryResult':
        handleQueryResultFromSim(msg.queryId, msg.result, msg.error);
        break;
    }
  });

  child.on('exit', (code) => {
    log.error(`sim worker exited (code=${code}), restarting...`);
    simReady = false;
    simWorker = null;
    // Fail-fast pending mem queries
    for (const [qid, pending] of pendingMemQueries) {
      sendToLlm({ type: 'tool:memQueryResult', jobId: pending.jobId, queryId: qid, error: 'Sim worker crashed' });
      pendingMemQueries.delete(qid);
    }
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
      case 'tool:memQuery':
        handleMemQueryFromLlm(msg.jobId, msg.queryId, msg.expression);
        break;
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

function parseCommand(raw: string, selfId?: number): { cmd: string; arg: string; atBot: boolean } | null {
  let text = raw;
  let atBot = false;
  if (selfId) {
    const atRegex = new RegExp(`\\[CQ:at,qq=${selfId}[^\\]]*\\]`, 'g');
    if (atRegex.test(text)) {
      atBot = true;
      text = text.replace(atRegex, '');
    }
  }
  text = text.replace(/^\s*\//, '').trim();
  if (!text && atBot) return { cmd: 'help', arg: '', atBot };
  if (!text) return null;
  if (text === '日报') return { cmd: 'report', arg: '', atBot };
  if (text === '状态') return { cmd: 'status', arg: '', atBot };
  if (text === 'help' || text === '帮助') return { cmd: 'help', arg: '', atBot };
  if (text === 'clear' || text === '清空') return { cmd: 'clear', arg: '', atBot };
  if (text === 'about') return { cmd: 'about', arg: '', atBot };
  const aboutMatch = text.match(/^about\s+(.+)$/);
  if (aboutMatch) return { cmd: 'about', arg: aboutMatch[1].trim(), atBot };
  const bioMatch = text.match(/^传记\s+(.+)$/);
  if (bioMatch) return { cmd: 'biography', arg: bioMatch[1].trim(), atBot };
  // If @bot but no matching command, treat as chat question
  if (atBot) return { cmd: 'chat', arg: text, atBot };
  return null;
}

const _busyGroups = new Set<number>();

// ---------------------------------------------------------------------------
// Conversation Session Store
// ---------------------------------------------------------------------------

interface ConversationSession {
  messages: ChatMessage[];
  lastActiveTs: number;
}

const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const SESSION_FILE = join(dirname(config.dbPath), 'sessions.json');
const sessionStore = new Map<string, ConversationSession>();

function saveSessions(): void {
  try {
    const data: Record<string, ConversationSession> = {};
    for (const [k, v] of sessionStore) data[k] = v;
    writeFileSync(SESSION_FILE, JSON.stringify(data));
  } catch { /* best-effort */ }
}

function restoreSessions(): void {
  try {
    if (!existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(readFileSync(SESSION_FILE, 'utf-8')) as Record<string, ConversationSession>;
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) {
      if (now - v.lastActiveTs < SESSION_EXPIRY_MS) sessionStore.set(k, v);
    }
    log.info(`restored ${sessionStore.size} session(s)`);
  } catch { /* ignore corrupt file */ }
}

function getSession(groupId: number, userId: number): ConversationSession {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  const existing = sessionStore.get(key);
  if (existing && (now - existing.lastActiveTs) < SESSION_EXPIRY_MS) {
    existing.lastActiveTs = now;
    return existing;
  }
  const fresh: ConversationSession = { messages: [], lastActiveTs: now };
  sessionStore.set(key, fresh);
  return fresh;
}

function updateSession(groupId: number, userId: number, messages: ChatMessage[]): void {
  const key = `${groupId}:${userId}`;
  sessionStore.set(key, { messages, lastActiveTs: Date.now() });
}

// Periodic cleanup of expired sessions + persist
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessionStore) {
    if (now - session.lastActiveTs >= SESSION_EXPIRY_MS) {
      sessionStore.delete(key);
    }
  }
  saveSessions();
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Bot handlers
// ---------------------------------------------------------------------------

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

async function handleBotChat(groupId: number, userId: number, question: string): Promise<void> {
  const session = getSession(groupId, userId);
  const worldContext = await requestWorldContext() ?? undefined;
  const yearSummary = cachedState.summary ?? undefined;

  const jobId = nextJobId();
  log.info(`dispatching bot chat job ${jobId} for group ${groupId} user ${userId}: "${question.slice(0, 60)}"`);

  const { promise } = submitLlmJob({
    type: 'job:chat',
    jobId,
    question,
    history: session.messages,
    worldContext,
    yearSummary,
  });

  const result = await promise as ChatResult;
  if (result.reply) {
    sendGroupMessage(groupId, result.reply);
  } else {
    sendGroupMessage(groupId, '暂时无法回答，请稍后再试。');
  }
  updateSession(groupId, userId, result.updatedHistory);
}

function formatStatus(): string {
  const s = cachedState;
  const lines: string[] = [];
  lines.push(`【修仙世界状态】`);
  lines.push(`纪元：第 ${s.year} 年`);
  lines.push(`状态：${s.running ? '运行中' : '已暂停'} | 速度：${s.speed}x`);
  lines.push(`Sim：${simReady ? '就绪' : '未就绪'} | LLM：${llmReady ? '就绪' : '未就绪'}`);

  if (s.summary) {
    const sm = s.summary;
    lines.push(`人口：${sm.totalPopulation}`);
    const dist = sm.levelCounts
      .map((n, i) => n > 0 ? `${LEVEL_NAMES[i]}:${n}` : '')
      .filter(Boolean)
      .join(' | ');
    if (dist) lines.push(`境界分布：${dist}`);
    lines.push(`最高境界：${LEVEL_NAMES[sm.highestLevel] ?? '炼气'}`);
  }
  return lines.join('\n');
}

const MODULE_INFO: Record<string, string> = {
  模拟引擎: '核心世界模拟引擎，驱动修仙世界每一个 tick 的演化：修士诞生、修炼、突破、战斗、陨落，均由引擎调度执行。',
  战斗: '修士间的战斗计算系统，基于境界、气运、装备等因素综合决斗，胜者可获取战利品提升实力。',
  境界: '八大修炼境界：炼气→筑基→结丹→元婴→化神→炼虚→合体→大乘。每个境界有独立的突破概率、寿命上限和战力系数。',
  地图: '32×32 的修仙大陆，划分为 10 个地理区域：朔北冻原、苍茫草海、西嶂高原、天断山脉、河洛中野、东陵林海、赤岚丘陵、南淮泽国、裂潮海岸、潮生群岛。',
  身份: '命名修士管理系统，基于 Ebbinghaus 记忆衰减模型追踪修士的知名度，从活跃记忆逐渐淡出至被遗忘。',
  日报: 'LLM 驱动的每日修仙界新闻，自动从世界事件中提取要闻并生成叙事风格的日报。',
  传记: 'LLM 驱动的修士传记系统，包含鲜明记忆、渐淡记忆、传说、遗忘四个记忆层级，为每位修士编织独特的生平故事。',
  数据库: 'SQLite 持久化存储，记录世界事件、修士档案和命名身份等核心数据。',
  机器人: '基于 OneBot v11 协议的 QQ 群机器人，支持通过群聊命令查询世界状态、生成日报和传记。',
};

const MODULE_ALIASES: Record<string, string> = {
  engine: '模拟引擎', 引擎: '模拟引擎', 模拟: '模拟引擎',
  combat: '战斗', 战斗系统: '战斗',
  level: '境界', 境界系统: '境界', 修炼: '境界',
  map: '地图', spatial: '地图', 区域: '地图', 空间: '地图',
  identity: '身份', 身份系统: '身份', 记忆: '身份',
  report: '日报', reporter: '日报', 日报系统: '日报',
  biography: '传记', bio: '传记', 传记系统: '传记',
  db: '数据库', database: '数据库', sqlite: '数据库',
  bot: '机器人', qq: '机器人', onebot: '机器人',
};

function formatAbout(arg: string): string {
  if (!arg) {
    const modules = Object.keys(MODULE_INFO).join('、');
    return `修仙世界模拟器：AI 驱动的修仙界沙盒，自动演化修士的诞生、修炼、战斗与陨落，并生成叙事日报与传记。\n\n可查询模块：${modules}`;
  }
  const key = MODULE_INFO[arg] ? arg : MODULE_ALIASES[arg.toLowerCase()];
  if (key && MODULE_INFO[key]) return `【${key}】\n${MODULE_INFO[key]}`;
  const modules = Object.keys(MODULE_INFO).join('、');
  return `未知模块「${arg}」。可查询的模块：${modules}`;
}

function handleBotMessage(msg: BotGroupMessage): void {
  const parsed = parseCommand(msg.content, msg.selfId);
  if (!parsed) return;
  // Require @bot for all interactions
  if (!parsed.atBot) return;

  const { groupId, userId } = msg;
  log.info(`bot command: ${parsed.cmd}${parsed.arg ? ` arg="${parsed.arg}"` : ''} from group ${groupId} user ${userId}`);

  if (parsed.cmd === 'help') {
    sendGroupMessage(groupId, [
      '【可用命令】（@我 后发送）',
      '状态 — 查看当前模拟世界状态',
      '日报 — 生成今日修仙界日报',
      '传记 <名字> — 生成指定修仙者的传记',
      'about [模块] — 系统简介或模块详情',
      'clear — 清空对话上下文',
      'help — 显示本帮助信息',
      '',
      '也可以直接 @我 用自然语言提问任何关于修仙世界的问题。',
    ].join('\n'));
    return;
  }

  if (parsed.cmd === 'about') {
    sendGroupMessage(groupId, formatAbout(parsed.arg));
    return;
  }

  if (parsed.cmd === 'clear') {
    const key = `${groupId}:${userId}`;
    sessionStore.delete(key);
    sendGroupMessage(groupId, '对话上下文已清空。');
    return;
  }

  if (parsed.cmd === 'status') {
    sendGroupMessage(groupId, formatStatus());
    return;
  }

  if (_busyGroups.has(groupId)) {
    sendGroupMessage(groupId, '正在生成中，请稍后再试。');
    return;
  }

  _busyGroups.add(groupId);

  let task: Promise<void>;
  switch (parsed.cmd) {
    case 'report':
      sendGroupMessage(groupId, '生成中...');
      task = handleBotReport(groupId);
      break;
    case 'biography':
      sendGroupMessage(groupId, '生成中...');
      task = handleBotBiography(groupId, parsed.arg);
      break;
    case 'chat':
      if (!llmReady) {
        sendGroupMessage(groupId, 'LLM 服务未就绪，请稍后再试。');
        _busyGroups.delete(groupId);
        return;
      }
      sendGroupMessage(groupId, '思考中...');
      task = handleBotChat(groupId, userId, parsed.arg);
      break;
    default:
      _busyGroups.delete(groupId);
      return;
  }

  task
    .catch(err => {
      log.error(`bot ${parsed.cmd} failed:`, err);
      const label = parsed.cmd === 'report' ? '日报' : parsed.cmd === 'biography' ? '传记' : '回答';
      sendGroupMessage(groupId, `${label}生成失败，请稍后再试。`);
    })
    .finally(() => _busyGroups.delete(groupId));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

restoreSessions();
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
  saveSessions();
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

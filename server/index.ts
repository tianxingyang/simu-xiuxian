import { createServer, type ServerResponse } from 'node:http';
import cron from 'node-cron';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.js';
import { generateBiography } from './biography.js';
import { generateDailyReport, isBusy, checkMissedReport } from './reporter.js';
import { Runner, type Command } from './runner.js';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseCommand(raw: string): Command | null {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg.type !== 'string') return null;
  switch (msg.type) {
    case 'start':
      return isNum(msg.speed) && isNum(msg.seed) && isNum(msg.initialPop)
        ? { type: 'start', speed: msg.speed, seed: msg.seed, initialPop: msg.initialPop } : null;
    case 'pause': return { type: 'pause' };
    case 'step': return { type: 'step' };
    case 'setSpeed': return isNum(msg.speed) ? { type: 'setSpeed', speed: msg.speed } : null;
    case 'reset':
      return isNum(msg.seed) && isNum(msg.initialPop)
        ? { type: 'reset', seed: msg.seed, initialPop: msg.initialPop } : null;
    case 'ack': return { type: 'ack', tickId: isNum(msg.tickId) ? msg.tickId : undefined };
    default: return null;
  }
}

const clients = new Set<WebSocket>();

const runner = new Runner({
  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  },
  clientCount: () => clients.size,
});

if (runner.restore()) console.log('[server] sim_state restored');

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { status: 'ok', year: runner.getState().year });
    return;
  }

  if (url.pathname === '/api/report') {
    if (req.method !== 'POST') { json(res, 405, { status: 'method_not_allowed' }); return; }
    if (isBusy()) { json(res, 409, { status: 'busy' }); return; }
    const date = url.searchParams.get('date') ?? undefined;
    json(res, 200, { status: 'ok', date: date ?? 'yesterday' });
    generateDailyReport(date).catch(err => console.error('[server] report generation error:', err));
    return;
  }

  if (url.pathname === '/api/biography') {
    if (req.method !== 'POST') { json(res, 405, { status: 'method_not_allowed' }); return; }
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
      const currentYear = runner.getState().year;
      generateBiography(parsed.name.trim(), currentYear)
        .then(result => json(res, result.status === 'error' ? 500 : 200, result))
        .catch(err => {
          console.error('[server] biography error:', err);
          json(res, 500, { status: 'error', error: 'Internal server error' });
        });
    });
    return;
  }

  json(res, 404, { status: 'not_found' });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', ...runner.getState() }));
  clients.add(ws);

  ws.on('message', (data) => {
    const cmd = parseCommand(data.toString());
    if (!cmd) { console.warn('[ws] invalid message'); return; }
    runner.dispatch(cmd);
  });

  ws.on('close', () => {
    clients.delete(ws);
    runner.onClientDisconnect();
  });

  ws.on('error', (err) => console.warn('[ws] error:', err));
});

server.listen(config.port, config.host, () => {
  console.log(`[server] http://${config.host}:${config.port}`);

  // Cron: daily report generation
  cron.schedule(config.reportCron, () => {
    console.log('[cron] triggering daily report');
    generateDailyReport().catch(err => console.error('[cron] report error:', err));
  }, { timezone: 'Asia/Shanghai' });
  console.log(`[server] report cron scheduled: "${config.reportCron}" Asia/Shanghai`);

  // Startup backfill: check if yesterday's report is missing
  if (checkMissedReport()) {
    console.log('[server] missed report detected, backfilling...');
    generateDailyReport().catch(err => console.error('[server] backfill error:', err));
  }
});

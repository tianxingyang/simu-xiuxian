import { createServer, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.js';
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
    json(res, 200, { status: 'ok' });
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
});

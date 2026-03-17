import WebSocket from 'ws';
import { config } from './config.js';
import { getLastRequestTs, setLastRequestTs } from './db.js';
import { generateReportForRange } from './reporter.js';
import { generateBiography } from './biography.js';

// ---------------------------------------------------------------------------
// OAuth Token Manager
// ---------------------------------------------------------------------------

let _accessToken = '';
let _tokenExpiresAt = 0;

async function ensureAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiresAt) return _accessToken;

  const resp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: config.qqBotAppId, clientSecret: config.qqBotAppSecret }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`getAppAccessToken failed: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: string };
  _accessToken = data.access_token;
  _tokenExpiresAt = Date.now() + (Number(data.expires_in) - 60) * 1000;
  console.log('[bot] access token refreshed');
  return _accessToken;
}

// ---------------------------------------------------------------------------
// Message Sending (Passive Reply)
// ---------------------------------------------------------------------------

async function sendGroupMessage(groupOpenid: string, content: string, msgId: string): Promise<void> {
  const token = await ensureAccessToken();
  const url = `https://api.sgroup.qq.com/v2/groups/${groupOpenid}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content, msg_type: 0, msg_id: msgId }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error(`[bot] sendGroupMessage failed: ${resp.status} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Command Handlers
// ---------------------------------------------------------------------------

type GetYear = () => number;
let _getYear: GetYear = () => 1;

async function handleDailyReport(groupOpenid: string, msgId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const lastTs = getLastRequestTs(groupOpenid) ?? (now - 86400);

  try {
    const report = await generateReportForRange(lastTs, now);
    setLastRequestTs(groupOpenid, now);

    if (report) {
      await sendGroupMessage(groupOpenid, report, msgId);
    } else {
      await sendGroupMessage(groupOpenid, '暂无可用日报（LLM 未配置或无事件）。', msgId);
    }
  } catch (err) {
    console.error('[bot] report generation failed:', err);
    await sendGroupMessage(groupOpenid, '日报生成失败，请稍后再试。', msgId);
  }
}

async function handleBiography(groupOpenid: string, msgId: string, name: string): Promise<void> {
  try {
    const result = await generateBiography(name, _getYear());
    const text = result.biography ?? result.error ?? '传记生成失败。';
    await sendGroupMessage(groupOpenid, text, msgId);
  } catch (err) {
    console.error('[bot] biography generation failed:', err);
    await sendGroupMessage(groupOpenid, '传记生成失败，请稍后再试。', msgId);
  }
}

function parseCommand(raw: string): { cmd: string; arg: string } | null {
  const text = raw.replace(/^\//, '').trim();
  if (!text) return null;
  if (text === '日报') return { cmd: 'report', arg: '' };
  const bioMatch = text.match(/^传记\s+(.+)$/);
  if (bioMatch) return { cmd: 'biography', arg: bioMatch[1].trim() };
  return null;
}

async function handleMessage(groupOpenid: string, msgId: string, content: string): Promise<void> {
  const parsed = parseCommand(content);
  if (!parsed) {
    await sendGroupMessage(groupOpenid, '可用命令：\n- 日报\n- 传记 <修士名>', msgId);
    return;
  }

  switch (parsed.cmd) {
    case 'report':
      await handleDailyReport(groupOpenid, msgId);
      break;
    case 'biography':
      await handleBiography(groupOpenid, msgId, parsed.arg);
      break;
  }
}

// ---------------------------------------------------------------------------
// Gateway WebSocket
// ---------------------------------------------------------------------------

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

interface HelloData {
  heartbeat_interval: number;
}

interface ReadyData {
  session_id: string;
}

interface GroupAtMessageData {
  group_openid: string;
  content: string;
  id: string;
}

let _ws: WebSocket | null = null;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _seq: number | null = null;
let _sessionId: string | null = null;
let _reconnectDelay = 1000;
let _stopping = false;

function clearHeartbeat(): void {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

function sendPayload(ws: WebSocket, payload: GatewayPayload): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function startHeartbeat(ws: WebSocket, interval: number): void {
  clearHeartbeat();
  _heartbeatTimer = setInterval(() => {
    sendPayload(ws, { op: 1, d: _seq });
  }, interval);
}

async function identify(ws: WebSocket): Promise<void> {
  const token = await ensureAccessToken();
  sendPayload(ws, {
    op: 2,
    d: {
      token: `QQBot ${token}`,
      intents: 1 << 25,
      shard: [0, 1],
    },
  });
}

function resume(ws: WebSocket): void {
  sendPayload(ws, {
    op: 6,
    d: {
      token: `QQBot ${_accessToken}`,
      session_id: _sessionId,
      seq: _seq,
    },
  });
}

async function connectGateway(): Promise<void> {
  if (_stopping) return;

  let gatewayUrl: string;
  try {
    const token = await ensureAccessToken();
    const resp = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: { 'Authorization': `QQBot ${token}` },
    });
    if (!resp.ok) throw new Error(`gateway fetch failed: ${resp.status}`);
    const data = (await resp.json()) as { url: string };
    gatewayUrl = data.url;
  } catch (err) {
    console.error('[bot] failed to get gateway URL:', err);
    scheduleReconnect();
    return;
  }

  console.log(`[bot] connecting to gateway: ${gatewayUrl}`);
  const ws = new WebSocket(gatewayUrl);
  _ws = ws;

  ws.on('open', () => {
    console.log('[bot] gateway connected');
    _reconnectDelay = 1000;
  });

  ws.on('message', (raw) => {
    let payload: GatewayPayload;
    try { payload = JSON.parse(raw.toString()); } catch { return; }

    if (payload.s !== undefined && payload.s !== null) _seq = payload.s;

    switch (payload.op) {
      case 10: {
        const hello = payload.d as HelloData;
        startHeartbeat(ws, hello.heartbeat_interval);
        if (_sessionId && _seq !== null) {
          resume(ws);
        } else {
          identify(ws).catch(err => console.error('[bot] identify failed:', err));
        }
        break;
      }
      case 0: {
        if (payload.t === 'READY') {
          const ready = payload.d as ReadyData;
          _sessionId = ready.session_id;
          console.log(`[bot] session ready: ${_sessionId}`);
        } else if (payload.t === 'RESUMED') {
          console.log('[bot] session resumed');
        } else if (payload.t === 'GROUP_AT_MESSAGE_CREATE') {
          const msg = payload.d as GroupAtMessageData;
          handleMessage(msg.group_openid, msg.id, msg.content).catch(err =>
            console.error('[bot] handleMessage error:', err)
          );
        }
        break;
      }
      case 11: break;
      case 7: {
        console.warn('[bot] received reconnect request');
        ws.close();
        break;
      }
      case 9: {
        console.warn('[bot] invalid session, re-identifying');
        _sessionId = null;
        _seq = null;
        identify(ws).catch(err => console.error('[bot] re-identify failed:', err));
        break;
      }
    }
  });

  ws.on('close', () => {
    console.warn('[bot] gateway disconnected');
    clearHeartbeat();
    _ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[bot] gateway error:', err);
  });
}

function scheduleReconnect(): void {
  if (_stopping) return;
  console.log(`[bot] reconnecting in ${_reconnectDelay}ms`);
  setTimeout(() => connectGateway(), _reconnectDelay);
  _reconnectDelay = Math.min(_reconnectDelay * 2, 30000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startBot(getYear: GetYear): void {
  if (!config.qqBotAppId || !config.qqBotAppSecret) {
    console.warn('[bot] QQ_BOT_APP_ID or QQ_BOT_APP_SECRET not configured, bot disabled');
    return;
  }

  _getYear = getYear;
  _stopping = false;
  connectGateway();
}

export function stopBot(): void {
  _stopping = true;
  clearHeartbeat();
  if (_ws) { _ws.close(); _ws = null; }
}

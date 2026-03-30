import WebSocket from 'ws';
import { config } from './config.js';
import { getLogger } from './logger.js';

const log = getLogger('bot');

// ---------------------------------------------------------------------------
// OneBot v11 WebSocket Connection (thin transport layer)
// ---------------------------------------------------------------------------

let _ws: WebSocket | null = null;
let _reconnectDelay = 1000;
let _stopping = false;

function sendAction(action: string, params: Record<string, unknown>): void {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ action, params }));
  }
}

export function sendGroupMessage(groupId: number, content: string): void {
  sendAction('send_group_msg', { group_id: groupId, message: content });
}

// ---------------------------------------------------------------------------
// Event Filtering
// ---------------------------------------------------------------------------

export interface BotGroupMessage {
  groupId: number;
  userId: number;
  content: string;
  selfId?: number;
}

type MessageHandler = (msg: BotGroupMessage) => void;
let _onMessage: MessageHandler | null = null;

interface OneBotEvent {
  post_type: string;
  message_type?: string;
  group_id?: number;
  user_id?: number;
  self_id?: number;
  raw_message?: string;
}

function handleEvent(event: OneBotEvent): void {
  if (event.post_type !== 'message' || event.message_type !== 'group') return;
  if (config.qqGroupIds.size > 0 && !config.qqGroupIds.has(event.group_id ?? 0)) return;
  if (event.user_id === event.self_id) return;

  const content = (event.raw_message ?? '').trim();
  if (!content) return;

  _onMessage?.({ groupId: event.group_id!, userId: event.user_id!, content, selfId: event.self_id });
}

// ---------------------------------------------------------------------------
// WebSocket Connection
// ---------------------------------------------------------------------------

function connect(): void {
  if (_stopping) return;

  const url = config.onebotWsUrl;
  log.info(`connecting to OneBot: ${url}`);

  const headers: Record<string, string> = {};
  if (config.onebotToken) headers['Authorization'] = `Bearer ${config.onebotToken}`;

  const ws = new WebSocket(url, { headers });
  _ws = ws;

  ws.on('open', () => {
    log.info('OneBot connected');
    _reconnectDelay = 1000;
  });

  ws.on('message', (raw) => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if ('echo' in data) return;
    if (data.post_type) handleEvent(data as unknown as OneBotEvent);
  });

  ws.on('close', () => {
    log.warn('OneBot disconnected');
    _ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log.error('OneBot error:', err);
  });
}

function scheduleReconnect(): void {
  if (_stopping) return;
  log.info(`reconnecting in ${_reconnectDelay}ms`);
  setTimeout(() => connect(), _reconnectDelay);
  _reconnectDelay = Math.min(_reconnectDelay * 2, 30000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startBot(onMessage: MessageHandler): void {
  if (!config.onebotWsUrl) {
    log.warn('ONEBOT_WS_URL not configured, bot disabled');
    return;
  }

  _onMessage = onMessage;
  _stopping = false;
  connect();
}

export function stopBot(): void {
  _stopping = true;
  if (_ws) { _ws.close(); _ws = null; }
}

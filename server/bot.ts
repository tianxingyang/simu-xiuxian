import WebSocket from 'ws';
import { config } from './config.js';
import type { LlmCommand, LlmWorkerEvent } from './ipc.js';
import type { BiographyResult } from './biography.js';

// ---------------------------------------------------------------------------
// OneBot v11 WebSocket Connection
// ---------------------------------------------------------------------------

let _ws: WebSocket | null = null;
let _reconnectDelay = 1000;
let _stopping = false;

function sendAction(action: string, params: Record<string, unknown>): void {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ action, params }));
  }
}

function sendGroupMessage(groupId: number, content: string): void {
  sendAction('send_group_msg', { group_id: groupId, message: content });
}

// ---------------------------------------------------------------------------
// IPC Job Dispatch
// ---------------------------------------------------------------------------

type DispatchFn = (cmd: LlmCommand) => void;
type GetWorldContextFn = () => Promise<import('./ipc.js').WorldContext | null>;
let _dispatch: DispatchFn = () => {};
let _getYear: () => number = () => 1;
let _getWorldContext: GetWorldContextFn = () => Promise.resolve(null);
let _jobCounter = 0;

interface PendingJob {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const JOB_TIMEOUT = 150_000;
const _pendingJobs = new Map<string, PendingJob>();

function nextJobId(): string {
  return `bot-${++_jobCounter}-${Date.now().toString(36)}`;
}

function submitJob(cmd: LlmCommand): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingJobs.delete(cmd.jobId);
      _dispatch({ type: 'job:cancel', jobId: cmd.jobId });
      reject(new Error('Job timeout'));
    }, JOB_TIMEOUT);
    _pendingJobs.set(cmd.jobId, { resolve, reject, timer });
    _dispatch(cmd);
  });
}

/** Called by gateway when LLM worker sends a result/error */
export function onLlmResult(msg: LlmWorkerEvent): void {
  if (msg.type !== 'job:result' && msg.type !== 'job:error') return;
  const pending = _pendingJobs.get(msg.jobId);
  if (!pending) return;
  clearTimeout(pending.timer);
  _pendingJobs.delete(msg.jobId);
  if (msg.type === 'job:result') {
    pending.resolve(msg.payload);
  } else {
    pending.reject(new Error(msg.error));
  }
}

// ---------------------------------------------------------------------------
// Command Handlers
// ---------------------------------------------------------------------------

async function handleReport(groupId: number): Promise<void> {
  try {
    const worldContext = await _getWorldContext() ?? undefined;
    const gid = String(groupId);
    const report = await submitJob({ type: 'job:report', jobId: nextJobId(), groupId: gid, worldContext }) as string | null;

    if (report) {
      sendGroupMessage(groupId, report);
    } else {
      sendGroupMessage(groupId, '暂无可用日报（LLM 未配置或无事件）。');
    }
  } catch (err) {
    console.error('[bot] report generation failed:', err);
    sendGroupMessage(groupId, '日报生成失败，请稍后再试。');
  }
}

async function handleBiography(groupId: number, name: string): Promise<void> {
  try {
    const result = await submitJob({ type: 'job:biography', jobId: nextJobId(), name, currentYear: _getYear() }) as BiographyResult;
    const text = result.biography ?? result.error ?? '传记生成失败。';
    sendGroupMessage(groupId, text);
  } catch (err) {
    console.error('[bot] biography generation failed:', err);
    sendGroupMessage(groupId, '传记生成失败，请稍后再试。');
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

async function handleMessage(groupId: number, content: string): Promise<void> {
  const parsed = parseCommand(content);
  if (!parsed) return;

  switch (parsed.cmd) {
    case 'report':
      await handleReport(groupId);
      break;
    case 'biography':
      await handleBiography(groupId, parsed.arg);
      break;
  }
}

// ---------------------------------------------------------------------------
// OneBot v11 Event Handling
// ---------------------------------------------------------------------------

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
  if (config.qqGroupId && event.group_id !== config.qqGroupId) return;
  if (event.user_id === event.self_id) return;

  const content = (event.raw_message ?? '').trim();
  if (!content) return;

  handleMessage(event.group_id!, content).catch(err =>
    console.error('[bot] handleMessage error:', err)
  );
}

// ---------------------------------------------------------------------------
// WebSocket Connection
// ---------------------------------------------------------------------------

function connect(): void {
  if (_stopping) return;

  const url = config.onebotWsUrl;
  console.log(`[bot] connecting to OneBot: ${url}`);

  const headers: Record<string, string> = {};
  if (config.onebotToken) headers['Authorization'] = `Bearer ${config.onebotToken}`;

  const ws = new WebSocket(url, { headers });
  _ws = ws;

  ws.on('open', () => {
    console.log('[bot] OneBot connected');
    _reconnectDelay = 1000;
  });

  ws.on('message', (raw) => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if ('echo' in data) return;
    if (data.post_type) handleEvent(data as unknown as OneBotEvent);
  });

  ws.on('close', () => {
    console.warn('[bot] OneBot disconnected');
    _ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[bot] OneBot error:', err);
  });
}

function scheduleReconnect(): void {
  if (_stopping) return;
  console.log(`[bot] reconnecting in ${_reconnectDelay}ms`);
  setTimeout(() => connect(), _reconnectDelay);
  _reconnectDelay = Math.min(_reconnectDelay * 2, 30000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startBot(getYear: () => number, dispatch: DispatchFn, getWorldContext?: GetWorldContextFn): void {
  if (!config.onebotWsUrl) {
    console.warn('[bot] ONEBOT_WS_URL not configured, bot disabled');
    return;
  }

  _getYear = getYear;
  _dispatch = dispatch;
  if (getWorldContext) _getWorldContext = getWorldContext;
  _stopping = false;
  connect();
}

export function onLlmWorkerDied(): void {
  for (const pending of _pendingJobs.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('LLM worker crashed'));
  }
  _pendingJobs.clear();
}

export function stopBot(): void {
  _stopping = true;
  if (_ws) { _ws.close(); _ws = null; }
  onLlmWorkerDied();
}

import blessed from 'blessed';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, openSync, watchFile, unwatchFile, type StatWatcher } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

// ─── paths ───────────────────────────────────────────────────────────────────
const ROOT = dirname(fileURLToPath(import.meta.url));
const PID_DIR = resolve(ROOT, '.pid');
const LOG_DIR = resolve(ROOT, '.logs');
const ENV_FILE = resolve(ROOT, '.env');

mkdirSync(PID_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

// ─── env helpers ─────────────────────────────────────────────────────────────
interface EnvEntry { key: string; default: string; desc: string; sensitive?: boolean }

const ENV_SCHEMA: EnvEntry[] = [
  { key: 'PORT', default: '3001', desc: 'Backend port' },
  { key: 'HOST', default: '0.0.0.0', desc: 'Bind address' },
  { key: 'DB_PATH', default: './data/simu-xiuxian.db', desc: 'SQLite path' },
  { key: 'LLM_BASE_URL', default: 'https://openrouter.ai/api/v1', desc: 'LLM API URL' },
  { key: 'LLM_API_KEY', default: '', desc: 'LLM API key', sensitive: true },
  { key: 'LLM_MODEL', default: 'deepseek/deepseek-chat', desc: 'LLM model' },
  { key: 'ONEBOT_HTTP_URL', default: '', desc: 'OneBot URL' },
  { key: 'ONEBOT_TOKEN', default: '', desc: 'OneBot token', sensitive: true },
  { key: 'QQ_GROUP_ID', default: '0', desc: 'QQ group ID' },
  { key: 'REPORT_CRON', default: '0 8 * * *', desc: 'Report cron' },
  { key: 'VITE_WS_URL', default: '', desc: 'WS URL override' },
];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="(.*)"/);
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

function saveEnv(env: Record<string, string>): void {
  const lines = ['# simu-xiuxian environment (auto-generated)'];
  for (const { key } of ENV_SCHEMA) {
    if (env[key]) lines.push(`${key}="${env[key]}"`);
  }
  writeFileSync(ENV_FILE, lines.join('\n') + '\n');
}

function getPort(): number {
  const env = loadEnv();
  return Number(env.PORT) || 3001;
}

function getDbPath(): string {
  const env = loadEnv();
  return env.DB_PATH || './data/simu-xiuxian.db';
}

// ─── process management ──────────────────────────────────────────────────────
type ServiceName = 'backend' | 'frontend';

const children: Record<ServiceName, ChildProcess | null> = { backend: null, frontend: null };

function pidFile(name: ServiceName): string { return resolve(PID_DIR, `${name}.pid`); }
function logFile(name: ServiceName): string { return resolve(LOG_DIR, `${name}.log`); }

function isRunning(name: ServiceName): { running: boolean; pid?: number } {
  const pf = pidFile(name);
  if (!existsSync(pf)) return { running: false };
  const pid = Number(readFileSync(pf, 'utf-8').trim());
  try { process.kill(pid, 0); return { running: true, pid }; }
  catch { rmSync(pf, { force: true }); return { running: false }; }
}

function portInUse(port: number): string | false {
  try {
    const out = execSync(`lsof -ti :${port} 2>/dev/null`).toString().trim();
    return out || false;
  } catch { return false; }
}

function startService(name: ServiceName): string {
  const st = isRunning(name);
  if (st.running) return `{yellow-fg}${name} already running (PID ${st.pid}){/}`;

  // port conflict check
  const port = name === 'backend' ? getPort() : 5173;
  const occupant = portInUse(port);
  if (occupant) {
    const pids = occupant.split('\n').join(', ');
    return `{red-fg}Port ${port} already in use (PID ${pids}). Kill it first or change port.{/}`;
  }

  const env = { ...process.env, ...loadEnv() };
  const log = logFile(name);
  const cmd = name === 'backend'
    ? { bin: 'npx', args: ['tsx', 'server/index.ts'] }
    : { bin: 'npx', args: ['vite'] };

  const out = openSync(log, 'w');
  const child = spawn(cmd.bin, cmd.args, {
    cwd: ROOT, env, stdio: ['ignore', out, out], detached: true,
  });
  child.unref();
  children[name] = child;

  if (child.pid) {
    writeFileSync(pidFile(name), String(child.pid));
    return `{green-fg}${name} started{/} (PID ${child.pid})`;
  }
  return `{red-fg}${name} failed to start{/}`;
}

function killPid(pid: number): void {
  try { process.kill(-pid, 'SIGTERM'); } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0); } catch { return; }
    execSync('sleep 0.1');
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* ok */ }
}

function stopService(name: ServiceName): string {
  const st = isRunning(name);
  if (st.running && st.pid) {
    killPid(st.pid);
    rmSync(pidFile(name), { force: true });
    children[name] = null;
    return `{green-fg}${name} stopped{/} (PID ${st.pid})`;
  }

  // no PID file — check port for orphan process
  const port = name === 'backend' ? getPort() : 5173;
  const occupant = portInUse(port);
  if (occupant) {
    for (const p of occupant.split('\n')) {
      const pid = Number(p.trim());
      if (pid > 0) killPid(pid);
    }
    rmSync(pidFile(name), { force: true });
    children[name] = null;
    return `{green-fg}${name} stopped{/} (orphan on :${port})`;
  }

  return `{bold}${name}{/} not running`;
}

// ─── simulation state via WebSocket ──────────────────────────────────────────
interface SimState { year: number; running: boolean; speed: number; pop: number; connected: boolean }

const sim: SimState & { extinct: boolean; ticks: number } = { year: 1, running: false, speed: 1, pop: 0, connected: false, extinct: false, ticks: 0 };
let simWs: WebSocket | null = null;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wantConnection = false;

function connectSim(): void {
  wantConnection = true;
  if (simWs) return;
  const port = getPort();
  let ws: WebSocket;
  try { ws = new WebSocket(`ws://localhost:${port}/ws`); }
  catch { scheduleReconnect(); return; }
  simWs = ws;

  ws.on('open', () => { sim.connected = true; logMsg('{green-fg}WebSocket connected{/}'); refreshUI(); });
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'state') {
        sim.year = msg.year; sim.running = msg.running; sim.speed = msg.speed;
        sim.pop = msg.summary?.totalPopulation ?? 0;
      } else if (msg.type === 'tick') {
        if (typeof msg.tickId === 'number') {
          ws.send(JSON.stringify({ type: 'ack', tickId: msg.tickId }));
        }
        sim.ticks++;
        const last = msg.summaries?.[msg.summaries.length - 1];
        if (last) { sim.year = last.year; sim.pop = last.totalPopulation; }
        sim.running = true;
      } else if (msg.type === 'paused') {
        sim.running = false;
        if (msg.reason === 'extinction') {
          sim.extinct = true;
          logMsg('{red-fg}Simulation stopped: population extinct — use Reset to restart{/}');
        } else {
          logMsg('{yellow-fg}Simulation paused{/}');
        }
      } else if (msg.type === 'reset-done') {
        sim.year = 1; sim.pop = 0; sim.running = false; sim.extinct = false; sim.ticks = 0;
        logMsg('{green-fg}Simulation reset{/}');
      }
      refreshUI();
    } catch { /* ignore malformed messages */ }
  });
  ws.on('close', () => {
    sim.connected = false; simWs = null; refreshUI();
    if (wantConnection) scheduleReconnect();
  });
  ws.on('error', () => { ws.close(); });
}

function scheduleReconnect(): void {
  if (reconnectTimer || !wantConnection) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wantConnection && !simWs) connectSim();
  }, 1500);
}

function disconnectSim(): void {
  wantConnection = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  simWs?.close();
  simWs = null;
  sim.connected = false;
}

function wsSend(msg: object): string {
  if (!simWs || simWs.readyState !== WebSocket.OPEN) return '{red-fg}Not connected to backend{/}';
  simWs.send(JSON.stringify(msg));
  return '{green-fg}Command sent{/}';
}

// ─── log tailing ─────────────────────────────────────────────────────────────
const logWatchers: StatWatcher[] = [];
const logOffsets: Record<string, number> = {};

function startLogTail(): void {
  for (const name of ['backend', 'frontend'] as const) {
    const path = logFile(name);
    if (!existsSync(path)) continue;
    logOffsets[path] = readFileSync(path).length; // start from current end
    const watcher = watchFile(path, { interval: 500 }, () => {
      if (!existsSync(path)) return;
      const buf = readFileSync(path);
      const offset = logOffsets[path] ?? 0;
      if (buf.length > offset) {
        const newData = buf.subarray(offset).toString();
        for (const line of newData.split('\n').filter(Boolean)) {
          const tag = name === 'backend' ? '{cyan-fg}[BE]{/}' : '{magenta-fg}[FE]{/}';
          logBox.log(`${tag} ${line}`);
        }
        logOffsets[path] = buf.length;
      }
    });
    logWatchers.push(watcher);
  }
}

function stopLogTail(): void {
  for (const name of ['backend', 'frontend'] as const) {
    unwatchFile(logFile(name));
  }
  logWatchers.length = 0;
}

// ─── blessed UI ──────────────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: 'Simu Xiuxian Console',
  fullUnicode: true,
});

// ── Services panel ───────────────────────────────────────────────────────────
const servicesBox = blessed.box({
  top: 0, left: 0, width: '50%', height: 7,
  label: ' Services ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true } },
});

// ── Simulation panel ─────────────────────────────────────────────────────────
const simBox = blessed.box({
  top: 0, left: '50%', width: '50%', height: 7,
  label: ' Simulation ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'yellow' }, label: { fg: 'yellow', bold: true } },
});

// ── Actions panel (grid-navigable) ───────────────────────────────────────────
interface MenuItem { key: string; label: string; color: string }

const menuGrid: { group: string; items: MenuItem[] }[] = [
  { group: 'Services', items: [
    { key: '1', label: 'Start All', color: 'cyan' },
    { key: '2', label: 'Stop All', color: 'cyan' },
    { key: '3', label: 'Start BE', color: 'cyan' },
    { key: '4', label: 'Start FE', color: 'cyan' },
    { key: '5', label: 'Stop BE', color: 'cyan' },
    { key: '6', label: 'Stop FE', color: 'cyan' },
  ]},
  { group: 'Simulate', items: [
    { key: 'r', label: 'Run', color: 'yellow' },
    { key: 'p', label: 'Pause', color: 'yellow' },
    { key: 'v', label: 'Speed', color: 'yellow' },
    { key: 't', label: 'Step', color: 'yellow' },
    { key: 'x', label: 'Reset', color: 'yellow' },
  ]},
  { group: 'Tools', items: [
    { key: 'e', label: 'Env Config', color: 'green' },
    { key: 'm', label: 'Model', color: 'green' },
    { key: 'd', label: 'Report', color: 'green' },
    { key: 'l', label: 'Logs', color: 'green' },
    { key: 'w', label: 'Reset DB', color: 'green' },
    { key: 's', label: 'Status', color: 'green' },
    { key: 'q', label: 'Quit', color: 'red' },
  ]},
];

let menuRow = 0;
let menuCol = 0;

// flat hotkey → [row, col] lookup
const hotkeyMap = new Map<string, [number, number]>();
for (let r = 0; r < menuGrid.length; r++)
  for (let c = 0; c < menuGrid[r].items.length; c++)
    hotkeyMap.set(menuGrid[r].items[c].key, [r, c]);

function clampCol(): void {
  const maxCol = menuGrid[menuRow].items.length - 1;
  if (menuCol > maxCol) menuCol = maxCol;
}

const actionsBox = blessed.box({
  top: 7, left: 0, width: '100%', height: 7,
  label: ' Actions ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'white' }, label: { fg: 'white', bold: true } },
});

function renderActions(): void {
  const lines: string[] = [];
  for (let r = 0; r < menuGrid.length; r++) {
    const { group, items } = menuGrid[r];
    let line = ` {bold}${group.padEnd(8)}{/} `;
    for (let c = 0; c < items.length; c++) {
      const { key, label, color } = items[c];
      if (r === menuRow && c === menuCol) {
        line += ` {black-fg}{${color}-bg}{bold} ${key} ${label} {/}`;
      } else {
        line += ` {${color}-fg}${key}{/} ${label} `;
      }
    }
    lines.push(line);
  }
  actionsBox.setContent('\n' + lines.join('\n'));
}

// ── Log panel ────────────────────────────────────────────────────────────────
const logBox = blessed.log({
  top: 14, left: 0, width: '100%', height: '100%-15',
  label: ' Log ',
  border: { type: 'line' },
  tags: true,
  scrollable: true,
  scrollbar: { ch: '│', style: { fg: 'grey' } },
  mouse: true,
  style: { border: { fg: 'grey' }, label: { fg: 'grey', bold: true } },
});

// ── Status bar ───────────────────────────────────────────────────────────────
const statusBar = blessed.box({
  bottom: 0, left: 0, width: '100%', height: 1,
  tags: true,
  style: { fg: 'white', bg: 'blue' },
});

screen.append(servicesBox);
screen.append(simBox);
screen.append(actionsBox);
screen.append(logBox);
screen.append(statusBar);

// ─── refresh ─────────────────────────────────────────────────────────────────
function refreshUI(): void {
  // services
  const be = isRunning('backend');
  const fe = isRunning('frontend');
  const port = getPort();
  servicesBox.setContent(
    '\n' +
    (be.running
      ? ` {green-fg}●{/} Backend   {bold}:${port}{/}  {white-fg}PID ${be.pid}{/}`
      : ` {white-fg}○{/} Backend   {white-fg}:${port}{/}  {white-fg}stopped{/}`) +
    '\n' +
    (fe.running
      ? ` {green-fg}●{/} Frontend  {bold}:5173{/}  {white-fg}PID ${fe.pid}{/}`
      : ` {white-fg}○{/} Frontend  {white-fg}:5173{/}  {white-fg}stopped{/}`)
  );

  // simulation
  const speedLabel = ['×1', '×5', '×10'][sim.speed - 1] ?? `×${sim.speed}`;
  const stateLabel = !sim.connected
    ? '{white-fg}disconnected{/}'
    : sim.extinct ? '{red-fg}☠ Extinct{/}'
    : sim.running ? '{green-fg}▶ Running{/}' : '{yellow-fg}⏸ Paused{/}';
  simBox.setContent(
    '\n' +
    ` Year:  {bold}${sim.year}{/}  Tick: {bold}#${sim.ticks}{/}\n` +
    ` Pop:   {bold}${sim.pop.toLocaleString()}{/}\n` +
    ` Speed: {bold}${speedLabel}{/}  ${stateLabel}`
  );

  // actions grid
  renderActions();

  // status bar
  statusBar.setContent(
    ` {bold}Simu Xiuxian Console{/}  |  ` +
    `BE:${be.running ? '{green-fg}ON{/}' : 'OFF'}  ` +
    `FE:${fe.running ? '{green-fg}ON{/}' : 'OFF'}  ` +
    `Sim:${sim.connected ? (sim.running ? '{green-fg}RUN{/}' : '{yellow-fg}IDLE{/}') : 'N/A'}  ` +
    `Year:${sim.year}`
  );

  screen.render();
}

function logMsg(msg: string): void { logBox.log(msg); screen.render(); }

// ─── input lock (prevents hotkeys from stealing textbox keystrokes) ──────────
let inputActive = false;

// ─── prompt helper ───────────────────────────────────────────────────────────
function prompt(label: string, defaultVal: string): Promise<string> {
  return new Promise((res) => {
    const p = blessed.prompt({
      top: 'center', left: 'center',
      width: 50, height: 'shrink',
      border: { type: 'line' },
      label: ` ${label} `,
      tags: true,
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'cyan', bold: true },
        fg: 'white',
      },
    });
    screen.append(p);
    p.input(label, defaultVal, (_err, value) => {
      screen.remove(p);
      screen.render();
      res(value?.trim() || defaultVal);
    });
    screen.render();
  });
}

function confirm(label: string): Promise<boolean> {
  return new Promise((res) => {
    const box = blessed.question({
      top: 'center', left: 'center',
      width: 50, height: 5,
      border: { type: 'line' },
      tags: true,
      style: {
        border: { fg: 'red' },
        fg: 'white',
      },
    });
    screen.append(box);
    box.ask(label, (_err, ok) => {
      screen.remove(box);
      screen.render();
      res(!!ok);
    });
    screen.render();
  });
}

// ─── actions ─────────────────────────────────────────────────────────────────
async function actionStartAll(): Promise<void> {
  logMsg(startService('backend'));
  logMsg(startService('frontend'));
  connectSim();
  startLogTail();
}

async function actionStopAll(): Promise<void> {
  disconnectSim(); stopLogTail();
  logMsg(stopService('frontend'));
  logMsg(stopService('backend'));
}

async function actionRunSim(): Promise<void> {
  if (!sim.connected) { logMsg('{red-fg}Not connected to backend{/}'); return; }
  if (sim.extinct) { logMsg('{red-fg}Population extinct — use Reset first{/}'); return; }
  const seed = Number(await prompt('Seed', '42'));
  const pop = Number(await prompt('Population', '1000'));
  const speed = Number(await prompt('Speed (1/2/3)', '1'));
  logMsg(wsSend({ type: 'start', seed, initialPop: pop, speed }));
}

async function actionEnvConfig(): Promise<void> {
  const env = loadEnv();
  for (const entry of ENV_SCHEMA) {
    const current = env[entry.key] || entry.default;
    const display = entry.sensitive && current ? '***' : current;
    const val = await prompt(`${entry.key} (${entry.desc})`, display);
    if (val !== display) env[entry.key] = val;
    else if (current) env[entry.key] = current;
  }
  saveEnv(env);
  logMsg('{green-fg}Environment saved to .env{/}');
}

async function actionReport(): Promise<void> {
  const be = isRunning('backend');
  if (!be.running) { logMsg('{red-fg}Start backend first{/}'); return; }
  const date = await prompt('Date (blank=yesterday)', '');
  const port = getPort();
  const url = `http://localhost:${port}/api/report` + (date ? `?date=${date}` : '');
  logMsg(`{white-fg}POST ${url}{/}`);
  try {
    const resp = await fetch(url, { method: 'POST' });
    const body = await resp.text();
    logMsg(resp.ok ? `{green-fg}OK:{/} ${body}` : `{red-fg}${resp.status}:{/} ${body}`);
  } catch (e) {
    logMsg(`{red-fg}Failed:{/} ${(e as Error).message}`);
  }
}

async function actionResetDb(): Promise<void> {
  const be = isRunning('backend');
  if (be.running) { logMsg('{red-fg}Stop backend first{/}'); return; }
  const db = resolve(ROOT, getDbPath());
  if (!existsSync(db)) { logMsg(`{white-fg}DB not found: ${db}{/}`); return; }
  const ok = await confirm(`Delete ${db}? (y/n)`);
  if (ok) {
    rmSync(db, { force: true });
    rmSync(db + '-wal', { force: true });
    rmSync(db + '-shm', { force: true });
    logMsg('{green-fg}Database deleted{/}');
  } else {
    logMsg('{white-fg}Cancelled{/}');
  }
}

async function actionStatus(): Promise<void> {
  const env = loadEnv();
  logMsg('─── Status ───');
  const be = isRunning('backend'), fe = isRunning('frontend');
  logMsg(`Backend:  ${be.running ? `{green-fg}● PID ${be.pid}{/}` : '{white-fg}○ stopped{/}'}`);
  logMsg(`Frontend: ${fe.running ? `{green-fg}● PID ${fe.pid}{/}` : '{white-fg}○ stopped{/}'}`);
  logMsg(`SimWS:    ${sim.connected ? '{green-fg}connected{/}' : '{white-fg}disconnected{/}'}`);
  logMsg(`PORT=${env.PORT || '3001'}  DB=${env.DB_PATH || '(default)'}`);
  logMsg(`LLM_KEY=${env.LLM_API_KEY ? '{green-fg}set{/}' : '{white-fg}unset{/}'}  Model=${env.LLM_MODEL || 'deepseek/deepseek-chat'}`);
  logMsg(`ONEBOT=${env.ONEBOT_HTTP_URL || '{white-fg}unset{/}'}`);
}

async function actionSwitchModel(): Promise<void> {
  const env = loadEnv();
  const current = env.LLM_MODEL || 'deepseek/deepseek-chat';
  logMsg(`{white-fg}Current model: {bold}${current}{/}`);
  const model = await prompt('LLM_MODEL', current);
  if (model !== current) {
    env.LLM_MODEL = model;
    saveEnv(env);
    logMsg(`{green-fg}Model → {bold}${model}{/}`);
    try {
      const resp = await fetch(`http://localhost:${getPort()}/api/config/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (resp.ok) logMsg('{green-fg}Applied (hot reload){/}');
      else logMsg('{yellow-fg}Backend unreachable, will apply on next restart{/}');
    } catch {
      logMsg('{yellow-fg}Backend unreachable, will apply on next restart{/}');
    }
  }
}

// ─── action dispatch ─────────────────────────────────────────────────────────
let busy = false;
function withLock(fn: () => Promise<void>): void {
  if (busy) return;
  busy = true;
  inputActive = true;
  fn().catch(e => logMsg(`{red-fg}Error: ${e}{/}`)).finally(() => {
    busy = false; inputActive = false; refreshUI();
  });
}

function execByKey(key: string): void {
  switch (key) {
    case '1': withLock(actionStartAll); break;
    case '2': withLock(actionStopAll); break;
    case '3': logMsg(startService('backend')); connectSim(); refreshUI(); break;
    case '4': logMsg(startService('frontend')); startLogTail(); refreshUI(); break;
    case '5': disconnectSim(); logMsg(stopService('backend')); refreshUI(); break;
    case '6': logMsg(stopService('frontend')); refreshUI(); break;
    case 'r': withLock(actionRunSim); break;
    case 'p': logMsg(wsSend({ type: 'pause' })); refreshUI(); break;
    case 'v': {
      sim.speed = (sim.speed % 3) + 1;
      logMsg(wsSend({ type: 'setSpeed', speed: sim.speed }));
      refreshUI();
      break;
    }
    case 't': logMsg(wsSend({ type: 'step' })); refreshUI(); break;
    case 'x': withLock(async () => {
      const seed = Number(await prompt('Seed', '42'));
      const pop = Number(await prompt('Population', '1000'));
      logMsg(wsSend({ type: 'reset', seed, initialPop: pop }));
    }); break;
    case 'e': withLock(actionEnvConfig); break;
    case 'm': withLock(actionSwitchModel); break;
    case 'd': withLock(actionReport); break;
    case 'l': logBox.focus(); screen.render(); break;
    case 'w': withLock(actionResetDb); break;
    case 's': withLock(actionStatus); break;
    case 'q': disconnectSim(); stopLogTail(); screen.destroy(); process.exit(0); break;
  }
}

// ─── key bindings ────────────────────────────────────────────────────────────
// arrow navigation (guarded by inputActive)
screen.key(['up'], () => {
  if (inputActive) return;
  menuRow = (menuRow - 1 + menuGrid.length) % menuGrid.length;
  clampCol(); renderActions(); screen.render();
});
screen.key(['down'], () => {
  if (inputActive) return;
  menuRow = (menuRow + 1) % menuGrid.length;
  clampCol(); renderActions(); screen.render();
});
screen.key(['left'], () => {
  if (inputActive) return;
  if (menuCol > 0) menuCol--;
  renderActions(); screen.render();
});
screen.key(['right'], () => {
  if (inputActive) return;
  if (menuCol < menuGrid[menuRow].items.length - 1) menuCol++;
  renderActions(); screen.render();
});
screen.key(['enter'], () => {
  if (inputActive) return;
  const item = menuGrid[menuRow].items[menuCol];
  if (item) execByKey(item.key);
});

// hotkey direct access (guarded by inputActive)
for (const [hk] of hotkeyMap) {
  screen.key([hk], () => {
    if (inputActive) return;
    const pos = hotkeyMap.get(hk)!;
    menuRow = pos[0]; menuCol = pos[1];
    renderActions(); screen.render();
    execByKey(hk);
  });
}

screen.key(['C-c'], () => {
  disconnectSim(); stopLogTail(); screen.destroy(); process.exit(0);
});

// log panel: j/k scroll, Esc back
logBox.key(['j'], () => { logBox.scroll(1); screen.render(); });
logBox.key(['k'], () => { logBox.scroll(-1); screen.render(); });
logBox.key(['escape'], () => { screen.focusPop(); screen.render(); });

// ─── startup ─────────────────────────────────────────────────────────────────
refreshUI();
logMsg('{bold}Simu Xiuxian Console{/} ready');
logMsg('{white-fg}Arrow keys to navigate, Enter to select, or press hotkey directly{/}');

// auto-connect if backend already running
if (isRunning('backend').running) {
  connectSim();
  startLogTail();
}

// periodic refresh
setInterval(refreshUI, 3000);

screen.render();

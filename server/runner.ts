import type { EngineHooks, RichEvent, SimEvent, YearSummary } from '../src/types.js';
import { SimulationEngine } from '../src/engine/simulation.js';
import { clearSimData, getDB, getSimState, insertEvents, setSimState } from './db.js';
import { resetDisplayEventId, toDisplayEvent } from './events.js';
import { IdentityManager } from './identity.js';

const BATCH_SIZES: Record<number, number> = { 1: 100, 2: 500, 3: 1000 };
const TARGET_INTERVAL = 2000;

export type BroadcastMsg =
  | { type: 'tick'; tickId: number; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' };

export interface StateSnapshot {
  year: number;
  running: boolean;
  speed: number;
  summary: YearSummary | null;
}

export interface RunnerIO {
  broadcast(msg: BroadcastMsg): void;
  clientCount(): number;
}

export type Command =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number }
  | { type: 'ack'; tickId?: number };

function clampSpeed(s: number): number {
  return s === 2 || s === 3 ? s : 1;
}

export class Runner {
  private io: RunnerIO;
  private engine: SimulationEngine | null = null;
  private identity: IdentityManager | null = null;

  private speed = 1;
  private running = false;
  private extinct = false;

  private awaitingAck = false;
  private currentTickId = 0;
  private nextTickId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private seed = 42;
  private lastSummary: YearSummary | null = null;

  constructor(io: RunnerIO) {
    this.io = io;
  }

  getState(): StateSnapshot {
    if (!this.lastSummary && this.engine) this.lastSummary = this.engine.getSummary();
    return {
      year: this.engine?.year ?? 1,
      running: this.running,
      speed: this.speed,
      summary: this.lastSummary,
    };
  }

  restore(): boolean {
    const saved = getSimState();
    if (!saved) return false;
    try {
      this.seed = saved.seed;
      this.speed = clampSpeed(saved.speed);
      const engine = new SimulationEngine(this.seed, 1000);
      const target = Math.max(1, saved.current_year);
      if (target > 1) console.log(`[runner] replaying to year ${target}...`);
      while (engine.year < target) {
        if (engine.tickYear(false).isExtinct) break;
      }
      this.engine = engine;
      this.restoreMilestones(saved.highest_levels_ever);

      this.identity = new IdentityManager(this.seed);
      this.identity.rebuildFromDB();
      this.bindHooks();

      this.extinct = engine.aliveCount === 0;
      this.running = false;
      this.awaitingAck = false;
      this.lastSummary = engine.getSummary();
      resetDisplayEventId();
      console.log(`[runner] restored: year=${engine.year}, pop=${engine.aliveCount}`);
      return true;
    } catch (err) {
      console.error('[runner] restore failed:', err);
      this.engine = null;
      this.identity = null;
      return false;
    }
  }

  dispatch(cmd: Command): void {
    switch (cmd.type) {
      case 'start': {
        if (this.extinct) { this.io.broadcast({ type: 'paused', reason: 'extinction' }); return; }
        this.speed = clampSpeed(cmd.speed);
        if (!this.engine) this.initEngine(cmd.seed, cmd.initialPop);
        if (this.running) return;
        this.running = true;
        this.awaitingAck = false;
        this.currentTickId = 0;
        this.runBatch();
        return;
      }
      case 'pause': {
        this.stop();
        this.saveState();
        this.io.broadcast({ type: 'paused', reason: this.extinct ? 'extinction' : 'manual' });
        return;
      }
      case 'step': {
        if (this.running) return;
        if (this.extinct) { this.io.broadcast({ type: 'paused', reason: 'extinction' }); return; }
        if (!this.engine) return;
        const tick = this.engine.tickYear(true);
        const summary = this.engine.getSummary();
        this.lastSummary = summary;
        this.persistBatch(tick.events);
        resetDisplayEventId();
        const events = tick.events.map(e => toDisplayEvent(e));
        const tickId = this.nextTickId++;
        this.io.broadcast({ type: 'tick', tickId, summaries: [summary], events });
        if (tick.isExtinct) {
          this.extinct = true;
          this.io.broadcast({ type: 'paused', reason: 'extinction' });
        }
        return;
      }
      case 'setSpeed': {
        this.speed = clampSpeed(cmd.speed);
        return;
      }
      case 'reset': {
        this.stop();
        clearSimData();
        this.initEngine(cmd.seed, cmd.initialPop);
        this.nextTickId = 1;
        this.saveState();
        this.io.broadcast({ type: 'reset-done' });
        return;
      }
      case 'ack': {
        if (!this.awaitingAck || !this.running || this.extinct) return;
        if (typeof cmd.tickId !== 'number' || cmd.tickId !== this.currentTickId) return;
        this.awaitingAck = false;
        this.currentTickId = 0;
        setTimeout(() => this.runBatch(), 0);
        return;
      }
    }
  }

  onClientDisconnect(): void {
    if (!this.awaitingAck || !this.running || this.extinct) return;
    if (this.io.clientCount() > 0) return;
    this.awaitingAck = false;
    this.currentTickId = 0;
    setTimeout(() => this.runBatch(), 0);
  }

  private initEngine(seed: number, initialPop: number): void {
    this.seed = seed;
    this.engine = new SimulationEngine(seed, Math.max(1, Math.floor(initialPop)));
    this.identity = new IdentityManager(seed);
    this.bindHooks();
    this.extinct = false;
    this.lastSummary = this.engine.getSummary();
    resetDisplayEventId();
  }

  private bindHooks(): void {
    if (!this.engine || !this.identity) return;
    const id = this.identity;
    const hooks: EngineHooks = {
      onPromotion(c, lv, y) { id.onPromotion(c, lv, y); },
      onCombatResult(w, l, d, y) { id.onCombatResult(w, l, d, y); },
      onExpiry(c, y) { id.onExpiry(c, y); },
      getName(cid) { return id.getActive(cid)?.name; },
    };
    this.engine.hooks = hooks;
  }

  private stop(): void {
    this.running = false;
    this.awaitingAck = false;
    this.currentTickId = 0;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private runBatch(): void {
    const engine = this.engine;
    if (!engine || !this.running || this.extinct || this.awaitingAck) return;

    const batchSize = BATCH_SIZES[this.speed] ?? 100;
    const t0 = Date.now();
    const stride = Math.max(1, Math.ceil(batchSize / 50));
    const summaries: YearSummary[] = [];
    const allEvents: RichEvent[] = [];
    let lastTickEvents: RichEvent[] = [];

    for (let i = 0; i < batchSize; i++) {
      const tick = engine.tickYear(true);
      if (i % stride === 0 || i === batchSize - 1 || tick.isExtinct) {
        summaries.push(engine.getSummary());
      }
      for (const e of tick.events) allEvents.push(e);
      lastTickEvents = tick.events;
      if (tick.isExtinct) { this.extinct = true; this.running = false; break; }
    }

    if (summaries.length) this.lastSummary = summaries[summaries.length - 1];
    this.persistBatch(allEvents);

    resetDisplayEventId();
    const displayEvents = lastTickEvents.map(e => toDisplayEvent(e));
    const tickId = this.nextTickId++;
    const tickMsg: BroadcastMsg = { type: 'tick', tickId, summaries, events: displayEvents };

    const emit = (): void => {
      this.io.broadcast(tickMsg);
      if (this.extinct) {
        this.io.broadcast({ type: 'paused', reason: 'extinction' });
        return;
      }
      if (this.io.clientCount() === 0) {
        setTimeout(() => this.runBatch(), 0);
        return;
      }
      this.awaitingAck = true;
      this.currentTickId = tickId;
    };

    if (this.extinct) { emit(); return; }

    const delay = TARGET_INTERVAL - (Date.now() - t0);
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.running || this.extinct) return;
        emit();
      }, delay);
    } else {
      emit();
    }
  }

  private persistBatch(events: RichEvent[]): void {
    const engine = this.engine;
    if (!engine) return;
    const now = Math.floor(Date.now() / 1000);
    const rows = events
      .filter(e => e.newsRank !== 'C')
      .map(e => ({ year: e.year, type: e.type, rank: e.newsRank, real_ts: now, payload: JSON.stringify(e) }));

    try {
      getDB().transaction(() => {
        this.identity?.flushToDB();
        insertEvents(rows);
        setSimState({
          currentYear: engine.year,
          seed: this.seed,
          speed: this.speed,
          running: this.running && !this.extinct,
          highestLevelsEver: JSON.stringify(engine.milestones.levelEverPopulated),
        });
      })();
    } catch (err) {
      console.error('[runner] persist failed:', err);
    }
  }

  private saveState(): void {
    if (!this.engine) return;
    try {
      setSimState({
        currentYear: this.engine.year,
        seed: this.seed,
        speed: this.speed,
        running: this.running && !this.extinct,
        highestLevelsEver: JSON.stringify(this.engine.milestones.levelEverPopulated),
      });
    } catch (err) {
      console.error('[runner] save state failed:', err);
    }
  }

  private restoreMilestones(raw: string): void {
    const m = this.engine?.milestones;
    if (!m) return;
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const len = Math.min(m.levelEverPopulated.length, arr.length);
      for (let i = 0; i < len; i++) m.levelEverPopulated[i] = !!arr[i];
      m.levelEverPopulated[0] = true;
      let h = 0;
      for (let i = 1; i < m.levelEverPopulated.length; i++) if (m.levelEverPopulated[i]) h = i;
      m.highestLevelEverReached = h;
    } catch { /* malformed state */ }
  }
}

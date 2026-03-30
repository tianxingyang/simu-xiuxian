import type { EngineHooks, RichEvent, SimEvent, YearSummary } from '../src/types.js';
import { SimulationEngine } from '../src/engine/simulation.js';
import { clearSimData, getDB, getSimState, insertEvents, insertWorldSnapshot, setSimState } from './db.js';
import { resetDisplayEventId, toDisplayEvent } from './events.js';
import { runEviction } from './eviction.js';
import { IdentityManager } from './identity.js';
import { getLogger } from './logger.js';

const log = getLogger('runner');

const BATCH_SIZES: Record<number, number> = { 1: 1, 2: 3, 3: 5 };
const TARGET_INTERVAL = 1000;
const ACK_TIMEOUT = TARGET_INTERVAL;
const SNAPSHOT_INTERVAL = 50;

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
  private lastSnapshotYear = 0;

  private awaitingAck = false;
  private currentTickId = 0;
  private nextTickId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

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

  getWorldContext(): import('./ipc.js').WorldContext | null {
    if (!this.engine) return null;
    return this.engine.getWorldContext();
  }

  getEngine(): SimulationEngine | null {
    return this.engine;
  }

  getIdentity(): IdentityManager | null {
    return this.identity;
  }

  restore(): boolean {
    const saved = getSimState();
    if (!saved) return false;
    try {
      this.seed = saved.seed;
      this.speed = clampSpeed(saved.speed);

      if (saved.snapshot) {
        this.engine = SimulationEngine.deserialize(saved.snapshot);
        log.info(`snapshot restored: year=${this.engine.year}, pop=${this.engine.aliveCount}`);
      } else {
        const engine = new SimulationEngine(this.seed, 1000);
        const target = Math.max(1, saved.current_year);
        if (target > 1) log.info(`replaying to year ${target}...`);
        while (engine.year < target) {
          if (engine.tickYear(false).isExtinct) break;
        }
        this.engine = engine;
        this.restoreMilestones(saved.highest_levels_ever);
        log.info(`replay restored: year=${engine.year}, pop=${engine.aliveCount}`);
      }

      this.identity = new IdentityManager(this.seed);
      this.identity.rebuildFromDB();
      this.bindHooks();

      this.extinct = this.engine.aliveCount === 0 && this.engine.households.count === 0;
      this.running = false;
      this.awaitingAck = false;
      this.lastSummary = this.engine.getSummary();
      this.lastSnapshotYear = Math.floor(this.engine.year / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
      resetDisplayEventId();
      if (!saved.snapshot) this.saveState();
      return true;
    } catch (err) {
      log.error('restore failed:', err);
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
        this.clearAckTimer();
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
    const engine = this.engine;
    id.settlementNameResolver = (sid) => engine.settlements.getSettlement(sid)?.name;
    const hooks: EngineHooks = {
      onPromotion(c, lv, y) { id.onPromotion(c, lv, y); },
      onCombatResult(w, l, d, y) { id.onCombatResult(w, l, d, y); },
      onExpiry(c, y) { id.onExpiry(c, y); },
      onTribulation(c, outcome, y) { id.onTribulation(c, outcome, y); },
      getName(cid) { return id.getActive(cid)?.name; },
      getSettlementName(sid) { return engine.settlements.getSettlement(sid)?.name; },
      getMemorySnapshot(cid) {
        const mem = engine.memories[cid];
        if (!mem) return undefined;
        return {
          confidence: mem.confidence, caution: mem.caution,
          ambition: mem.ambition, bloodlust: mem.bloodlust,
          rootedness: mem.rootedness, breakthroughFear: mem.breakthroughFear,
          combatWins: mem.combatWins, combatLosses: mem.combatLosses,
          kills: mem.kills, breakthroughAttempts: mem.breakthroughAttempts,
          breakthroughSuccesses: mem.breakthroughSuccesses, heavyInjuries: mem.heavyInjuries,
          firstCombatYear: mem.milestones.firstCombatYear,
          firstBreakthroughYear: mem.milestones.firstBreakthroughYear,
          firstKillYear: mem.milestones.firstKillYear,
          worstDefeatOpponentId: mem.milestones.worstDefeatOpponentId,
          greatestVictoryOpponentId: mem.milestones.greatestVictoryOpponentId,
        };
      },
    };
    this.engine.hooks = hooks;
  }

  private stop(): void {
    this.running = false;
    this.awaitingAck = false;
    this.currentTickId = 0;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.clearAckTimer();
  }

  private clearAckTimer(): void {
    if (this.ackTimer) { clearTimeout(this.ackTimer); this.ackTimer = null; }
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
        setTimeout(() => this.runBatch(), 50);
        return;
      }
      this.awaitingAck = true;
      this.currentTickId = tickId;
      this.ackTimer = setTimeout(() => {
        if (!this.awaitingAck || !this.running) return;
        log.warn(`ack timeout (tickId=${tickId}), continuing`);
        this.awaitingAck = false;
        this.currentTickId = 0;
        this.runBatch();
      }, ACK_TIMEOUT);
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
    const namedIds = this.identity ? new Set([...this.identity['active'].keys()]) : new Set<number>();
    const rows = events
      .filter(e => e.newsRank !== 'C')
      .map(e => {
        const cids = this.getNamedCultivatorIds(e, namedIds);
        return {
          year: e.year, type: e.type, rank: e.newsRank, real_ts: now,
          payload: JSON.stringify(e), protected: cids.length > 0 ? 1 : 0,
          cultivatorIds: cids.length > 0 ? cids : undefined,
        };
      });

    try {
      const snapshot = engine.serialize();
      const snapshotYear = Math.floor(engine.year / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
      const needWorldSnapshot = snapshotYear > this.lastSnapshotYear && engine.year >= SNAPSHOT_INTERVAL;
      getDB().transaction(() => {
        this.identity?.flushToDB();
        insertEvents(rows);
        setSimState({
          currentYear: engine.year,
          seed: this.seed,
          speed: this.speed,
          running: this.running && !this.extinct,
          highestLevelsEver: JSON.stringify(engine.milestones.levelEverPopulated),
          snapshot,
        });
        if (needWorldSnapshot) {
          const ctx = engine.getWorldContext();
          insertWorldSnapshot(snapshotYear, JSON.stringify(ctx));
          this.lastSnapshotYear = snapshotYear;
        }
      })();
      runEviction(engine.year);
    } catch (err) {
      log.error('persist failed:', err);
    }
  }

  private getNamedCultivatorIds(event: RichEvent, namedIds: Set<number>): number[] {
    const ids: number[] = [];
    switch (event.type) {
      case 'combat':
        if (namedIds.has(event.winner.id)) ids.push(event.winner.id);
        if (namedIds.has(event.loser.id)) ids.push(event.loser.id);
        break;
      case 'promotion':
      case 'expiry':
      case 'breakthrough_fail':
      case 'tribulation':
        if (namedIds.has(event.subject.id)) ids.push(event.subject.id);
        break;
      case 'milestone':
        if (namedIds.has(event.detail.cultivatorId)) ids.push(event.detail.cultivatorId);
        break;
      case 'disaster':
        break;
    }
    return ids;
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
        snapshot: this.engine.serialize(),
      });
    } catch (err) {
      log.error('save state failed:', err);
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

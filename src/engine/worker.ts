import type { FromWorker, RichEvent, SimEvent, ToWorker, YearSummary } from '../types';
import { LEVEL_NAMES } from '../constants';
import { SimulationEngine } from './simulation';
import { profiler } from './profiler';

declare const self: DedicatedWorkerGlobalScope;

const BATCH_SIZES: Record<number, number> = { 1: 100, 2: 500, 3: 1000 };

const TARGET_INTERVAL = 2000;

let engine: SimulationEngine | null = null;
let speed = 1;
let running = false;
let extinct = false;
let awaitingAck = false;
let pendingPost: ReturnType<typeof setTimeout> | 0 = 0;

function post(msg: FromWorker): void {
  self.postMessage(msg);
}

function stop(): void {
  running = false;
  awaitingAck = false;
  if (pendingPost) {
    clearTimeout(pendingPost);
    pendingPost = 0;
  }
}

function richToSimEvent(e: RichEvent, id: number): SimEvent {
  switch (e.type) {
    case 'combat': {
      const lv = Math.max(e.winner.level, e.loser.level);
      return { id, year: e.year, type: 'combat', actorLevel: lv,
        detail: `${LEVEL_NAMES[lv]}对决，获得机缘${e.absorbed}` };
    }
    case 'promotion':
      return { id, year: e.year, type: 'promotion', actorLevel: e.toLevel,
        detail: `${LEVEL_NAMES[e.fromLevel]}→${LEVEL_NAMES[e.toLevel]}（${e.cause === 'natural' ? '自然' : '战斗'}晋升）` };
    case 'expiry':
      return { id, year: e.year, type: 'expiry', actorLevel: e.level,
        detail: `${LEVEL_NAMES[e.level]}寿元耗尽` };
    case 'milestone':
      return { id, year: e.year, type: 'promotion', actorLevel: e.detail.level,
        detail: e.kind === 'first_at_level'
          ? `天地异象！首位${LEVEL_NAMES[e.detail.level]}修士出现`
          : `${LEVEL_NAMES[e.detail.level]}断代` };
    case 'breakthrough_fail':
      return {
        id,
        year: e.year,
        type: 'breakthrough_fail',
        actorLevel: e.subject.level,
        detail: `${LEVEL_NAMES[e.subject.level]}破境失败（${e.penalty === 'injury' ? '受伤' : e.penalty === 'cultivation_loss' ? '修为受损' : '冷却'}）`,
      };
    case 'tribulation':
      return {
        id,
        year: e.year,
        type: 'tribulation',
        actorLevel: e.subject.level,
        detail: e.outcome === 'ascension'
          ? `${LEVEL_NAMES[e.subject.level]}渡劫成功，飞升离去！`
          : `${LEVEL_NAMES[e.subject.level]}渡劫失败，陨落天劫之下`,
      };
  }
}

function runBatch(): void {
  if (!engine || !running || extinct || awaitingAck) return;

  const batchSize = BATCH_SIZES[speed] ?? 100;
  const startTime = performance.now();
  const summaries: YearSummary[] = [];
  const events: SimEvent[] = [];
  const summaryStride = Math.max(1, Math.ceil(batchSize / 50));

  const shouldProfile = engine.year % (batchSize * 10) === 0;
  if (shouldProfile) {
    profiler.reset();
    profiler.enable();
  }

  for (let i = 0; i < batchSize; i++) {
    const tick = engine.tickYear(i === batchSize - 1);
    const isExtinct = tick.isExtinct;
    if (i % summaryStride === 0 || i === batchSize - 1 || isExtinct) {
      summaries.push(engine.getSummary());
    }
    if (i === batchSize - 1) {
      let eid = 1;
      for (const e of tick.events) events.push(richToSimEvent(e, eid++));
    }
    if (isExtinct) {
      extinct = true;
      running = false;
      break;
    }
  }

  if (shouldProfile) {
    profiler.disable();
    console.log(`\n[Performance Profile] Year ${engine.year}, Speed ${speed}, Batch ${batchSize}, Population ${engine.aliveCount}`);
    profiler.printResults();
  }

  const msg: FromWorker = { type: 'tick', summaries, events };

  if (extinct) {
    self.postMessage(msg);
    post({ type: 'paused', reason: 'extinction' });
    return;
  }

  const delay = TARGET_INTERVAL - (performance.now() - startTime);
  if (delay > 0) {
    pendingPost = setTimeout(() => {
      pendingPost = 0;
      if (!running || extinct) return;
      self.postMessage(msg);
      awaitingAck = true;
    }, delay);
  } else {
    self.postMessage(msg);
    awaitingAck = true;
  }
}

self.onmessage = (e: MessageEvent<ToWorker>): void => {
  const msg = e.data;

  switch (msg.type) {
    case 'start': {
      if (extinct) {
        post({ type: 'paused', reason: 'extinction' });
        return;
      }
      speed = msg.speed;
      if (!engine) {
        engine = new SimulationEngine(msg.seed, msg.initialPop);
      }
      if (running) return;
      running = true;
      awaitingAck = false;
      runBatch();
      return;
    }

    case 'pause': {
      stop();
      post({ type: 'paused', reason: extinct ? 'extinction' : 'manual' });
      return;
    }

    case 'step': {
      if (running) return;
      if (extinct) {
        post({ type: 'paused', reason: 'extinction' });
        return;
      }
      if (!engine) return;
      const tick = engine.tickYear(true);
      const summary = engine.getSummary();
      let eid = 1;
      const simEvents = tick.events.map(e => richToSimEvent(e, eid++));
      post({ type: 'tick', summaries: [summary], events: simEvents });
      if (tick.isExtinct) {
        extinct = true;
        post({ type: 'paused', reason: 'extinction' });
      }
      return;
    }

    case 'ack': {
      if (awaitingAck && running && !extinct) {
        awaitingAck = false;
        setTimeout(runBatch, 0);
      }
      return;
    }

    case 'setSpeed': {
      speed = msg.speed;
      return;
    }

    case 'reset': {
      stop();
      extinct = false;
      engine = new SimulationEngine(msg.seed, msg.initialPop);
      post({ type: 'reset-done' });
      return;
    }

    default:
      return;
  }
};

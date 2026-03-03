import type { FromWorker, SimEvent, ToWorker, YearSummary } from '../types';
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
let pendingPost = 0;

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

function runBatch(): void {
  if (!engine || !running || extinct || awaitingAck) return;

  const batchSize = BATCH_SIZES[speed] ?? 100;
  const startTime = performance.now();
  const summaries: YearSummary[] = [];
  const events: SimEvent[] = [];
  const summaryStride = Math.max(1, Math.ceil(batchSize / 50));

  // 启用性能分析（每10个batch分析一次）
  const shouldProfile = engine.year % (batchSize * 10) === 0;
  if (shouldProfile) {
    profiler.reset();
    profiler.enable();
  }

  for (let i = 0; i < batchSize; i++) {
    const collectEvents = i === batchSize - 1;
    const tick = engine.tickYear(collectEvents);
    const isExtinct = tick.isExtinct;
    if (i % summaryStride === 0 || i === batchSize - 1 || isExtinct) {
      summaries.push(engine.getSummary());
    }
    if (collectEvents) {
      for (const e of tick.events) events.push(e);
    }
    if (isExtinct) {
      extinct = true;
      running = false;
      break;
    }
  }

  // 输出性能分析结果
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
      const tick = engine.tickYear();
      const summary = engine.getSummary();
      post({ type: 'tick', summaries: [summary], events: tick.events });
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
  }
};

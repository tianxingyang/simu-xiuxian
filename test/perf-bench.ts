import { SimulationEngine } from '../src/engine/simulation';

const SEED = 42;
const INITIAL_POP = 1000;
const WARMUP_YEARS = 200;
const MEASURE_YEARS = 600;
const BATCH_SIZE = 1000;
const BATCHES = 6;
const ROUNDS = 7;

interface SampleSummary {
  median: number;
  mean: number;
  min: number;
  max: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function summarize(values: number[]): SampleSummary {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    median: median(values),
    mean: total / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function printSummary(label: string, values: number[], extra = ''): void {
  const summary = summarize(values);
  const suffix = extra ? `  ${extra}` : '';
  console.log(
    `${label.padEnd(28)} median=${summary.median.toFixed(3)}ms/year` +
    `  mean=${summary.mean.toFixed(3)}` +
    `  min=${summary.min.toFixed(3)}` +
    `  max=${summary.max.toFixed(3)}${suffix}`,
  );
}

function warmupEngine(): SimulationEngine {
  const engine = new SimulationEngine(SEED, INITIAL_POP);
  for (let year = 0; year < WARMUP_YEARS; year++) engine.tickYear(false);
  return engine;
}

function benchTickYear(collectEvents: boolean): { perYear: number[]; avgEvents: number[] } {
  const perYear: number[] = [];
  const avgEvents: number[] = [];

  for (let round = 0; round < ROUNDS; round++) {
    const engine = warmupEngine();
    let eventCount = 0;
    const t0 = performance.now();
    for (let year = 0; year < MEASURE_YEARS; year++) {
      const tick = engine.tickYear(collectEvents);
      eventCount += tick.events.length;
    }
    const elapsed = performance.now() - t0;
    perYear.push(elapsed / MEASURE_YEARS);
    avgEvents.push(eventCount / MEASURE_YEARS);
  }

  return { perYear, avgEvents };
}

function benchWorkerBatchStyle(): { perYear: number[]; lastTickEvents: number[] } {
  const perYear: number[] = [];
  const lastTickEvents: number[] = [];

  for (let round = 0; round < ROUNDS; round++) {
    const engine = warmupEngine();
    const stride = Math.max(1, Math.ceil(BATCH_SIZE / 50));
    let processedYears = 0;
    let totalLastTickEvents = 0;
    const t0 = performance.now();

    outer: for (let batch = 0; batch < BATCHES; batch++) {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const collectEvents = i === BATCH_SIZE - 1;
        const tick = engine.tickYear(collectEvents);
        if (i % stride === 0 || i === BATCH_SIZE - 1 || tick.isExtinct) {
          engine.getSummary();
        }
        if (collectEvents || tick.isExtinct) totalLastTickEvents += tick.events.length;
        processedYears++;
        if (tick.isExtinct) break outer;
      }
    }

    const elapsed = performance.now() - t0;
    perYear.push(elapsed / processedYears);
    lastTickEvents.push(totalLastTickEvents / BATCHES);
  }

  return { perYear, lastTickEvents };
}

console.log('\n🔥 Performance Bench\n');
console.log(
  `seed=${SEED}, initialPop=${INITIAL_POP}, warmup=${WARMUP_YEARS}, ` +
  `measureYears=${MEASURE_YEARS}, rounds=${ROUNDS}`,
);
console.log(`workerBatch: batchSize=${BATCH_SIZE}, batches=${BATCHES}\n`);

const tickWithoutEvents = benchTickYear(false);
printSummary(
  'tickYear(events=false)',
  tickWithoutEvents.perYear,
  `events/year=${summarize(tickWithoutEvents.avgEvents).median.toFixed(1)}`,
);

const tickWithEvents = benchTickYear(true);
printSummary(
  'tickYear(events=true)',
  tickWithEvents.perYear,
  `events/year=${summarize(tickWithEvents.avgEvents).median.toFixed(1)}`,
);

const workerBatch = benchWorkerBatchStyle();
printSummary(
  'worker batch (last tick)',
  workerBatch.perYear,
  `lastTickEvents/batch=${summarize(workerBatch.lastTickEvents).median.toFixed(1)}`,
);


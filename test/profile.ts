import { SimulationEngine } from '../src/engine/simulation';
import { profiler } from '../src/engine/profiler';

const SEED = 42;
const INITIAL_POP = 1000;
const WARMUP_YEARS = 200;
const PROFILE_YEARS = 1000;

// Warm up to reach steady state
const engine = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP_YEARS; i++) engine.tickYear(false);

const warmupPop = engine.getSummary().totalPopulation;
console.log(`Warmup done: year=${engine.year}, pop=${warmupPop}`);

// Profile run
profiler.reset();
profiler.enable();

const t0 = performance.now();
const popSamples: number[] = [];

for (let i = 0; i < PROFILE_YEARS; i++) {
  const collectEvents = i % 100 === 0;
  engine.tickYear(collectEvents);
  if (i % 100 === 0) {
    const s = engine.getSummary();
    popSamples.push(s.totalPopulation);
  }
}

const elapsed = performance.now() - t0;
profiler.disable();

const finalSummary = engine.getSummary();

console.log(`\nProfile: ${PROFILE_YEARS} years in ${elapsed.toFixed(1)}ms (${(elapsed / PROFILE_YEARS).toFixed(3)}ms/year)`);
console.log(`Pop: ${warmupPop} -> ${finalSummary.totalPopulation}, peak=${Math.max(...popSamples)}`);
console.log();

profiler.printResults();

// Memory snapshot
const mem = process.memoryUsage();
console.log(`\nMemory: rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB, heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`);
console.log(`Cultivators alive: ${engine.aliveCount}, array capacity: ${engine.nextId}, freeSlots: ${engine.freeSlots.length}`);

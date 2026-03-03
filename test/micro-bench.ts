import { SimulationEngine } from '../src/engine/simulation';

const SEED = 42;
const INITIAL_POP = 1000;
const WARMUP = 200;
const ROUNDS = 500;

const engine = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP; i++) engine.tickYear(false);

const pop = engine.getSummary().totalPopulation;
console.log(`Steady state: year=${engine.year}, pop=${pop}\n`);

// Microbenchmark: isolate each phase
function bench(label: string, fn: () => void, iterations = ROUNDS): void {
  // warmup
  for (let i = 0; i < 10; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - t0;
  console.log(`${label.padEnd(35)} ${(elapsed / iterations).toFixed(3)}ms/iter  total=${elapsed.toFixed(1)}ms`);
}

// Full tick
bench('tickYear(events=false)', () => engine.tickYear(false));
bench('tickYear(events=true)', () => engine.tickYear(true));

// Isolate purgeDead cost
const engine2 = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP; i++) engine2.tickYear(false);

// Measure Map iteration cost
console.log('\n--- Map iteration analysis ---');
const mapSize = engine2.cultivators.size;
console.log(`cultivators.size = ${mapSize}`);

let dummy = 0;
bench('Map.values() iterate', () => {
  for (const c of engine2.cultivators.values()) dummy += c.age;
});

bench('Map entries iterate', () => {
  for (const [, c] of engine2.cultivators) dummy += c.age;
});

// Measure Set operations
console.log('\n--- Set operations analysis ---');
const testSet = new Set<number>();
for (let i = 0; i < 20000; i++) testSet.add(i);

bench('Set iterate 20k', () => {
  let s = 0;
  for (const id of testSet) s += id;
  dummy += s;
});

bench('Set.has() x 20k', () => {
  for (let i = 0; i < 20000; i++) dummy += testSet.has(i) ? 1 : 0;
});

// Measure prng cost
console.log('\n--- PRNG analysis ---');
const prng = engine2.prng;
bench('prng() x 20k calls', () => {
  for (let i = 0; i < 20000; i++) dummy += prng();
});

// Measure threshold() calls
console.log('\n--- threshold() cost ---');
const { threshold } = await import('../src/constants');
bench('threshold() x 20k', () => {
  for (let i = 0; i < 20000; i++) dummy += threshold(i % 8);
});

// Measure effectiveCourage cost
const { effectiveCourage } = await import('../src/constants');
const sampleCultivators = [...engine2.cultivators.values()].slice(0, 1000);
bench('effectiveCourage() x 1k', () => {
  for (const c of sampleCultivators) dummy += effectiveCourage(c);
});

// Allocation pressure: object creation in combat
console.log('\n--- Allocation analysis ---');
const before = process.memoryUsage();
const engine3 = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < 500; i++) engine3.tickYear(true);
const after = process.memoryUsage();
console.log(`Heap growth over 500 years (with events): ${((after.heapUsed - before.heapUsed) / 1024 / 1024).toFixed(1)}MB`);

const before2 = process.memoryUsage();
const engine4 = new SimulationEngine(SEED + 1, INITIAL_POP);
for (let i = 0; i < 500; i++) engine4.tickYear(false);
const after2 = process.memoryUsage();
console.log(`Heap growth over 500 years (no events):   ${((after2.heapUsed - before2.heapUsed) / 1024 / 1024).toFixed(1)}MB`);

// Measure defeatedSet allocation cost
console.log('\n--- defeatedSet (Set<number>) cost ---');
bench('new Set<number>() + 500 adds', () => {
  const s = new Set<number>();
  for (let i = 0; i < 500; i++) s.add(i);
  dummy += s.size;
});

bench('new Set<number>() + 2000 adds', () => {
  const s = new Set<number>();
  for (let i = 0; i < 2000; i++) s.add(i);
  dummy += s.size;
});

// Array.indexOf in combat loser removal
console.log('\n--- Array.indexOf cost (combat loser removal) ---');
const arr10k = Array.from({ length: 10000 }, (_, i) => i);
bench('indexOf in 10k array x 100', () => {
  for (let i = 0; i < 100; i++) {
    const idx = arr10k.indexOf(Math.floor(Math.random() * 10000));
    if (idx !== -1) { arr10k[idx] = arr10k[arr10k.length - 1]; arr10k.pop(); arr10k.push(idx); }
  }
});

// GC pressure measurement
console.log('\n--- GC analysis ---');
if (typeof globalThis.gc === 'function') {
  globalThis.gc();
  const t0 = performance.now();
  globalThis.gc();
  console.log(`Manual GC: ${(performance.now() - t0).toFixed(1)}ms`);
} else {
  console.log('Run with --expose-gc for GC measurement');
}

void dummy;
console.log('\nDone.');

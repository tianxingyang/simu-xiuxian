import { Session } from 'node:inspector/promises';
import { writeFile } from 'node:fs/promises';
import { SimulationEngine } from '../src/engine/simulation';

const SEED = 42;
const INITIAL_POP = 1000;
const WARMUP_YEARS = 200;
const PROFILE_YEARS = 500;

const session = new Session();
session.connect();

// Warm up
const engine = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP_YEARS; i++) engine.tickYear(false);
console.log(`Warmup done: year=${engine.year}, pop=${engine.getSummary().totalPopulation}`);

// Start V8 CPU profiling
await session.post('Profiler.enable');
await session.post('Profiler.start');
console.log('V8 CPU profiling started...');

const t0 = performance.now();
for (let i = 0; i < PROFILE_YEARS; i++) {
  engine.tickYear(i % 100 === 0);
}
const elapsed = performance.now() - t0;

// Stop profiling
const { profile } = await session.post('Profiler.stop');
await session.post('Profiler.disable');
session.disconnect();

const outPath = 'test/cpu-profile.cpuprofile';
await writeFile(outPath, JSON.stringify(profile));
console.log(`\nProfile: ${PROFILE_YEARS} years in ${elapsed.toFixed(1)}ms (${(elapsed / PROFILE_YEARS).toFixed(3)}ms/year)`);
console.log(`Saved to ${outPath} — open in Chrome DevTools or VS Code`);

// Parse top hotspots from profile data
type ProfileNode = typeof profile.nodes[0];
const nodes = profile.nodes;
const nodeMap = new Map<number, ProfileNode>();
for (const n of nodes) nodeMap.set(n.id, n);

// Compute self time via sample/delta distribution
const selfTimes = new Map<number, number>();
const samples = profile.samples!;
const deltas = profile.timeDeltas!;
for (let i = 0; i < samples.length; i++) {
  const nodeId = samples[i];
  const dt = i < deltas.length ? deltas[i] : 0;
  selfTimes.set(nodeId, (selfTimes.get(nodeId) ?? 0) + dt);
}

// Aggregate by function name
const funcTimes = new Map<string, { self: number; url: string; line: number }>();
for (const [nodeId, time] of selfTimes) {
  const node = nodeMap.get(nodeId)!;
  const fn = node.callFrame;
  const key = `${fn.functionName || '(anonymous)'}@${fn.url}:${fn.lineNumber}`;
  const existing = funcTimes.get(key);
  if (existing) {
    existing.self += time;
  } else {
    funcTimes.set(key, { self: time, url: fn.url, line: fn.lineNumber });
  }
}

const totalSampled = [...selfTimes.values()].reduce((a, b) => a + b, 0);
const sorted = [...funcTimes.entries()]
  .sort((a, b) => b[1].self - a[1].self)
  .slice(0, 25);

console.log('\n=== V8 CPU Profile Top Functions (self time) ===');
console.log('Function'.padEnd(50), 'Self(ms)'.padStart(10), '%'.padStart(8));
console.log('-'.repeat(70));
for (const [name, data] of sorted) {
  const ms = data.self / 1000;
  const pct = (data.self / totalSampled * 100);
  console.log(name.substring(0, 50).padEnd(50), ms.toFixed(1).padStart(10), pct.toFixed(1).padStart(7) + '%');
}
console.log('='.repeat(70));

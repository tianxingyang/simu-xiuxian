import { SimulationEngine } from '../src/engine/simulation';
import { processEncounters } from '../src/engine/combat';
import { LEVEL_COUNT } from '../src/constants';

const SEED = 42;
const INITIAL_POP = 1000;
const WARMUP = 200;

const engine = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP; i++) engine.tickYear(false);

const pop = engine.getSummary().totalPopulation;
console.log(`Steady state: year=${engine.year}, pop=${pop}\n`);

// Analyze combat loop iteration structure
console.log('=== Combat Loop Structure Analysis ===\n');

// Snapshot one tick's combat data
engine.resetYearCounters();
engine.spawnCultivators(engine.yearlySpawn);
engine.tickCultivators();

// Rebuild what processEncounters sees
const snapshotNk = new Array(LEVEL_COUNT).fill(0);
let snapshotN = 0;
for (const [level, ids] of engine.levelGroups) {
  if (level === 0) continue;
  let eligible = 0;
  for (const id of ids) {
    const c = engine.cultivators.get(id)!;
    if (c.injuredUntil > engine.year) continue;
    eligible++;
  }
  snapshotNk[level] = eligible;
  snapshotN += eligible;
}

console.log('Level population (eligible for combat):');
for (let lv = 0; lv < LEVEL_COUNT; lv++) {
  if (snapshotNk[lv] > 0 || lv === 0) {
    console.log(`  Lv${lv}: ${snapshotNk[lv]} eligible, encounter_prob = ${snapshotN > 0 ? (snapshotNk[lv] / snapshotN * 100).toFixed(2) : 0}%`);
  }
}
console.log(`  Total eligible (snapshotN): ${snapshotN}`);

// Simulate the combat loop probability filter
let totalIterations = 0;
let passedProbFilter = 0;
let foundOpponent = 0;

// Build alive ids like processEncounters does
const aliveIds: number[] = [];
for (let level = 1; level < LEVEL_COUNT; level++) {
  for (const id of engine.aliveLevelIds.get(level)!) {
    aliveIds.push(id);
  }
}

for (const id of aliveIds) {
  const c = engine.cultivators.get(id)!;
  if (!c.alive || c.injuredUntil > engine.year) continue;

  totalIterations++;
  const nk = snapshotNk[c.level];
  if (nk <= 1) continue;

  const encounterProb = nk / snapshotN;
  passedProbFilter++;

  const arr = engine.levelArrayCache.get(c.level);
  if (arr && arr.length > 0) foundOpponent++;
}

console.log(`\nCombat loop analysis:`);
console.log(`  Total alive non-Lv0:   ${aliveIds.length}`);
console.log(`  Iterated (alive+ok):   ${totalIterations}`);
console.log(`  Passed prob filter:    ${passedProbFilter} (${(passedProbFilter / totalIterations * 100).toFixed(1)}%)`);
console.log(`  Found opponent:        ${foundOpponent}`);
console.log(`  Average encounter_prob (Lv1): ${(snapshotNk[1] / snapshotN * 100).toFixed(2)}% (nk=${snapshotNk[1]}/${snapshotN})`);

// Key insight: almost all iterations are Lv0 -> skipped, or Lv1 -> high prob
const lv0Count = engine.levelGroups.get(0)!.size;
const lv1Count = snapshotNk[1];
console.log(`\n  Lv0 (skip entirely):   ${lv0Count} (${(lv0Count / pop * 100).toFixed(1)}% of population)`);
console.log(`  Lv1 (bulk of combat):  ${lv1Count} (${(lv1Count / snapshotN * 100).toFixed(1)}% of eligible)`);

// Timing: measure cost of different parts of the combatLoop
console.log('\n=== combatLoop hot path timing ===\n');

// Cost 1: the Map.get lookup per iteration
let dummy = 0;
const iterations = 500;

let t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const id of aliveIds) {
    const c = engine.cultivators.get(id)!;
    dummy += c.level;
  }
}
let elapsed = performance.now() - t0;
console.log(`Map.get per alive id (${aliveIds.length}): ${(elapsed / iterations).toFixed(3)}ms/iter`);

// Cost 2: the defeatedSet.has check
const defeatedSet = new Set<number>();
for (let i = 0; i < 500; i++) defeatedSet.add(i * 3);

t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const id of aliveIds) {
    dummy += defeatedSet.has(id) ? 1 : 0;
  }
}
elapsed = performance.now() - t0;
console.log(`defeatedSet.has per alive id:          ${(elapsed / iterations).toFixed(3)}ms/iter`);

// Cost 3: snapshotNk lookup + nk/snapshotN comparison
t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const id of aliveIds) {
    const c = engine.cultivators.get(id)!;
    const nk = snapshotNk[c.level];
    if (nk <= 1) continue;
    dummy += nk;
  }
}
elapsed = performance.now() - t0;
console.log(`Map.get + nk check per alive id:       ${(elapsed / iterations).toFixed(3)}ms/iter`);

// Cost 4: full inner body (Map.get + checks + prng)
const prng = engine.prng;
t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const id of aliveIds) {
    const c = engine.cultivators.get(id)!;
    if (!c.alive) continue;
    if (c.injuredUntil > engine.year) continue;
    const nk = snapshotNk[c.level];
    if (nk <= 1) continue;
    if (prng() >= nk / snapshotN) continue;
    dummy += c.cultivation;
  }
}
elapsed = performance.now() - t0;
console.log(`Full filter chain per alive id:        ${(elapsed / iterations).toFixed(3)}ms/iter`);

// Cost 5: isolate resolveCombat by running actual encounters
t0 = performance.now();
const combatEngine = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP; i++) combatEngine.tickYear(false);
for (let i = 0; i < 100; i++) {
  combatEngine.resetYearCounters();
  combatEngine.spawnCultivators(combatEngine.yearlySpawn);
  combatEngine.tickCultivators();
  processEncounters(combatEngine, false);
  combatEngine.purgeDead();
  combatEngine.year++;
}
elapsed = performance.now() - t0;
console.log(`\nprocessEncounters (100 years):          ${(elapsed / 100).toFixed(3)}ms/year`);

// Check if using Array instead of Map would be faster
console.log('\n=== Data Structure Alternative Analysis ===\n');

// Flat array access pattern
const flatAge = new Float64Array(30000);
const flatLevel = new Int32Array(30000);
const flatCult = new Float64Array(30000);
const flatAlive = new Uint8Array(30000);
let idx = 0;
for (const c of engine.cultivators.values()) {
  flatAge[idx] = c.age;
  flatLevel[idx] = c.level;
  flatCult[idx] = c.cultivation;
  flatAlive[idx] = c.alive ? 1 : 0;
  idx++;
}
const count = idx;

t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (let i = 0; i < count; i++) {
    if (!flatAlive[i]) continue;
    dummy += flatAge[i] + flatLevel[i];
  }
}
elapsed = performance.now() - t0;
console.log(`TypedArray iterate ${count}:              ${(elapsed / iterations).toFixed(3)}ms/iter`);

t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const c of engine.cultivators.values()) {
    if (!c.alive) continue;
    dummy += c.age + c.level;
  }
}
elapsed = performance.now() - t0;
console.log(`Map<Cultivator> iterate ${engine.cultivators.size}:      ${(elapsed / iterations).toFixed(3)}ms/iter`);

// Struct of Arrays pattern
const soaSize = 30000;
const soaBuf = new ArrayBuffer(soaSize * 8 * 4); // 4 float64 fields
const soaAge2 = new Float64Array(soaBuf, 0, soaSize);
const soaCult2 = new Float64Array(soaBuf, soaSize * 8, soaSize);

t0 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (let i = 0; i < count; i++) {
    soaAge2[i] += 1;
    soaCult2[i] += 1;
  }
}
elapsed = performance.now() - t0;
console.log(`SoA (SharedBuffer) iterate+mutate:     ${(elapsed / iterations).toFixed(3)}ms/iter`);

void dummy;
console.log('\nDone.');

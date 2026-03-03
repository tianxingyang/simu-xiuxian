import { SimulationEngine } from '../src/engine/simulation';
import { LEVEL_COUNT } from '../src/constants';

const SEED = 42;
const INITIAL_POP = 1000;
const WARMUP = 200;
const YEARS = 500;

const engine = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP; i++) engine.tickYear(false);

console.log(`Pop=${engine.getSummary().totalPopulation}\n`);

// Track per-year combat statistics
let totalCombats = 0;
let totalDeaths = 0;
let totalSkipByProb = 0;
let totalSkipByNk = 0;
let totalOppMismatch = 0;
let totalIndexOf = 0;

// Monkey-patch to count
const origGet = engine.cultivators.get.bind(engine.cultivators);
let getCalls = 0;
// Don't override - just measure
// Just count combat stats from engine counters

for (let y = 0; y < YEARS; y++) {
  engine.resetYearCounters();
  engine.spawnCultivators(engine.yearlySpawn);
  engine.tickCultivators();

  // Count what combatLoop does
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

  const aliveCount = [...engine.aliveLevelIds.entries()]
    .filter(([lv]) => lv > 0)
    .reduce((sum, [, ids]) => sum + ids.size, 0);

  // Each alive id iterates: Map.get + alive check + injured check + defeatedSet.has + nk check + prng
  // That's at minimum 2 Map lookups and several branches per id
  totalCombats += engine.combatDeaths + engine.combatDemotions + engine.combatInjuries +
    engine.combatCultLosses + engine.combatLightInjuries + engine.combatMeridianDamages;

  engine.purgeDead();
  engine.year++;
}

console.log(`Average combats/year: ${(totalCombats / YEARS).toFixed(0)}`);

// Key analysis: what fraction of loop work is "wasted" iteration vs actual combat
const engine2 = new SimulationEngine(SEED, INITIAL_POP);
for (let i = 0; i < WARMUP; i++) engine2.tickYear(false);

engine2.resetYearCounters();
engine2.spawnCultivators(engine2.yearlySpawn);
engine2.tickCultivators();

// Detailed per-id breakdown
let iterTotal = 0;
let skipDead = 0;
let skipInjured = 0;
let skipNkLE1 = 0;
let skipProb = 0;
let skipOppNotAlive = 0;
let reachCombat = 0;

const snapshotNk2 = new Array(LEVEL_COUNT).fill(0);
let snapshotN2 = 0;
for (const [level, ids] of engine2.levelGroups) {
  if (level === 0) continue;
  for (const id of ids) {
    const c = engine2.cultivators.get(id)!;
    if (c.injuredUntil > engine2.year) continue;
    snapshotNk2[level]++;
  }
  snapshotN2 += snapshotNk2[level];
}

const aliveIds: number[] = [];
for (let level = 1; level < LEVEL_COUNT; level++) {
  for (const id of engine2.aliveLevelIds.get(level)!) aliveIds.push(id);
}

const prng = engine2.prng;
const defeatedSet = new Set<number>();

for (const id of aliveIds) {
  iterTotal++;
  const c = engine2.cultivators.get(id)!;
  if (!c.alive) { skipDead++; continue; }
  if (c.injuredUntil > engine2.year || defeatedSet.has(id)) { skipInjured++; continue; }

  const nk = snapshotNk2[c.level];
  if (nk <= 1) { skipNkLE1++; continue; }

  if (prng() >= nk / snapshotN2) { skipProb++; continue; }

  const arr = engine2.levelArrayCache.get(c.level);
  if (!arr || arr.length === 0) { skipOppNotAlive++; continue; }

  // Would reach combat resolution
  reachCombat++;
}

console.log(`\n=== Single Year Combat Loop Breakdown ===`);
console.log(`Total iterations:     ${iterTotal}`);
console.log(`  Skip (dead):        ${skipDead} (${(skipDead / iterTotal * 100).toFixed(1)}%)`);
console.log(`  Skip (injured/def): ${skipInjured} (${(skipInjured / iterTotal * 100).toFixed(1)}%)`);
console.log(`  Skip (nk<=1):       ${skipNkLE1} (${(skipNkLE1 / iterTotal * 100).toFixed(1)}%)`);
console.log(`  Skip (prob filter): ${skipProb} (${(skipProb / iterTotal * 100).toFixed(1)}%)`);
console.log(`  Skip (no opp):      ${skipOppNotAlive} (${(skipOppNotAlive / iterTotal * 100).toFixed(1)}%)`);
console.log(`  Reach combat:       ${reachCombat} (${(reachCombat / iterTotal * 100).toFixed(1)}%)`);

// Calculate cost breakdown
const perIter = 11.0 / iterTotal * 1000; // ~11ms / year, in μs per iteration
console.log(`\nCost estimate: ~${perIter.toFixed(2)}μs per iteration`);
console.log(`  ${reachCombat} combats × resolveCombat cost = bulk of time`);
console.log(`  ${iterTotal - reachCombat} skipped iterations × filter cost = overhead`);

// Estimate: how much time is in resolveCombat vs filter overhead
// From V8 profile: processEncounters self=67.6%, resolveCombat self=7.4%
// That means ~60% is in processEncounters body (the loop + filter), ~7% in resolveCombat
// But resolveCombat calls effectiveCourage, threshold, truncatedGaussian, etc.
// resolveDefeatOutcome = 1.4%
// truncatedGaussian = 1.5%
// threshold = 2.4%
// So resolveCombat total (with callees) ≈ 7.4 + 1.4 + 1.5 + 2.4 ≈ 12.7%
// processEncounters loop overhead ≈ 67.6 - 12.7 ≈ 54.9%
console.log(`\n=== V8 Profile Interpretation ===`);
console.log(`processEncounters self: 67.6% (includes inlined resolveCombat + loop)`);
console.log(`  → Loop filter overhead:     ~55% (Map.get + checks + prng per ${iterTotal} ids)`);
console.log(`  → resolveCombat + callees:  ~12.7%`);
console.log(`tickCultivators:              7.6%`);
console.log(`spawnCultivators:             2.6%`);
console.log(`purgeDead:                    2.6%`);
console.log(`threshold:                    2.4%`);

console.log(`\n=== Key Finding ===`);
console.log(`The loop iterates ${iterTotal} ids but only ${reachCombat} (${(reachCombat / iterTotal * 100).toFixed(1)}%) reach combat.`);
console.log(`Each iteration costs Map.get + 3 branch checks + possible prng call ≈ 0.5-1μs.`);
console.log(`With ${iterTotal} iterations, that's ${(iterTotal * 0.75 / 1000).toFixed(1)}ms of pure filter overhead per year.`);
console.log(`The remaining ~${(11 - iterTotal * 0.75 / 1000).toFixed(1)}ms is in the ${reachCombat} actual combat resolutions.`);

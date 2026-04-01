import { SimulationEngine } from '../src/engine/simulation.js';
import { LEVEL_COUNT, LEVEL_NAMES } from '../src/constants/level.js';
import { sustainableMaxAge } from '../src/constants/lifespan.js';
import { breakthroughChance } from '../src/constants/breakthrough.js';
import { getSimTuning } from '../src/sim-tuning.js';
import { writeFileSync } from 'node:fs';

const TOTAL_YEARS = 2000;
const WARMUP_YEARS = 400;
const INITIAL_POP = 4000;
const SEED = 42;

// Parse CLI args
const args = process.argv.slice(2);
let totalYears = TOTAL_YEARS;
let warmupYears = WARMUP_YEARS;
let initialPop = INITIAL_POP;
let seed = SEED;
let outFile = '';

for (const arg of args) {
  const [key, val] = arg.split('=');
  if (key === '--years') totalYears = parseInt(val);
  if (key === '--warmup') warmupYears = parseInt(val);
  if (key === '--pop') initialPop = parseInt(val);
  if (key === '--seed') seed = parseInt(val);
  if (key === '--out') outFile = val;
}

console.log(`Running measurement sim: ${totalYears} years, warmup=${warmupYears}, pop=${initialPop}, seed=${seed}`);

const engine = new SimulationEngine(seed, 0);
engine.reset(seed, initialPop);

const accum = {
  levelPop: new Float64Array(LEVEL_COUNT),
  attempts: new Float64Array(LEVEL_COUNT),
  promotions: new Float64Array(LEVEL_COUNT),
  expiryDeaths: new Float64Array(LEVEL_COUNT),
  combatDeaths: new Float64Array(LEVEL_COUNT),
  years: 0,
};

for (let y = 0; y < totalYears; y++) {
  engine.tickYear(false);

  if (y >= warmupYears) {
    const s = engine.getSummary();
    accum.years++;
    for (let l = 0; l < LEVEL_COUNT; l++) {
      accum.levelPop[l] += s.levelCounts[l];
      accum.attempts[l] += s.breakthroughAttemptsByLevel[l];
      accum.promotions[l] += s.promotions[l];
      accum.expiryDeaths[l] += s.expiryDeathsByLevel[l];
      accum.combatDeaths[l] += s.combatDeathsByLevel[l];
    }
  }
}

const tuning = getSimTuning();
const cooldown = tuning.breakthroughFailure.cooldown;
const measureYears = accum.years;

type LevelRates = {
  level: number;
  name: string;
  avgPop: number;
  popFraction: number;
  attemptRate: number;
  rawSuccessRate: number;
  effectiveBreakthroughRate: number;
  naturalDeathRate: number;
  combatDeathRate: number;
  totalDeathRate: number;
  lifespan: number;
  formulaChance: number;
};

const totalPop = Array.from(accum.levelPop).reduce((a, b) => a + b, 0) / measureYears;
const rates: LevelRates[] = [];

for (let l = 0; l < LEVEL_COUNT; l++) {
  const avgPop = accum.levelPop[l] / measureYears;
  const attempts = accum.attempts[l] / measureYears;
  // promotions[l] = promotions TO level l, so successes FROM level l = promotions[l+1]
  const successes = l < LEVEL_COUNT - 1 ? accum.promotions[l + 1] / measureYears : 0;
  const expiryD = accum.expiryDeaths[l] / measureYears;
  const combatD = accum.combatDeaths[l] / measureYears;

  const attemptRate = avgPop > 0 ? attempts / avgPop : 0;
  const rawSuccess = attempts > 0 ? successes / attempts : 0;
  const effectiveBT = avgPop > 0 ? successes / avgPop : 0;
  const natDeath = avgPop > 0 ? expiryD / avgPop : 0;
  const combDeath = avgPop > 0 ? combatD / avgPop : 0;

  rates.push({
    level: l,
    name: LEVEL_NAMES[l],
    avgPop: Math.round(avgPop),
    popFraction: avgPop / totalPop,
    attemptRate,
    rawSuccessRate: rawSuccess,
    effectiveBreakthroughRate: effectiveBT,
    naturalDeathRate: natDeath,
    combatDeathRate: combDeath,
    totalDeathRate: natDeath + combDeath,
    lifespan: sustainableMaxAge(l),
    formulaChance: breakthroughChance(l),
  });
}

// Display table
console.log('\n=== Per-Level Rate Table ===\n');
console.log(
  'Level'.padEnd(8) +
  'Pop'.padStart(6) +
  'Pop%'.padStart(8) +
  'λ(att)'.padStart(8) +
  's(raw)'.padStart(8) +
  'p(eff)'.padStart(8) +
  'd_nat'.padStart(8) +
  'd_cmb'.padStart(8) +
  'd_tot'.padStart(8) +
  'T_life'.padStart(8) +
  'formula'.padStart(8),
);
console.log('-'.repeat(86));

for (const r of rates) {
  console.log(
    r.name.padEnd(8) +
    String(r.avgPop).padStart(6) +
    (r.popFraction * 100).toFixed(2).padStart(7) + '%' +
    r.attemptRate.toFixed(4).padStart(8) +
    r.rawSuccessRate.toFixed(4).padStart(8) +
    r.effectiveBreakthroughRate.toFixed(4).padStart(8) +
    r.naturalDeathRate.toFixed(4).padStart(8) +
    r.combatDeathRate.toFixed(4).padStart(8) +
    r.totalDeathRate.toFixed(4).padStart(8) +
    String(r.lifespan).padStart(8) +
    r.formulaChance.toFixed(4).padStart(8),
  );
}

// Derived parameters for solver
console.log('\n=== Solver Input (JSON) ===\n');
const solverInput = {
  measureYears,
  cooldown,
  rates: rates.map(r => ({
    level: r.level,
    lambda: r.attemptRate,
    s_empirical: r.rawSuccessRate,
    d_bg: r.totalDeathRate,
    p_effective: r.effectiveBreakthroughRate,
    avgPop: r.avgPop,
    popFraction: r.popFraction,
  })),
};

const json = JSON.stringify(solverInput, null, 2);
console.log(json);

if (outFile) {
  writeFileSync(outFile, json);
  console.log(`\nWritten to ${outFile}`);
}

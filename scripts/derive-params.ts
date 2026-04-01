/**
 * derive-params.ts — Analytical balance parameter derivation
 *
 * Derives game parameters from target distribution using birth-death process
 * steady-state theory, instead of brute-force search.
 *
 * Usage:
 *   npx tsx scripts/derive-params.ts
 *   npx tsx scripts/derive-params.ts --measured=rates.json
 *   npx tsx scripts/derive-params.ts --measure  (runs sim internally)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_BALANCE_PROFILE,
  gaussianContribution,
  sigmoidContribution,
  setBalanceProfile,
  resetBalanceProfile,
  type BalanceProfile,
} from '../src/balance.js';
import {
  DEFAULT_SIM_TUNING,
  getSimTuning,
  setSimTuning,
  resetSimTuning,
  type SimTuning,
} from '../src/sim-tuning.js';
import { LEVEL_COUNT, LEVEL_NAMES } from '../src/constants/level.js';
import { sustainableMaxAge } from '../src/constants/lifespan.js';
import { breakthroughChance } from '../src/constants/breakthrough.js';
import { SimulationEngine } from '../src/engine/simulation.js';

// ── Target distribution ──────────────────────────────────────────────
const TARGET = [59.17, 27.95, 9.78, 2.54, 0.487, 0.069, 0.007, 0.001] as const;

// ── Types ────────────────────────────────────────────────────────────
type MeasuredRates = {
  lambda: number;     // attempt rate per year (attempts / population)
  s_empirical: number; // raw success rate (successes / attempts)
  d_bg: number;       // total background death rate
  p_effective: number; // effective breakthrough rate
  avgPop: number;
  popFraction: number;
};

type DerivedLevel = {
  level: number;
  name: string;
  R: number;           // population ratio N_{L+1}/N_L
  p_needed: number;    // effective breakthrough rate needed
  d_bg: number;        // background death rate used
  lambda: number;      // attempt opportunity rate
  tau: number;         // cooldown duration
  s_needed: number;    // raw success probability needed
  y_needed: number;    // -ln(s_needed) for fitting
  s_fitted: number;    // fitted success probability
  feasible: boolean;
};

// ── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let measuredFile = '';
let runMeasure = false;
let outFile = '';
let baseFile = '';
let measureYears = 2000;
let measureWarmup = 400;
let measurePop = 4000;
let measureSeed = 42;

for (const arg of args) {
  const [key, val] = arg.split('=');
  if (key === '--measured') measuredFile = val;
  if (key === '--measure') runMeasure = true;
  if (key === '--out') outFile = val;
  if (key === '--base') baseFile = val;
  if (key === '--years') measureYears = parseInt(val);
  if (key === '--warmup') measureWarmup = parseInt(val);
  if (key === '--pop') measurePop = parseInt(val);
  if (key === '--seed') measureSeed = parseInt(val);
}

// ── Step 0: Get measured rates or use theoretical defaults ───────────

function theoreticalDefaults(): MeasuredRates[] {
  const tuning = getSimTuning();
  const rates: MeasuredRates[] = [];
  for (let l = 0; l < LEVEL_COUNT; l++) {
    const lifespan = sustainableMaxAge(l);
    const d_nat = lifespan > 0 ? 1 / lifespan : 0;
    // Combat death estimate: exponential decay with level
    // Low levels fight more; high levels are rare and strong
    const d_combat = 0.03 * Math.exp(-0.4 * l);
    const d_bg = d_nat + d_combat;
    // Attempt rate: assume ~1 attempt per eligible cultivator per year
    // Reduced by behavioral factors (not everyone seeks breakthrough)
    const lambda = l <= 3 ? 0.35 : 0.25;
    rates.push({ lambda, s_empirical: 0, d_bg, p_effective: 0, avgPop: 0, popFraction: TARGET[l] / 100 });
  }
  return rates;
}

function runMeasurementSim(years: number, warmup: number, pop: number, seed: number): MeasuredRates[] {
  console.log(`Running measurement sim: ${years} years, warmup=${warmup}...`);
  const engine = new SimulationEngine(seed, 0);
  engine.reset(seed, pop);

  const accum = {
    levelPop: new Float64Array(LEVEL_COUNT),
    attempts: new Float64Array(LEVEL_COUNT),
    promotions: new Float64Array(LEVEL_COUNT),
    expiryDeaths: new Float64Array(LEVEL_COUNT),
    combatDeaths: new Float64Array(LEVEL_COUNT),
    measureYears: 0,
  };

  for (let y = 0; y < years; y++) {
    engine.tickYear(false);
    if (y >= warmup) {
      const s = engine.getSummary();
      accum.measureYears++;
      for (let l = 0; l < LEVEL_COUNT; l++) {
        accum.levelPop[l] += s.levelCounts[l];
        accum.attempts[l] += s.breakthroughAttemptsByLevel[l];
        accum.promotions[l] += s.promotions[l];
        accum.expiryDeaths[l] += s.expiryDeathsByLevel[l];
        accum.combatDeaths[l] += s.combatDeathsByLevel[l];
      }
    }
  }

  const my = accum.measureYears;
  const totalPop = Array.from(accum.levelPop).reduce((a, b) => a + b, 0) / my;
  const rates: MeasuredRates[] = [];

  for (let l = 0; l < LEVEL_COUNT; l++) {
    const avgPop = accum.levelPop[l] / my;
    const attempts = accum.attempts[l] / my;
    const successes = l < LEVEL_COUNT - 1 ? accum.promotions[l + 1] / my : 0;
    const expiryD = accum.expiryDeaths[l] / my;
    const combatD = accum.combatDeaths[l] / my;

    rates.push({
      lambda: avgPop > 0 ? attempts / avgPop : 0,
      s_empirical: attempts > 0 ? successes / attempts : 0,
      d_bg: avgPop > 0 ? (expiryD + combatD) / avgPop : 0,
      p_effective: avgPop > 0 ? successes / avgPop : 0,
      avgPop: Math.round(avgPop),
      popFraction: avgPop / totalPop,
    });
  }

  console.log('Measurement complete.\n');
  return rates;
}

function loadMeasuredRates(file: string): MeasuredRates[] {
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  return data.rates as MeasuredRates[];
}

// ── Step 1: Compute population ratios R_L ────────────────────────────

function computeRatios(): number[] {
  const R: number[] = [];
  for (let l = 0; l < LEVEL_COUNT - 1; l++) {
    R.push(TARGET[l + 1] / TARGET[l]);
  }
  R.push(0); // lv7 has no further level
  return R;
}

// ── Step 2: Solve steady-state for needed p_L ────────────────────────

function solveNeededBreakthroughRates(
  R: number[],
  rates: MeasuredRates[],
): DerivedLevel[] {
  const tuning = getSimTuning();
  const tau = tuning.breakthroughFailure.cooldown;
  const levels: DerivedLevel[] = [];

  // Top level (lv7): no breakthrough, only death
  const d7 = rates[7].d_bg;
  levels[7] = {
    level: 7, name: LEVEL_NAMES[7],
    R: 0, p_needed: 0, d_bg: d7,
    lambda: rates[7].lambda, tau, s_needed: 0, y_needed: 0,
    s_fitted: 0, feasible: true,
  };

  // Solve backwards: p_L = R_L * (p_{L+1} + d_{L+1})
  for (let l = 6; l >= 0; l--) {
    const d_bg = rates[l].d_bg;
    const lambda = rates[l].lambda;
    const p_next = levels[l + 1].p_needed;
    const d_next = levels[l + 1].d_bg;
    const p_needed = R[l] * (p_next + d_next);

    // Invert to raw success probability
    // k_L = 0 (breakthrough doesn't kill), so f_L = 1 - s_L
    // p_L = lambda * F * s = lambda * s / (1 + tau * lambda * (1 - s))
    // Solving for s: s = p * (1 + tau * lambda) / (lambda + tau * lambda * p)
    //              = p * (1 + tau * lambda) / (lambda * (1 + tau * p))
    let s_needed = 0;
    let feasible = true;
    if (lambda > 0) {
      s_needed = p_needed * (1 + tau * lambda) / (lambda * (1 + tau * p_needed));
      if (s_needed < 0 || s_needed > 1) {
        feasible = false;
      }
    } else {
      feasible = p_needed === 0;
    }

    const y_needed = s_needed > 0 && s_needed <= 1 ? -Math.log(s_needed) : NaN;

    levels[l] = {
      level: l, name: LEVEL_NAMES[l],
      R: R[l], p_needed, d_bg,
      lambda, tau, s_needed, y_needed,
      s_fitted: 0, feasible,
    };
  }

  return levels;
}

// ── Step 3: Fit breakthrough formula ─────────────────────────────────
//
// -ln(s_L) = a + b*(2L+1) + amp_tail * sigmoid(L) + amp_gate * gaussian(L)
//
// We keep the sigmoid/gaussian shape from the current profile and fit
// [a, b, amp_tail, amp_gate] via least squares.

type FitResult = {
  a: number;
  b: number;
  tailAmplitude: number;
  gateAmplitude: number;
  residuals: number[];
  rmsError: number;
};

function fitBreakthroughParams(levels: DerivedLevel[], profile: BalanceProfile): FitResult {
  // Use levels 0-6 (lv7 has no breakthrough)
  const n = LEVEL_COUNT - 1;
  const y: number[] = [];
  const X: number[][] = [];

  for (let l = 0; l < n; l++) {
    if (!levels[l].feasible || isNaN(levels[l].y_needed)) continue;

    const yVal = levels[l].y_needed;
    y.push(yVal);

    // Basis functions: [1, 2L+1, sigmoid(L), gaussian(L)]
    const sigVal = sigmoidBasis(l, profile.breakthrough.tailPenalty);
    const gauVal = gaussianBasis(l, profile.breakthrough.gatePenalty);
    X.push([1, 2 * l + 1, sigVal, gauVal]);
  }

  if (y.length < 2) {
    return { a: 0.5, b: 0.15, tailAmplitude: 0, gateAmplitude: 0, residuals: [], rmsError: Infinity };
  }

  // Solve via normal equations: (X^T X) beta = X^T y
  const p = 4; // number of parameters
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);

  for (let i = 0; i < y.length; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  // Solve with Gaussian elimination
  const beta = solveLinearSystem(XtX, Xty);

  // Clamp to reasonable ranges
  const a = Math.max(0.1, beta[0]);
  const b = Math.max(0.01, beta[1]);
  const tailAmp = Math.max(0, Math.min(5.0, beta[2]));   // cap at 5.0
  const gateAmp = Math.max(0, Math.min(3.0, beta[3]));   // cap at 3.0

  // Compute residuals
  const residuals: number[] = [];
  let sumSqErr = 0;
  for (let i = 0; i < y.length; i++) {
    const predicted = a + b * X[i][1] + tailAmp * X[i][2] + gateAmp * X[i][3];
    const err = y[i] - predicted;
    residuals.push(err);
    sumSqErr += err * err;
  }

  return {
    a, b,
    tailAmplitude: tailAmp,
    gateAmplitude: gateAmp,
    residuals,
    rmsError: Math.sqrt(sumSqErr / y.length),
  };
}

function sigmoidBasis(level: number, curve: { center: number; steepness: number }): number {
  const steepness = Math.max(1e-6, curve.steepness);
  return 1 / (1 + Math.exp(-steepness * (level - curve.center)));
}

function gaussianBasis(level: number, curve: { center: number; width: number }): number {
  const width = Math.max(1e-3, curve.width);
  const normalized = (level - curve.center) / width;
  return Math.exp(-0.5 * normalized * normalized);
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) continue;
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= M[i][j] * x[j];
    }
    x[i] /= M[i][i];
  }
  return x;
}

// ── Step 4: Build new preset ─────────────────────────────────────────

function buildPreset(fit: FitResult, baseProfile: BalanceProfile): BalanceProfile {
  return {
    breakthrough: {
      a: fit.a,
      b: fit.b,
      tailPenalty: {
        amplitude: fit.tailAmplitude,
        center: baseProfile.breakthrough.tailPenalty.center,
        steepness: baseProfile.breakthrough.tailPenalty.steepness,
      },
      gatePenalty: {
        amplitude: fit.gateAmplitude,
        center: baseProfile.breakthrough.gatePenalty.center,
        width: baseProfile.breakthrough.gatePenalty.width,
      },
    },
    threshold: { ...baseProfile.threshold },
    combat: { ...baseProfile.combat },
    tribulation: { ...baseProfile.tribulation },
  };
}

// ── Main ─────────────────────────────────────────────────────────────

function loadAndApplyBase(file: string): void {
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  if (data.balance) setBalanceProfile(data.balance);
  if (data.tuning) setSimTuning(data.tuning);
  console.log(`Applied base profile from ${file}\n`);
}

function main() {
  console.log('=== Analytical Balance Parameter Derivation ===\n');

  // Apply base profile before measurement (so sim uses derived params)
  if (baseFile) {
    loadAndApplyBase(baseFile);
  }

  // Get rates
  let rates: MeasuredRates[];
  if (measuredFile) {
    console.log(`Loading measured rates from ${measuredFile}\n`);
    rates = loadMeasuredRates(measuredFile);
  } else if (runMeasure) {
    rates = runMeasurementSim(measureYears, measureWarmup, measurePop, measureSeed);
  } else {
    console.log('Using theoretical default rates (no measurement)\n');
    rates = theoreticalDefaults();
  }

  // Step 1: Population ratios
  const R = computeRatios();
  console.log('Target population ratios R_L:');
  for (let l = 0; l < LEVEL_COUNT - 1; l++) {
    console.log(`  ${LEVEL_NAMES[l]}→${LEVEL_NAMES[l + 1]}: ${R[l].toFixed(4)}`);
  }
  console.log();

  // Step 2: Solve steady-state
  const levels = solveNeededBreakthroughRates(R, rates);

  console.log('Steady-state solution:');
  console.log(
    'Level'.padEnd(8) +
    'R'.padStart(7) +
    'p_need'.padStart(9) +
    'd_bg'.padStart(9) +
    'lambda'.padStart(9) +
    's_need'.padStart(9) +
    'y=-ln(s)'.padStart(10) +
    ' feasible',
  );
  console.log('-'.repeat(75));
  for (const lv of levels) {
    console.log(
      lv.name.padEnd(8) +
      (lv.R > 0 ? lv.R.toFixed(4) : '-').padStart(7) +
      lv.p_needed.toFixed(5).padStart(9) +
      lv.d_bg.toFixed(5).padStart(9) +
      lv.lambda.toFixed(4).padStart(9) +
      (lv.s_needed > 0 ? lv.s_needed.toFixed(5) : '-').padStart(9) +
      (!isNaN(lv.y_needed) ? lv.y_needed.toFixed(4) : '-').padStart(10) +
      (lv.feasible ? ' OK' : ' INFEASIBLE'),
    );
  }
  console.log();

  // Step 3: Fit breakthrough formula
  const baseProfile = DEFAULT_BALANCE_PROFILE;
  const fit = fitBreakthroughParams(levels, baseProfile);

  console.log('Fitted breakthrough parameters:');
  console.log(`  a = ${fit.a.toFixed(4)}`);
  console.log(`  b = ${fit.b.toFixed(4)}`);
  console.log(`  tailPenalty amplitude = ${fit.tailAmplitude.toFixed(4)} (center=${baseProfile.breakthrough.tailPenalty.center}, steepness=${baseProfile.breakthrough.tailPenalty.steepness})`);
  console.log(`  gatePenalty amplitude = ${fit.gateAmplitude.toFixed(4)} (center=${baseProfile.breakthrough.gatePenalty.center}, width=${baseProfile.breakthrough.gatePenalty.width})`);
  console.log(`  RMS error = ${fit.rmsError.toFixed(6)}`);
  console.log();

  // Show fitted vs needed
  console.log('Fitted vs needed breakthrough chance:');
  console.log('Level'.padEnd(8) + 's_need'.padStart(10) + 's_fitted'.padStart(10) + 'current'.padStart(10) + 'error'.padStart(10));
  console.log('-'.repeat(48));
  for (let l = 0; l < LEVEL_COUNT - 1; l++) {
    const tailVal = fit.tailAmplitude * sigmoidBasis(l, baseProfile.breakthrough.tailPenalty);
    const gateVal = fit.gateAmplitude * gaussianBasis(l, baseProfile.breakthrough.gatePenalty);
    const yFitted = fit.a + fit.b * (2 * l + 1) + tailVal + gateVal;
    const sFitted = Math.exp(-yFitted);
    levels[l].s_fitted = sFitted;

    const sNeeded = levels[l].s_needed;
    const sCurrent = breakthroughChance(l);
    const error = sNeeded > 0 ? (sFitted - sNeeded) / sNeeded : 0;

    console.log(
      LEVEL_NAMES[l].padEnd(8) +
      (sNeeded > 0 ? (sNeeded * 100).toFixed(2) + '%' : '-').padStart(10) +
      (sFitted * 100).toFixed(2).padStart(9) + '%' +
      (sCurrent * 100).toFixed(2).padStart(9) + '%' +
      (error * 100).toFixed(1).padStart(9) + '%',
    );
  }
  console.log();

  // Step 4: Build preset
  const newProfile = buildPreset(fit, baseProfile);
  const tuning = getSimTuning();

  const output = {
    balance: newProfile,
    tuning,
  };

  console.log('=== Generated Preset ===\n');
  console.log(JSON.stringify(output, null, 2));

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(output, null, 2));
    console.log(`\nWritten to ${outFile}`);
  }
}

main();

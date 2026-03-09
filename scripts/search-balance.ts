import { readFileSync } from 'node:fs';
import { SimulationEngine } from '../src/engine/simulation';
import { DEFAULT_BALANCE_PROFILE, resetBalanceProfile, setBalanceProfile, type BalanceProfileInput } from '../src/balance';
import { breakthroughChance, LEVEL_COUNT, LEVEL_NAMES } from '../src/constants';

type SearchOptions = {
  totalYears: number;
  warmupYears: number;
  initialPop: number;
  seeds: number[];
  iterations: number;
  survivors: number;
  refinements: number;
  baseFile?: string;
};

type Candidate = {
  id: number;
  profile: BalanceProfileInput;
  score?: number;
  avgDist?: number[];
  violations?: number;
  breakthroughCurve?: number[];
  monotonicViolations?: number;
};

const TARGET_DISTRIBUTION = [59.17, 27.95, 9.78, 2.54, 0.487, 0.069, 0.007, 0.001] as const;
const RELATIVE_TOLERANCE = 0.10;
const MONOTONIC_BASE_PENALTY = 250;
const MONOTONIC_DIFF_WEIGHT = 10_000;

const DEFAULT_OPTIONS: SearchOptions = {
  totalYears: 3_000,
  warmupYears: 600,
  initialPop: 4_000,
  seeds: [42],
  iterations: 64,
  survivors: 8,
  refinements: 3,
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randIn(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function candidateFromProfile(id: number, profile: BalanceProfileInput): Candidate {
  return { id, profile };
}

function defaultCandidate(id: number): Candidate {
  return {
    id,
    profile: structuredClone(DEFAULT_BALANCE_PROFILE),
  };
}

function candidateFromRandom(rng: () => number, id: number): Candidate {
  return {
    id,
    profile: {
      breakthrough: {
        a: round3(randIn(rng, 0.43, 0.52)),
        b: round3(randIn(rng, 0.095, 0.125)),
        tailPenalty: {
          amplitude: round3(randIn(rng, 0, 1.6)),
          center: round3(randIn(rng, 3.8, 5.8)),
          steepness: round3(randIn(rng, 1.2, 5.0)),
        },
        gatePenalty: {
          amplitude: round3(randIn(rng, 0, 1.8)),
          center: round3(randIn(rng, 3.8, 5.8)),
          width: round3(randIn(rng, 0.2, 1.6)),
        },
      },
      threshold: {
        tailBoost: {
          amplitude: round3(randIn(rng, 0, 1.4)),
          center: round3(randIn(rng, 3.8, 5.8)),
          steepness: round3(randIn(rng, 1.2, 5.0)),
        },
        gateBoost: {
          amplitude: round3(randIn(rng, 0, 2.0)),
          center: round3(randIn(rng, 4.0, 5.9)),
          width: round3(randIn(rng, 0.2, 1.8)),
        },
        peakBoost: {
          amplitude: round3(randIn(rng, 0, 2.4)),
          center: round3(randIn(rng, 5.0, 6.3)),
          width: round3(randIn(rng, 0.18, 1.2)),
        },
        reliefBoost: {
          amplitude: round3(randIn(rng, -1.2, 0)),
          center: round3(randIn(rng, 6.6, 7.2)),
          width: round3(randIn(rng, 0.18, 0.6)),
        },
        finalRelief: {
          amplitude: round3(randIn(rng, -1.4, 0)),
          center: round3(randIn(rng, 6.8, 7.2)),
          width: round3(randIn(rng, 0.12, 0.5)),
        },
      },
      combat: {
        deathBoost: {
          amplitude: round3(randIn(rng, 0, 1.2)),
          center: round3(randIn(rng, 4.5, 6.6)),
          width: round3(randIn(rng, 0.25, 1.6)),
        },
        lootPenalty: {
          amplitude: round3(randIn(rng, 0, 1.2)),
          center: round3(randIn(rng, 4.0, 6.2)),
          steepness: round3(randIn(rng, 1.0, 5.0)),
        },
      },
    },
  };
}

function mutateCandidate(base: Candidate, rng: () => number, id: number, scale: number): Candidate {
  const profile = structuredClone(base.profile);
  if (!profile.breakthrough || !profile.threshold || !profile.combat) throw new Error('incomplete profile');

  profile.breakthrough.a = round3(clamp((profile.breakthrough.a ?? 0.45) + randIn(rng, -0.05, 0.05) * scale, 0.35, 0.75));
  profile.breakthrough.b = round3(clamp((profile.breakthrough.b ?? 0.10) + randIn(rng, -0.04, 0.04) * scale, 0.05, 0.20));
  profile.breakthrough.tailPenalty = {
    amplitude: round3(clamp((profile.breakthrough.tailPenalty?.amplitude ?? 0) + randIn(rng, -1.5, 1.5) * scale, 0, 5)),
    center: round3(clamp((profile.breakthrough.tailPenalty?.center ?? 4.5) + randIn(rng, -0.8, 0.8) * scale, 3.2, 6.4)),
    steepness: round3(clamp((profile.breakthrough.tailPenalty?.steepness ?? 3) + randIn(rng, -1.2, 1.2) * scale, 0.6, 7.0)),
  };
  profile.breakthrough.gatePenalty = {
    amplitude: round3(clamp((profile.breakthrough.gatePenalty?.amplitude ?? 0) + randIn(rng, -1.4, 1.4) * scale, 0, 4.5)),
    center: round3(clamp((profile.breakthrough.gatePenalty?.center ?? 4.8) + randIn(rng, -0.8, 0.8) * scale, 3.6, 6.2)),
    width: round3(clamp((profile.breakthrough.gatePenalty?.width ?? 0.7) + randIn(rng, -0.4, 0.4) * scale, 0.15, 2.2)),
  };
  profile.threshold.tailBoost = {
    amplitude: round3(clamp((profile.threshold.tailBoost?.amplitude ?? 0) + randIn(rng, -1.2, 1.2) * scale, 0, 4)),
    center: round3(clamp((profile.threshold.tailBoost?.center ?? 4.5) + randIn(rng, -0.8, 0.8) * scale, 3.2, 6.4)),
    steepness: round3(clamp((profile.threshold.tailBoost?.steepness ?? 3) + randIn(rng, -1.2, 1.2) * scale, 0.6, 7.0)),
  };
  profile.threshold.gateBoost = {
    amplitude: round3(clamp((profile.threshold.gateBoost?.amplitude ?? 0) + randIn(rng, -1.5, 1.5) * scale, 0, 5.0)),
    center: round3(clamp((profile.threshold.gateBoost?.center ?? 5.0) + randIn(rng, -0.8, 0.8) * scale, 3.8, 6.2)),
    width: round3(clamp((profile.threshold.gateBoost?.width ?? 0.7) + randIn(rng, -0.4, 0.4) * scale, 0.15, 2.4)),
  };
  profile.threshold.peakBoost = {
    amplitude: round3(clamp((profile.threshold.peakBoost?.amplitude ?? 0) + randIn(rng, -1.6, 1.6) * scale, 0, 6.0)),
    center: round3(clamp((profile.threshold.peakBoost?.center ?? 5.8) + randIn(rng, -0.6, 0.6) * scale, 4.9, 6.6)),
    width: round3(clamp((profile.threshold.peakBoost?.width ?? 0.45) + randIn(rng, -0.3, 0.3) * scale, 0.12, 1.4)),
  };
  profile.threshold.reliefBoost = {
    amplitude: round3(clamp((profile.threshold.reliefBoost?.amplitude ?? 0) + randIn(rng, -0.9, 0.9) * scale, -2.5, 0)),
    center: round3(clamp((profile.threshold.reliefBoost?.center ?? 7.0) + randIn(rng, -0.3, 0.3) * scale, 6.4, 7.4)),
    width: round3(clamp((profile.threshold.reliefBoost?.width ?? 0.28) + randIn(rng, -0.15, 0.15) * scale, 0.12, 0.9)),
  };
  profile.threshold.finalRelief = {
    amplitude: round3(clamp((profile.threshold.finalRelief?.amplitude ?? 0) + randIn(rng, -1.0, 1.0) * scale, -2.5, 0)),
    center: round3(clamp((profile.threshold.finalRelief?.center ?? 7.0) + randIn(rng, -0.2, 0.2) * scale, 6.7, 7.3)),
    width: round3(clamp((profile.threshold.finalRelief?.width ?? 0.28) + randIn(rng, -0.12, 0.12) * scale, 0.08, 0.7)),
  };
  profile.combat.deathBoost = {
    amplitude: round3(clamp((profile.combat.deathBoost?.amplitude ?? 0) + randIn(rng, -1.0, 1.0) * scale, 0, 3.5)),
    center: round3(clamp((profile.combat.deathBoost?.center ?? 5.2) + randIn(rng, -0.8, 0.8) * scale, 3.8, 6.8)),
    width: round3(clamp((profile.combat.deathBoost?.width ?? 0.7) + randIn(rng, -0.4, 0.4) * scale, 0.2, 2.0)),
  };
  profile.combat.lootPenalty = {
    amplitude: round3(clamp((profile.combat.lootPenalty?.amplitude ?? 0) + randIn(rng, -1.0, 1.0) * scale, 0, 3.5)),
    center: round3(clamp((profile.combat.lootPenalty?.center ?? 4.8) + randIn(rng, -0.8, 0.8) * scale, 3.5, 6.8)),
    steepness: round3(clamp((profile.combat.lootPenalty?.steepness ?? 3) + randIn(rng, -1.2, 1.2) * scale, 0.6, 7.0)),
  };

  return { id, profile };
}

function scoreDistribution(avgDist: number[]): { score: number; violations: number } {
  let score = 0;
  let violations = 0;
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const target = TARGET_DISTRIBUTION[level];
    const actual = avgDist[level];
    const relativeError = Math.abs(actual - target) / target;
    const epsilon = target * 0.1;
    const logError = Math.log((actual + epsilon) / (target + epsilon));
    const weight = level >= 7 ? 18 : level === 6 ? 14 : level === 5 ? 10 : level === 4 ? 4 : 1;
    score += weight * logError * logError;
    if (actual === 0 && target > 0) score += weight * 25;
    if (relativeError > RELATIVE_TOLERANCE) {
      violations++;
      score += weight * relativeError;
    }
  }
  return { score, violations };
}

function collectBreakthroughCurve(): number[] {
  return Array.from({ length: LEVEL_COUNT - 1 }, (_, level) => breakthroughChance(level));
}

function scoreBreakthroughCurve(curve: number[]): { score: number; violations: number } {
  let score = 0;
  let violations = 0;
  for (let level = 0; level < curve.length - 1; level++) {
    const current = curve[level];
    const next = curve[level + 1];
    if (next < current) continue;
    violations++;
    score += MONOTONIC_BASE_PENALTY + (next - current) * MONOTONIC_DIFF_WEIGHT;
  }
  return { score, violations };
}

function evaluateCandidate(candidate: Candidate, options: SearchOptions): Candidate {
  setBalanceProfile(candidate.profile);
  const distSums = new Array(LEVEL_COUNT).fill(0);
  let sampleCount = 0;

  for (const seed of options.seeds) {
    const engine = new SimulationEngine(seed, options.initialPop);
    for (let year = 0; year < options.totalYears; year++) {
      engine.tickYear(false);
      if (year < options.warmupYears) continue;
      const totalPopulation = engine.aliveCount;
      if (totalPopulation <= 0) continue;
      for (let level = 0; level < LEVEL_COUNT; level++) {
        distSums[level] += (engine.levelGroups[level].size / totalPopulation) * 100;
      }
      sampleCount++;
    }
  }

  const breakthroughCurve = collectBreakthroughCurve();
  const curveScore = scoreBreakthroughCurve(breakthroughCurve);
  resetBalanceProfile();
  if (sampleCount === 0) {
    return {
      ...candidate,
      score: Number.POSITIVE_INFINITY,
      avgDist: new Array(LEVEL_COUNT).fill(0),
      breakthroughCurve,
      violations: LEVEL_COUNT + curveScore.violations,
      monotonicViolations: curveScore.violations,
    };
  }

  const avgDist = distSums.map(value => value / sampleCount);
  const distScore = scoreDistribution(avgDist);
  return {
    ...candidate,
    score: distScore.score + curveScore.score,
    avgDist,
    breakthroughCurve,
    violations: distScore.violations + curveScore.violations,
    monotonicViolations: curveScore.violations,
  };
}

function printCandidate(label: string, candidate: Candidate): void {
  if (!candidate.avgDist || candidate.score === undefined || candidate.violations === undefined) return;
  const summary = candidate.avgDist
    .map((actual, level) => `${LEVEL_NAMES[level]}=${actual.toFixed(4)}%`)
    .join(', ');
  const curveSummary = candidate.breakthroughCurve
    ?.map((chance, level) => `Lv${level}=${(chance * 100).toFixed(3)}%`)
    .join(', ') ?? '';
  console.log(
    `${label} score=${candidate.score.toFixed(4)} violations=${candidate.violations}` +
    ` monotonic=${candidate.monotonicViolations ?? 0} :: ${summary}`,
  );
  console.log(`breakthroughCurve :: ${curveSummary}`);
  console.log(JSON.stringify(candidate.profile, null, 2));
}

function parseArgs(): SearchOptions {
  const options = { ...DEFAULT_OPTIONS };
  for (const arg of process.argv.slice(2)) {
    const [key, raw] = arg.replace(/^--/, '').split('=');
    if (!raw) continue;
    switch (key) {
      case 'years': options.totalYears = Number(raw); break;
      case 'warmup': options.warmupYears = Number(raw); break;
      case 'pop': options.initialPop = Number(raw); break;
      case 'iterations': options.iterations = Number(raw); break;
      case 'survivors': options.survivors = Number(raw); break;
      case 'refinements': options.refinements = Number(raw); break;
      case 'seeds': options.seeds = raw.split(',').map(Number).filter(Number.isFinite); break;
      case 'base': options.baseFile = raw; break;
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const rng = mulberry32(20260306);
  let nextId = 1;
  const baseCandidate = options.baseFile
    ? candidateFromProfile(nextId++, JSON.parse(readFileSync(options.baseFile, 'utf8')) as BalanceProfileInput)
    : defaultCandidate(nextId++);
  let population = [baseCandidate];
  while (population.length < options.iterations) population.push(candidateFromRandom(rng, nextId++));
  let evaluated = population.map(candidate => evaluateCandidate(candidate, options));
  evaluated.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
  printCandidate('initial-best', evaluated[0]);

  for (let step = 0; step < options.refinements; step++) {
    const survivors = evaluated.slice(0, options.survivors);
    const scale = 1 / (step + 2);
    const mutations: Candidate[] = [];
    while (mutations.length < options.iterations) {
      const parent = survivors[mutations.length % survivors.length];
      mutations.push(mutateCandidate(parent, rng, nextId++, scale));
    }
    evaluated = [...survivors, ...mutations].map(candidate => evaluateCandidate(candidate, options));
    evaluated.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
    printCandidate(`refine-${step + 1}`, evaluated[0]);
  }

  printCandidate('best', evaluated[0]);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

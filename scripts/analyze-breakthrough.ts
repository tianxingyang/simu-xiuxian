import { DEFAULT_BALANCE_PRESET_ID } from '../src/balance';
import { breakthroughChance, LEVEL_COUNT, LEVEL_NAMES, threshold } from '../src/constants';
import { SimulationEngine } from '../src/engine/simulation';

type AnalysisOptions = {
  totalYears: number;
  warmupYears: number;
  initialPop: number;
  seeds: number[];
};

const DEFAULT_OPTIONS: AnalysisOptions = {
  totalYears: 100_000,
  warmupYears: 2_000,
  initialPop: 10_000,
  seeds: [42, 137, 256],
};

function parseArgs(): AnalysisOptions {
  const options = { ...DEFAULT_OPTIONS };
  for (const arg of process.argv.slice(2)) {
    const [key, raw] = arg.replace(/^--/, '').split('=');
    if (!raw) continue;
    switch (key) {
      case 'years': options.totalYears = Number(raw); break;
      case 'warmup': options.warmupYears = Number(raw); break;
      case 'pop': options.initialPop = Number(raw); break;
      case 'seeds': options.seeds = raw.split(',').map(Number).filter(Number.isFinite); break;
    }
  }
  return options;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function analyzeCurve(): void {
  console.log(`Preset: ${DEFAULT_BALANCE_PRESET_ID}`);
  console.log('Breakthrough curve:');
  let monotonic = true;
  for (let level = 0; level < LEVEL_COUNT - 1; level++) {
    const chance = breakthroughChance(level);
    const prev = level === 0 ? null : breakthroughChance(level - 1);
    const delta = prev === null ? '' : `  delta=${((chance - prev) * 100).toFixed(3)}pp`;
    if (prev !== null && chance >= prev) monotonic = false;
    console.log(
      `  Lv${level} ${LEVEL_NAMES[level]} -> Lv${level + 1} ${LEVEL_NAMES[level + 1]}:` +
      ` threshold=${threshold(level + 1)}, chance=${formatPercent(chance)}${delta}`,
    );
  }
  console.log(`Monotonic decreasing: ${monotonic ? 'yes' : 'no'}`);
}

function analyzeSimulation(options: AnalysisOptions): void {
  const distSums = new Array(LEVEL_COUNT).fill(0);
  const successSums = new Array(LEVEL_COUNT - 1).fill(0);
  let sampleCount = 0;

  for (const seed of options.seeds) {
    const engine = new SimulationEngine(seed, options.initialPop);
    for (let year = 0; year < options.totalYears; year++) {
      engine.tickYear(false);
      if (year < options.warmupYears) continue;
      const summary = engine.getSummary();
      if (summary.totalPopulation <= 0) continue;
      for (let level = 0; level < LEVEL_COUNT; level++) {
        distSums[level] += summary.levelCounts[level] / summary.totalPopulation;
      }
      for (let level = 0; level < LEVEL_COUNT - 1; level++) {
        successSums[level] += summary.promotions[level + 1];
      }
      sampleCount++;
    }
  }

  if (sampleCount === 0) {
    console.log('No post-warmup samples collected.');
    return;
  }

  console.log(
    `Steady-state averages (${sampleCount} samples, years=${options.totalYears}, warmup=${options.warmupYears},` +
    ` pop=${options.initialPop}, seeds=${options.seeds.join(',')}):`,
  );
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const avgShare = distSums[level] / sampleCount;
    console.log(`  Lv${level} ${LEVEL_NAMES[level]} population=${formatPercent(avgShare)}`);
  }
  console.log('Average successful promotions per sampled year:');
  for (let level = 0; level < LEVEL_COUNT - 1; level++) {
    console.log(
      `  Lv${level} ${LEVEL_NAMES[level]} -> Lv${level + 1} ${LEVEL_NAMES[level + 1]}: ` +
      `${(successSums[level] / sampleCount).toFixed(3)}`,
    );
  }
}

function main(): void {
  const options = parseArgs();
  analyzeCurve();
  console.log('');
  analyzeSimulation(options);
}

main();

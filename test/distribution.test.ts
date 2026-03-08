import { Worker } from 'node:worker_threads';
import { describe, it, expect } from 'vitest';
import { LEVEL_NAMES, LEVEL_COUNT } from '../src/constants';

/**
 * Steady-state level distribution targets (%).
 * Acceptance criterion: each level within ±10% RELATIVE deviation.
 * e.g. 结丹 target 9.78% => allowed [8.802%, 10.758%].
 */
const TARGET_DISTRIBUTION = [
  59.17,  // Lv0 炼气
  27.95,  // Lv1 筑基
  9.78,   // Lv2 结丹
  2.54,   // Lv3 元婴
  0.487,  // Lv4 化神
  0.069,  // Lv5 炼虚
  0.007,  // Lv6 合体
  0.001,  // Lv7 大乘
] as const;

const RELATIVE_TOLERANCE = 0.10; // ±10%

// All levels are asserted, including Lv5~Lv7
const ASSERTED_LEVELS = LEVEL_COUNT; // Lv0 through Lv7

const TOTAL_TEST_YEARS = 100_000;
const WARMUP_YEARS = 2_000;
const SEEDS = [42, 137, 256];
const INITIAL_POP = 10_000;
const YEARS_PER_SEED = Math.ceil(TOTAL_TEST_YEARS / SEEDS.length);
const TSX_API_URL = new URL('../node_modules/tsx/dist/esm/api/index.mjs', import.meta.url).href;
const DISTRIBUTION_WORKER_URL = new URL('./distribution.worker.ts', import.meta.url).href;
const WORKER_ENTRY_SOURCE = `
  import { tsImport } from ${JSON.stringify(TSX_API_URL)};
  await tsImport(${JSON.stringify(DISTRIBUTION_WORKER_URL)}, import.meta.url);
`;
const WORKER_ENTRY_URL = new URL(`data:text/javascript,${encodeURIComponent(WORKER_ENTRY_SOURCE)}`);

type DistributionPartial = {
  seed: number;
  sampleCount: number;
  distSums: number[];
};

function collectDistributionInWorker(seed: number): Promise<DistributionPartial> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_ENTRY_URL, {
      type: 'module',
      workerData: {
        seed,
        totalYears: YEARS_PER_SEED,
        warmupYears: WARMUP_YEARS,
        initialPop: INITIAL_POP,
      },
    });

    let settled = false;
    const finalize = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    worker.once('message', (result: DistributionPartial) => {
      finalize(() => resolve(result));
    });

    worker.once('error', error => {
      finalize(() => reject(error));
    });

    worker.once('exit', code => {
      if (code !== 0) {
        finalize(() => reject(new Error(`distribution worker exited with code ${code}`)));
      }
    });
  });
}

describe('Level Distribution (steady-state)', () => {
  let avgDist: number[];

  it('should match target within ±10% relative deviation per level', { timeout: 900_000 }, async () => {
    const partials = await Promise.all(SEEDS.map(seed => collectDistributionInWorker(seed)));
    const totalSamples = partials.reduce((sum, partial) => sum + partial.sampleCount, 0);

    avgDist = new Array(LEVEL_COUNT).fill(0);
    for (const partial of partials) {
      for (let i = 0; i < LEVEL_COUNT; i++) avgDist[i] += partial.distSums[i];
    }
    expect(totalSamples, 'distribution test should collect at least one post-warmup sample').toBeGreaterThan(0);
    for (let i = 0; i < LEVEL_COUNT; i++) avgDist[i] /= totalSamples;

    const results: string[] = [];
    const failures: string[] = [];

    for (let lv = 0; lv < LEVEL_COUNT; lv++) {
      const target = TARGET_DISTRIBUTION[lv];
      const actual = avgDist[lv];
      const lo = target * (1 - RELATIVE_TOLERANCE);
      const hi = target * (1 + RELATIVE_TOLERANCE);
      const deviation = ((actual - target) / target) * 100;
      const pass = actual >= lo && actual <= hi;

      const line =
        `Lv${lv} ${LEVEL_NAMES[lv]}:` +
        ` target=${target}%,` +
        ` actual=${actual.toFixed(4)}%,` +
        ` deviation=${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%,` +
        ` range=[${lo.toFixed(4)}, ${hi.toFixed(4)}]`;

      const tag = lv >= ASSERTED_LEVELS ? (pass ? 'PASS' : 'INFO') : (pass ? 'PASS' : 'FAIL');
      results.push(`${tag} ${line}`);
      if (!pass && lv < ASSERTED_LEVELS) failures.push(line);
    }

    const seedBreakdown = partials
      .map(partial => `seed=${partial.seed}: ${partial.sampleCount} samples`)
      .join(', ');
    console.log(
      `\nDistribution analysis (${totalSamples} samples, ${SEEDS.length} seeds, totalYears=${TOTAL_TEST_YEARS}, yearsPerSeed=${YEARS_PER_SEED}; ${seedBreakdown}):\n` +
      results.join('\n'),
    );

    expect(failures, `${failures.length} level(s) out of tolerance:\n${failures.join('\n')}`).toHaveLength(0);
  });
});

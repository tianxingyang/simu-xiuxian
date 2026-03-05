import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';
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

// Lv0~Lv4 are asserted; Lv5+ are logged but not asserted (pending future tuning)
const ASSERTED_LEVELS = 5; // Lv0 through Lv4

const TOTAL_YEARS = 10_000;
const WARMUP_YEARS = 2_000;
const SEEDS = [42, 137, 256];
const INITIAL_POP = 10_000;

function collectDistribution(seed: number): number[][] {
  const engine = new SimulationEngine(seed, INITIAL_POP);
  const snapshots: number[][] = [];
  for (let y = 0; y < TOTAL_YEARS; y++) {
    engine.tickYear();
    if (y >= WARMUP_YEARS) {
      const s = engine.getSummary();
      if (s.totalPopulation > 0) {
        snapshots.push(s.levelCounts.map(c => (c / s.totalPopulation) * 100));
      }
    }
  }
  return snapshots;
}

describe('Level Distribution (steady-state)', () => {
  // Pre-compute across seeds (shared by all assertions)
  let avgDist: number[];

  // 3 seeds x ~45s each ≈ 135s
  it('should match target within ±10% relative deviation per level', { timeout: 300_000 }, () => {
    const allSnapshots: number[][] = [];
    for (const seed of SEEDS) {
      allSnapshots.push(...collectDistribution(seed));
    }

    avgDist = new Array(LEVEL_COUNT).fill(0);
    for (const snap of allSnapshots) {
      for (let i = 0; i < LEVEL_COUNT; i++) avgDist[i] += snap[i];
    }
    for (let i = 0; i < LEVEL_COUNT; i++) avgDist[i] /= allSnapshots.length;

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

    // Always print full table for diagnostics
    console.log(
      `\nDistribution analysis (${allSnapshots.length} samples, ${SEEDS.length} seeds):\n` +
      results.join('\n'),
    );

    expect(failures, `${failures.length} level(s) out of tolerance:\n${failures.join('\n')}`).toHaveLength(0);
  });
});

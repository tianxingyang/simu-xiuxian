import type { Cultivator } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';
import type { CharacterMemory } from './memory.js';

const MAX_LEVEL = 7;

/**
 * Extract normalized state vector from a cultivator and its environment.
 * Returns number[] matching the feature order in ai-policy/config.json.
 * All values normalized to [0, 1].
 *
 * When memory is provided (non-null), 6 additional dimensions are appended:
 *   [12] confidence, [13] caution, [14] ambition,
 *   [15] bloodlust, [16] rootedness, [17] breakthroughFear
 */
export function extractState(
  c: Cultivator,
  year: number,
  cellSpiritualEnergy: number,
  cellDanger: number,
  thresholdForNextLevel: number,
  mem?: CharacterMemory | null,
): number[] {
  const maxCooldown = getSimTuning().breakthroughFailure.cooldown;

  const remainingLifespanRatio = c.maxAge > 0 ? Math.max(0, (c.maxAge - c.age) / c.maxAge) : 0;
  const cultivationProgress = thresholdForNextLevel > 0 ? Math.min(1, c.cultivation / thresholdForNextLevel) : 1;
  const levelNormalized = c.level / MAX_LEVEL;
  const courage = c.courage;
  const isHeavyInjured = c.injuredUntil > year ? 1 : 0;
  const isLightInjured = c.lightInjuryUntil > year ? 1 : 0;
  const isMeridianDamaged = c.meridianDamagedUntil > year ? 1 : 0;
  const breakthroughReady =
    c.cultivation >= thresholdForNextLevel
    && c.breakthroughCooldownUntil <= year
    && c.injuredUntil <= year
      ? 1 : 0;
  const spiritualEnergy = cellSpiritualEnergy / 5;
  const dangerLevel = cellDanger / 5;
  const breakthroughCooldown = c.breakthroughCooldownUntil > year
    ? Math.min(1, (c.breakthroughCooldownUntil - year) / maxCooldown)
    : 0;
  const ageRatio = c.maxAge > 0 ? Math.min(1, c.age / c.maxAge) : 1;

  const base = [
    remainingLifespanRatio,
    cultivationProgress,
    levelNormalized,
    courage,
    isHeavyInjured,
    isLightInjured,
    isMeridianDamaged,
    breakthroughReady,
    spiritualEnergy,
    dangerLevel,
    breakthroughCooldown,
    ageRatio,
  ];

  if (mem) {
    base.push(
      mem.confidence,
      mem.caution,
      mem.ambition,
      mem.bloodlust,
      mem.rootedness,
      mem.breakthroughFear,
    );
  }

  return base;
}

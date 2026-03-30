import type { Cultivator } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';

const MAX_LEVEL = 7;

/**
 * Extract normalized state vector from a cultivator and its environment.
 * Returns number[] matching the feature order in ai-policy/config.json.
 * All values normalized to [0, 1].
 */
export function extractState(
  c: Cultivator,
  year: number,
  cellSpiritualEnergy: number,
  cellDanger: number,
  thresholdForNextLevel: number,
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

  return [
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
}

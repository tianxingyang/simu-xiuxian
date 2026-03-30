import type { Cultivator } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';
import type { CharacterMemory } from './memory.js';
import type { CharacterRelationships } from './relationship.js';
import {
  strongestAllyStrength, maxRivalIntensity, hasAnyVendetta,
  MAX_DISCIPLES,
} from './relationship.js';

const MAX_LEVEL = 7;

export interface RelationshipContext {
  rel: CharacterRelationships;
  allyNearby: boolean;
  rivalNearby: boolean;
  vendettaTargetNearby: boolean;
  isFellowDisciple: boolean;
}

export function extractState(
  c: Cultivator,
  year: number,
  cellSpiritualEnergy: number,
  cellDanger: number,
  thresholdForNextLevel: number,
  mem?: CharacterMemory | null,
  relCtx?: RelationshipContext | null,
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

  if (relCtx) {
    const rel = relCtx.rel;
    base.push(
      rel.mentor >= 0 ? 1 : 0,
      rel.discipleCount / MAX_DISCIPLES,
      relCtx.allyNearby ? 1 : 0,
      strongestAllyStrength(rel),
      relCtx.rivalNearby ? 1 : 0,
      maxRivalIntensity(rel),
      hasAnyVendetta(rel) ? 1 : 0,
      relCtx.vendettaTargetNearby ? 1 : 0,
      relCtx.isFellowDisciple ? 1 : 0,
    );
  }

  return base;
}

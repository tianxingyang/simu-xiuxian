import {
  DEFAULT_BALANCE_PROFILE,
  gaussianContribution,
  getBalanceProfile,
  getBalanceRevision,
  sigmoidContribution,
} from './balance';
import type { Cultivator } from './types';

export const LEVEL_NAMES = [
  '炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘',
] as const;

export const LEVEL_COUNT = LEVEL_NAMES.length;
export const MORTAL_MAX_AGE = 60;
export const YEARLY_NEW = 1000;
export const LOOT_BASE_RATE = 0.28;
export const LOOT_VARIABLE_RATE = 0.24;
export const LUCK_MEAN = 1.0;
export const LUCK_STDDEV = 0.3;
export const LUCK_MIN = 0;
export const LUCK_MAX = 2.5;
export const MAX_EVENTS = 1000;
export const MAX_TREND_POINTS = 2000;
export const EVENTS_PER_TICK = 50;

export const COURAGE_TROUGH = 0.3;
export const COURAGE_YOUNG_AMP = 0.1;
export const COURAGE_OLD_AMP = 0.3;
export const COURAGE_MEAN = 0.5;
export const COURAGE_STDDEV = 0.15;
export const EVASION_SENSITIVITY = 0.5;
export const EVASION_PENALTY = 0.05;

export const DEFEAT_DEATH_BASE = 0.40;
export const DEFEAT_DEATH_DECAY = 0.80;
export const DEFEAT_GAP_SEVERITY = 0.3;
export const DEFEAT_MAX_DEATH = 0.95;
export const DEFEAT_DEMOTION_W = 0.4;
export const DEFEAT_INJURY_W = 2.9;
export const DEFEAT_CULT_LOSS_W = 2.0;
export const DEFEAT_LIGHT_INJURY_W = 4.0;
export const DEFEAT_MERIDIAN_W = 1.0;
export const DEFEAT_CULT_LOSS_RATE = 0.3;
export const INJURY_DURATION = 5;
export const INJURY_GROWTH_RATE = 0.5;
export const LIGHT_INJURY_DURATION = 2;
export const LIGHT_INJURY_GROWTH_RATE = 0.7;
export const MERIDIAN_DAMAGE_DURATION = 10;
export const MERIDIAN_COMBAT_PENALTY = 0.3;
export const LIFESPAN_DECAY_RATE = 0.2;

export const BREAKTHROUGH_A = DEFAULT_BALANCE_PROFILE.breakthrough.a;
export const BREAKTHROUGH_B = DEFAULT_BALANCE_PROFILE.breakthrough.b;
export const BREAKTHROUGH_COOLDOWN = 3;
export const BREAKTHROUGH_CULT_LOSS_RATE = 0.2;
export const BREAKTHROUGH_NOTHING_W = 5.0;
export const BREAKTHROUGH_CULT_LOSS_W = 2.0;
export const BREAKTHROUGH_INJURY_W = 2.0;

export const LV7_MAX_AGE = 100_000;

const EARLY_SUSTAINABLE_MAX_AGE = [
  60, 150, 1_070, 11_070,
] as const;

const LEGACY_LIFESPAN_BONUS = [
  0, 100, 1_000, 10_000,
] as const;

const HIGH_LEVEL_AGE_START = EARLY_SUSTAINABLE_MAX_AGE.length - 1;
const HIGH_LEVEL_AGE_SPAN = LEVEL_COUNT - 1 - HIGH_LEVEL_AGE_START;

function interpolateLogScale(start: number, end: number, progress: number): number {
  if (start <= 0 || end <= 0) return Math.round(start + (end - start) * progress);
  return Math.round(start * Math.exp(Math.log(end / start) * progress));
}

function sustainableMaxAge(level: number): number {
  const lv = Math.trunc(level);
  if (lv <= 0) return MORTAL_MAX_AGE;
  if (lv < EARLY_SUSTAINABLE_MAX_AGE.length) return EARLY_SUSTAINABLE_MAX_AGE[lv];

  const startAge = EARLY_SUSTAINABLE_MAX_AGE[HIGH_LEVEL_AGE_START];
  if (HIGH_LEVEL_AGE_SPAN <= 0) return LV7_MAX_AGE;
  const progress = (lv - HIGH_LEVEL_AGE_START) / HIGH_LEVEL_AGE_SPAN;
  return interpolateLogScale(startAge, LV7_MAX_AGE, progress);
}

export const SUSTAINABLE_MAX_AGE: readonly number[] = Object.freeze(
  Array.from({ length: LEVEL_COUNT }, (_, level) => sustainableMaxAge(level)),
);

const THRESHOLD_LOG_CORR_COEFF = [
  0.3715635564324824,
  0.056458557592892256,
  -0.5746050492793122,
  -0.0025278639621033328,
  0.1614363053810571,
  -0.0012504358018764136,
  -0.011075070363141586,
] as const;

const THRESHOLD_CACHE: number[] = Array.from({ length: LEVEL_COUNT }, () => Number.NaN);
THRESHOLD_CACHE[0] = 0;
let thresholdCacheRevision = -1;

function thresholdLogCorrection(x: number): number {
  const [c0, c1, c2, c3, c4, c5, c6] = THRESHOLD_LOG_CORR_COEFF;
  return ((((((c6 * x + c5) * x + c4) * x + c3) * x + c2) * x + c1) * x + c0);
}

function computeThresholdWithTail(level: number, tailBoost: number): number {
  if (level <= 0) return 0;
  const x = level - 4;
  const base = 10 ** level * Math.exp(thresholdLogCorrection(x));
  return Math.max(0, Math.round(base * Math.exp(tailBoost)));
}

function ensureThresholdCache(): void {
  const revision = getBalanceRevision();
  if (revision === thresholdCacheRevision) return;
  THRESHOLD_CACHE.fill(Number.NaN);
  THRESHOLD_CACHE[0] = 0;
  thresholdCacheRevision = revision;
}

function computeThreshold(level: number): number {
  const profile = getBalanceProfile();
  const tailBoost = sigmoidContribution(level, profile.threshold.tailBoost);
  const gateBoost = gaussianContribution(level, profile.threshold.gateBoost);
  const peakBoost = gaussianContribution(level, profile.threshold.peakBoost);
  const reliefBoost = gaussianContribution(level, profile.threshold.reliefBoost);
  const finalRelief = gaussianContribution(level, profile.threshold.finalRelief);
  return computeThresholdWithTail(level, tailBoost + gateBoost + peakBoost + reliefBoost + finalRelief);
}

export function threshold(level: number): number {
  const lv = Math.trunc(level);
  if (lv <= 0) return 0;
  ensureThresholdCache();
  if (lv < LEVEL_COUNT) {
    const cached = THRESHOLD_CACHE[lv];
    if (!Number.isNaN(cached)) return cached;
    const v = computeThreshold(lv);
    THRESHOLD_CACHE[lv] = v;
    return v;
  }
  return computeThreshold(lv);
}

export const THRESHOLDS: readonly number[] = Object.freeze(
  Array.from({ length: LEVEL_COUNT }, (_, level) => {
    const tailBoost = sigmoidContribution(level, DEFAULT_BALANCE_PROFILE.threshold.tailBoost);
    const gateBoost = gaussianContribution(level, DEFAULT_BALANCE_PROFILE.threshold.gateBoost);
    const peakBoost = gaussianContribution(level, DEFAULT_BALANCE_PROFILE.threshold.peakBoost);
    const reliefBoost = gaussianContribution(level, DEFAULT_BALANCE_PROFILE.threshold.reliefBoost);
    const finalRelief = gaussianContribution(level, DEFAULT_BALANCE_PROFILE.threshold.finalRelief);
    return computeThresholdWithTail(level, tailBoost + gateBoost + peakBoost + reliefBoost + finalRelief);
  }),
);

export function lifespanBonus(level: number): number {
  const lv = Math.trunc(level);
  if (lv <= 0) return 0;
  if (lv < LEGACY_LIFESPAN_BONUS.length) return LEGACY_LIFESPAN_BONUS[lv];
  return Math.max(0, SUSTAINABLE_MAX_AGE[lv] - SUSTAINABLE_MAX_AGE[lv - 1]);
}

export function breakthroughChance(level: number): number {
  const profile = getBalanceProfile();
  const tailPenalty = sigmoidContribution(level, profile.breakthrough.tailPenalty);
  const gatePenalty = gaussianContribution(level, profile.breakthrough.gatePenalty);
  return Math.exp(-(profile.breakthrough.a + profile.breakthrough.b * (2 * level + 1) + tailPenalty + gatePenalty));
}

export function tribulationChance(yearsAtMaxLevel: number): number {
  const profile = getBalanceProfile();
  return sigmoidContribution(yearsAtMaxLevel, profile.tribulation.chance);
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function effectiveCourage(c: Cultivator): number {
  const t = c.age / c.maxAge;
  const boost = t < COURAGE_TROUGH
    ? COURAGE_YOUNG_AMP * (1 - t / COURAGE_TROUGH) ** 2
    : COURAGE_OLD_AMP * ((t - COURAGE_TROUGH) / (1 - COURAGE_TROUGH)) ** 2;
  return round2(Math.min(1, c.courage + boost));
}

export const MAP_SIZE = 32;
export const MAP_MASK = MAP_SIZE - 1;
export const ENCOUNTER_RADIUS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 16] as const;
export const WANDER_BASE_PROB = 0.15;
export const WANDER_LEVEL_BONUS = 0.03;
export const FLEE_DISTANCE: readonly [number, number] = [2, 3];
export const BREAKTHROUGH_MOVE: readonly [number, number] = [2, 4];

export const LEVEL_COLORS = [
  '#555',
  '#7fb069',
  '#5ab0c4',
  '#6c8cff',
  '#a67bff',
  '#ff9b4e',
  '#ff5c5c',
  '#ffd700',
] as const;

import { LEVEL_COUNT } from './level';

export const MORTAL_MAX_AGE = 60;
export const LV7_MAX_AGE = 100_000;
export const LIFESPAN_DECAY_RATE = 0.2;

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

export function lifespanBonus(level: number): number {
  const lv = Math.trunc(level);
  if (lv <= 0) return 0;
  if (lv < LEGACY_LIFESPAN_BONUS.length) return LEGACY_LIFESPAN_BONUS[lv];
  return Math.max(0, SUSTAINABLE_MAX_AGE[lv] - SUSTAINABLE_MAX_AGE[lv - 1]);
}

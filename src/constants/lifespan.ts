import { DEFAULT_SIM_TUNING, getSimTuning } from '../sim-tuning.js';
import { LEVEL_COUNT } from './level.js';

export const MORTAL_MAX_AGE = DEFAULT_SIM_TUNING.lifespan.mortalMaxAge;
export const LV7_MAX_AGE = DEFAULT_SIM_TUNING.lifespan.lv7MaxAge;
export const LIFESPAN_DECAY_RATE = DEFAULT_SIM_TUNING.lifespan.lifespanDecayRate;

const EARLY_SUSTAINABLE_MAX_AGE = DEFAULT_SIM_TUNING.lifespan.earlySustainableMaxAge as readonly number[];

const HIGH_LEVEL_AGE_START = EARLY_SUSTAINABLE_MAX_AGE.length - 1;
const HIGH_LEVEL_AGE_SPAN = LEVEL_COUNT - 1 - HIGH_LEVEL_AGE_START;

function interpolateLogScale(start: number, end: number, progress: number): number {
  if (start <= 0 || end <= 0) return Math.round(start + (end - start) * progress);
  return Math.round(start * Math.exp(Math.log(end / start) * progress));
}

function sustainableMaxAgeFromConfig(level: number, mortalMaxAge: number, lv7MaxAge: number, earlyAges: readonly number[]): number {
  const lv = Math.trunc(level);
  if (lv <= 0) return mortalMaxAge;
  if (lv < earlyAges.length) return earlyAges[lv];

  const startAge = earlyAges[HIGH_LEVEL_AGE_START];
  if (HIGH_LEVEL_AGE_SPAN <= 0) return lv7MaxAge;
  const progress = (lv - HIGH_LEVEL_AGE_START) / HIGH_LEVEL_AGE_SPAN;
  return interpolateLogScale(startAge, lv7MaxAge, progress);
}

export function sustainableMaxAge(level: number): number {
  const tuning = getSimTuning().lifespan;
  return sustainableMaxAgeFromConfig(level, tuning.mortalMaxAge, tuning.lv7MaxAge, tuning.earlySustainableMaxAge);
}

export const SUSTAINABLE_MAX_AGE: readonly number[] = Object.freeze(
  Array.from({ length: LEVEL_COUNT }, (_, level) => sustainableMaxAge(level)),
);

export function lifespanBonus(level: number): number {
  const tuning = getSimTuning().lifespan;
  const lv = Math.trunc(level);
  if (lv <= 0) return 0;
  if (lv < tuning.legacyLifespanBonus.length) return tuning.legacyLifespanBonus[lv];
  return Math.max(0, sustainableMaxAge(lv) - sustainableMaxAge(lv - 1));
}

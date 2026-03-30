import type { BehaviorState, Cultivator } from '../types.js';
import { DEFAULT_SIM_TUNING, getSimTuning } from '../sim-tuning.js';
import { round2 } from './utils.js';

export const COURAGE_TROUGH = DEFAULT_SIM_TUNING.courage.trough;
export const COURAGE_YOUNG_AMP = DEFAULT_SIM_TUNING.courage.youngAmp;
export const COURAGE_OLD_AMP = DEFAULT_SIM_TUNING.courage.oldAmp;
export const COURAGE_MEAN = DEFAULT_SIM_TUNING.courage.mean;
export const COURAGE_STDDEV = DEFAULT_SIM_TUNING.courage.stddev;
export const EVASION_SENSITIVITY = DEFAULT_SIM_TUNING.courage.evasionSensitivity;
export const EVASION_PENALTY = DEFAULT_SIM_TUNING.courage.evasionPenalty;

export const BEHAVIOR_COURAGE_FACTOR: Readonly<Record<BehaviorState, number>> = {
  escaping: DEFAULT_SIM_TUNING.courage.behaviorFactors.escaping,
  recuperating: DEFAULT_SIM_TUNING.courage.behaviorFactors.recuperating,
  seeking_breakthrough: DEFAULT_SIM_TUNING.courage.behaviorFactors.seeking_breakthrough,
  settling: DEFAULT_SIM_TUNING.courage.behaviorFactors.settling,
  wandering: DEFAULT_SIM_TUNING.courage.behaviorFactors.wandering,
};

export function effectiveCourage(c: Cultivator): number {
  const tuning = getSimTuning().courage;
  const t = c.age / c.maxAge;
  const boost = t < tuning.trough
    ? tuning.youngAmp * (1 - t / tuning.trough) ** 2
    : tuning.oldAmp * ((t - tuning.trough) / (1 - tuning.trough)) ** 2;
  const base = round2(Math.min(1, c.courage + boost));
  const factor = tuning.behaviorFactors[c.behaviorState];
  return round2(base * factor);
}

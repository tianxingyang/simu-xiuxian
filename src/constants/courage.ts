import type { BehaviorState, Cultivator } from '../types';
import { round2 } from './utils';

export const COURAGE_TROUGH = 0.3;
export const COURAGE_YOUNG_AMP = 0.1;
export const COURAGE_OLD_AMP = 0.3;
export const COURAGE_MEAN = 0.5;
export const COURAGE_STDDEV = 0.15;
export const EVASION_SENSITIVITY = 0.5;
export const EVASION_PENALTY = 0.05;

export const BEHAVIOR_COURAGE_FACTOR: Readonly<Record<BehaviorState, number>> = {
  escaping: 0.3,
  recuperating: 0.6,
  seeking_breakthrough: 1.0,
  settling: 1.0,
  wandering: 1.0,
};

export function effectiveCourage(c: Cultivator): number {
  const t = c.age / c.maxAge;
  const boost = t < COURAGE_TROUGH
    ? COURAGE_YOUNG_AMP * (1 - t / COURAGE_TROUGH) ** 2
    : COURAGE_OLD_AMP * ((t - COURAGE_TROUGH) / (1 - COURAGE_TROUGH)) ** 2;
  const base = round2(Math.min(1, c.courage + boost));
  const factor = BEHAVIOR_COURAGE_FACTOR[c.behaviorState];
  return round2(base * factor);
}

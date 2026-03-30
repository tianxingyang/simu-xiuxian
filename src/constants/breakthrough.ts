import {
  DEFAULT_BALANCE_PROFILE,
  getBalanceProfile,
  gaussianContribution,
  sigmoidContribution,
} from '../balance.js';

export const BREAKTHROUGH_A = DEFAULT_BALANCE_PROFILE.breakthrough.a;
export const BREAKTHROUGH_B = DEFAULT_BALANCE_PROFILE.breakthrough.b;
export const BREAKTHROUGH_COOLDOWN = 3;
export const BREAKTHROUGH_CULT_LOSS_RATE = 0.2;
export const BREAKTHROUGH_NOTHING_W = 5.0;
export const BREAKTHROUGH_CULT_LOSS_W = 2.0;
export const BREAKTHROUGH_INJURY_W = 2.0;

export function breakthroughChance(level: number): number {
  const profile = getBalanceProfile();
  const tailPenalty = sigmoidContribution(level, profile.breakthrough.tailPenalty);
  const gatePenalty = gaussianContribution(level, profile.breakthrough.gatePenalty);
  return Math.exp(-(profile.breakthrough.a + profile.breakthrough.b * (2 * level + 1) + tailPenalty + gatePenalty));
}

import { getBalanceProfile, sigmoidContribution } from '../balance';

export function tribulationChance(yearsAtMaxLevel: number): number {
  const profile = getBalanceProfile();
  return sigmoidContribution(yearsAtMaxLevel, profile.tribulation.chance);
}

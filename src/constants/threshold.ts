import {
  DEFAULT_BALANCE_PROFILE,
  gaussianContribution,
  getBalanceProfile,
  getBalanceRevision,
  sigmoidContribution,
} from '../balance.js';
import { LEVEL_COUNT } from './level.js';

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

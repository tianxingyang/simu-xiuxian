import type { BalanceProfile } from '../balance';

export const BALANCE_PRESET_ID_V2026_03_08 = '2026-03-08' as const;

export const BALANCE_PRESET_V2026_03_08: BalanceProfile = {
  breakthrough: {
    a: 0.454,
    b: 0.103,
    tailPenalty: {
      amplitude: 0.04,
      center: 5.8,
      steepness: 1.8,
    },
    gatePenalty: {
      amplitude: 1.53,
      center: 4.19,
      width: 0.29,
    },
  },
  threshold: {
    tailBoost: {
      amplitude: 1.25,
      center: 6.6,
      steepness: 1.74,
    },
    gateBoost: {
      amplitude: 1.42,
      center: 4.865,
      width: 0.325,
    },
    peakBoost: {
      amplitude: 1.55,
      center: 5.85,
      width: 0.39,
    },
    reliefBoost: {
      amplitude: -0.8,
      center: 7,
      width: 0.28,
    },
    finalRelief: {
      amplitude: 0,
      center: 7,
      width: 0.3,
    },
  },
  combat: {
    deathBoost: {
      amplitude: 0,
      center: 5.5,
      width: 0.7,
    },
    lootPenalty: {
      amplitude: 0.37,
      center: 5.22,
      steepness: 2,
    },
  },
  tribulation: {
    chance: {
      amplitude: 0.02,
      center: 5000,
      steepness: 0.001,
    },
    successRate: 0.12,
  },
};

import type { BalanceProfile } from '../balance.js';

export const BALANCE_PRESET_ID_V2026_03_09 = '2026-03-09' as const;

export const BALANCE_PRESET_V2026_03_09: BalanceProfile = {
  breakthrough: {
    a: 0.454,
    b: 0.085,
    tailPenalty: {
      amplitude: 1.0,
      center: 4.9,
      steepness: 2.2,
    },
    gatePenalty: {
      amplitude: 0.7,
      center: 4.7,
      width: 1.2,
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
      center: 5.75,
      width: 0.39,
    },
    reliefBoost: {
      amplitude: -0.8,
      center: 7.0,
      width: 0.28,
    },
    finalRelief: {
      amplitude: 0,
      center: 7.0,
      width: 0.2,
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

import type { BalanceProfile } from '../balance.js';

export const BALANCE_PRESET_ID_V2026_04_01 = '2026-04-01' as const;

export const BALANCE_PRESET_V2026_04_01: BalanceProfile = {
  breakthrough: {
    a: 1.796,
    b: 0.01,
    tailPenalty: {
      amplitude: 5.0,
      center: 4.9,
      steepness: 2.2,
    },
    gatePenalty: {
      amplitude: 0,
      center: 2.247,
      width: 0.678,
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

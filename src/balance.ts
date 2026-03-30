import { CURRENT_BALANCE_PRESET, CURRENT_BALANCE_PRESET_ID } from './balance-presets/index.js';

export type SigmoidCurve = {
  amplitude: number;
  center: number;
  steepness: number;
};

export type BreakthroughBalance = {
  a: number;
  b: number;
  tailPenalty: SigmoidCurve;
  gatePenalty: GaussianCurve;
};

export type ThresholdBalance = {
  tailBoost: SigmoidCurve;
  gateBoost: GaussianCurve;
  peakBoost: GaussianCurve;
  reliefBoost: GaussianCurve;
  finalRelief: GaussianCurve;
};

export type GaussianCurve = {
  amplitude: number;
  center: number;
  width: number;
};

export type CombatBalance = {
  deathBoost: GaussianCurve;
  lootPenalty: SigmoidCurve;
};

export type TribulationBalance = {
  chance: SigmoidCurve;
  successRate: number;
};

export type BalanceProfile = {
  breakthrough: BreakthroughBalance;
  threshold: ThresholdBalance;
  combat: CombatBalance;
  tribulation: TribulationBalance;
};

export type BalanceProfileInput = Partial<{
  breakthrough: Partial<BreakthroughBalance> & {
    tailPenalty?: Partial<SigmoidCurve>;
    gatePenalty?: Partial<GaussianCurve>;
  };
  threshold: Partial<ThresholdBalance> & {
    tailBoost?: Partial<SigmoidCurve>;
    gateBoost?: Partial<GaussianCurve>;
    peakBoost?: Partial<GaussianCurve>;
    reliefBoost?: Partial<GaussianCurve>;
    finalRelief?: Partial<GaussianCurve>;
  };
  combat: Partial<CombatBalance> & {
    deathBoost?: Partial<GaussianCurve>;
    lootPenalty?: Partial<SigmoidCurve>;
  };
  tribulation: Partial<TribulationBalance> & {
    chance?: Partial<SigmoidCurve>;
  };
}>;

function freezeProfile(profile: BalanceProfile): Readonly<BalanceProfile> {
  return Object.freeze({
    breakthrough: Object.freeze({
      a: profile.breakthrough.a,
      b: profile.breakthrough.b,
      tailPenalty: Object.freeze({ ...profile.breakthrough.tailPenalty }),
      gatePenalty: Object.freeze({ ...profile.breakthrough.gatePenalty }),
    }),
    threshold: Object.freeze({
      tailBoost: Object.freeze({ ...profile.threshold.tailBoost }),
      gateBoost: Object.freeze({ ...profile.threshold.gateBoost }),
      peakBoost: Object.freeze({ ...profile.threshold.peakBoost }),
      reliefBoost: Object.freeze({ ...profile.threshold.reliefBoost }),
      finalRelief: Object.freeze({ ...profile.threshold.finalRelief }),
    }),
    combat: Object.freeze({
      deathBoost: Object.freeze({ ...profile.combat.deathBoost }),
      lootPenalty: Object.freeze({ ...profile.combat.lootPenalty }),
    }),
    tribulation: Object.freeze({
      chance: Object.freeze({ ...profile.tribulation.chance }),
      successRate: profile.tribulation.successRate,
    }),
  });
}

export const DEFAULT_BALANCE_PRESET_ID = CURRENT_BALANCE_PRESET_ID;

export const DEFAULT_BALANCE_PROFILE: Readonly<BalanceProfile> = freezeProfile(CURRENT_BALANCE_PRESET);

let activeBalanceProfile: BalanceProfile = cloneProfile(DEFAULT_BALANCE_PROFILE);
let balanceRevision = 0;

function mergeCurve(base: SigmoidCurve, overrides?: Partial<SigmoidCurve>): SigmoidCurve {
  return {
    amplitude: overrides?.amplitude ?? base.amplitude,
    center: overrides?.center ?? base.center,
    steepness: overrides?.steepness ?? base.steepness,
  };
}

function mergeGaussianCurve(base: GaussianCurve, overrides?: Partial<GaussianCurve>): GaussianCurve {
  return {
    amplitude: overrides?.amplitude ?? base.amplitude,
    center: overrides?.center ?? base.center,
    width: overrides?.width ?? base.width,
  };
}

function cloneProfile(profile: Readonly<BalanceProfile>): BalanceProfile {
  return {
    breakthrough: {
      a: profile.breakthrough.a,
      b: profile.breakthrough.b,
      tailPenalty: { ...profile.breakthrough.tailPenalty },
      gatePenalty: { ...profile.breakthrough.gatePenalty },
    },
    threshold: {
      tailBoost: { ...profile.threshold.tailBoost },
      gateBoost: { ...profile.threshold.gateBoost },
      peakBoost: { ...profile.threshold.peakBoost },
      reliefBoost: { ...profile.threshold.reliefBoost },
      finalRelief: { ...profile.threshold.finalRelief },
    },
    combat: {
      deathBoost: { ...profile.combat.deathBoost },
      lootPenalty: { ...profile.combat.lootPenalty },
    },
    tribulation: {
      chance: { ...profile.tribulation.chance },
      successRate: profile.tribulation.successRate,
    },
  };
}

function mergeProfile(overrides: BalanceProfileInput = {}): BalanceProfile {
  return {
    breakthrough: {
      a: overrides.breakthrough?.a ?? DEFAULT_BALANCE_PROFILE.breakthrough.a,
      b: overrides.breakthrough?.b ?? DEFAULT_BALANCE_PROFILE.breakthrough.b,
      tailPenalty: mergeCurve(DEFAULT_BALANCE_PROFILE.breakthrough.tailPenalty, overrides.breakthrough?.tailPenalty),
      gatePenalty: mergeGaussianCurve(DEFAULT_BALANCE_PROFILE.breakthrough.gatePenalty, overrides.breakthrough?.gatePenalty),
    },
    threshold: {
      tailBoost: mergeCurve(DEFAULT_BALANCE_PROFILE.threshold.tailBoost, overrides.threshold?.tailBoost),
      gateBoost: mergeGaussianCurve(DEFAULT_BALANCE_PROFILE.threshold.gateBoost, overrides.threshold?.gateBoost),
      peakBoost: mergeGaussianCurve(DEFAULT_BALANCE_PROFILE.threshold.peakBoost, overrides.threshold?.peakBoost),
      reliefBoost: mergeGaussianCurve(DEFAULT_BALANCE_PROFILE.threshold.reliefBoost, overrides.threshold?.reliefBoost),
      finalRelief: mergeGaussianCurve(DEFAULT_BALANCE_PROFILE.threshold.finalRelief, overrides.threshold?.finalRelief),
    },
    combat: {
      deathBoost: mergeGaussianCurve(DEFAULT_BALANCE_PROFILE.combat.deathBoost, overrides.combat?.deathBoost),
      lootPenalty: mergeCurve(DEFAULT_BALANCE_PROFILE.combat.lootPenalty, overrides.combat?.lootPenalty),
    },
    tribulation: {
      chance: mergeCurve(DEFAULT_BALANCE_PROFILE.tribulation.chance, overrides.tribulation?.chance),
      successRate: overrides.tribulation?.successRate ?? DEFAULT_BALANCE_PROFILE.tribulation.successRate,
    },
  };
}

export function getBalanceProfile(): Readonly<BalanceProfile> {
  return activeBalanceProfile;
}

export function getBalanceRevision(): number {
  return balanceRevision;
}

export function setBalanceProfile(overrides: BalanceProfileInput = {}): Readonly<BalanceProfile> {
  activeBalanceProfile = mergeProfile(overrides);
  balanceRevision++;
  return activeBalanceProfile;
}

export function resetBalanceProfile(): Readonly<BalanceProfile> {
  activeBalanceProfile = cloneProfile(DEFAULT_BALANCE_PROFILE);
  balanceRevision++;
  return activeBalanceProfile;
}

export function sigmoidContribution(level: number, curve: SigmoidCurve): number {
  if (curve.amplitude === 0) return 0;
  const steepness = Math.max(1e-6, curve.steepness);
  return curve.amplitude / (1 + Math.exp(-steepness * (level - curve.center)));
}

export function gaussianContribution(level: number, curve: GaussianCurve): number {
  if (curve.amplitude === 0) return 0;
  const width = Math.max(1e-3, curve.width);
  const normalized = (level - curve.center) / width;
  return curve.amplitude * Math.exp(-0.5 * normalized * normalized);
}

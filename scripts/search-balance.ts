import { readFileSync } from 'node:fs';
import {
  DEFAULT_BALANCE_PROFILE,
  gaussianContribution,
  getBalanceProfile,
  resetBalanceProfile,
  setBalanceProfile,
  type BalanceProfile,
  type BalanceProfileInput,
} from '../src/balance';
import {
  DEFAULT_SIM_TUNING,
  cloneSimTuning,
  getSimTuning,
  resetSimTuning,
  setSimTuning,
  type SimTuning,
  type SimTuningInput,
} from '../src/sim-tuning';
import { breakthroughChance, LEVEL_COUNT, LEVEL_NAMES, sustainableMaxAge, threshold } from '../src/constants';
import { SimulationEngine } from '../src/engine/simulation';

type SearchOptions = {
  totalYears: number;
  warmupYears: number;
  initialPop: number;
  seeds: number[];
  scoredLevels: number;
  iterations: number;
  survivors: number;
  refinements: number;
  focusLevel?: number;
  searchScope: SearchScopeName;
  searchMode: SearchModeName;
  baseFile?: string;
};

type SearchProfile = {
  balance: BalanceProfile;
  tuning: SimTuning;
};

type Candidate = {
  id: number;
  profile: SearchProfile;
  score?: number;
  avgDist?: number[];
  violations?: number;
  breakthroughCurve?: number[];
  monotonicViolations?: number;
};

type RangeSpec = {
  min: number;
  max: number;
  integer?: boolean;
};

type SearchSpaceNode = RangeSpec | SearchSpaceNode[] | { [key: string]: SearchSpaceNode };
type SearchScopeName = 'full' | 'lv0' | 'lv1' | 'lv2';
type SearchModeName = 'random' | 'guided';

type LongRunConfig = {
  years?: number;
  warmup?: number;
  initialPop?: number;
  seeds?: number[];
};

type ParsedArgs = {
  options: SearchOptions;
  longRunConfig: LongRunConfig;
};

const TARGET_DISTRIBUTION = [59.17, 27.95, 9.78, 2.54, 0.487, 0.069, 0.007, 0.001] as const;
const RELATIVE_TOLERANCE = 0.10;
const MONOTONIC_BASE_PENALTY = 250;
const MONOTONIC_DIFF_WEIGHT = 10_000;
const STRUCTURAL_BASE_PENALTY = 5_000;
const STRUCTURAL_DIFF_WEIGHT = 100_000;

const DEFAULT_OPTIONS: SearchOptions = {
  totalYears: 3_000,
  warmupYears: 600,
  initialPop: 4_000,
  seeds: [42],
  scoredLevels: LEVEL_COUNT,
  iterations: 64,
  survivors: 8,
  refinements: 3,
  searchScope: 'full',
  searchMode: 'random',
};

const SEARCH_SPACE: SearchSpaceNode = {
  balance: {
    breakthrough: {
      a: { min: 0.35, max: 1.5 },
      b: { min: 0.05, max: 0.35 },
      tailPenalty: {
        amplitude: { min: 0, max: 5 },
        center: { min: 1.2, max: 6.4 },
        steepness: { min: 0.6, max: 7.0 },
      },
      gatePenalty: {
        amplitude: { min: 0, max: 4.5 },
        center: { min: 0.4, max: 6.2 },
        width: { min: 0.1, max: 2.8 },
      },
    },
    threshold: {
      tailBoost: {
        amplitude: { min: 0, max: 4.0 },
        center: { min: 1.6, max: 6.4 },
        steepness: { min: 0.6, max: 7.0 },
      },
      gateBoost: {
        amplitude: { min: 0, max: 5.0 },
        center: { min: 1.0, max: 6.2 },
        width: { min: 0.1, max: 3.0 },
      },
      peakBoost: {
        amplitude: { min: 0, max: 6.0 },
        center: { min: 3.0, max: 6.6 },
        width: { min: 0.1, max: 1.8 },
      },
      reliefBoost: {
        amplitude: { min: -4.0, max: 0 },
        center: { min: 4.6, max: 7.4 },
        width: { min: 0.1, max: 1.4 },
      },
      finalRelief: {
        amplitude: { min: -4.0, max: 0 },
        center: { min: 4.8, max: 7.3 },
        width: { min: 0.08, max: 1.2 },
      },
    },
    combat: {
      deathBoost: {
        amplitude: { min: 0, max: 3.5 },
        center: { min: 3.8, max: 6.8 },
        width: { min: 0.2, max: 2.0 },
      },
      lootPenalty: {
        amplitude: { min: 0, max: 3.5 },
        center: { min: 3.5, max: 6.8 },
        steepness: { min: 0.6, max: 7.0 },
      },
    },
    tribulation: {
      chance: {
        amplitude: { min: 0.001, max: 0.08 },
        center: { min: 500, max: 15_000, integer: true },
        steepness: { min: 0.0001, max: 0.01 },
      },
      successRate: { min: 0.01, max: 0.6 },
    },
  },
  tuning: {
    breakthroughFailure: {
      cooldown: { min: 1, max: 10, integer: true },
      cultLossRate: { min: 0, max: 0.8 },
      nothingWeight: { min: 0.2, max: 8 },
      cultLossWeight: { min: 0.2, max: 8 },
      injuryWeight: { min: 0.2, max: 8 },
    },
    combat: {
      defeatDeathBase: { min: 0.05, max: 0.95 },
      defeatDeathDecay: { min: 0.5, max: 0.99 },
      defeatGapSeverity: { min: 0, max: 1.5 },
      defeatMaxDeath: { min: 0.2, max: 0.99 },
      defeatDemotionWeight: { min: 0.05, max: 4 },
      defeatInjuryWeight: { min: 0.05, max: 8 },
      defeatCultLossWeight: { min: 0.05, max: 8 },
      defeatLightInjuryWeight: { min: 0.05, max: 8 },
      defeatMeridianWeight: { min: 0.05, max: 6 },
      defeatCultLossRate: { min: 0, max: 0.9 },
      lootBaseRate: { min: 0, max: 1 },
      lootVariableRate: { min: 0, max: 1 },
      luckMean: { min: 0.3, max: 2.0 },
      luckStddev: { min: 0.02, max: 1.2 },
      luckMin: { min: 0, max: 2 },
      luckMax: { min: 0.5, max: 5 },
      injuryDuration: { min: 1, max: 20, integer: true },
      injuryGrowthRate: { min: 0.05, max: 1.2 },
      lightInjuryDuration: { min: 1, max: 10, integer: true },
      lightInjuryGrowthRate: { min: 0.05, max: 1.2 },
      meridianDamageDuration: { min: 1, max: 40, integer: true },
      meridianCombatPenalty: { min: 0, max: 0.95 },
    },
    courage: {
      trough: { min: 0.1, max: 0.8 },
      youngAmp: { min: 0, max: 0.6 },
      oldAmp: { min: 0, max: 0.8 },
      mean: { min: 0.05, max: 0.95 },
      stddev: { min: 0.01, max: 0.45 },
      evasionSensitivity: { min: 0, max: 1.5 },
      evasionPenalty: { min: 0, max: 0.4 },
      behaviorFactors: {
        escaping: { min: 0.05, max: 1.2 },
        recuperating: { min: 0.05, max: 1.2 },
        seeking_breakthrough: { min: 0.05, max: 1.2 },
        settling: { min: 0.05, max: 1.2 },
        wandering: { min: 0.05, max: 1.2 },
      },
    },
    behavior: {
      escapingMoveProb: { min: 0, max: 1 },
      recuperatingMoveProb: { min: 0, max: 1 },
      seekingBreakthroughMoveProb: { min: 0, max: 1 },
      settlingFraction: { min: 0.01, max: 0.6 },
      evalBaseInterval: { min: 1, max: 30, integer: true },
    },
    household: {
      householdBaseGrowthRate: { min: 0, max: 0.2 },
      householdSplitThreshold: { min: 10, max: 300, integer: true },
      householdSplitCount: { min: 1, max: 12, integer: true },
      householdSplitPopulation: { min: 1, max: 50, integer: true },
      baseAwakeningRate: { min: 0.00001, max: 0.01 },
      initialHouseholdPop: { min: 1, max: 20, integer: true },
      combatCollateralPopLoss: { min: 0, max: 20, integer: true },
    },
    lifespan: {
      mortalMaxAge: { min: 30, max: 200, integer: true },
      lv7MaxAge: { min: 10_000, max: 300_000, integer: true },
      lifespanDecayRate: { min: 0.01, max: 0.8 },
      earlySustainableMaxAge: [
        { min: 30, max: 200, integer: true },
        { min: 100, max: 1_000, integer: true },
        { min: 500, max: 10_000, integer: true },
        { min: 5_000, max: 50_000, integer: true },
      ],
      legacyLifespanBonus: [
        { min: 0, max: 0, integer: true },
        { min: 10, max: 1_000, integer: true },
        { min: 100, max: 10_000, integer: true },
        { min: 1_000, max: 50_000, integer: true },
      ],
    },
    spatial: {
      encounterRadius: [
        { min: 1, max: 4, integer: true },
        { min: 1, max: 6, integer: true },
        { min: 1, max: 8, integer: true },
        { min: 2, max: 10, integer: true },
        { min: 2, max: 12, integer: true },
        { min: 3, max: 14, integer: true },
        { min: 4, max: 16, integer: true },
        { min: 4, max: 16, integer: true },
      ],
      wanderBaseProb: { min: 0, max: 1 },
      wanderLevelBonus: { min: 0, max: 0.2 },
      breakthroughMove: [
        { min: 1, max: 8, integer: true },
        { min: 1, max: 16, integer: true },
      ],
    },
    terrain: {
      terrainSafetyFactor: [
        { min: 0, max: 0, integer: true },
        { min: 0.1, max: 2.5 },
        { min: 0.1, max: 2.5 },
        { min: 0.1, max: 2.5 },
        { min: 0.1, max: 2.5 },
        { min: 0.1, max: 2.5 },
      ],
      spiritualEnergyAwakeningFactor: [
        { min: 0, max: 0, integer: true },
        { min: 0.1, max: 4 },
        { min: 0.1, max: 4 },
        { min: 0.1, max: 4 },
        { min: 0.1, max: 4 },
        { min: 0.1, max: 4 },
      ],
      spiritualEnergyBreakthroughFactor: [
        { min: 0, max: 0, integer: true },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
      ],
      terrainDangerEncounterFactor: [
        { min: 0, max: 0, integer: true },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
        { min: 0.1, max: 3 },
      ],
      terrainDangerEvasionAdjust: [
        { min: 0, max: 0, integer: true },
        { min: -0.5, max: 0.5 },
        { min: -0.5, max: 0.5 },
        { min: -0.5, max: 0.5 },
        { min: -0.5, max: 0.5 },
        { min: -0.5, max: 0.5 },
      ],
    },
    settlement: {
      expandThreshold: { min: 100, max: 5_000, integer: true },
    },
  },
};

function cloneSearchSpaceNode(node: SearchSpaceNode): SearchSpaceNode {
  if (isRangeSpec(node)) return { ...node };
  if (Array.isArray(node)) return node.map(cloneSearchSpaceNode);
  const out: Record<string, SearchSpaceNode> = {};
  for (const [key, child] of Object.entries(node)) out[key] = cloneSearchSpaceNode(child);
  return out;
}

function getSearchSpaceNode(path: string): SearchSpaceNode {
  let current: SearchSpaceNode | undefined = SEARCH_SPACE;
  for (const key of path.split('.')) {
    if (!current || Array.isArray(current) || isRangeSpec(current) || !(key in current)) {
      throw new Error(`Unknown search space path: ${path}`);
    }
    current = current[key];
  }
  if (!current) throw new Error(`Unknown search space path: ${path}`);
  return current;
}

function setScopePath(target: Record<string, SearchSpaceNode>, path: string, value: SearchSpaceNode): void {
  const parts = path.split('.');
  let current = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    const existing = current[key];
    if (!existing || Array.isArray(existing) || isRangeSpec(existing)) {
      current[key] = {};
    }
    current = current[key] as Record<string, SearchSpaceNode>;
  }
  current[parts[parts.length - 1]] = cloneSearchSpaceNode(value);
}

function buildScopedSearchSpace(paths: string[]): SearchSpaceNode {
  const out: Record<string, SearchSpaceNode> = {};
  for (const path of paths) setScopePath(out, path, getSearchSpaceNode(path));
  return out;
}

function range(min: number, max: number, integer = false): RangeSpec {
  return { min, max, integer };
}

const SEARCH_SCOPES: Record<SearchScopeName, SearchSpaceNode> = {
  full: SEARCH_SPACE,
  lv0: {
    balance: {
      threshold: {
        gateBoost: {
          amplitude: range(0, 3.0),
          center: range(0.9, 1.6),
          width: range(0.1, 1.2),
        },
      },
    },
    tuning: {
      household: {
        householdBaseGrowthRate: range(0, 0.12),
        householdSplitThreshold: range(20, 180, true),
        baseAwakeningRate: range(0.00001, 0.01),
      },
      behavior: {
        settlingFraction: range(0.01, 0.2),
      },
      lifespan: {
        mortalMaxAge: range(30, 120, true),
      },
      terrain: {
        terrainSafetyFactor: cloneSearchSpaceNode(getSearchSpaceNode('tuning.terrain.terrainSafetyFactor')),
        spiritualEnergyAwakeningFactor: cloneSearchSpaceNode(getSearchSpaceNode('tuning.terrain.spiritualEnergyAwakeningFactor')),
      },
    },
  },
  lv1: {
    balance: {
      breakthrough: {
        a: cloneSearchSpaceNode(getSearchSpaceNode('balance.breakthrough.a')),
        b: cloneSearchSpaceNode(getSearchSpaceNode('balance.breakthrough.b')),
        gatePenalty: {
          amplitude: range(0, 2.5),
          center: range(1.2, 2.6),
          width: range(0.2, 1.4),
        },
      },
    },
    tuning: {
      breakthroughFailure: {
        cooldown: range(1, 6, true),
        cultLossRate: range(0, 0.5),
        nothingWeight: range(0.2, 8),
        cultLossWeight: range(0.2, 6),
        injuryWeight: range(0.2, 6),
      },
      behavior: {
        seekingBreakthroughMoveProb: range(0, 1),
      },
      spatial: {
        breakthroughMove: cloneSearchSpaceNode(getSearchSpaceNode('tuning.spatial.breakthroughMove')),
      },
      terrain: {
        spiritualEnergyBreakthroughFactor: cloneSearchSpaceNode(getSearchSpaceNode('tuning.terrain.spiritualEnergyBreakthroughFactor')),
      },
    },
  },
  lv2: {
    balance: {
      breakthrough: {
        a: cloneSearchSpaceNode(getSearchSpaceNode('balance.breakthrough.a')),
        b: cloneSearchSpaceNode(getSearchSpaceNode('balance.breakthrough.b')),
        tailPenalty: {
          amplitude: range(0, 2.5),
          center: range(2.5, 4.6),
          steepness: range(0.6, 4.0),
        },
        gatePenalty: {
          amplitude: range(0, 2.5),
          center: range(1.8, 3.6),
          width: range(0.2, 1.5),
        },
      },
      threshold: {
        tailBoost: {
          amplitude: range(0, 1.2),
          center: range(2.6, 4.6),
          steepness: range(0.6, 4.0),
        },
        gateBoost: {
          amplitude: range(0, 2.5),
          center: range(2.0, 3.5),
          width: range(0.1, 1.5),
        },
        peakBoost: {
          amplitude: range(0, 3.0),
          center: range(2.8, 4.4),
          width: range(0.1, 1.2),
        },
      },
    },
    tuning: {
      breakthroughFailure: {
        cooldown: range(1, 8, true),
        cultLossRate: range(0, 0.6),
        nothingWeight: range(0.2, 8),
        cultLossWeight: range(0.2, 8),
        injuryWeight: range(0.2, 8),
      },
      behavior: {
        seekingBreakthroughMoveProb: range(0, 1),
      },
      lifespan: {
        earlySustainableMaxAge: cloneSearchSpaceNode(getSearchSpaceNode('tuning.lifespan.earlySustainableMaxAge')),
        legacyLifespanBonus: cloneSearchSpaceNode(getSearchSpaceNode('tuning.lifespan.legacyLifespanBonus')),
      },
      spatial: {
        breakthroughMove: cloneSearchSpaceNode(getSearchSpaceNode('tuning.spatial.breakthroughMove')),
      },
      terrain: {
        spiritualEnergyBreakthroughFactor: cloneSearchSpaceNode(getSearchSpaceNode('tuning.terrain.spiritualEnergyBreakthroughFactor')),
      },
    },
  },
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randIn(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isRangeSpec(value: SearchSpaceNode): value is RangeSpec {
  return typeof value === 'object' && value !== null && 'min' in value && 'max' in value;
}

function mergeNested<T>(base: T, patch: unknown): T {
  if (patch === undefined) return structuredClone(base);
  if (Array.isArray(base) && Array.isArray(patch)) {
    return base.map((value, index) => mergeNested(value, patch[index])) as T;
  }
  if (
    base !== null &&
    typeof base === 'object' &&
    patch !== null &&
    typeof patch === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(patch)
  ) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      out[key] = mergeNested(out[key], value);
    }
    return out as T;
  }
  return structuredClone(patch) as T;
}

function randomValue(space: SearchSpaceNode, rng: () => number): any {
  if (isRangeSpec(space)) {
    const sampled = randIn(rng, space.min, space.max);
    return space.integer ? Math.round(sampled) : round3(sampled);
  }
  if (Array.isArray(space)) return space.map(item => randomValue(item, rng));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(space)) out[key] = randomValue(child, rng);
  return out;
}

function mutateValue(base: any, space: SearchSpaceNode, rng: () => number, scale: number): any {
  if (isRangeSpec(space)) {
    const span = (space.max - space.min) * 0.25 * scale;
    const delta = span === 0 ? 0 : randIn(rng, -span, span);
    const next = clamp((base as number) + delta, space.min, space.max);
    return space.integer ? Math.round(next) : round3(next);
  }
  if (Array.isArray(space)) return space.map((child, index) => mutateValue(base[index], child, rng, scale));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(space)) out[key] = mutateValue(base[key], child, rng, scale);
  return out;
}

function normalizeProfile(profile: SearchProfile): SearchProfile {
  const normalized: SearchProfile = {
    balance: structuredClone(profile.balance),
    tuning: cloneSimTuning(profile.tuning),
  };
  const tuning = normalized.tuning;

  tuning.combat.luckMax = Math.max(tuning.combat.luckMax, tuning.combat.luckMin + 0.1);
  tuning.lifespan.mortalMaxAge = Math.max(1, Math.round(tuning.lifespan.mortalMaxAge));
  tuning.lifespan.lv7MaxAge = Math.max(tuning.lifespan.mortalMaxAge + 1, Math.round(tuning.lifespan.lv7MaxAge));
  tuning.lifespan.earlySustainableMaxAge[0] = tuning.lifespan.mortalMaxAge;
  for (let i = 1; i < tuning.lifespan.earlySustainableMaxAge.length; i++) {
    tuning.lifespan.earlySustainableMaxAge[i] = Math.max(
      tuning.lifespan.earlySustainableMaxAge[i - 1] + 1,
      Math.round(tuning.lifespan.earlySustainableMaxAge[i]),
    );
  }
  tuning.lifespan.legacyLifespanBonus[0] = 0;
  for (let i = 1; i < tuning.lifespan.legacyLifespanBonus.length; i++) {
    tuning.lifespan.legacyLifespanBonus[i] = Math.max(
      tuning.lifespan.legacyLifespanBonus[i - 1],
      Math.round(tuning.lifespan.legacyLifespanBonus[i]),
    );
  }
  tuning.spatial.breakthroughMove[0] = Math.max(1, Math.round(tuning.spatial.breakthroughMove[0]));
  tuning.spatial.breakthroughMove[1] = Math.max(
    tuning.spatial.breakthroughMove[0],
    Math.round(tuning.spatial.breakthroughMove[1]),
  );
  for (let i = 0; i < tuning.spatial.encounterRadius.length; i++) {
    const prev = i === 0 ? 1 : tuning.spatial.encounterRadius[i - 1];
    tuning.spatial.encounterRadius[i] = Math.max(prev, Math.round(tuning.spatial.encounterRadius[i]));
  }
  tuning.terrain.terrainSafetyFactor[0] = 0;
  tuning.terrain.spiritualEnergyAwakeningFactor[0] = 0;
  tuning.terrain.spiritualEnergyBreakthroughFactor[0] = 0;
  tuning.terrain.terrainDangerEncounterFactor[0] = 0;
  tuning.terrain.terrainDangerEvasionAdjust[0] = 0;

  return normalized;
}

function materializeBalanceProfile(input?: BalanceProfileInput): BalanceProfile {
  const profile = structuredClone(setBalanceProfile(input ?? structuredClone(DEFAULT_BALANCE_PROFILE)));
  resetBalanceProfile();
  return profile;
}

function materializeSimTuning(input?: SimTuningInput): SimTuning {
  const tuning = cloneSimTuning(setSimTuning(input ?? cloneSimTuning(DEFAULT_SIM_TUNING)));
  resetSimTuning();
  return tuning;
}

function normalizeInputProfile(raw: unknown): SearchProfile {
  if (raw && typeof raw === 'object' && ('balance' in raw || 'tuning' in raw)) {
    const typed = raw as { balance?: BalanceProfileInput; tuning?: SimTuningInput };
    return normalizeProfile({
      balance: materializeBalanceProfile(typed.balance),
      tuning: materializeSimTuning(typed.tuning),
    });
  }
  return normalizeProfile({
    balance: materializeBalanceProfile(raw as BalanceProfileInput),
    tuning: materializeSimTuning(),
  });
}

function candidateFromProfile(id: number, profile: SearchProfile): Candidate {
  return { id, profile: normalizeProfile(profile) };
}

function defaultCandidate(id: number): Candidate {
  return {
    id,
    profile: normalizeProfile({
      balance: structuredClone(DEFAULT_BALANCE_PROFILE),
      tuning: cloneSimTuning(DEFAULT_SIM_TUNING),
    }),
  };
}

function candidateFromRandom(base: SearchProfile, space: SearchSpaceNode, rng: () => number, id: number): Candidate {
  const patch = randomValue(space, rng) as Partial<SearchProfile>;
  return candidateFromProfile(id, mergeNested(base, patch));
}

function mutateCandidate(base: Candidate, space: SearchSpaceNode, rng: () => number, id: number, scale: number): Candidate {
  const patch = mutateValue(base.profile, space, rng, scale) as Partial<SearchProfile>;
  return candidateFromProfile(id, mergeNested(base.profile, patch));
}

// ── Guided candidate generation (analytical derivation) ─────────────
//
// Instead of randomly sampling breakthrough params (a, b, penalties),
// we randomly sample "assumptions" (death rate model + attempt rate model)
// and analytically derive breakthrough params from steady-state equations.
// This ensures every candidate is mathematically consistent with a distribution
// close to the target.

type GuidedAssumptions = {
  d0: number;          // combat death base rate at lv0
  gamma: number;       // combat death decay with level
  dFloor: number;      // combat death floor
  lambda0: number;     // breakthrough attempt rate at lv0
  lambdaDecay: number; // attempt rate decay factor per level
};

function deriveBreakthroughFromAssumptions(
  assumptions: GuidedAssumptions,
  profile: SearchProfile,
): { a: number; b: number; tailAmp: number; gateAmp: number } | null {
  const cooldown = profile.tuning.breakthroughFailure.cooldown;
  const bp = profile.balance.breakthrough;
  const earlyAges = profile.tuning.lifespan.earlySustainableMaxAge;

  function maxAge(level: number): number {
    if (level <= 0) return profile.tuning.lifespan.mortalMaxAge;
    if (level < earlyAges.length) return earlyAges[level];
    const highStart = earlyAges.length - 1;
    const highSpan = LEVEL_COUNT - 1 - highStart;
    if (highSpan <= 0) return profile.tuning.lifespan.lv7MaxAge;
    const progress = (level - highStart) / highSpan;
    const startAge = earlyAges[highStart];
    return Math.round(startAge * Math.exp(Math.log(profile.tuning.lifespan.lv7MaxAge / startAge) * progress));
  }

  // Population ratios from target
  const R: number[] = [];
  for (let l = 0; l < LEVEL_COUNT - 1; l++) R.push(TARGET_DISTRIBUTION[l + 1] / TARGET_DISTRIBUTION[l]);
  R.push(0);

  // Death rates and attempt rates from assumptions
  const dBg: number[] = [];
  const lambda: number[] = [];
  for (let l = 0; l < LEVEL_COUNT; l++) {
    const dNat = 1 / Math.max(1, maxAge(l));
    const dCombat = assumptions.d0 * Math.exp(-assumptions.gamma * l) + assumptions.dFloor;
    dBg.push(dNat + dCombat);
    lambda.push(assumptions.lambda0 * Math.pow(assumptions.lambdaDecay, l));
  }

  // Solve backwards: p_L = R_L * (p_{L+1} + d_{L+1})
  const pNeeded = new Array(LEVEL_COUNT).fill(0);
  for (let l = LEVEL_COUNT - 2; l >= 0; l--) {
    pNeeded[l] = R[l] * (pNeeded[l + 1] + dBg[l + 1]);
  }

  // Invert to raw success probability: s = p*(1+τλ) / (λ*(1+τp))
  const yVals: { l: number; y: number }[] = [];
  for (let l = 0; l < LEVEL_COUNT - 1; l++) {
    const lam = lambda[l];
    if (lam <= 1e-10) continue;
    const s = pNeeded[l] * (1 + cooldown * lam) / (lam * (1 + cooldown * pNeeded[l]));
    if (s <= 0 || s >= 1) continue;
    yVals.push({ l, y: -Math.log(s) });
  }
  if (yVals.length < 2) return null;

  // Fit: y = a + b*(2L+1) + tailAmp*sigmoid(L) + gateAmp*gaussian(L)
  const sigCenter = bp.tailPenalty.center, sigSteep = Math.max(1e-6, bp.tailPenalty.steepness);
  const gauCenter = bp.gatePenalty.center, gauWidth = Math.max(1e-3, bp.gatePenalty.width);
  const n = yVals.length;
  const cols = 4;
  const AtA = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Atb = new Array(cols).fill(0);

  for (const { l, y } of yVals) {
    const row = [
      1, 2 * l + 1,
      1 / (1 + Math.exp(-sigSteep * (l - sigCenter))),
      Math.exp(-0.5 * Math.pow((l - gauCenter) / gauWidth, 2)),
    ];
    for (let j = 0; j < cols; j++) {
      Atb[j] += row[j] * y;
      for (let k = 0; k < cols; k++) AtA[j][k] += row[j] * row[k];
    }
  }

  // Gaussian elimination
  const M = AtA.map((row, i) => [...row, Atb[i]]);
  for (let col = 0; col < cols; col++) {
    let maxRow = col;
    for (let row = col + 1; row < cols; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let row = col + 1; row < cols; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= cols; j++) M[row][j] -= f * M[col][j];
    }
  }
  const x = new Array(cols).fill(0);
  for (let i = cols - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) continue;
    x[i] = M[i][cols];
    for (let j = i + 1; j < cols; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }

  return {
    a: Math.max(0.1, x[0]),
    b: Math.max(0.01, x[1]),
    tailAmp: Math.max(0, Math.min(5.0, x[2])),
    gateAmp: Math.max(0, Math.min(3.0, x[3])),
  };
}

function candidateFromGuided(base: SearchProfile, space: SearchSpaceNode, rng: () => number, id: number): Candidate {
  const assumptions: GuidedAssumptions = {
    d0: randIn(rng, 0.01, 0.15),
    gamma: randIn(rng, 0.1, 1.5),
    dFloor: randIn(rng, 0, 0.01),
    lambda0: randIn(rng, 0.05, 0.35),
    lambdaDecay: randIn(rng, 0.15, 0.7),
  };

  const derived = deriveBreakthroughFromAssumptions(assumptions, base);
  if (!derived) return candidateFromRandom(base, space, rng, id);

  // Start from random candidate (for non-breakthrough params), then override breakthrough
  const candidate = candidateFromRandom(base, space, rng, id);
  const bt = candidate.profile.balance.breakthrough;
  bt.a = derived.a;
  bt.b = derived.b;
  bt.tailPenalty.amplitude = derived.tailAmp;
  bt.gatePenalty.amplitude = derived.gateAmp;
  return candidateFromProfile(id, candidate.profile);
}

function mutateGuidedCandidate(parent: Candidate, space: SearchSpaceNode, rng: () => number, id: number, scale: number): Candidate {
  // Mutate non-breakthrough params normally
  const mutated = mutateCandidate(parent, space, rng, id, scale);

  // Re-derive breakthrough from slightly perturbed assumptions
  const assumptions: GuidedAssumptions = {
    d0: randIn(rng, 0.02, 0.10),
    gamma: randIn(rng, 0.2, 1.2),
    dFloor: randIn(rng, 0, 0.005),
    lambda0: randIn(rng, 0.08, 0.25),
    lambdaDecay: randIn(rng, 0.2, 0.6),
  };

  const derived = deriveBreakthroughFromAssumptions(assumptions, mutated.profile);
  if (!derived) return mutated;

  const bt = mutated.profile.balance.breakthrough;
  bt.a = derived.a;
  bt.b = derived.b;
  bt.tailPenalty.amplitude = derived.tailAmp;
  bt.gatePenalty.amplitude = derived.gateAmp;
  return candidateFromProfile(id, mutated.profile);
}

function scoreDistribution(avgDist: number[], options: SearchOptions): { score: number; violations: number } {
  let score = 0;
  let violations = 0;
  const levelLimit = Math.max(1, Math.min(options.scoredLevels, LEVEL_COUNT));
  const focusLevel = options.focusLevel;
  for (let level = 0; level < levelLimit; level++) {
    const target = TARGET_DISTRIBUTION[level];
    const actual = avgDist[level];
    const relativeError = Math.abs(actual - target) / target;
    const epsilon = target * 0.1;
    const logError = Math.log((actual + epsilon) / (target + epsilon));
    const weight = level >= 7 ? 18 : level === 6 ? 14 : level === 5 ? 10 : level === 4 ? 4 : 1;
    if (focusLevel === undefined) {
      score += weight * logError * logError;
      if (actual === 0 && target > 0) score += weight * 25;
      if (relativeError > RELATIVE_TOLERANCE) {
        violations++;
        score += weight * relativeError;
      }
      continue;
    }

    if (level < focusLevel) {
      score += weight * logError * logError;
      if (relativeError > RELATIVE_TOLERANCE) {
        violations++;
        score += (focusLevel - level + 1) * 1_000_000 + weight * relativeError * 10_000;
      }
      continue;
    }

    if (level === focusLevel) {
      score += weight * logError * logError * 10_000;
      if (actual === 0 && target > 0) score += weight * 250_000;
      if (relativeError > RELATIVE_TOLERANCE) {
        violations++;
        score += weight * 100_000 + weight * relativeError * 10_000;
      }
      continue;
    }

    score += weight * logError * logError * 0.05;
  }
  return { score, violations };
}

function collectBreakthroughCurve(): number[] {
  return Array.from({ length: LEVEL_COUNT - 1 }, (_, level) => breakthroughChance(level));
}

function scoreBreakthroughCurve(curve: number[]): { score: number; violations: number } {
  let score = 0;
  let violations = 0;
  for (let level = 0; level < curve.length - 1; level++) {
    const current = curve[level];
    const next = curve[level + 1];
    if (next < current) continue;
    violations++;
    score += MONOTONIC_BASE_PENALTY + (next - current) * MONOTONIC_DIFF_WEIGHT;
  }
  return { score, violations };
}

function collectThresholdCurve(): number[] {
  return Array.from({ length: LEVEL_COUNT }, (_, level) => threshold(level));
}

function scoreIncreasingCurve(curve: number[]): { score: number; violations: number } {
  let score = 0;
  let violations = 0;
  for (let level = 0; level < curve.length - 1; level++) {
    const current = curve[level];
    const next = curve[level + 1];
    if (next > current) continue;
    violations++;
    score += STRUCTURAL_BASE_PENALTY + (current - next + 1) * STRUCTURAL_DIFF_WEIGHT;
  }
  return { score, violations };
}

function collectLifespanCurve(): number[] {
  return Array.from({ length: LEVEL_COUNT }, (_, level) => sustainableMaxAge(level));
}

function collectCombatDeathCurve(): number[] {
  const tuning = getSimTuning();
  const profile = getBalanceProfile();
  return Array.from({ length: LEVEL_COUNT }, (_, level) => {
    const deathBoost = Math.exp(gaussianContribution(level, profile.combat.deathBoost));
    return Math.min(
      tuning.combat.defeatMaxDeath,
      tuning.combat.defeatDeathBase * tuning.combat.defeatDeathDecay ** level * deathBoost,
    );
  });
}

function scoreDecreasingCurve(curve: number[]): { score: number; violations: number } {
  let score = 0;
  let violations = 0;
  for (let level = 0; level < curve.length - 1; level++) {
    const current = curve[level];
    const next = curve[level + 1];
    if (next < current) continue;
    violations++;
    score += STRUCTURAL_BASE_PENALTY + (next - current + 1e-6) * STRUCTURAL_DIFF_WEIGHT;
  }
  return { score, violations };
}

function evaluateCandidate(candidate: Candidate, options: SearchOptions): Candidate {
  setBalanceProfile(candidate.profile.balance);
  setSimTuning(candidate.profile.tuning);
  const distSums = new Array(LEVEL_COUNT).fill(0);
  let sampleCount = 0;

  for (const seed of options.seeds) {
    const engine = new SimulationEngine(seed, options.initialPop);
    for (let year = 0; year < options.totalYears; year++) {
      engine.tickYear(false);
      if (year < options.warmupYears) continue;
      const totalPopulation = engine.aliveCount;
      if (totalPopulation <= 0) continue;
      for (let level = 0; level < LEVEL_COUNT; level++) {
        distSums[level] += (engine.levelGroups[level].size / totalPopulation) * 100;
      }
      sampleCount++;
    }
  }

  const breakthroughCurve = collectBreakthroughCurve();
  const curveScore = scoreBreakthroughCurve(breakthroughCurve);
  const thresholdCurve = collectThresholdCurve();
  const thresholdScore = scoreIncreasingCurve(thresholdCurve);
  const lifespanCurve = collectLifespanCurve();
  const lifespanScore = scoreIncreasingCurve(lifespanCurve);
  const combatDeathCurve = collectCombatDeathCurve();
  const combatDeathScore = scoreDecreasingCurve(combatDeathCurve);
  resetBalanceProfile();
  resetSimTuning();
  if (sampleCount === 0) {
    return {
      ...candidate,
      score: Number.POSITIVE_INFINITY,
      avgDist: new Array(LEVEL_COUNT).fill(0),
      breakthroughCurve,
      violations: LEVEL_COUNT + curveScore.violations,
      monotonicViolations:
        curveScore.violations + thresholdScore.violations + lifespanScore.violations + combatDeathScore.violations,
    };
  }

  const avgDist = distSums.map(value => value / sampleCount);
  const distScore = scoreDistribution(avgDist, options);
  return {
    ...candidate,
    score: distScore.score + curveScore.score + thresholdScore.score + lifespanScore.score + combatDeathScore.score,
    avgDist,
    breakthroughCurve,
    violations:
      distScore.violations +
      curveScore.violations +
      thresholdScore.violations +
      lifespanScore.violations +
      combatDeathScore.violations,
    monotonicViolations:
      curveScore.violations + thresholdScore.violations + lifespanScore.violations + combatDeathScore.violations,
  };
}

function printCandidate(label: string, candidate: Candidate): void {
  if (!candidate.avgDist || candidate.score === undefined || candidate.violations === undefined) return;
  const summary = candidate.avgDist
    .map((actual, level) => `${LEVEL_NAMES[level]}=${actual.toFixed(4)}%`)
    .join(', ');
  const curveSummary = candidate.breakthroughCurve
    ?.map((chance, level) => `Lv${level}=${(chance * 100).toFixed(3)}%`)
    .join(', ') ?? '';
  console.log(
    `${label} score=${candidate.score.toFixed(4)} violations=${candidate.violations}` +
    ` monotonic=${candidate.monotonicViolations ?? 0} :: ${summary}`,
  );
  console.log(`breakthroughCurve :: ${curveSummary}`);
  console.log(JSON.stringify(candidate.profile, null, 2));
}

function parseArgs(): ParsedArgs {
  const options = { ...DEFAULT_OPTIONS };
  const longRunConfig: LongRunConfig = {};
  for (const arg of process.argv.slice(2)) {
    const [key, raw] = arg.replace(/^--/, '').split('=');
    if (!raw) continue;
    switch (key) {
      case 'years': options.totalYears = Number(raw); break;
      case 'warmup': options.warmupYears = Number(raw); break;
      case 'pop': options.initialPop = Number(raw); break;
      case 'iterations': options.iterations = Number(raw); break;
      case 'survivors': options.survivors = Number(raw); break;
      case 'refinements': options.refinements = Number(raw); break;
      case 'seeds': options.seeds = raw.split(',').map(Number).filter(Number.isFinite); break;
      case 'scored-levels': options.scoredLevels = Number(raw); break;
      case 'focus-level': options.focusLevel = Number(raw); break;
      case 'search-scope':
        if (raw === 'full' || raw === 'lv0' || raw === 'lv1' || raw === 'lv2') options.searchScope = raw;
        break;
      case 'search-mode':
        if (raw === 'random' || raw === 'guided') options.searchMode = raw;
        break;
      case 'base': options.baseFile = raw; break;
      case 'long-run-years': longRunConfig.years = Number(raw); break;
      case 'long-run-warmup': longRunConfig.warmup = Number(raw); break;
      case 'long-run-pop': longRunConfig.initialPop = Number(raw); break;
      case 'long-run-seeds': longRunConfig.seeds = raw.split(',').map(Number).filter(Number.isFinite); break;
    }
  }
  return { options, longRunConfig };
}

async function main(): Promise<void> {
  const { options, longRunConfig } = parseArgs();
  const rng = mulberry32(20260306);
  const activeSearchSpace = SEARCH_SCOPES[options.searchScope];
  let nextId = 1;
  const baseCandidate = options.baseFile
    ? candidateFromProfile(nextId++, normalizeInputProfile(JSON.parse(readFileSync(options.baseFile, 'utf8'))))
    : defaultCandidate(nextId++);
  const guided = options.searchMode === 'guided';
  const generateCandidate = guided
    ? (base: SearchProfile, id: number) => candidateFromGuided(base, activeSearchSpace, rng, id)
    : (base: SearchProfile, id: number) => candidateFromRandom(base, activeSearchSpace, rng, id);
  const mutateOne = guided
    ? (parent: Candidate, id: number, scale: number) => mutateGuidedCandidate(parent, activeSearchSpace, rng, id, scale)
    : (parent: Candidate, id: number, scale: number) => mutateCandidate(parent, activeSearchSpace, rng, id, scale);

  if (guided) console.log('[guided mode] Candidates generated via analytical derivation\n');

  const population = [baseCandidate];
  while (population.length < options.iterations) {
    population.push(generateCandidate(baseCandidate.profile, nextId++));
  }
  let evaluated = population.map(candidate => evaluateCandidate(candidate, options));
  evaluated.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
  printCandidate('initial-best', evaluated[0]);

  for (let step = 0; step < options.refinements; step++) {
    const survivors = evaluated.slice(0, options.survivors);
    const scale = 1 / (step + 2);
    const mutations: Candidate[] = [];
    while (mutations.length < options.iterations) {
      const parent = survivors[mutations.length % survivors.length];
      mutations.push(mutateOne(parent, nextId++, scale));
    }
    evaluated = [...survivors, ...mutations].map(candidate => evaluateCandidate(candidate, options));
    evaluated.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
    printCandidate(`refine-${step + 1}`, evaluated[0]);
  }

  printCandidate('best', evaluated[0]);

  if (longRunConfig.years) {
    const longRunOptions: SearchOptions = {
      ...options,
      totalYears: longRunConfig.years,
      warmupYears: longRunConfig.warmup ?? options.warmupYears,
      initialPop: longRunConfig.initialPop ?? options.initialPop,
      seeds: longRunConfig.seeds?.length ? longRunConfig.seeds : options.seeds,
    };
    const longRunCandidate = evaluateCandidate(evaluated[0], longRunOptions);
    printCandidate('long-run-validation', longRunCandidate);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

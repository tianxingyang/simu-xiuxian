export type BehaviorCourageFactors = {
  escaping: number;
  recuperating: number;
  seeking_breakthrough: number;
  settling: number;
  wandering: number;
};

export type BreakthroughFailureTuning = {
  cooldown: number;
  cultLossRate: number;
  nothingWeight: number;
  cultLossWeight: number;
  injuryWeight: number;
};

export type CombatTuning = {
  defeatDeathBase: number;
  defeatDeathDecay: number;
  defeatGapSeverity: number;
  defeatMaxDeath: number;
  defeatDemotionWeight: number;
  defeatInjuryWeight: number;
  defeatCultLossWeight: number;
  defeatLightInjuryWeight: number;
  defeatMeridianWeight: number;
  defeatCultLossRate: number;
  lootBaseRate: number;
  lootVariableRate: number;
  luckMean: number;
  luckStddev: number;
  luckMin: number;
  luckMax: number;
  injuryDuration: number;
  injuryGrowthRate: number;
  lightInjuryDuration: number;
  lightInjuryGrowthRate: number;
  meridianDamageDuration: number;
  meridianCombatPenalty: number;
};

export type CourageTuning = {
  trough: number;
  youngAmp: number;
  oldAmp: number;
  mean: number;
  stddev: number;
  evasionSensitivity: number;
  evasionPenalty: number;
  behaviorFactors: BehaviorCourageFactors;
};

export type BehaviorTuning = {
  escapingMoveProb: number;
  recuperatingMoveProb: number;
  seekingBreakthroughMoveProb: number;
  settlingFraction: number;
  evalBaseInterval: number;
};

export type HouseholdTuning = {
  householdBaseGrowthRate: number;
  householdSplitThreshold: number;
  householdSplitCount: number;
  householdSplitPopulation: number;
  baseAwakeningRate: number;
  initialHouseholdPop: number;
  combatCollateralPopLoss: number;
};

export type LifespanTuning = {
  mortalMaxAge: number;
  lv7MaxAge: number;
  lifespanDecayRate: number;
  earlySustainableMaxAge: readonly number[];
  legacyLifespanBonus: readonly number[];
};

export type SpatialTuning = {
  encounterRadius: readonly number[];
  wanderBaseProb: number;
  wanderLevelBonus: number;
  breakthroughMove: [number, number];
};

export type TerrainTuning = {
  terrainSafetyFactor: readonly number[];
  spiritualEnergyAwakeningFactor: readonly number[];
  spiritualEnergyBreakthroughFactor: readonly number[];
  terrainDangerEncounterFactor: readonly number[];
  terrainDangerEvasionAdjust: readonly number[];
};

export type SettlementTuning = {
  expandThreshold: number;
  shrinkThreshold: number;
};

export type DisasterType = 'plague' | 'famine' | 'flood' | 'beast_tide' | 'qi_disruption';

export type DisasterConfig = {
  popLossMin: number;
  popLossMax: number;
  densityWeight: number;
  terrainDangerWeight: number;
  spiritualEnergyWeight: number;
  baseProb: number;
};

export type MortalDeathTuning = {
  baseDeathRate: number;
  densityPressureFactor: number;
  carryingCapacityPerCell: number;
};

export type DisasterTuning = {
  enabled: boolean;
  densityThreshold: number;
  densityProbScale: number;
  eventRecordThreshold: number;
  types: Record<DisasterType, DisasterConfig>;
};

export type RelationshipTuning = {
  enabled: boolean;
  allyDecayRate: number;
  rivalDecayRate: number;
  allyStrengthPerEncounter: number;
  rivalIntensityPerCombat: number;
  mentorCultivationBonus: number;
  mentorTeachingBonus: number;
  mentorLevelGap: number;
  mentorFormChance: number;
  allyFormChance: number;
  allyLevelGapMax: number;
  rivalCombatThreshold: number;
  fellowDiscipleCombatReduction: number;
  closeAllyThreshold: number;
};

export type MemoryTuning = {
  enabled: boolean;
  // Emotional decay (per year: value = baseline + (value - baseline) * decayRate)
  emotionalDecayRate: number;
  // Confidence deltas
  confidenceWinDelta: number;
  confidenceLossDelta: number;
  // Caution deltas
  cautionHeavyInjuryDelta: number;
  cautionLightInjuryDelta: number;
  // Ambition deltas
  ambitionSuccessDelta: number;
  ambitionFailHighCourageDelta: number;
  ambitionFailLowCourageDelta: number;
  ambitionCourageThreshold: number;
  // Bloodlust deltas
  bloodlustKillDelta: number;
  bloodlustWinDelta: number;
  // Rootedness deltas
  rootednessSettlingDelta: number;
  rootednessDisplaceDelta: number;
  // Breakthrough fear
  breakthroughFearDelta: number;
  // Behavioral effect strengths
  encounterFleeBoost: number;
  kinCombatReduction: number;
  homingStrength: number;
  dangerPlaceAvoidance: number;
  powerSpotAttraction: number;
  bloodlustDangerAttraction: number;
  breakthroughFearDelayProb: number;
};

export type InteractionTuning = {
  enabled: boolean;
  sparringCultivationMin: number;
  sparringCultivationMax: number;
  sparringAllyStrengthGain: number;
  sparringProbability: number;
  teachingBoostRateMentor: number;
  teachingBoostRateAlly: number;
  teachingBoostDuration: number;
  teacherCultivationGain: number;
  teachingBoostRateMax: number;
  teachingProbability: number;
};

export type SimTuning = {
  breakthroughFailure: BreakthroughFailureTuning;
  combat: CombatTuning;
  courage: CourageTuning;
  behavior: BehaviorTuning;
  household: HouseholdTuning;
  lifespan: LifespanTuning;
  spatial: SpatialTuning;
  terrain: TerrainTuning;
  settlement: SettlementTuning;
  mortalDeath: MortalDeathTuning;
  disaster: DisasterTuning;
  memory: MemoryTuning;
  relationship: RelationshipTuning;
  interaction: InteractionTuning;
};

type DeepPartial<T> =
  T extends readonly number[] ? number[] :
    T extends number[] ? number[] :
      T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } :
        T;

export type SimTuningInput = DeepPartial<SimTuning>;

export const DEFAULT_SIM_TUNING: Readonly<SimTuning> = Object.freeze({
  breakthroughFailure: Object.freeze({
    cooldown: 3,
    cultLossRate: 0.2,
    nothingWeight: 5.0,
    cultLossWeight: 2.0,
    injuryWeight: 2.0,
  }),
  combat: Object.freeze({
    defeatDeathBase: 0.40,
    defeatDeathDecay: 0.80,
    defeatGapSeverity: 0.3,
    defeatMaxDeath: 0.95,
    defeatDemotionWeight: 0.4,
    defeatInjuryWeight: 2.9,
    defeatCultLossWeight: 2.0,
    defeatLightInjuryWeight: 4.0,
    defeatMeridianWeight: 1.0,
    defeatCultLossRate: 0.3,
    lootBaseRate: 0.28,
    lootVariableRate: 0.24,
    luckMean: 1.0,
    luckStddev: 0.3,
    luckMin: 0,
    luckMax: 2.5,
    injuryDuration: 5,
    injuryGrowthRate: 0.5,
    lightInjuryDuration: 2,
    lightInjuryGrowthRate: 0.7,
    meridianDamageDuration: 10,
    meridianCombatPenalty: 0.3,
  }),
  courage: Object.freeze({
    trough: 0.3,
    youngAmp: 0.1,
    oldAmp: 0.3,
    mean: 0.5,
    stddev: 0.15,
    evasionSensitivity: 0.5,
    evasionPenalty: 0.05,
    behaviorFactors: Object.freeze({
      escaping: 0.3,
      recuperating: 0.6,
      seeking_breakthrough: 1.0,
      settling: 1.0,
      wandering: 1.0,
    }),
  }),
  behavior: Object.freeze({
    escapingMoveProb: 1.0,
    recuperatingMoveProb: 0.05,
    seekingBreakthroughMoveProb: 0.6,
    settlingFraction: 0.05,
    evalBaseInterval: 5,
  }),
  household: Object.freeze({
    householdBaseGrowthRate: 0.03,
    householdSplitThreshold: 50,
    householdSplitCount: 5,
    householdSplitPopulation: 10,
    baseAwakeningRate: 0.0005,
    initialHouseholdPop: 5,
    combatCollateralPopLoss: 3,
  }),
  lifespan: Object.freeze({
    mortalMaxAge: 60,
    lv7MaxAge: 100_000,
    lifespanDecayRate: 0.2,
    earlySustainableMaxAge: Object.freeze([60, 150, 1_070, 11_070]),
    legacyLifespanBonus: Object.freeze([0, 100, 1_000, 10_000]),
  }),
  spatial: Object.freeze({
    encounterRadius: Object.freeze([2, 3, 4, 5, 6, 7, 8, 16]),
    wanderBaseProb: 0.15,
    wanderLevelBonus: 0.03,
    breakthroughMove: Object.freeze([2, 4]) as [number, number],
  }),
  terrain: Object.freeze({
    terrainSafetyFactor: Object.freeze([0, 1.2, 1.1, 1.0, 0.8, 0.5]),
    spiritualEnergyAwakeningFactor: Object.freeze([0, 0.5, 0.8, 1.0, 1.5, 2.5]),
    spiritualEnergyBreakthroughFactor: Object.freeze([0, 0.7, 0.85, 1.0, 1.2, 1.5]),
    terrainDangerEncounterFactor: Object.freeze([0, 0.6, 0.8, 1.0, 1.3, 1.6]),
    terrainDangerEvasionAdjust: Object.freeze([0, 0.05, 0.025, 0, -0.05, -0.1]),
  }),
  settlement: Object.freeze({
    expandThreshold: 1000,
    shrinkThreshold: 300,
  }),
  mortalDeath: Object.freeze({
    baseDeathRate: 0.005,
    densityPressureFactor: 2.0,
    carryingCapacityPerCell: 1500,
  }),
  disaster: Object.freeze({
    enabled: true,
    densityThreshold: 0.8,
    densityProbScale: 0.15,
    eventRecordThreshold: 0.10,
    types: Object.freeze({
      plague: Object.freeze({ popLossMin: 0.15, popLossMax: 0.40, densityWeight: 3.0, terrainDangerWeight: 0, spiritualEnergyWeight: 0, baseProb: 0.002 }),
      famine: Object.freeze({ popLossMin: 0.10, popLossMax: 0.25, densityWeight: 2.0, terrainDangerWeight: 1.5, spiritualEnergyWeight: 0, baseProb: 0.005 }),
      flood: Object.freeze({ popLossMin: 0.05, popLossMax: 0.15, densityWeight: 0.5, terrainDangerWeight: 0.5, spiritualEnergyWeight: 0, baseProb: 0.008 }),
      beast_tide: Object.freeze({ popLossMin: 0.10, popLossMax: 0.30, densityWeight: 1.0, terrainDangerWeight: 2.5, spiritualEnergyWeight: 2.0, baseProb: 0.003 }),
      qi_disruption: Object.freeze({ popLossMin: 0.05, popLossMax: 0.20, densityWeight: 0.5, terrainDangerWeight: 0, spiritualEnergyWeight: 3.0, baseProb: 0.001 }),
    }),
  }),
  relationship: Object.freeze({
    enabled: true,
    allyDecayRate: 0.02,
    rivalDecayRate: 0.01,
    allyStrengthPerEncounter: 0.1,
    rivalIntensityPerCombat: 0.2,
    mentorCultivationBonus: 0.4,
    mentorTeachingBonus: 0.1,
    mentorLevelGap: 2,
    mentorFormChance: 0.15,
    allyFormChance: 0.1,
    allyLevelGapMax: 2,
    rivalCombatThreshold: 3,
    fellowDiscipleCombatReduction: 0.5,
    closeAllyThreshold: 0.6,
  }),
  interaction: Object.freeze({
    enabled: true,
    sparringCultivationMin: 0.3,
    sparringCultivationMax: 0.8,
    sparringAllyStrengthGain: 0.05,
    sparringProbability: 0.15,
    teachingBoostRateMentor: 0.5,
    teachingBoostRateAlly: 0.3,
    teachingBoostDuration: 10,
    teacherCultivationGain: 0.1,
    teachingBoostRateMax: 0.8,
    teachingProbability: 0.12,
  }),
  memory: Object.freeze({
    enabled: true,
    emotionalDecayRate: 0.95,
    confidenceWinDelta: 0.12,
    confidenceLossDelta: 0.15,
    cautionHeavyInjuryDelta: 0.3,
    cautionLightInjuryDelta: 0.1,
    ambitionSuccessDelta: 0.2,
    ambitionFailHighCourageDelta: 0.08,
    ambitionFailLowCourageDelta: 0.12,
    ambitionCourageThreshold: 0.5,
    bloodlustKillDelta: 0.2,
    bloodlustWinDelta: 0.05,
    rootednessSettlingDelta: 0.02,
    rootednessDisplaceDelta: 0.15,
    breakthroughFearDelta: 0.15,
    encounterFleeBoost: 0.35,
    kinCombatReduction: 0.6,
    homingStrength: 2.0,
    dangerPlaceAvoidance: 3.0,
    powerSpotAttraction: 2.5,
    bloodlustDangerAttraction: 1.5,
    breakthroughFearDelayProb: 0.3,
  }),
});

let activeSimTuning = cloneSimTuning(DEFAULT_SIM_TUNING);

function cloneArray(values: readonly number[]): number[] {
  return [...values];
}

function cloneBehaviorFactors(values: Readonly<BehaviorCourageFactors>): BehaviorCourageFactors {
  return {
    escaping: values.escaping,
    recuperating: values.recuperating,
    seeking_breakthrough: values.seeking_breakthrough,
    settling: values.settling,
    wandering: values.wandering,
  };
}

function mergeArray(base: readonly number[], overrides?: number[]): number[] {
  return overrides ? cloneArray(overrides) : cloneArray(base);
}

export function cloneSimTuning(tuning: Readonly<SimTuning>): SimTuning {
  return {
    breakthroughFailure: { ...tuning.breakthroughFailure },
    combat: { ...tuning.combat },
    courage: {
      ...tuning.courage,
      behaviorFactors: cloneBehaviorFactors(tuning.courage.behaviorFactors),
    },
    behavior: { ...tuning.behavior },
    household: { ...tuning.household },
    lifespan: {
      ...tuning.lifespan,
      earlySustainableMaxAge: cloneArray(tuning.lifespan.earlySustainableMaxAge),
      legacyLifespanBonus: cloneArray(tuning.lifespan.legacyLifespanBonus),
    },
    spatial: {
      ...tuning.spatial,
      encounterRadius: cloneArray(tuning.spatial.encounterRadius),
      breakthroughMove: [tuning.spatial.breakthroughMove[0], tuning.spatial.breakthroughMove[1]],
    },
    terrain: {
      terrainSafetyFactor: cloneArray(tuning.terrain.terrainSafetyFactor),
      spiritualEnergyAwakeningFactor: cloneArray(tuning.terrain.spiritualEnergyAwakeningFactor),
      spiritualEnergyBreakthroughFactor: cloneArray(tuning.terrain.spiritualEnergyBreakthroughFactor),
      terrainDangerEncounterFactor: cloneArray(tuning.terrain.terrainDangerEncounterFactor),
      terrainDangerEvasionAdjust: cloneArray(tuning.terrain.terrainDangerEvasionAdjust),
    },
    settlement: { ...tuning.settlement },
    mortalDeath: { ...tuning.mortalDeath },
    disaster: {
      ...tuning.disaster,
      types: {
        plague: { ...tuning.disaster.types.plague },
        famine: { ...tuning.disaster.types.famine },
        flood: { ...tuning.disaster.types.flood },
        beast_tide: { ...tuning.disaster.types.beast_tide },
        qi_disruption: { ...tuning.disaster.types.qi_disruption },
      },
    },
    memory: { ...tuning.memory },
    relationship: { ...tuning.relationship },
    interaction: { ...tuning.interaction },
  };
}

function mergeBehaviorFactors(
  base: Readonly<BehaviorCourageFactors>,
  overrides?: DeepPartial<BehaviorCourageFactors>,
): BehaviorCourageFactors {
  return {
    escaping: overrides?.escaping ?? base.escaping,
    recuperating: overrides?.recuperating ?? base.recuperating,
    seeking_breakthrough: overrides?.seeking_breakthrough ?? base.seeking_breakthrough,
    settling: overrides?.settling ?? base.settling,
    wandering: overrides?.wandering ?? base.wandering,
  };
}

function mergeDisasterConfig(
  base: Readonly<DisasterConfig>,
  overrides?: DeepPartial<DisasterConfig>,
): DisasterConfig {
  return {
    popLossMin: overrides?.popLossMin ?? base.popLossMin,
    popLossMax: overrides?.popLossMax ?? base.popLossMax,
    densityWeight: overrides?.densityWeight ?? base.densityWeight,
    terrainDangerWeight: overrides?.terrainDangerWeight ?? base.terrainDangerWeight,
    spiritualEnergyWeight: overrides?.spiritualEnergyWeight ?? base.spiritualEnergyWeight,
    baseProb: overrides?.baseProb ?? base.baseProb,
  };
}

function mergeSimTuning(overrides: SimTuningInput = {}): SimTuning {
  return {
    breakthroughFailure: {
      cooldown: overrides.breakthroughFailure?.cooldown ?? DEFAULT_SIM_TUNING.breakthroughFailure.cooldown,
      cultLossRate: overrides.breakthroughFailure?.cultLossRate ?? DEFAULT_SIM_TUNING.breakthroughFailure.cultLossRate,
      nothingWeight: overrides.breakthroughFailure?.nothingWeight ?? DEFAULT_SIM_TUNING.breakthroughFailure.nothingWeight,
      cultLossWeight: overrides.breakthroughFailure?.cultLossWeight ?? DEFAULT_SIM_TUNING.breakthroughFailure.cultLossWeight,
      injuryWeight: overrides.breakthroughFailure?.injuryWeight ?? DEFAULT_SIM_TUNING.breakthroughFailure.injuryWeight,
    },
    combat: {
      defeatDeathBase: overrides.combat?.defeatDeathBase ?? DEFAULT_SIM_TUNING.combat.defeatDeathBase,
      defeatDeathDecay: overrides.combat?.defeatDeathDecay ?? DEFAULT_SIM_TUNING.combat.defeatDeathDecay,
      defeatGapSeverity: overrides.combat?.defeatGapSeverity ?? DEFAULT_SIM_TUNING.combat.defeatGapSeverity,
      defeatMaxDeath: overrides.combat?.defeatMaxDeath ?? DEFAULT_SIM_TUNING.combat.defeatMaxDeath,
      defeatDemotionWeight: overrides.combat?.defeatDemotionWeight ?? DEFAULT_SIM_TUNING.combat.defeatDemotionWeight,
      defeatInjuryWeight: overrides.combat?.defeatInjuryWeight ?? DEFAULT_SIM_TUNING.combat.defeatInjuryWeight,
      defeatCultLossWeight: overrides.combat?.defeatCultLossWeight ?? DEFAULT_SIM_TUNING.combat.defeatCultLossWeight,
      defeatLightInjuryWeight: overrides.combat?.defeatLightInjuryWeight ?? DEFAULT_SIM_TUNING.combat.defeatLightInjuryWeight,
      defeatMeridianWeight: overrides.combat?.defeatMeridianWeight ?? DEFAULT_SIM_TUNING.combat.defeatMeridianWeight,
      defeatCultLossRate: overrides.combat?.defeatCultLossRate ?? DEFAULT_SIM_TUNING.combat.defeatCultLossRate,
      lootBaseRate: overrides.combat?.lootBaseRate ?? DEFAULT_SIM_TUNING.combat.lootBaseRate,
      lootVariableRate: overrides.combat?.lootVariableRate ?? DEFAULT_SIM_TUNING.combat.lootVariableRate,
      luckMean: overrides.combat?.luckMean ?? DEFAULT_SIM_TUNING.combat.luckMean,
      luckStddev: overrides.combat?.luckStddev ?? DEFAULT_SIM_TUNING.combat.luckStddev,
      luckMin: overrides.combat?.luckMin ?? DEFAULT_SIM_TUNING.combat.luckMin,
      luckMax: overrides.combat?.luckMax ?? DEFAULT_SIM_TUNING.combat.luckMax,
      injuryDuration: overrides.combat?.injuryDuration ?? DEFAULT_SIM_TUNING.combat.injuryDuration,
      injuryGrowthRate: overrides.combat?.injuryGrowthRate ?? DEFAULT_SIM_TUNING.combat.injuryGrowthRate,
      lightInjuryDuration: overrides.combat?.lightInjuryDuration ?? DEFAULT_SIM_TUNING.combat.lightInjuryDuration,
      lightInjuryGrowthRate: overrides.combat?.lightInjuryGrowthRate ?? DEFAULT_SIM_TUNING.combat.lightInjuryGrowthRate,
      meridianDamageDuration: overrides.combat?.meridianDamageDuration ?? DEFAULT_SIM_TUNING.combat.meridianDamageDuration,
      meridianCombatPenalty: overrides.combat?.meridianCombatPenalty ?? DEFAULT_SIM_TUNING.combat.meridianCombatPenalty,
    },
    courage: {
      trough: overrides.courage?.trough ?? DEFAULT_SIM_TUNING.courage.trough,
      youngAmp: overrides.courage?.youngAmp ?? DEFAULT_SIM_TUNING.courage.youngAmp,
      oldAmp: overrides.courage?.oldAmp ?? DEFAULT_SIM_TUNING.courage.oldAmp,
      mean: overrides.courage?.mean ?? DEFAULT_SIM_TUNING.courage.mean,
      stddev: overrides.courage?.stddev ?? DEFAULT_SIM_TUNING.courage.stddev,
      evasionSensitivity: overrides.courage?.evasionSensitivity ?? DEFAULT_SIM_TUNING.courage.evasionSensitivity,
      evasionPenalty: overrides.courage?.evasionPenalty ?? DEFAULT_SIM_TUNING.courage.evasionPenalty,
      behaviorFactors: mergeBehaviorFactors(DEFAULT_SIM_TUNING.courage.behaviorFactors, overrides.courage?.behaviorFactors),
    },
    behavior: {
      escapingMoveProb: overrides.behavior?.escapingMoveProb ?? DEFAULT_SIM_TUNING.behavior.escapingMoveProb,
      recuperatingMoveProb: overrides.behavior?.recuperatingMoveProb ?? DEFAULT_SIM_TUNING.behavior.recuperatingMoveProb,
      seekingBreakthroughMoveProb: overrides.behavior?.seekingBreakthroughMoveProb ?? DEFAULT_SIM_TUNING.behavior.seekingBreakthroughMoveProb,
      settlingFraction: overrides.behavior?.settlingFraction ?? DEFAULT_SIM_TUNING.behavior.settlingFraction,
      evalBaseInterval: overrides.behavior?.evalBaseInterval ?? DEFAULT_SIM_TUNING.behavior.evalBaseInterval,
    },
    household: {
      householdBaseGrowthRate: overrides.household?.householdBaseGrowthRate ?? DEFAULT_SIM_TUNING.household.householdBaseGrowthRate,
      householdSplitThreshold: overrides.household?.householdSplitThreshold ?? DEFAULT_SIM_TUNING.household.householdSplitThreshold,
      householdSplitCount: overrides.household?.householdSplitCount ?? DEFAULT_SIM_TUNING.household.householdSplitCount,
      householdSplitPopulation: overrides.household?.householdSplitPopulation ?? DEFAULT_SIM_TUNING.household.householdSplitPopulation,
      baseAwakeningRate: overrides.household?.baseAwakeningRate ?? DEFAULT_SIM_TUNING.household.baseAwakeningRate,
      initialHouseholdPop: overrides.household?.initialHouseholdPop ?? DEFAULT_SIM_TUNING.household.initialHouseholdPop,
      combatCollateralPopLoss: overrides.household?.combatCollateralPopLoss ?? DEFAULT_SIM_TUNING.household.combatCollateralPopLoss,
    },
    lifespan: {
      mortalMaxAge: overrides.lifespan?.mortalMaxAge ?? DEFAULT_SIM_TUNING.lifespan.mortalMaxAge,
      lv7MaxAge: overrides.lifespan?.lv7MaxAge ?? DEFAULT_SIM_TUNING.lifespan.lv7MaxAge,
      lifespanDecayRate: overrides.lifespan?.lifespanDecayRate ?? DEFAULT_SIM_TUNING.lifespan.lifespanDecayRate,
      earlySustainableMaxAge: mergeArray(
        DEFAULT_SIM_TUNING.lifespan.earlySustainableMaxAge,
        overrides.lifespan?.earlySustainableMaxAge,
      ),
      legacyLifespanBonus: mergeArray(
        DEFAULT_SIM_TUNING.lifespan.legacyLifespanBonus,
        overrides.lifespan?.legacyLifespanBonus,
      ),
    },
    spatial: {
      encounterRadius: mergeArray(DEFAULT_SIM_TUNING.spatial.encounterRadius, overrides.spatial?.encounterRadius),
      wanderBaseProb: overrides.spatial?.wanderBaseProb ?? DEFAULT_SIM_TUNING.spatial.wanderBaseProb,
      wanderLevelBonus: overrides.spatial?.wanderLevelBonus ?? DEFAULT_SIM_TUNING.spatial.wanderLevelBonus,
      breakthroughMove: overrides.spatial?.breakthroughMove
        ? [overrides.spatial.breakthroughMove[0], overrides.spatial.breakthroughMove[1]]
        : [DEFAULT_SIM_TUNING.spatial.breakthroughMove[0], DEFAULT_SIM_TUNING.spatial.breakthroughMove[1]],
    },
    terrain: {
      terrainSafetyFactor: mergeArray(DEFAULT_SIM_TUNING.terrain.terrainSafetyFactor, overrides.terrain?.terrainSafetyFactor),
      spiritualEnergyAwakeningFactor: mergeArray(
        DEFAULT_SIM_TUNING.terrain.spiritualEnergyAwakeningFactor,
        overrides.terrain?.spiritualEnergyAwakeningFactor,
      ),
      spiritualEnergyBreakthroughFactor: mergeArray(
        DEFAULT_SIM_TUNING.terrain.spiritualEnergyBreakthroughFactor,
        overrides.terrain?.spiritualEnergyBreakthroughFactor,
      ),
      terrainDangerEncounterFactor: mergeArray(
        DEFAULT_SIM_TUNING.terrain.terrainDangerEncounterFactor,
        overrides.terrain?.terrainDangerEncounterFactor,
      ),
      terrainDangerEvasionAdjust: mergeArray(
        DEFAULT_SIM_TUNING.terrain.terrainDangerEvasionAdjust,
        overrides.terrain?.terrainDangerEvasionAdjust,
      ),
    },
    settlement: {
      expandThreshold: overrides.settlement?.expandThreshold ?? DEFAULT_SIM_TUNING.settlement.expandThreshold,
      shrinkThreshold: overrides.settlement?.shrinkThreshold ?? DEFAULT_SIM_TUNING.settlement.shrinkThreshold,
    },
    mortalDeath: {
      baseDeathRate: overrides.mortalDeath?.baseDeathRate ?? DEFAULT_SIM_TUNING.mortalDeath.baseDeathRate,
      densityPressureFactor: overrides.mortalDeath?.densityPressureFactor ?? DEFAULT_SIM_TUNING.mortalDeath.densityPressureFactor,
      carryingCapacityPerCell: overrides.mortalDeath?.carryingCapacityPerCell ?? DEFAULT_SIM_TUNING.mortalDeath.carryingCapacityPerCell,
    },
    disaster: {
      enabled: overrides.disaster?.enabled ?? DEFAULT_SIM_TUNING.disaster.enabled,
      densityThreshold: overrides.disaster?.densityThreshold ?? DEFAULT_SIM_TUNING.disaster.densityThreshold,
      densityProbScale: overrides.disaster?.densityProbScale ?? DEFAULT_SIM_TUNING.disaster.densityProbScale,
      eventRecordThreshold: overrides.disaster?.eventRecordThreshold ?? DEFAULT_SIM_TUNING.disaster.eventRecordThreshold,
      types: {
        plague: mergeDisasterConfig(DEFAULT_SIM_TUNING.disaster.types.plague, overrides.disaster?.types?.plague),
        famine: mergeDisasterConfig(DEFAULT_SIM_TUNING.disaster.types.famine, overrides.disaster?.types?.famine),
        flood: mergeDisasterConfig(DEFAULT_SIM_TUNING.disaster.types.flood, overrides.disaster?.types?.flood),
        beast_tide: mergeDisasterConfig(DEFAULT_SIM_TUNING.disaster.types.beast_tide, overrides.disaster?.types?.beast_tide),
        qi_disruption: mergeDisasterConfig(DEFAULT_SIM_TUNING.disaster.types.qi_disruption, overrides.disaster?.types?.qi_disruption),
      },
    },
    memory: {
      enabled: overrides.memory?.enabled ?? DEFAULT_SIM_TUNING.memory.enabled,
      emotionalDecayRate: overrides.memory?.emotionalDecayRate ?? DEFAULT_SIM_TUNING.memory.emotionalDecayRate,
      confidenceWinDelta: overrides.memory?.confidenceWinDelta ?? DEFAULT_SIM_TUNING.memory.confidenceWinDelta,
      confidenceLossDelta: overrides.memory?.confidenceLossDelta ?? DEFAULT_SIM_TUNING.memory.confidenceLossDelta,
      cautionHeavyInjuryDelta: overrides.memory?.cautionHeavyInjuryDelta ?? DEFAULT_SIM_TUNING.memory.cautionHeavyInjuryDelta,
      cautionLightInjuryDelta: overrides.memory?.cautionLightInjuryDelta ?? DEFAULT_SIM_TUNING.memory.cautionLightInjuryDelta,
      ambitionSuccessDelta: overrides.memory?.ambitionSuccessDelta ?? DEFAULT_SIM_TUNING.memory.ambitionSuccessDelta,
      ambitionFailHighCourageDelta: overrides.memory?.ambitionFailHighCourageDelta ?? DEFAULT_SIM_TUNING.memory.ambitionFailHighCourageDelta,
      ambitionFailLowCourageDelta: overrides.memory?.ambitionFailLowCourageDelta ?? DEFAULT_SIM_TUNING.memory.ambitionFailLowCourageDelta,
      ambitionCourageThreshold: overrides.memory?.ambitionCourageThreshold ?? DEFAULT_SIM_TUNING.memory.ambitionCourageThreshold,
      bloodlustKillDelta: overrides.memory?.bloodlustKillDelta ?? DEFAULT_SIM_TUNING.memory.bloodlustKillDelta,
      bloodlustWinDelta: overrides.memory?.bloodlustWinDelta ?? DEFAULT_SIM_TUNING.memory.bloodlustWinDelta,
      rootednessSettlingDelta: overrides.memory?.rootednessSettlingDelta ?? DEFAULT_SIM_TUNING.memory.rootednessSettlingDelta,
      rootednessDisplaceDelta: overrides.memory?.rootednessDisplaceDelta ?? DEFAULT_SIM_TUNING.memory.rootednessDisplaceDelta,
      breakthroughFearDelta: overrides.memory?.breakthroughFearDelta ?? DEFAULT_SIM_TUNING.memory.breakthroughFearDelta,
      encounterFleeBoost: overrides.memory?.encounterFleeBoost ?? DEFAULT_SIM_TUNING.memory.encounterFleeBoost,
      kinCombatReduction: overrides.memory?.kinCombatReduction ?? DEFAULT_SIM_TUNING.memory.kinCombatReduction,
      homingStrength: overrides.memory?.homingStrength ?? DEFAULT_SIM_TUNING.memory.homingStrength,
      dangerPlaceAvoidance: overrides.memory?.dangerPlaceAvoidance ?? DEFAULT_SIM_TUNING.memory.dangerPlaceAvoidance,
      powerSpotAttraction: overrides.memory?.powerSpotAttraction ?? DEFAULT_SIM_TUNING.memory.powerSpotAttraction,
      bloodlustDangerAttraction: overrides.memory?.bloodlustDangerAttraction ?? DEFAULT_SIM_TUNING.memory.bloodlustDangerAttraction,
      breakthroughFearDelayProb: overrides.memory?.breakthroughFearDelayProb ?? DEFAULT_SIM_TUNING.memory.breakthroughFearDelayProb,
    },
    relationship: {
      enabled: overrides.relationship?.enabled ?? DEFAULT_SIM_TUNING.relationship.enabled,
      allyDecayRate: overrides.relationship?.allyDecayRate ?? DEFAULT_SIM_TUNING.relationship.allyDecayRate,
      rivalDecayRate: overrides.relationship?.rivalDecayRate ?? DEFAULT_SIM_TUNING.relationship.rivalDecayRate,
      allyStrengthPerEncounter: overrides.relationship?.allyStrengthPerEncounter ?? DEFAULT_SIM_TUNING.relationship.allyStrengthPerEncounter,
      rivalIntensityPerCombat: overrides.relationship?.rivalIntensityPerCombat ?? DEFAULT_SIM_TUNING.relationship.rivalIntensityPerCombat,
      mentorCultivationBonus: overrides.relationship?.mentorCultivationBonus ?? DEFAULT_SIM_TUNING.relationship.mentorCultivationBonus,
      mentorTeachingBonus: overrides.relationship?.mentorTeachingBonus ?? DEFAULT_SIM_TUNING.relationship.mentorTeachingBonus,
      mentorLevelGap: overrides.relationship?.mentorLevelGap ?? DEFAULT_SIM_TUNING.relationship.mentorLevelGap,
      mentorFormChance: overrides.relationship?.mentorFormChance ?? DEFAULT_SIM_TUNING.relationship.mentorFormChance,
      allyFormChance: overrides.relationship?.allyFormChance ?? DEFAULT_SIM_TUNING.relationship.allyFormChance,
      allyLevelGapMax: overrides.relationship?.allyLevelGapMax ?? DEFAULT_SIM_TUNING.relationship.allyLevelGapMax,
      rivalCombatThreshold: overrides.relationship?.rivalCombatThreshold ?? DEFAULT_SIM_TUNING.relationship.rivalCombatThreshold,
      fellowDiscipleCombatReduction: overrides.relationship?.fellowDiscipleCombatReduction ?? DEFAULT_SIM_TUNING.relationship.fellowDiscipleCombatReduction,
      closeAllyThreshold: overrides.relationship?.closeAllyThreshold ?? DEFAULT_SIM_TUNING.relationship.closeAllyThreshold,
    },
    interaction: {
      enabled: overrides.interaction?.enabled ?? DEFAULT_SIM_TUNING.interaction.enabled,
      sparringCultivationMin: overrides.interaction?.sparringCultivationMin ?? DEFAULT_SIM_TUNING.interaction.sparringCultivationMin,
      sparringCultivationMax: overrides.interaction?.sparringCultivationMax ?? DEFAULT_SIM_TUNING.interaction.sparringCultivationMax,
      sparringAllyStrengthGain: overrides.interaction?.sparringAllyStrengthGain ?? DEFAULT_SIM_TUNING.interaction.sparringAllyStrengthGain,
      sparringProbability: overrides.interaction?.sparringProbability ?? DEFAULT_SIM_TUNING.interaction.sparringProbability,
      teachingBoostRateMentor: overrides.interaction?.teachingBoostRateMentor ?? DEFAULT_SIM_TUNING.interaction.teachingBoostRateMentor,
      teachingBoostRateAlly: overrides.interaction?.teachingBoostRateAlly ?? DEFAULT_SIM_TUNING.interaction.teachingBoostRateAlly,
      teachingBoostDuration: overrides.interaction?.teachingBoostDuration ?? DEFAULT_SIM_TUNING.interaction.teachingBoostDuration,
      teacherCultivationGain: overrides.interaction?.teacherCultivationGain ?? DEFAULT_SIM_TUNING.interaction.teacherCultivationGain,
      teachingBoostRateMax: overrides.interaction?.teachingBoostRateMax ?? DEFAULT_SIM_TUNING.interaction.teachingBoostRateMax,
      teachingProbability: overrides.interaction?.teachingProbability ?? DEFAULT_SIM_TUNING.interaction.teachingProbability,
    },
  };
}

export function getSimTuning(): Readonly<SimTuning> {
  return activeSimTuning;
}

export function setSimTuning(overrides: SimTuningInput = {}): Readonly<SimTuning> {
  activeSimTuning = mergeSimTuning(overrides);
  return activeSimTuning;
}

export function resetSimTuning(): Readonly<SimTuning> {
  activeSimTuning = cloneSimTuning(DEFAULT_SIM_TUNING);
  return activeSimTuning;
}

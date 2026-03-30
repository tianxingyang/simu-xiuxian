export type BehaviorState =
  | 'escaping'
  | 'recuperating'
  | 'seeking_breakthrough'
  | 'settling'
  | 'wandering';

export interface Cultivator {
  id: number;
  age: number;
  cultivation: number;
  level: number;
  readonly courage: number;
  maxAge: number;
  injuredUntil: number;
  lightInjuryUntil: number;
  meridianDamagedUntil: number;
  breakthroughCooldownUntil: number;
  alive: boolean;
  cachedCourage: number;
  reachedMaxLevelAt: number;
  x: number;
  y: number;
  behaviorState: BehaviorState;
  settlingUntil: number;
  originSettlementId: number;
  originHouseholdId: number;
}

// --- Household & Settlement ---

export interface Household {
  id: number;
  settlementId: number; // -1 = unaffiliated (scattered)
  population: number;
  growthAccum: number;
  deathAccum: number;
  cellIdx: number; // y * MAP_SIZE + x
}

export type SettlementType = 'hamlet' | 'village' | 'town' | 'city';

export interface Settlement {
  id: number;
  name: string;
  cells: number[]; // cell indices
  originHouseholdId: number;
  foundedYear: number;
}

export interface LevelStat {
  ageAvg: number;
  ageMedian: number;
  courageAvg: number;
  courageMedian: number;
}

export interface YearSummary {
  year: number;
  totalPopulation: number;
  levelCounts: number[];
  newCultivators: number;
  deaths: number;
  combatDeaths: number;
  expiryDeaths: number;
  tribulations: number;
  ascensions: number;
  tribulationDeaths: number;
  promotions: number[];
  highestLevel: number;
  highestCultivation: number;
  combatDemotions: number;
  combatInjuries: number;
  combatCultLosses: number;
  combatLightInjuries: number;
  combatMeridianDamages: number;
  breakthroughAttempts: number;
  breakthroughSuccesses: number;
  breakthroughFailures: number;
  levelStats: LevelStat[];
  mortalPopulation: number;
  householdCount: number;
  settlementCount: number;
  hamletCount: number;
  villageCount: number;
  townCount: number;
  cityCount: number;
  naturalDeaths: number;
  disasterDeaths: number;
  disasterCount: number;
}

export interface SimEvent {
  id: number;
  year: number;
  type: 'combat' | 'promotion' | 'expiry' | 'breakthrough_fail' | 'tribulation' | 'disaster' | 'relationship';
  actorLevel: number;
  detail: string;
}

// --- RichEvent ---

export type NewsRank = 'S' | 'A' | 'B' | 'C';

export interface CombatActor {
  id: number;
  name?: string;
  level: number;
  cultivation: number;
  age?: number;
  behaviorState?: BehaviorState;
}

export type DefeatOutcome =
  | 'death' | 'demotion' | 'injury'
  | 'cult_loss' | 'light_injury' | 'meridian_damage';

export interface RichCombatEvent {
  type: 'combat';
  year: number;
  newsRank: NewsRank;
  winner: CombatActor;
  loser: CombatActor;
  absorbed: number;
  outcome: DefeatOutcome;
  region?: string;
  spiritualEnergy?: number;
  terrainDanger?: number;
}

export interface RichPromotionEvent {
  type: 'promotion';
  year: number;
  newsRank: NewsRank;
  subject: { id: number; name?: string; age?: number; behaviorState?: BehaviorState };
  fromLevel: number;
  toLevel: number;
  cause: 'natural' | 'combat';
  region?: string;
  spiritualEnergy?: number;
  terrainDanger?: number;
}

export interface RichExpiryEvent {
  type: 'expiry';
  year: number;
  newsRank: NewsRank;
  subject: { id: number; name?: string; age: number; behaviorState?: BehaviorState };
  level: number;
  region?: string;
  spiritualEnergy?: number;
  terrainDanger?: number;
}

export interface MilestoneDetail {
  level: number;
  cultivatorId: number;
  cultivatorName: string;
  year: number;
}

export interface RichMilestoneEvent {
  type: 'milestone';
  year: number;
  newsRank: NewsRank;
  kind: 'first_at_level' | 'last_at_level';
  detail: MilestoneDetail;
}

export interface RichBreakthroughEvent {
  type: 'breakthrough_fail';
  year: number;
  newsRank: NewsRank;
  subject: { id: number; name?: string; level: number; age?: number; behaviorState?: BehaviorState };
  penalty: 'cooldown_only' | 'cultivation_loss' | 'injury';
  cause: 'natural' | 'combat';
  region?: string;
  spiritualEnergy?: number;
  terrainDanger?: number;
}

export interface RichTribulationEvent {
  type: 'tribulation';
  year: number;
  newsRank: NewsRank;
  subject: { id: number; name?: string; level: number; age: number; behaviorState?: BehaviorState };
  outcome: 'ascension' | 'death';
  region?: string;
  spiritualEnergy?: number;
  terrainDanger?: number;
}

export type DisasterType = 'plague' | 'famine' | 'flood' | 'beast_tide' | 'qi_disruption';

export interface RichDisasterEvent {
  type: 'disaster';
  year: number;
  newsRank: NewsRank;
  disasterType: DisasterType;
  settlementId: number;
  settlementName: string;
  populationBefore: number;
  populationLost: number;
  lossRatio: number;
  region?: string;
  spiritualEnergy?: number;
  terrainDanger?: number;
}

export type RelationshipSubtype =
  | 'mentor_accept'
  | 'graduate'
  | 'ally_formed'
  | 'rival_formed'
  | 'vendetta_declared'
  | 'vendetta_fulfilled';

export interface RichRelationshipEvent {
  type: 'relationship';
  year: number;
  newsRank: NewsRank;
  subtype: RelationshipSubtype;
  actorA: { id: number; name?: string; level: number };
  actorB: { id: number; name?: string; level: number };
  region?: string;
}

export type RichEvent =
  | RichCombatEvent
  | RichPromotionEvent
  | RichExpiryEvent
  | RichMilestoneEvent
  | RichBreakthroughEvent
  | RichTribulationEvent
  | RichDisasterEvent
  | RichRelationshipEvent;

export interface EngineHooks {
  onPromotion(c: Cultivator, toLevel: number, year: number): void;
  onCombatResult(winner: Cultivator, loser: Cultivator, loserDied: boolean, year: number): void;
  onExpiry(c: Cultivator, year: number): void;
  onTribulation(c: Cultivator, outcome: 'ascension' | 'death', year: number): void;
  getName(id: number): string | undefined;
  getSettlementName(settlementId: number): string | undefined;
  getMemorySnapshot?(id: number): CharacterMemorySnapshot | undefined;
}

export interface CharacterMemorySnapshot {
  confidence: number;
  caution: number;
  ambition: number;
  bloodlust: number;
  rootedness: number;
  breakthroughFear: number;
  combatWins: number;
  combatLosses: number;
  kills: number;
  breakthroughAttempts: number;
  breakthroughSuccesses: number;
  heavyInjuries: number;
  firstCombatYear: number;
  firstBreakthroughYear: number;
  firstKillYear: number;
  worstDefeatOpponentId: number;
  greatestVictoryOpponentId: number;
}

export type ToServer =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number }
  | { type: 'ack'; tickId: number };

export type FromServer =
  | { type: 'tick'; tickId: number; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' }
  | { type: 'state'; year: number; running: boolean; speed: number; summary: YearSummary | null };

/** @deprecated Use ToServer */
export type ToWorker = ToServer;
/** @deprecated Use FromServer */
export type FromWorker = FromServer;

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
}

export interface SimEvent {
  id: number;
  year: number;
  type: 'combat' | 'promotion' | 'expiry' | 'breakthrough_fail' | 'tribulation';
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

export type RichEvent =
  | RichCombatEvent
  | RichPromotionEvent
  | RichExpiryEvent
  | RichMilestoneEvent
  | RichBreakthroughEvent
  | RichTribulationEvent;

export interface EngineHooks {
  onPromotion(c: Cultivator, toLevel: number, year: number): void;
  onCombatResult(winner: Cultivator, loser: Cultivator, loserDied: boolean, year: number): void;
  onExpiry(c: Cultivator, year: number): void;
  onTribulation(c: Cultivator, outcome: 'ascension' | 'death', year: number): void;
  getName(id: number): string | undefined;
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

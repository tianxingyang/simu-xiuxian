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
  type: 'combat' | 'promotion' | 'expiry' | 'breakthrough_fail';
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
}

export interface RichPromotionEvent {
  type: 'promotion';
  year: number;
  newsRank: NewsRank;
  subject: { id: number; name?: string };
  fromLevel: number;
  toLevel: number;
  cause: 'natural' | 'combat';
}

export interface RichExpiryEvent {
  type: 'expiry';
  year: number;
  newsRank: NewsRank;
  subject: { id: number; name?: string; age: number };
  level: number;
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
  subject: { id: number; name?: string; level: number };
  penalty: 'cooldown_only' | 'cultivation_loss' | 'injury';
  cause: 'natural' | 'combat';
}

export type RichEvent =
  | RichCombatEvent
  | RichPromotionEvent
  | RichExpiryEvent
  | RichMilestoneEvent
  | RichBreakthroughEvent;

export interface EngineHooks {
  onPromotion(c: Cultivator, toLevel: number, year: number): void;
  onCombatResult(winner: Cultivator, loser: Cultivator, loserDied: boolean, year: number): void;
  onExpiry(c: Cultivator, year: number): void;
  getName(id: number): string | undefined;
}

export type ToWorker =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number }
  | { type: 'ack' };

export type FromWorker =
  | { type: 'tick'; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' };

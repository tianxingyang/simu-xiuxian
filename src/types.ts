export interface Cultivator {
  id: number;
  age: number;
  cultivation: number;
  level: number;
  readonly courage: number;
  maxAge: number;
  alive: boolean;
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
}

export interface SimEvent {
  id: number;
  year: number;
  type: 'combat' | 'promotion' | 'expiry';
  actorLevel: number;
  detail: string;
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

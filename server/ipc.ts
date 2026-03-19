import type { BehaviorState, SimEvent, YearSummary } from '../src/types.js';
import type { StateSnapshot } from './runner.js';

// ---------------------------------------------------------------------------
// WorldContext — live engine data for LLM report enrichment
// ---------------------------------------------------------------------------

export interface RegionProfile {
  name: string;
  population: number;
  avgSpiritualEnergy: number;
  avgTerrainDanger: number;
}

export interface WorldContext {
  currentYear: number;
  population: number;
  levelCounts: number[];
  regionProfiles: RegionProfile[];
  behaviorDistribution: Record<BehaviorState, number>;
}

// ---------------------------------------------------------------------------
// Gateway <-> Simulation Worker
// ---------------------------------------------------------------------------

export type SimCommand =
  | { type: 'sim:start'; speed: number; seed: number; initialPop: number }
  | { type: 'sim:pause' }
  | { type: 'sim:step' }
  | { type: 'sim:setSpeed'; speed: number }
  | { type: 'sim:reset'; seed: number; initialPop: number }
  | { type: 'sim:ack'; tickId: number }
  | { type: 'sim:getState' }
  | { type: 'sim:clientCount'; count: number }
  | { type: 'sim:getWorldContext' };

export type SimWorkerEvent =
  | { type: 'sim:state'; state: StateSnapshot }
  | { type: 'sim:tick'; tickId: number; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'sim:paused'; reason: 'manual' | 'extinction' }
  | { type: 'sim:resetDone' }
  | { type: 'sim:ready' }
  | { type: 'sim:worldContext'; context: WorldContext };

// ---------------------------------------------------------------------------
// Gateway <-> LLM Worker
// ---------------------------------------------------------------------------

export type LlmCommand =
  | { type: 'job:report'; jobId: string; fromTs?: number; toTs?: number; groupOpenid?: string; worldContext?: WorldContext }
  | { type: 'job:biography'; jobId: string; name: string; currentYear: number }
  | { type: 'job:cancel'; jobId: string };

export type LlmWorkerEvent =
  | { type: 'job:result'; jobId: string; kind: 'report' | 'biography'; payload: unknown }
  | { type: 'job:error'; jobId: string; error: string }
  | { type: 'job:ready' };

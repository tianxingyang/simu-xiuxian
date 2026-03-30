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

export interface SettlementSummary {
  totalSettlements: number;
  mortalPopulation: number;
  householdCount: number;
  hamlet: number;
  village: number;
  town: number;
  city: number;
}

export interface WorldContext {
  currentYear: number;
  population: number;
  levelCounts: number[];
  regionProfiles: RegionProfile[];
  behaviorDistribution: Record<BehaviorState, number>;
  settlementSummary?: SettlementSummary;
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
  | { type: 'sim:getWorldContext' }
  | { type: 'sim:evalQuery'; queryId: string; expression: string };

export type SimWorkerEvent =
  | { type: 'sim:state'; state: StateSnapshot }
  | { type: 'sim:tick'; tickId: number; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'sim:paused'; reason: 'manual' | 'extinction' }
  | { type: 'sim:resetDone' }
  | { type: 'sim:ready' }
  | { type: 'sim:worldContext'; context: WorldContext }
  | { type: 'sim:queryResult'; queryId: string; result?: unknown; error?: string };

// ---------------------------------------------------------------------------
// Gateway <-> LLM Worker
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LlmCommand =
  | { type: 'job:report'; jobId: string; fromTs?: number; toTs?: number; groupId?: string; worldContext?: WorldContext }
  | { type: 'job:biography'; jobId: string; name: string; currentYear: number }
  | { type: 'job:chat'; jobId: string; question: string; history: ChatMessage[]; worldContext?: WorldContext; yearSummary?: YearSummary }
  | { type: 'job:cancel'; jobId: string }
  | { type: 'tool:memQueryResult'; jobId: string; queryId: string; result?: unknown; error?: string };

export type LlmWorkerEvent =
  | { type: 'job:result'; jobId: string; kind: 'report' | 'biography' | 'chat'; payload: unknown }
  | { type: 'job:error'; jobId: string; error: string }
  | { type: 'job:ready' }
  | { type: 'tool:memQuery'; jobId: string; queryId: string; expression: string };

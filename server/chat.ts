import type { ChatMessage, WorldContext } from './ipc.js';
import type { YearSummary } from '../src/types.js';
import { LEVEL_NAMES, LEVEL_COUNT } from '../src/constants/index.js';
import { toYaml } from './yaml.js';
import type { Val } from './yaml.js';
import { getSimTuning } from '../src/sim-tuning.js';
import { getDB } from './db.js';
import { getLogger } from './logger.js';

const log = getLogger('chat');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_HISTORY_TOKENS = 8000;
export const COMPACT_THRESHOLD = 0.8;
const MAX_TOOL_ROUNDS = 6;

// ---------------------------------------------------------------------------
// Token estimation (rough: chars / 2 for CJK-heavy content)
// ---------------------------------------------------------------------------

export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.content) chars += m.content.length;
    if (m.tool_calls) {
      for (const tc of m.tool_calls) chars += tc.function.arguments.length + tc.function.name.length;
    }
  }
  return Math.ceil(chars / 2);
}

// ---------------------------------------------------------------------------
// DB Schema description for LLM context
// ---------------------------------------------------------------------------

const DB_SCHEMA = `Tables:
- named_cultivators (id INTEGER PK, name TEXT, named_at_year INT, kill_count INT, combat_wins INT, combat_losses INT, promotion_years TEXT JSON, peak_level INT, peak_cultivation REAL, death_year INT NULL, death_cause TEXT NULL, killed_by TEXT NULL, forgotten INT)
- events (id INTEGER PK AUTOINCREMENT, year INT, type TEXT, rank TEXT [S/A/B/C], real_ts INT, payload TEXT JSON, protected INT)
  payload JSON structure varies by type:
    combat: {type,year,newsRank,winner:{id,name?,level,cultivation,age?,behaviorState?},loser:{...},absorbed,outcome,region?,spiritualEnergy?,terrainDanger?}
    promotion: {type,year,newsRank,subject:{id,name?,age?,behaviorState?},fromLevel,toLevel,cause,region?,spiritualEnergy?,terrainDanger?}
    expiry: {type,year,newsRank,subject:{id,name?,age,behaviorState?},level,region?,spiritualEnergy?,terrainDanger?}
    milestone: {type,year,newsRank,kind,detail:{level,cultivatorId,cultivatorName,year}}
    breakthrough_fail: {type,year,newsRank,subject:{id,name?,level,age?,behaviorState?},penalty,cause,region?,spiritualEnergy?,terrainDanger?}
    tribulation: {type,year,newsRank,subject:{id,name?,level,age,behaviorState?},outcome,region?,spiritualEnergy?,terrainDanger?}
- event_cultivators (cultivator_id INT, event_id INT) -- junction table
- reports (id INTEGER PK, date TEXT UNIQUE, year_from INT, year_to INT, prompt TEXT, report TEXT NULL, world_context TEXT NULL, created_at INT)
- sim_state (id INTEGER PK CHECK(id=1), current_year INT, seed INT, speed INT, running INT, highest_levels_ever TEXT, snapshot BLOB)
- world_snapshots (year INTEGER PK, data TEXT JSON) -- periodic WorldContext snapshots every 50 years
  data JSON: {currentYear, population, levelCounts[], regionProfiles[{name,population,avgSpiritualEnergy,avgTerrainDanger}], behaviorDistribution, settlementSummary?}
  Use this table for historical population trends, region comparisons over time, etc.
- bot_request_log (group_openid TEXT PK, last_request_ts INT)`;

// ---------------------------------------------------------------------------
// Engine memory interface description
// ---------------------------------------------------------------------------

const ENGINE_INTERFACE = `Available objects in mem_query sandbox:
- engine.cultivators[id] -> {id, age, cultivation, level, courage, maxAge, injuredUntil, lightInjuryUntil, meridianDamagedUntil, breakthroughCooldownUntil, alive, x, y, behaviorState, settlingUntil, originSettlementId, originHouseholdId}
  NOTE on "Until" fields: injuredUntil, lightInjuryUntil, meridianDamagedUntil, breakthroughCooldownUntil, settlingUntil are year thresholds. The condition is ACTIVE only when engine.year < fieldValue. If engine.year >= fieldValue, the condition has already ended.
- engine.aliveCount -> number (total alive cultivators)
- engine.year -> number (current simulation year)
- engine.nextId -> number (total cultivator slots, including dead)
- engine.levelGroups[level] -> Set<id> (cultivator ids at each level, 0-7)
- engine.households.count -> number
- engine.households.totalPopulation() -> number
- engine.households.getHousehold(id) -> {id, settlementId, population, growthAccum, cellIdx}
- engine.households.allHouseholds() -> Iterator<Household>
- engine.settlements.count -> number
- engine.settlements.getSettlement(id) -> {id, name, cells, originHouseholdId, foundedYear}
- engine.settlements.allSettlements() -> Iterator<Settlement>
- engine.settlements.getTypeCounts() -> {hamlet, village, town, city}
- engine.areaTags.getSpiritualEnergy(x, y) -> number (1-5)
- engine.areaTags.getTerrainDanger(x, y) -> number (1-5)
- tuning -> SimTuning object (all current simulation parameters)
- LEVEL_NAMES -> ['炼气','筑基','结丹','元婴','化神','炼虚','合体','大乘']
- LEVEL_COUNT -> 8
- REGION_NAMES -> {N:'朔北冻原', G:'苍茫草海', P:'西嶂高原', M:'天断山脉', C:'河洛中野', F:'东陵林海', H:'赤岚丘陵', S:'南淮泽国', D:'裂潮海岸', I:'潮生群岛'}
- MAP_SIZE -> 32
- identity.getActive(id) -> {id, name, namedAtYear, killCount, combatWins, combatLosses, promotionYears, peakLevel, peakCultivation, deathYear?, deathCause?, killedBy?} | undefined
- identity.active -> Map<id, NamedCultivator> (all currently known named cultivators)

IMPORTANT: Most cultivators have names managed by the identity system. Always use identity.getActive(id) or identity.active to resolve cultivator names. Do NOT display raw IDs like "修士#123" — look up names first.

Expression must return a JSON-serializable value. Use Array.from() for iterators/Maps.
Examples:
  engine.aliveCount
  engine.cultivators.filter(c => c.alive && c.level >= 5).map(c => ({id:c.id, name:identity.getActive(c.id)?.name, level:c.level, age:c.age, cultivation:c.cultivation}))
  Array.from(engine.settlements.allSettlements()).map(s => ({name:s.name, id:s.id}))
  Array.from(identity.active.values()).filter(c => !c.deathYear).sort((a,b) => b.peakLevel - a.peakLevel).slice(0,10)
  tuning.combat.defeatDeathBase`;

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function calling format)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'db_query',
      description: `Execute a read-only SQL SELECT query against the simulation SQLite database. Only SELECT statements are allowed.\n\n${DB_SCHEMA}`,
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'A SELECT SQL query' },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mem_query',
      description: `Execute a JavaScript expression in the simulation engine memory context. Returns JSON-serializable result.\n\n${ENGINE_INTERFACE}`,
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'A JS expression to evaluate in the engine sandbox' },
        },
        required: ['expression'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function formatWorldContext(ctx: WorldContext): string {
  const levelDist: Record<string, Val> = {};
  for (let i = 0; i < ctx.levelCounts.length; i++) {
    if (ctx.levelCounts[i] > 0 && LEVEL_NAMES[i]) {
      levelDist[LEVEL_NAMES[i]] = ctx.levelCounts[i];
    }
  }
  const regions = ctx.regionProfiles.map(r => ({
    name: r.name,
    population: r.population,
    spiritual_energy: r.avgSpiritualEnergy,
    terrain_danger: r.avgTerrainDanger,
  }));
  const settlement = ctx.settlementSummary;

  const obj: Record<string, Val> = {
    current_year: ctx.currentYear,
    population: ctx.population,
    level_distribution: levelDist,
    regions,
  };
  if (settlement) {
    obj.settlements = {
      total: settlement.totalSettlements,
      mortal_pop: settlement.mortalPopulation,
      households: settlement.householdCount,
      hamlet: settlement.hamlet,
      village: settlement.village,
      town: settlement.town,
      city: settlement.city,
    };
  }
  return toYaml(obj);
}

function formatYearSummary(s: YearSummary): string {
  const obj: Record<string, Val> = {
    year: s.year,
    population: s.totalPopulation,
    new_cultivators: s.newCultivators,
    deaths: s.deaths,
    combat_deaths: s.combatDeaths,
    expiry_deaths: s.expiryDeaths,
    promotions: s.promotions.reduce((sum, n) => sum + n, 0),
    highest_level: LEVEL_NAMES[s.highestLevel],
    mortal_population: s.mortalPopulation,
    settlement_count: s.settlementCount,
  };
  return toYaml(obj);
}

function formatTuning(): string {
  const t = getSimTuning();
  const obj: Record<string, Val> = {
    breakthrough_failure_cooldown: t.breakthroughFailure.cooldown,
    combat_defeat_death_base: t.combat.defeatDeathBase,
    mortal_max_age: t.lifespan.mortalMaxAge,
    lv7_max_age: t.lifespan.lv7MaxAge,
    base_awakening_rate: t.household.baseAwakeningRate,
    household_growth_rate: t.household.householdBaseGrowthRate,
  };
  return toYaml(obj);
}

export function buildSystemPrompt(worldContext?: WorldContext, yearSummary?: YearSummary): string {
  const sections: string[] = [];

  sections.push(`你是修仙世界模拟器的智能助手「天机阁」。用户可以向你询问关于修仙世界的任何问题，包括修士状态、历史事件、聚落情况、系统设定等。

直接回答用户的问题，不要提及任何技术细节（如工具、数据库、SQL、代码、接口等）。

回复要求：
- 用中文回答
- 简洁明了，避免冗长
- 只基于工具返回的实际数据回答，严禁推测、编造或脑补数据中没有的内容
- 如果查询不到相关数据，直接告知用户"暂无此数据"，不要用部分数据拼凑看似合理的回答

格式要求（严格遵守）：
- 这是QQ群聊消息，不支持任何富文本格式
- 禁止使用：# 标题、** 加粗、* 斜体、- 列表符、\` 代码块、> 引用、[] 链接
- 用换行和空行分隔段落
- 用数字编号（1. 2. 3.）代替列表符
- 用【】包裹小标题`);

  if (worldContext) {
    sections.push(`\n## 当前世界状态\n${formatWorldContext(worldContext)}`);
  }

  if (yearSummary) {
    sections.push(`\n## 当年统计\n${formatYearSummary(yearSummary)}`);
  }

  sections.push(`\n## 关键系统设定\n${formatTuning()}`);

  sections.push(`\n## 境界体系\n${LEVEL_NAMES.map((n: string, i: number) => `Lv${i} ${n}`).join(', ')}  (共${LEVEL_COUNT}个境界)`);

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// db_query execution (read-only)
// ---------------------------------------------------------------------------

const MAX_QUERY_ROWS = 50;

export function executeDbQuery(sql: string): { result?: unknown; error?: string } {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed)) {
    return { error: 'Only SELECT queries are allowed' };
  }
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA)\b/i;
  if (forbidden.test(trimmed)) {
    return { error: 'Only SELECT queries are allowed' };
  }

  // Force a maximum row limit regardless of user SQL
  const limitedSql = /\bLIMIT\s+\d+/i.test(trimmed)
    ? trimmed.replace(/\bLIMIT\s+(\d+)/i, (_m, n) => `LIMIT ${Math.min(Number(n), MAX_QUERY_ROWS)}`)
    : `${trimmed} LIMIT ${MAX_QUERY_ROWS}`;

  try {
    const rows = getDB().prepare(limitedSql).all();
    const json = JSON.stringify(rows);
    if (json.length > 8000) {
      const limited = rows.slice(0, 20);
      return { result: { rows: limited, truncated: true, total: rows.length } };
    }
    return { result: rows };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Auto-compact conversation history
// ---------------------------------------------------------------------------

export function compactHistory(history: ChatMessage[]): ChatMessage[] {
  const tokens = estimateTokens(history);
  if (tokens < MAX_HISTORY_TOKENS * COMPACT_THRESHOLD) return history;

  log.info(`compacting history: ${tokens} tokens estimated, ${history.length} messages`);

  // Keep system message if present, summarize the rest
  const summaryParts: string[] = [];
  for (const m of history) {
    if (m.role === 'system') continue;
    if (m.role === 'user' && m.content) {
      summaryParts.push(`User: ${m.content.slice(0, 100)}`);
    }
    if (m.role === 'assistant' && m.content) {
      summaryParts.push(`Assistant: ${m.content.slice(0, 150)}`);
    }
  }

  const compacted: ChatMessage = {
    role: 'user',
    content: `[Previous conversation summary]\n${summaryParts.join('\n')}\n[End of summary - continue the conversation]`,
  };

  return [compacted];
}

// ---------------------------------------------------------------------------
// Tier 1 — HISTORY_SNIP: Remove consumed tool noise (zero-cost)
// Tool results that the model has already consumed are pure noise.
// Snip them to minimal markers — no summarization, just deletion.
// ---------------------------------------------------------------------------

export function snipToolNoise(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m => {
    // Tool results: once consumed, the assistant response already has the useful info
    if (m.role === 'tool' && m.content && m.content.length > 100) {
      return { role: 'tool' as const, content: '[已处理]', tool_call_id: m.tool_call_id };
    }
    // Tool call arguments (SQL, JS expressions): noise after execution
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        ...m,
        tool_calls: m.tool_calls.map(tc => ({
          ...tc,
          function: { name: tc.function.name, arguments: '{}' },
        })),
      };
    }
    return m;
  });
}

// ---------------------------------------------------------------------------
// Tier 2 — CONTEXT_COLLAPSE: Archive old turns preserving structure (zero-cost)
// Like git log: each turn records what was asked and concluded.
// Keeps last turn in full, collapses older ones into one-line entries.
// ---------------------------------------------------------------------------

export function collapseOldTurns(messages: ChatMessage[]): ChatMessage[] {
  let priorSummary = '';

  interface Turn { question: string; answer: string }
  const turns: Turn[] = [];
  let pendingQ = '';

  for (const m of messages) {
    if (m.role === 'user' && m.content) {
      // Detect and carry forward existing collapsed history
      const collapse = m.content.match(/^\[对话历史\]\n([\s\S]*)\n\[历史结束\]/);
      if (collapse) { priorSummary = collapse[1]; continue; }
      // Also absorb legacy summary formats
      if (m.content.startsWith('[Previous conversation summary]') ||
          m.content.startsWith('[之前的对话摘要]')) {
        priorSummary = m.content; continue;
      }
      pendingQ = m.content;
    } else if (m.role === 'assistant' && m.content && !m.tool_calls && pendingQ) {
      turns.push({ question: pendingQ, answer: m.content });
      pendingQ = '';
    }
  }

  if (turns.length === 0) return messages;
  if (turns.length === 1 && !priorSummary) return messages;

  const toCollapse = turns.length > 1 ? turns.slice(0, -1) : [];
  const lastTurn = turns[turns.length - 1];

  const newEntries = toCollapse.map(t =>
    `Q: ${t.question.slice(0, 80)} → A: ${t.answer.slice(0, 150)}`
  ).join('\n');

  const fullLog = [priorSummary, newEntries].filter(Boolean).join('\n');

  const result: ChatMessage[] = [];
  if (fullLog) {
    result.push({ role: 'user', content: `[对话历史]\n${fullLog}\n[历史结束]\n\n${lastTurn.question}` });
  } else {
    result.push({ role: 'user', content: lastTurn.question });
  }
  result.push({ role: 'assistant', content: lastTurn.answer });

  return result;
}

// ---------------------------------------------------------------------------
// Chat result type
// ---------------------------------------------------------------------------

export interface ChatResult {
  reply: string;
  updatedHistory: ChatMessage[];
}

export { MAX_TOOL_ROUNDS };

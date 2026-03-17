import { LEVEL_NAMES } from '../src/constants.js';
import { toYaml } from './yaml.js';
import type { EventRow, NamedCultivatorRow } from './db.js';
import { queryNamedCultivatorByName, queryEventsForCultivator } from './db.js';
import { type PromptMessage, callLLM } from './reporter.js';
import { llmConfig } from './config.js';

// ---------------------------------------------------------------------------
// Memory Decay — Ebbinghaus forgetting curve: R(t) = e^(-t/S)
// S = memoryYears / ln(20), calibrated so R ≈ 0.05 at t = memoryYears.
// ---------------------------------------------------------------------------

const MEMORY_YEARS: readonly number[] = [
  /* Lv0 */ 0, /* Lv1 */ 0,
  /* Lv2 结丹 */ 100,
  /* Lv3 元婴 */ 300,
  /* Lv4 化神 */ 800,
  /* Lv5 炼虚 */ 2000,
  /* Lv6 合体 */ 5000,
  /* Lv7 大乘 */ 15000,
];

const LN_20 = Math.log(20); // ≈ 2.996

type MemoryLevel = 'vivid' | 'fading' | 'legend' | 'forgotten';

function calcMemoryLevel(row: NamedCultivatorRow, currentYear: number): MemoryLevel {
  if (row.death_year === null) return 'vivid';
  if (row.death_cause === 'ascension') return 'vivid';

  const elapsed = currentYear - row.death_year;
  if (elapsed <= 0) return 'vivid';

  const duration = MEMORY_YEARS[row.peak_level] ?? 50;
  const R = Math.exp(-elapsed * LN_20 / duration);

  if (R > 0.6) return 'vivid';
  if (R > 0.25) return 'fading';
  if (R > 0.05) return 'legend';
  return 'forgotten';
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  text: string;
  memoryLevel: MemoryLevel;
  expiry: number;
}

const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function getCached(name: string): CacheEntry | null {
  const entry = cache.get(name);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(name);
    return null;
  }
  return entry;
}

function setCache(name: string, text: string, memoryLevel: MemoryLevel): void {
  cache.set(name, { text, memoryLevel, expiry: Date.now() + CACHE_TTL });
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const MEMORY_STYLE: Record<Exclude<MemoryLevel, 'forgotten'>, string> = {
  vivid: '请以生动详尽的风格讲述此人的故事。提及具体的对手名字、战斗经过、晋升时的情景。用词华丽，适当渲染场景和心理活动。',
  fading: '此人的故事已有些久远。请以"据说当年…"、"老朽依稀记得…"的语气讲述，只提及最重要的事件，细节可以模糊处理。篇幅较短。',
  legend: '此人的故事已非常久远，只剩下片段传说。请用"江湖上曾有此人…"、"坊间流传…"的语气，寥寥数语概括其一生，不超过四句话。',
};

function levelName(lv: number): string {
  return LEVEL_NAMES[lv] ?? `Lv${lv}`;
}

function buildPrompt(
  row: NamedCultivatorRow,
  events: EventRow[],
  memory: MemoryLevel,
  currentYear: number,
): PromptMessage[] {
  const isAlive = row.death_year === null;
  const promotions = JSON.parse(row.promotion_years) as { year: number; toLevel: number }[];

  const system = `你是一位修仙世界茶馆里的老说书人，阅历丰富，见证过无数修士的起落。讲述风格古朴、有画面感，像在茶馆里给客人讲故事。

要求：
- 重要事件（晋升、战斗战绩、死因）必须与素材一致，不可捏造
- 事件之间可以添加过渡叙事、心理描写、场景渲染
- 境界名称使用中文：炼气/筑基/结丹/元婴/化神/炼虚/合体/大乘
- ${isAlive ? '此人尚在人世，以"且看后事如何"收尾' : '此人已故，讲述其完整一生'}
- ${MEMORY_STYLE[memory as keyof typeof MEMORY_STYLE]}
- 总长度控制在600字以内
- 纯文本输出，不要使用markdown`;

  // filter events by memory level
  let filtered: EventRow[];
  if (memory === 'fading') {
    filtered = events.filter(e => {
      const r = JSON.parse(e.payload).newsRank;
      return r === 'S' || r === 'A';
    });
  } else if (memory === 'legend') {
    filtered = events.filter(e => JSON.parse(e.payload).newsRank === 'S');
  } else {
    filtered = events;
  }

  const maxEvents = memory === 'vivid' ? 30 : 10;
  const eventData = filtered.slice(0, maxEvents).map(e => {
    const p = JSON.parse(e.payload);
    return { year: e.year, type: e.type, rank: e.rank, ...p };
  });

  const user = toYaml({
    cultivator: {
      name: row.name,
      peak_level: levelName(row.peak_level),
      named_at_year: row.named_at_year,
      kill_count: row.kill_count,
      combat_wins: row.combat_wins,
      combat_losses: row.combat_losses,
      promotions: promotions.map(p => ({ year: p.year, to: levelName(p.toLevel) })),
      peak_cultivation: Math.round(row.peak_cultivation * 10) / 10,
      death_year: row.death_year,
      death_cause: row.death_cause,
      killed_by: row.killed_by,
      is_alive: isAlive,
    },
    events: eventData,
    current_year: currentYear,
    memory_level: memory,
  });

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BiographyResult {
  status: 'ok' | 'not_found' | 'forgotten' | 'error';
  biography?: string;
  cultivator?: { name: string; peakLevel: string; isAlive: boolean; memoryLevel: MemoryLevel };
  error?: string;
}

export async function generateBiography(
  name: string,
  currentYear: number,
): Promise<BiographyResult> {
  const row = queryNamedCultivatorByName(name);

  // --- not found ---
  if (!row) {
    return {
      status: 'not_found',
      biography: `老朽行走江湖数百年，遍阅各派典籍，却从未听闻"${name}"此人。或许是哪位散修，未曾留下什么痕迹吧。`,
    };
  }

  const memory = calcMemoryLevel(row, currentYear);
  const peak = levelName(row.peak_level);
  const isAlive = row.death_year === null;
  const meta = { name, peakLevel: peak, isAlive, memoryLevel: memory };

  // --- forgotten ---
  if (memory === 'forgotten') {
    const text = `"${name}"？这个名字……老朽似乎有些印象，又似乎没有。年代太久远了，连坊间都不再流传此人的故事了。`;
    setCache(name, text, memory);
    return { status: 'forgotten', biography: text, cultivator: meta };
  }

  // --- cache hit ---
  const cached = getCached(name);
  if (cached && cached.memoryLevel === memory) {
    return { status: 'ok', biography: cached.text, cultivator: meta };
  }

  // --- no API key ---
  if (!llmConfig.apiKey) {
    return { status: 'error', error: 'LLM_API_KEY not configured' };
  }

  // --- generate ---
  const events = queryEventsForCultivator(row.id);
  const messages = buildPrompt(row, events, memory, currentYear);

  try {
    const biography = await callLLM(messages);
    setCache(name, biography, memory);
    return { status: 'ok', biography, cultivator: meta };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[biography] LLM call failed:', msg);
    return { status: 'error', error: msg };
  }
}

import { LEVEL_NAMES } from '../src/constants.js';
import type { RichEvent, NewsRank } from '../src/types.js';
import { config } from './config.js';
import { pushToQQ } from './bot.js';
import {
  type EventRow,
  type NamedCultivatorRow,
  getDB,
  queryEventsByDateRange,
  queryNamedCultivator,
  upsertDailyReport,
} from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Statistics {
  promotions: Record<string, number>;
  combat_deaths: number;
  expiry_deaths: number;
  notable_deaths: number;
}

interface Meta {
  real_date: string;
  year_from: number;
  year_to: number;
  years_simulated: number;
  population_start: number;
  population_end: number;
}

interface EnrichedEvent {
  event: RichEvent;
  event_id: number;
  bios: NamedCultivatorRow[];
}

interface AggregatedData {
  headlines: EnrichedEvent[];
  major_events: EnrichedEvent[];
  statistics: Statistics;
  meta: Meta;
}

interface PromptMessage {
  role: 'system' | 'user';
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

function dateToUtc8Bounds(dateStr: string): { from: number; to: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc8Start = Date.UTC(y, m - 1, d) - UTC8_OFFSET_MS;
  return { from: Math.floor(utc8Start / 1000), to: Math.floor(utc8Start / 1000) + 86400 };
}

function yesterdayUtc8(): string {
  const now = new Date(Date.now() + UTC8_OFFSET_MS);
  const y = new Date(now.getTime() - 86400_000);
  return `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, '0')}-${String(y.getUTCDate()).padStart(2, '0')}`;
}

function highestLevel(event: RichEvent): number {
  switch (event.type) {
    case 'combat': return Math.max(event.winner.level, event.loser.level);
    case 'promotion': return event.toLevel;
    case 'expiry': return event.level;
    case 'milestone': return event.detail.level;
    case 'breakthrough_fail': return event.subject.level;
    case 'tribulation': return event.subject.level;
  }
}

function extractNamedIds(event: RichEvent): number[] {
  const ids: number[] = [];
  switch (event.type) {
    case 'combat':
      if (event.winner.name) ids.push(event.winner.id);
      if (event.loser.name) ids.push(event.loser.id);
      break;
    case 'promotion':
      if (event.subject.name) ids.push(event.subject.id);
      break;
    case 'expiry':
      if (event.subject.name) ids.push(event.subject.id);
      break;
    case 'milestone':
      ids.push(event.detail.cultivatorId);
      break;
    case 'breakthrough_fail':
      if (event.subject.name) ids.push(event.subject.id);
      break;
    case 'tribulation':
      if (event.subject.name) ids.push(event.subject.id);
      break;
  }
  return ids;
}

function enrichEvent(row: EventRow): EnrichedEvent {
  const event = JSON.parse(row.payload) as RichEvent;
  return { event, event_id: row.id, bios: [] };
}

// ---------------------------------------------------------------------------
// aggregateEvents
// ---------------------------------------------------------------------------

export function aggregateEvents(dateStr: string): AggregatedData {
  const { from, to } = dateToUtc8Bounds(dateStr);
  const rows = queryEventsByDateRange(from, to);

  const headlines: EnrichedEvent[] = [];
  const aEvents: EnrichedEvent[] = [];
  const stats: Statistics = {
    promotions: { lv2: 0, lv3: 0, lv4: 0, lv5: 0, lv6: 0, lv7: 0 },
    combat_deaths: 0,
    expiry_deaths: 0,
    notable_deaths: 0,
  };

  let yearFrom = Number.MAX_SAFE_INTEGER;
  let yearTo = 0;

  for (const row of rows) {
    const rank = row.rank as NewsRank;
    if (rank !== 'S' && rank !== 'A' && rank !== 'B') continue;

    const enriched = enrichEvent(row);
    const ev = enriched.event;

    if (ev.year < yearFrom) yearFrom = ev.year;
    if (ev.year > yearTo) yearTo = ev.year;

    if (rank === 'S') {
      headlines.push(enriched);
    } else if (rank === 'A') {
      aEvents.push(enriched);
    } else {
      // B-level: aggregate into statistics
      if (ev.type === 'promotion') {
        const key = `lv${ev.toLevel}`;
        if (key in stats.promotions) stats.promotions[key]++;
      } else if (ev.type === 'combat' && ev.outcome === 'death') {
        stats.combat_deaths++;
        if (ev.loser.name) stats.notable_deaths++;
      } else if (ev.type === 'expiry') {
        stats.expiry_deaths++;
        if (ev.subject.name) stats.notable_deaths++;
      }
    }
  }

  // Sort headlines by year asc
  headlines.sort((a, b) => a.event.year - b.event.year);

  // Sort A events: highest level desc -> year asc -> event_id asc
  aEvents.sort((a, b) => {
    const lvDiff = highestLevel(b.event) - highestLevel(a.event);
    if (lvDiff !== 0) return lvDiff;
    const yearDiff = a.event.year - b.event.year;
    if (yearDiff !== 0) return yearDiff;
    return a.event_id - b.event_id;
  });

  // Cap at 15
  const major_events = aEvents.slice(0, 15);

  // Bio enrichment for S/A events
  for (const item of [...headlines, ...major_events]) {
    const ids = extractNamedIds(item.event);
    for (const id of ids) {
      const bio = queryNamedCultivator(id);
      if (bio) {
        item.bios.push(bio);
      } else {
        console.warn(`[reporter] named cultivator id=${id} not found in DB, skipping bio enrichment`);
      }
    }
  }

  // Compute population from sim_state if possible; fallback to 0
  let populationStart = 0;
  let populationEnd = 0;

  if (yearFrom === Number.MAX_SAFE_INTEGER) {
    yearFrom = 0;
    yearTo = 0;
  }

  const meta: Meta = {
    real_date: dateStr,
    year_from: yearFrom,
    year_to: yearTo,
    years_simulated: yearTo > yearFrom ? yearTo - yearFrom : 0,
    population_start: populationStart,
    population_end: populationEnd,
  };

  return { headlines, major_events, statistics: stats, meta };
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

const SYSTEM_MESSAGE = `你是一位修仙世界的史官，负责撰写每日修仙界简报。请以日报体裁撰写，包含以下栏目：
- 头条（S级大事件，如有）
- 要闻（A级重要事件）
- 简讯（B级统计数据摘要）
- 天下大势（总结当日修仙界动态）

要求：
- 不得编造素材中没有的事件
- 可以润色措辞、增加修仙氛围描写
- 总长度控制在800字以内
- 如果当日无任何事件，请撰写一份简短的"天下太平"报道`;

function formatEventForPrompt(item: EnrichedEvent): Record<string, unknown> {
  const ev = item.event;
  const base: Record<string, unknown> = { type: ev.type, year: ev.year, rank: ev.newsRank };

  switch (ev.type) {
    case 'combat':
      base.winner = { name: ev.winner.name ?? `修士#${ev.winner.id}`, level: LEVEL_NAMES[ev.winner.level] };
      base.loser = { name: ev.loser.name ?? `修士#${ev.loser.id}`, level: LEVEL_NAMES[ev.loser.level] };
      base.outcome = ev.outcome;
      base.absorbed = ev.absorbed;
      break;
    case 'promotion':
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.from_level = LEVEL_NAMES[ev.fromLevel];
      base.to_level = LEVEL_NAMES[ev.toLevel];
      base.cause = ev.cause;
      break;
    case 'expiry':
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.level = LEVEL_NAMES[ev.level];
      base.age = ev.subject.age;
      break;
    case 'milestone':
      base.kind = ev.kind;
      base.level = LEVEL_NAMES[ev.detail.level];
      base.cultivator = ev.detail.cultivatorName;
      break;
    case 'breakthrough_fail':
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.level = LEVEL_NAMES[ev.subject.level];
      base.penalty = ev.penalty;
      break;
    case 'tribulation':
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.level = LEVEL_NAMES[ev.subject.level];
      base.outcome = ev.outcome;
      break;
  }

  if (item.bios.length > 0) {
    base.bios = item.bios.map(bio => ({
      name: bio.name,
      peak_level: LEVEL_NAMES[bio.peak_level],
      kill_count: bio.kill_count,
      combat_wins: bio.combat_wins,
      combat_losses: bio.combat_losses,
      death_year: bio.death_year,
      death_cause: bio.death_cause,
    }));
  }

  return base;
}

export function buildPrompt(data: AggregatedData): PromptMessage[] {
  const userContent = {
    real_date: data.meta.real_date,
    sim_year_range: data.meta.year_from > 0
      ? `${data.meta.year_from}-${data.meta.year_to}`
      : 'N/A',
    years_simulated: data.meta.years_simulated,
    headlines: data.headlines.map(formatEventForPrompt),
    major_events: data.major_events.map(formatEventForPrompt),
    statistics: data.statistics,
  };

  return [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: JSON.stringify(userContent, null, 2) },
  ];
}

// ---------------------------------------------------------------------------
// callDeepSeek
// ---------------------------------------------------------------------------

export async function callDeepSeek(messages: PromptMessage[]): Promise<string> {
  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`DeepSeek API error: ${resp.status} ${body}`);
  }

  const json = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return json.choices[0].message.content;
}

// ---------------------------------------------------------------------------
// generateDailyReport (full pipeline)
// ---------------------------------------------------------------------------

let _busy = false;

export function isBusy(): boolean {
  return _busy;
}

export async function generateDailyReport(date?: string): Promise<void> {
  const targetDate = date ?? yesterdayUtc8();
  console.log(`[reporter] generating report for ${targetDate}`);

  _busy = true;
  try {
    // 1. Aggregate
    const data = aggregateEvents(targetDate);

    // 2. Build prompt
    const messages = buildPrompt(data);
    const promptJson = JSON.stringify(messages);

    // 3. Call LLM (or skip)
    let report: string | null = null;

    if (!config.deepseekApiKey) {
      console.warn('[reporter] DEEPSEEK_API_KEY not set, skipping LLM call');
    } else {
      try {
        report = await callDeepSeek(messages);
      } catch (err) {
        console.error('[reporter] DeepSeek call failed:', err);
      }
    }

    // 4. Store
    upsertDailyReport({
      date: targetDate,
      yearFrom: data.meta.year_from,
      yearTo: data.meta.year_to,
      prompt: promptJson,
      report,
    });
    console.log(`[reporter] report stored for ${targetDate}, hasReport=${report !== null}`);

    // 5. Push (only if report was generated)
    if (report) {
      await pushToQQ(report);
    }
  } finally {
    _busy = false;
  }
}

// ---------------------------------------------------------------------------
// Backfill check
// ---------------------------------------------------------------------------

export function checkMissedReport(): boolean {
  const yesterday = yesterdayUtc8();
  const db = getDB();

  const existing = db
    .prepare('SELECT id FROM daily_reports WHERE date = ?')
    .get(yesterday) as { id: number } | undefined;
  if (existing) return false;

  const { from, to } = dateToUtc8Bounds(yesterday);
  const hasEvents = db
    .prepare('SELECT 1 FROM events WHERE real_ts >= ? AND real_ts < ? LIMIT 1')
    .get(from, to);
  return !!hasEvents;
}

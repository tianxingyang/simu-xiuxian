import { LEVEL_NAMES } from '../src/constants.js';
import { toYaml } from './yaml.js';
import type { RichEvent, NewsRank } from '../src/types.js';
import { llmConfig } from './config.js';
import {
  type EventRow,
  type NamedCultivatorRow,
  queryEventsByDateRange,
  queryEventStats,
  queryNamedCultivator,
  queryLastReportTs,
  upsertReport,
} from './db.js';
import type { Val } from './yaml.js';

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

export interface PromptMessage {
  role: 'system' | 'user';
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

function nowUtc8DateStr(): string {
  const now = new Date(Date.now() + UTC8_OFFSET_MS);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
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

function classifyRows(rows: EventRow[], dateStr: string): AggregatedData {
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

  headlines.sort((a, b) => a.event.year - b.event.year);

  aEvents.sort((a, b) => {
    const lvDiff = highestLevel(b.event) - highestLevel(a.event);
    if (lvDiff !== 0) return lvDiff;
    const yearDiff = a.event.year - b.event.year;
    if (yearDiff !== 0) return yearDiff;
    return a.event_id - b.event_id;
  });

  const major_events = aEvents.slice(0, 15);

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

  if (yearFrom === Number.MAX_SAFE_INTEGER) {
    yearFrom = 0;
    yearTo = 0;
  }

  const meta: Meta = {
    real_date: dateStr,
    year_from: yearFrom,
    year_to: yearTo,
    years_simulated: yearTo > yearFrom ? yearTo - yearFrom : 0,
    population_start: 0,
    population_end: 0,
  };

  return { headlines, major_events, statistics: stats, meta };
}

// ---------------------------------------------------------------------------
// aggregateEvents (timestamp-based, optimized: S/A rows + B aggregated)
// ---------------------------------------------------------------------------

export function aggregateEvents(fromTs: number, toTs: number): AggregatedData {
  console.log(`[reporter] aggregating events ts=${fromTs}~${toTs}`);
  const rows = queryEventsByDateRange(fromTs, toTs, ['S', 'A']);
  const data = classifyRows(rows, nowUtc8DateStr());

  const bStats = queryEventStats(fromTs, toTs);
  for (const { type, cnt } of bStats) {
    if (type === 'promotion') {
    } else if (type === 'combat') {
      data.statistics.combat_deaths += cnt;
    } else if (type === 'expiry') {
      data.statistics.expiry_deaths += cnt;
    }
  }

  console.log(`[reporter] aggregated: S=${data.headlines.length} A=${data.major_events.length} combat_deaths=${data.statistics.combat_deaths} expiry_deaths=${data.statistics.expiry_deaths}`);
  return data;
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

const SYSTEM_MESSAGE = `你是一位修仙世界的史官，负责撰写每日「修仙界日报」。请以古风日报体裁撰写，包含以下栏目：
- 头条（轰动天下的大事件，如有）
- 要闻（值得关注的重要事件）
- 简讯（统计数据摘要）
- 天下大势（总结当日修仙界动态）

格式要求：
- 纯文本输出，禁止使用任何 Markdown 语法（不要用 #、*、**、- 等标记符号）
- 栏目标题用【】包裹，例如【头条】【要闻】
- 用换行分隔段落，不要使用列表符号
- 报头格式：「修仙界日报」加道历纪年

内容要求：
- 不得编造素材中没有的事件
- 可以润色措辞、增加修仙氛围描写
- 总长度控制在800字以内
- 如果当日无任何事件，请撰写一份简短的"天下太平"报道`;

function formatEventForPrompt(item: EnrichedEvent): Record<string, Val> {
  const ev = item.event;
  const base: Record<string, Val> = { type: ev.type, year: ev.year };

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
    statistics: data.statistics as unknown as Record<string, Val>,
  };

  return [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: toYaml(userContent) },
  ];
}

// ---------------------------------------------------------------------------
// callLLM — OpenAI-compatible endpoint (OpenRouter / DeepSeek / etc.)
// ---------------------------------------------------------------------------

export async function callLLM(messages: PromptMessage[]): Promise<string> {
  const url = `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  console.log(`[reporter] LLM request: model=${llmConfig.model} url=${url}`);
  const t0 = Date.now();
  const ac = new AbortController();
  const totalTimer = setTimeout(() => { console.warn('[reporter] LLM total timeout (120s), aborting'); ac.abort(); }, 120_000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
        'HTTP-Referer': 'https://github.com/simu-xiuxian',
        'X-Title': 'Simu Xiuxian',
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: true,
        provider: {
          allow_fallbacks: true,
          sort: 'latency',
        },
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(totalTimer);
    console.error(`[reporter] LLM fetch failed after ${Date.now() - t0}ms:`, err);
    throw err;
  }

  if (!resp.ok) {
    clearTimeout(totalTimer);
    const body = await resp.text().catch(() => '');
    console.error(`[reporter] LLM API error: ${resp.status} ${body}`);
    throw new Error(`LLM API error: ${resp.status} ${body}`);
  }

  console.log(`[reporter] LLM response received in ${Date.now() - t0}ms, reading stream...`);

  const reader = resp.body?.getReader();
  if (!reader) { clearTimeout(totalTimer); throw new Error('LLM API returned no body'); }

  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let buf = '';
  let chunkCount = 0;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;

  const resetStale = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => { console.warn(`[reporter] LLM stream stale (30s no data after ${chunkCount} chunks), aborting`); ac.abort(); }, 30_000);
  };

  try {
    resetStale();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetStale();
      chunkCount++;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      let finished = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') { finished = true; break; }
        try {
          const parsed = JSON.parse(payload) as {
            choices: Array<{ delta: { content?: string } }>;
          };
          const content = parsed.choices[0]?.delta?.content;
          if (content) chunks.push(content);
        } catch { /* skip malformed chunks */ }
      }
      if (finished) break;
    }
  } finally {
    clearTimeout(totalTimer);
    if (staleTimer) clearTimeout(staleTimer);
    reader.releaseLock();
  }

  const result = chunks.join('');
  const elapsed = Date.now() - t0;
  console.log(`[reporter] LLM stream done: ${chunkCount} chunks, ${result.length} chars, ${elapsed}ms`);
  if (!result) throw new Error('LLM returned empty response');
  return result;
}

// ---------------------------------------------------------------------------
// generateReport (unified pipeline, timestamp-based)
// ---------------------------------------------------------------------------

let _busy = false;

export function isBusy(): boolean {
  return _busy;
}

export async function generateReport(fromTs?: number, toTs?: number): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const from = fromTs ?? queryLastReportTs() ?? (now - 86400);
  const to = toTs ?? now;

  if (_busy) {
    console.warn('[reporter] already busy, skipping');
    return null;
  }

  _busy = true;
  console.log(`[reporter] generating report: fromTs=${from} toTs=${to}`);
  try {
    const data = aggregateEvents(from, to);
    const messages = buildPrompt(data);
    const promptJson = JSON.stringify(messages);

    let report: string | null = null;

    if (!llmConfig.apiKey) {
      console.warn('[reporter] LLM_API_KEY not set, skipping LLM call');
    } else {
      try {
        report = await callLLM(messages);
      } catch (err) {
        console.error('[reporter] LLM call failed:', err);
      }
    }

    upsertReport({
      date: nowUtc8DateStr(),
      yearFrom: data.meta.year_from,
      yearTo: data.meta.year_to,
      prompt: promptJson,
      report,
    });
    console.log(`[reporter] report stored (${report ? report.length + ' chars' : 'no LLM output'}), year=${data.meta.year_from}~${data.meta.year_to}`);
    return report;
  } finally {
    _busy = false;
  }
}

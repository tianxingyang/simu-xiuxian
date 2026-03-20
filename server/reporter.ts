import { LEVEL_NAMES } from '../src/constants/index.js';
import { toYaml } from './yaml.js';
import type { BehaviorState, RichEvent, NewsRank } from '../src/types.js';
import type { WorldContext } from './ipc.js';
import { llmConfig } from './config.js';
import {
  type EventRow,
  type NamedCultivatorRow,
  queryEventsByDateRange,
  queryNamedCultivator,
  queryLastReportTs,
  queryRecentWorldContexts,
  upsertReport,
} from './db.js';
import type { Val } from './yaml.js';
import { getLogger } from './logger.js';

const log = getLogger('reporter');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Insight {
  type: 'spike' | 'trend_reversal' | 'ranking_change' | 'threshold';
  dimension: string;
  description: string;
  data: Record<string, number | string>;
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
  meta: Meta;
}

export interface PromptMessage {
  role: 'system' | 'user';
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BEHAVIOR_STATE_LABEL: Record<BehaviorState, string> = {
  escaping: '逃窜中',
  recuperating: '疗伤中',
  seeking_breakthrough: '寻求突破中',
  settling: '定居修炼中',
  wandering: '云游中',
};

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

  let yearFrom = Number.MAX_SAFE_INTEGER;
  let yearTo = 0;

  for (const row of rows) {
    const rank = row.rank as NewsRank;
    if (rank !== 'S' && rank !== 'A') continue;

    const enriched = enrichEvent(row);
    const ev = enriched.event;

    if (ev.year < yearFrom) yearFrom = ev.year;
    if (ev.year > yearTo) yearTo = ev.year;

    if (rank === 'S') {
      headlines.push(enriched);
    } else {
      aEvents.push(enriched);
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
        log.warn(`named cultivator id=${id} not found in DB, skipping bio enrichment`);
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

  return { headlines, major_events, meta };
}

// ---------------------------------------------------------------------------
// aggregateEvents (timestamp-based, S/A only)
// ---------------------------------------------------------------------------

export function aggregateEvents(fromTs: number, toTs: number): AggregatedData {
  log.info(`aggregating events ts=${fromTs}~${toTs}`);
  const rows = queryEventsByDateRange(fromTs, toTs, ['S', 'A']);
  const data = classifyRows(rows, nowUtc8DateStr());
  log.info(`aggregated: S=${data.headlines.length} A=${data.major_events.length}`);
  return data;
}

// ---------------------------------------------------------------------------
// Insight detection engine
// ---------------------------------------------------------------------------

const HISTORY_WINDOW = 5;
const SPIKE_THRESHOLD = 0.3;
const SPIKE_MIN_ABS = 5;
const TREND_MIN_STREAK = 3;

function detectSpikes(current: WorldContext, history: WorldContext[]): Insight[] {
  if (history.length < 2) return [];
  const insights: Insight[] = [];

  const metrics: { getValue: (ctx: WorldContext) => number; name: string }[] = [
    { getValue: ctx => ctx.population, name: '总人口' },
    ...current.regionProfiles.map(r => ({
      getValue: (ctx: WorldContext) => ctx.regionProfiles.find(rp => rp.name === r.name)?.population ?? 0,
      name: `${r.name}人口`,
    })),
  ];

  for (const m of metrics) {
    const cur = m.getValue(current);
    const avg = history.reduce((s, h) => s + m.getValue(h), 0) / history.length;
    if (avg === 0) continue;
    const deviation = Math.abs(cur - avg) / avg;
    if (deviation > SPIKE_THRESHOLD && Math.abs(cur - avg) >= SPIKE_MIN_ABS) {
      insights.push({
        type: 'spike',
        dimension: m.name,
        description: cur > avg ? '远超近期均值' : '远低于近期均值',
        data: { current: cur, recent_avg: Math.round(avg) },
      });
    }
  }

  return insights;
}

function detectTrendReversals(current: WorldContext, history: WorldContext[]): Insight[] {
  if (history.length < TREND_MIN_STREAK + 1) return [];
  const insights: Insight[] = [];

  const metrics: { getValue: (ctx: WorldContext) => number; name: string }[] = [
    { getValue: ctx => ctx.population, name: '总人口' },
  ];

  for (const m of metrics) {
    const values = [...history.map(h => m.getValue(h)), m.getValue(current)];
    const deltas = values.slice(1).map((v, i) => v - values[i]);

    const currentDelta = deltas[deltas.length - 1];
    const prevDeltas = deltas.slice(0, -1);
    const lastN = prevDeltas.slice(-TREND_MIN_STREAK);

    const allPositive = lastN.every(d => d > 0);
    const allNegative = lastN.every(d => d < 0);

    if (allPositive && currentDelta < 0) {
      insights.push({
        type: 'trend_reversal',
        dimension: m.name,
        description: '由升转降',
        data: { direction: '由升转降', streak_broken: lastN.length },
      });
    } else if (allNegative && currentDelta > 0) {
      insights.push({
        type: 'trend_reversal',
        dimension: m.name,
        description: '由降转升',
        data: { direction: '由降转升', streak_broken: lastN.length },
      });
    }
  }

  return insights;
}

function detectRankingChanges(current: WorldContext, history: WorldContext[]): Insight[] {
  if (history.length < 1) return [];
  const prev = history[history.length - 1];

  const curTop = current.regionProfiles
    .slice()
    .sort((a, b) => b.population - a.population)
    .slice(0, 3)
    .map(r => r.name);

  const prevTop = prev.regionProfiles
    .slice()
    .sort((a, b) => b.population - a.population)
    .slice(0, 3)
    .map(r => r.name);

  if (curTop.length < 3 || prevTop.length < 3) return [];

  const changed = curTop.some((name, i) => name !== prevTop[i]);
  if (!changed) return [];

  return [{
    type: 'ranking_change',
    dimension: '区域人口排名',
    description: `前三变动: ${prevTop.join('>')} → ${curTop.join('>')}`,
    data: { previous: prevTop.join('>'), current: curTop.join('>') },
  }];
}

function detectThresholds(current: WorldContext, history: WorldContext[]): Insight[] {
  if (history.length < 1) return [];
  const prev = history[history.length - 1];
  const insights: Insight[] = [];

  const popStep = 10000;
  const curBucket = Math.floor(current.population / popStep);
  const prevBucket = Math.floor(prev.population / popStep);
  if (curBucket > prevBucket) {
    insights.push({
      type: 'threshold',
      dimension: '总人口',
      description: `突破${curBucket * popStep}`,
      data: { milestone: curBucket * popStep, current: current.population },
    });
  }

  const highLevelIndices = [4, 5];
  for (const lvIdx of highLevelIndices) {
    const curCount = current.levelCounts[lvIdx] ?? 0;
    const prevCount = prev.levelCounts[lvIdx] ?? 0;
    const step = 10;
    const curBkt = Math.floor(curCount / step);
    const prevBkt = Math.floor(prevCount / step);
    if (curBkt > prevBkt && curCount >= step) {
      const name = LEVEL_NAMES[lvIdx];
      insights.push({
        type: 'threshold',
        dimension: `${name}修士数量`,
        description: `突破${curBkt * step}人`,
        data: { milestone: curBkt * step, current: curCount },
      });
    }
  }

  const regionStep = 1000;
  for (const r of current.regionProfiles) {
    const prevR = prev.regionProfiles.find(rp => rp.name === r.name);
    if (!prevR) continue;
    const curRBkt = Math.floor(r.population / regionStep);
    const prevRBkt = Math.floor(prevR.population / regionStep);
    if (curRBkt > prevRBkt) {
      insights.push({
        type: 'threshold',
        dimension: `${r.name}人口`,
        description: `突破${curRBkt * regionStep}`,
        data: { milestone: curRBkt * regionStep, current: r.population },
      });
    }
  }

  return insights;
}

export function computeInsights(current: WorldContext, history: WorldContext[]): Insight[] {
  return [
    ...detectSpikes(current, history),
    ...detectTrendReversals(current, history),
    ...detectRankingChanges(current, history),
    ...detectThresholds(current, history),
  ];
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

const SYSTEM_MESSAGE = `你是天机阁今日轮值真人，执掌「修仙界日报」的编撰。天机阁立于九天之上，以天机镜洞察四海八荒，凡修仙界风云变幻皆逃不过阁中法眼。请以古风日报体裁撰写，包含以下栏目：
- 头条（轰动天下的大事件，如有）
- 要闻（值得关注的重要事件）
- 天下大势（基于 insights 中的数据变化撰写天下大势分析）

格式要求：
- 纯文本输出，禁止使用任何 Markdown 语法（不要用 #、*、**、- 等标记符号）
- 栏目标题用【】包裹，例如【头条】【要闻】
- 用换行分隔段落，不要使用列表符号
- 报头格式：「修仙界日报」加道历纪年

字数要求：
- 总长度控制在300字以内
- 【头条】不超过80字
- 【要闻】不超过120字
- 【天下大势】不超过80字

内容要求：
- 不得编造素材中没有的事件
- 可以润色措辞、增加修仙氛围描写
- 如果当日无任何事件，请撰写一份简短的"天下太平"报道
- 事件中的 spiritual_energy（灵气浓度1-5）和 terrain_danger（地势险要1-5）可用于描绘场景氛围
- 修士的 state（行为状态）可用于刻画人物当时的处境

天下大势要求：
- 仅基于 insights 中提供的变化趋势进行撰写
- 如果没有 insights，则撰写"天下太平"风格的简短收尾
- 禁止罗列统计数字，用叙事方式概括
- 可引用 world_context 中的区域、灵气等信息丰富场景描写`;

function formatEventForPrompt(item: EnrichedEvent): Record<string, Val> {
  const ev = item.event;
  const base: Record<string, Val> = { type: ev.type, year: ev.year };

  if (ev.type !== 'milestone' && ev.region) {
    base.region = ev.region;
  }

  if (ev.type !== 'milestone') {
    if (ev.spiritualEnergy) base.spiritual_energy = ev.spiritualEnergy;
    if (ev.terrainDanger) base.terrain_danger = ev.terrainDanger;
  }

  switch (ev.type) {
    case 'combat': {
      const w: Record<string, Val> = { name: ev.winner.name ?? `修士#${ev.winner.id}`, level: LEVEL_NAMES[ev.winner.level] };
      if (ev.winner.age) w.age = ev.winner.age;
      if (ev.winner.behaviorState) w.state = BEHAVIOR_STATE_LABEL[ev.winner.behaviorState];
      const l: Record<string, Val> = { name: ev.loser.name ?? `修士#${ev.loser.id}`, level: LEVEL_NAMES[ev.loser.level] };
      if (ev.loser.age) l.age = ev.loser.age;
      if (ev.loser.behaviorState) l.state = BEHAVIOR_STATE_LABEL[ev.loser.behaviorState];
      base.winner = w;
      base.loser = l;
      base.outcome = ev.outcome;
      base.absorbed = ev.absorbed;
      break;
    }
    case 'promotion': {
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.from_level = LEVEL_NAMES[ev.fromLevel];
      base.to_level = LEVEL_NAMES[ev.toLevel];
      base.cause = ev.cause;
      if (ev.subject.age) base.age = ev.subject.age;
      if (ev.subject.behaviorState) base.state = BEHAVIOR_STATE_LABEL[ev.subject.behaviorState];
      break;
    }
    case 'expiry':
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.level = LEVEL_NAMES[ev.level];
      base.age = ev.subject.age;
      if (ev.subject.behaviorState) base.state = BEHAVIOR_STATE_LABEL[ev.subject.behaviorState];
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
      if (ev.subject.age) base.age = ev.subject.age;
      if (ev.subject.behaviorState) base.state = BEHAVIOR_STATE_LABEL[ev.subject.behaviorState];
      break;
    case 'tribulation':
      base.subject = ev.subject.name ?? `修士#${ev.subject.id}`;
      base.level = LEVEL_NAMES[ev.subject.level];
      base.outcome = ev.outcome;
      if (ev.subject.behaviorState) base.state = BEHAVIOR_STATE_LABEL[ev.subject.behaviorState];
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

export function buildPrompt(data: AggregatedData, worldContext?: WorldContext, insights?: Insight[]): PromptMessage[] {
  const userContent: Record<string, Val> = {
    real_date: data.meta.real_date,
    sim_year_range: data.meta.year_from > 0
      ? `${data.meta.year_from}-${data.meta.year_to}`
      : 'N/A',
    years_simulated: data.meta.years_simulated,
    headlines: data.headlines.map(formatEventForPrompt),
    major_events: data.major_events.map(formatEventForPrompt),
  };

  if (insights && insights.length > 0) {
    userContent.insights = insights.map(i => ({
      type: i.type,
      dimension: i.dimension,
      description: i.description,
      ...i.data,
    } as Record<string, Val>));
  }

  if (worldContext) {
    userContent.current_year = worldContext.currentYear;
    const levelDist: Record<string, Val> = {};
    for (let i = 0; i < worldContext.levelCounts.length; i++) {
      if (worldContext.levelCounts[i] > 0 && LEVEL_NAMES[i]) {
        levelDist[LEVEL_NAMES[i]] = worldContext.levelCounts[i];
      }
    }
    const behaviorDist: Record<string, Val> = {};
    for (const [state, count] of Object.entries(worldContext.behaviorDistribution)) {
      if (count > 0) behaviorDist[BEHAVIOR_STATE_LABEL[state as BehaviorState]] = count;
    }
    userContent.world_context = {
      population: worldContext.population,
      level_distribution: levelDist,
      behavior_distribution: behaviorDist,
      region_profiles: worldContext.regionProfiles.map(r => ({
        name: r.name,
        population: r.population,
        spiritual_energy: r.avgSpiritualEnergy,
        terrain_danger: r.avgTerrainDanger,
      })),
    };
  }

  return [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: toYaml(userContent) },
  ];
}

// ---------------------------------------------------------------------------
// callLLM — OpenAI-compatible endpoint (OpenRouter / DeepSeek / etc.)
// ---------------------------------------------------------------------------

export async function callLLM(messages: PromptMessage[], signal?: AbortSignal): Promise<string> {
  const url = `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  log.info(`LLM request: model=${llmConfig.model} url=${url}`);
  const t0 = Date.now();
  if (signal?.aborted) throw new Error('Aborted');

  const ac = new AbortController();
  const totalTimer = setTimeout(() => { log.warn('LLM total timeout (120s), aborting'); ac.abort(); }, 120_000);

  const onExternalAbort = () => { ac.abort(); };
  signal?.addEventListener('abort', onExternalAbort, { once: true });

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
        max_tokens: 800,
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
    signal?.removeEventListener('abort', onExternalAbort);
    log.error(`LLM fetch failed after ${Date.now() - t0}ms:`, err);
    throw err;
  }

  if (!resp.ok) {
    clearTimeout(totalTimer);
    signal?.removeEventListener('abort', onExternalAbort);
    const body = await resp.text().catch(() => '');
    log.error(`LLM API error: ${resp.status} ${body}`);
    throw new Error(`LLM API error: ${resp.status} ${body}`);
  }

  log.info(`LLM response received in ${Date.now() - t0}ms, reading stream...`);

  const reader = resp.body?.getReader();
  if (!reader) { clearTimeout(totalTimer); signal?.removeEventListener('abort', onExternalAbort); throw new Error('LLM API returned no body'); }

  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let buf = '';
  let chunkCount = 0;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;

  const resetStale = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => { log.warn(`LLM stream stale (30s no data after ${chunkCount} chunks), aborting`); ac.abort(); }, 30_000);
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
    signal?.removeEventListener('abort', onExternalAbort);
    reader.releaseLock();
  }

  const result = chunks.join('');
  const elapsed = Date.now() - t0;
  log.info(`LLM stream done: ${chunkCount} chunks, ${result.length} chars, ${elapsed}ms`);
  if (!result) throw new Error('LLM returned empty response');
  return result;
}

// ---------------------------------------------------------------------------
// generateReport (unified pipeline, timestamp-based)
// ---------------------------------------------------------------------------

export async function generateReport(fromTs?: number, toTs?: number, signal?: AbortSignal, worldContext?: WorldContext): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const from = fromTs ?? queryLastReportTs() ?? (now - 86400);
  const to = toTs ?? now;

  if (signal?.aborted) throw new Error('Aborted before start');

  log.info(`generating report: fromTs=${from} toTs=${to} worldContext=${!!worldContext}`);
  const data = aggregateEvents(from, to);

  let insights: Insight[] = [];
  if (worldContext) {
    const rawHistory = queryRecentWorldContexts(HISTORY_WINDOW);
    const history: WorldContext[] = [];
    for (const raw of rawHistory) {
      try { history.push(JSON.parse(raw) as WorldContext); } catch { /* skip malformed */ }
    }
    insights = computeInsights(worldContext, history);
    log.info(`insights: ${insights.length} detected`);
  }

  const messages = buildPrompt(data, worldContext, insights);
  const promptJson = JSON.stringify(messages);

  let report: string | null = null;

  if (!llmConfig.apiKey) {
    log.warn('LLM_API_KEY not set, skipping LLM call');
  } else {
    report = await callLLM(messages, signal);
  }

  upsertReport({
    date: nowUtc8DateStr(),
    yearFrom: data.meta.year_from,
    yearTo: data.meta.year_to,
    prompt: promptJson,
    report,
    worldContext: worldContext ? JSON.stringify(worldContext) : null,
  });
  log.info(`report stored (${report ? report.length + ' chars' : 'no LLM output'}), year=${data.meta.year_from}~${data.meta.year_to}`);
  return report;
}

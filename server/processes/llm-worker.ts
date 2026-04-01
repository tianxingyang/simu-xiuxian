import type { LlmCommand, LlmWorkerEvent, ChatMessage, ToolCall, WorldContext } from '../ipc.js';
import type { YearSummary } from '../../src/types.js';
import { getLastRequestTs, setLastRequestTs } from '../db.js';
import { generateReport } from '../reporter.js';
import { generateBiography } from '../biography.js';
import { llmConfig } from '../config.js';
import {
  buildSystemPrompt,
  TOOL_DEFINITIONS,
  executeDbQuery,
  compactHistory,
  snipToolNoise,
  collapseOldTurns,
  estimateTokens,
  MAX_TOOL_ROUNDS,
  MAX_HISTORY_TOKENS,
  COMPACT_THRESHOLD,
} from '../chat.js';
import type { ChatResult } from '../chat.js';
import { initLogger, getLogger } from '../logger.js';

initLogger({ tag: 'llm' });
const log = getLogger('worker');

function send(msg: LlmWorkerEvent): void {
  if (process.send) process.send(msg);
}

const activeJobs = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// Pending mem_query callbacks (LLM worker -> gateway -> sim-worker -> back)
// ---------------------------------------------------------------------------

const pendingMemQueries = new Map<string, {
  resolve: (result: { result?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

let _queryCounter = 0;

function requestMemQuery(jobId: string, expression: string): Promise<{ result?: unknown; error?: string }> {
  const queryId = `mq-${++_queryCounter}-${Date.now().toString(36)}`;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pendingMemQueries.delete(queryId);
      resolve({ error: 'mem_query timeout (10s)' });
    }, 10_000);
    pendingMemQueries.set(queryId, { resolve, timer });
    send({ type: 'tool:memQuery', jobId, queryId, expression });
  });
}

// ---------------------------------------------------------------------------
// Report / Biography handlers (unchanged logic)
// ---------------------------------------------------------------------------

async function handleReport(jobId: string, fromTs?: number, toTs?: number, groupId?: string, worldContext?: WorldContext): Promise<void> {
  const ac = new AbortController();
  activeJobs.set(jobId, ac);
  try {
    let from = fromTs;
    if (groupId && from === undefined) {
      const now = Math.floor(Date.now() / 1000);
      from = getLastRequestTs(groupId) ?? (now - 86400);
    }

    const report = await generateReport(from, toTs, ac.signal, worldContext);

    if (groupId) {
      setLastRequestTs(groupId, Math.floor(Date.now() / 1000));
    }

    if (!ac.signal.aborted) {
      send({ type: 'job:result', jobId, kind: 'report', payload: report });
    } else {
      log.warn(`report job ${jobId} aborted, discarding result`);
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      send({ type: 'job:error', jobId, error: err instanceof Error ? err.message : String(err) });
    } else {
      log.warn(`report job ${jobId} aborted during execution: ${err instanceof Error ? err.message : err}`);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

async function handleBiography(jobId: string, name: string, currentYear: number): Promise<void> {
  const ac = new AbortController();
  activeJobs.set(jobId, ac);
  try {
    const result = await generateBiography(name, currentYear, ac.signal);
    if (!ac.signal.aborted) {
      send({ type: 'job:result', jobId, kind: 'biography', payload: result });
    } else {
      log.warn(`biography job ${jobId} aborted, discarding result`);
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      send({ type: 'job:error', jobId, error: err instanceof Error ? err.message : String(err) });
    } else {
      log.warn(`biography job ${jobId} aborted during execution: ${err instanceof Error ? err.message : err}`);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

// ---------------------------------------------------------------------------
// LLM API call with tool support (non-streaming for tool call rounds)
// ---------------------------------------------------------------------------

interface LlmResponse {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

async function callLlmWithTools(
  messages: ChatMessage[],
  tools: typeof TOOL_DEFINITIONS | undefined,
  signal: AbortSignal,
): Promise<LlmResponse> {
  const url = `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const t0 = Date.now();
  if (signal.aborted) throw new Error('Aborted');

  const body: Record<string, unknown> = {
    model: llmConfig.model,
    messages,
    temperature: 0.7,
    max_tokens: 1200,
    provider: { allow_fallbacks: true, sort: 'latency' },
  };
  if (tools && tools.length > 0) body.tools = tools;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`,
      'HTTP-Referer': 'https://github.com/simu-xiuxian',
      'X-Title': 'Simu Xiuxian',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM API error: ${resp.status} ${text}`);
  }

  const data = await resp.json() as LlmResponse;
  log.info(`LLM call: ${Date.now() - t0}ms, finish_reason=${data.choices[0]?.finish_reason}`);
  return data;
}

// ---------------------------------------------------------------------------
// Execute a single tool call
// ---------------------------------------------------------------------------

async function executeTool(
  jobId: string,
  tc: ToolCall,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) return JSON.stringify({ error: 'Cancelled' });

  let args: Record<string, string>;
  try {
    args = JSON.parse(tc.function.arguments);
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments JSON' });
  }

  switch (tc.function.name) {
    case 'db_query': {
      const sql = args.sql ?? '';
      log.info(`tool db_query: ${sql.slice(0, 120)}`);
      const result = executeDbQuery(sql);
      return JSON.stringify(result);
    }
    case 'mem_query': {
      const expression = args.expression ?? '';
      log.info(`tool mem_query: ${expression.slice(0, 120)}`);
      const result = await requestMemQuery(jobId, expression);
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${tc.function.name}` });
  }
}

// ---------------------------------------------------------------------------
// Tiered context compression pipeline
// Tier 1: HISTORY_SNIP   — delete consumed tool noise (free)
// Tier 2: CONTEXT_COLLAPSE — archive old turns as structured log (free)
// Tier 3: AUTOCOMPACT    — LLM summarization (one API call)
// Tier 4: Text truncation — fallback
// ---------------------------------------------------------------------------

async function tieredCompact(history: ChatMessage[], signal: AbortSignal): Promise<ChatMessage[]> {
  const rawTokens = estimateTokens(history);
  if (rawTokens < MAX_HISTORY_TOKENS * COMPACT_THRESHOLD) return history;

  // Tier 1: HISTORY_SNIP
  let msgs = snipToolNoise(history);
  let tokens = estimateTokens(msgs);
  log.info(`compact T1-SNIP: ${rawTokens}→${tokens} tokens`);
  if (tokens < MAX_HISTORY_TOKENS * COMPACT_THRESHOLD) return msgs;

  // Tier 2: CONTEXT_COLLAPSE
  msgs = collapseOldTurns(msgs);
  tokens = estimateTokens(msgs);
  log.info(`compact T2-COLLAPSE: →${tokens} tokens, ${msgs.length} msgs`);
  if (tokens < MAX_HISTORY_TOKENS * COMPACT_THRESHOLD) return msgs;

  // Tier 3: AUTOCOMPACT (LLM call)
  log.info(`compact T3-AUTOCOMPACT: ${tokens} tokens, ${msgs.length} msgs`);
  const transcript = msgs
    .filter(m => m.role !== 'system' && m.content)
    .map(m => `${m.role}: ${m.content!.slice(0, 300)}`)
    .join('\n');

  try {
    const resp = await callLlmWithTools(
      [
        { role: 'system', content: '将以下对话精炼为简洁的中文摘要，保留关键事实、问题和结论。不超过500字。' },
        { role: 'user', content: transcript },
      ],
      undefined,
      signal,
    );
    const summary = resp.choices[0]?.message?.content;
    if (summary) {
      log.info(`T3-AUTOCOMPACT done: ${summary.length} chars`);
      return [{ role: 'user', content: `[之前的对话摘要]\n${summary}\n[摘要结束]` }];
    }
  } catch (err) {
    log.warn(`T3-AUTOCOMPACT failed: ${err instanceof Error ? err.message : err}`);
  }

  // Tier 4: text truncation fallback
  return compactHistory(msgs);
}

// ---------------------------------------------------------------------------
// Chat handler — tool call loop
// ---------------------------------------------------------------------------

async function handleChat(
  jobId: string,
  question: string,
  history: ChatMessage[],
  worldContext?: WorldContext,
  yearSummary?: YearSummary,
): Promise<void> {
  const ac = new AbortController();
  activeJobs.set(jobId, ac);

  try {
    if (!llmConfig.apiKey) {
      send({ type: 'job:error', jobId, error: 'LLM_API_KEY not configured' });
      return;
    }

    const systemPrompt = buildSystemPrompt(worldContext, yearSummary);
    const compacted = await tieredCompact(history, ac.signal);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...compacted,
      { role: 'user', content: question },
    ];

    log.info(`chat job ${jobId}: "${question.slice(0, 80)}", history=${compacted.length} msgs, tokens~${estimateTokens(messages)}`);

    let reply = '';
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      if (ac.signal.aborted) throw new Error('Aborted');
      round++;

      const resp = await callLlmWithTools(
        messages,
        round <= MAX_TOOL_ROUNDS - 1 ? TOOL_DEFINITIONS : undefined,
        ac.signal,
      );

      const choice = resp.choices[0];
      if (!choice) throw new Error('LLM returned no choices');

      const assistantMsg = choice.message;

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        reply = assistantMsg.content ?? '';
        break;
      }

      // Add assistant message with tool_calls to conversation
      const toolCalls: ToolCall[] = assistantMsg.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));

      messages.push({
        role: 'assistant',
        content: assistantMsg.content,
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const tc of toolCalls) {
        if (ac.signal.aborted) throw new Error('Aborted');
        const result = await executeTool(jobId, tc, ac.signal);
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        });
      }

      log.info(`chat job ${jobId}: round ${round}, ${toolCalls.length} tool calls`);
    }

    if (!reply && round >= MAX_TOOL_ROUNDS) {
      reply = '抱歉，查询过于复杂，请尝试更具体的问题。';
    }

    if (ac.signal.aborted) return;

    // Build updated history (exclude system message)
    const rawHistory = messages.filter(m => m.role !== 'system');
    // Add the final assistant reply
    if (reply && (rawHistory.length === 0 || rawHistory[rawHistory.length - 1].role !== 'assistant')) {
      rawHistory.push({ role: 'assistant', content: reply });
    }
    // Eagerly SNIP tool noise — next conversation won't need raw results
    const updatedHistory = snipToolNoise(rawHistory);

    const result: ChatResult = { reply, updatedHistory };
    send({ type: 'job:result', jobId, kind: 'chat', payload: result });
  } catch (err) {
    if (!ac.signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`chat job ${jobId} failed: ${msg}`);
      send({ type: 'job:error', jobId, error: msg });
    } else {
      log.warn(`chat job ${jobId} aborted`);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

// ---------------------------------------------------------------------------
// IPC message handler
// ---------------------------------------------------------------------------

process.on('message', (raw: LlmCommand) => {
  switch (raw.type) {
    case 'job:report':
      handleReport(raw.jobId, raw.fromTs, raw.toTs, raw.groupId, raw.worldContext);
      break;
    case 'job:biography':
      handleBiography(raw.jobId, raw.name, raw.currentYear);
      break;
    case 'job:chat':
      handleChat(raw.jobId, raw.question, raw.history, raw.worldContext, raw.yearSummary);
      break;
    case 'job:cancel': {
      const ac = activeJobs.get(raw.jobId);
      if (ac) {
        log.info(`cancelling job ${raw.jobId}`);
        ac.abort();
        activeJobs.delete(raw.jobId);
      }
      break;
    }
    case 'tool:memQueryResult': {
      const pending = pendingMemQueries.get(raw.queryId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingMemQueries.delete(raw.queryId);
        pending.resolve({ result: raw.result, error: raw.error });
      }
      break;
    }
  }
});

send({ type: 'job:ready' });
log.info('ready');

process.on('SIGTERM', () => {
  log.info('shutting down');
  for (const ac of activeJobs.values()) ac.abort();
  activeJobs.clear();
  process.exit(0);
});

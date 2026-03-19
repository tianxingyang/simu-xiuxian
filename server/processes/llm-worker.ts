import type { LlmCommand, LlmWorkerEvent } from '../ipc.js';
import { getDB, getLastRequestTs, setLastRequestTs } from '../db.js';
import { generateReport } from '../reporter.js';
import { generateBiography } from '../biography.js';

// Timestamp all console output (same as gateway)
{
  const ts = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(11, 19);
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origErr = console.error.bind(console);
  console.log = (...args: unknown[]) => origLog(ts(), '[llm]', ...args);
  console.warn = (...args: unknown[]) => origWarn(ts(), '[llm]', ...args);
  console.error = (...args: unknown[]) => origErr(ts(), '[llm]', ...args);
}

function send(msg: LlmWorkerEvent): void {
  if (process.send) process.send(msg);
}

// Initialize own DB connection (WAL mode, with busy_timeout for concurrent access)
const db = getDB();
db.pragma('busy_timeout = 5000');

const activeJobs = new Map<string, AbortController>();

async function handleReport(jobId: string, fromTs?: number, toTs?: number, groupOpenid?: string, worldContext?: import('../ipc.js').WorldContext): Promise<void> {
  const ac = new AbortController();
  activeJobs.set(jobId, ac);
  try {
    // If bot request with groupOpenid, use per-group time window
    let from = fromTs;
    if (groupOpenid && from === undefined) {
      const now = Math.floor(Date.now() / 1000);
      from = getLastRequestTs(groupOpenid) ?? (now - 86400);
    }

    const report = await generateReport(from, toTs, ac.signal, worldContext);

    // Update per-group timestamp on success
    if (groupOpenid) {
      setLastRequestTs(groupOpenid, Math.floor(Date.now() / 1000));
    }

    if (!ac.signal.aborted) {
      send({ type: 'job:result', jobId, kind: 'report', payload: report });
    } else {
      console.warn(`[llm] report job ${jobId} aborted, discarding result`);
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      send({ type: 'job:error', jobId, error: err instanceof Error ? err.message : String(err) });
    } else {
      console.warn(`[llm] report job ${jobId} aborted during execution: ${err instanceof Error ? err.message : err}`);
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
      console.warn(`[llm] biography job ${jobId} aborted, discarding result`);
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      send({ type: 'job:error', jobId, error: err instanceof Error ? err.message : String(err) });
    } else {
      console.warn(`[llm] biography job ${jobId} aborted during execution: ${err instanceof Error ? err.message : err}`);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

process.on('message', (raw: LlmCommand) => {
  switch (raw.type) {
    case 'job:report':
      handleReport(raw.jobId, raw.fromTs, raw.toTs, raw.groupOpenid, raw.worldContext);
      break;
    case 'job:biography':
      handleBiography(raw.jobId, raw.name, raw.currentYear);
      break;
    case 'job:cancel': {
      const ac = activeJobs.get(raw.jobId);
      if (ac) {
        console.log(`cancelling job ${raw.jobId}`);
        ac.abort();
        activeJobs.delete(raw.jobId);
      }
      break;
    }
  }
});

send({ type: 'job:ready' });
console.log('worker ready');

process.on('SIGTERM', () => {
  console.log('shutting down');
  for (const ac of activeJobs.values()) ac.abort();
  activeJobs.clear();
  process.exit(0);
});

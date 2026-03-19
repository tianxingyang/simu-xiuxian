import type { LlmCommand, LlmWorkerEvent } from '../ipc.js';
import { getLastRequestTs, setLastRequestTs } from '../db.js';
import { generateReport } from '../reporter.js';
import { generateBiography } from '../biography.js';
import { initLogger, getLogger } from '../logger.js';

initLogger({ tag: 'llm' });
const log = getLogger('worker');

function send(msg: LlmWorkerEvent): void {
  if (process.send) process.send(msg);
}

const activeJobs = new Map<string, AbortController>();

async function handleReport(jobId: string, fromTs?: number, toTs?: number, groupId?: string, worldContext?: import('../ipc.js').WorldContext): Promise<void> {
  const ac = new AbortController();
  activeJobs.set(jobId, ac);
  try {
    // If bot request with groupId, use per-group time window
    let from = fromTs;
    if (groupId && from === undefined) {
      const now = Math.floor(Date.now() / 1000);
      from = getLastRequestTs(groupId) ?? (now - 86400);
    }

    const report = await generateReport(from, toTs, ac.signal, worldContext);

    // Update per-group timestamp on success
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

process.on('message', (raw: LlmCommand) => {
  switch (raw.type) {
    case 'job:report':
      handleReport(raw.jobId, raw.fromTs, raw.toTs, raw.groupId, raw.worldContext);
      break;
    case 'job:biography':
      handleBiography(raw.jobId, raw.name, raw.currentYear);
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

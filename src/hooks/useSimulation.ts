import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { FromWorker, SimEvent, ToWorker, YearSummary } from '../types';
import { MAX_EVENTS, MAX_TREND_POINTS } from '../constants';

interface SimulationState {
  yearSummary: YearSummary | null;
  events: SimEvent[];
  trendData: YearSummary[];
  isRunning: boolean;
  isPaused: boolean;
  extinctionNotice: boolean;
}

interface SimulationControls {
  start: (seed: number, initialPop: number) => void;
  pause: () => void;
  step: () => void;
  setSpeed: (tier: number) => void;
  reset: (seed: number, initialPop: number) => void;
}

const INIT: SimulationState = {
  yearSummary: null,
  events: [],
  trendData: [],
  isRunning: false,
  isPaused: true,
  extinctionNotice: false,
};

export function useSimulation(): SimulationState & SimulationControls {
  const workerRef = useRef<Worker | null>(null);
  const speedRef = useRef(1);
  const drainingRef = useRef(false);
  const startedRef = useRef(false);
  const bufferRef = useRef<FromWorker[]>([]);
  const rafRef = useRef(0);
  const pendingSummariesRef = useRef<YearSummary[]>([]);
  const pendingEventsRef = useRef<SimEvent[]>([]);
  const lastCommitRef = useRef(0);
  const [state, setState] = useState<SimulationState>(INIT);

  useEffect(() => {
    const worker = new Worker(
      new URL('../engine/worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    const flush = () => {
      rafRef.current = 0;
      const batch = bufferRef.current;
      bufferRef.current = [];
      if (batch.length === 0) return;

      const allSummaries: YearSummary[] = [];
      const allEvents: SimEvent[] = [];
      let lastPaused: Extract<FromWorker, { type: 'paused' }> | null = null;

      for (const msg of batch) {
        if (msg.type === 'tick') {
          for (const s of msg.summaries) allSummaries.push(s);
          for (const e of msg.events) allEvents.push(e);
        } else if (msg.type === 'paused') {
          lastPaused = msg;
        }
      }

      let applyPause = false;
      if (lastPaused && !(lastPaused.reason === 'manual' && startedRef.current)) {
        startedRef.current = false;
        applyPause = true;
      }

      for (const s of allSummaries) pendingSummariesRef.current.push(s);
      for (const e of allEvents) pendingEventsRef.current.push(e);
      if (pendingEventsRef.current.length > MAX_EVENTS) {
        pendingEventsRef.current.splice(0, pendingEventsRef.current.length - MAX_EVENTS);
      }

      const latestSummary = allSummaries.length > 0
        ? allSummaries[allSummaries.length - 1] : null;

      const now = performance.now();
      const commitUi = now - lastCommitRef.current >= 500 || applyPause || !startedRef.current;

      const trendBatch = commitUi && pendingSummariesRef.current.length > 0
        ? pendingSummariesRef.current : null;
      const eventBatch = commitUi && pendingEventsRef.current.length > 0
        ? pendingEventsRef.current : null;
      if (commitUi) {
        pendingSummariesRef.current = [];
        pendingEventsRef.current = [];
        lastCommitRef.current = now;
      }

      if (eventBatch) eventBatch.reverse();

      const shouldUpdate = commitUi || applyPause;
      if (shouldUpdate) {
        // Urgent: controls + yearSummary (lightweight)
        setState(prev => {
          let next = prev;
          if (latestSummary) {
            next = { ...next, yearSummary: latestSummary };
          }
          if (applyPause && lastPaused) {
            next = {
              ...next,
              isRunning: false,
              isPaused: true,
              extinctionNotice: lastPaused.reason === 'extinction',
            };
          }
          return next;
        });

        // Deferred: charts + event log (heavy rendering, interruptible)
        if (eventBatch || trendBatch) {
          startTransition(() => {
            setState(prev => {
              let next = prev;
              if (eventBatch) {
                const newEvents = eventBatch.concat(prev.events);
                if (newEvents.length > MAX_EVENTS) newEvents.length = MAX_EVENTS;
                next = { ...next, events: newEvents };
              }
              if (trendBatch) {
                const trend = prev.trendData.concat(trendBatch);
                while (trend.length > MAX_TREND_POINTS) {
                  let w = 0;
                  for (let i = 0; i < trend.length - 1; i += 2) trend[w++] = trend[i];
                  trend[w++] = trend[trend.length - 1];
                  trend.length = w;
                }
                next = { ...next, trendData: trend };
              }
              return next;
            });
          });
        }
      }

      if (allSummaries.length > 0) {
        worker.postMessage({ type: 'ack' } satisfies ToWorker);
      }
    };

    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'reset-done') {
        drainingRef.current = false;
        return;
      }
      if (drainingRef.current) return;

      bufferRef.current.push(msg);
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    return () => {
      cancelAnimationFrame(rafRef.current);
      bufferRef.current = [];
      pendingSummariesRef.current = [];
      pendingEventsRef.current = [];
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const post = useCallback((msg: ToWorker) => {
    workerRef.current?.postMessage(msg);
  }, []);

  const start = useCallback((seed: number, initialPop: number) => {
    startedRef.current = true;
    setState(prev => ({ ...prev, isRunning: true, isPaused: false, extinctionNotice: false }));
    post({ type: 'start', speed: speedRef.current, seed, initialPop });
  }, [post]);

  const pause = useCallback(() => {
    startedRef.current = false;
    setState(prev => ({ ...prev, isRunning: false, isPaused: true }));
    post({ type: 'pause' });
  }, [post]);

  const step = useCallback(() => post({ type: 'step' }), [post]);

  const setSpeed = useCallback((tier: number) => {
    speedRef.current = tier;
    post({ type: 'setSpeed', speed: tier });
  }, [post]);

  const reset = useCallback((seed: number, initialPop: number) => {
    startedRef.current = false;
    drainingRef.current = true;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    bufferRef.current = [];
    pendingSummariesRef.current = [];
    pendingEventsRef.current = [];
    lastCommitRef.current = 0;
    setState({ ...INIT });
    post({ type: 'reset', seed, initialPop });
  }, [post]);

  return { ...state, start, pause, step, setSpeed, reset };
}

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { FromServer, SimEvent, ToServer, YearSummary } from '../types';
import { MAX_EVENTS, MAX_TREND_POINTS } from '../constants';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface SimulationState {
  yearSummary: YearSummary | null;
  events: SimEvent[];
  trendData: YearSummary[];
  isRunning: boolean;
  isPaused: boolean;
  extinctionNotice: boolean;
  connectionStatus: ConnectionStatus;
}

interface SimulationControls {
  start: (seed: number, initialPop: number) => void;
  pause: () => void;
  step: () => void;
  setSpeed: (tier: number) => void;
  reset: (seed: number, initialPop: number) => void;
}

const WS_URL = import.meta.env.VITE_WS_URL ??
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const INIT: SimulationState = {
  yearSummary: null,
  events: [],
  trendData: [],
  isRunning: false,
  isPaused: true,
  extinctionNotice: false,
  connectionStatus: 'disconnected',
};

export function useSimulation(): SimulationState & SimulationControls {
  const wsRef = useRef<WebSocket | null>(null);
  const speedRef = useRef(1);
  const drainingRef = useRef(false);
  const startedRef = useRef(false);
  const bufferRef = useRef<FromServer[]>([]);
  const rafRef = useRef(0);
  const pendingSummariesRef = useRef<YearSummary[]>([]);
  const pendingEventsRef = useRef<SimEvent[]>([]);
  const lastCommitRef = useRef(0);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const [state, setState] = useState<SimulationState>(INIT);

  const send = useCallback((msg: ToServer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;
      setState(prev => ({ ...prev, connectionStatus: 'connecting' }));

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      const flush = () => {
        rafRef.current = 0;
        const batch = bufferRef.current;
        bufferRef.current = [];
        if (batch.length === 0) return;

        const allSummaries: YearSummary[] = [];
        const allEvents: SimEvent[] = [];
        let lastPaused: Extract<FromServer, { type: 'paused' }> | null = null;
        let maxTickId = -1;

        for (const msg of batch) {
          if (msg.type === 'tick') {
            if (msg.tickId > maxTickId) maxTickId = msg.tickId;
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

        if (maxTickId >= 0) {
          send({ type: 'ack', tickId: maxTickId });
        }
      };

      ws.onopen = () => {
        reconnectDelayRef.current = RECONNECT_BASE_MS;
        setState(prev => ({ ...prev, connectionStatus: 'connected' }));
      };

      ws.onmessage = (e: MessageEvent) => {
        const msg: FromServer = JSON.parse(e.data as string);

        if (msg.type === 'state') {
          setState(prev => ({
            ...prev,
            yearSummary: msg.summary,
            isRunning: msg.running,
            isPaused: !msg.running,
          }));
          speedRef.current = msg.speed;
          return;
        }

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

      ws.onclose = () => {
        wsRef.current = null;
        if (unmountedRef.current) return;
        setState(prev => ({ ...prev, connectionStatus: 'disconnected' }));
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function scheduleReconnect() {
      if (unmountedRef.current) return;
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
      reconnectTimerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      unmountedRef.current = true;
      cancelAnimationFrame(rafRef.current);
      bufferRef.current = [];
      pendingSummariesRef.current = [];
      pendingEventsRef.current = [];
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [send]);

  const start = useCallback((seed: number, initialPop: number) => {
    startedRef.current = true;
    setState(prev => ({ ...prev, isRunning: true, isPaused: false, extinctionNotice: false }));
    send({ type: 'start', speed: speedRef.current, seed, initialPop });
  }, [send]);

  const pause = useCallback(() => {
    startedRef.current = false;
    setState(prev => ({ ...prev, isRunning: false, isPaused: true }));
    send({ type: 'pause' });
  }, [send]);

  const step = useCallback(() => send({ type: 'step' }), [send]);

  const setSpeed = useCallback((tier: number) => {
    speedRef.current = tier;
    send({ type: 'setSpeed', speed: tier });
  }, [send]);

  const reset = useCallback((seed: number, initialPop: number) => {
    startedRef.current = false;
    drainingRef.current = true;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    bufferRef.current = [];
    pendingSummariesRef.current = [];
    pendingEventsRef.current = [];
    lastCommitRef.current = 0;
    setState(prev => ({ ...INIT, connectionStatus: prev.connectionStatus }));
    send({ type: 'reset', seed, initialPop });
  }, [send]);

  return { ...state, start, pause, step, setSpeed, reset };
}

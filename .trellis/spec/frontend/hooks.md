# Hook Guidelines

## Architecture

This project has a single custom hook: `useSimulation` (`src/hooks/useSimulation.ts`).
It manages WebSocket communication, message buffering, reconnection, and React state.

---

## useSimulation Pattern

### Return Type: State + Controls

The hook returns a flat object combining read-only state and action functions:

```tsx
interface SimulationState {
  yearSummary: YearSummary | null;
  events: SimEvent[];
  trendData: YearSummary[];
  isRunning: boolean;
  isPaused: boolean;
  extinctionNotice: boolean;
  connectionStatus: ConnectionStatus; // 'connected' | 'connecting' | 'disconnected'
}

interface SimulationControls {
  start: (seed: number, initialPop: number) => void;
  pause: () => void;
  step: () => void;
  setSpeed: (tier: number) => void;
  reset: (seed: number, initialPop: number) => void;
}

// Returns merged object
export function useSimulation(): SimulationState & SimulationControls { ... }
```

### WebSocket Lifecycle

The WebSocket is created in `useEffect([], [send])` with automatic reconnection:

```tsx
useEffect(() => {
  function connect() {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => { /* reset reconnect delay, set status='connected' */ };
    ws.onmessage = (e) => { /* buffer messages */ };
    ws.onclose = () => { /* set status='disconnected', scheduleReconnect() */ };
    ws.onerror = () => { ws.close(); };
  }
  connect();
  return () => { ws.close(); };
}, [send]);
```

### Connection URL Resolution

The WebSocket URL is derived dynamically, with an env var override:

```tsx
const WS_URL = import.meta.env.VITE_WS_URL ??
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
```

### Reconnection with Exponential Backoff

On disconnect, the hook automatically reconnects with exponential backoff (1s → 30s max):

```
disconnect → wait 1s → reconnect
disconnect → wait 2s → reconnect
disconnect → wait 4s → reconnect
...
disconnect → wait 30s (max) → reconnect
successful connect → reset delay to 1s
```

### Message Handling: Buffer vs Bypass

Not all server messages go through the rAF buffer:

| Message Type  | Handling    | Reason                                   |
| ------------- | ----------- | ---------------------------------------- |
| `state`       | **Bypass**  | Initial sync on connect, update immediately |
| `reset-done`  | **Bypass**  | Clears drain flag, no UI update needed    |
| `tick`        | **Buffer**  | Batched for performance via rAF           |
| `paused`      | **Buffer**  | Processed with tick batch in flush        |

### rAF Message Buffering

WebSocket messages are buffered and flushed once per animation frame:

1. `ws.onmessage` pushes to `bufferRef.current` (except `state` and `reset-done`)
2. Schedules `requestAnimationFrame(flush)` if not already scheduled
3. `flush()` processes all buffered messages in one batch
4. UI commits every 500ms or on pause (not every message)

### startTransition for Heavy Updates

Charts and event logs use `startTransition` to avoid blocking controls:

```tsx
// Urgent: controls + yearSummary (lightweight)
setState(prev => ({ ...prev, yearSummary: latestSummary }));

// Deferred: charts + event log (heavy rendering, interruptible)
startTransition(() => {
  setState(prev => ({ ...prev, events: newEvents, trendData: trend }));
});
```

### ACK-Based Backpressure with tickId

The server waits for an `ack` message with matching `tickId` before sending the next batch:

```
Server sends { type: 'tick', tickId: N, ... } → sets awaitingAck=true → stops
UI receives tick → buffers → rAF flush → sends { type: 'ack', tickId: N }
Server receives ack → schedules next runBatch()
```

The client tracks the maximum `tickId` in each flush batch and ACKs with that value.

---

## Ref vs State Decision

| Data                     | Use         | Why                                          |
| ------------------------ | ----------- | -------------------------------------------- |
| WebSocket reference      | `useRef`    | Mutable, doesn't trigger re-render           |
| Message buffer           | `useRef`    | Accumulates between frames, no render needed  |
| rAF handle               | `useRef`    | Cancel on cleanup, no render needed           |
| Speed setting            | `useRef`    | Sent to server directly, no UI update needed  |
| Pending summaries/events | `useRef`    | Accumulated between 500ms commits             |
| Reconnect delay          | `useRef`    | Internal state, no render needed              |
| Draining flag            | `useRef`    | Reset protocol state, no render needed        |
| Running/paused flags     | `useState`  | UI needs to reflect current state             |
| Year summary             | `useState`  | Displayed in charts and stats                 |
| Events list              | `useState`  | Displayed in event log                        |
| Trend data               | `useState`  | Displayed in trend chart                      |
| Connection status        | `useState`  | Displayed in Controls indicator               |

---

## Action Callbacks

All control functions use `useCallback` for stable references:

```tsx
const send = useCallback((msg: ToServer) => {
  const ws = wsRef.current;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}, []);

const start = useCallback((seed: number, initialPop: number) => {
  startedRef.current = true;
  setState(prev => ({ ...prev, isRunning: true, isPaused: false }));
  send({ type: 'start', speed: speedRef.current, seed, initialPop });
}, [send]);
```

---

## Adding a New Hook

If adding a new custom hook:

1. Place it in `src/hooks/` with `use` prefix
2. Follow the same pattern: `useRef` for mutable state, `useState` for UI
3. Use `useCallback` for exposed functions
4. Clean up resources in the `useEffect` return function

---

## Anti-Patterns

- Do NOT create refs for values that need to trigger re-renders
- Do NOT call `setState` in `ws.onmessage` directly — buffer through rAF (except `state` and `reset-done` messages)
- Do NOT forget to cancel `requestAnimationFrame` on cleanup
- Do NOT use `useEffect` with `[state]` dependencies for WebSocket communication
- Do NOT hardcode WebSocket URLs — use `import.meta.env.VITE_WS_URL` with `location` fallback

# Hook Guidelines

## Architecture

This project has a single custom hook: `useSimulation` (`src/hooks/useSimulation.ts`).
It manages Web Worker communication, message buffering, and React state.

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

### Worker Lifecycle

The Worker is created once in `useEffect([], [])` and terminated on unmount:

```tsx
useEffect(() => {
  const worker = new Worker(
    new URL('../engine/worker.ts', import.meta.url),
    { type: 'module' },
  );
  workerRef.current = worker;
  worker.onmessage = (e) => { /* buffer messages */ };
  return () => { worker.terminate(); };
}, []);
```

### rAF Message Buffering

Worker messages are buffered and flushed once per animation frame:

1. `worker.onmessage` pushes to `bufferRef.current`
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

### ACK-Based Backpressure

The Worker waits for an `ack` message before sending the next batch:

```
Worker sends tick → sets awaitingAck=true → stops
UI receives tick → processes → sends { type: 'ack' }
Worker receives ack → schedules next runBatch()
```

---

## Ref vs State Decision

| Data                     | Use         | Why                                          |
| ------------------------ | ----------- | -------------------------------------------- |
| Worker reference         | `useRef`    | Mutable, doesn't trigger re-render           |
| Message buffer           | `useRef`    | Accumulates between frames, no render needed  |
| rAF handle               | `useRef`    | Cancel on cleanup, no render needed           |
| Speed setting            | `useRef`    | Sent to Worker directly, no UI update needed  |
| Running/paused flags     | `useState`  | UI needs to reflect current state             |
| Year summary             | `useState`  | Displayed in charts and stats                 |
| Events list              | `useState`  | Displayed in event log                        |
| Trend data               | `useState`  | Displayed in trend chart                      |

---

## Action Callbacks

All control functions use `useCallback` for stable references:

```tsx
const post = useCallback((msg: ToWorker) => {
  workerRef.current?.postMessage(msg);
}, []);

const start = useCallback((seed: number, initialPop: number) => {
  startedRef.current = true;
  setState(prev => ({ ...prev, isRunning: true, isPaused: false }));
  post({ type: 'start', speed: speedRef.current, seed, initialPop });
}, [post]);
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
- Do NOT call `setState` in `worker.onmessage` directly — buffer through rAF
- Do NOT forget to cancel `requestAnimationFrame` on cleanup
- Do NOT use `useEffect` with `[state]` dependencies for Worker communication

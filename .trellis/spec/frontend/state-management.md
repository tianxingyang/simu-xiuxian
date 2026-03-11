# State Management

## Strategy

This project uses **no external state library**. All state is managed through:

- `useState` — UI state that triggers re-renders
- `useRef` — mutable values that do NOT trigger re-renders
- Web Worker — simulation state lives in the Worker thread

---

## State Architecture

```
┌─────────────────────────────────────────────┐
│  Web Worker (engine/worker.ts)              │
│  ┌───────────────────────────────────────┐  │
│  │ SimulationEngine                      │  │
│  │  - cultivators[]  (source of truth)   │  │
│  │  - year, counters                     │  │
│  │  - levelGroups, prng                  │  │
│  └───────────────────────────────────────┘  │
│       │ postMessage(FromWorker)              │
└───────┼─────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────┐
│  useSimulation hook                         │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ useRef       │  │ useState              │  │
│  │ workerRef    │  │ yearSummary           │  │
│  │ bufferRef    │  │ events                │  │
│  │ rafRef       │  │ trendData             │  │
│  │ speedRef     │  │ isRunning / isPaused  │  │
│  │ startedRef   │  │ extinctionNotice      │  │
│  └─────────────┘  └──────────────────────┘  │
└───────┼─────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────┐
│  React Components                           │
│  Controls, LevelChart, TrendChart, etc.     │
│  (receive state as props from App.tsx)      │
└─────────────────────────────────────────────┘
```

---

## Worker Message Protocol

### Main Thread → Worker (ToWorker)

```typescript
type ToWorker =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number }
  | { type: 'ack' };
```

### Worker → Main Thread (FromWorker)

```typescript
type FromWorker =
  | { type: 'tick'; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' };
```

### Backpressure Flow

```
Worker: runBatch() → postMessage({ type: 'tick', ... }) → awaitingAck = true
UI:     onmessage → buffer → rAF flush → postMessage({ type: 'ack' })
Worker: onmessage(ack) → setTimeout(runBatch, 0)
```

---

## UI Update Throttling

Not every Worker message triggers a React state update. The hook commits to UI only when:

1. **500ms** has elapsed since the last commit, OR
2. **Pause** event received, OR
3. Simulation hasn't started yet

Heavy updates (charts, event log) use `startTransition` to remain interruptible.

---

## Component-Level State

Components manage their own local UI state with `useState`:

| Component     | Local State           | Purpose                        |
| ------------- | --------------------- | ------------------------------ |
| Controls      | `speedTier`           | Current speed selection        |
| Controls      | `inputSeed`           | Seed input value               |
| Controls      | `inputPop`            | Population input value         |
| LevelChart    | `logScale`            | Toggle log/linear Y-axis       |
| TrendChart    | `tab`                 | Active tab (population/age/courage) |
| EventLog      | `levelFilter`         | Filter events by level         |

---

## Anti-Patterns

- Do NOT use React Context for simulation state — the hook is sufficient
- Do NOT store Worker-derived data in multiple places — single source via hook
- Do NOT call `setState` synchronously in `onmessage` — always buffer through rAF
- Do NOT add external state libraries (Redux, Zustand, etc.) — unnecessary for this architecture

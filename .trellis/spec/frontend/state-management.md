# State Management

## Strategy

This project uses **no external state library**. All state is managed through:

- `useState` — UI state that triggers re-renders
- `useRef` — mutable values that do NOT trigger re-renders
- Node.js Backend — simulation state lives on the server, streamed via WebSocket

---

## State Architecture

```
┌─────────────────────────────────────────────┐
│  Node.js Backend (server/)                  │
│  ┌───────────────────────────────────────┐  │
│  │ SimulationEngine (runner.ts)          │  │
│  │  - cultivators[]  (source of truth)   │  │
│  │  - year, counters                     │  │
│  │  - levelGroups, prng                  │  │
│  └───────────────────────────────────────┘  │
│       │ WebSocket (FromServer)              │
└───────┼─────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────┐
│  useSimulation hook                         │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ useRef       │  │ useState              │  │
│  │ wsRef        │  │ yearSummary           │  │
│  │ bufferRef    │  │ events                │  │
│  │ rafRef       │  │ trendData             │  │
│  │ speedRef     │  │ isRunning / isPaused  │  │
│  │ startedRef   │  │ extinctionNotice      │  │
│  │ drainingRef  │  │ connectionStatus      │  │
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

## WebSocket Message Protocol

### Client → Server (ToServer)

```typescript
type ToServer =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number }
  | { type: 'ack'; tickId: number };
```

### Server → Client (FromServer)

```typescript
type FromServer =
  | { type: 'tick'; tickId: number; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' }
  | { type: 'state'; summary: YearSummary | null; running: boolean; speed: number };
```

### Backpressure Flow

```
Server: runBatch() → ws.send({ type: 'tick', tickId: N, ... }) → awaitingAck = true
UI:     onmessage → buffer → rAF flush → ws.send({ type: 'ack', tickId: N })
Server: onmessage(ack) → setTimeout(runBatch, 0)
```

The `tickId` is monotonically increasing. The client ACKs with the max `tickId` seen in each flush batch.

---

## UI Update Throttling

Not every WebSocket message triggers a React state update. The hook commits to UI only when:

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
- Do NOT store WebSocket-derived data in multiple places — single source via hook
- Do NOT call `setState` synchronously in `onmessage` — always buffer through rAF (except `state` and `reset-done`)
- Do NOT add external state libraries (Redux, Zustand, etc.) — unnecessary for this architecture

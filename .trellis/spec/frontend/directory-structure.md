# Project Directory Structure

## Source Layout

```
src/
├── engine/               # Core simulation logic (shared by server)
│   ├── simulation.ts     # SimulationEngine class, yearly cycle, breakthrough
│   ├── combat.ts         # Combat: encounters, defeat outcomes, loot
│   ├── prng.ts           # Deterministic PRNG (mulberry32) + truncated gaussian
│   ├── benchmark.ts      # Performance benchmark harness
│   └── profiler.ts       # Inline profiler for hot path instrumentation
├── components/           # React UI components
│   ├── Dashboard.tsx     # Layout shell (render-props pattern)
│   ├── Controls.tsx      # Simulation control bar + connection status indicator
│   ├── LevelChart.tsx    # Level distribution bar chart (Recharts)
│   ├── TrendChart.tsx    # Multi-tab trend line chart (Recharts)
│   ├── EventLog.tsx      # Filterable event log list
│   └── StatsPanel.tsx    # Statistics panel + level stats table
├── hooks/
│   └── useSimulation.ts  # WebSocket comm + rAF batching + reconnection + state
├── balance-presets/      # Versioned balance parameter presets
│   ├── index.ts          # Current preset re-export
│   └── v2026-03-08.ts    # Dated preset snapshot
├── App.tsx               # Root component (wires hook to components)
├── main.tsx              # Entry point (createRoot)
├── types.ts              # All TypeScript interfaces and type unions
├── constants.ts          # Game parameters, computed values, helpers
├── balance.ts            # Balance profile system (sigmoid/gaussian curves)
└── index.css             # All styles (single file, CSS custom properties)
```

## Supporting Directories

```
test/                       # Vitest tests + analysis scripts
├── distribution.test.ts    # Steady-state distribution validation
├── distribution.worker.ts  # Worker for parallel test collection
├── lifespan-cap.test.ts    # Lifespan boundary tests
└── perf-bench.ts           # Performance benchmarks

server/                     # Node.js backend (simulation engine + API)
├── index.ts                # HTTP + WebSocket server entry, cron scheduling
├── runner.ts               # Server-side simulation runner, batch dispatch, backpressure
├── identity.ts             # Cultivator identity system: name generation, biography tracking
├── events.ts               # Event collection + news value scoring (S/A/B/C)
├── reporter.ts             # Daily report pipeline: aggregate → prompt → DeepSeek → store
├── bot.ts                  # QQ Bot push (OneBot v11 HTTP API)
├── db.ts                   # SQLite data layer (better-sqlite3, WAL mode)
└── config.ts               # Environment variable configuration

scripts/                    # Build/analysis scripts
data/                       # SQLite database files (server)
```

## Conventions

### File Placement

| Content Type            | Location               | Example                          |
| ----------------------- | ---------------------- | -------------------------------- |
| Simulation logic        | `src/engine/`          | `simulation.ts`, `combat.ts`     |
| React components        | `src/components/`      | `LevelChart.tsx`                 |
| Custom hooks            | `src/hooks/`           | `useSimulation.ts`               |
| TypeScript types        | `src/types.ts`         | `Cultivator`, `YearSummary`      |
| Constants & formulas    | `src/constants.ts`     | `LEVEL_NAMES`, `threshold()`     |
| Balance profiles        | `src/balance-presets/` | `v2026-03-08.ts`                 |
| Server modules          | `server/`              | `runner.ts`, `reporter.ts`       |
| Tests                   | `test/`                | `distribution.test.ts`           |
| Styles                  | `src/index.css`        | Single file                      |

### Naming

- **Component files**: `PascalCase.tsx` — `LevelChart.tsx`, `StatsPanel.tsx`
- **Non-component TS**: `camelCase.ts` — `useSimulation.ts`, `simulation.ts`
- **Directories**: `kebab-case` — `balance-presets`
- **Constants**: `UPPER_SNAKE_CASE` — `LEVEL_COUNT`, `MAX_EVENTS`
- **Types/Interfaces**: `PascalCase` — `YearSummary`, `Cultivator`
- **CSS classes**: `kebab-case` — `chart-container`, `stat-item`

### Anti-Patterns

- Do NOT scatter type definitions across files — keep them in `src/types.ts`
- Do NOT create separate CSS files — use the single `src/index.css`
- Do NOT put simulation logic in components or hooks — keep it in `engine/`
- Do NOT import from `engine/` in React components — go through `useSimulation` hook

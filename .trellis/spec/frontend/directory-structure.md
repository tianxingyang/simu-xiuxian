# Project Directory Structure

## Source Layout

```
src/
├── engine/               # Core simulation (runs in Web Worker)
│   ├── simulation.ts     # SimulationEngine class, yearly cycle, breakthrough
│   ├── combat.ts         # Combat: encounters, defeat outcomes, loot
│   ├── worker.ts         # Web Worker message handling + batch dispatch
│   ├── prng.ts           # Deterministic PRNG (mulberry32) + truncated gaussian
│   ├── benchmark.ts      # Performance benchmark harness
│   └── profiler.ts       # Inline profiler for hot path instrumentation
├── components/           # React UI components
│   ├── Dashboard.tsx     # Layout shell (render-props pattern)
│   ├── Controls.tsx      # Simulation control bar
│   ├── LevelChart.tsx    # Level distribution bar chart (Recharts)
│   ├── TrendChart.tsx    # Multi-tab trend line chart (Recharts)
│   ├── EventLog.tsx      # Filterable event log list
│   └── StatsPanel.tsx    # Statistics panel + level stats table
├── hooks/
│   └── useSimulation.ts  # Worker comm + rAF batching + state
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

server/                     # Standalone Node.js server (optional)
├── index.ts                # Entry + WebSocket
├── db.ts                   # better-sqlite3 database
├── runner.ts               # Server-side simulation runner
└── config.ts               # Server config

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

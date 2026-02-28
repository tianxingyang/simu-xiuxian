# Design: 修仙世界模拟器

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Main Thread                     │
│                                                  │
│  App.tsx                                         │
│   ├─ useSimulation(hook) ◄──postMessage──┐       │
│   │   ├─ yearData (summary stats)        │       │
│   │   ├─ events (ring buffer, cap=1000)  │       │
│   │   ├─ trendData (cap=10000 points)    │       │
│   │   └─ controls (start/pause/step)     │       │
│   │                                      │       │
│   ├─ Controls ─── speed/pause/step/reset─┤       │
│   ├─ LevelChart ── bar chart             │       │
│   ├─ TrendChart ── line chart            │       │
│   ├─ EventLog ──── scrollable list       │       │
│   └─ StatsPanel ── key numbers           │       │
│                                          │       │
└──────────────────────────────────────────┼───────┘
                                           │
┌──────────────────────────────────────────┼───────┐
│                Web Worker                │       │
│                                          │       │
│  SimulationEngine                        │       │
│   ├─ cultivators: Map<id, Cultivator>    │       │
│   ├─ levelGroups: Map<level, Set<id>>    │       │
│   ├─ year: number                        │       │
│   ├─ prng: SeededRNG (Mulberry32)        │       │
│   │                                      │       │
│   ├─ tickYear()                     ─────┘       │
│   │   1. spawnNewCultivators(count)              │
│   │   2. naturalCultivation() // +1 each         │
│   │   3. processEncounters()  // snapshot Nk/N   │
│   │   4. checkPromotions()                       │
│   │   5. removeExpired()      // age >= maxAge   │
│   │   6. collectSummary()                        │
│   │                                              │
│   ├─ processEncounters()                         │
│   │   snapshot Nk/N at phase start               │
│   │   shuffle alive cultivators (seeded PRNG)    │
│   │   for each cultivator:                       │
│   │     if dead: skip                            │
│   │     roll Nk/N → pick random same-level       │
│   │     if opponent dead: cancel                 │
│   │     → fight decision → resolve               │
│   │                                              │
│   └─ combat(a, b)                                │
│       defeat_rate = b.cult / (a.cult + b.cult)   │
│       a fights if courage > defeat_rate (strict) │
│       loser dies, winner += round1(loser * 0.1)  │
│       immediate promotion check for winner       │
│                                                  │
└──────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── main.tsx
├── App.tsx
├── types.ts                # Cultivator, YearSummary, SimEvent, WorkerMessage
├── constants.ts            # LEVELS, thresholds, lifespan formulas
├── engine/
│   ├── simulation.ts       # SimulationEngine class (runs in worker)
│   ├── combat.ts           # encounter & battle logic
│   ├── prng.ts             # Mulberry32 seeded PRNG
│   └── worker.ts           # Web Worker entry, message dispatch
├── hooks/
│   └── useSimulation.ts    # Worker communication, state relay
├── components/
│   ├── Dashboard.tsx        # Grid layout container
│   ├── Controls.tsx         # Play/Pause/Step/Speed/Reset/Seed/InitPop
│   ├── LevelChart.tsx       # Bar chart (境界分布)
│   ├── TrendChart.tsx       # Line chart (人口趋势)
│   ├── EventLog.tsx         # Event list with filter (ring buffer)
│   └── StatsPanel.tsx       # Key metrics
└── index.css
```

## Core Types

```typescript
interface Cultivator {
  id: number;
  age: number;
  cultivation: number;   // float, rounded to 1 decimal
  level: number;         // 0-7
  courage: number;       // [0, 1), immutable after creation
  maxAge: number;
  alive: boolean;        // false = dead, pending cleanup
}

interface YearSummary {
  year: number;
  totalPopulation: number;
  levelCounts: number[];    // index 0-7, Lv0 always 0
  newCultivators: number;
  deaths: number;           // combat + expiry
  combatDeaths: number;
  expiryDeaths: number;
  promotions: number[];     // index 0-7, promotions into each level
  highestLevel: number;
  highestCultivation: number;
}

interface SimEvent {
  year: number;
  type: 'combat' | 'promotion' | 'expiry';
  actorLevel: number;
  detail: string;
}

// Main → Worker
type ToWorker =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number };

// Worker → Main
type FromWorker =
  | { type: 'tick'; summary: YearSummary; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' };
```

## Key Algorithms

### Seeded PRNG (Mulberry32)

```typescript
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; // [0, 1)
  };
}
```

### Encounter Processing

```
snapshotNk = Map<level, count> // frozen at phase start
snapshotN  = sum(snapshotNk)   // frozen at phase start

shuffle all alive cultivators with level >= 1 (seeded PRNG)
for each cultivator c in shuffled order:
  if c is dead: skip
  if snapshotNk[c.level] <= 1: skip  // no opponent possible
  prob = snapshotNk[c.level] / snapshotN
  if prng() < prob:
    opponent = random alive cultivator at c.level, excluding c
    if opponent is dead: cancel (no re-pick)
    resolve_encounter(c, opponent)
```

### Fight Decision & Resolution

```
For cultivator A encountering opponent B:
  defeatRateA = B.cultivation / (A.cultivation + B.cultivation)
  defeatRateB = A.cultivation / (A.cultivation + B.cultivation)
  A fights if A.courage > defeatRateA    // strict >; == means retreat
  B fights if B.courage > defeatRateB    // strict >; == means retreat

If both retreat: nothing happens
If at least one fights:
  winRateA = A.cultivation / (A.cultivation + B.cultivation)
  A wins if prng() < winRateA
  loser.alive = false
  winner.cultivation += round1(loser.cultivation * 0.1)  // round to 1 decimal
  check winner for promotion (possibly multi-level)
```

### Promotion Check

```
while cultivator.cultivation >= threshold(cultivator.level + 1)
      AND cultivator.level < 7:
  cultivator.level += 1
  if level == 1: cultivator.maxAge = 100
  else: cultivator.maxAge += 8 * 10^(level - 1)
  // lifespan bonus applied immediately
```

### Cultivation Rounding

```typescript
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
// Applied to: winner.cultivation += round1(loser.cultivation * 0.1)
```

## Performance Strategy

1. **levelGroups**: `Map<number, Set<number>>` — cultivator IDs grouped by level. O(1) Nk lookup, O(Nk) random opponent selection via array conversion.
2. **Dead marking**: Mark `alive = false` during encounters; batch-remove after all encounters complete. Update levelGroups during batch-remove.
3. **Event throttling**: Worker emits max 50 events per tick. Lv3+ events always included; remaining slots filled by random lower-level events.
4. **Trend data capping**: Main thread retains max 10,000 data points. Older data downsampled by factor of 2 when cap reached.
5. **Event log cap**: Main thread retains max 1000 events in ring buffer. Oldest discarded when full.
6. **Speed modes** (batch compute, ~2s UI update cycle):
   - Tier 1: 100 years per batch (~50 ticks/sec)
   - Tier 2: 500 years per batch (~250 ticks/sec)
   - Tier 3: 1000 years per batch (~500 ticks/sec)
   Worker computes entire batch, then posts single aggregated message.
7. **ID generation**: Monotonically increasing integer counter. Safe up to `Number.MAX_SAFE_INTEGER` (9 × 10^15).

## Chart Library

Recharts (React-native integration, declarative API):
- `BarChart` → level distribution (Lv1–Lv7)
- `LineChart` → population trend (7 lines, one per level)
- Log scale toggle for bar chart Y-axis

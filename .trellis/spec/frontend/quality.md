# Code Quality & Performance

## Build & Test Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # tsc -b && vite build
npm run test         # vitest run
npm run test:watch   # vitest (watch mode)
```

---

## Before Every Commit

- [ ] `npm run build` — No type errors
- [ ] `npm run test` — All tests pass
- [ ] Manual testing — Feature works in browser

---

## Performance Patterns

### Node.js Backend Compute Isolation

All simulation computation runs on the Node.js backend (`server/runner.ts`). The browser main thread only handles UI rendering. Data is streamed via WebSocket.

### Object Slot Reuse (No GC Pressure)

Dead cultivators return their array index to `freeSlots[]`. New spawns reuse slots instead of creating new objects:

```typescript
if (this.freeSlots.length > 0) {
  id = this.freeSlots[this.freeSlots.length - 1];
  this.freeSlots.length--;
  // reuse existing object at cultivators[id]
}
```

### TypedArrays for Hot Paths

Use TypedArrays for data that is accessed in tight loops:

```typescript
_encounterThresholds = new Float64Array(LEVEL_COUNT);
_ageSumBuf = new Float64Array(LEVEL_COUNT);
_defeatedBuf = new Uint8Array(0);
_levelArrayIndex = new Int32Array(0);
```

### Profiler Instrumentation

Hot paths are instrumented with the profiler for performance tracking:

```typescript
profiler.start('tickCultivators');
// ... hot loop ...
profiler.end('tickCultivators');
```

### Trend Data Downsampling

Trend data is downsampled when exceeding `MAX_TREND_POINTS` (2000):

```typescript
while (trend.length > MAX_TREND_POINTS) {
  let w = 0;
  for (let i = 0; i < trend.length - 1; i += 2) trend[w++] = trend[i];
  trend[w++] = trend[trend.length - 1];
  trend.length = w;
}
```

### Display Downsampling in Charts

`TrendChart` further downsamples to `MAX_DISPLAY_POINTS` (200) for rendering:

```typescript
function displaySample(src: YearSummary[]): YearSummary[] {
  if (src.length <= MAX_DISPLAY_POINTS) return src;
  // uniform sampling
}
```

---

## Testing Patterns

### Vitest Configuration

```typescript
// vite.config.ts
test: {
  include: ['test/**/*.test.ts'],
}
```

### Distribution Tests

The main test validates steady-state level distribution across multiple seeds:

- Uses `Worker` from `node:worker_threads` for parallel execution
- 100k total years across 3 seeds (42, 137, 256)
- 2k warmup years per seed
- Acceptance: each level within **±10% relative deviation** of target
- Timeout: 900s (long-running statistical test)

### Deterministic Seeding

All simulation runs use seeded PRNG for reproducibility:

```typescript
const engine = new SimulationEngine(seed, initialPop);
// seed → createPRNG(seed) → mulberry32
```

---

## Forbidden Patterns

| Pattern                   | Reason                        | Fix                              |
| ------------------------- | ----------------------------- | -------------------------------- |
| Non-null assertions `!`  | Type unsafe                   | Null check or optional chaining  |
| `any` type                | Loses type safety             | Use proper types or `unknown`    |
| `console.log` in prod    | Noise                         | Remove or use profiler           |
| Direct DOM manipulation   | React manages DOM             | Use state/refs                   |
| Synchronous heavy compute | Blocks main thread            | Keep in Node.js backend          |

---

## Balance Preset Versioning

Balance profiles are versioned by date. When tuning parameters:

1. Create a new file: `src/balance-presets/v{YYYY-MM-DD}.ts`
2. Export with dated ID: `BALANCE_PRESET_ID_V2026_03_08`
3. Update `src/balance-presets/index.ts` to point to the new preset
4. Run distribution tests to verify: `npm run test`

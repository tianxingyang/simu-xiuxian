# fix: processMemoryDecay N+1 Query Blocking Tick

## Goal

Fix `processMemoryDecay` in `server/eviction.ts` which causes tick blocking (~130s per tick) at year ~1550+ due to N+1 queries and unbounded re-scanning of all dead cultivators.

## Requirements

- Add `forgotten` column to `named_cultivators` for incremental processing
- Add reverse index on `event_cultivators(event_id)` for efficient lookups
- Replace N+1 query loop with set-based SQL (JOIN/subquery)
- Only process newly-forgotten cultivators per cycle (delta processing)
- Maintain existing eviction semantics (event unprotection logic unchanged)

## Acceptance Criteria

- [ ] Each decay cycle processes only newly-forgotten cultivators, not all dead
- [ ] No per-cultivator or per-event individual queries in the decay loop
- [ ] Reverse index exists on `event_cultivators(event_id)`
- [ ] `forgotten` flag persists so processed cultivators are never re-scanned
- [ ] Existing `runEviction` fast-path (event expiry) unchanged
- [ ] No regression in eviction correctness

## Decision (ADR-lite)

**Context**: `processMemoryDecay` does O(all_dead) work with N+1 queries every 60s, blocking the main thread for >60s at year 1550+.

**Decision**: Approach C — Incremental flag + set-based SQL + reverse index.

**Consequences**: Schema change required (add column + index). Per-cycle cost drops from O(total_dead × events) to O(newly_forgotten), approaching zero over time.

## Out of Scope

- Async/worker thread offloading (not needed after this fix)
- Changes to event retention logic (`evictExpiredEvents`)
- Changes to `isForgotten` formula

## Technical Notes

- `isForgotten` is monotonic: once true, always true (elapsed only increases)
- `exp(-elapsed * ln(20) / duration) < 0.05` simplifies to `elapsed > duration`
- PK on event_cultivators is (cultivator_id, event_id) — no reverse index for event_id lookups
- better-sqlite3 is synchronous; all queries block Node.js event loop
- Schema change is additive (new column + index), safe for existing data

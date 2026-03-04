## ADDED Requirements

### Requirement: Dense buffer capacity management
The system SHALL ensure `_defeatedBuf.length >= engine.nextId` and `_levelArrayIndex.length >= engine.nextId` at the start of each encounter phase. When `engine.nextId` exceeds current buffer length, the system SHALL reallocate both buffers to `engine.nextId` capacity. This check SHALL execute before any buffer usage within `processEncounters`.

#### Scenario: Buffer grows after spawn
- **WHEN** `spawnCultivators` increases `engine.nextId` from 20000 to 21000, and `_defeatedBuf.length` is 20000
- **THEN** at `processEncounters` entry, `_defeatedBuf` SHALL be reallocated to `new Uint8Array(21000)` and `_levelArrayIndex` SHALL be reallocated to `new Int32Array(21000)`

### Requirement: Defeated cultivator tracking via dense array
The system SHALL track defeated cultivators within each encounter phase using a pre-allocated `Uint8Array` indexed by cultivator id, replacing the per-tick `new Set<number>()` allocation. The buffer SHALL be allocated on the `SimulationEngine` instance as `_defeatedBuf` and `.fill(0)` at the start of each encounter phase. A cultivator is marked defeated by setting `_defeatedBuf[id] = 1`. The check `defeatedSet.has(id)` SHALL be replaced with `engine._defeatedBuf[id] === 1`.

#### Scenario: Defeated flag set and checked
- **WHEN** cultivator B (id=42) loses a combat and survives
- **THEN** `engine._defeatedBuf[42]` SHALL be set to 1, and subsequent iterations checking id=42 SHALL skip via `engine._defeatedBuf[42] === 1`

#### Scenario: Buffer reset between ticks
- **WHEN** a new encounter phase begins
- **THEN** `engine._defeatedBuf` SHALL have all elements set to 0 before any combat processing

#### Scenario: Buffer capacity covers all ids
- **WHEN** `engine.nextId` is 25000
- **THEN** `engine._defeatedBuf.length` SHALL be >= 25000

### Requirement: Encounter probability precomputation
The system SHALL precompute per-level encounter probability thresholds as `encounterThresholds[level] = snapshotNk[level] / snapshotN` before the combat loop begins. The combat loop SHALL use `engine.prng() >= encounterThresholds[c.level]` instead of computing `nk / snapshotN` per iteration.

#### Scenario: Precomputed threshold matches dynamic computation
- **WHEN** snapshotNk[2] = 800 and snapshotN = 10000
- **THEN** `encounterThresholds[2]` SHALL equal 0.08, and the prng comparison SHALL use this precomputed value

#### Scenario: Zero population level threshold
- **WHEN** snapshotNk[5] = 0
- **THEN** `encounterThresholds[5]` SHALL be 0, causing `prng() >= 0` to always be true, but `nk <= 1` check SHALL skip before reaching the prng call

### Requirement: Level array reverse index
The system SHALL maintain a reverse index `_levelArrayIndex: Int32Array` on the `SimulationEngine` instance, mapping cultivator id to its position within `levelArrayCache[level]`. This index SHALL be rebuilt during `buildCache` and incrementally updated during swap-remove operations. The `arr.indexOf(loser.id)` call in `resolveCombat` SHALL be replaced with `engine._levelArrayIndex[loser.id]`.

#### Scenario: Reverse index lookup replaces indexOf
- **WHEN** cultivator id=100 is at position 7 in `levelArrayCache[2]`
- **THEN** `engine._levelArrayIndex[100]` SHALL equal 7

#### Scenario: Swap-remove updates reverse index
- **WHEN** cultivator id=100 at position 7 is removed via swap-remove (last element id=200 moved to position 7)
- **THEN** `engine._levelArrayIndex[200]` SHALL be updated to 7, and `engine._levelArrayIndex[100]` SHALL be set to -1

#### Scenario: BuildCache rebuilds reverse index with sentinel reset
- **WHEN** a new encounter phase starts and buildCache runs
- **THEN** `_levelArrayIndex` SHALL first be reset via `.fill(-1)`, then populated with positions for all IDs in `levelArrayCache`. After buildCache, any ID not present in any `levelArrayCache[level]` SHALL have `_levelArrayIndex[id] === -1`

#### Scenario: Sentinel value distinguishes valid from invalid positions
- **WHEN** cultivator id=50 is Lv0 (excluded from encounters) or injured or dead
- **THEN** `engine._levelArrayIndex[50]` SHALL be `-1` after buildCache

### Requirement: Cached effective courage
The system SHALL cache each alive cultivator's effective courage value in a `cachedCourage` field on the `Cultivator` object. The cache SHALL be updated during `tickCultivators` after age increment, and in `spawnCultivators` for newly created cultivators. The combat phase SHALL read `c.cachedCourage` instead of calling `effectiveCourage(c)`.

#### Scenario: Cache updated after age change
- **WHEN** cultivator A's age increments from 50 to 51 in tickCultivators
- **THEN** `A.cachedCourage` SHALL equal `effectiveCourage(A)` computed with age=51

#### Scenario: Combat reads cached value
- **WHEN** combat occurs between A and B
- **THEN** the fight decision SHALL use `A.cachedCourage` and `B.cachedCourage` directly, without calling `effectiveCourage()`

#### Scenario: New cultivator has cached courage
- **WHEN** a new cultivator is spawned with age=10, maxAge=60, courage=0.5
- **THEN** `cachedCourage` SHALL equal `effectiveCourage({age:10, maxAge:60, courage:0.5})`

#### Scenario: Reused slot has cached courage
- **WHEN** a cultivator is spawned by reusing a free slot (via `freeSlots.pop()`)
- **THEN** the in-place reinitialized cultivator's `cachedCourage` SHALL be computed and assigned, same as a newly allocated cultivator

#### Scenario: Cache refreshed after combat promotion
- **WHEN** a combat winner promotes (level increases) and `maxAge` changes via `lifespanBonus`
- **THEN** `winner.cachedCourage` SHALL be immediately recomputed as `effectiveCourage(winner)` after the promotion loop completes, before any subsequent encounter can select this winner as an opponent

## Property-Based Testing Properties

### Property: PRNG trace determinism across optimization boundary
For any `(seed, initialPop, years)`, baseline and optimized engines SHALL produce identical per-year `YearSummary` (all fields). PRNG draw count and order SHALL be identical per year.

**Boundary conditions:** `snapshotN=0`; `nk<=1`; evasion `P=0` or `P=1` (no/certain draw); opponent array length 0/1; `collectEvents` on/off; seeds `{0, 1, 2^32-1}`; populations `{0, 1, 20000+}`.

**Falsification:** Differential PBT — run old/new engines lockstep with PRNG tap logging `(year, phase, drawIndex, value)`, shrink on first mismatching year/draw.

### Property: Reverse index bijection with `levelArrayCache`
After `buildCache` and after every swap-remove: for each level `l` and position `i`, if `id = levelArrayCache[l][i]` then `_levelArrayIndex[id] === i`. For every `id < nextId` absent from all `levelArrayCache`, `_levelArrayIndex[id] === -1`.

**Boundary conditions:** Empty level arrays; remove position 0; remove last element; id=0; id=nextId-1; Lv0/injured/dead ids must be -1; demotion after defeat.

**Falsification:** Model-based PBT — maintain reference map by rescanning arrays each step, compare to `_levelArrayIndex`, shrink to minimal operation sequence.

### Property: `cachedCourage` freshness at all use sites
Whenever combat decision reads `c.cachedCourage`, it SHALL equal `effectiveCourage(c)` computed with current `age/maxAge/courage`. Any mutation of `maxAge` (combat promotion) SHALL be followed by cache refresh before next read.

**Boundary conditions:** `age/maxAge` near `{0, COURAGE_TROUGH=0.3, 1}`; cap-at-1 cases; multi-level promotion in single loop; reused `freeSlots` object; winner promotion Lv2→Lv3 (maxAge ~900→~8900).

**Falsification:** Shadow recomputation oracle checked at every read/mutation; fuzz high-promotion/high-recycle scenarios; shrink to first stale-cache read.

### Property: Dense buffer capacity safety
At `processEncounters` entry: `_defeatedBuf.length >= nextId` and `_levelArrayIndex.length >= nextId`. All indexed accesses use `id < nextId`.

**Boundary conditions:** `nextId` crossing capacity by +1; mass spawn after mass death; reset to smaller population; max id access `nextId-1`.

**Falsification:** Sequence generator alternating mass deaths/spawns to force realloc paths.

### Property: Defeated tracking observational equivalence
Within one encounter phase: `defeatedSet.has(id) <=> _defeatedBuf[id] === 1` at every step. Phase reset clears both. Death outcome does NOT mark defeated (dead loser stays in levelArrayCache, filtered by `!opp.alive`).

**Boundary conditions:** Death outcome (not marked defeated); repeated attempts on same id; id=0; year boundary reset; id reuse via `freeSlots`.

**Falsification:** Run optimized path with shadow `Set` mirror, assert equality after each combat update and skip check.

### Property: Threshold lookup equivalence
For levels `l in [0..7]`: `THRESHOLDS[l] === (l >= 1 ? 10 ** l : Infinity)`. All state transitions using threshold (promotion, demotion assignment, cultivation floor, loot base) are identical.

**Falsification:** Exhaustive check for `0..7` + differential trace testing.

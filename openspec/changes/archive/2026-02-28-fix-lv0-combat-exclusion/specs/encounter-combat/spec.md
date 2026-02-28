## MODIFIED Requirements

### Requirement: Encounter probability
At the start of the encounter phase each year, the system SHALL snapshot `Nk` (cultivator count per level, Lv >= 1 only) and `N` (total cultivator count, Lv >= 1). These values remain fixed for the entire encounter phase. For each Lv=k cultivator (k >= 1), an encounter triggers with probability `Nk / N`. Lv0 cultivators SHALL NOT participate in the encounter phase — they SHALL be excluded from both the snapshot counts and the encounter iteration.

#### Scenario: Snapshot-based encounter probability
- **WHEN** the encounter phase begins with 8000 Lv1 cultivators and 10000 total (Lv >= 1)
- **THEN** each Lv1 cultivator's encounter probability SHALL be 8000/10000 = 0.8 for the entire phase, even if cultivators die during the phase

#### Scenario: Lv0 excluded from snapshot
- **WHEN** the encounter phase begins with 5000 Lv0 cultivators and 3000 Lv1+ cultivators
- **THEN** `N` SHALL be 3000 (not 8000); `snapshotNk[0]` SHALL be 0

#### Scenario: Lv0 excluded from encounter iteration
- **WHEN** the encounter phase iterates over alive cultivators
- **THEN** Lv0 cultivators SHALL NOT be included in the iteration set

#### Scenario: Single cultivator at level
- **WHEN** only 1 cultivator exists at Lv3 (Nk = 1)
- **THEN** the encounter triggers with probability 1/N, but no valid opponent exists, so the encounter SHALL be skipped

#### Scenario: Zero population
- **WHEN** N = 0 (all Lv1+ cultivators dead)
- **THEN** the encounter phase SHALL be a no-op

### Requirement: PBT — Lv0 population conservation
During `processEncounters`, the set of alive Lv0 cultivators SHALL remain unchanged. Let `S0` be the state at encounter-phase start and `S1` be the state after. `{id(c) : c ∈ S0, level(c)=0} = {id(c) : c ∈ S1, level(c)=0}` SHALL hold.

#### Scenario: Lv0 survives mixed population encounters
- **WHEN** the encounter phase runs with 5000 Lv0 and 100 Lv1 cultivators
- **THEN** after the phase completes, the Lv0 population count and ID set SHALL be identical to pre-phase values

### Requirement: PBT — No Lv0 in combat events
For every combat event emitted during `processEncounters`, both participants SHALL have level >= 1 at encounter-phase start. No event SHALL reference a Lv0 cultivator.

#### Scenario: Boundary cultivation values
- **WHEN** some cultivators have cultivation=9 (still Lv0) and others have cultivation=10 (still Lv0, not yet promoted)
- **THEN** no combat event SHALL reference any of these cultivators

### Requirement: PBT — Snapshot sum integrity
At encounter-phase snapshot: `N = Σ(k=1..7) Nk` SHALL hold. Lv0 SHALL NOT contribute to any `Nk` or to `N`.

#### Scenario: Mixed level distribution
- **WHEN** snapshot is taken with cultivators distributed across Lv0-Lv7
- **THEN** `N` SHALL equal the sum of `Nk` for k=1..7, excluding Lv0 count

### Requirement: PBT — Encounter no-op for all-Lv0 state
If all alive cultivators are Lv0 at encounter-phase start, `processEncounters` SHALL produce no state changes and return an empty event list.

#### Scenario: Early simulation years
- **WHEN** all cultivators are Lv0 (e.g., year 1-9 before any natural promotion to Lv1)
- **THEN** `processEncounters` SHALL be a complete no-op: zero combat deaths, zero events, zero cultivation changes

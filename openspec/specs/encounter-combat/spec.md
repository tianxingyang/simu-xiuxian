## ADDED Requirements

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

### Requirement: Opponent selection
When an encounter triggers, the system SHALL select a random opponent from alive same-level cultivators, excluding self. If the selected opponent has already died during this encounter phase, the encounter SHALL be cancelled (no re-pick). Pairing is independent: the same cultivator MAY be selected as opponent by multiple others in the same year.

#### Scenario: Opponent already dead
- **WHEN** cultivator A triggers encounter and selects opponent B, but B was killed earlier this phase
- **THEN** A's encounter SHALL be cancelled; no combat occurs

#### Scenario: No valid opponent
- **WHEN** a cultivator triggers encounter but is the only alive cultivator at their level
- **THEN** the encounter SHALL be skipped

### Requirement: Combat decision
When cultivator A encounters cultivator B: A's defeat rate = `B.cultivation / (A.cultivation + B.cultivation)`. A chooses to fight if `A.courage > defeat_rate` (strict greater-than). When `courage == defeat_rate`, A SHALL retreat. B's decision is computed independently with the same rule.

#### Scenario: Both retreat
- **WHEN** A and B both have courage <= their respective defeat rates
- **THEN** no combat occurs; both survive

#### Scenario: One fights one retreats
- **WHEN** A's courage > A's defeat rate but B's courage <= B's defeat rate
- **THEN** combat SHALL occur (at least one party fights)

#### Scenario: Courage equals defeat rate
- **WHEN** A's courage exactly equals A's defeat rate (e.g., both 0.5)
- **THEN** A SHALL retreat

### Requirement: Combat resolution
When combat occurs, the winner is determined by weighted random: A wins with probability `A.cultivation / (A.cultivation + B.cultivation)`. The loser SHALL be immediately removed (marked dead). The winner SHALL absorb 10% of the loser's cultivation: `winner.cultivation += round1(loser.cultivation * 0.1)` where round1 rounds to one decimal place. A promotion check SHALL execute immediately for the winner after absorption.

#### Scenario: Winner absorbs and promotes
- **WHEN** a Lv1 cultivator with cultivation 95 defeats a Lv1 with cultivation 60
- **THEN** winner gains round1(60 * 0.1) = 6.0, reaching 101.0, and SHALL promote to Lv2

#### Scenario: Loser removed immediately
- **WHEN** cultivator B loses a battle
- **THEN** B SHALL be marked dead immediately; subsequent encounters selecting B as opponent SHALL be cancelled

### Requirement: Encounter iteration order
The system SHALL randomly shuffle all alive cultivators (Lv >= 1) at the start of the encounter phase. Cultivators SHALL be processed in this shuffled order. If a cultivator has been killed during the phase before its turn, it SHALL be skipped.

#### Scenario: Dead cultivator skipped
- **WHEN** cultivator C is killed by cultivator A, and C's turn comes later in the shuffled order
- **THEN** C's turn SHALL be skipped

### Requirement: PBT — Snapshot isolation invariant
During the encounter phase, encounter probabilities MUST use the Nk/N values from the phase-start snapshot. Mid-phase deaths or promotions SHALL NOT alter encounter probabilities for remaining cultivators.

#### Scenario: Deaths do not change encounter probability
- **WHEN** 100 cultivators die during the encounter phase out of initial N=10000
- **THEN** all subsequent encounter probability rolls in that phase SHALL still use N=10000

### Requirement: PBT — No double-death invariant
A cultivator SHALL die at most once. If marked dead during combat, no subsequent encounter SHALL cause the same cultivator to die again or have their cultivation absorbed a second time.

#### Scenario: Multiple attackers target same opponent
- **WHEN** cultivators A, B, C all target cultivator D in the same encounter phase, and A kills D first
- **THEN** B and C's encounters with D SHALL be cancelled; D's cultivation SHALL be absorbed exactly once (by A's combat)

### Requirement: PBT — Combat decision boundary
The fight decision boundary SHALL be strict: `courage > defeatRate` means fight, `courage <= defeatRate` means retreat. There SHALL be no epsilon tolerance or floating-point fuzz in this comparison.

#### Scenario: Boundary precision at courage = defeatRate
- **WHEN** courage = 0.500000 and defeatRate = 0.500000 exactly
- **THEN** the cultivator SHALL retreat (not fight)

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

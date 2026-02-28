## ADDED Requirements

### Requirement: Yearly cycle order
Each simulated year SHALL execute phases in this exact order:
1. **Spawn**: Generate new Lv1 cultivators (configurable count, default 1000)
2. **Natural cultivation**: All alive cultivators: `cultivation += 1`, `age += 1`
3. **Encounters & combat**: Process encounters per encounter-combat spec
4. **Promotion check**: Check all alive cultivators for promotion (covers cultivators who reached threshold via natural cultivation, not just combat)
5. **Expiry**: Remove cultivators where `age >= maxAge`
6. **Stats update**: Compute and emit YearSummary to UI

Newly spawned cultivators SHALL participate in all subsequent phases of the same year (including encounters).

#### Scenario: New cultivator participates in encounters
- **WHEN** 1000 cultivators are spawned at start of year, then natural cultivation applies
- **THEN** they SHALL have age=21, cultivation=11, and SHALL be eligible for encounters in phase 3

#### Scenario: Promotion check after natural cultivation
- **WHEN** a Lv1 cultivator reaches cultivation=100 via natural cultivation (+1)
- **THEN** the phase 4 promotion check SHALL promote them to Lv2

#### Scenario: Expiry uses greater-or-equal
- **WHEN** a cultivator's age equals their maxAge after all phases
- **THEN** the cultivator SHALL be removed in the expiry phase

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=20, cultivation=10, level=1, maxAge=100`. The `courage` attribute SHALL be sampled from uniform distribution [0, 1) using the seeded PRNG. Each cultivator SHALL have a unique numeric ID (monotonically increasing integer).

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=20, cultivation=10, level=1, maxAge=100, and a unique ID

#### Scenario: Courage distribution
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL approximate a uniform distribution over [0, 1)

### Requirement: Initial simulation state
The simulation SHALL start at Year 0 with zero cultivators. The initial spawn count SHALL be configurable via UI with a default of 1000. The first year (Year 0) SHALL execute the full yearly cycle, spawning the initial batch.

#### Scenario: Default start
- **WHEN** simulation starts with default settings
- **THEN** Year 0 begins with 0 cultivators, spawns 1000, then runs the full cycle

#### Scenario: Custom initial population
- **WHEN** user sets initial population to 5000 in UI
- **THEN** Year 0 SHALL spawn 5000 cultivators instead of 1000

### Requirement: Seeded PRNG
The simulation SHALL use a seeded pseudo-random number generator (Mulberry32 or equivalent). The seed SHALL be displayed in the UI. Using the same seed and configuration SHALL produce identical simulation results. `Math.random()` SHALL NOT be used for any simulation logic.

#### Scenario: Reproducible simulation
- **WHEN** two simulations run with the same seed and initial population
- **THEN** they SHALL produce identical results at every year

#### Scenario: Seed visibility
- **WHEN** simulation is running
- **THEN** the current seed SHALL be visible in the UI

### Requirement: Simulation termination
The simulation SHALL stop under two conditions: (1) user manually pauses, or (2) total population reaches zero. When population reaches zero, the simulation SHALL auto-pause and the UI SHALL indicate the reason.

#### Scenario: Manual pause
- **WHEN** user clicks pause
- **THEN** simulation SHALL stop after completing the current year

#### Scenario: Population extinction
- **WHEN** all cultivators die (total population = 0) at end of a year
- **THEN** simulation SHALL auto-pause and UI SHALL display an extinction notice

### Requirement: Simulation reset
The system SHALL provide a reset function that returns the simulation to Year 0 with zero cultivators, clearing all accumulated state (events, trend data, statistics). After reset, the user MAY start a new simulation with a new or same seed.

#### Scenario: Reset clears state
- **WHEN** user clicks reset after running 500 years
- **THEN** year SHALL reset to 0, all cultivators removed, event log cleared, trend data cleared

### Requirement: PBT — Population conservation law
For any year Y: `Population(Y) = Population(Y-1) + Spawned(Y) - CombatDeaths(Y) - ExpiryDeaths(Y)`. The set of alive cultivator IDs MUST exactly reflect these additions and removals with no duplicates or orphans.

#### Scenario: Population accounting across a year
- **WHEN** year Y starts with 5000 cultivators, spawns 1000, has 200 combat deaths and 50 expiry deaths
- **THEN** end-of-year population SHALL be exactly 5750

### Requirement: PBT — Age monotonicity
Every surviving cultivator's age SHALL increase by exactly 1 per year. After the expiry phase, no alive cultivator SHALL have `age >= maxAge`.

#### Scenario: Post-expiry invariant
- **WHEN** the expiry phase completes
- **THEN** for every alive cultivator, `age < maxAge` SHALL hold

### Requirement: PBT — Cultivation monotonicity
A surviving cultivator's cultivation SHALL never decrease. Each year, cultivation increases by at least 1 (from natural cultivation). Combat absorption can only add to cultivation, never subtract.

#### Scenario: Cultivation never decreases
- **WHEN** comparing a surviving cultivator's cultivation at year Y and year Y+1
- **THEN** `cultivation(Y+1) >= cultivation(Y) + 1` SHALL hold

### Requirement: PBT — Deterministic replay
Given the same seed and initialPop, running the simulation for N years, pausing, and resuming SHALL produce identical state to running N years without pause. Formally: `run(seed, N) == pause_resume(seed, N1, N-N1)` for any split point N1.

#### Scenario: Pause-resume produces same state as continuous run
- **WHEN** simulation runs 100 years continuously with seed=42, vs runs 60 years then pauses then runs 40 more with same seed
- **THEN** the final state at year 100 SHALL be identical in both cases

### Requirement: PBT — Terminal state stability
Once the simulation auto-pauses (due to extinction), further step/run calls SHALL NOT mutate state. The terminal state SHALL be idempotent.

#### Scenario: Step after extinction is no-op
- **WHEN** population reaches 0 and simulation auto-pauses, then user clicks step
- **THEN** year SHALL NOT advance and population SHALL remain 0

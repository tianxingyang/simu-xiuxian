## ADDED Requirements

### Requirement: Evasion probability
When exactly one party wants to fight (attacker) and the other does not (evader), the evader SHALL attempt evasion. The evasion success probability SHALL be calculated as: `P = clamp(0.5 + EVASION_SENSITIVITY × gap, 0, 1)` where `gap = (evader.cultivation - attacker.cultivation) / (evader.cultivation + attacker.cultivation)` and `EVASION_SENSITIVITY = 0.5`. The result SHALL be clamped to `[0, 1]`. Attacker/evader roles SHALL be determined strictly by fight-intent booleans (`effectiveCourage > defeatRate`), independent of parameter order.

#### Scenario: Evader much stronger than attacker
- **WHEN** evader.cultivation = 900 and attacker.cultivation = 100
- **THEN** gap = 800/1000 = 0.8, P = clamp(0.5 + 0.5 × 0.8, 0, 1) = 0.9

#### Scenario: Evader much weaker than attacker
- **WHEN** evader.cultivation = 100 and attacker.cultivation = 900
- **THEN** gap = -800/1000 = -0.8, P = clamp(0.5 + 0.5 × (-0.8), 0, 1) = 0.1

#### Scenario: Equal cultivation
- **WHEN** evader.cultivation = 200 and attacker.cultivation = 200
- **THEN** gap = 0, P = 0.5

### Requirement: Evasion PRNG short-circuit
When P = 0, evasion SHALL fail immediately without consuming a `prng()` call. When P = 1, evasion SHALL succeed immediately without consuming a `prng()` call. Otherwise (0 < P < 1), evasion succeeds when `prng() < P` (consuming exactly one call).

#### Scenario: P = 0 short-circuit
- **WHEN** evader.cultivation is extremely low relative to attacker, yielding P = 0
- **THEN** evasion SHALL fail without calling prng(); combat proceeds immediately

#### Scenario: P = 1 short-circuit
- **WHEN** evader.cultivation is extremely high relative to attacker, yielding P = 1
- **THEN** evasion SHALL succeed without calling prng(); no combat occurs

#### Scenario: Normal evasion roll
- **WHEN** 0 < P < 1 and prng() < P
- **THEN** evasion succeeds; exactly one prng() call consumed

### Requirement: Evasion success — no state changes
When evasion succeeds, no combat SHALL occur. Both cultivators SHALL survive with zero state changes: no modification to `combatDeaths`, `promotionCounts`, event buffers (`highBuf`/`lowBuf`), `levelGroups`, or `nextEventId`. Both parties SHALL remain fully eligible for subsequent encounters by other cultivators in the same encounter phase.

#### Scenario: Successful evasion preserves all state
- **WHEN** evader successfully evades attacker
- **THEN** engine.combatDeaths SHALL remain unchanged; both cultivators' cultivation, level, alive status SHALL be identical to pre-evasion values

#### Scenario: Evader remains targetable after success
- **WHEN** evader B successfully evades attacker A, and later cultivator C encounters B in the same phase
- **THEN** B SHALL be a valid opponent for C; B's state is fully intact

### Requirement: Evasion failure penalty
When evasion fails (prng() >= P, or P = 0 short-circuit), the evader SHALL lose `EVASION_PENALTY` (5%) of their cultivation: `penalized = round1(evader.cultivation × (1 - EVASION_PENALTY))`. The result SHALL be clamped to the evader's current level threshold: `evader.cultivation = max(threshold(evader.level), penalized)`. Combat `total` SHALL be recalculated as `attacker.cultivation + evader.cultivation` (post-penalty) before determining the winner. Fight willingness SHALL NOT be re-evaluated after the penalty — intent is computed once before evasion and is final.

#### Scenario: Evasion failure with penalty
- **WHEN** evader.cultivation = 200, EVASION_PENALTY = 0.05, and evasion fails
- **THEN** evader.cultivation SHALL become max(threshold(level), round1(200 × 0.95)) = max(100, 190) = 190.0, total recalculated, combat proceeds

#### Scenario: Penalty reduces win probability with recalculated total
- **WHEN** attacker.cultivation = 300, evader.cultivation = 200, evasion fails
- **THEN** evader.cultivation becomes 190; new total = 490; evader win probability = 190/490 ≈ 0.388

#### Scenario: Penalty clamped at level threshold
- **WHEN** evader is Lv2 (threshold=100), evader.cultivation = 102, evasion fails
- **THEN** penalized = round1(102 × 0.95) = round1(96.9) = 96.9; clamped = max(100, 96.9) = 100; penalty effectively negated

#### Scenario: Low cultivation penalty rounding
- **WHEN** evader.cultivation = 11, evader is Lv1 (threshold=10), evasion fails
- **THEN** penalized = round1(11 × 0.95) = round1(10.45) = 10.5; max(10, 10.5) = 10.5

### Requirement: Evasion is silent
Evasion attempts (both successful and failed) SHALL NOT produce any SimEvent entries. The mechanism SHALL only affect cultivator state and combat occurrence.

#### Scenario: Successful evasion produces no event
- **WHEN** evasion succeeds
- **THEN** no event of any type SHALL be added to highBuf or lowBuf

#### Scenario: Failed evasion only produces combat events
- **WHEN** evasion fails and combat proceeds
- **THEN** only standard combat/promotion events SHALL be emitted; no evasion-specific event type SHALL exist

### Requirement: Evasion constants
The system SHALL define two constants: `EVASION_SENSITIVITY = 0.5` controlling the influence of cultivation difference on evasion probability, and `EVASION_PENALTY = 0.05` controlling the cultivation loss ratio on evasion failure.

#### Scenario: Constants are tunable
- **WHEN** EVASION_SENSITIVITY is changed from 0.5 to 0.3
- **THEN** the evasion probability range for the same cultivation gap SHALL narrow (less sensitivity to cultivation difference)

### Requirement: PBT — Evasion trigger XOR invariant
Evasion SHALL be triggered if and only if exactly one party wants to fight (`wantsFight(A) XOR wantsFight(B)`). For all 4 boolean intent combinations, the evasion branch SHALL be entered only in the XOR case.

#### Scenario: All intent combinations
- **WHEN** generating all 4 combinations of (aWants, bWants) with random cultivation values
- **THEN** evasion branch entered only when aWants != bWants; both-fight and both-retreat paths unchanged

### Requirement: PBT — Role assignment commutativity
Swapping the parameter order `(A, B)` vs `(B, A)` SHALL only swap `attacker`/`evader` labels. With the same PRNG seed, the normalized outcome (evasion result, penalty application, combat result) SHALL be identical.

#### Scenario: Swap invariance
- **WHEN** running resolveCombat(A, B) and resolveCombat(B, A) with identical PRNG state, where A wants to fight and B does not
- **THEN** in both cases B is the evader; evasion probability, penalty, and combat outcome SHALL be identical

### Requirement: PBT — Evasion probability bounds and monotonicity
For all valid inputs (`evader.cult > 0`, `attacker.cult > 0`): (1) `0 <= P <= 1` SHALL hold. (2) With attacker fixed, increasing evader cultivation SHALL never decrease P (monotone non-decreasing). (3) `P(k×e, k×a) == P(e, a)` for any `k > 0` (scale invariance).

#### Scenario: Extreme cultivation ratios
- **WHEN** fuzzing cultivation values across [0.1, 1e7] for both parties
- **THEN** P SHALL always be in [0, 1]; monotonicity and scale invariance SHALL hold within floating-point epsilon

### Requirement: PBT — Penalty floor invariant
After evasion failure, `evader.cultivation >= threshold(evader.level)` SHALL always hold. Repeated failures at the threshold SHALL be idempotent (cultivation remains at threshold).

#### Scenario: Repeated failure at threshold
- **WHEN** evader is Lv1 (threshold=10), cultivation = 10, and evasion fails repeatedly
- **THEN** cultivation SHALL remain 10 after each failure (max(10, round1(10 × 0.95)) = max(10, 9.5) = 10)

#### Scenario: Penalty never increases cultivation
- **WHEN** evader.cultivation >= threshold(level) and evasion fails
- **THEN** evader.cultivation' <= evader.cultivation SHALL always hold

### Requirement: PBT — Evasion success is a state no-op
On evasion success, a deep comparison of all engine combat state (combatDeaths, promotionCounts, event buffers, levelGroups, cultivator alive/cultivation/level) before and after SHALL show zero differences. The only allowed change is PRNG position advancement (0 or 1 call depending on P).

#### Scenario: State snapshot comparison
- **WHEN** snapshotting engine state before evasion and comparing after successful evasion
- **THEN** all combat-related state fields SHALL be identical; only PRNG internal state MAY differ

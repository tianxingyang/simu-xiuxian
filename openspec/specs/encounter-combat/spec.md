### Requirement: Encounter probability
At the start of the encounter phase each year, the system SHALL snapshot `Nk` (cultivator count per level, Lv >= 1 only) and `N` (total cultivator count, Lv >= 1). These values remain fixed for the entire encounter phase. For each Lv=k cultivator (k >= 1), an encounter triggers with probability `Nk / N`. Lv0 cultivators SHALL NOT participate in the encounter phase.

数据访问路径变更：`engine.cultivators[id]` 替代 `engine.cultivators.get(id)!`；`engine.levelArrayCache[level]` 替代 `engine.levelArrayCache.get(level)`；`engine.levelGroups[level]` 替代 `engine.levelGroups.get(level)!`。buildCache 阶段遍历改为 `for (let level = 0; level < LEVEL_COUNT; level++)`。

#### Scenario: Snapshot-based encounter probability
- **WHEN** the encounter phase begins with 8000 Lv1 cultivators and 10000 total (Lv >= 1)
- **THEN** each Lv1 cultivator's encounter probability SHALL be 8000/10000 = 0.8 for the entire phase

#### Scenario: Lv0 excluded from snapshot
- **WHEN** the encounter phase begins with 5000 Lv0 cultivators and 3000 Lv1+ cultivators
- **THEN** `N` SHALL be 3000; `snapshotNk[0]` SHALL be 0

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
When cultivator A encounters cultivator B: A's defeat rate = `B.cultivation / (A.cultivation + B.cultivation)`. A chooses to fight if `effectiveCourage(A) > defeat_rate` (strict greater-than). When `effectiveCourage(A) == defeat_rate`, A SHALL retreat. B's decision is computed independently with the same rule. `effectiveCourage` SHALL 替代原有的直接读取 `A.courage`，使战斗意愿随修仙者的生命阶段动态变化。`resolveCombat` 中 SHALL 对每个战斗者仅计算一次 `effectiveCourage`，缓存到局部变量后复用。当恰好一方想打（attacker）、一方不想打（evader）时，不再直接进入战斗，而是 SHALL 先执行避战判定（见 `combat-evasion` spec）。避战成功则无战斗；避战失败则 evader 承受修为惩罚后进入战斗。

#### Scenario: Both retreat
- **WHEN** A and B both have effectiveCourage <= their respective defeat rates
- **THEN** no combat occurs; both survive; no evasion check

#### Scenario: One fights one retreats — evasion succeeds
- **WHEN** A's effectiveCourage > A's defeat rate but B's effectiveCourage <= B's defeat rate, and B's evasion check succeeds
- **THEN** no combat SHALL occur; both cultivators survive

#### Scenario: One fights one retreats — evasion fails
- **WHEN** A's effectiveCourage > A's defeat rate but B's effectiveCourage <= B's defeat rate, and B's evasion check fails
- **THEN** B's cultivation SHALL be reduced by EVASION_PENALTY, then combat SHALL proceed between A and B(reduced cultivation)

#### Scenario: Both want to fight
- **WHEN** A's effectiveCourage > A's defeat rate AND B's effectiveCourage > B's defeat rate
- **THEN** combat SHALL occur immediately; no evasion check

#### Scenario: effectiveCourage equals defeat rate
- **WHEN** A's effectiveCourage exactly equals A's defeat rate (e.g., both 0.50)
- **THEN** A SHALL retreat

#### Scenario: Near-death cultivator more willing to fight
- **WHEN** 修仙者 baseCourage=0.30, lifeFrac=0.95, defeatRate=0.50
- **THEN** effectiveCourage ≈ 0.55 > 0.50，该修仙者 SHALL 选择战斗（若 baseCourage 未经寿元加成则会退缩）

### Requirement: Combat resolution
When combat occurs, the winner is determined by weighted random: A wins with probability `A.cultivation / (A.cultivation + B.cultivation)`. The loser's outcome SHALL be determined by the defeat outcome system. 仅死亡结局的败者 SHALL 被标记为 `alive = false`。The winner SHALL gain cultivation through the fortune loot formula.

数据访问路径变更：`resolveCombat` 内所有 `engine.levelGroups[level].delete/add` 替代 `engine.levelGroups.get(level)!.delete/add`；`engine.aliveLevelIds[level]` 替代 `engine.aliveLevelIds.get(level)!`；`engine.levelArrayCache[level]` 替代 `engine.levelArrayCache.get(level)`。

战斗死亡时 SHALL 同时执行 `engine.aliveCount--` 和 `engine._deadIds.push(loser.id)`。

**执行顺序**：胜负判定 → loot 计算 → loot 应用 → 败者结局判定 → 败者结局应用 → 胜者晋升检查。

跌境结局 SHALL 立即更新败者的 `levelGroups` 归属（从原级别移除，加入新级别）。

存活败者 SHALL 立即从 `levelArrayCache` 中移除并记入本轮败者 Set。

**Precondition:** `loser.level >= 1` (Lv0 cultivators are excluded from encounters).

```
snapshotCult = loser's cultivation before any evasion penalty
levelBase    = threshold(loser.level)
baseLoot     = levelBase × LOOT_BASE_RATE
excess       = max(0, snapshotCult - levelBase)
luck         = truncatedGaussian(prng, LUCK_MEAN, LUCK_STDDEV, LUCK_MIN, LUCK_MAX)
variableLoot = excess × LOOT_VARIABLE_RATE × luck
loot         = max(0.1, round1(baseLoot + variableLoot))

winner.cultivation += loot
```

Constants: `LOOT_BASE_RATE = 0.05`, `LOOT_VARIABLE_RATE = 0.1`, `LUCK_MEAN = 1.0`, `LUCK_STDDEV = 0.3`, `LUCK_MIN = 0`, `LUCK_MAX = 2.5`. A promotion check SHALL execute immediately for the winner after loot gain. The combat event text SHALL display outcome-specific text.

#### Scenario: Lv1 winner with average luck
- **WHEN** a Lv1 cultivator defeats a Lv1 with cultivation 50, and luck = 1.0
- **THEN** levelBase = 10, baseLoot = 0.5, excess = 40, variableLoot = 4.0, loot = max(0.1, round1(4.5)) = 4.5

#### Scenario: Winner gains loot and promotes
- **WHEN** a Lv1 cultivator with cultivation 95 defeats a Lv1 with cultivation 60, and luck = 1.0
- **THEN** baseLoot = 0.5, excess = 50, variableLoot = 5.0, loot = max(0.1, round1(5.5)) = 5.5, reaching 100.5, and SHALL promote to Lv2

#### Scenario: Loser dies — death tracking
- **WHEN** cultivator B loses and defeat outcome is death
- **THEN** B SHALL be marked `alive = false`; `engine.aliveCount` SHALL decrement; `engine._deadIds` SHALL contain B.id; subsequent encounters selecting B as opponent SHALL be cancelled

#### Scenario: Loser survives — locked out for year
- **WHEN** cultivator B loses and defeat outcome is demotion, injury, or cultivation loss
- **THEN** B SHALL remain alive; B SHALL be removed from levelArrayCache and recorded in defeated Set; B SHALL NOT be selected as opponent or initiate encounters for the rest of this phase

### Requirement: PBT — Loot lower bound
For any combat with `loser.level >= 1`, `loot >= 0.1` SHALL always hold. Furthermore, since `baseLoot = threshold(level) × 0.05 >= 10 × 0.05 = 0.5` for level >= 1, and `variableLoot >= 0`, the effective lower bound is `loot >= 0.5`.

#### Scenario: Minimum possible loot
- **WHEN** level = 1, snapshotCult = 10 (at threshold), luck = 0
- **THEN** loot = max(0.1, round1(0.5 + 0)) = 0.5 >= 0.1 ✓

### Requirement: PBT — Loot upper bound
For fixed `(level, snapshotCult)` with `L = threshold(level)` and `excess = max(0, snapshotCult - L)`, loot SHALL satisfy: `loot <= round1(0.05 × L + 0.25 × excess)` (since `luck <= 2.5` and `LOOT_VARIABLE_RATE = 0.1`).

#### Scenario: Maximum luck at Lv2
- **WHEN** level = 2, snapshotCult = 500, luck = 2.5
- **THEN** loot = round1(5.0 + 400 × 0.1 × 2.5) = round1(105.0) = 105.0 <= round1(5.0 + 100.0) = 105.0 ✓

### Requirement: PBT — Loot monotonicity in cultivation
For fixed `level` and fixed `luck`, if `c2 >= c1` then `loot(c2) >= loot(c1)` SHALL hold (non-decreasing). When `luck = 0`, loot is flat at `round1(baseLoot)`.

#### Scenario: Higher cultivation yields higher loot
- **WHEN** level = 1, luck = 1.0, c1 = 30, c2 = 50
- **THEN** loot(c1) = round1(0.5 + 20 × 0.1 × 1.0) = 2.5, loot(c2) = round1(0.5 + 40 × 0.1 × 1.0) = 4.5, 4.5 >= 2.5 ✓

### Requirement: PBT — Winner cultivation strictly increases
After loot gain, `winner.cultivation_after > winner.cultivation_before` SHALL always hold, since `loot >= 0.1 > 0`.

#### Scenario: Minimal loot still increases cultivation
- **WHEN** winner.cultivation = 100.0, loot = 0.5
- **THEN** winner.cultivation becomes 100.5 > 100.0 ✓

### Requirement: PBT — Pre-penalty snapshot independence
Loot SHALL depend only on `snapshotCult` (pre-evasion-penalty value), not on post-penalty cultivation. For identical `(level, snapshotCult, luck)`, varying the evasion penalty amount SHALL produce identical loot.

#### Scenario: Same snapshot, different penalties
- **WHEN** level = 1, snapshotCult = 50, luck = 1.0, penalty variants: 0%, 5%, 10%
- **THEN** loot = 4.5 in all three cases (post-penalty value is irrelevant to formula)

### Requirement: PBT — Threshold cultivation independence from luck
When `snapshotCult = threshold(level)` (excess = 0), loot SHALL equal `round1(baseLoot)` regardless of luck value, since `variableLoot = 0 × LOOT_VARIABLE_RATE × luck = 0`.

#### Scenario: At threshold, luck is irrelevant
- **WHEN** level = 1, snapshotCult = 10, luck values: 0, 1.0, 2.5
- **THEN** loot = round1(0.5) = 0.5 for all luck values

### Requirement: Encounter iteration order
The system SHALL randomly shuffle all alive cultivators (Lv >= 1) at the start of the encounter phase. Cultivators SHALL be processed in this shuffled order. Skipped conditions (checked in order):
1. `!c.alive` → skip（已死亡）
2. `c.injuredUntil > currentYear` → skip（重伤，不消耗 PRNG）
3. `defeatedSet.has(c.id)` → skip（本轮已战败，不消耗 PRNG）

重伤修士 SHALL 不计入遭遇概率快照 Nk/N。

#### Scenario: Dead cultivator skipped
- **WHEN** cultivator C is killed by cultivator A, and C's turn comes later in the shuffled order
- **THEN** C's turn SHALL be skipped

#### Scenario: Injured cultivator skipped
- **WHEN** cultivator D has `injuredUntil > currentYear`（本轮或之前轮次受伤）
- **THEN** D's turn SHALL be skipped, D SHALL NOT initiate an encounter, no PRNG consumed

#### Scenario: Defeated cultivator skipped
- **WHEN** cultivator E was defeated earlier this phase (survival outcome)
- **THEN** E's turn SHALL be skipped, E SHALL NOT initiate an encounter

#### Scenario: Injured excluded from snapshot Nk
- **WHEN** Lv2 有 20 名存活修士，其中 5 名重伤
- **THEN** Lv2 的 snapshotNk SHALL 为 15，snapshotN 中也排除这 5 名

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
The fight decision boundary SHALL be strict: `effectiveCourage > defeatRate` means fight, `effectiveCourage <= defeatRate` means retreat. There SHALL be no epsilon tolerance or floating-point fuzz in this comparison.

#### Scenario: Boundary precision at effectiveCourage = defeatRate
- **WHEN** effectiveCourage = 0.500000 and defeatRate = 0.500000 exactly
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

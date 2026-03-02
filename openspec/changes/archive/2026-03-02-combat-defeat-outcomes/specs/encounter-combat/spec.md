## MODIFIED Requirements

### Requirement: Combat resolution
When combat occurs, the winner is determined by weighted random: A wins with probability `A.cultivation / (A.cultivation + B.cultivation)`. The loser's outcome SHALL be determined by the defeat outcome system（见 `combat-defeat-outcomes` spec）：根据实力差距、境界、随机因素判定死亡、跌境、重伤或损失修为。仅死亡结局的败者 SHALL 被标记为 `alive = false`。The winner SHALL gain cultivation through the fortune loot formula, using the loser's **pre-evasion-penalty** cultivation snapshot（公式不变）。

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

Constants: `LOOT_BASE_RATE = 0.05`, `LOOT_VARIABLE_RATE = 0.1`, `LUCK_MEAN = 1.0`, `LUCK_STDDEV = 0.3`, `LUCK_MIN = 0`, `LUCK_MAX = 2.5`. A promotion check SHALL execute immediately for the winner after loot gain. The combat event text SHALL display outcome-specific text（见 combat-defeat-outcomes spec Event encoding）.

#### Scenario: Lv1 winner with average luck
- **WHEN** a Lv1 cultivator defeats a Lv1 with cultivation 50, and luck = 1.0
- **THEN** levelBase = 10, baseLoot = 0.5, excess = 40, variableLoot = 4.0, loot = max(0.1, round1(4.5)) = 4.5

#### Scenario: Winner gains loot and promotes
- **WHEN** a Lv1 cultivator with cultivation 95 defeats a Lv1 with cultivation 60, and luck = 1.0
- **THEN** baseLoot = 0.5, excess = 50, variableLoot = 5.0, loot = max(0.1, round1(5.5)) = 5.5, reaching 100.5, and SHALL promote to Lv2

#### Scenario: Loser dies — removed immediately
- **WHEN** cultivator B loses and defeat outcome is death
- **THEN** B SHALL be marked dead immediately; subsequent encounters selecting B as opponent SHALL be cancelled

#### Scenario: Loser survives — locked out for year
- **WHEN** cultivator B loses and defeat outcome is demotion, injury, or cultivation loss
- **THEN** B SHALL remain alive; B SHALL be removed from levelArrayCache and recorded in defeated Set; B SHALL NOT be selected as opponent or initiate encounters for the rest of this phase

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

### Requirement: PBT — No double-death invariant
A cultivator SHALL die at most once. If marked dead during combat, no subsequent encounter SHALL cause the same cultivator to die again or have their cultivation absorbed a second time.

#### Scenario: Multiple attackers target same opponent
- **WHEN** cultivators A, B, C all target cultivator D in the same encounter phase, and A kills D first
- **THEN** B and C's encounters with D SHALL be cancelled; D's cultivation SHALL be absorbed exactly once (by A's combat)

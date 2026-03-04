## MODIFIED Requirements

### Requirement: Encounter iteration order
The system SHALL randomly shuffle all alive cultivators (Lv >= 1) at the start of the encounter phase. Cultivators SHALL be processed in this shuffled order. Skipped conditions (checked in order):
1. `!c.alive` → skip（已死亡）
2. `c.injuredUntil > currentYear` → skip（重伤，不消耗 PRNG）
3. `engine._defeatedBuf[c.id] === 1` → skip（本轮已战败，不消耗 PRNG）

重伤修士 SHALL 不计入遭遇概率快照 Nk/N。

遭遇概率预计算 SHALL 在 `snapshotN === 0` 提前返回判断之后执行。`encounterThresholds[level] = snapshotNk[level] / snapshotN` 仅在 `snapshotN > 0` 时计算，避免除零产生 `NaN/Infinity`。

#### Scenario: Dead cultivator skipped
- **WHEN** cultivator C is killed by cultivator A, and C's turn comes later in the shuffled order
- **THEN** C's turn SHALL be skipped

#### Scenario: Injured cultivator skipped
- **WHEN** cultivator D has `injuredUntil > currentYear`（本轮或之前轮次受伤）
- **THEN** D's turn SHALL be skipped, D SHALL NOT initiate an encounter, no PRNG consumed

#### Scenario: Defeated cultivator skipped via Uint8Array
- **WHEN** cultivator E was defeated earlier this phase (survival outcome), `engine._defeatedBuf[E.id] === 1`
- **THEN** E's turn SHALL be skipped, E SHALL NOT initiate an encounter

#### Scenario: Injured excluded from snapshot Nk
- **WHEN** Lv2 有 20 名存活修士，其中 5 名重伤
- **THEN** Lv2 的 snapshotNk SHALL 为 15，snapshotN 中也排除这 5 名

### Requirement: Combat decision
When cultivator A encounters cultivator B: A's defeat rate = `B.cultivation / (A.cultivation + B.cultivation)`. A chooses to fight if `A.cachedCourage > defeat_rate` (strict greater-than). When `A.cachedCourage == defeat_rate`, A SHALL retreat. B's decision is computed independently with the same rule. `cachedCourage` SHALL 为 `tickCultivators` 阶段预算并缓存在 Cultivator 对象上的 `effectiveCourage` 值，使战斗意愿随修仙者的生命阶段动态变化。当恰好一方想打（attacker）、一方不想打（evader）时，SHALL 先执行避战判定（见 `combat-evasion` spec）。避战成功则无战斗；避战失败则 evader 承受修为惩罚后进入战斗。

#### Scenario: Both retreat
- **WHEN** A and B both have cachedCourage <= their respective defeat rates
- **THEN** no combat occurs; both survive; no evasion check

#### Scenario: One fights one retreats — evasion succeeds
- **WHEN** A's cachedCourage > A's defeat rate but B's cachedCourage <= B's defeat rate, and B's evasion check succeeds
- **THEN** no combat SHALL occur; both cultivators survive

#### Scenario: One fights one retreats — evasion fails
- **WHEN** A's cachedCourage > A's defeat rate but B's cachedCourage <= B's defeat rate, and B's evasion check fails
- **THEN** B's cultivation SHALL be reduced by EVASION_PENALTY, then combat SHALL proceed between A and B(reduced cultivation)

#### Scenario: Both want to fight
- **WHEN** A's cachedCourage > A's defeat rate AND B's cachedCourage > B's defeat rate
- **THEN** combat SHALL occur immediately; no evasion check

#### Scenario: cachedCourage equals defeat rate
- **WHEN** A's cachedCourage exactly equals A's defeat rate (e.g., both 0.50)
- **THEN** A SHALL retreat

### Requirement: Combat resolution
When combat occurs, the winner is determined by weighted random: A wins with probability `A.cultivation / (A.cultivation + B.cultivation)`. The loser's outcome SHALL be determined by the defeat outcome system. 仅死亡结局的败者 SHALL 被标记为 `alive = false`。The winner SHALL gain cultivation through the fortune loot formula.

战斗死亡时 SHALL 同时执行 `engine.aliveCount--` 和 `engine._deadIds.push(loser.id)`。

**执行顺序**：胜负判定 → loot 计算 → loot 应用 → 败者结局判定 → 败者结局应用 → 胜者晋升检查 → 若晋升则刷新 `winner.cachedCourage = effectiveCourage(winner)`。

跌境结局 SHALL 立即更新败者的 `levelGroups` 归属（从原级别移除，加入新级别）。

存活败者 SHALL 通过 `engine._levelArrayIndex[loser.id]` O(1) 定位在 `levelArrayCache` 中的位置执行 swap-remove，并设置 `engine._defeatedBuf[loser.id] = 1`。

**Precondition:** `loser.level >= 1` (Lv0 cultivators are excluded from encounters).

```
snapshotCult = loser's cultivation before any evasion penalty
levelBase    = THRESHOLDS[loser.level]
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
- **THEN** levelBase = THRESHOLDS[1] = 10, baseLoot = 0.5, excess = 40, variableLoot = 4.0, loot = max(0.1, round1(4.5)) = 4.5

#### Scenario: Loser survives — tracked via Uint8Array
- **WHEN** cultivator B loses and defeat outcome is demotion, injury, or cultivation loss
- **THEN** B SHALL remain alive; B SHALL be removed from levelArrayCache via O(1) reverse-index swap-remove; `engine._defeatedBuf[B.id]` SHALL be set to 1; B SHALL NOT be selected as opponent or initiate encounters for the rest of this phase

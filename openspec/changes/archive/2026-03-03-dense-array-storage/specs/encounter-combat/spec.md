## MODIFIED Requirements

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

### Requirement: Combat resolution
When combat occurs, the winner is determined by weighted random: A wins with probability `A.cultivation / (A.cultivation + B.cultivation)`. The loser's outcome SHALL be determined by the defeat outcome system. 仅死亡结局的败者 SHALL 被标记为 `alive = false`。The winner SHALL gain cultivation through the fortune loot formula.

数据访问路径变更：`resolveCombat` 内所有 `engine.levelGroups[level].delete/add` 替代 `engine.levelGroups.get(level)!.delete/add`；`engine.aliveLevelIds[level]` 替代 `engine.aliveLevelIds.get(level)!`；`engine.levelArrayCache[level]` 替代 `engine.levelArrayCache.get(level)`。

战斗死亡时 SHALL 同时执行 `engine.aliveCount--` 和 `engine._deadIds.push(loser.id)`。

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

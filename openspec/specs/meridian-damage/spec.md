## Requirements

### Requirement: Meridian damage state tracking
系统 SHALL 为每个修士维护 `meridianDamagedUntil: number` 字段，表示经脉受损恢复的年份。当 `meridianDamagedUntil > currentYear` 时，修士处于经脉受损状态。`meridianDamagedUntil = 0` 表示经脉未受损。

经脉受损状态 SHALL 在战斗发生的同一年立即生效，影响该年剩余的战斗。

#### Scenario: Cultivator with healthy meridians
- **WHEN** 修士经脉未受损
- **THEN** `meridianDamagedUntil` SHALL 为 0

#### Scenario: Cultivator with damaged meridians
- **WHEN** 修士在第 100 年经脉受损，`MERIDIAN_DAMAGE_DURATION = 10`
- **THEN** `meridianDamagedUntil` SHALL 设置为 110
- **AND** 在第 100 至 109 年，修士 SHALL 处于经脉受损状态
- **AND** 在第 110 年及之后，修士 SHALL 不再处于经脉受损状态

#### Scenario: Meridian damage affects same-year combat
- **WHEN** 修士在第 100 年战败经脉受损
- **THEN** 该年后续战斗中，该修士的战斗力 SHALL 受到经脉受损影响（×0.7）

### Requirement: Meridian damage outcome in combat
当战败修士存活且被判定为经脉受损结局时，系统 SHALL 设置 `loser.meridianDamagedUntil = currentYear + MERIDIAN_DAMAGE_DURATION`，其中 `MERIDIAN_DAMAGE_DURATION = 10`。

#### Scenario: Meridian damage applied after defeat
- **WHEN** 修士在第 50 年战败且被判定为经脉受损
- **THEN** `meridianDamagedUntil` SHALL 设置为 60

#### Scenario: Meridian damage does not prevent combat
- **WHEN** 修士处于经脉受损状态
- **THEN** 修士 SHALL 仍可参与遭遇阶段
- **AND** 修士 SHALL 仍可被选为对手
- **AND** 修士 SHALL 计入遭遇概率快照 Nk/N

### Requirement: Meridian damage combat penalty
在战斗力计算时，处于经脉受损状态的修士 SHALL 以其修为的 `(1 - MERIDIAN_COMBAT_PENALTY)` 倍参与战斗判定，其中 `MERIDIAN_COMBAT_PENALTY = 0.3`（即战力为原修为的 70%）。

战斗力计算 SHALL 使用完整浮点数精度，不进行四舍五入。

闪避失败惩罚（-5%修为）与经脉受损战力削弱 SHALL 独立计算：
- 闪避失败直接扣除修为（永久）
- 经脉受损影响战斗力计算（临时）
- 两者不叠加计算

#### Scenario: Meridian damage reduces combat power
- **WHEN** 修士 A（cultivation=100，经脉受损）与修士 B（cultivation=100，健康）战斗
- **THEN** A 的战斗力 SHALL 计算为 100 × 0.7 = 70.0
- **AND** B 的战斗力 SHALL 计算为 100.0
- **AND** 胜负判定 SHALL 基于战斗力 70.0 vs 100.0
- **AND** 战斗力 SHALL 使用完整浮点数，不进行四舍五入

#### Scenario: Both cultivators have damaged meridians
- **WHEN** 修士 A（cultivation=100，经脉受损）与修士 B（cultivation=80，经脉受损）战斗
- **THEN** A 的战斗力 SHALL 计算为 70.0
- **AND** B 的战斗力 SHALL 计算为 56.0
- **AND** 胜负判定 SHALL 基于战斗力 70.0 vs 56.0

#### Scenario: Meridian damage does not affect loot calculation
- **WHEN** 修士 A（cultivation=100，经脉受损）战败
- **THEN** 胜者的战利品 SHALL 基于 A 的原始修为 100 计算
- **AND** 战利品计算 SHALL 不受经脉受损状态影响

#### Scenario: Evasion penalty and meridian damage are independent
- **WHEN** 修士 A（cultivation=100，经脉受损）闪避失败（-5%修为）
- **THEN** A 的修为 SHALL 永久减少至 95
- **AND** A 的战斗力 SHALL 计算为 95 × 0.7 = 66.5
- **AND** 闪避惩罚与经脉受损 SHALL 独立计算，不叠加

#### Scenario: Death probability uses meridian-adjusted combat power
- **WHEN** 计算死亡概率时的 gap（修为差距）
- **THEN** gap SHALL 基于经脉受损调整后的战斗力计算
- **AND** 如果败者经脉受损，gap SHALL 使用败者的调整后战斗力（cultivation × 0.7）

### Requirement: Meridian damage does not affect cultivation
在 `naturalCultivation` 阶段，处于经脉受损状态的修士 SHALL 以正常速率增长修为（不受经脉受损影响）。

#### Scenario: Meridian damage does not reduce cultivation growth
- **WHEN** 修士处于经脉受损状态，未受重伤或轻伤
- **THEN** 该年修为增长 SHALL 为 1.0

#### Scenario: Meridian damage with light injury
- **WHEN** 修士同时处于经脉受损和轻伤状态
- **THEN** 该年修为增长 SHALL 为 `1 × LIGHT_INJURY_GROWTH_RATE = 0.7`（轻伤影响修炼，经脉受损不影响）

#### Scenario: Meridian damage with heavy injury
- **WHEN** 修士同时处于经脉受损和重伤状态
- **THEN** 该年修为增长 SHALL 为 `1 × INJURY_GROWTH_RATE = 0.5`（重伤影响修炼，经脉受损不影响）

### Requirement: Meridian damage initialization
新生成的修士 SHALL 初始化 `meridianDamagedUntil = 0`。对象池复用的修士 SHALL 重置 `meridianDamagedUntil = 0`。

对于缺失 `meridianDamagedUntil` 字段的旧数据，系统 SHALL 将 `undefined` 或 `NaN` 视为 0。

#### Scenario: New cultivator has healthy meridians
- **WHEN** 系统生成新修士
- **THEN** `meridianDamagedUntil` SHALL 为 0

#### Scenario: Pooled cultivator resets meridian damage
- **WHEN** 从对象池复用修士
- **THEN** `meridianDamagedUntil` SHALL 重置为 0

#### Scenario: Legacy data compatibility
- **WHEN** 加载缺失 `meridianDamagedUntil` 字段的旧修士数据
- **THEN** 系统 SHALL 将其视为 0（经脉健康状态）

### Requirement: Meridian damage constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：
- `MERIDIAN_DAMAGE_DURATION = 10`（经脉受损恢复年数）
- `MERIDIAN_COMBAT_PENALTY = 0.3`（经脉受损期间战力削弱比例）

#### Scenario: Constants are importable
- **WHEN** 其他模块导入 `MERIDIAN_DAMAGE_DURATION` 和 `MERIDIAN_COMBAT_PENALTY`
- **THEN** 值 SHALL 分别为 10 和 0.3

### Requirement: Meridian damage statistics
`YearSummary` SHALL 新增 `combatMeridianDamages: number` 字段，统计本年因战败导致的经脉受损次数。

#### Scenario: Meridian damage count increments
- **WHEN** 修士战败被判定为经脉受损
- **THEN** `combatMeridianDamages` SHALL 递增 1

#### Scenario: Meridian damage count resets yearly
- **WHEN** 新的一年开始
- **THEN** `combatMeridianDamages` SHALL 重置为 0

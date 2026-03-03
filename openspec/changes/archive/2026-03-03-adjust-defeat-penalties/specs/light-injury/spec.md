## ADDED Requirements

### Requirement: Light injury state tracking
系统 SHALL 为每个修士维护 `lightInjuryUntil: number` 字段，表示轻伤恢复的年份。当 `lightInjuryUntil > currentYear` 时，修士处于轻伤状态。`lightInjuryUntil = 0` 表示未受轻伤。

轻伤状态 SHALL 在战斗发生的同一年立即生效，影响该年剩余阶段（如 naturalCultivation）。

#### Scenario: Cultivator not injured
- **WHEN** 修士未受轻伤
- **THEN** `lightInjuryUntil` SHALL 为 0

#### Scenario: Cultivator in light injury state
- **WHEN** 修士在第 100 年受轻伤，`LIGHT_INJURY_DURATION = 2`
- **THEN** `lightInjuryUntil` SHALL 设置为 102
- **AND** 在第 100 和 101 年，修士 SHALL 处于轻伤状态
- **AND** 在第 102 年及之后，修士 SHALL 不再处于轻伤状态

#### Scenario: Light injury affects same-year cultivation
- **WHEN** 修士在第 100 年年初战败受轻伤
- **THEN** 第 100 年的 naturalCultivation 阶段 SHALL 受到轻伤影响（修为增长×0.7）

### Requirement: Light injury outcome in combat
当战败修士存活且被判定为轻伤结局时，系统 SHALL 设置 `loser.lightInjuryUntil = currentYear + LIGHT_INJURY_DURATION`，其中 `LIGHT_INJURY_DURATION = 2`。

#### Scenario: Light injury applied after defeat
- **WHEN** 修士在第 50 年战败且被判定为轻伤
- **THEN** `lightInjuryUntil` SHALL 设置为 52

#### Scenario: Light injury does not prevent combat
- **WHEN** 修士处于轻伤状态
- **THEN** 修士 SHALL 仍可参与遭遇阶段
- **AND** 修士 SHALL 仍可被选为对手
- **AND** 修士 SHALL 计入遭遇概率快照 Nk/N

### Requirement: Light injury cultivation penalty
在 `naturalCultivation` 阶段，处于轻伤状态的修士 SHALL 以 `LIGHT_INJURY_GROWTH_RATE`（0.7）的速率增长修为，而非正常的 1.0。

#### Scenario: Light injury reduces cultivation growth
- **WHEN** 修士处于轻伤状态，未受重伤
- **THEN** 该年修为增长 SHALL 为 `1 × LIGHT_INJURY_GROWTH_RATE = 0.7`

#### Scenario: Heavy injury takes precedence over light injury
- **WHEN** 修士同时处于重伤和轻伤状态
- **THEN** 该年修为增长 SHALL 为 `1 × INJURY_GROWTH_RATE = 0.5`（重伤优先）

#### Scenario: Normal cultivation when not injured
- **WHEN** 修士不处于轻伤或重伤状态
- **THEN** 该年修为增长 SHALL 为 1.0

### Requirement: Light injury initialization
新生成的修士 SHALL 初始化 `lightInjuryUntil = 0`。对象池复用的修士 SHALL 重置 `lightInjuryUntil = 0`。

对于缺失 `lightInjuryUntil` 字段的旧数据，系统 SHALL 将 `undefined` 或 `NaN` 视为 0。

#### Scenario: New cultivator has no light injury
- **WHEN** 系统生成新修士
- **THEN** `lightInjuryUntil` SHALL 为 0

#### Scenario: Pooled cultivator resets light injury
- **WHEN** 从对象池复用修士
- **THEN** `lightInjuryUntil` SHALL 重置为 0

#### Scenario: Legacy data compatibility
- **WHEN** 加载缺失 `lightInjuryUntil` 字段的旧修士数据
- **THEN** 系统 SHALL 将其视为 0（未受伤状态）

### Requirement: Light injury constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：
- `LIGHT_INJURY_DURATION = 2`（轻伤恢复年数，影响 2 次 naturalCultivation 调用）
- `LIGHT_INJURY_GROWTH_RATE = 0.7`（轻伤期间修为增长倍率）

#### Scenario: Constants are importable
- **WHEN** 其他模块导入 `LIGHT_INJURY_DURATION` 和 `LIGHT_INJURY_GROWTH_RATE`
- **THEN** 值 SHALL 分别为 2 和 0.7

#### Scenario: Duration semantics
- **WHEN** `LIGHT_INJURY_DURATION = 2`
- **THEN** 轻伤 SHALL 影响 2 次 naturalCultivation 阶段的修为增长
- **AND** 如果第 100 年受伤，SHALL 影响第 100 和 101 年的修炼

### Requirement: Light injury statistics
`YearSummary` SHALL 新增 `combatLightInjuries: number` 字段，统计本年因战败导致的轻伤次数。

#### Scenario: Light injury count increments
- **WHEN** 修士战败被判定为轻伤
- **THEN** `combatLightInjuries` SHALL 递增 1

#### Scenario: Light injury count resets yearly
- **WHEN** 新的一年开始
- **THEN** `combatLightInjuries` SHALL 重置为 0

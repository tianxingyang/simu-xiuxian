## MODIFIED Requirements

### Requirement: Survival outcome selection
当败者未死亡时，系统 SHALL 进行第二次掷骰 `r2 = prng()` 选择存活结局。五种结局按固定权重归一化分配概率：

| 结局 | 权重 | 归一化概率 |
|------|------|-----------|
| 轻伤 | `DEFEAT_LIGHT_INJURY_W`=4.0 | 40% |
| 重伤 | `DEFEAT_INJURY_W`=2.9 | 29% |
| 损失修为 | `DEFEAT_CULT_LOSS_W`=2.0 | 20% |
| 经脉受损 | `DEFEAT_MERIDIAN_W`=1.0 | 10% |
| 跌境 | `DEFEAT_DEMOTION_W`=0.1 | 1% |

判定逻辑：
```
total = DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W + DEFEAT_MERIDIAN_W + DEFEAT_DEMOTION_W
lightInjuryThreshold = DEFEAT_LIGHT_INJURY_W / total
heavyInjuryThreshold = (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W) / total
cultLossThreshold = (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W) / total
meridianThreshold = (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W + DEFEAT_MERIDIAN_W) / total

r2 < lightInjuryThreshold → 轻伤
r2 < heavyInjuryThreshold → 重伤
r2 < cultLossThreshold → 损失修为
r2 < meridianThreshold → 经脉受损
otherwise → 跌境
```

#### Scenario: Survival outcome distribution
- **WHEN** 大量存活结局样本被收集
- **THEN** 轻伤约占 40%，重伤约占 29%，损失修为约占 20%，经脉受损约占 10%，跌境约占 1%

#### Scenario: Demotion is rare
- **WHEN** 收集 10000 个存活结局样本
- **THEN** 跌境次数 SHALL 在 [80, 120] 区间内（1% ± 0.2%）

#### Scenario: Light injury distribution
- **WHEN** 收集 10000 个存活结局样本
- **THEN** 轻伤次数 SHALL 在 [3800, 4200] 区间内（40% ± 2%）

#### Scenario: Meridian damage distribution
- **WHEN** 收集 10000 个存活结局样本
- **THEN** 经脉受损次数 SHALL 在 [800, 1200] 区间内（10% ± 2%）

### Requirement: Event encoding
战斗事件缓冲区 SHALL 使用第 4 位编码败者结局：

```
[0, combatLevel, loot, outcomeCode]
```

`outcomeCode`: 0=死亡, 1=跌境, 2=重伤, 3=损失修为, 5=经脉受损, 6=轻伤。

编码值 4 SHALL 保留为未来扩展，当前不使用。解码器遇到未知或无效的 outcomeCode（包括 4）SHALL 返回错误或使用默认文本。

`combatLevel` SHALL 使用败者**战前**级别（跌境前）。

事件文本模板：
- 死亡：`{level}对决，获得机缘{loot}`
- 跌境：`{level}对决，获得机缘{loot}，败者跌境`
- 重伤：`{level}对决，获得机缘{loot}，败者重伤`
- 损失修为：`{level}对决，获得机缘{loot}，败者损失修为`
- 经脉受损：`{level}对决，获得机缘{loot}，败者经脉受损`
- 轻伤：`{level}对决，获得机缘{loot}，败者轻伤`

#### Scenario: Demotion event uses pre-combat level
- **WHEN** Lv3 修士跌境至 Lv2
- **THEN** 事件 combatLevel SHALL 为 3，outcomeCode SHALL 为 1

#### Scenario: Meridian damage event encoding
- **WHEN** Lv2 修士经脉受损
- **THEN** 事件 combatLevel SHALL 为 2，outcomeCode SHALL 为 5

#### Scenario: Light injury event encoding
- **WHEN** Lv1 修士轻伤
- **THEN** 事件 combatLevel SHALL 为 1，outcomeCode SHALL 为 6

### Requirement: Defeat outcome constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：

- `DEFEAT_DEATH_BASE = 0.40`
- `DEFEAT_DEATH_DECAY = 0.72`
- `DEFEAT_GAP_SEVERITY = 0.3`
- `DEFEAT_MAX_DEATH = 0.95`
- `DEFEAT_LIGHT_INJURY_W = 4.0`
- `DEFEAT_INJURY_W = 2.9`
- `DEFEAT_CULT_LOSS_W = 2.0`（注意：使用 `DEFEAT_CULT_LOSS_W` 而非 `DEFEAT_LOSS_W`）
- `DEFEAT_MERIDIAN_W = 1.0`
- `DEFEAT_DEMOTION_W = 0.1`
- `DEFEAT_CULT_LOSS_RATE = 0.3`
- `INJURY_DURATION = 5`
- `INJURY_GROWTH_RATE = 0.5`
- `LIFESPAN_DECAY_RATE = 0.2`

系统 SHALL NOT 定义 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION` 或 `DEFEAT_MIN_DEATH`（已移除）。

#### Scenario: Configuration validation at startup
- **WHEN** 系统启动时
- **THEN** SHALL 验证所有权重常量 > 0
- **AND** SHALL 验证所有持续时间常量 > 0
- **AND** SHALL 验证所有惩罚比例常量在 [0, 1] 范围内
- **AND** 如果验证失败 SHALL 抛出错误并终止启动

#### Scenario: Constants are importable
- **WHEN** `combat.ts` 或 `simulation.ts` 导入上述常量
- **THEN** 值 SHALL 与定义一致

#### Scenario: Old constants removed
- **WHEN** 代码中引用 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION` 或 `DEFEAT_MIN_DEATH`
- **THEN** SHALL 编译失败（常量不存在）

#### Scenario: New weight constants exist
- **WHEN** 代码导入 `DEFEAT_LIGHT_INJURY_W` 和 `DEFEAT_MERIDIAN_W`
- **THEN** 值 SHALL 分别为 4.0 和 1.0

#### Scenario: PRNG range and boundary handling
- **WHEN** 系统使用 PRNG 进行结局判定
- **THEN** PRNG SHALL 返回 [0, 1) 区间的值（不包含 1.0）
- **AND** 边界比较 SHALL 使用 `<` 运算符
- **AND** 边界值 1.0 SHALL 永远不会出现

### Requirement: PBT — Outcome probability sums to 1
对任意战败事件，死亡概率 + 存活概率 SHALL 精确等于 1。存活时五种结局的归一化权重之和 SHALL 精确等于 1。

数值比较 SHALL 使用 epsilon = 1e-6 作为浮点数容差。

#### Scenario: Probability conservation
- **WHEN** 任意 deathChance 值被计算
- **THEN** |((1 - deathChance) + deathChance) - 1.0| SHALL < 1e-6
- **AND** 存活分支的五个归一化概率之和 SHALL 满足 |sum - 1.0| < 1e-6

### Requirement: PBT — Defeat state consistency
战败结局 SHALL 满足以下状态不变量：
- 死亡：`alive=false`，`combatDeaths` 递增 1，存活结局变量不变
- 跌境：`alive=true`，`level' = level - 1`，`cultivation' = threshold(level')`，`maxAge` 不变
- 重伤：`alive=true`，`injuredUntil = year + 5`，`level` 和 `cultivation` 不变
- 损失修为：`alive=true`，`cultivation' >= threshold(level)`，`level` 不变
- 经脉受损：`alive=true`，`meridianDamagedUntil = year + 10`，`level` 和 `cultivation` 不变
- 轻伤：`alive=true`，`lightInjuryUntil = year + 2`，`level` 和 `cultivation` 不变
- 所有结局：`cultivation' >= threshold(level')` 始终成立

#### Scenario: Post-defeat cultivation safety
- **WHEN** 任意结局被应用
- **THEN** 败者的 cultivation SHALL >= threshold(败者当前 level)

#### Scenario: Meridian damage state consistency
- **WHEN** 修士被判定为经脉受损
- **THEN** `alive` SHALL 为 true，`meridianDamagedUntil` SHALL 为 `year + 10`，`level` 和 `cultivation` SHALL 不变

#### Scenario: Light injury state consistency
- **WHEN** 修士被判定为轻伤
- **THEN** `alive` SHALL 为 true，`lightInjuryUntil` SHALL 为 `year + 2`，`level` 和 `cultivation` SHALL 不变

### Requirement: Defeat outcome state preservation
当战败结局不直接针对某个状态字段时，该字段 SHALL 保持不变。例如：
- 跌境结局：修改 `level` 和 `cultivation`，但 SHALL 保留 `lightInjuryUntil` 和 `meridianDamagedUntil`
- 损失修为结局：修改 `cultivation`，但 SHALL 保留所有受伤状态字段
- 死亡结局：设置 `alive=false`，但 SHALL 保留所有其他字段（用于统计）

#### Scenario: Demotion preserves injury states
- **WHEN** 修士跌境且之前处于轻伤状态
- **THEN** 跌境后 `lightInjuryUntil` SHALL 保持原值不变

#### Scenario: Multiple injury states can coexist
- **WHEN** 修士同时处于轻伤和经脉受损状态
- **THEN** 两个状态 SHALL 独立生效，互不干扰

### Requirement: Defeat lockout for all outcomes
所有战败结局（包括轻伤和经脉受损）SHALL 触发同年战败锁定。被锁定的修士在本年剩余时间内：
- SHALL NOT 主动发起遭遇
- SHALL NOT 被选为对手
- SHALL NOT 计入遭遇概率快照 Nk/N

#### Scenario: Light injury triggers defeat lockout
- **WHEN** 修士在本年战败受轻伤
- **THEN** 该修士 SHALL 被加入 defeatedSet
- **AND** 本年剩余时间 SHALL 不能再次战斗

#### Scenario: Meridian damage triggers defeat lockout
- **WHEN** 修士在本年战败经脉受损
- **THEN** 该修士 SHALL 被加入 defeatedSet
- **AND** 本年剩余时间 SHALL 不能再次战斗

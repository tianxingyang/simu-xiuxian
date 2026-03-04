## ADDED Requirements

### Requirement: Breakthrough chance function
系统 SHALL 在 `src/constants.ts` 中定义 `breakthroughChance(level: number): number` 纯函数，返回从当前境界突破到下一境界的每次尝试成功概率。公式为：

```
breakthroughChance(k) = Math.exp(-(BREAKTHROUGH_A + BREAKTHROUGH_B * (2 * k + 1)))
```

其中 k 为当前境界编号（k ≥ 1）。

#### Scenario: Lv1 breakthrough chance
- **WHEN** 调用 `breakthroughChance(1)`
- **THEN** 返回值 SHALL 为 `Math.exp(-(0.6 + 0.15 * 3))` ≈ 0.3499（35.0%）

#### Scenario: Lv6 breakthrough chance
- **WHEN** 调用 `breakthroughChance(6)`
- **THEN** 返回值 SHALL 为 `Math.exp(-(0.6 + 0.15 * 13))` ≈ 0.0781（7.8%）

#### Scenario: Monotonic decrease
- **WHEN** 对 k=1,2,...,6 依次调用 `breakthroughChance(k)`
- **THEN** 返回值 SHALL 严格递减

### Requirement: Breakthrough constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：

- `BREAKTHROUGH_A = 0.6` — 分布陡峭度参数
- `BREAKTHROUGH_B = 0.15` — 后期加速变难参数
- `BREAKTHROUGH_COOLDOWN = 3` — 突破失败后冷却年数
- `BREAKTHROUGH_CULT_LOSS_RATE = 0.2` — 突破失败修为损失比例
- `BREAKTHROUGH_NOTHING_W = 5.0` — 仅冷却惩罚权重
- `BREAKTHROUGH_CULT_LOSS_W = 2.0` — 修为损失惩罚权重
- `BREAKTHROUGH_INJURY_W = 2.0` — 受伤惩罚权重

#### Scenario: Constants are importable
- **WHEN** 其他模块导入上述常量
- **THEN** 值 SHALL 与定义一致

### Requirement: Breakthrough cooldown state
`Cultivator` 接口 SHALL 新增 `breakthroughCooldownUntil: number` 字段。该字段记录突破冷却到期年份，值为 0 表示无冷却。

新创建的修仙者（含对象池复用路径）SHALL 初始化 `breakthroughCooldownUntil = 0`。

#### Scenario: New cultivator has no cooldown
- **WHEN** 新修仙者被创建
- **THEN** `breakthroughCooldownUntil` SHALL 为 0

#### Scenario: Pool-reused cultivator reset
- **WHEN** 从 freeSlots 复用 slot 创建修仙者
- **THEN** `breakthroughCooldownUntil` SHALL 重置为 0

### Requirement: Breakthrough eligibility
修仙者 SHALL 同时满足以下全部条件才能尝试突破：

1. `level ≥ 1`（Lv0→Lv1 不经过门控）
2. `level < MAX_LEVEL`（Lv7 为顶级）
3. `cultivation ≥ threshold(level + 1)`（修为达标）
4. `breakthroughCooldownUntil ≤ currentYear`（不在冷却期）
5. `injuredUntil ≤ currentYear`（未处于重伤状态）

轻伤（`lightInjuryUntil`）和经脉损伤（`meridianDamagedUntil`）SHALL NOT 阻止突破尝试。

#### Scenario: Eligible cultivator
- **WHEN** Lv1 修仙者 cultivation=200（≥ threshold(2)=100），breakthroughCooldownUntil=0, injuredUntil=0, 当前年份=100
- **THEN** SHALL 满足全部突破条件

#### Scenario: Cultivation insufficient
- **WHEN** Lv2 修仙者 cultivation=150（< threshold(3)=1000），当前年份=100
- **THEN** SHALL NOT 满足条件3，不触发突破尝试

#### Scenario: Cooldown blocks attempt
- **WHEN** Lv1 修仙者 cultivation=200, breakthroughCooldownUntil=105, 当前年份=103
- **THEN** SHALL NOT 允许突破尝试（105 > 103，仍在冷却期）

#### Scenario: Cooldown expires exactly
- **WHEN** Lv1 修仙者 cultivation=200, breakthroughCooldownUntil=103, 当前年份=103
- **THEN** SHALL 允许突破尝试（103 ≤ 103，冷却到期）

#### Scenario: Injury blocks attempt
- **WHEN** Lv1 修仙者 cultivation=200, injuredUntil=108, 当前年份=105
- **THEN** SHALL NOT 允许突破尝试

#### Scenario: Light injury does not block
- **WHEN** Lv1 修仙者 cultivation=200, lightInjuryUntil=108, injuredUntil=0, breakthroughCooldownUntil=0, 当前年份=105
- **THEN** SHALL 允许突破尝试

### Requirement: Breakthrough attempt resolution
当修仙者满足突破条件时，系统 SHALL 执行一次突破判定：

1. 生成随机数 `r = prng()`
2. 若 `r < breakthroughChance(level)` → 突破成功，执行升级
3. 否则 → 突破失败，执行失败惩罚

每个路径（`tickCultivators` / `resolveCombat`）内每个修仙者 SHALL 最多尝试一次突破（不允许连续跨级）。两路径独立计算，同年内修仙者在自然修炼和战斗中各可尝试一次。

PRNG 消耗序列：突破判定消耗 1 次 `prng()`；若失败，惩罚选择再消耗 1 次 `prng()`。总计成功 1 次、失败 2 次。

#### Scenario: Successful breakthrough
- **WHEN** Lv2 修仙者 cultivation=1500, prng() 返回 0.10（< breakthroughChance(2) ≈ 0.259）
- **THEN** 修仙者 SHALL 升级至 Lv3，maxAge 增加 lifespanBonus(3)

#### Scenario: Failed breakthrough
- **WHEN** Lv2 修仙者 cultivation=1500, prng() 返回 0.50（≥ breakthroughChance(2) ≈ 0.259）
- **THEN** 修仙者 SHALL 保持 Lv2，触发失败惩罚

#### Scenario: No cascade promotion
- **WHEN** Lv1 修仙者 cultivation=15000（同时超过 Lv2、Lv3、Lv4 阈值），突破成功
- **THEN** SHALL 仅升至 Lv2，不继续尝试 Lv3

### Requirement: Breakthrough failure penalties
突破失败时，系统 SHALL 设置 `breakthroughCooldownUntil = currentYear + BREAKTHROUGH_COOLDOWN`（冷却期必定触发），并随机选择一项额外惩罚：

| 额外惩罚 | 权重 | 概率 | 效果 |
|----------|------|------|------|
| 无额外惩罚 | `BREAKTHROUGH_NOTHING_W`(5.0) | 55.6% | 仅冷却 |
| 修为损失 | `BREAKTHROUGH_CULT_LOSS_W`(2.0) | 22.2% | `cultivation = max(threshold(level), round1(cultivation - (cultivation - threshold(level)) * BREAKTHROUGH_CULT_LOSS_RATE))` |
| 受伤 | `BREAKTHROUGH_INJURY_W`(2.0) | 22.2% | `injuredUntil = currentYear + INJURY_DURATION` |

权重分配概率：`weight / totalWeight`，其中 `totalWeight = 5.0 + 2.0 + 2.0 = 9.0`。

突破失败 SHALL NOT 导致境界回退。修为损失计算结果 SHALL 通过 `round1` 舍入。

惩罚选择使用 1 次 `prng()` 调用，按累积权重区间判定：
- `r < 5.0/9.0` → 无额外惩罚
- `r < 7.0/9.0` → 修为损失
- 否则 → 受伤

#### Scenario: Failure with cooldown only
- **WHEN** 突破失败，prng() 返回 0.30（< 5.0/9.0 ≈ 0.556）
- **THEN** `breakthroughCooldownUntil` SHALL 设为 `currentYear + 3`，无其他变化

#### Scenario: Failure with cultivation loss
- **WHEN** Lv2 修仙者 cultivation=500 突破失败，prng() 返回 0.60（≥ 5.0/9.0, < 7.0/9.0 ≈ 0.778）
- **THEN** 超出修为 = 500 - 100 = 400，损失 = round1(400 × 0.2) = 80.0，cultivation SHALL 变为 420.0

#### Scenario: Failure with injury
- **WHEN** 突破失败，prng() 返回 0.85（≥ 7.0/9.0），当前年份=200
- **THEN** `injuredUntil` SHALL 设为 205（200 + INJURY_DURATION=5）

### Requirement: Breakthrough in combat path
战斗胜利后获得 loot 导致 cultivation 超过 `threshold(level + 1)` 时，SHALL 使用与自然修炼相同的突破判定（`breakthroughChance`、前置条件、失败惩罚）。

combat 路径中的突破尝试与 `tickCultivators` 路径独立——即使同年在自然修炼中已尝试过突破（无论成败），combat 中仍可再尝试一次。

`tryBreakthrough` 函数 SHALL 在 combat 中的调用位置为：赢家获得 loot **之后**、combat 事件推入 events 数组**之后**。此顺序保证 `RichCombatEvent` 记录的是战斗结果而非突破结果。

#### Scenario: Combat loot triggers breakthrough attempt
- **WHEN** Lv2 修仙者战斗胜利，loot 使 cultivation 从 900 升至 1100（≥ threshold(3)=1000），prng() < breakthroughChance(2)
- **THEN** SHALL 升级至 Lv3

#### Scenario: Combat loot triggers failed breakthrough
- **WHEN** Lv2 修仙者战斗胜利，loot 使 cultivation 从 900 升至 1100，prng() ≥ breakthroughChance(2)
- **THEN** SHALL 保持 Lv2，触发失败惩罚（冷却 + 额外惩罚）

#### Scenario: Already attempted in tickCultivators, combat still allows
- **WHEN** Lv1 修仙者在同年 tickCultivators 中已尝试突破并失败（设置了 cooldown），combat 中获得 loot 使修为达标
- **THEN** SHALL NOT 再次尝试（因冷却期条件不满足：`breakthroughCooldownUntil > currentYear`）

### Requirement: Breakthrough event and statistics
系统 SHALL 支持突破机制的完整可观测性。

**引擎计数器**: `SimulationEngine` SHALL 新增以下年度计数器，在 `resetYearCounters` 中归零：
- `breakthroughAttempts: number` — 年度突破尝试总次数
- `breakthroughSuccesses: number` — 年度突破成功次数
- `breakthroughFailures: number` — 年度突破失败次数

**YearSummary**: SHALL 新增对应字段：
- `breakthroughAttempts: number`
- `breakthroughSuccesses: number`
- `breakthroughFailures: number`

**RichBreakthroughEvent**: 突破**失败**时（Lv2+），SHALL 产生事件：

```
{
  type: 'breakthrough_fail',
  year: number,
  newsRank: NewsRank,
  subject: { id: number, name?: string, level: number },
  penalty: 'cooldown_only' | 'cultivation_loss' | 'injury',
  cause: 'natural' | 'combat'
}
```

突破成功 SHALL 复用已有的 `RichPromotionEvent`（cause 字段区分来源）。

**newsRank 规则**:
- Lv4+ 失败 → `'B'`
- Lv2-3 失败 → `'C'`
- Lv1 失败 → 不产生事件（过于常见）

**类型注册**: `RichEvent` 联合类型 SHALL 新增 `RichBreakthroughEvent`。`SimEvent.type` SHALL 新增 `'breakthrough_fail'` 选项。

#### Scenario: Lv5 breakthrough failure event
- **WHEN** Lv5 修仙者在自然修炼中突破失败，惩罚为受伤
- **THEN** SHALL 产生 `{ type: 'breakthrough_fail', newsRank: 'B', penalty: 'injury', cause: 'natural' }` 事件

#### Scenario: Lv1 breakthrough failure no event
- **WHEN** Lv1 修仙者突破失败
- **THEN** SHALL NOT 产生 RichBreakthroughEvent（仅更新计数器）

#### Scenario: Breakthrough success uses promotion event
- **WHEN** Lv3 修仙者突破成功，从 Lv3 升至 Lv4
- **THEN** SHALL 产生 `RichPromotionEvent { fromLevel: 3, toLevel: 4, cause: 'natural' }`

### Requirement: Shared tryBreakthrough function
系统 SHALL 在 `src/engine/simulation.ts` 中定义 `tryBreakthrough(engine: SimulationEngine, c: Cultivator, events: RichEvent[], cause: 'natural' | 'combat'): boolean` 函数，封装完整的突破判定 + 惩罚 + 事件/计数器逻辑。

`tickCultivators` 和 `resolveCombat` SHALL 调用此共享函数，避免逻辑重复。

函数内部 SHALL：
1. 检查前置条件（eligibility），不满足则 return false
2. `engine.breakthroughAttempts++`
3. Roll `prng()` vs `breakthroughChance(c.level)`
4. 成功：执行单级升级（level++, maxAge, levelGroups/aliveLevelIds 迁移, promotionCounts++），产生 `RichPromotionEvent`，触发 `onPromotion` hook，`engine.breakthroughSuccesses++`，return true
5. 失败：设置冷却，roll 额外惩罚，`engine.breakthroughFailures++`，Lv2+ 产生 `RichBreakthroughEvent`，return false

#### Scenario: tryBreakthrough returns true on success
- **WHEN** 满足条件的修仙者突破成功
- **THEN** 函数 SHALL 返回 `true`，修仙者 level 已增加

#### Scenario: tryBreakthrough returns false on ineligible
- **WHEN** 修仙者不满足前置条件
- **THEN** 函数 SHALL 返回 `false`，不消耗 prng()，不增加计数器

## PBT Properties

### PBT-01: breakthroughChance 严格递减
- **INVARIANT**: 对所有整数 k ∈ [1, 6]，breakthroughChance(k+1) < breakthroughChance(k)
- **FALSIFICATION**: 遍历所有相邻对 (k, k+1) 验证严格小于，含边界 (1,2) 和 (5,6)

### PBT-02: breakthroughChance 输出范围
- **INVARIANT**: 对所有有效 k ∈ [1, 6]，0 < breakthroughChance(k) < 1
- **FALSIFICATION**: 对每个有效 k 断言结果为有限数且严格介于 0 和 1 之间

### PBT-03: 不满足条件时零副作用
- **INVARIANT**: 若 eligible(c, year) = false，tryBreakthrough 返回 false 且不修改任何状态（cultivator 字段、levelGroups、aliveLevelIds、events、计数器），不消耗 prng()
- **FALSIFICATION**: 生成违反单个/多个前置条件的状态，快照前后对比全部状态 + PRNG 索引

### PBT-04: 境界不降级
- **INVARIANT**: tryBreakthrough 执行后，c.level' ≥ c.level；成功时 c.level' = c.level + 1（恰好 +1）
- **FALSIFICATION**: 通过控制 PRNG 遍历成功/失败路径，断言 level 从不下降

### PBT-05: 修为下限保障
- **INVARIANT**: 突破失败的修为损失惩罚后，c.cultivation ≥ threshold(c.level)
- **FALSIFICATION**: 生成 cultivation 恰好等于 threshold(level+1)（最小超标）和远超阈值的极端值，强制 cult_loss 路径验证下限

### PBT-06: 惩罚权重分区精确
- **INVARIANT**: 失败惩罚 roll u ∈ [0,1)：u < 5/9 → cooldown_only，5/9 ≤ u < 7/9 → cultivation_loss，7/9 ≤ u → injury
- **FALSIFICATION**: 用边界值（5/9±ε, 7/9±ε, 0, 1-ε）精确测试分区，可选长程统计检验逼近 5:2:2

### PBT-07: 每路径独立尝试预算
- **INVARIANT**: 每个 cultivator 每年每路径最多 1 次尝试；tickCultivators 和 resolveCombat 独立计数
- **FALSIFICATION**: 构造同年跨双路径调用序列，断言每路径 max=1 且无共享"已尝试"门控

### PBT-08: 等级索引集同步
- **INVARIANT**: 对每个 alive cultivator c：c.id ∈ levelGroups[c.level] 且 c.id ∈ aliveLevelIds[c.level]；对所有 l ≠ c.level，c.id 不在这些集合中
- **FALSIFICATION**: 随机化成功/失败/不满足条件转换后，全局扫描集合成员关系

### PBT-09: 计数器守恒
- **INVARIANT**: 每年 breakthroughAttempts = breakthroughSuccesses + breakthroughFailures
- **FALSIFICATION**: 用确定性 PRNG 运行随机化年度模拟，对比引擎计数器与 oracle 计数

### PBT-10: 冷却单调不减
- **INVARIANT**: 同年内每次状态转换后 breakthroughCooldownUntil' ≥ breakthroughCooldownUntil；失败时精确赋值 year + BREAKTHROUGH_COOLDOWN
- **FALSIFICATION**: 生成同年内多次操作（含双路径），断言单调不减 + 失败赋值精确

### PBT-11: PRNG 消耗确定性
- **INVARIANT**: tryBreakthrough 不满足条件消耗 0 次 prng()，成功消耗 1 次，失败消耗 2 次；相同种子产生完全相同的突破结果
- **FALSIFICATION**: 用 PRNG 计数器包装器，在相同种子下双次运行同一场景，断言调用次数和结果一致

### PBT-12: maxAge 不因突破下降
- **INVARIANT**: tryBreakthrough 后 c.maxAge' ≥ c.maxAge；成功时 maxAge' = maxAge + lifespanBonus(newLevel)，失败时 maxAge' = maxAge
- **FALSIFICATION**: 记录调用前后 maxAge，断言全局不下降

### PBT-13: Lv0 绕过突破门
- **INVARIANT**: level=0 的修仙者永远不进入 tryBreakthrough，自动升级至 Lv1 不消耗突破相关 PRNG
- **FALSIFICATION**: 对 tryBreakthrough 设置 spy，运行含多个 Lv0 达标修仙者的模拟，断言 spy 零调用

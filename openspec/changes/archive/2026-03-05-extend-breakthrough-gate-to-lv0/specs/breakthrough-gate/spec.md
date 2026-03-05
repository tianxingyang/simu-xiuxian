## MODIFIED Requirements

### Requirement: Breakthrough chance function
系统 SHALL 在 `src/constants.ts` 中定义 `breakthroughChance(level: number): number` 纯函数，返回从当前境界突破到下一境界的每次尝试成功概率。公式为：

```
breakthroughChance(k) = Math.exp(-(BREAKTHROUGH_A + BREAKTHROUGH_B * (2 * k + 1)))
```

其中 k 为当前境界编号（k ≥ 0）。

#### Scenario: Lv0 breakthrough chance
- **WHEN** 调用 `breakthroughChance(0)`
- **THEN** 返回值 SHALL 为 `Math.exp(-(0.6 + 0.15 * 1))` ≈ 0.4724（47.2%）

#### Scenario: Lv1 breakthrough chance
- **WHEN** 调用 `breakthroughChance(1)`
- **THEN** 返回值 SHALL 为 `Math.exp(-(0.6 + 0.15 * 3))` ≈ 0.3499（35.0%）

#### Scenario: Lv6 breakthrough chance
- **WHEN** 调用 `breakthroughChance(6)`
- **THEN** 返回值 SHALL 为 `Math.exp(-(0.6 + 0.15 * 13))` ≈ 0.0781（7.8%）

#### Scenario: Monotonic decrease
- **WHEN** 对 k=0,1,2,...,6 依次调用 `breakthroughChance(k)`
- **THEN** 返回值 SHALL 严格递减

### Requirement: Breakthrough eligibility
修仙者 SHALL 同时满足以下全部条件才能尝试突破：

1. `level < MAX_LEVEL`（Lv7 为顶级）
2. `cultivation ≥ threshold(level + 1)`（修为达标）
3. `breakthroughCooldownUntil ≤ currentYear`（不在冷却期）
4. `injuredUntil ≤ currentYear`（未处于重伤状态）

轻伤（`lightInjuryUntil`）和经脉损伤（`meridianDamagedUntil`）SHALL NOT 阻止突破尝试。

Lv0 修仙者满足上述条件后 SHALL 进入突破判定，与 Lv1+ 使用相同的判定和惩罚逻辑。

#### Scenario: Lv0 eligible cultivator
- **WHEN** Lv0 修仙者 cultivation=48（≥ threshold(1)=48），breakthroughCooldownUntil=0, injuredUntil=0, 当前年份=100
- **THEN** SHALL 满足全部突破条件，进入突破判定

#### Scenario: Lv0 cultivation insufficient
- **WHEN** Lv0 修仙者 cultivation=47（< threshold(1)=48），当前年份=100
- **THEN** SHALL NOT 满足条件2，不触发突破尝试

#### Scenario: Eligible cultivator
- **WHEN** Lv1 修仙者 cultivation=200（≥ threshold(2)=100），breakthroughCooldownUntil=0, injuredUntil=0, 当前年份=100
- **THEN** SHALL 满足全部突破条件

#### Scenario: Cultivation insufficient
- **WHEN** Lv2 修仙者 cultivation=150（< threshold(3)=1000），当前年份=100
- **THEN** SHALL NOT 满足条件2，不触发突破尝试

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

### Requirement: Breakthrough event and statistics
系统 SHALL 支持突破机制的完整可观测性。

**引擎计数器**: `SimulationEngine` SHALL 维护以下年度计数器，在 `resetYearCounters` 中归零：
- `breakthroughAttempts: number` — 年度突破尝试总次数
- `breakthroughSuccesses: number` — 年度突破成功次数
- `breakthroughFailures: number` — 年度突破失败次数

**YearSummary**: SHALL 包含对应字段：
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
- Lv0-1 失败 → 不产生事件（过于常见）

**类型注册**: `RichEvent` 联合类型 SHALL 包含 `RichBreakthroughEvent`。

#### Scenario: Lv0 breakthrough failure no event
- **WHEN** Lv0 修仙者突破失败
- **THEN** SHALL NOT 产生 RichBreakthroughEvent（仅更新计数器）

#### Scenario: Lv1 breakthrough failure no event
- **WHEN** Lv1 修仙者突破失败
- **THEN** SHALL NOT 产生 RichBreakthroughEvent（仅更新计数器）

#### Scenario: Lv5 breakthrough failure event
- **WHEN** Lv5 修仙者在自然修炼中突破失败，惩罚为受伤
- **THEN** SHALL 产生 `{ type: 'breakthrough_fail', newsRank: 'B', penalty: 'injury', cause: 'natural' }` 事件

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

#### Scenario: Lv0 tryBreakthrough returns true on success
- **WHEN** Lv0 修仙者 cultivation=48, prng() 返回 0.20（< breakthroughChance(0) ≈ 0.472）
- **THEN** 函数 SHALL 返回 `true`，修仙者 level 变为 1，maxAge 增加 lifespanBonus(1)=100

#### Scenario: Lv0 tryBreakthrough returns false on failure
- **WHEN** Lv0 修仙者 cultivation=48, prng() 返回 0.60（≥ breakthroughChance(0) ≈ 0.472）
- **THEN** 函数 SHALL 返回 `false`，`breakthroughCooldownUntil` 设为 currentYear + 3

#### Scenario: tryBreakthrough returns false on ineligible
- **WHEN** 修仙者不满足前置条件
- **THEN** 函数 SHALL 返回 `false`，不消耗 prng()，不增加计数器

## MODIFIED PBT Properties

### PBT-01: breakthroughChance 严格递减
- **INVARIANT**: ∀k ∈ {0..5}: breakthroughChance(k+1) < breakthroughChance(k)
- **FALSIFICATION**: 遍历所有相邻对 (k, k+1) 验证严格小于，含边界 (0,1) 和 (5,6)

### PBT-02: breakthroughChance 输出范围
- **INVARIANT**: ∀k ∈ {0..6}: 0 < breakthroughChance(k) < 1
- **FALSIFICATION**: 对每个有效 k 断言结果为有限数且严格介于 0 和 1 之间

### PBT-03: Lv0 突破失败修为不为负
- **INVARIANT**: 对 Lv0 突破失败，惩罚计算 `max(threshold(0), cultivation - excess * 0.2)` = `max(0, ...)` ≥ 0。多次连续惩罚（假设重置冷却）结果仍 ≥ 0
- **FALSIFICATION**: Fuzz cultivation 值（0, 0.1, 48, 极大值），对每个值连续应用 1..N 次惩罚，断言结果 ≥ 0

### PBT-04: Lv0→Lv1 升级后同 tick 不死亡
- **INVARIANT**: 若 Lv0 修仙者在 tick T 成功突破至 Lv1，则 post-state 满足 age < maxAge（同 tick 不触发寿尽死亡）
- **FALSIFICATION**: 构造 age=58/59/60 的 Lv0 修仙者，执行 tryBreakthrough 成功路径，断言 age < maxAge。重点验证 age=58 + maxAge=60+100=160 的情况

### PBT-05: Lv0 一生最多 1 次突破尝试
- **INVARIANT**: 在 bornAge=10, maxAge=60, growthRate=1/year, threshold(1)=48, cooldown=3 的配置下，Lv0 修仙者一生突破尝试次数 A ∈ {0, 1}
- **FALSIFICATION**: 模拟完整生命周期（age=10 到 age=60），记录突破尝试次数，断言 A ≤ 1。边界：首次达标 age=58，冷却至 age=61（已死亡）

### PBT-06: Lv0 稳态分布验证
- **INVARIANT**: 3 个不同 seed 各运行 5000 tick，Lv0 占存活总人口比例 r ∈ [0.50, 0.65]
- **FALSIFICATION**: 运行 3 seed × 5000 tick，取最后 tick 的 Lv0 比例，断言在区间内。若任一 seed 偏离，缩小 seed 范围定位

### PBT-07: 所有 Lv0→Lv1 升级必须消耗 PRNG
- **INVARIANT**: 每次 Lv0→Lv1 升级事件必须经过 tryBreakthrough 的 prng() 调用，不存在绕过概率门的直接升级路径
- **FALSIFICATION**: 插桩 PRNG 调用计数器，在 tickCultivators 和 resolveCombat 中监控所有 level 变更，断言每次 0→1 升级伴随至少 1 次 prng() 消耗

## REMOVED Requirements

### Requirement: PBT-13 Lv0 绕过突破门
**Reason**: Lv0 现在进入突破概率门判定，不再绕过
**Migration**: 测试应验证 Lv0 修仙者满足条件时正确进入 tryBreakthrough 并消耗 prng()

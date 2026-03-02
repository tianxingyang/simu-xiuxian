## ADDED Requirements

### Requirement: Defeat outcome determination
战败后系统 SHALL 根据实力差距和境界计算死亡概率，再掷骰决定结局。公式：

```
gap = (winner.cultivation - loser.cultivation) / (winner.cultivation + loser.cultivation)
deathChance = clamp(DEFEAT_BASE_DEATH - DEFEAT_LEVEL_PROTECTION × loser.level + DEFEAT_GAP_SEVERITY × gap, DEFEAT_MIN_DEATH, DEFEAT_MAX_DEATH)
```

- `gap` SHALL 使用败者**战前快照**（闪避惩罚前）修为计算
- `gap` 可为负值（弱者赢时 winner.cult < loser.cult）
- 常量：`DEFEAT_BASE_DEATH=0.7`, `DEFEAT_LEVEL_PROTECTION=0.09`, `DEFEAT_GAP_SEVERITY=0.3`, `DEFEAT_MIN_DEATH=0.05`, `DEFEAT_MAX_DEATH=0.95`

第一次掷骰 `r1 = prng()`：若 `r1 < deathChance` → 死亡。否则进入存活结局判定。

#### Scenario: Lv1 equal fight death chance
- **WHEN** Lv1 败者与胜者修为相近（gap ≈ 0）
- **THEN** deathChance SHALL ≈ 0.61

#### Scenario: Lv7 equal fight death chance
- **WHEN** Lv7 败者与胜者修为相近（gap ≈ 0）
- **THEN** deathChance SHALL ≈ 0.07

#### Scenario: Large gap increases death chance
- **WHEN** Lv3 败者 gap = 0.5
- **THEN** deathChance SHALL ≈ 0.58（比均势的 0.43 高出 0.15）

#### Scenario: Death chance clamped to bounds
- **WHEN** 计算结果超出 [MIN_DEATH, MAX_DEATH] 范围
- **THEN** deathChance SHALL 被 clamp 到 [0.05, 0.95]

#### Scenario: Negative gap lowers death chance
- **WHEN** 弱者赢了（winner.cult < loser.cult），gap 为负值
- **THEN** deathChance SHALL 低于均势时的值（败者实力更强，存活概率更高）

### Requirement: Survival outcome selection
当败者未死亡时，系统 SHALL 进行第二次掷骰 `r2 = prng()` 选择存活结局。三种结局按固定权重归一化分配概率：

| 结局 | 权重 | 归一化概率 |
|------|------|-----------|
| 跌境 | `DEFEAT_DEMOTION_W`=1 | 25% |
| 重伤 | `DEFEAT_INJURY_W`=1.5 | 37.5% |
| 损失修为 | `DEFEAT_LOSS_W`=1.5 | 37.5% |

判定逻辑：
```
total = DEFEAT_DEMOTION_W + DEFEAT_INJURY_W + DEFEAT_LOSS_W
demotionThreshold = DEFEAT_DEMOTION_W / total
injuryThreshold = (DEFEAT_DEMOTION_W + DEFEAT_INJURY_W) / total

r2 < demotionThreshold → 跌境
r2 < injuryThreshold → 重伤
otherwise → 损失修为
```

#### Scenario: Survival outcome distribution
- **WHEN** 大量存活结局样本被收集
- **THEN** 跌境约占 25%，重伤约占 37.5%，损失修为约占 37.5%

### Requirement: Demotion outcome
跌境结局 SHALL 使败者降低 1 级并重置修为：

- 败者 `level` SHALL 减少 1
- 败者 `cultivation` SHALL 重置为 `threshold(newLevel)`（Lv0 则为 0）
- `maxAge` SHALL **不立即变化**——由渐进式寿元衰减机制处理（见 Gradual lifespan decay）
- 败者 SHALL 从原级别的 `levelGroups` 中移除，加入新级别的 `levelGroups`

#### Scenario: Lv3 demotion to Lv2
- **WHEN** Lv3 修士（cultivation=5000, maxAge=8900）被判定为跌境
- **THEN** level SHALL 变为 2，cultivation SHALL 变为 100（threshold(2)），maxAge SHALL 保持 8900 不变（后续由渐进衰减处理）

#### Scenario: Lv1 demotion to Lv0
- **WHEN** Lv1 修士（cultivation=50, maxAge=100）被判定为跌境
- **THEN** level SHALL 变为 0，cultivation SHALL 变为 0，maxAge SHALL 保持 100 不变（后续由渐进衰减处理）

#### Scenario: Demoted cultivator leaves encounter pool
- **WHEN** Lv2 修士跌境至 Lv1
- **THEN** 该修士 SHALL 被移入 Lv1 的 levelGroups，不再匹配 Lv2 对手

### Requirement: Gradual lifespan decay
`naturalCultivation` SHALL 对 `maxAge` 超出当前境界可维持寿元的修士执行渐进式衰减：

```
sustainableMaxAge = [60, 100, 900, 8900, 88900, 888900, 8888900, 88888900]
if maxAge > sustainableMaxAge[level]:
    decay = (maxAge - sustainableMaxAge[level]) * LIFESPAN_DECAY_RATE
    maxAge = max(MORTAL_MAX_AGE, round(maxAge - decay))
```

- `LIFESPAN_DECAY_RATE = 0.2`
- `maxAge` 下限为 `MORTAL_MAX_AGE`(60)
- 使用 `Math.round` 保持整数语义
- **不可逆**：重新突破回原境界后 maxAge 照常增加（通过正常晋升逻辑），但已衰减的部分不恢复
- 当 `maxAge` 衰减至 `age <= maxAge` 范围时，`removeExpired` 自然处理死亡，计入 `expiryDeaths`

#### Scenario: Lv3 demoted to Lv2, gradual decay
- **WHEN** Lv3 修士（maxAge=8900）跌境至 Lv2（sustainableMaxAge=900）
- **THEN** 第一年衰减 (8900-900)×0.2 = 1600，maxAge SHALL 变为 round(8900-1600) = 7300
- **AND** 第二年衰减 (7300-900)×0.2 = 1280，maxAge SHALL 变为 round(7300-1280) = 6020

#### Scenario: Decay converges to sustainable level
- **WHEN** 经过足够多年的衰减
- **THEN** maxAge SHALL 逐渐趋近 sustainableMaxAge[level]，差值按 0.8^n 指数衰减

#### Scenario: maxAge floored at MORTAL_MAX_AGE
- **WHEN** Lv1→Lv0 跌境后 sustainableMaxAge=60，maxAge 衰减中
- **THEN** maxAge SHALL 不低于 60

#### Scenario: Irreversible decay
- **WHEN** 修士从 Lv3 跌境至 Lv2，maxAge 衰减至 5000 后重新突破至 Lv3
- **THEN** maxAge SHALL 变为 5000 + lifespanBonus(3) = 5000 + 8000 = 13000，而非原始的 8900 + 8000

#### Scenario: Demotion-induced death via removeExpired
- **WHEN** 跌境后经过渐进衰减 maxAge 降至 age 以下
- **THEN** 该修士 SHALL 由 removeExpired 处理，计入 expiryDeaths（非 combatDeaths）

### Requirement: Injury outcome
重伤结局 SHALL 设置败者的 `injuredUntil = currentYear + INJURY_DURATION`（`INJURY_DURATION=5`）。重伤期间（`year < injuredUntil`）：

- `processEncounters` SHALL 跳过该修士（不发起遭遇）
- 重伤修士 SHALL 不计入遭遇概率快照 Nk/N
- 重伤修士 SHALL 从 `levelArrayCache` 中排除（不被选为对手）
- `naturalCultivation` SHALL 使其修为增长乘以 `INJURY_GROWTH_RATE`(0.5)

重伤期间修士 SHALL 保持 `alive = true`，正常参与寿元过期检查。

#### Scenario: Injury sets recovery deadline
- **WHEN** 修士在第 100 年被判定为重伤
- **THEN** injuredUntil SHALL 为 105，修士在第 100-104 年为重伤状态，第 105 年恢复

#### Scenario: Injured cultivator skipped in encounters
- **WHEN** 重伤修士在遭遇阶段被遍历到
- **THEN** 该修士 SHALL 在 alive 检查后立即被跳过，不消耗 PRNG

#### Scenario: Injured cultivator halved cultivation growth
- **WHEN** 重伤修士经过 naturalCultivation
- **THEN** 修为增长 SHALL 为 0.5 而非 1

#### Scenario: Injury does not prevent aging or expiry
- **WHEN** 重伤修士 age 达到 maxAge
- **THEN** 该修士 SHALL 正常被 removeExpired 移除

#### Scenario: Injured excluded from snapshot
- **WHEN** 构建遭遇阶段快照时，某级别有 10 名修士其中 3 名重伤
- **THEN** 该级别 Nk SHALL 为 7，N 中也排除这 3 名

### Requirement: Cultivation loss outcome
损失修为结局 SHALL 扣减败者修为的 `DEFEAT_CULT_LOSS_RATE`(0.3)，但不低于当前级别门槛：

```
loser.cultivation = max(threshold(loser.level), round1(loser.cultivation × (1 - DEFEAT_CULT_LOSS_RATE)))
```

败者 SHALL 保持当前级别不变。

#### Scenario: Lv2 cultivator loses 30% cultivation
- **WHEN** Lv2 修士（cultivation=500）被判定为损失修为
- **THEN** cultivation SHALL 变为 max(100, round1(500 × 0.7)) = 350

#### Scenario: Cultivation loss floored at level threshold
- **WHEN** Lv1 修士（cultivation=12）被判定为损失修为
- **THEN** cultivation SHALL 变为 max(10, round1(12 × 0.7)) = max(10, 8.4) = 10

### Requirement: Defeat lockout
每个修士每年 SHALL 最多承受一次战败结局：

- 存活败者 SHALL 立即从 `levelArrayCache` 中移除（不再被选为对手）
- 存活败者 SHALL 被记录在本轮败者 Set 中，遍历时跳过（不再发起遭遇）
- 败者 Set SHALL 在下一年重置

#### Scenario: Surviving loser not selected as opponent
- **WHEN** 修士 A 在本轮被判定为损失修为（存活）
- **THEN** 后续对手选择 SHALL 不会选中 A

#### Scenario: Surviving loser cannot initiate
- **WHEN** 修士 A 本轮已战败存活，轮到 A 在 aliveIds 中发起遭遇
- **THEN** A SHALL 被跳过，不发起遭遇

### Requirement: PRNG call sequence
`resolveCombat` 中 PRNG 调用 SHALL 严格按以下顺序：

1. 闪避判定（若适用）：`prng()` 判断闪避成功
2. 胜负判定：`prng()` 决定谁赢
3. Loot luck：`truncatedGaussian(prng, ...)` 计算运气因子
4. 死亡掷骰：`prng()` 与 deathChance 比较（仅败者存活时）
5. 存活结局掷骰：`prng()` 选择跌境/重伤/损失修为（仅死亡判定未命中时）

未触发的分支 SHALL 不消耗 PRNG。

#### Scenario: Death outcome consumes 1 extra roll
- **WHEN** 败者被判定为死亡
- **THEN** PRNG SHALL 在 loot 后仅消耗 1 次（死亡掷骰），不消耗存活结局掷骰

#### Scenario: Survival outcome consumes 2 extra rolls
- **WHEN** 败者存活
- **THEN** PRNG SHALL 在 loot 后消耗 2 次（死亡掷骰 + 存活结局掷骰）

### Requirement: Event encoding
战斗事件缓冲区 SHALL 使用第 4 位编码败者结局：

```
[0, combatLevel, loot, outcomeCode]
```

`outcomeCode`: 0=死亡, 1=跌境, 2=重伤, 3=损失修为。

`combatLevel` SHALL 使用败者**战前**级别（跌境前）。

事件文本模板：
- 死亡：`{level}对决，获得机缘{loot}`
- 跌境：`{level}对决，获得机缘{loot}，败者跌境`
- 重伤：`{level}对决，获得机缘{loot}，败者重伤`
- 损失修为：`{level}对决，获得机缘{loot}，败者损失修为`

#### Scenario: Demotion event uses pre-combat level
- **WHEN** Lv3 修士跌境至 Lv2
- **THEN** 事件 combatLevel SHALL 为 3，outcomeCode SHALL 为 1

### Requirement: Defeat outcome constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：

- `DEFEAT_BASE_DEATH = 0.7`
- `DEFEAT_LEVEL_PROTECTION = 0.09`
- `DEFEAT_GAP_SEVERITY = 0.3`
- `DEFEAT_MIN_DEATH = 0.05`
- `DEFEAT_MAX_DEATH = 0.95`
- `DEFEAT_DEMOTION_W = 1`
- `DEFEAT_INJURY_W = 1.5`
- `DEFEAT_LOSS_W = 1.5`
- `DEFEAT_CULT_LOSS_RATE = 0.3`
- `INJURY_DURATION = 5`
- `INJURY_GROWTH_RATE = 0.5`
- `LIFESPAN_DECAY_RATE = 0.2`

#### Scenario: Constants are importable
- **WHEN** `combat.ts` 或 `simulation.ts` 导入上述常量
- **THEN** 值 SHALL 与定义一致

### Requirement: PBT — Death chance bounds
对所有合法输入（`loser.level ∈ [0, 7]`, `gap ∈ (-1, 1)`），`deathChance` SHALL 始终在 `[DEFEAT_MIN_DEATH, DEFEAT_MAX_DEATH]` 闭区间内。

#### Scenario: Extreme inputs bounded
- **WHEN** level=7, gap=-0.9（最低死亡率）
- **THEN** deathChance SHALL >= 0.05

### Requirement: PBT — Outcome probability sums to 1
对任意战败事件，死亡概率 + 存活概率 SHALL 精确等于 1。存活时三种结局的归一化权重之和 SHALL 精确等于 1。

#### Scenario: Probability conservation
- **WHEN** 任意 deathChance 值被计算
- **THEN** (1 - deathChance) + deathChance SHALL = 1，且存活分支的三个归一化概率之和 SHALL = 1

### Requirement: PBT — Level monotonicity
固定 gap 值时，`deathChance` SHALL 随 `loser.level` 递增而单调递减。

#### Scenario: Higher level lower death chance
- **WHEN** gap 固定为 0.3，level 从 1 递增到 7
- **THEN** deathChance SHALL 严格递减

### Requirement: PBT — maxAge decay convergence
跌境后 `maxAge` 的渐进衰减 SHALL 满足：
- 单调非增：`maxAge_{t+1} <= maxAge_t`（当 `maxAge > sustainableMaxAge` 时严格递减）
- 下界：`maxAge >= MORTAL_MAX_AGE`（始终成立）
- 指数收敛：`|maxAge_{t+n} - target| = 0.8^n × |maxAge_t - target|`（浮点容差内）
- 不可逆：跌境后 `maxAge` 永不超过跌境时刻的值（除非重新晋升）

#### Scenario: Monotone decay
- **WHEN** maxAge=8900, sustainableMaxAge=900, 连续衰减 20 年
- **THEN** 每年 maxAge SHALL 严格递减，且始终 >= 60

### Requirement: PBT — Defeat state consistency
战败结局 SHALL 满足以下状态不变量：
- 死亡：`alive=false`，`combatDeaths` 递增 1，存活结局变量不变
- 跌境：`alive=true`，`level' = level - 1`，`cultivation' = threshold(level')`，`maxAge` 不变
- 重伤：`alive=true`，`injuredUntil = year + 5`，`level` 和 `cultivation` 不变
- 损失修为：`alive=true`，`cultivation' >= threshold(level)`，`level` 不变
- 所有结局：`cultivation' >= threshold(level')` 始终成立

#### Scenario: Post-defeat cultivation safety
- **WHEN** 任意结局被应用
- **THEN** 败者的 cultivation SHALL >= threshold(败者当前 level)

### Requirement: PBT — Single defeat per year
对任意模拟年和任意修士，该修士 SHALL 最多承受 1 次战败结局。

#### Scenario: Year boundary reset
- **WHEN** 修士在第 Y 年战败存活
- **THEN** 第 Y+1 年该修士 SHALL 可以再次被战败（不被上年锁定）

### Requirement: PBT — Loot independence
Loot SHALL 仅依赖败者战前修为快照和 loot 相关 PRNG 段，不受战败结局影响。

#### Scenario: Same seed different outcomes same loot
- **WHEN** 使用相同种子和战前状态，强制不同战败结局
- **THEN** loot SHALL 完全相同

### Requirement: PBT — PRNG determinism
相同初始状态 + 相同种子 + 相同事件顺序 SHALL 产生完全相同的结果和 PRNG 最终状态。

#### Scenario: Replay determinism
- **WHEN** 相同场景执行两次
- **THEN** 所有战斗结果、结局、修为变化 SHALL 完全一致

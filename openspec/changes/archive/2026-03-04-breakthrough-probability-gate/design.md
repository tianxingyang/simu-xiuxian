## Context

当前模拟中修仙者达到修为阈值后自动升级，境界分布完全由修为增长速度、战斗动态、寿元系统涌现决定。分析表明：

- 纯修炼（1/年）在每个境界都存在约 11% 的修为缺口（寿元不够用），战斗掠夺是升级的必要补充
- 战斗死亡率 `0.40 × 0.72^level` 随等级递减，高境界修仙者越来越安全
- 结果：高境界人口占比偏高，不符合修仙世界的陡峭金字塔预期

需要引入突破概率门作为主要的分布控制杠杆。

## Goals / Non-Goals

**Goals:**
- 引入突破概率门，使 Lv1+ 升级需要通过概率判定
- 稳态分布在统计学上匹配 `p_k = w_k / Σw_i`，其中 `w_k = e^{-(a·k + b·k²)}`
- 突破失败有代价（冷却、修为损失、受伤），增加"天劫"的危险感
- 参数 `a`、`b` 作为编译期常量，控制分布形状

**Non-Goals:**
- 运行时动态调参
- 修改战斗系统或寿元系统
- 修改 Lv0→Lv1 的自动升级行为

## Decisions

### D1: 突破成功率公式

**选择**: `breakthroughChance(k) = e^{-(a + b·(2k+1))}`，其中 k 为当前境界编号（k≥1）。

**理由**: 该公式正是目标分布中相邻境界的权重比 `w_{k+1}/w_k`。将其用作突破概率的直觉是：每级突破的"通过率"直接反映目标分布的相邻倍率。当突破门是主要瓶颈时（它会是，因为概率在 7.8%~35.0% 之间），稳态分布将自然趋近目标。

a=0.6, b=0.15 时各级突破率：

| 突破 | k | 公式值 | 概率 |
|------|---|--------|------|
| Lv1→Lv2 | 1 | e^{-1.05} | 35.0% |
| Lv2→Lv3 | 2 | e^{-1.35} | 25.9% |
| Lv3→Lv4 | 3 | e^{-1.65} | 19.2% |
| Lv4→Lv5 | 4 | e^{-1.95} | 14.2% |
| Lv5→Lv6 | 5 | e^{-2.25} | 10.5% |
| Lv6→Lv7 | 6 | e^{-2.55} | 7.8% |

**备选方案**:
- 解析求解精确突破率（考虑战斗死亡、寿元等所有因素）——过于复杂，且系统是随机的，精确解析不可行
- 预运行校准阶段——增加运行时复杂度，且用户不需要运行时调参

### D2: 突破判定时机

**选择**: 在两个位置插入突破判定：

1. `tickCultivators`：每年自然修炼后，若 cultivation ≥ threshold(level+1)，尝试突破
2. `resolveCombat`：战斗胜利获得 loot 后，若 cultivation ≥ threshold(level+1)，尝试突破

两处使用相同的突破判定函数。每个路径内最多尝试一次突破（不允许连续跨级），两路径独立计算——同一年内修仙者在自然修炼和战斗中各可尝试一次，最多 2 次。

**理由**: 战斗掠夺是修为增长的重要途径，必须在 combat 路径中也加入门控。限制每路径一次突破避免了战斗 loot 导致的连续跨级升级。两路径独立是因为自然修炼和战斗顿悟是不同的突破契机，允许修仙者在两种场景下各有一次机会。

**备选方案**:
- 仅在 tickCultivators 中判定，combat 中积累修为但不判定——导致 combat 路径的升级延迟一年，与当前行为差异大
- 允许 combat 路径绕过门控（"战斗顿悟"）——降低分布控制精度

### D3: 突破失败惩罚

**选择**: 每次失败**必定**进入冷却期（`BREAKTHROUGH_COOLDOWN` 年），额外随机触发一项惩罚：

| 额外惩罚 | 权重 | 概率 | 效果 |
|----------|------|------|------|
| 无额外惩罚 | 5.0 | 55.6% | 仅冷却 |
| 修为损失 | 2.0 | 22.2% | 损失 `BREAKTHROUGH_CULT_LOSS_RATE`(20%) 的超出修为 |
| 受伤 | 2.0 | 22.2% | `injuredUntil = year + INJURY_DURATION` |

总权重 = 9.0。突破失败**不会**导致境界回退——天劫的惩罚是修为受损或身体受创，不会动摇根基。

**理由**: 冷却期作为基础代价保证突破尝试有间隔（不会每年都试）。额外惩罚增加天劫的危险感：约半数时候只是失败需要休整，但也有可能走火入魔（受伤）或灵力反噬（修为损失）。不设跌境惩罚是因为境界回退会使 maxAge/sustainableMaxAge 产生复杂的级联效应，且与"天劫"的世界观不符（天劫考验的是能否更进一步，不会倒退）。

### D4: 突破前置条件

**选择**: 必须同时满足以下条件才能尝试突破：

1. `level ≥ 1`（Lv0→Lv1 自动，不经过门控）
2. `level < MAX_LEVEL`（Lv7 为顶级）
3. `cultivation ≥ threshold(level + 1)`
4. `breakthroughCooldownUntil ≤ year`（不在冷却期）
5. `injuredUntil ≤ year`（未处于重伤状态）

**理由**: 重伤修士不应尝试突破（走火入魔的风险太大）。这也让"受伤"惩罚间接延长了突破间隔，增加了层次感。轻伤（lightInjuryUntil）不阻止突破——轻伤只是减速，不会影响突破尝试。

### D5: Cultivator 状态变更

**选择**: `Cultivator` 接口新增 `breakthroughCooldownUntil: number` 字段，初始值 0。

在 `spawnCultivators` 的两条路径（对象池复用 + 新建）中均初始化为 0。在 `reset()` 中通过 `spawnCultivators` 自动处理。

### D6: 提取共享突破逻辑

**选择**: 在 `src/constants.ts` 中定义 `breakthroughChance(level: number): number` 纯函数。在 `src/engine/simulation.ts` 中定义 `tryBreakthrough(engine, c, events): boolean` 函数，封装突破判定 + 惩罚逻辑，供 `tickCultivators` 和 `resolveCombat` 调用。

**理由**: 避免在两处重复突破逻辑。`breakthroughChance` 作为纯函数放在 constants 中，与其他公式函数（`threshold`、`lifespanBonus`）一致。`tryBreakthrough` 涉及引擎状态变更（prng、events、level groups），放在 simulation 模块中。

### D7: 事件与统计

**选择**: 突破机制纳入完整可观测性支持：

1. **引擎计数器**: `SimulationEngine` 新增 `breakthroughAttempts`、`breakthroughSuccesses`、`breakthroughFailures` 三个年度计数器，在 `resetYearCounters` 中归零
2. **YearSummary**: 同步新增对应字段，在 `getSummary` 中填充
3. **RichEvent**: 新增 `RichBreakthroughEvent` 事件类型，仅在**失败**时产生（成功时复用已有的 `RichPromotionEvent`）
4. **事件字段**: `{ type: 'breakthrough_fail', year, newsRank, subject: { id, name?, level }, penalty: 'cooldown_only' | 'cultivation_loss' | 'injury', cause: 'natural' | 'combat' }`
5. **newsRank 规则**: Lv4+ 失败为 B 级，Lv2-3 失败为 C 级，Lv1 失败不产生事件
6. **Hooks**: `onPromotion` 在突破成功时正常触发（与自动升级相同语义），不新增 hook

**理由**: 成功突破就是一次升级，复用 `RichPromotionEvent` 避免事件冗余。失败事件仅记录有新闻价值的高境界失败（Lv2+），Lv1 突破失败过于常见无需记录。计数器保证仪表盘可统计突破通过率。

## Risks / Trade-offs

- **分布精度**: 突破门是主要瓶颈但非唯一因素，实际分布会因战斗、寿元等因素与公式有偏差。可通过微调 a/b 补偿 → 风险可接受
- **冷却期堆叠**: 突破失败→受伤→冷却 + 受伤时间叠加，可能导致长时间无法尝试 → 符合"天劫"设计意图，是特性而非缺陷
- **Lv1 瓶颈加剧**: Lv1 寿元仅 100 年，加上突破门后可尝试次数有限，可能导致 Lv1→Lv2 通过率过低 → 这正是目标分布所期望的（结丹仅占 9.78%）

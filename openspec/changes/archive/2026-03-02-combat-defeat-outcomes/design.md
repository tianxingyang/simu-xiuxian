## Context

当前 `resolveCombat` 中败者一律 `alive = false`，战斗是纯淘汰制。引入多元结局需要在保持现有战斗触发、闪避、战利品机制不变的前提下，替换败者处理逻辑。

## Goals / Non-Goals

**Goals:**
- 战败产生四种结局：死亡、跌境、重伤、损失修为
- 结局由实力差距 + 境界 + 随机性共同决定
- 重伤引入禁战期和修炼减速
- 跌境引入渐进式寿元衰减
- UI 层展示战败结局统计

**Non-Goals:**
- 不改变战斗触发逻辑（遭遇概率、对手选择、闪避判定）
- 不改变胜者战利品（loot）公式
- 不引入 HP / 伤害数值系统

## Decisions

### D1: 死亡概率——线性公式

```
gap = (winner.cultivation - loser.cultivation) / (winner.cultivation + loser.cultivation)
deathChance = clamp(DEFEAT_BASE_DEATH - DEFEAT_LEVEL_PROTECTION × loser.level + DEFEAT_GAP_SEVERITY × gap, DEFEAT_MIN_DEATH, DEFEAT_MAX_DEATH)
```

- `gap` 使用败者**战前快照**（闪避前）修为计算
- `gap` 可为负值（弱者赢时，对败者有利，降低死亡率）
- 公式已有 clamp 兜底

常量：`DEFEAT_BASE_DEATH=0.7`, `DEFEAT_LEVEL_PROTECTION=0.09`, `DEFEAT_GAP_SEVERITY=0.3`, `DEFEAT_MIN_DEATH=0.05`, `DEFEAT_MAX_DEATH=0.95`

| 境界 | 均势(gap≈0) | 大差距(gap=0.5) |
|------|------------|----------------|
| Lv1 筑基 | 61% | 76% |
| Lv3 元婴 | 43% | 58% |
| Lv5 炼虚 | 25% | 40% |
| Lv7 大乘 | 7% | 22% |

**Rationale**: 线性公式可读性强、参数可独立调节。与非线性方案相比，debug 和平衡调整更直观。

### D2: 存活结局——固定权重分配

存活时第二次掷骰，按固定权重选择结局：

| 结局 | 权重 | 归一化概率 |
|------|------|-----------|
| 跌境 | 1 | 25% |
| 重伤 | 1.5 | 37.5% |
| 损失修为 | 1.5 | 37.5% |

**Rationale**: 固定权重比 gap 动态调权更简单，且各结局自身的惩罚力度已通过 gap/level 体现。若后续需要调权，改常量即可。

### D3: 跌境机制

- 降 1 级，修为重置为新级别门槛（`threshold(newLevel)`）
- Lv1 → Lv0：修为置 0
- `maxAge` 不立即变化——由渐进衰减机制处理（见 D7）
- 败者从原级别 `levelGroups` 移除，加入新级别

### D4: 重伤机制

- `Cultivator` 新增 `injuredUntil: number`（默认 0，表示未受伤）
- 受伤时设置 `injuredUntil = currentYear + INJURY_DURATION`（`INJURY_DURATION=5`）
- 效果：`year < injuredUntil` 期间，`naturalCultivation` 增长 ×`INJURY_GROWTH_RATE`(0.5)；`processEncounters` 跳过该修士
- 重伤修士不计入遭遇概率快照 Nk/N
- 受伤年当年：naturalCultivation 已执行（正常增长），但立即退出本轮遭遇阶段

### D5: 损失修为机制

- 修为扣减 `DEFEAT_CULT_LOSS_RATE`(30%)
- 下限为 `threshold(currentLevel)`，不跌级
- 公式：`loser.cultivation = max(threshold(loser.level), round1(loser.cultivation × (1 - DEFEAT_CULT_LOSS_RATE)))`

### D6: 战利品与执行顺序

胜者 loot 公式保持不变，始终基于败者战前修为快照计算。败者的修为扣减与胜者收益独立。

**执行顺序**：先计算 loot → 再应用败者结局。

**PRNG 调用顺序**：胜负判定 → loot(luck) → 死亡掷骰 → 存活结局掷骰。

### D7: 渐进式寿元衰减

跌境后 `maxAge` 不立即下降，而是在 `naturalCultivation` 中逐年衰减：

```
sustainableMaxAge = precomputed per level: [60, 100, 900, 8900, 88900, ...]
if maxAge > sustainableMaxAge(currentLevel):
    decay = (maxAge - sustainableMaxAge(currentLevel)) * LIFESPAN_DECAY_RATE
    maxAge = max(MORTAL_MAX_AGE, round(maxAge - decay))
```

- `LIFESPAN_DECAY_RATE = 0.2`（每年衰减剩余超额的 20%）
- `maxAge` 下限为 `MORTAL_MAX_AGE`(60)
- **不可逆**：重新突破回原境界后 maxAge 照常增加，但已衰减的部分不恢复
- 使用 `Math.round` 保持 maxAge 整数语义

**Rationale**: 修仙体系中"根基崩塌、寿元流逝"是渐进过程，非即死。渐进衰老创造叙事张力——跌境者在与时间赛跑，要么重新修炼弥补，要么在衰老中陨落。

### D8: 每年最多一次战败

- 存活败者从 `levelArrayCache` 中移除（不再被选为对手）
- 存活败者在本轮遍历中不再发起遭遇（使用 Set 记录本轮败者 ID）
- 下一年重置

### D9: 事件编码与文本

- 事件缓冲区第 4 位编码结局：`[0, level, loot, outcomeCode]`，outcomeCode: 0=死亡, 1=跌境, 2=重伤, 3=损失修为
- 事件文本模板：
  - 死亡：`{level}对决，获得机缘{loot}`
  - 跌境：`{level}对决，获得机缘{loot}，败者跌境`
  - 重伤：`{level}对决，获得机缘{loot}，败者重伤`
  - 损失修为：`{level}对决，获得机缘{loot}，败者损失修为`

## Risks / Trade-offs

- **种群膨胀** → 败者存活使淘汰率降低，种群可能持续增长。通过寿元过期（`removeExpired`）和渐进衰老自然对冲。若膨胀过度，可调节 `DEFEAT_BASE_DEATH` 上升或 `YEARLY_NEW` 下降。
- **跌境连锁** → 跌至 Lv0 后无法参战，只能自然修炼，需漫长时间回到 Lv1。渐进衰老使跌境者有一定时间窗口，不会即死。这是预期行为（低阶修士确实难翻身）。
- **重伤堆积** → 大量修士同时处于重伤状态可能导致战斗频率骤降。`INJURY_DURATION=5` 在 1000 人/年补充的规模下影响可控。
- **maxAge 浮点精度** → 渐进衰减使用乘法，maxAge 可能产生小数。使用 `Math.round` 保持整数语义。

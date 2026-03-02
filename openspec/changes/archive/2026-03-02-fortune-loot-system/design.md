## Context

当前战斗结算使用固定比例 `ABSORB_RATE = 0.1`，胜者获得败者修为的 10%。该值硬编码在 `src/constants.ts`，在 `src/engine/combat.ts` 的 `resolveCombat` 中引用。项目已有 `truncatedGaussian` 工具函数（`src/engine/prng.ts`），用于生成截断正态分布随机数（当前用于勇气值生成）。

## Goals / Non-Goals

**Goals:**
- 用"基础机缘 + 浮动机缘"公式替换固定 10% 吸收率
- 引入正态分布运气因子，使战斗收益具有合理随机性
- 保持平均收益与现有系统接近，避免大幅改变模拟平衡
- 复用现有 `truncatedGaussian` 基础设施

**Non-Goals:**
- 不改变战斗触发、对手选择、胜负判定等其他战斗逻辑
- 不引入"机缘"相关的 UI 展示或事件日志
- 不对运气因子做持久化或按修仙者绑定

## Decisions

### 1. 公式结构：基础 + 浮动

```
loot = round1(baseLoot + variableLoot)

baseLoot    = levelBase(loser.level) × LOOT_BASE_RATE
variableLoot = excess × LOOT_VARIABLE_RATE × luck

levelBase(lv) = lv === 0 ? 0 : threshold(lv)
excess        = loser.cultivation - levelBase(loser.level)
luck          = truncatedGaussian(prng, LUCK_MEAN, LUCK_STDDEV, LUCK_MIN, LUCK_MAX)
```

**为什么不用单一随机比例？** 基础 + 浮动的拆分确保每场战斗有保底收益（基础机缘），同时高修为对手提供更大的浮动空间。单一比例乘随机因子会导致击杀刚入阶的弱者时收益过低且波动无意义。

### 2. 常量值选择

| 常量 | 值 | 含义 |
|---|---|---|
| `LOOT_BASE_RATE` | 0.05 | 基础机缘占境界门槛的比例 |
| `LOOT_VARIABLE_RATE` | 0.1 | 超出门槛部分的收益率 |
| `LUCK_MEAN` | 1.0 | 运气均值 |
| `LUCK_STDDEV` | 0.3 | 运气标准差 |
| `LUCK_MIN` | 0 | 运气下限 |
| `LUCK_MAX` | 2.5 | 运气上限（允许大机缘） |

均值情况下各阶段收益与旧 10% 的对比：Lv0(cult=5): 0.5 vs 0.5，Lv1(cult=50): 4.5 vs 5.0，Lv2(cult=500): 45 vs 50。略低但在合理范围内，且运气好时可超过旧值。

### 3. round1 应用于最终结果

`round1` 在 `baseLoot + variableLoot` 求和后统一应用一次，而非分别对两部分取整，避免精度损失累积。

### 4. 前置断言：loser.level >= 1

Lv0 不参与 encounter，公式不应处理 Lv0 输入。在 loot 计算入口添加 `assert(loser.level >= 1)` 作为防御性约束。

### 5. Pre-penalty 快照用于机缘计算

避战失败会扣减 evader.cultivation（× (1 - EVASION_PENALTY)），该扣减影响战斗胜率但 **不影响** 战利品。实现方式：在 evasion penalty 前快照 a/b 的 cultivation，loot 公式使用快照值。

### 6. 事件文本更新

战斗事件从 `吸收修为X` 改为 `获得机缘X`，变量名从 `absorbed` 改为 `loot`。

### 7. 防御性边界处理

- `excess = max(0, loser.cultivation - levelBase(loser.level))`，防御异常状态
- `loot = max(0.1, round1(baseLoot + variableLoot))`，保证最低收益 0.1
- 接受 truncatedGaussian 引入的 PRNG 序列变化（同种子仍完全确定性）

## Risks / Trade-offs

- **模拟方差增大** → 运气因子引入随机性，同种子不同运行结果的方差会增加。但种子固定时结果仍完全确定（PRNG 保证），不影响可重复性。
- **极端运气影响平衡** → `LUCK_MAX = 2.5` 允许罕见情况下获得 2.5 倍浮动收益。通过正态分布截断，P(luck > 2.0) ≈ 0.04%，影响极小。

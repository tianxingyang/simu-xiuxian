## Context

当前 `Cultivator.courage` 为 readonly 属性，创建时从 PRNG 采样 [0, 1)，终身不变。勇气仅在 `resolveCombat` 中用于战斗决策（courage > defeatRate 则战斗），以及 `getSummary` 中用于统计。所有勇气相关数值使用 `round1`（1位小数）。

## Goals / Non-Goals

**Goals:**
- 引入 `effectiveCourage` 函数，基于不对称 U 型曲线动态计算有效勇气值
- 战斗决策和统计面板统一使用有效勇气值
- 勇气精度全局升级为 2 位小数
- 初始勇气范围调整为 [0.01, 1.00]

**Non-Goals:**
- 不修改 `Cultivator` 接口结构（courage 保持 readonly）
- 不引入可配置的曲线参数 UI（P/Ay/Ao 为硬编码常量）
- 不改变战斗决策的比较逻辑（仍为 strict greater-than）

## Decisions

### D1: 纯计算方案 vs 存储方案

**选择**: 纯计算 — `effectiveCourage(c)` 每次调用时实时计算。

**理由**: `courage` 保持 readonly 作为"天性"标记，有效勇气为派生值。无需额外存储，无需修改 `Cultivator` 接口。计算开销极小（一次分支 + 两次乘法），适合在战斗热循环中调用。

**替代方案**: 每年在 `naturalCultivation` 中更新 `courage` 字段 — 需移除 readonly，丢失天性信息。

### D2: effectiveCourage 放置位置

**选择**: `src/constants.ts`，与 `lifespanBonus`、`threshold` 等游戏机制函数并列。

**理由**: constants.ts 已承载所有游戏规则函数，`effectiveCourage` 本质是游戏规则。`Cultivator` 类型从 types.ts 导入，无循环依赖。

### D3: 不对称 U 型曲线实现

**选择**: 分段二次函数，以谷底点 P 为分界。

```
lifeFrac = age / maxAge

t < P:  boost = Ay * (1 - t/P)²       ← 年轻段递减
t >= P: boost = Ao * ((t-P)/(1-P))²   ← 老年段递增

effectiveCourage = min(1, baseCourage + boost)
```

常量值: P=0.3, Ay=0.1, Ao=0.3

**理由**: 分段二次连续光滑，中年段 boost=0（无惩罚），老年端振幅为年轻端 3 倍（不对称）。计算成本为一次分支 + 两次乘法 + 一次加法。

### D4: round2 精度函数

**选择**: 新增 `round2(v)` 函数: `Math.round(v * 100) / 100`。

影响范围:
- 初始 courage 创建: `round2(truncatedGaussian(μ=0.50, σ=0.15, lo=0.01, hi=1.00))`，使用 Box-Muller 变换 + 拒绝采样实现截断正态分布，超出 [0.01, 1.00] 时重新采样而非 clamp，避免边界概率堆积
- `effectiveCourage` 返回值: `round2(min(1, base + boost))`
- `getSummary` 中 courageAvg/courageMedian: 使用 `round2` 替代 `round1`

### D5: 境界提升导致勇气跳变

**选择**: 接受不连续跳变 — 突破后 maxAge 增大，lifeFrac 骤降，有效勇气瞬间变化。

**理由**: 符合叙事设定 — 突破后获得"新生"，心态回归持重。跳变方向始终是勇气下降（lifeFrac 从老年段跳回中年/年轻段），不影响战斗平衡。

### D6: 新生修仙者初始勇气加成

**选择**: 接受全员初始加成 — 所有新生修仙者 age=10, maxAge=60, lifeFrac≈0.167 < P=0.3，获得约 +0.04~0.05 年轻端加成。

**理由**: 加成幅度小，符合"少年轻狂"设定，不显著改变战斗平衡。

### D7: Box-Muller 第二值处理

**选择**: 丢弃第二个正态值 — 每次 `truncatedGaussian` 调用固定消耗 2 次 `prng()`（未被拒绝时），确保 PRNG 消耗模式简单可预测。

**理由**: 缓存第二值需维护闭包状态，增加复杂度。性能差异在初始化阶段可忽略。

### D8: defeatRate 不参与 round2

**选择**: defeatRate = `b.cultivation / (a.cultivation + b.cultivation)` 保持原始浮点值，不经过 round2。

**理由**: effectiveCourage 经 round2 后为精确两位小数，与浮点 defeatRate 做 strict > 比较时语义清晰，不引入额外精度问题。round2 的作用域严格限定在勇气相关数值。

## Risks / Trade-offs

- [统计语义变更] 勇气趋势图从展示"天性分布"变为展示"有效勇气分布"，含寿元加成。用户可能注意到勇气均值不再稳定在 ~0.5 → 接受，这正是机制生效的可观察信号
- [浮点精度] `effectiveCourage` 返回 round2 后参与 strict > 比较，round2 确保值为精确的两位小数，与 defeatRate（浮点除法结果）比较时不会引入额外精度问题
- [境界跳变] 突破时 maxAge 增大导致 lifeFrac 骤降、有效勇气不连续下降 → 接受，符合叙事
- [round2 作用域] round2 仅影响: 初始 courage 存储、effectiveCourage 返回值、getSummary 勇气统计。不影响: cultivation 吸收（round1）、defeatRate 计算、age 统计（round1）

## Why

当前修仙者的勇气值（courage）在创建时从 PRNG 均匀采样后终身不变，无法体现修仙者在不同生命阶段的心态变化。增加"寿元影响勇气"机制，使勇气值随生命阶段动态变化：年轻时略高于天性（少年轻狂）、中年回归天性（持重求稳）、大限将至时显著提升（老来无畏）。该设定通过不对称 U 型曲线实现，同时将勇气精度从一位小数提升至两位小数、初始范围从 [0, 1) 调整为 [0.01, 1.00]。

## What Changes

- 新增 `effectiveCourage(c: Cultivator)` 函数，基于分段二次曲线计算有效勇气值：以 `lifeFrac = age / maxAge` 为输入，谷底点 P=0.3，年轻端振幅 Ay=0.1，老年端振幅 Ao=0.3
- 战斗决策（`resolveCombat`）中 `a.courage` / `b.courage` 替换为 `effectiveCourage(a)` / `effectiveCourage(b)`
- 统计面板（`getSummary`）中勇气相关统计改为使用有效勇气值
- 全局勇气精度从 `round1`（1位小数）改为 `round2`（2位小数）
- 修仙者创建时初始勇气值从均匀分布 `prng()` → [0, 1) 改为截断正态分布 `round2(truncatedGaussian(μ=0.50, σ=0.15, lo=0.01, hi=1.00))` → [0.01, 1.00]，超出范围时重新采样而非 clamp
- `Cultivator.courage` 保持 `readonly`，作为"天性勇气"；`effectiveCourage` 为运行时计算的"有效勇气"

## Capabilities

### New Capabilities
- `lifespan-courage`: 寿元影响勇气的不对称 U 型曲线机制，包含 `effectiveCourage` 计算函数和相关常量（P、Ay、Ao）

### Modified Capabilities
- `encounter-combat`: 战斗决策从读取 `courage` 改为使用 `effectiveCourage`，战斗意愿随生命阶段动态变化
- `level-stats`: 勇气统计（courageAvg、courageMedian）改为基于有效勇气值计算，精度从 round1 改为 round2
- `simulation-loop`: 修仙者创建时初始勇气值范围从 [0, 1) 改为 [0.01, 1.00]，精度改为 round2

## Impact

- `src/constants.ts`: 新增 `round2()` 函数、`effectiveCourage()` 函数及常量 P/Ay/Ao
- `src/types.ts`: 无变更（courage 保持 readonly）
- `src/engine/combat.ts`: `resolveCombat` 中勇气读取改为 `effectiveCourage` 调用
- `src/engine/simulation.ts`: `spawnCultivators` 初始勇气范围调整；`getSummary` 勇气统计改用 `effectiveCourage` 和 `round2`

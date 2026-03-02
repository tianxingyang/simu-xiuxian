## Why

当前战败致死率使用线性公式 `0.7 - 0.09 × level`，导致 Lv1 均势致死率高达 61%。设计上自然修炼无法突破结丹（80 年可用时间 vs 90 修为需求），战斗是唯一晋升路径，但 61% 的致死率使得多次战斗的累积存活率指数衰减（6 场仅 11%），结丹通过率极低。此外，gap 影响采用加性设计（±0.3），导致高阶修士在大差距战斗中致死率不合理地飙升（大乘 gap=0.5 时 22%）。

## What Changes

- 致死率基础曲线从线性 `BASE - PROTECTION × level` 替换为指数 `BASE × DECAY^level`，常量改为 `DEFEAT_DEATH_BASE=0.40`、`DEFEAT_DEATH_DECAY=0.72`
- gap 影响从加性 `+ SEVERITY × gap` 改为乘性 `× (1 + SEVERITY × gap)`，`DEFEAT_GAP_SEVERITY` 保持 0.3 不变但语义改变
- 移除不再需要的常量 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION`、`DEFEAT_MIN_DEATH`（指数公式天然正值，无需下限 clamp）
- **BREAKING**: Lv1 均势致死率从 61% 降至约 30%，整体种群动态将显著变化

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `combat-defeat-outcomes`: 致死率计算公式从线性改为指数，gap 影响从加性改为乘性，相关常量替换

## Impact

- `src/constants.ts`: 替换 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION` 为 `DEFEAT_DEATH_BASE`、`DEFEAT_DEATH_DECAY`；移除 `DEFEAT_MIN_DEATH`
- `src/engine/combat.ts`: `resolveDefeatOutcome` 函数中致死率计算逻辑重写
- `openspec/specs/combat-defeat-outcomes/spec.md`: 更新致死率公式规格与场景验证值

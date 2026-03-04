## Why

当前模拟中境界分布完全由修为阈值、战斗动态、寿元系统涌现决定，缺乏直接的分布控制机制。现有系统中高境界修仙者死亡率低（`0.40 × 0.72^level`）、寿元长，导致高境界人口占比偏高，无法形成符合修仙世界观的陡峭金字塔结构。需要引入"突破概率门"机制，通过参数化公式 `w_k = e^{-(a·k + b·k²)}` 精确控制稳态分布，使其在统计学上匹配目标比例。

## What Changes

- 新增突破概率门机制：Lv1+ 修仙者修为达到下一境界阈值后，不再自动升级，改为每年尝试突破，按概率判定成功/失败
- Lv0→Lv1 保持自动升级（凡人入道无门槛）
- 突破失败触发随机惩罚：冷却期（3年不可再试）、修为损失（22.2%）、受伤（22.2%）
- 新增分布控制参数 `a=0.6`、`b=0.15`，通过公式计算各境界突破成功率
- Cultivator 新增 `breakthroughCooldownUntil` 字段，记录突破冷却状态

## Capabilities

### New Capabilities
- `breakthrough-gate`: 突破概率门机制，包括成功率计算（基于 a/b 参数的指数衰减公式）、突破尝试判定、失败惩罚（冷却/修为损失/受伤）、事件产生与统计计数的完整逻辑

### Modified Capabilities
- `cultivation-levels`: 升级规则从"修为达标自动升级"改为"修为达标 + 突破概率判定"，Lv0→Lv1 保持自动升级

## Impact

- `src/constants.ts`：新增突破相关常量（a, b, 成功率函数, 失败惩罚权重等）
- `src/types.ts`：Cultivator 接口新增 `breakthroughCooldownUntil` 字段
- `src/engine/simulation.ts`：`tickCultivators` 中的自动升级逻辑改为突破判定流程
- `src/engine/combat.ts`：战斗胜利后的自动升级逻辑同步修改

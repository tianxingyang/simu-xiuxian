## Why

当前战斗系统中，只要遭遇双方有一方勇气判定通过（想打），另一方就被强制拉入战斗，无法脱身。这导致高修为但性格谨慎的修仙者缺乏生存策略——即使实力远超对手，也无法选择回避无意义的战斗。引入避战机制，让不想打的一方可以根据修为差尝试逃脱，丰富生态中的行为多样性。

## What Changes

- 在 `resolveCombat` 的勇气判定与战斗结算之间插入避战阶段：当恰好一方想打、一方不想打时，不想打的一方（evader）进行避战概率判定
- 避战概率公式：`P = clamp(0.5 + EVASION_SENSITIVITY × gap, 0, 1)`，其中 `gap = (evader.cult - attacker.cult) / (evader.cult + attacker.cult)`
- 避战成功：无战斗、无代价
- 避战失败：evader 扣除自身修为的 5% 后进入正常战斗流程
- 避战为静默机制，不产生事件日志
- 双方都想打或双方都不想打时，行为不变

## Capabilities

### New Capabilities
- `combat-evasion`: 避战概率计算与失败惩罚机制，包含 `EVASION_SENSITIVITY`、`EVASION_PENALTY` 常量及避战判定逻辑

### Modified Capabilities
- `encounter-combat`: 战斗决策流程新增避战阶段——在"一方想打一方不想打"分支中，不想打的一方触发避战判定，成功则取消战斗，失败则扣除修为后继续战斗

## Impact

- `src/constants.ts`: 新增 `EVASION_SENSITIVITY = 0.5` 和 `EVASION_PENALTY = 0.05` 常量
- `src/engine/combat.ts`: `resolveCombat` 函数中勇气判定后、战斗结算前插入避战逻辑

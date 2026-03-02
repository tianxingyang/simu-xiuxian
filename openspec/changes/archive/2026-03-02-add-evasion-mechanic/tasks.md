## 1. 常量定义

- [x] 1.1 `src/constants.ts`: 新增 `EVASION_SENSITIVITY = 0.5` 常量
- [x] 1.2 `src/constants.ts`: 新增 `EVASION_PENALTY = 0.05` 常量

## 2. 避战逻辑实现

- [x] 2.1 `src/engine/combat.ts`: 在 `resolveCombat` 中，现有双方怯战 return 之后、胜负决定之前，新增避战分支：判断是否恰好一方想打一方不想打，确定 attacker/evader 角色
- [x] 2.2 `src/engine/combat.ts`: 实现避战概率计算 `P = clamp(0.5 + EVASION_SENSITIVITY × gap, 0, 1)`，其中 `gap = (evader.cultivation - attacker.cultivation) / (evader.cultivation + attacker.cultivation)`；P=0 直接失败、P=1 直接成功（不消耗 prng()），否则 `prng() < P` 判定
- [x] 2.3 `src/engine/combat.ts`: 避战成功时直接 return，不修改任何引擎状态（combatDeaths、promotionCounts、事件缓冲区、levelGroups）
- [x] 2.4 `src/engine/combat.ts`: 避战失败时执行 `penalized = round1(evader.cultivation * (1 - EVASION_PENALTY))`，钳位 `evader.cultivation = max(threshold(evader.level), penalized)`，重算 `total = attacker.cultivation + evader.cultivation` 后继续战斗

## 3. Spec 归档

- [x] 3.1 `openspec/specs/encounter-combat/spec.md`: 合并 modified Combat decision 需求（避战分支替代原"一方想打即开战"逻辑）
- [x] 3.2 `openspec/specs/combat-evasion/spec.md`: 新建 spec 文件，写入避战概率、失败惩罚、静默机制、常量定义四项需求

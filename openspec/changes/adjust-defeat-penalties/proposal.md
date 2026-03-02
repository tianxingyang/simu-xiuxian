## Why

当前战败结局中跌境概率过高（25%），导致结丹期修士频繁跌境，形成"旋转门"效应，使得结丹期人数极少。跌境应该是极其罕见的灾难性事件（~1%），而非常规战败结果。同时，战败惩罚层次不够丰富，缺少轻度和中度惩罚选项。

## What Changes

- 将跌境概率从 25% 大幅降低至 1%，使其成为极罕见的灾难性事件
- 新增**轻伤**机制：短期修炼减速（2年，修为增长×0.7），占存活结局 40%
- 新增**经脉受损**机制：长期战力削弱（10年，战斗时修为按 70% 计算），占存活结局 10%
- 调整现有惩罚权重：重伤 29%，损失修为 20%
- 重新平衡战败结局分布，形成清晰的严重程度梯度：死亡 > 跌境 > 经脉受损 > 重伤 > 损失修为 > 轻伤

## Capabilities

### New Capabilities
- `light-injury`: 轻伤机制——战败后短期修炼减速（2年恢复期，期间修为增长×0.7）
- `meridian-damage`: 经脉受损机制——战败后长期战力削弱（10年恢复期，期间战斗时修为按 70% 计算）

### Modified Capabilities
- `combat-defeat-outcomes`: 调整战败结局权重分配，将跌境概率从 25% 降至 1%，重新平衡所有存活结局的概率分布

## Impact

- `src/types.ts`: `Cultivator` 接口新增 `lightInjuryUntil: number` 和 `meridianDamagedUntil: number` 字段
- `src/constants.ts`: 修改 `DEFEAT_DEMOTION_W` 从 1 降至 0.1；修改 `DEFEAT_INJURY_W` 从 1.5 降至 2.9；修改 `DEFEAT_CULT_LOSS_W` 从 1.5 降至 2.0；新增 `DEFEAT_LIGHT_INJURY_W = 4.0`、`DEFEAT_MERIDIAN_W = 1.0`、`LIGHT_INJURY_DURATION = 2`、`LIGHT_INJURY_GROWTH_RATE = 0.7`、`MERIDIAN_DAMAGE_DURATION = 10`、`MERIDIAN_COMBAT_PENALTY = 0.3`
- `src/engine/combat.ts`: `resolveDefeatOutcome` 函数新增轻伤和经脉受损结局判定；`resolveCombat` 函数在战斗力计算时考虑经脉受损状态
- `src/engine/simulation.ts`: `naturalCultivation` 函数处理轻伤状态的修炼减速；`spawnCultivators` 初始化新字段
- `src/types.ts`: `YearSummary` 接口新增 `combatLightInjuries: number` 和 `combatMeridianDamages: number` 字段
- `src/components/StatsPanel.tsx`: 展示新的战败结局统计

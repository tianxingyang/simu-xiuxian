## Why

当前战斗失败的唯一结局是死亡（`loser.alive = false`），惩罚过于严重且缺乏层次感。修仙世界中，战败结局应当多元化——实力差距、境界高低、运气都会影响战败者的命运。低阶修士命如蝼蚁，战败即死；高阶修士保命手段丰富，更可能重伤逃走或跌境。引入多元战败结局可以丰富模拟动态，使种群演化更合理。

## What Changes

- 战败后根据实力差距、境界、随机因素，决定四种结局之一：**死亡**、**跌境**（降一级 + 修为大幅扣减）、**重伤**（禁战期 + 修炼减速）、**损失修为**（扣一部分修为，最轻后果）
- 境界越高，存活类结局概率越大；实力差距越大，严重结局概率越大
- `Cultivator` 新增 `injuredUntil` 字段，标记重伤恢复截止年份
- 重伤期间：不参与遭遇阶段，每年修为增长减半，不计入遭遇概率快照
- 跌境后 `maxAge` 渐进式衰减（每年衰减超额寿元的 20%），不可逆，模拟"根基崩塌、寿元流逝"
- 战败存活者不再被 `purgeDead` 移除，保留在模拟中继续演化
- 每年每个修士最多战败一次
- 胜者的战利品（loot）公式保持不变，仍基于败者战前修为计算
- `YearSummary` 新增战败结局统计字段，UI 同步展示

## Capabilities

### New Capabilities
- `combat-defeat-outcomes`: 战败结局判定系统——根据实力差距、境界、随机因素选择死亡/跌境/重伤/损失修为四种结局，渐进式寿元衰减，以及重伤状态的禁战和修炼减速机制

### Modified Capabilities
- `encounter-combat`: Combat resolution 中败者不再一律死亡，改为调用结局判定；遭遇阶段须跳过重伤修士且不计入快照；存活败者从候选池移除
- `simulation-loop`: `naturalCultivation` 须对重伤修士减半修为增长并执行 maxAge 渐进衰减；`Cultivator` 类型新增 `injuredUntil` 字段
- `dashboard`: `YearSummary` 新增战败结局计数器，UI 展示跌境/重伤/损失修为统计

## Impact

- `src/types.ts`: `Cultivator` 接口新增 `injuredUntil` 字段；`YearSummary` 新增 `combatDemotions`/`combatInjuries`/`combatCultLosses` 字段
- `src/engine/combat.ts`: `resolveCombat` 函数重构——败者结局判定逻辑替代原有的直接死亡；`processEncounters` 跳过重伤修士并排除快照计数
- `src/engine/simulation.ts`: `naturalCultivation` 增加重伤减速和 maxAge 渐进衰减逻辑；`spawnCultivators` 初始化新字段；`getSummary` 统计新计数器
- `src/constants.ts`: 新增结局概率、渐进衰减相关常量
- `src/components/StatsPanel.tsx`: 展示新统计字段

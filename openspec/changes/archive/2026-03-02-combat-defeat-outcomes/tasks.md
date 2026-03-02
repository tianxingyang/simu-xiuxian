## 1. 类型与常量

- [x] 1.1 `src/types.ts`: `Cultivator` 接口新增 `injuredUntil: number` 字段
- [x] 1.2 `src/types.ts`: `YearSummary` 接口新增 `combatDemotions: number`, `combatInjuries: number`, `combatCultLosses: number` 字段
- [x] 1.3 `src/constants.ts`: 新增战败结局常量（`DEFEAT_BASE_DEATH`, `DEFEAT_LEVEL_PROTECTION`, `DEFEAT_GAP_SEVERITY`, `DEFEAT_MIN_DEATH`, `DEFEAT_MAX_DEATH`, `DEFEAT_DEMOTION_W`, `DEFEAT_INJURY_W`, `DEFEAT_LOSS_W`, `DEFEAT_CULT_LOSS_RATE`, `INJURY_DURATION`, `INJURY_GROWTH_RATE`, `LIFESPAN_DECAY_RATE`）
- [x] 1.4 `src/constants.ts`: 新增 `sustainableMaxAge` 预计算数组和/或函数

## 2. 模拟引擎——初始化与生命周期

- [x] 2.1 `src/engine/simulation.ts`: `spawnCultivators` 中初始化 `injuredUntil = 0`（含对象池回收路径）
- [x] 2.2 `src/engine/simulation.ts`: `naturalCultivation` 增加重伤减速逻辑——`injuredUntil > this.year` 时修为增长 ×0.5
- [x] 2.3 `src/engine/simulation.ts`: `naturalCultivation` 增加 maxAge 渐进衰减逻辑——`maxAge > sustainableMaxAge[level]` 时每年衰减 20%
- [x] 2.4 `src/engine/simulation.ts`: `resetYearCounters` 重置新增计数器（`combatDemotions`, `combatInjuries`, `combatCultLosses`）
- [x] 2.5 `src/engine/simulation.ts`: `getSummary` 返回新增统计字段

## 3. 战斗系统——战败结局

- [x] 3.1 `src/engine/combat.ts`: 新增 `resolveDefeatOutcome` 函数——使用战前快照计算 gap 和 deathChance，掷骰决定死亡/跌境/重伤/损失修为，返回结局类型
- [x] 3.2 `src/engine/combat.ts`: 实现跌境逻辑——降 1 级、重置修为至 threshold(newLevel)、更新 levelGroups（maxAge 不变）
- [x] 3.3 `src/engine/combat.ts`: 实现重伤逻辑——设置 `injuredUntil = engine.year + INJURY_DURATION`
- [x] 3.4 `src/engine/combat.ts`: 实现损失修为逻辑——扣减 30% 修为，下限为 threshold(currentLevel)
- [x] 3.5 `src/engine/combat.ts`: `resolveCombat` 重构——先算 loot → 再调用 resolveDefeatOutcome → 仅死亡结局设置 `alive = false`；存活败者从 levelArrayCache 移除并加入 defeatedSet
- [x] 3.6 `src/engine/combat.ts`: `combatDeaths` 仅在死亡结局递增；新增 `combatDemotions`/`combatInjuries`/`combatCultLosses` 计数器递增

## 4. 遭遇阶段——重伤/败者跳过与快照排除

- [x] 4.1 `src/engine/combat.ts`: `processEncounters` 构建快照 Nk/N 时排除重伤修士
- [x] 4.2 `src/engine/combat.ts`: `processEncounters` 构建 levelArrayCache 时排除重伤修士
- [x] 4.3 `src/engine/combat.ts`: `processEncounters` 遍历 aliveIds 时，在 alive 检查后跳过重伤修士和本轮败者（不消耗 PRNG）
- [x] 4.4 `src/engine/combat.ts`: 新增 defeatedSet（本轮败者 ID 集合），每轮初始化清空

## 5. 事件文本

- [x] 5.1 `src/engine/combat.ts`: 事件缓冲区第 4 位编码 outcomeCode（0=死亡, 1=跌境, 2=重伤, 3=损失修为）
- [x] 5.2 `src/engine/combat.ts`: `materialize` 函数根据 outcomeCode 生成区分四种结局的事件文本

## 6. UI 展示

- [x] 6.1 `src/types.ts`: 确认 `FromWorker` 类型兼容新增 `YearSummary` 字段
- [x] 6.2 `src/components/StatsPanel.tsx`: 展示跌境/重伤/损失修为统计

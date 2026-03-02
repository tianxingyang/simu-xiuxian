## 1. 类型定义

- [x] 1.1 `src/types.ts`: `Cultivator` 接口新增 `lightInjuryUntil: number` 字段
- [x] 1.2 `src/types.ts`: `Cultivator` 接口新增 `meridianDamagedUntil: number` 字段
- [x] 1.3 `src/types.ts`: `YearSummary` 接口新增 `combatLightInjuries: number` 字段
- [x] 1.4 `src/types.ts`: `YearSummary` 接口新增 `combatMeridianDamages: number` 字段

## 2. 常量定义

- [x] 2.1 `src/constants.ts`: 修改 `DEFEAT_DEMOTION_W` 从 1 改为 0.1
- [x] 2.2 `src/constants.ts`: 修改 `DEFEAT_INJURY_W` 从 1.5 改为 2.9
- [x] 2.3 `src/constants.ts`: 修改 `DEFEAT_CULT_LOSS_W` 从 1.5 改为 2.0
- [x] 2.4 `src/constants.ts`: 新增 `DEFEAT_LIGHT_INJURY_W = 4.0`
- [x] 2.5 `src/constants.ts`: 新增 `DEFEAT_MERIDIAN_W = 1.0`
- [x] 2.6 `src/constants.ts`: 新增 `LIGHT_INJURY_DURATION = 2`
- [x] 2.7 `src/constants.ts`: 新增 `LIGHT_INJURY_GROWTH_RATE = 0.7`
- [x] 2.8 `src/constants.ts`: 新增 `MERIDIAN_DAMAGE_DURATION = 10`
- [x] 2.9 `src/constants.ts`: 新增 `MERIDIAN_COMBAT_PENALTY = 0.3`

## 3. 战斗结局判定

- [x] 3.1 `src/engine/combat.ts`: 修改 `resolveDefeatOutcome` 函数，更新权重总和计算（包含5种结局）
- [x] 3.2 `src/engine/combat.ts`: 修改 `resolveDefeatOutcome` 函数，新增轻伤结局判定（返回值 6）
- [x] 3.3 `src/engine/combat.ts`: 修改 `resolveDefeatOutcome` 函数，新增经脉受损结局判定（返回值 5）
- [x] 3.4 `src/engine/combat.ts`: 修改 `resolveDefeatOutcome` 函数，调整判定顺序（轻伤→重伤→损失修为→经脉受损→跌境）

## 4. 战斗结局应用

- [x] 4.1 `src/engine/combat.ts`: `resolveCombat` 函数新增轻伤结局处理（outcome === 6）
- [x] 4.2 `src/engine/combat.ts`: `resolveCombat` 函数新增经脉受损结局处理（outcome === 5）
- [x] 4.3 `src/engine/combat.ts`: 新增 `combatLightInjuries` 计数器递增
- [x] 4.4 `src/engine/combat.ts`: 新增 `combatMeridianDamages` 计数器递增

## 5. 经脉受损战力削弱

- [x] 5.1 `src/engine/combat.ts`: `resolveCombat` 函数在战斗力计算前检查双方经脉受损状态
- [x] 5.2 `src/engine/combat.ts`: 对经脉受损修士应用战力削弱（×0.7）
- [x] 5.3 `src/engine/combat.ts`: 确保 loot 计算仍基于原始修为（不受经脉受损影响）

## 6. 轻伤修炼减速

- [x] 6.1 `src/engine/simulation.ts`: `naturalCultivation` 函数新增轻伤状态检查
- [x] 6.2 `src/engine/simulation.ts`: 实现修炼速率优先级逻辑（重伤 > 轻伤 > 正常）
- [x] 6.3 `src/engine/simulation.ts`: 轻伤期间修为增长 ×0.7

## 7. 修士初始化

- [x] 7.1 `src/engine/simulation.ts`: `spawnCultivators` 函数初始化 `lightInjuryUntil = 0`（新建路径）
- [x] 7.2 `src/engine/simulation.ts`: `spawnCultivators` 函数初始化 `lightInjuryUntil = 0`（对象池复用路径）
- [x] 7.3 `src/engine/simulation.ts`: `spawnCultivators` 函数初始化 `meridianDamagedUntil = 0`（新建路径）
- [x] 7.4 `src/engine/simulation.ts`: `spawnCultivators` 函数初始化 `meridianDamagedUntil = 0`（对象池复用路径）

## 8. 统计数据

- [x] 8.1 `src/engine/simulation.ts`: `SimulationEngine` 类新增 `combatLightInjuries` 计数器字段
- [x] 8.2 `src/engine/simulation.ts`: `SimulationEngine` 类新增 `combatMeridianDamages` 计数器字段
- [x] 8.3 `src/engine/simulation.ts`: `resetYearCounters` 函数重置 `combatLightInjuries = 0`
- [x] 8.4 `src/engine/simulation.ts`: `resetYearCounters` 函数重置 `combatMeridianDamages = 0`
- [x] 8.5 `src/engine/simulation.ts`: `getSummary` 函数返回 `combatLightInjuries` 统计
- [x] 8.6 `src/engine/simulation.ts`: `getSummary` 函数返回 `combatMeridianDamages` 统计

## 9. 事件编码

- [x] 9.1 `src/engine/combat.ts`: 更新 `OUTCOME_SUFFIX` 数组，新增经脉受损和轻伤的文本后缀
- [x] 9.2 `src/engine/combat.ts`: 确保事件缓冲区正确编码 outcomeCode（5=经脉受损, 6=轻伤）

## 10. UI 展示

- [x] 10.1 `src/components/StatsPanel.tsx`: 展示 `combatLightInjuries` 统计
- [x] 10.2 `src/components/StatsPanel.tsx`: 展示 `combatMeridianDamages` 统计

## 11. 测试验证

- [x] 11.1 运行模拟，验证跌境概率约为 1%（存活结局中）
- [x] 11.2 运行模拟，验证轻伤概率约为 40%（存活结局中）
- [x] 11.3 运行模拟，验证经脉受损概率约为 10%（存活结局中）
- [x] 11.4 验证轻伤修士修炼速度为正常的 70%
- [x] 11.5 验证经脉受损修士战力为正常的 70%
- [x] 11.6 验证经脉受损不影响修炼速度
- [x] 11.7 验证轻伤不影响战斗参与
- [x] 11.8 验证重伤优先级高于轻伤（同时存在时）

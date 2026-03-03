## Why

V8 CPU Profile 显示 `processEncounters` 占总 CPU 时间 69.3%，其中 combatLoop 占 93.6%。根因是 `combat.ts:90-109` 热循环中每 tick 对 ~20k 修仙者执行约 40k-60k 次 `Map.get()` 查询。`Map` 的 hash lookup 在高频调用下远慢于数组下标直接访问，是当前最大的性能瓶颈。

## What Changes

- 将 `cultivators: Map<number, Cultivator>` 替换为密集数组 `Cultivator[]`，ID 即为数组下标，实现 O(1) 直接访问
- 引入 free list 管理死亡修仙者的数组槽位回收与复用
- 将 `levelGroups`、`aliveLevelIds`、`levelArrayCache` 从 `Map<number, X>` 改为固定长度数组 `X[]`（按 level 索引，0-7）
- `purgeDead()` 从全量 Map 遍历改为仅处理死亡 ID 列表
- `combat.ts` 中所有 `engine.cultivators.get(id)!` 改为 `engine.cultivators[id]`
- 所有 `engine.levelGroups.get(level)!` 改为 `engine.levelGroups[level]`
- 公共 API（`tickYear()`、`getSummary()`、`reset()`）签名和返回值不变

## Capabilities

### New Capabilities

- `dense-storage`: 基于密集数组 + free list 的修仙者存储引擎，替代 Map 实现 O(1) 下标访问

### Modified Capabilities

- `simulation-loop`: `SimulationEngine` 内部存储结构变更，`spawnCultivators`/`purgeDead`/`reset` 适配新的数组存储
- `encounter-combat`: `processEncounters` 和 `resolveCombat` 中所有数据访问路径从 Map.get() 改为数组下标

## Impact

- `src/engine/simulation.ts`: 核心数据结构重构，所有字段访问模式变更
- `src/engine/combat.ts`: 全部 `engine.cultivators.get()` 和 `engine.levelGroups.get()` 调用替换
- `src/engine/worker.ts`: 无变更（仅调用 `tickYear`/`getSummary` 等公共 API）
- 前端组件: 无变更
- 性能目标: `tickYear` 从 ~11ms/year 降至 ~5ms/year（降幅 40-60%）

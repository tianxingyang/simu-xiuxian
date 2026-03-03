## 1. SimulationEngine 数据结构迁移

- [x] 1.1 移除 `_pool: Cultivator[]` 字段及所有引用
- [x] 1.2 将 `cultivators: Map<number, Cultivator>` 替换为 `cultivators: Cultivator[]`，新增 `freeSlots: number[]`、`aliveCount: number`（初始 0）、`_deadIds: number[]`；`nextId` 初始值改为 0
- [x] 1.3 将 `levelGroups`、`aliveLevelIds`、`levelArrayCache` 从 `Map<number, X>` 改为固定长度数组 `X[]`（`initLevelGroups` / `initLevelArrayCache` 返回数组而非 Map）
- [x] 1.4 重写 `spawnCultivators()`：优先 `freeSlots.pop()` 就地重初始化 `cultivators[id]` 已有对象的全部字段（含 readonly courage 类型断言）；仅在 freeSlots 为空时 `nextId++` 创建新对象字面量；每次 `aliveCount++`；`levelGroups[0].add(id)` / `aliveLevelIds[0].add(id)`
- [x] 1.5 重写 `purgeDead()`：遍历 `_deadIds`，对每个 id 执行 `freeSlots.push(id)`；完成后 `_deadIds.length = 0`。不扫描全数组、不操作 pool
- [x] 1.6 更新 `tickCultivators()`：遍历 `for (let i = 0; i < this.nextId; i++)` 跳过 `!alive`；寿尽死亡时同时 `this.aliveCount--` 和 `this._deadIds.push(c.id)`；所有 `.get(level)!` 改为 `[level]`
- [x] 1.7 更新 `getSummary()`：遍历 cultivators 数组（`for (let i = 0; i < this.nextId; i++)`）替代 `Map.values()`
- [x] 1.8 更新 `tickYear()`：灭绝检测从 `this.cultivators.size === 0` 改为 `this.aliveCount === 0`；`resetYearCounters` 中增加 `this._deadIds.length = 0`
- [x] 1.9 更新 `reset()`：`cultivators.length = 0`、`freeSlots.length = 0`、`_deadIds.length = 0`、`nextId = 0`、`aliveCount = 0`；levelGroups/aliveLevelIds/levelArrayCache 重新初始化为数组；移除 `_pool` 相关清理

## 2. 战斗系统适配

- [x] 2.1 更新 `processEncounters()` buildCache 阶段：`for (let level = 0; level < LEVEL_COUNT; level++)` 遍历 `engine.levelGroups[level]`；`engine.levelArrayCache[level]` 替代 `.get(level)!`；`engine.cultivators[id]` 替代 `.get(id)!`
- [x] 2.2 更新 `processEncounters()` buildAliveIds 阶段：`engine.aliveLevelIds[level]` 替代 `.get(level)!`
- [x] 2.3 更新 `processEncounters()` combatLoop：`engine.cultivators[id]` 替代 `.get(id)!`；`engine.levelArrayCache[c.level]` 替代 `.get(c.level)`
- [x] 2.4 更新 `resolveCombat()`：所有 `engine.levelGroups[x]` 替代 `.get(x)!`；所有 `engine.aliveLevelIds[x]` 替代 `.get(x)!`；`engine.levelArrayCache[x]` 替代 `.get(x)`；战斗死亡时增加 `engine.aliveCount--` 和 `engine._deadIds.push(loser.id)`

## 3. 验证

- [x] 3.1 确定性验证：以相同 seed 和 initialPop 运行 1000 年，逐年对比迁移前后 `getSummary()` 所有字段完全一致（totalPopulation, levelCounts, deaths, promotions 等全部数值型字段零容差），确保无行为回归
- [x] 3.2 运行 `test/profile.ts`，确认 tickYear 平均耗时 ≤ 7ms/year（稳态 20k 种群），目标 ~5ms
- [x] 3.3 不变量断言：在测试中验证 `aliveCount === actual count`、`freeSlots ⊂ dead slots`、`cultivators.length === nextId`、`sum(levelGroups) === aliveCount`

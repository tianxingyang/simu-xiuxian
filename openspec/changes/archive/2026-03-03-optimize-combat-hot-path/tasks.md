## 1. 数据结构基础设施

- [x] 1.1 `src/constants.ts` — 新增 `THRESHOLDS` 常量数组 `[Infinity, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]`，将 `threshold()` 改为 `return THRESHOLDS[level]`
- [x] 1.2 `src/types.ts` — `Cultivator` 接口新增 `cachedCourage: number` 字段
- [x] 1.3 `src/engine/simulation.ts` — `SimulationEngine` 新增 `_defeatedBuf: Uint8Array` 和 `_levelArrayIndex: Int32Array` 属性，constructor 中以 `nextId` 为初始容量分配，reset 中重新分配

## 2. tickCultivators / spawnCultivators 改造

- [x] 2.1 `src/engine/simulation.ts` — `spawnCultivators` 中为新创建和复用 slot 的 cultivator 均计算并赋值 `cachedCourage = effectiveCourage(c)`
- [x] 2.2 `src/engine/simulation.ts` — `tickCultivators` 中 age 增加后立即计算并更新 `c.cachedCourage = effectiveCourage(c)`

## 3. processEncounters 热路径优化

- [x] 3.0 `src/engine/combat.ts` — `processEncounters` 入口处检查 buffer 容量：若 `engine.nextId > engine._defeatedBuf.length`，reallocate `_defeatedBuf = new Uint8Array(engine.nextId)` 和 `_levelArrayIndex = new Int32Array(engine.nextId)`
- [x] 3.1 `src/engine/combat.ts` — 容量检查后 `engine._defeatedBuf.fill(0)` 替代 `new Set<number>()`
- [x] 3.2 `src/engine/combat.ts` — buildCache 阶段先 `engine._levelArrayIndex.fill(-1)` 重置哨兵，然后填充 `levelArrayCache` 时同步更新 `engine._levelArrayIndex[id] = position`
- [x] 3.3 `src/engine/combat.ts` — buildCache 完成后、`snapshotN === 0` 提前返回之后，预计算 `encounterThresholds[level] = snapshotNk[level] / snapshotN`
- [x] 3.4 `src/engine/combat.ts` — combatLoop 中将 `defeatedSet.has(id)` 替换为 `engine._defeatedBuf[id]`，将 `prng() >= nk / snapshotN` 替换为 `prng() >= encounterThresholds[c.level]`
- [x] 3.5 `src/engine/combat.ts` — `resolveCombat` 中将 `effectiveCourage(a)` / `effectiveCourage(b)` 替换为 `a.cachedCourage` / `b.cachedCourage`
- [x] 3.6 `src/engine/combat.ts` — `resolveCombat` 中将 `arr.indexOf(loser.id)` 替换为 `engine._levelArrayIndex[loser.id]`，swap-remove 后更新被移动元素的索引 `engine._levelArrayIndex[movedId] = removedPosition`，并设置 `engine._levelArrayIndex[loser.id] = -1`
- [x] 3.7 `src/engine/combat.ts` — `resolveCombat` 中将 `defeatedSet.add(loser.id)` 替换为 `engine._defeatedBuf[loser.id] = 1`，移除 `defeatedSet` 参数
- [x] 3.8 `src/engine/combat.ts` — `resolveCombat` 胜者晋升 while-loop 之后，若 `winner.level !== prevLevel`，刷新 `winner.cachedCourage = effectiveCourage(winner)`

## 4. 验证

- [x] 4.1 运行 `src/engine/benchmark.ts`，对比优化前后的 profiler 输出，确认 processEncounters 耗时下降 ≥ 50%
- [x] 4.2 使用相同 seed=42 运行 1000 年，逐年比较完整 `YearSummary`（totalPopulation、levelCounts、combatDeaths、expiryDeaths、promotions、combatDemotions、combatInjuries、combatCultLosses、combatLightInjuries、combatMeridianDamages），全部字段一致方可通过

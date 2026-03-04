## Context

`processEncounters` 占单 tick 92.3% 耗时（median 8.75ms，pop ~20k）。V8 CPU Profile 显示 combatLoop 自耗时 72.7%，`resolveCombat` 9.8%，`threshold()` 3.7%。微基准测试确认 `Set.has` 比 `Uint8Array` 索引慢 16.4 倍。当前实现大量使用 `Set<number>` 做 membership 检查和增删，以及运行时指数运算，导致常数因子过高。

受影响文件：`src/engine/combat.ts`、`src/engine/simulation.ts`、`src/constants.ts`、`src/types.ts`。

## Goals / Non-Goals

**Goals:**
- 将 `processEncounters` 单 tick 耗时降低 50% 以上（目标 < 4ms @ 20k pop）
- 保持模拟行为完全一致（相同 seed 产生相同结果序列）
- 零 UI / Worker 通信层影响

**Non-Goals:**
- 不改变 PRNG 序列（不引入跳过或重排 prng 调用的变更）
- 不改变 Cultivator 对象的整体存储布局（SoA 重构留给后续）
- 不优化 `getSummary` 中的 median 排序（不在本次范围内）

## Decisions

### D1: defeatedSet → Uint8Array 位标记

**选择**: 用 `Uint8Array(engine.nextId)` 替代 `new Set<number>()`，按 cultivator id 直接索引。

**理由**: combatLoop 每 tick 对 ~15-20k alive id 调用 `defeatedSet.has(id)`。微基准测试显示 `Set.has` vs `Uint8Array[]` 为 16.4:1。Uint8Array 通过连续内存 + 直接偏移实现 O(1) 无哈希查询。

**备选方案**:
- `Map<number, boolean>` — 仍为哈希结构，无实质提升
- `Int32Array` 位压缩 — 额外位运算复杂度，id 空间 < 100k 不值得

**实现**: 在 `SimulationEngine` 上预分配 `_defeatedBuf: Uint8Array`，每 tick 开始前 `.fill(0)` 重置。`processEncounters` 接收该 buffer 而非自行创建 Set。

### D2: threshold() → 预计算查表

**选择**: 在 `constants.ts` 中新增 `const THRESHOLDS: readonly number[]`，`threshold(level)` 改为 `THRESHOLDS[level]` 直接索引。

**理由**: `threshold()` 当前实现为 `level >= 1 ? 10 ** level : Infinity`，被 `resolveCombat`（每次战斗 2-3 次）和 `tickCultivators`（每个 cultivator）高频调用，占总自耗时 3.7%。查表将指数运算降为数组取值。

**备选方案**:
- 内联到调用点 — 多处调用会导致代码重复
- `switch` 语句 — 不如数组索引简洁且等价

### D3: combatLoop 概率阈值预计算

**选择**: 在 combatLoop 外预计算 `const encounterThresholds = snapshotNk.map(nk => nk / snapshotN)`，循环内用 `engine.prng() >= encounterThresholds[c.level]` 替代 `engine.prng() >= nk / snapshotN`。

**理由**: 消除循环内逐次除法。level 仅 8 档，预计算成本可忽略。

### D4: levelArrayCache 反向索引替代 indexOf

**选择**: 在 `SimulationEngine` 上新增 `_levelArrayIndex: Int32Array`，维护 `cultivator id → 在其 levelArrayCache[level] 中的位置` 映射。`resolveCombat` 中 `arr.indexOf(loser.id)` 改为 `engine._levelArrayIndex[loser.id]` O(1) 查询。

**理由**: `indexOf` 在 `levelArrayCache[level]`（可能数千元素）上做线性扫描。虽然 swap-remove 已经在用，但定位步骤仍为 O(n)。

**实现**: buildCache 阶段在填充 `levelArrayCache` 时同步更新 `_levelArrayIndex`。swap-remove 操作后更新被移动元素的索引。

### D5: effectiveCourage 预算缓存

**选择**: 在 `Cultivator` 接口新增 `cachedCourage: number` 字段。`tickCultivators` 中每个 alive cultivator 的 age/maxAge 更新后立即计算并缓存 `effectiveCourage`。combat 阶段直接读取 `c.cachedCourage`。

**理由**: `effectiveCourage()` 含两次除法 + 两次指数运算 + `Math.min`，在 combatLoop 中对每对战斗者各调用一次（占 V8 profile 0.1% 但调用量大）。缓存到字段后 combat 阶段只做一次属性读取。

**备选方案**:
- 不缓存，保持按需计算 — 简单但丧失优化机会
- 用 Float64Array 外部存储 — 需要额外索引映射，增加复杂度

## Risks / Trade-offs

- **内存增长** → `Uint8Array(nextId)` 和 `Int32Array(nextId)` 各消耗 ~20KB @ 20k cultivators。可接受。
- **索引一致性** → `_levelArrayIndex` 必须在每次 swap-remove 和 buildCache 重建时同步更新，否则产生静默错误 → 通过 buildCache 阶段完全重建索引来保证一致性，swap-remove 仅做增量更新。
- **PRNG 序列兼容** → 所有优化均为等价变换（查表 vs 计算、flag 数组 vs Set），不改变 prng 调用顺序和次数 → 相同 seed 必须产生相同结果。benchmark 对比验证。
- **cachedCourage 新鲜度** → 仅在 tickCultivators 中更新，combat 阶段 evasion penalty 改变 cultivation 但不影响 courage（courage 公式依赖 age/maxAge/baseCourage）。**但战斗晋升会改变 maxAge**（`lifespanBonus`），导致 cachedCourage 变质。因此 `resolveCombat` 中胜者晋升后 SHALL 立即刷新 `winner.cachedCourage = effectiveCourage(winner)`。
- **Buffer 容量管理** → `_defeatedBuf` 和 `_levelArrayIndex` 以 `nextId` 为尺寸。由于 `tickYear` 先调 `spawnCultivators`（可能增长 nextId）再调 `processEncounters`，需在 `processEncounters` 入口处检查并 reallocate：`if (engine.nextId > engine._defeatedBuf.length) { engine._defeatedBuf = new Uint8Array(engine.nextId); engine._levelArrayIndex = new Int32Array(engine.nextId); }`。
- **_levelArrayIndex 哨兵值** → `Int32Array` 默认值 0 是合法位置，因此必须使用 `-1` 作为哨兵。buildCache 阶段填充 `_levelArrayIndex` 前 SHALL 先 `.fill(-1)` 重置。

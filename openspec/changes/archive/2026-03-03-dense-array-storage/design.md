## Context

当前 `SimulationEngine` 使用 `Map<number, Cultivator>` 作为主存储，`Map<number, Set<number>>` 作为等级分组索引。V8 CPU Profile 显示 `processEncounters` 占 69.3% CPU 时间，根因是每 tick ~40k-60k 次 `Map.get()` hash lookup。稳态种群约 20k，每 tick 耗时 ~11ms。

现有代码已有部分优化基础：`levelArrayCache`、`snapshotNk` typed buffer。但主存储的 Map 结构是剩余的最大性能瓶颈。

## Goals / Non-Goals

**Goals:**
- 将 `cultivators` 主存储从 `Map<number, Cultivator>` 迁移到密集数组 `Cultivator[]`
- 将 `levelGroups`、`aliveLevelIds`、`levelArrayCache` 从 `Map<number, X>` 迁移到固定长度数组 `X[]`
- `tickYear` 从 ~11ms/year 降至 ~5ms/year（降幅 40-60%）
- 保持所有公共 API 签名和行为不变

**Non-Goals:**
- 不迁移至 Struct of Arrays（SoA / TypedArray per field）—— 收益递减且侵入性过大
- 不改变战斗逻辑、概率模型、事件系统等业务行为
- 不优化 `getSummary` 的 median 计算（低频调用，另案处理）

## Decisions

### D1: 密集数组 + free list vs. 紧凑数组 + swap-and-pop

**选择**: 密集数组 + free list

**理由**: 修仙者的 ID 同时被 `levelGroups`（Set）和 `levelArrayCache`（数组）引用。如果使用 swap-and-pop 紧凑方案，移动元素时需要更新所有引用该 ID 的索引结构，成本高且容易出错。密集数组中 ID 即下标，一旦分配永不移动，所有索引结构无需调整。free list 回收空洞后可在 spawn 时复用。

**替代方案**: swap-and-pop 紧凑数组在纯线性遍历场景下缓存友好，但本项目中 ID 被多处引用，维护一致性的代价过高。

### D2: free list 实现 — 链表 vs. 栈数组

**选择**: 栈数组 `freeSlots: number[]`

**理由**: 简单、无额外对象分配。`pop()` 分配、`push()` 回收，O(1) 操作。数组的 push/pop 在 V8 中高度优化。链表方案需要额外的 next 指针字段，污染 Cultivator 结构。

### D3: 数组空洞标记 + 对象回收策略

**选择**: 复用 `alive: boolean` 字段 + 就地复用（移除 `_pool`）

**理由**: `Cultivator` 已有 `alive` 字段。死亡后 `alive = false`，遍历时 `if (!c.alive) continue`。死亡对象保留在 `cultivators[id]` 原位，`purgeDead` 仅将 id 推入 `freeSlots`。`spawnCultivators` 复用 freeSlots 时直接就地重初始化该对象的所有字段。

移除 `_pool` 机制：就地复用路径无需对象池；`nextId++` 扩展路径直接创建对象字面量。消除了 pool + freeSlots 之间的对象别名风险（同一对象同时被 `cultivators[old_id]` 和 pool 引用，导致 spawn 后幽灵条目）。

**替代方案**: 保留 `_pool` 并在 purgeDead 时置 `cultivators[id] = undefined`——需要类型变为 `(Cultivator|undefined)[]`，所有索引访问需 guard，侵入性过大。

### D4: 等级分组 — 固定数组 vs. 保留 Map

**选择**: 固定长度数组 `Set<number>[]` / `number[][]`

**理由**: `LEVEL_COUNT = 8` 是编译期常量。`levelGroups[level]` 的数组下标访问比 `levelGroups.get(level)!` 快一个量级。固定长度数组的内存布局对 V8 引擎更友好。

### D5: aliveCount 维护方式

**选择**: 维护一个 `aliveCount` 计数器，在死亡标记时立即递减

**理由**: Map 的 `.size` 是 O(1) 的，但迁移到数组后没有等价属性。`aliveCount` 在 `spawnCultivators` 时 `++`，在 `tickCultivators`（寿尽）和 `resolveCombat`（战死）中 `alive = false` 时立即 `--`。这使得 `aliveCount` 在整个 tick 过程中始终精确，extinction 检测无需等待 `purgeDead` 完成。

### D6: purgeDead 迭代策略 — 死亡 ID 列表 vs. 全数组扫描

**选择**: 死亡 ID 列表 `_deadIds: number[]`

**理由**: `tickCultivators` 和 `resolveCombat` 中每次设置 `alive = false` 时同时 `_deadIds.push(id)`。`purgeDead` 仅遍历 `_deadIds`，将每个 id 推入 `freeSlots`，然后 `_deadIds.length = 0`。复杂度 O(dead) 而非 O(capacity)。每个修仙者只死一次，无需去重。

### D7: nextId 起始值

**选择**: `nextId = 0`

**理由**: 数组下标自然从 0 开始，避免浪费 `cultivators[0]` 槽位。ID 是纯内部标识，不影响公共 API 输出。

## Risks / Trade-offs

- **数组高水位不收缩**: `cultivators.length === nextId` 为高水位标记。极端种群崩溃（20k→1k）后数组不缩小。→ 缓解：`freeSlots` 大量累积，后续 spawn 优先复用，无需扩展。稳态下 freeSlots 充足。不做 compaction（收益低、复杂度高）。
- **遍历空洞开销**: 全数组遍历（`getSummary`、`tickCultivators`）需跳过 `!alive` 条目。→ 缓解：purgeDead 每 tick 回收死亡 slot，稳态空洞比例极低；`alive` 检查分支预测友好。
- **语义变化**: `cultivators[id]` 可能访问到 `alive=false` 的对象。→ 缓解：所有访问路径已有 `alive` 检查。combat 中通过 `levelArrayCache`/`aliveLevelIds` 索引访问，天然排除死者。

## Invariants

以下不变量必须在 `tickYear` 的任意阶段成立：

- `cultivators.length === nextId`
- `aliveCount === count(cultivators[i].alive === true for i in 0..nextId-1)`
- `freeSlots` 中所有值 ∈ `[0, nextId)`，且对应 `cultivators[id].alive === false`
- `freeSlots` 无重复值
- `sum(levelGroups[level].size for level 0..7) === aliveCount`
- 对任意存活 cultivator c: `cultivators[c.id] === c`

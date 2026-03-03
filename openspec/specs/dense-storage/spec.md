### Requirement: Dense array cultivator storage

`SimulationEngine` SHALL 使用 `cultivators: Cultivator[]` 密集数组作为主存储。修仙者的 `id` SHALL 直接对应数组下标，即 `cultivators[c.id] === c`。数组中可能存在空洞（`alive === false` 的已死亡对象），遍历时 SHALL 跳过非存活条目。类型始终为 `Cultivator[]`（无 undefined slot）。

#### Scenario: Direct index access
- **WHEN** 修仙者 id=42 存活
- **THEN** `engine.cultivators[42]` SHALL 返回该修仙者对象，且 `engine.cultivators[42].id === 42`

#### Scenario: Array holes skipped during iteration
- **WHEN** 密集数组中 id=5 的修仙者已死亡
- **THEN** 遍历 `cultivators` 时 SHALL 跳过 index=5（`cultivators[5].alive === false`）

#### Scenario: Array length equals nextId
- **WHEN** `nextId` 为 21000
- **THEN** `cultivators.length` SHALL 为 21000，所有 index 0..20999 均有 Cultivator 对象

### Requirement: Free list slot management

`SimulationEngine` SHALL 维护 `freeSlots: number[]` 栈数组管理已回收的数组槽位。`spawnCultivators` SHALL 优先通过 `freeSlots.pop()` 复用已回收的槽位，并就地重初始化该 slot 已有的 Cultivator 对象的所有字段。仅在 `freeSlots` 为空时通过递增 `nextId` 扩展数组（创建新对象字面量）。`purgeDead` SHALL 将 `_deadIds` 中的每个 id 通过 `freeSlots.push(id)` 回收。

#### Scenario: Spawn reuses free slot in-place
- **WHEN** `freeSlots = [5, 12]` 且需要 spawn 1 个修仙者
- **THEN** SHALL 从 freeSlots pop 得到 id=12，就地重初始化 `cultivators[12]` 的已有对象（设置 age=10, cultivation=0, alive=true 等全部字段），不创建新对象

#### Scenario: Spawn extends array when no free slots
- **WHEN** `freeSlots` 为空且 `nextId = 100`
- **THEN** SHALL 创建新 Cultivator 对象字面量，分配 id=100，写入 `cultivators[100]`，`nextId` 递增为 101

#### Scenario: PurgeDead recycles slots
- **WHEN** `_deadIds = [7, 15, 23]`
- **THEN** `purgeDead` SHALL 将 7, 15, 23 推入 `freeSlots`，然后清空 `_deadIds`。`cultivators[7/15/23]` 保留死亡对象原位（`alive=false`）

### Requirement: Dead ID collection

`SimulationEngine` SHALL 维护 `_deadIds: number[]` 列表。`tickCultivators` 中寿尽死亡和 `resolveCombat` 中战斗死亡时 SHALL 同时 `_deadIds.push(id)`。每个修仙者仅死一次，无需去重。`purgeDead` SHALL 仅遍历 `_deadIds`（O(dead)），不扫描全数组。

#### Scenario: Death collection from multiple sources
- **WHEN** 年内 50 人寿尽（tickCultivators）、30 人战死（resolveCombat）
- **THEN** `_deadIds.length` SHALL 为 80，purgeDead 处理后 `freeSlots` 增加 80 个 id

### Requirement: No object pool

`_pool` 字段 SHALL 被移除。就地复用路径（freeSlots）直接重初始化已有对象，无需对象池。`nextId++` 扩展路径创建新对象字面量。

#### Scenario: Pool field absent
- **WHEN** `SimulationEngine` 构造后
- **THEN** SHALL 不存在 `_pool` 字段，`spawnCultivators` 和 `purgeDead` 均不引用 `_pool`

### Requirement: Alive count tracking

`SimulationEngine` SHALL 维护 `aliveCount: number` 计数器。`spawnCultivators` SHALL 在每次成功创建时递增 `aliveCount`。`tickCultivators`（寿尽）和 `resolveCombat`（战死）中设置 `alive = false` 时 SHALL 立即递减 `aliveCount`。`aliveCount` 在整个 tick 过程中始终精确反映存活修仙者数量。

#### Scenario: aliveCount consistency
- **WHEN** tick 开始时 aliveCount=20000，年内 spawn 1000，50 人寿尽，30 人战死
- **THEN** spawn 后 aliveCount=21000，tickCultivators 后 aliveCount=20950，processEncounters 后 aliveCount=20920

#### Scenario: Extinction detection
- **WHEN** 所有修仙者死亡
- **THEN** `aliveCount` SHALL 为 0，`tickYear` SHALL 返回 `isExtinct: true`

### Requirement: Fixed-length level group arrays

`levelGroups`、`aliveLevelIds`、`levelArrayCache` SHALL 使用固定长度为 `LEVEL_COUNT`(8) 的数组，按 level 下标直接访问。`levelGroups: Set<number>[]`，`aliveLevelIds: Set<number>[]`，`levelArrayCache: number[][]`。所有 `.get(level)!` 调用 SHALL 替换为 `[level]` 下标访问。

#### Scenario: Level group direct access
- **WHEN** 需要获取 Lv3 的修仙者 ID 集合
- **THEN** SHALL 通过 `engine.levelGroups[3]` 直接访问

#### Scenario: All 8 levels initialized
- **WHEN** `SimulationEngine` 构造时
- **THEN** `levelGroups`、`aliveLevelIds`、`levelArrayCache` SHALL 各有 8 个元素（index 0-7），每个元素分别初始化为空 `Set<number>` 或空 `number[]`

### Requirement: nextId starts at zero

`nextId` SHALL 初始化为 0。第一个修仙者的 id SHALL 为 0，对应 `cultivators[0]`。

#### Scenario: First cultivator gets id zero
- **WHEN** 空引擎首次 `spawnCultivators(1)`
- **THEN** 该修仙者的 id SHALL 为 0，`cultivators[0]` SHALL 指向该修仙者，`nextId` SHALL 为 1

## Property-Based Testing

### PBT: aliveCount exactness
- **Invariant**: `aliveCount === Σ(cultivators[i].alive === true for i in 0..nextId-1)`，在每个 tick 阶段结束后均成立
- **Falsification**: 镜像计数器每次状态变更后从数组重算，与 `aliveCount` 比对

### PBT: aliveCount delta law
- **Invariant**: 每个 tick：`aliveCount_after = aliveCount_before + births - uniqueDeaths`。`purgeDead` 不改变 `aliveCount`
- **Falsification**: 维护 `bornIds` 和 `deadIds` 集合，tick 结束时验证等式

### PBT: level group conservation
- **Invariant**: `Σ(levelGroups[l].size for l 0..7) === aliveCount`，且每个存活 id 恰好出现在 `levelGroups[c.level]` 中
- **Falsification**: 维护 `id→level` 映射，每次操作后断言基数和成员关系

### PBT: reference integrity
- **Invariant**: 对每个存活 cultivator c：`cultivators[c.id] === c` 且 `c.id` 等于其数组下标
- **Falsification**: 长时间运行（含大量回收循环），遍历数组验证指针同一性和 id/index 一致性

### PBT: freeSlots soundness
- **Invariant**: `freeSlots` 中所有值 ∈ `[0, nextId)`，对应 `cultivators[id].alive === false`，无重复
- **Falsification**: purgeDead 后验证 freeSlots 集合与数组死亡标记的一致性

### PBT: nextId monotonicity and length lockstep
- **Invariant**: `nextId` 跨所有操作只增不减；`cultivators.length === nextId` 始终成立
- **Falsification**: 每次操作后断言 `nextId >= prev_nextId` 且 `cultivators.length === nextId`

### PBT: seeded run determinism
- **Invariant**: 相同 seed + initialPop，`run(S0, years)` 产生逐年完全相同的 `getSummary()` 输出
- **Falsification**: 克隆初始状态，运行两次，逐年对比所有数值字段 hash

### PBT: purgeDead idempotency
- **Invariant**: 无新死亡时，`purgeDead(purgeDead(S)) === purgeDead(S)`（`freeSlots`、`_deadIds`、`cultivators` 状态相同）
- **Falsification**: 连续调用 purgeDead 两次，diff 全状态快照

### PBT: recycle round-trip LIFO
- **Invariant**: `freeSlots=[..., x]` 时 spawn 一个修仙者 SHALL 分配 id=x；`freeSlots` 为空时 SHALL 分配 `nextId_before`
- **Falsification**: 随机化 freeSlots 栈和 spawn 数量，断言分配 ID 序列符合 LIFO 规则

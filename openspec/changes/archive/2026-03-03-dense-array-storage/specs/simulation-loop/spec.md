## MODIFIED Requirements

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=MORTAL_MAX_AGE(60), injuredUntil=0, lightInjuryUntil=0, meridianDamagedUntil=0`. The `courage` attribute SHALL be sampled from truncated normal distribution with μ=0.50, σ=0.15, bounds [0.01, 1.00], using Box-Muller transform + rejection sampling on seeded PRNG, then rounded to two decimal places via `round2`。超出 [0.01, 1.00] 的值 SHALL 重新采样而非 clamp。

ID 分配 SHALL 优先从 `freeSlots.pop()` 复用已回收的槽位。复用时 SHALL 就地重初始化 `cultivators[id]` 处已有对象的全部字段（包括通过类型断言设置 readonly `courage`），不创建新对象。仅在 `freeSlots` 为空时使用 `nextId++` 分配新 ID 并创建新对象字面量写入 `cultivators[id]`。每次成功创建 SHALL 递增 `aliveCount` 并将 id 加入 `levelGroups[0]` 和 `aliveLevelIds[0]`。

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, injuredUntil=0, lightInjuryUntil=0, meridianDamagedUntil=0, alive=true, and a unique ID corresponding to its array index

#### Scenario: In-place reuse from freeSlots
- **WHEN** `freeSlots = [3]` 且需要 spawn
- **THEN** SHALL pop id=3，重初始化 `cultivators[3]` 的已有对象的所有字段，`cultivators[3].id === 3`，`cultivators[3].alive === true`

#### Scenario: New object for nextId expansion
- **WHEN** `freeSlots` 为空且 `nextId = 500`
- **THEN** SHALL 创建新 Cultivator 对象字面量，id=500，写入 `cultivators[500]`，nextId 变为 501

#### Scenario: Courage range
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL all be in [0.01, 1.00]，且每个值 SHALL 为精确的两位小数

#### Scenario: No boundary spike
- **WHEN** 10000 cultivators are created
- **THEN** courage=0.01 和 courage=1.00 的频次 SHALL NOT 显著高于相邻值

### Requirement: Tick year operation order

`tickYear` SHALL 按以下固定顺序执行：
1. `resetYearCounters()` — 重置年度统计计数器和 `_deadIds.length = 0`
2. `spawnCultivators(yearlySpawn)` — 生成新修仙者
3. `tickCultivators(events)` — 自然修炼、晋升、寿尽检测（寿尽时 `alive=false`, `aliveCount--`, `_deadIds.push(id)`）
4. `processEncounters(engine)` — 战斗处理（战死时 `alive=false`, `aliveCount--`, `_deadIds.push(id)`）
5. `purgeDead()` — 遍历 `_deadIds`，将 id 推入 `freeSlots`，清空 `_deadIds`
6. extinction 检测：`aliveCount === 0`

#### Scenario: Tick order determinism
- **WHEN** 以相同 seed 执行 tickYear
- **THEN** 操作顺序 SHALL 严格为 resetCounters → spawn → tick → encounters → purge → extinction check

### Requirement: purgeDead via death list

`purgeDead` SHALL 仅遍历 `_deadIds` 列表（O(dead)）。对每个 id，SHALL `freeSlots.push(id)`。遍历完成后 SHALL `_deadIds.length = 0`。不执行全数组扫描。死亡对象保留在 `cultivators[id]` 原位。

#### Scenario: purgeDead performance
- **WHEN** 年内 80 人死亡，cultivators 数组有 21000 条目
- **THEN** purgeDead SHALL 仅处理 80 个 ID，不遍历 21000 条目

### Requirement: Simulation termination
The simulation SHALL stop under two conditions: (1) user manually pauses, or (2) total population reaches zero. When population reaches zero, the simulation SHALL auto-pause and the UI SHALL indicate the reason.

When extinction occurs during a batch, Worker SHALL 发送 `tick`（含已计算的数据）+ `paused` 消息，然后停止。

灭绝检测 SHALL 使用 `aliveCount === 0`。

#### Scenario: Manual pause
- **WHEN** user clicks pause
- **THEN** simulation SHALL stop after completing the current year

#### Scenario: Population extinction
- **WHEN** all cultivators die (aliveCount = 0) at end of a year
- **THEN** simulation SHALL auto-pause and UI SHALL display an extinction notice

### Requirement: reset() state clearing

`reset()` SHALL 按以下方式清理状态：
- `cultivators.length = 0`（就地清空）
- `freeSlots.length = 0`
- `_deadIds.length = 0`
- `nextId = 0`
- `aliveCount = 0`
- `levelGroups`、`aliveLevelIds`、`levelArrayCache` 重新初始化为长度 8 的数组
- `aliveIds.length = 0`、`_highBuf.length = 0`、`_lowBuf.length = 0`
- buffer 数组重新初始化
- PRNG 以新 seed 重新创建
- 然后 `spawnCultivators(initialPop)` 重新填充

#### Scenario: Reset produces clean state
- **WHEN** 执行 reset(42, 10000)
- **THEN** nextId SHALL 为 10000，aliveCount SHALL 为 10000，freeSlots SHALL 为空，cultivators.length SHALL 为 10000

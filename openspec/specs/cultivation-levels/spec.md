### Requirement: Level hierarchy
The system SHALL support 8 cultivation levels (Lv0–Lv7). The promotion threshold SHALL be accessed via precomputed constant array `THRESHOLDS[level]`, where `THRESHOLDS = [0, 13, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]`. The function `threshold(level)` SHALL return `THRESHOLDS[level]`. Lv7 (大乘) SHALL be the maximum level; no further promotion is possible.

所有升级（Lv0→Lv1, Lv1→Lv2, ..., Lv6→Lv7）SHALL 在修为达到 `threshold(level+1)` 后，通过突破概率门判定。仅当突破成功时才执行升级。每个路径（`tickCultivators` / `resolveCombat`）内每个修仙者最多允许一次突破尝试，两路径独立计算。

| Level | Name | Threshold | THRESHOLDS[level] |
|-------|------|-----------|-------------------|
| Lv0 | 炼气 | - | 0 |
| Lv1 | 筑基 | 13 | 13 |
| Lv2 | 结丹 | 100 | 100 |
| Lv3 | 元婴 | 1,000 | 1_000 |
| Lv4 | 化神 | 10,000 | 10_000 |
| Lv5 | 炼虚 | 100,000 | 100_000 |
| Lv6 | 合体 | 1,000,000 | 1_000_000 |
| Lv7 | 大乘 | 10,000,000 | 10_000_000 |

#### Scenario: Lv0 promotes to Lv1 via breakthrough gate
- **WHEN** Lv0 修仙者 cultivation 达到 13
- **THEN** SHALL 通过突破概率门判定，仅在判定成功时升级至 Lv1

#### Scenario: Lv1 cultivator reaches Lv2 threshold
- **WHEN** Lv1 修仙者 cultivation 达到 100
- **THEN** SHALL 通过突破概率门判定，仅在判定成功时升级至 Lv2

#### Scenario: Lv7 cultivator cannot promote further
- **WHEN** a Lv7 cultivator accumulates any amount of cultivation beyond 10,000,000
- **THEN** no promotion SHALL occur; level remains Lv7

#### Scenario: threshold(0) returns zero
- **WHEN** `threshold(0)` is called
- **THEN** the return value SHALL be `THRESHOLDS[0]` = 0

#### Scenario: threshold(1) returns 13
- **WHEN** `threshold(1)` is called
- **THEN** the return value SHALL be `THRESHOLDS[1]` = 13

#### Scenario: threshold(3) returns precomputed value
- **WHEN** `threshold(3)` is called
- **THEN** the return value SHALL be `THRESHOLDS[3]` = 1000

### Requirement: THRESHOLDS[1] combat economy side effects
`THRESHOLDS[1]` 从 10 调整为 13 后，以下战斗系统行为 SHALL 随之变化：

| 用途 | 公式 | 旧值 | 新值 |
|---|---|---|---|
| Lv1 baseLoot | `threshold(1) * LOOT_BASE_RATE` | 0.5 | 0.65 |
| Lv1 逃跑修为地板 | `max(threshold(evader.level), ...)` | 10 | 13 |
| Lv1 战败修为损失地板 | `max(threshold(loser.level), ...)` | 10 | 13 |
| Lv1 突破失败修为地板 | `max(threshold(c.level), ...)` | 10 | 13 |

#### Scenario: Lv1 combat base loot
- **WHEN** Lv1 修仙者在战斗中被击败
- **THEN** baseLoot SHALL 为 `13 * 0.05 = 0.65`

#### Scenario: Lv1 evasion cultivation floor
- **WHEN** Lv1 修仙者逃跑失败受到修为惩罚
- **THEN** 修为 SHALL NOT 低于 `threshold(1) = 13`

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=MORTAL_MAX_AGE(60), injuredUntil=0, lightInjuryUntil=0, meridianDamagedUntil=0, breakthroughCooldownUntil=0`. The `courage` attribute SHALL be sampled from truncated normal distribution with μ=0.50, σ=0.15, bounds [0.01, 1.00], using Box-Muller transform + rejection sampling on seeded PRNG, then rounded to two decimal places via `round2`。超出 [0.01, 1.00] 的值 SHALL 重新采样而非 clamp。

ID 分配 SHALL 优先从 `freeSlots.pop()` 复用已回收的槽位。复用时 SHALL 就地重初始化 `cultivators[id]` 处已有对象的全部字段（包括通过类型断言设置 readonly `courage`），不创建新对象。仅在 `freeSlots` 为空时使用 `nextId++` 分配新 ID 并创建新对象字面量写入 `cultivators[id]`。每次成功创建 SHALL 递增 `aliveCount` 并将 id 加入 `levelGroups[0]` 和 `aliveLevelIds[0]`。

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, injuredUntil=0, lightInjuryUntil=0, meridianDamagedUntil=0, breakthroughCooldownUntil=0, alive=true, and a unique ID corresponding to its array index

#### Scenario: In-place reuse from freeSlots
- **WHEN** `freeSlots = [3]` 且需要 spawn
- **THEN** SHALL pop id=3，重初始化 `cultivators[3]` 的已有对象的所有字段（含 `breakthroughCooldownUntil=0`），`cultivators[3].id === 3`，`cultivators[3].alive === true`

#### Scenario: New object for nextId expansion
- **WHEN** `freeSlots` 为空且 `nextId = 500`
- **THEN** SHALL 创建新 Cultivator 对象字面量（含 `breakthroughCooldownUntil: 0`），id=500，写入 `cultivators[500]`，nextId 变为 501

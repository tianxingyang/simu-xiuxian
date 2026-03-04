## ADDED Requirements

### Requirement: Structured event types
系统 SHALL 弃用现有扁平 `SimEvent`（`detail: string`），改为带类型判别的结构化事件 `RichEvent`。所有事件 SHALL 携带 `year`、`newsRank`（S/A/B/C）字段。

事件类型 SHALL 包含：

**combat** — 战斗事件：
- `winner: { id, name?, level, cultivation }` — 胜者信息
- `loser: { id, name?, level, cultivation }` — 败者信息（修为为战前快照）
- `absorbed: number` — 吸收的修为量
- `outcome: 'death' | 'demotion' | 'injury' | 'cult_loss'` — 败者结局

**promotion** — 晋升事件：
- `subject: { id, name? }` — 晋升者
- `fromLevel: number` — 原境界
- `toLevel: number` — 新境界
- `cause: 'natural' | 'combat'` — 晋升原因

**expiry** — 寿尽事件：
- `subject: { id, name?, age }` — 寿尽者
- `level: number` — 死亡时境界

**milestone** — 里程碑事件：
- `kind: 'first_at_level' | 'last_at_level'` — 里程碑类型标识
- `detail` — 具体信息，按 kind 固定结构：
  - `first_at_level`: `{ level: number, cultivatorId: number, cultivatorName: string, year: number }`
  - `last_at_level`: `{ level: number, cultivatorId: number, cultivatorName: string, year: number }`

#### Scenario: Combat event with named cultivators
- **WHEN** 命名修士"叶凌霄"（Lv3，修为 5000）击败命名修士"苏幽辰"（Lv3，修为 3000）
- **THEN** SHALL 生成 `{ type: 'combat', winner: { id: 42, name: '叶凌霄', level: 3, cultivation: 5000 }, loser: { id: 57, name: '苏幽辰', level: 3, cultivation: 3000 }, ... }`

#### Scenario: Combat event with anonymous cultivator
- **WHEN** 匿名修士（Lv1）击败匿名修士（Lv1）
- **THEN** winner/loser 的 `name` 字段 SHALL 为 undefined

#### Scenario: Promotion event
- **WHEN** 修士从 Lv2 自然晋升到 Lv3
- **THEN** SHALL 生成 `{ type: 'promotion', subject: { id, name }, fromLevel: 2, toLevel: 3, cause: 'natural' }`

### Requirement: News value scoring
每个 `RichEvent` SHALL 被评定一个新闻价值等级（`newsRank`）：S、A、B、C。评分 SHALL 在事件产生时立即计算。

**S 级条件**（任一满足即为 S）：
- `milestone` 类型事件
- Lv6+（合体及以上）修士战斗死亡

**A 级条件**（任一满足即为 A，且不满足 S 条件）：
- Lv4+ 战斗事件（按 `max(winner.level, loser.level)` 判定）
- 以弱胜强：胜者修为 < 败者修为 × 0.5（修为差距超过一倍）
- 跨 2 级以上晋升（如 Lv2 → Lv4，即 `toLevel - fromLevel >= 2`）
- Lv4+ 命名修士寿尽

**B 级条件**（任一满足即为 B，且不满足 S/A 条件）：
- Lv2-3 晋升事件（含 Lv1→Lv2 和 Lv2→Lv3）
- Lv3 战斗事件（按 `max(winner.level, loser.level)` 判定）
- Lv2-3 命名修士寿尽

**分级判定中"战斗等级"的定义**：取战前双方境界的最大值，即 `max(winner.level, loser.level)`。

**C 级**：不满足以上任何条件的事件。

#### Scenario: First breakthrough is S-rank
- **WHEN** 全服首位修士达到 Lv5（炼虚）
- **THEN** 该 milestone 事件的 newsRank SHALL 为 'S'

#### Scenario: High-level combat is A-rank
- **WHEN** 两个 Lv4 修士发生战斗
- **THEN** newsRank SHALL 为 'A'（max(4,4)=4 ≥ 4）

#### Scenario: Cross-level combat ranking
- **WHEN** Lv3 修士与 Lv4 修士发生战斗
- **THEN** newsRank SHALL 为 'A'（max(3,4)=4 ≥ 4）

#### Scenario: Upset combat is A-rank
- **WHEN** 修为 2000 的修士击败修为 5000 的修士（2000 < 5000 × 0.5 = 2500）
- **THEN** newsRank SHALL 为 'A'

#### Scenario: Lv2 promotion is B-rank
- **WHEN** 修士从 Lv1 晋升到 Lv2
- **THEN** newsRank SHALL 为 'B'

#### Scenario: Lv3-to-Lv4 single promotion is B-rank
- **WHEN** 修士从 Lv3 自然晋升到 Lv4（跨 1 级）
- **THEN** newsRank SHALL 为 'C'（不满足 B 条件中的 Lv2-3 晋升，不满足 A 条件中的跨 2 级）

#### Scenario: Lv1 combat is C-rank
- **WHEN** 两个 Lv1 修士发生战斗
- **THEN** newsRank SHALL 为 'C'

### Requirement: Milestone detection
引擎 SHALL 维护里程碑检测状态，追踪以下全局记录：

- `highestLevelEverReached: number` — 历史最高境界
- `levelEverPopulated: boolean[]` — 每个境界是否曾有修士达到

每次晋升后 SHALL 检查：若修士达到的境界高于 `highestLevelEverReached`，则产生 `{ type: 'milestone', kind: 'first_at_level' }` 事件。`first_at_level` 仅追踪 Lv2+ 境界。

每次死亡后 SHALL 检查：若某 Lv2+ 境界 levelGroup 人数降为 0 且 `levelEverPopulated[level]` 为 true，则产生 `{ type: 'milestone', kind: 'last_at_level' }` 事件。`last_at_level` SHALL 可重复触发（同一境界灭绝→重新出现→再次灭绝时再次产生事件）。Lv0-1 的人口变化 SHALL 不触发任何里程碑。

#### Scenario: First cultivator reaches Lv3
- **WHEN** 世界首位修士晋升到 Lv3（元婴），此前 highestLevelEverReached = 2
- **THEN** SHALL 产生 S 级 milestone 事件：`{ kind: 'first_at_level', detail: { level: 3, cultivatorName: '...', year: ... } }`

#### Scenario: Last Lv5 cultivator dies
- **WHEN** 唯一的 Lv5 修士死亡，Lv5 人数降为 0
- **THEN** SHALL 产生 S 级 milestone 事件：`{ kind: 'last_at_level', detail: { level: 5, cultivatorName: '...', year: ... } }`

#### Scenario: Level repopulated after extinction
- **WHEN** Lv3 人数曾降为 0 后又有修士晋升到 Lv3
- **THEN** SHALL NOT 产生 `first_at_level` 事件（first 仅触发一次）

#### Scenario: Repeated extinction triggers last_at_level again
- **WHEN** Lv5 人数曾降为 0（已触发 last_at_level），后有修士再次晋升到 Lv5，然后再次全部死亡
- **THEN** SHALL 再次产生 `last_at_level` 事件（可重复触发）

### Requirement: Event persistence
rank ≤ B 的 `RichEvent` SHALL 持久化到 SQLite `events` 表。C 级事件 SHALL 不写入数据库。每条记录 SHALL 包含 `real_ts`（Unix timestamp，秒精度）字段，用于按现实天聚合（UTC+8 日边界：`[00:00:00, 次日00:00:00)`）。

#### Scenario: B-rank event persisted
- **WHEN** 产生一个 B 级晋升事件
- **THEN** SHALL 写入 events 表，payload 为 JSON 序列化的 RichEvent

#### Scenario: C-rank event discarded
- **WHEN** 产生一个 C 级低阶战斗事件
- **THEN** SHALL 不写入 events 表

#### Scenario: Batch write
- **WHEN** 引擎完成一批计算，产生了 30 个 rank ≤ B 的事件
- **THEN** SHALL 在 batch 结束时一次性 INSERT 这 30 条记录

### Requirement: Display event compatibility
后端 SHALL 提供 `toDisplayEvent(e: RichEvent): SimEvent` 转换函数，将 `RichEvent` 转为现有前端 `SimEvent` 格式，以保持前端 EventLog 组件兼容。

转换规则：
- `type` 直接映射（milestone → promotion 作为显示类型）
- `actorLevel` 取事件中最高境界的参与者
- `detail` 生成可读文本（如"叶凌霄(元婴)击败苏幽辰(元婴)，吸收修为150"）

#### Scenario: Named combat event conversion
- **WHEN** combat RichEvent 包含 winner.name='叶凌霄' (Lv3)，loser.name='苏幽辰' (Lv3)，absorbed=150
- **THEN** `toDisplayEvent` SHALL 返回 `{ type: 'combat', actorLevel: 3, detail: '叶凌霄(元婴)击败苏幽辰(元婴)，吸收修为150' }`

#### Scenario: Anonymous combat event conversion
- **WHEN** combat RichEvent 中 winner/loser 无 name
- **THEN** detail SHALL 回退为现有格式（如"筑基对决，吸收修为5"）

## PBT Properties

### Property: Event schema validity
每个 `RichEvent` SHALL 满足判别联合体 schema，且 `year >= 0`、`newsRank ∈ {S,A,B,C}`。
- **Falsification**: 属性生成事件并 schema 校验；逐字段变异验证校验器拒绝无效形式。

### Property: Ranking determinism and precedence
评分 SHALL 确定性且满足优先级 S > A > B > C。边界规则精确：upset 为 `winnerCult < 0.5 * loserCult`（严格小于），跳级为 `toLevel - fromLevel >= 2`，战斗等级为 `max(winner.level, loser.level)`。
- **Falsification**: 在阈值边界（精确 0.5 倍修为、±1 级、Lv3/Lv4 临界）生成元组，对比实现评分与 oracle。

### Property: highestLevelEverReached monotonicity
`highestLevelEverReached` SHALL 单调非递减。
- **Falsification**: 随机人口变动轨迹，每步断言该值 >= 上一步。

### Property: first_at_level uniqueness per level
每个 Lv2+ 境界最多产生一次 `first_at_level` 事件。
- **Falsification**: 随机晋升/灭绝/再现轨迹，统计每境界的 first_at_level 触发次数。

### Property: last_at_level triggers on every positive→0 transition
Lv2+ 境界人口从正数降为 0 时必须触发 `last_at_level`；反之不触发。
- **Falsification**: 生成随机境界人口轨迹（含反复灭绝/再现），对比触发事件与人口变化的 oracle。

### Property: Persistence = rank filter
持久化集合 === `{ e | e.newsRank ∈ {S,A,B} }`；C 级事件排除；每批插入数 = 合格事件数。
- **Falsification**: 混合等级事件流 + 随机批次切割，对比 DB 行数与合格计数。

### Property: toDisplayEvent preserves semantics
`actorLevel` === 事件中参与者最高境界；detail 中的身份引用与源事件字段匹配（或匿名回退）。
- **Falsification**: 对所有事件类型（命名/匿名组合）生成并解析 display text，验证字段一致性。

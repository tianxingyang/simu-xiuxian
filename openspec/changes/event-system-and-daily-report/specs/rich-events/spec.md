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
- `kind: string` — 里程碑类型标识
- `detail: Record<string, unknown>` — 具体信息

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
- Lv4+ 战斗事件
- 以弱胜强：胜者修为 < 败者修为 × 0.5（修为差距超过一倍）
- 跨 2 级以上晋升（如 Lv2 → Lv4）
- Lv4+ 命名修士寿尽

**B 级条件**（任一满足即为 B，且不满足 S/A 条件）：
- Lv2-3 晋升事件
- Lv3 战斗事件
- Lv2-3 命名修士寿尽

**C 级**：不满足以上任何条件的事件。

#### Scenario: First breakthrough is S-rank
- **WHEN** 全服首位修士达到 Lv5（炼虚）
- **THEN** 该 milestone 事件的 newsRank SHALL 为 'S'

#### Scenario: High-level combat is A-rank
- **WHEN** 两个 Lv4 修士发生战斗
- **THEN** newsRank SHALL 为 'A'

#### Scenario: Upset combat is A-rank
- **WHEN** 修为 2000 的修士击败修为 5000 的修士（2000 < 5000 × 0.5 = 2500）
- **THEN** newsRank SHALL 为 'A'

#### Scenario: Lv2 promotion is B-rank
- **WHEN** 修士从 Lv1 晋升到 Lv2
- **THEN** newsRank SHALL 为 'B'

#### Scenario: Lv1 combat is C-rank
- **WHEN** 两个 Lv1 修士发生战斗
- **THEN** newsRank SHALL 为 'C'

### Requirement: Milestone detection
引擎 SHALL 维护里程碑检测状态，追踪以下全局记录：

- `highestLevelEverReached: number` — 历史最高境界
- `levelEverPopulated: boolean[]` — 每个境界是否曾有修士达到

每次晋升后 SHALL 检查：若修士达到的境界高于 `highestLevelEverReached`，则产生 `{ type: 'milestone', kind: 'first_at_level' }` 事件。

每次死亡后 SHALL 检查：若某境界 levelGroup 人数降为 0 且 `levelEverPopulated[level]` 为 true，则产生 `{ type: 'milestone', kind: 'last_at_level' }` 事件。

#### Scenario: First cultivator reaches Lv3
- **WHEN** 世界首位修士晋升到 Lv3（元婴），此前 highestLevelEverReached = 2
- **THEN** SHALL 产生 S 级 milestone 事件：`{ kind: 'first_at_level', detail: { level: 3, cultivatorName: '...', year: ... } }`

#### Scenario: Last Lv5 cultivator dies
- **WHEN** 唯一的 Lv5 修士死亡，Lv5 人数降为 0
- **THEN** SHALL 产生 S 级 milestone 事件：`{ kind: 'last_at_level', detail: { level: 5, cultivatorName: '...', year: ... } }`

#### Scenario: Level repopulated after extinction
- **WHEN** Lv3 人数曾降为 0 后又有修士晋升到 Lv3
- **THEN** SHALL NOT 产生 `first_at_level` 事件（first 仅触发一次）

### Requirement: Event persistence
rank ≤ B 的 `RichEvent` SHALL 持久化到 SQLite `events` 表。C 级事件 SHALL 不写入数据库。每条记录 SHALL 包含 `real_ts`（Unix timestamp）字段，用于按现实天聚合。

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

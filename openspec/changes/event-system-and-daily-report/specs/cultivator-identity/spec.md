## ADDED Requirements

### Requirement: Name generation
系统 SHALL 提供修仙风格姓名生成器。生成规则：从姓氏池随机选取 1 个姓，从名字用字池随机选取 1-2 个字组成名，拼接为完整姓名。

姓名生成 SHALL 使用独立的 PRNG 子流（从主 seed 派生，如 `seed ^ 0x4E414D45`），不影响模拟引擎的主 PRNG 序列。同一 seed 下姓名生成结果 SHALL 可复现。

姓氏池 SHALL 包含至少 50 个单姓和 10 个复姓。名字用字池 SHALL 包含至少 80 个修仙风味单字。

姓名唯一性范围为同一 run 的全历史（包括已死亡修士）。碰撞时 SHALL 重新生成，最多重试 100 次；若仍碰撞 SHALL 在名字后追加数字后缀（如"叶凌霄②"）。进程重启时 SHALL 从 `named_cultivators` 表重建去重集合。

#### Scenario: Name format
- **WHEN** 姓名生成器为单姓生成名字
- **THEN** 结果 SHALL 为 2-3 个汉字（如"叶凌霄"、"苏幽"）

#### Scenario: Name format — compound surname
- **WHEN** 姓名生成器为复姓生成名字
- **THEN** 结果 SHALL 为 3-4 个汉字（如"慕容玄清"、"上官墨"）

#### Scenario: Deterministic generation
- **WHEN** 使用相同 seed 和相同调用序列
- **THEN** 生成的姓名 SHALL 完全一致

#### Scenario: Uniqueness
- **WHEN** 生成 1000 个姓名
- **THEN** SHALL 无重复（含已死亡修士的姓名）。碰撞时 SHALL 自动重新生成

#### Scenario: Collision retry exhaustion
- **WHEN** 连续 100 次生成均碰撞（姓名池接近耗尽）
- **THEN** SHALL 在最后一次生成的名字后追加数字后缀（如"②"）作为 fallback

### Requirement: Naming threshold
修士 SHALL 在晋升到 Lv2（结丹）时被命名。Lv0-1 的修士 SHALL 保持匿名（仅有 numeric id）。命名 SHALL 在晋升检查（`checkPromotions` / 战斗晋升）中触发。

#### Scenario: Promotion to Lv2 triggers naming
- **WHEN** 修士从 Lv1 晋升到 Lv2
- **THEN** SHALL 调用姓名生成器分配姓名，创建 `NamedCultivator` 记录

#### Scenario: Promotion to Lv3 does not re-name
- **WHEN** 已命名修士从 Lv2 晋升到 Lv3
- **THEN** SHALL 保留原有姓名，不重新生成

#### Scenario: Multi-level skip naming
- **WHEN** 修士从 Lv1 直接跳级晋升到 Lv3（修为同时超过 Lv2 和 Lv3 阈值）
- **THEN** SHALL 在跨过 Lv2 时触发命名（仅一次）。`promotionYears` SHALL 记录一条 toLevel=3 的晋升（不为中间每个 level 分别记录）

### Requirement: Named cultivator biography tracking
每个命名修士 SHALL 关联一个 `NamedCultivator` 对象，追踪以下履历字段：

- `id: number` — 修士唯一 ID
- `name: string` — 姓名
- `namedAtYear: number` — 命名时的模拟年份
- `killCount: number` — 击杀数
- `combatWins: number` — 战斗胜场
- `combatLosses: number` — 战斗败场
- `promotionYears: { year: number, toLevel: number }[]` — 每次晋升记录（年份 + 目标境界）
- `peakLevel: number` — 历史最高境界
- `peakCultivation: number` — 历史最高修为
- `deathYear?: number` — 死亡年份
- `deathCause?: 'combat' | 'expiry'` — 死因
- `killedBy?: string` — 击杀者姓名（仅战斗死亡）

#### Scenario: Combat win updates biography
- **WHEN** 命名修士赢得一场战斗并击杀对手
- **THEN** `combatWins` SHALL +1，`killCount` SHALL +1

#### Scenario: Combat loss updates biography
- **WHEN** 命名修士在战斗中落败（任何结局）
- **THEN** `combatLosses` SHALL +1

#### Scenario: Promotion updates biography
- **WHEN** 命名修士从 Lv3 晋升到 Lv4（在第 500 年）
- **THEN** `promotionYears` SHALL 追加 `{ year: 500, toLevel: 4 }`，`peakLevel` SHALL 更新为 4

#### Scenario: Peak cultivation tracking
- **WHEN** 命名修士战斗后修为达到新高
- **THEN** `peakCultivation` SHALL 更新为新值

#### Scenario: Combat death records killer
- **WHEN** 命名修士 A 被命名修士 B 击杀
- **THEN** A 的 `deathYear` SHALL 为当前年份，`deathCause` 为 `'combat'`，`killedBy` 为 B 的姓名

#### Scenario: Combat death by anonymous killer
- **WHEN** 命名修士 A 被匿名修士（Lv0-1）击杀
- **THEN** A 的 `killedBy` SHALL 为 `"无名修士"`

#### Scenario: Expiry death
- **WHEN** 命名修士寿元耗尽
- **THEN** `deathYear` SHALL 为当前年份，`deathCause` 为 `'expiry'`，`killedBy` SHALL 为 undefined

### Requirement: Named cultivator persistence
命名修士 SHALL 持久化到 SQLite `named_cultivators` 表。

- 创建时 SHALL INSERT 记录
- 履历更新 SHALL 批量写入（每批计算完成后一次性 UPDATE，而非每次战斗单独写入）
- 死亡后记录 SHALL 保留（不删除），以支持日报查询历史人物

#### Scenario: Batch persistence
- **WHEN** 引擎完成一批 100 年的计算，期间 5 个命名修士履历有变化
- **THEN** SHALL 在 batch 结束时一次性 UPDATE 这 5 条记录

#### Scenario: Dead cultivator persisted
- **WHEN** 命名修士死亡
- **THEN** 其 `named_cultivators` 记录 SHALL 保留，包含完整履历和死因

### Requirement: Named cultivator memory lifecycle
活跃命名修士（alive）SHALL 在内存中维护完整 `NamedCultivator` 对象以支持实时更新。死亡修士 SHALL 从内存活跃表移除（DB 保留）。

#### Scenario: Memory cleanup on death
- **WHEN** 命名修士死亡
- **THEN** SHALL 从内存活跃 Map 中移除，减少内存占用

#### Scenario: Query dead cultivator
- **WHEN** 日报聚合需要查询已死亡修士的履历
- **THEN** SHALL 从 SQLite 查询，不依赖内存

## PBT Properties

### Property: Name generation determinism and isolation
固定 seed + 调用序列下姓名完全一致；姓名 PRNG 子流不改变主引擎 PRNG 的输出序列。
- **Falsification**: 双实例对比（有/无姓名调用），验证主 RNG 输出一致，姓名序列一致。

### Property: Name global uniqueness
同一 run 内（含已死亡修士）无重复姓名。
- **Falsification**: 缩小姓名池强制高碰撞率，生成大量修士，验证集合基数 = 生成数。

### Property: Naming trigger once at Lv2 boundary
修士从 `<Lv2` 到 `>=Lv2` 时恰好触发一次命名；后续晋升/降级不重命名。
- **Falsification**: 随机晋升/降级/跳级轨迹，统计每个修士的命名次数。

### Property: Biography counter monotonicity
`killCount`、`combatWins`、`combatLosses`、`peakLevel`、`peakCultivation` 均为单调非递减。
- **Falsification**: 随机战斗/寿尽事件流，逐步断言计数器单调性。

### Property: Death field consistency
`deathCause='expiry'` → `killedBy === undefined`；`deathCause='combat'` → `killedBy` 为字符串（命名修士名或"无名修士"）。
- **Falsification**: 遍历所有死亡记录，验证字段组合约束。

### Property: Active map = alive named cultivators
任意时刻，内存活跃 Map 的 key 集合 === 存活的命名修士 ID 集合。
- **Falsification**: 每步后对比 Map.keys 与密集数组中 alive + named 的修士 ID。

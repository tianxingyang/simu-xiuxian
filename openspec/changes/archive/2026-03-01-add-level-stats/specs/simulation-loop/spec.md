## MODIFIED Requirements

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=60`. The `courage` attribute SHALL be sampled from uniform distribution [0, 1) using the seeded PRNG. Each cultivator SHALL have a unique numeric ID (monotonically increasing integer).

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, and a unique ID

#### Scenario: Courage distribution
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL approximate a uniform distribution over [0, 1)

## ADDED Requirements

### Requirement: YearSummary levelStats field
`YearSummary` SHALL 包含 `levelStats: LevelStat[]` 字段，长度为 `LEVEL_COUNT`（8），index 与 `levelCounts` 对齐。该字段 SHALL 在每次 `getSummary()` 调用时计算并填充。

#### Scenario: levelStats array length
- **WHEN** `getSummary()` 生成 `YearSummary`
- **THEN** `levelStats` 数组长度 SHALL 为 8

#### Scenario: levelStats alignment with levelCounts
- **WHEN** `levelCounts[2]` 为 50（Lv2 有 50 名修士）
- **THEN** `levelStats[2]` SHALL 反映这 50 名 Lv2 修士的 age/courage 统计

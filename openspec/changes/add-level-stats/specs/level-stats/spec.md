## ADDED Requirements

### Requirement: LevelStat data type
系统 SHALL 定义 `LevelStat` 接口，包含四个 number 字段：`ageAvg`、`ageMedian`、`courageAvg`、`courageMedian`。所有数值 SHALL 保留一位小数（`round1`）。

#### Scenario: LevelStat field completeness
- **WHEN** 系统生成某个境界的统计数据
- **THEN** 该 `LevelStat` SHALL 包含 `ageAvg`、`ageMedian`、`courageAvg`、`courageMedian` 四个字段

### Requirement: Per-level statistics computation
`SimulationEngine.getSummary()` SHALL 在遍历存活修士时，按境界分组计算 age 和 courage 的平均值和中位数。结果 SHALL 存入 `YearSummary.levelStats` 数组，index 与 `levelCounts` 对齐（0-7）。

#### Scenario: Average computation
- **WHEN** 境界 Lv1 有 3 名存活修士，age 分别为 20、30、40，courage 分别为 0.2、0.4、0.6
- **THEN** Lv1 的 `ageAvg` SHALL 为 30.0，`courageAvg` SHALL 为 0.4

#### Scenario: Median computation (odd count)
- **WHEN** 境界 Lv2 有 5 名存活修士，age 分别为 10、20、30、40、50
- **THEN** Lv2 的 `ageMedian` SHALL 为 30

#### Scenario: Median computation (even count)
- **WHEN** 境界 Lv1 有 4 名存活修士，age 分别为 10、20、30、40
- **THEN** Lv1 的 `ageMedian` SHALL 为 25.0（中间两个值的平均）

### Requirement: Empty level statistics
当某境界存活修士数为 0 时，该境界的 `LevelStat` 四个字段 SHALL 全部为 0。

#### Scenario: No cultivators at a level
- **WHEN** 境界 Lv5 无存活修士
- **THEN** Lv5 的 `ageAvg`、`ageMedian`、`courageAvg`、`courageMedian` SHALL 全部为 0

### Requirement: Buffer pre-allocation for median
引擎 SHALL 预分配 `LEVEL_COUNT` 个 number 数组用于收集每个境界的 age 和 courage 值。每次 `getSummary()` 调用 SHALL 重置这些数组的 `length` 为 0 并复用，避免重复内存分配。

#### Scenario: Buffer reuse across getSummary calls
- **WHEN** `getSummary()` 被连续调用两次
- **THEN** 第二次调用 SHALL 复用第一次的 buffer 数组（仅重置 length），不创建新数组

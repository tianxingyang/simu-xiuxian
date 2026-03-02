## MODIFIED Requirements

### Requirement: LevelStat data type
系统 SHALL 定义 `LevelStat` 接口，包含四个 number 字段：`ageAvg`、`ageMedian`、`courageAvg`、`courageMedian`。`ageAvg` 和 `ageMedian` SHALL 通过 `round1()` 保留一位小数。`courageAvg` 和 `courageMedian` SHALL 通过 `round2()` 保留两位小数。下游无需再处理精度。

#### Scenario: LevelStat field completeness
- **WHEN** 系统生成某个境界的统计数据
- **THEN** 该 `LevelStat` SHALL 包含 `ageAvg`、`ageMedian`（round1 处理）、`courageAvg`、`courageMedian`（round2 处理）四个字段

### Requirement: Per-level statistics computation
`SimulationEngine.getSummary()` SHALL 在遍历存活修士时，按境界分组计算 age 和 courage 的平均值和中位数。courage 统计 SHALL 使用 `effectiveCourage(c)` 计算得到的有效勇气值（含寿元加成），而非 `c.courage` 天性基础值。结果 SHALL 存入 `YearSummary.levelStats` 数组，index 与 `levelCounts` 对齐（0-7）。

#### Scenario: Average computation with effective courage
- **WHEN** 境界 Lv1 有 3 名存活修士，age 分别为 20、30、40，effectiveCourage 分别为 0.25、0.45、0.65
- **THEN** Lv1 的 `ageAvg` SHALL 为 30.0，`courageAvg` SHALL 为 round2(0.45) = 0.45

#### Scenario: Median computation uses effective courage
- **WHEN** 境界 Lv2 有 5 名存活修士，effectiveCourage 分别为 0.10、0.30、0.50、0.70、0.90
- **THEN** Lv2 的 `courageMedian` SHALL 为 0.50

## MODIFIED Property-Based Testing

### PBT: Bounds
对非空境界 i，`ageAvg` 和 `ageMedian` SHALL 在该境界实际 age 值的 `[min, max]` 范围内（round1 容差）。`courageAvg` 和 `courageMedian` SHALL 在 `[0.01, 1.00]` 内（对应 effectiveCourage 的值域），使用 round2 容差。

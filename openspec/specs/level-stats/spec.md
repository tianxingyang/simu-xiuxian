## ADDED Requirements

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

#### Scenario: Median computation (even count)
- **WHEN** 境界 Lv1 有 4 名存活修士，age 分别为 10、20、30、40
- **THEN** Lv1 的 `ageMedian` SHALL 为 25.0（中间两个值的平均）

### Requirement: Empty level statistics
当某境界存活修士数为 0 时，该境界的 `LevelStat` 四个字段 SHALL 全部为 0。

#### Scenario: No cultivators at a level
- **WHEN** 境界 Lv5 无存活修士
- **THEN** Lv5 的 `ageAvg`、`ageMedian`、`courageAvg`、`courageMedian` SHALL 全部为 0

### Requirement: Median sort comparator
中位数计算时对 buffer 数组排序 SHALL 使用显式数值比较器 `(a, b) => a - b`，禁止依赖 JavaScript 默认的字符串排序行为。

#### Scenario: Correct numeric sort
- **WHEN** buffer 包含值 [10, 9, 100]
- **THEN** 排序后 SHALL 为 [9, 10, 100]，而非默认字符串排序的 [10, 100, 9]

### Requirement: Buffer pre-allocation for median
引擎 SHALL 预分配 `LEVEL_COUNT` 个 number 数组用于收集每个境界的 age 和 courage 值。每次 `getSummary()` 调用 SHALL 重置这些数组的 `length` 为 0 并复用，避免重复内存分配。

#### Scenario: Buffer reuse across getSummary calls
- **WHEN** `getSummary()` 被连续调用两次
- **THEN** 第二次调用 SHALL 复用第一次的 buffer 数组（仅重置 length），不创建新数组

## Property-Based Testing

### PBT: Idempotency
对固定的存活修士集合，重复调用 `getSummary()` SHALL 返回深等的 `levelStats` 和 `levelCounts`。`getSummary()` SHALL 不修改任何 cultivator 属性。
- **Falsification**: 生成随机群体，连续调用 3 次，assert 全部输出深等；调用前后 clone 对比 cultivator 属性不变。

### PBT: Bounds
对非空境界 i，`ageAvg` 和 `ageMedian` SHALL 在该境界实际 age 值的 `[min, max]` 范围内（round1 容差）。`courageAvg` 和 `courageMedian` SHALL 在 `[0.01, 1.00]` 内（对应 effectiveCourage 的值域），使用 round2 容差。
- **Falsification**: 生成含极端值和 round1 边界值（如 `x.04`, `x.05`）的群体，验证统计值不越界。

### PBT: Sum-count consistency
对非空境界 i，`ageAvg` SHALL 等于 `round1(sum(ages_i) / count_i)`。独立计算 oracle 与 `getSummary()` 输出对比。
- **Falsification**: 构建独立 oracle 函数，对随机群体对比输出；用大量小分组最大化累积 rounding error。

### PBT: Order independence
`getSummary()` 的输出 SHALL 不受 cultivators Map 遍历顺序影响。对同一群体的任意排列，`levelStats` 和 `levelCounts` SHALL 完全相同。
- **Falsification**: 对同一群体生成多个随机排列，验证所有输出深等。

### PBT: Empty-nonempty consistency
对每个境界 i：若 `levelCounts[i] === 0`，则 `levelStats[i]` SHALL 为 `{0,0,0,0}`；若 `levelCounts[i] > 0`，则 `ageAvg` SHALL > 0（因 age >= 10）。
- **Falsification**: 生成交替空/非空境界的群体，连续调用验证 buffer 复用无数据残留。

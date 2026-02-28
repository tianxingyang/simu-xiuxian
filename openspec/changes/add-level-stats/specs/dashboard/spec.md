## MODIFIED Requirements

### Requirement: Statistics panel
统计面板 SHALL 展示：总人口、本年新增、本年死亡（战斗+寿尽分项）、本年晋升、最高境界、最高修为。面板 SHALL 额外展示一个按境界分组的统计表格，包含每个有修士的境界的年龄平均值、年龄中位数、勇气平均值、勇气中位数。

#### Scenario: Stats update
- **WHEN** a year summary arrives from Worker
- **THEN** all statistics SHALL reflect the latest year's data

#### Scenario: Level stats table display
- **WHEN** 当前年份 Lv0 有 5000 名修士、Lv1 有 200 名修士、Lv2 有 10 名修士
- **THEN** 统计表格 SHALL 展示这三个境界各自的 ageAvg、ageMedian、courageAvg、courageMedian

#### Scenario: Empty level omission
- **WHEN** 某境界存活修士数为 0
- **THEN** 该境界 SHALL 不在统计表格中显示

### Requirement: Population trend chart
趋势图 SHALL 支持三个 tab 切换：「人口趋势」、「年龄趋势」、「勇气趋势」。默认展示「人口趋势」。切换 tab SHALL 不影响底层 trendData 数据，仅改变图表渲染的 dataKey。

「人口趋势」tab SHALL 展示 Recharts LineChart，7 条线（Lv1–Lv7），X 轴 = 模拟年份，Y 轴 = 修士数量。

「年龄趋势」tab SHALL 展示各境界 `ageAvg` 的折线，X 轴 = 模拟年份，Y 轴 = 平均年龄。

「勇气趋势」tab SHALL 展示各境界 `courageAvg` 的折线，X 轴 = 模拟年份，Y 轴 = 平均勇气值。

趋势数据 SHALL 保持最多 2,000 个数据点上限，超出时对旧数据降采样。

#### Scenario: Tab default state
- **WHEN** 模拟启动后趋势图首次渲染
- **THEN** SHALL 默认展示「人口趋势」tab

#### Scenario: Tab switching
- **WHEN** 用户点击「年龄趋势」tab
- **THEN** 图表 SHALL 切换为展示各境界 ageAvg 折线，X/Y 轴标签相应变化

#### Scenario: Trend data downsampling
- **WHEN** trend data exceeds 2,000 points
- **THEN** the oldest data SHALL be downsampled to maintain the cap

## MODIFIED Requirements

### Requirement: Statistics panel
统计面板 SHALL 展示：总人口、本年新增、本年死亡（战斗+寿尽分项）、本年晋升、最高境界、最高修为。面板 SHALL 额外展示一个按境界分组的统计表格，固定展示全部 8 个境界行（Lv0-Lv7），列为：境界名、年龄均值、年龄中位数、勇气均值、勇气中位数。

#### Scenario: Stats update
- **WHEN** a year summary arrives from Worker
- **THEN** all statistics SHALL reflect the latest year's data

#### Scenario: Level stats table display
- **WHEN** 当前年份 Lv0 有 5000 名修士、Lv1 有 200 名修士、Lv2 有 10 名修士
- **THEN** 统计表格 SHALL 展示这三个境界各自的 ageAvg、ageMedian、courageAvg、courageMedian 数值

#### Scenario: Empty level display
- **WHEN** 某境界存活修士数为 0
- **THEN** 该境界行 SHALL 保持显示，四个统计列 SHALL 展示「-」而非数值，以保持表格布局稳定

### Requirement: Population trend chart
趋势图 SHALL 支持三个 tab 切换：「人口趋势」、「年龄趋势」、「勇气趋势」。默认展示「人口趋势」。切换 tab SHALL 不影响底层 trendData 数据，仅改变图表渲染的 dataKey。三个 tab 统一展示 Lv1–Lv7（7 条线），排除 Lv0（炼气）。

「人口趋势」tab SHALL 展示 Recharts LineChart，7 条线（Lv1–Lv7），X 轴 = 模拟年份，Y 轴 = 修士数量。

「年龄趋势」tab SHALL 展示 Lv1–Lv7 各境界 `ageAvg` 的折线，X 轴 = 模拟年份，Y 轴 = 平均年龄。

「勇气趋势」tab SHALL 展示 Lv1–Lv7 各境界 `courageAvg` 的折线，X 轴 = 模拟年份，Y 轴 = 平均勇气值。

当某年某境界 `levelCounts[i] === 0` 时，该年该境界的趋势数据点 SHALL 为 `null`，Recharts 折线在该点断开（不连接到 0），准确表达「无数据」。

趋势数据 SHALL 保持最多 2,000 个数据点上限，超出时对旧数据降采样。

#### Scenario: Tab default state
- **WHEN** 模拟启动后趋势图首次渲染
- **THEN** SHALL 默认展示「人口趋势」tab

#### Scenario: Tab switching
- **WHEN** 用户点击「年龄趋势」tab
- **THEN** 图表 SHALL 切换为展示 Lv1–Lv7 各境界 ageAvg 折线，X/Y 轴标签相应变化

#### Scenario: Empty level trend line
- **WHEN** 某年 Lv3 存活修士数为 0
- **THEN** 该年 Lv3 的 ageAvg/courageAvg 数据点 SHALL 为 null，折线在该点断开

#### Scenario: Trend data downsampling
- **WHEN** trend data exceeds 2,000 points
- **THEN** the oldest data SHALL be downsampled to maintain the cap

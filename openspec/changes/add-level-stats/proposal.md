## Why

当前模拟器仅展示各境界人口计数和极值，无法观察修士群体在每个境界的年龄结构和勇气值分布特征。增加按境界分组的统计指标（平均值、中位数），帮助理解不同境界修士的生存状态和行为倾向，并通过历史趋势揭示这些指标随模拟推进的演变规律。

## What Changes

- 在 `SimulationEngine.getSummary()` 中新增按境界分组的 age/courage 统计计算（平均值、中位数）
- 扩展 `YearSummary` 类型，增加 `levelStats` 字段承载每个境界的统计数据
- 扩展现有 `StatsPanel` 组件，以表格形式展示当前年份各境界的 age/courage 平均值和中位数
- 扩展现有 `TrendChart` 组件，增加 tab 切换支持"人口趋势"、"年龄趋势"、"勇气趋势"三个维度

## Capabilities

### New Capabilities
- `level-stats`: 按境界分组的修士年龄和勇气值统计（平均值、中位数），包含引擎计算、数据传输和 UI 展示

### Modified Capabilities
- `simulation-loop`: `YearSummary` 新增 `levelStats` 字段，`getSummary()` 增加统计计算逻辑
- `dashboard`: `StatsPanel` 扩展统计表格，`TrendChart` 增加 tab 切换维度

## Impact

- `src/types.ts`: 新增 `LevelStat` 接口，扩展 `YearSummary`
- `src/engine/simulation.ts`: `getSummary()` 增加统计计算，预分配 buffer 数组
- `src/components/StatsPanel.tsx`: 增加各境界统计表格
- `src/components/TrendChart.tsx`: 增加 tab 切换逻辑，支持 age/courage 趋势线
- `src/index.css`: 新增表格和 tab 样式

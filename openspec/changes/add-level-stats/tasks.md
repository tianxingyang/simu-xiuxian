## 1. 类型与数据结构

- [ ] 1.1 在 `src/types.ts` 中新增 `LevelStat` 接口（ageAvg, ageMedian, courageAvg, courageMedian），扩展 `YearSummary` 增加 `levelStats: LevelStat[]` 字段

## 2. 引擎统计计算

- [ ] 2.1 在 `SimulationEngine` 中预分配 `_ageBuffers: number[][]` 和 `_courageBuffers: number[][]`（各 LEVEL_COUNT 个数组），在 `constructor` 和 `reset()` 中初始化
- [ ] 2.2 扩展 `getSummary()`: 遍历中按 level 累加 age/courage sum 并收集值到 buffer，遍历后计算 avg 和 median，填充 `levelStats` 数组

## 3. UI — StatsPanel 扩展

- [ ] 3.1 修改 `StatsPanel.tsx`：在现有统计指标下方增加各境界统计表格（境界名 / 年龄均值 / 年龄中位数 / 勇气均值 / 勇气中位数），跳过人数为 0 的境界
- [ ] 3.2 在 `src/index.css` 中增加统计表格样式

## 4. UI — TrendChart tab 切换

- [ ] 4.1 修改 `TrendChart.tsx`：增加 `useState` 管理当前 tab（population / age / courage），渲染 tab 按钮组
- [ ] 4.2 根据当前 tab 切换 Recharts LineChart 的 dataKey（population 用 `levelCounts[i]`，age 用 `levelStats[i].ageAvg`，courage 用 `levelStats[i].courageAvg`）
- [ ] 4.3 在 `src/index.css` 中增加 tab 按钮样式

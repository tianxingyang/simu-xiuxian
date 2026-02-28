## Context

当前 `getSummary()` 遍历全部存活修士生成 `YearSummary`，仅包含 `levelCounts`、极值等聚合计数。修士的 `age` 和 `courage` 属性在引擎中可直接访问，但从未按境界分组统计。UI 侧的 `StatsPanel` 只展示标量指标，`TrendChart` 只渲染人口折线。

数据流路径：`SimulationEngine.getSummary()` → Worker `postMessage` → `useSimulation` hook → React 组件。新增统计只需沿此路径扩展，无需新通道。

## Goals / Non-Goals

**Goals:**
- 在 `YearSummary` 中增加按境界分组的 age/courage 平均值和中位数
- 在 `StatsPanel` 中展示当前年份各境界统计表格
- 在 `TrendChart` 中支持 tab 切换，展示 age/courage 历史趋势
- 保持引擎计算性能不显著退化

**Non-Goals:**
- 不增加修为(cultivation)的统计
- 不引入百分位数或其他分布描述
- 不改变 Worker 消息协议结构（仅扩展 `YearSummary` 字段）

## Decisions

### D1: 统计数据结构

`YearSummary` 新增 `levelStats: LevelStat[]`，长度为 `LEVEL_COUNT`（8），index 与 `levelCounts` 对齐。

```typescript
interface LevelStat {
  ageAvg: number;
  ageMedian: number;
  courageAvg: number;
  courageMedian: number;
}
```

当某境界人数为 0 时，四个字段均为 0。

**理由**：扁平数组结构与现有 `levelCounts`/`promotions` 一致，序列化开销最小。

### D2: 中位数计算策略

在 `getSummary()` 遍历中，按 level 收集 age/courage 值到预分配的 buffer 数组，遍历结束后对每个 level 的子数组排序取中位数。

预分配策略：引擎持有 `_ageBuffers: number[][]` 和 `_courageBuffers: number[][]`（各 8 个数组），每次 `getSummary()` 调用前重置 `length = 0`，复用底层 ArrayBuffer 避免 GC。

**理由**：Quickselect 虽然理论复杂度更优 O(N) vs O(N log N)，但 V8 的 `Array.sort()` 对数值数组高度优化，且实现简单零依赖。在万级规模下排序耗时 < 1ms。

### D3: TrendChart tab 切换

在 `TrendChart` 组件内部新增 `useState` 管理当前 tab（`'population' | 'age' | 'courage'`）。三个 tab 共享同一个 `trendData: YearSummary[]` 数据源，仅切换渲染的 dataKey：

| Tab | 渲染内容 |
|-----|---------|
| 人口趋势 | `levelCounts[i]`（现有逻辑） |
| 年龄趋势 | `levelStats[i].ageAvg`，每级一条线 |
| 勇气趋势 | `levelStats[i].courageAvg`，每级一条线 |

趋势图展示平均值而非中位数——折线图中平均值更平滑，中位数在当前快照表格中已可查看。

**理由**：复用现有 `TrendChart` 的 Recharts 基础设施和 `trendData`，无需新增数据通道或组件。

## Risks / Trade-offs

- [内存] 预分配 buffer 在修士极多时占用额外内存 → buffer 仅在 `getSummary()` 期间使用，`length` 重置后旧数据不引用，引擎可在任意时刻安全 GC
- [性能] 排序计算增加 `getSummary()` 耗时 → 仅在需要生成 summary 的 tick 中执行（batch 模式下按 `summaryStride` 间隔），不影响每年的 tick 性能
- [序列化] `YearSummary` 体积增大（新增 8×4 = 32 个 number）→ 增量约 256 bytes/summary，相比现有 events 数据可忽略

# Optimize LLM Report Data (修仙界日报数据优化)

## Goal

重构日报数据管线：删除无价值的"简讯"统计堆砌，引入 server 端 insight 检测系统，只把"意外的变化"喂给 LLM，使天下大势栏目具有真正的信息量。

## Requirements

1. **删除简讯栏目** — 不再向 LLM 提供 B 级聚合统计（combat_deaths/expiry_deaths/promotions 计数）
2. **存储世界快照** — 每次生成报告时将 world_context 存入 reports 表，为跨期对比提供数据基础
3. **实现 insight 检测引擎** — server 端预计算，仅在检测到"意外变化"时产出 insight：
   - **异常偏离 (spike)**: 本期数值远超近 N 期均值
   - **趋势反转 (trend_reversal)**: 连续 N 期同向变化后突然翻转
   - **排名变动 (ranking_change)**: 区域排序发生变化
   - **阈值突破 (threshold)**: 数值首次越过有意义的关口
4. **重构 prompt** — 将 insights 以结构化 YAML 喂给 LLM，指导其写入天下大势；无 insight 则写"天下太平"
5. **日报结构简化** — 从四段式【头条/要闻/简讯/天下大势】变为三段式【头条/要闻/天下大势】

## Acceptance Criteria

- [ ] reports 表新增 world_context 列，生成报告时自动存储
- [ ] 新增 computeInsights() 函数，接收当前 + 历史 world_context，输出 Insight[]
- [ ] 4 种检测器实现：spike / trend_reversal / ranking_change / threshold
- [ ] buildPrompt() 用 insights 替代 statistics，不再包含原始统计数字
- [ ] SYSTEM_MESSAGE 移除简讯栏目，天下大势指引改为基于 insights 撰写
- [ ] 历史数据不足时（前几期）graceful fallback，不报错
- [ ] 无 insight 时 LLM 生成"天下太平"风格的天下大势

## Technical Approach

### Schema Change
- `reports` 表新增 `world_context TEXT` 列（JSON 格式的 WorldContext 快照）

### Insight Detection (server/reporter.ts)
```
computeInsights(current: WorldContext, history: WorldContext[]): Insight[]
```
每个检测器独立运行，仅在触发时产出 insight：
- spike: |current - rollingAvg| > threshold
- trend_reversal: direction(last N deltas) flips
- ranking_change: sorted order of regions changes
- threshold: value crosses predefined milestones

### Data Flow (revised)
```
events → aggregateEvents() → headlines + major_events (S/A only)
world_context + history → computeInsights() → Insight[]
buildPrompt(headlines, major_events, insights) → LLM → 日报
store world_context snapshot → reports table
```

### Insight YAML Format (fed to LLM)
```yaml
insights:
  - type: spike
    dimension: "裂潮海岸战斗陨落"
    current: 45
    recent_avg: 20
    note: "远超近期均值"
  - type: trend_reversal
    dimension: "总人口"
    direction: "由降转升"
    streak_broken: 5
```

## Out of Scope

- 前端展示优化（本次只改数据管线和 prompt）
- B 级事件个体叙事（已确认无价值）
- 来源一/二的 named_cultivator 生涯挖掘（静态状态无新闻价值）
- 新事件类型扩展（不改 simulation engine）

## Technical Notes

### Key Files to Modify
- `server/reporter.ts` — 核心：删 statistics, 加 computeInsights, 改 buildPrompt, 改 SYSTEM_MESSAGE
- `server/db.ts` — schema migration + 新查询函数 queryRecentWorldContexts(n)
- `server/ipc.ts` — WorldContext 类型已存在，无需修改

### Edge Cases
- 前几期报告无历史数据：insight 检测 graceful skip，天下大势 fallback 到基础描写
- world_context 未提供时（无模拟运行）：跳过 insight 检测
- 所有检测器均未触发：天下大势写"天下太平"

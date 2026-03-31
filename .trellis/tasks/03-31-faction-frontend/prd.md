# 势力系统前端展示

## Goal

为已实现的势力系统 MVP 后端添加前端展示，让用户能看到势力的形成、成员和领地信息。

## Prerequisites

- 势力系统后端已实现（03-20-faction-system）
- `YearSummary` 已包含 `factionCount`
- `Faction` 接口、`RichFactionFoundedEvent`/`RichFactionDissolvedEvent` 事件类型已定义

## Requirements

### R1: Dashboard 势力面板
- 在 Dashboard 中新增势力信息展示区域
- 显示当前势力总数

### R2: 势力列表
- 展示所有存活势力：名称、宗主、区域、成员数、建立年份
- 按成员数或建立时间排序

### R3: 势力事件
- 在 EventLog 中展示势力创建/解散事件
- 格式与现有事件风格一致

### R4: 地图领地着色（可选）
- 在地图上用颜色区分不同势力的领地
- 如地图组件改动过大可推迟

## Acceptance Criteria

- [ ] Dashboard 展示势力总数
- [ ] 可查看势力列表（名称、宗主、区域、成员数）
- [ ] EventLog 显示势力创建/解散事件
- [ ] WebSocket 通信正常传递势力数据

## Out of Scope

- 势力详情页（点击查看成员列表）
- 势力战争/外交的 UI
- 势力统计趋势图

## Technical Notes

- 势力数据可通过扩展 `YearSummary` 或新增 `FromServer` 消息类型传递
- 参考现有 `StatsPanel.tsx`、`EventLog.tsx` 组件模式
- 遵循 `src/components/` 现有组件规范

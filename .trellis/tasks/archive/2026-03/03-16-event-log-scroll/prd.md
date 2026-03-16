# Event Log Auto-Scroll UX Improvement

## Goal

事件日志在模拟运行时每 500ms 更新一次，新事件 prepend 到列表顶部，导致用户还没来得及阅读就被刷走。需要实现"智能滚动"机制，让用户能暂停查看历史事件。

## What I already know

* EventLog 组件 (`src/components/EventLog.tsx`) 接收 `events: SimEvent[]`，显示前 100 条
* 新事件通过 `eventBatch.concat(prev.events)` prepend 到数组头部（最新在上）
* useSimulation hook 每 500ms 通过 `startTransition` 提交一次 UI 更新
* 事件列表容器 `.event-list` 有 `overflow-y: auto` 滚动
* 已有境界过滤器（levelFilter）

## Requirements

- [ ] 用户滚动离开顶部时，冻结列表更新，不再插入新事件到可视区域
- [ ] 冻结期间显示"N 条新事件"提示，点击回到顶部并恢复自动更新
- [ ] 用户手动滚回顶部时自动恢复实时更新
- [ ] 不影响现有的境界过滤功能

## Acceptance Criteria

- [ ] 列表在顶部时自动显示最新事件（现有行为不变）
- [ ] 向下滚动后，列表内容冻结，不因新事件到来而跳动
- [ ] 冻结状态下有明确的视觉提示，显示待查看的新事件数量
- [ ] 点击提示或滚回顶部后恢复实时更新
- [ ] 性能无退化（仍使用 memo + startTransition）

## Decision (ADR-lite)

**Context**: 冻结期间新事件需要缓存，需决定缓存上限策略
**Decision**: 缓存 + 已显示事件总量共享 MAX_EVENTS 上限，超出时丢弃最旧事件
**Consequences**: 与现有行为一致，无内存风险；极长时间冻结后旧事件会被淘汰

## Out of Scope

- 事件搜索/全文检索
- 事件详情展开面板
- 导出事件日志
- 改变事件数量上限

## Technical Notes

* EventLog 已用 `memo()` 包裹，性能良好
* 核心改动限于 `EventLog.tsx`，不需要修改 hook 或 state 结构
* 参考模式：终端/聊天应用的 "stick to bottom"，此处为 "stick to top"

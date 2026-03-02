## MODIFIED Requirements

### Requirement: Worker-UI communication
前端 SHALL 通过 WebSocket（而非 Web Worker postMessage）与后端通信。消息格式保持不变。

Command messages from frontend to server (via WebSocket): start (with speed tier, seed, initialPop), pause, step, setSpeed, reset, ack. Data messages from server to frontend (via WebSocket): tick (with YearSummary array and display events), paused, reset-done, state.

新增 `state` 消息类型：`{ type: 'state', year, running, speed, summary }` — 客户端连接时服务端推送的状态快照。

#### Scenario: WebSocket connection and state sync
- **WHEN** 前端通过 WebSocket 连接后端
- **THEN** SHALL 立即收到 `{ type: 'state', ... }` 消息，前端 SHALL 用该消息初始化仪表盘状态

#### Scenario: Batch mode with backpressure
- **WHEN** server runner 完成 100 年计算（Tier 1）
- **THEN** SHALL 向所有客户端广播一条 `{ type: 'tick', summaries: [...], events: [...] }` 消息，然后等待 ack

#### Scenario: ACK message type
- **WHEN** 前端处理完 tick 消息
- **THEN** SHALL 发送 `{ type: 'ack' }` 到 WebSocket server

### Requirement: Frontend connection management
`useSimulation` hook SHALL 管理 WebSocket 连接生命周期，包括：

- 组件挂载时建立 WebSocket 连接
- 断线自动重连（指数退避，初始 1s，最大 30s）
- 连接状态暴露为 `connectionStatus: 'connected' | 'connecting' | 'disconnected'`
- 组件卸载时关闭连接

#### Scenario: Auto-reconnect on disconnect
- **WHEN** WebSocket 连接意外断开
- **THEN** SHALL 在 1 秒后尝试重连，失败则按指数退避重试（2s, 4s, 8s, ... 最大 30s）

#### Scenario: Reconnect state sync
- **WHEN** 前端重连成功
- **THEN** SHALL 收到 server 的 state 消息，用当前模拟状态更新仪表盘

#### Scenario: Connection status exposed
- **WHEN** 连接断开
- **THEN** `connectionStatus` SHALL 变为 'disconnected'，前端 Controls 组件 SHALL 展示连接状态指示

### Requirement: rAF render throttle
主线程 SHALL 使用 `requestAnimationFrame` 缓冲合并 WebSocket 消息。`onmessage` 回调仅将消息 push 到缓冲区（`tick` 和 `paused` 消息），不直接调用 `setState`。`reset-done` 和 `state` 消息 SHALL 绕过缓冲区直接在 `onmessage` 中处理。每帧至多触发一次 `setState`。

flush 逻辑、合并规则、事件/趋势数据的 startTransition 延迟渲染均与现有行为保持一致。

#### Scenario: Multiple messages merged into single render
- **WHEN** 两条 tick 消息在同一帧内到达
- **THEN** SHALL 合并为单次 setState

#### Scenario: ACK sent after flush
- **WHEN** rAF 回调 flush 完所有缓冲消息（含 tick）
- **THEN** SHALL 向 WebSocket server 发送恰好一个 `{ type: 'ack' }`

#### Scenario: State message bypasses buffer
- **WHEN** 收到 `{ type: 'state' }` 消息
- **THEN** SHALL 立即处理，不进入 rAF 缓冲区

### Requirement: Statistics panel
统计面板 SHALL 展示：总人口、本年新增、本年死亡（战斗+寿尽分项）、本年晋升、最高境界、最高修为。面板 SHALL 额外展示一个按境界分组的统计表格，固定展示全部 8 个境界行（Lv0-Lv7），列为：境界名、年龄均值、年龄中位数、勇气均值、勇气中位数。

数据源从 Web Worker 消息改为 WebSocket 消息，但数据格式（`YearSummary`）不变。

#### Scenario: Stats update
- **WHEN** a year summary arrives from WebSocket server
- **THEN** all statistics SHALL reflect the latest year's data

#### Scenario: Level stats table display
- **WHEN** 当前年份 Lv0 有 5000 名修士、Lv1 有 200 名修士、Lv2 有 10 名修士
- **THEN** 统计表格 SHALL 展示这三个境界各自的 ageAvg、ageMedian、courageAvg、courageMedian 数值

#### Scenario: Empty level display
- **WHEN** 某境界存活修士数为 0
- **THEN** 该境界行 SHALL 保持显示，四个统计列 SHALL 展示「-」而非数值

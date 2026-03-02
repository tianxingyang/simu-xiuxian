## ADDED Requirements

### Requirement: Node.js HTTP server
后端 SHALL 启动一个 HTTP server（Node.js 原生 `http` 模块），监听可配置端口（默认 3000）。该 server SHALL 提供 WebSocket upgrade 和 REST 端点。

#### Scenario: Server startup
- **WHEN** `server/index.ts` 启动
- **THEN** SHALL 在配置端口上监听 HTTP 请求，控制台输出监听地址

#### Scenario: Health check
- **WHEN** 客户端 GET `/health`
- **THEN** SHALL 返回 200 和 `{ status: 'ok', year: <当前模拟年份> }`

### Requirement: WebSocket connection
后端 SHALL 在 HTTP server 上提供 WebSocket 端点（路径 `/ws`）。支持多个客户端同时连接。每个客户端连接后 SHALL 立即收到一条 `state` 消息，包含当前模拟状态快照。

#### Scenario: Client connects
- **WHEN** 前端通过 WebSocket 连接 `ws://<host>:<port>/ws`
- **THEN** SHALL 建立连接并立即推送 `{ type: 'state', year, running, speed, summary }` 消息

#### Scenario: Multiple clients
- **WHEN** 两个前端客户端同时连接
- **THEN** 两者 SHALL 都收到 tick/paused 等实时数据推送

#### Scenario: Client disconnect
- **WHEN** 客户端断开 WebSocket 连接
- **THEN** 后端 SHALL 清理该连接，不影响模拟运行和其他客户端

### Requirement: WebSocket command protocol
后端 SHALL 接收与现有 `ToWorker` 格式一致的 JSON 命令消息：`start`、`pause`、`step`、`setSpeed`、`reset`、`ack`。命令语义与现有 Web Worker 保持一致。

#### Scenario: Start command
- **WHEN** 客户端发送 `{ type: 'start', speed: 1, seed: 42, initialPop: 1000 }`
- **THEN** 引擎 SHALL 初始化（如未初始化）并开始运行

#### Scenario: Pause command
- **WHEN** 客户端发送 `{ type: 'pause' }`
- **THEN** 引擎 SHALL 停止运行，所有客户端 SHALL 收到 `{ type: 'paused', reason: 'manual' }`

#### Scenario: Reset command
- **WHEN** 客户端发送 `{ type: 'reset', seed: 123, initialPop: 2000 }`
- **THEN** 引擎 SHALL 销毁并重建，所有客户端 SHALL 收到 `{ type: 'reset-done' }`

#### Scenario: Command from any client
- **WHEN** 多客户端连接且其中一个发送 pause 命令
- **THEN** 所有客户端 SHALL 收到 paused 消息

### Requirement: WebSocket data broadcast
后端 SHALL 向所有已连接客户端广播 `tick`、`paused`、`reset-done` 消息。消息格式与现有 `FromWorker` 一致。

#### Scenario: Tick broadcast
- **WHEN** 引擎完成一批计算
- **THEN** 所有已连接客户端 SHALL 收到 `{ type: 'tick', summaries: [...], events: [...] }`

#### Scenario: No clients connected
- **WHEN** 引擎运行但无客户端连接
- **THEN** 引擎 SHALL 继续运行，tick 数据 SHALL 仍然被事件系统处理（持久化），但不发送 WebSocket 消息

### Requirement: ACK backpressure adaptation
后端 SHALL 实现 ACK 背压机制。引擎发送 tick 后 SHALL 等待至少一个客户端的 `ack` 消息才调度下一批。当无客户端连接时，引擎 SHALL 自动 ack（无背压）以保持持续运行。

#### Scenario: Single client backpressure
- **WHEN** 一个客户端连接且引擎发送 tick
- **THEN** 引擎 SHALL 等待该客户端的 ack 才调度下一批

#### Scenario: No clients — auto ack
- **WHEN** 无客户端连接且引擎发送 tick
- **THEN** 引擎 SHALL 自动视为已 ack，立即调度下一批

#### Scenario: Multiple clients — first ack wins
- **WHEN** 多个客户端连接且引擎发送 tick
- **THEN** 收到第一个 ack 即 SHALL 解除背压，后续 ack SHALL 被忽略

### Requirement: Engine runner lifecycle
`server/runner.ts` SHALL 封装 `SimulationEngine` 的生命周期管理，替代 `worker.ts` 的角色。SHALL 使用 `setTimeout` 调度批量循环。SHALL 支持 start/pause/step/setSpeed/reset 操作。

#### Scenario: Start creates engine
- **WHEN** runner 收到 start 命令且引擎未初始化
- **THEN** SHALL 创建 `SimulationEngine(seed, initialPop)` 并开始批量循环

#### Scenario: Batch loop timing
- **WHEN** 引擎以速度档 1 运行（BATCH_SIZE=100）
- **THEN** 每批计算完成后 SHALL 等待至 TARGET_INTERVAL（2000ms），然后发送 tick 并等待 ack

#### Scenario: Reset destroys and recreates
- **WHEN** runner 收到 reset 命令
- **THEN** SHALL 停止当前运行、销毁引擎、用新参数创建引擎

#### Scenario: Every tick collects events
- **WHEN** 引擎运行批量循环
- **THEN** 每个 tick（而非仅 batch 最后一个 tick）SHALL 收集事件，以确保不遗漏重要事件

### Requirement: Manual report trigger endpoint
后端 SHALL 提供 `POST /api/report` REST 端点，手动触发日报生成。

#### Scenario: Manual trigger
- **WHEN** 客户端 POST `/api/report`
- **THEN** SHALL 触发日报聚合 + LLM 润色 + QQ 推送流程，返回 `{ status: 'ok', reportId }` 或错误信息

#### Scenario: Concurrent trigger protection
- **WHEN** 日报正在生成时再次触发
- **THEN** SHALL 返回 `{ status: 'busy' }` 而非重复生成

### Requirement: Simulation state persistence
后端 SHALL 在 SQLite `sim_state` 表中持久化引擎关键状态（current_year, seed, speed, running, highest_levels_ever），以支持进程重启后恢复。

#### Scenario: State saved periodically
- **WHEN** 引擎每完成一批计算
- **THEN** SHALL 将当前年份和运行状态写入 sim_state 表

#### Scenario: Process restart recovery
- **WHEN** 后端进程重启
- **THEN** SHALL 从 sim_state 读取上次状态，提示用户是否恢复（或自动恢复到暂停状态）

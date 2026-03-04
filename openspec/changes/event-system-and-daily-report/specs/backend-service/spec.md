## ADDED Requirements

### Requirement: Node.js HTTP server
后端 SHALL 启动一个 HTTP server（Node.js 原生 `http` 模块），监听可配置端口（默认 3000），绑定地址 SHALL 默认为 `0.0.0.0`（可通过 `HOST` 环境变量覆盖）。该 server SHALL 提供 WebSocket upgrade 和 REST 端点。

SQLite 数据库文件路径 SHALL 默认为 `./data/simu-xiuxian.db`（可通过 `DB_PATH` 环境变量覆盖）。启动时 SHALL 自动创建 `data/` 目录（如不存在）。

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

多客户端同时发送冲突命令时 SHALL 按消息到达顺序（先到先得）处理，无优先级区分。

收到非法 JSON 或未知消息类型时 SHALL 记录警告日志并忽略该消息，不关闭连接。

#### Scenario: Start command
- **WHEN** 客户端发送 `{ type: 'start', speed: 1, seed: 42, initialPop: 1000 }`
- **THEN** 引擎 SHALL 初始化（如未初始化）并开始运行

#### Scenario: Pause command
- **WHEN** 客户端发送 `{ type: 'pause' }`
- **THEN** 引擎 SHALL 停止运行，所有客户端 SHALL 收到 `{ type: 'paused', reason: 'manual' }`

#### Scenario: Reset command
- **WHEN** 客户端发送 `{ type: 'reset', seed: 123, initialPop: 2000 }`
- **THEN** 引擎 SHALL 销毁并重建，所有客户端 SHALL 收到 `{ type: 'reset-done' }`。reset SHALL 清空 `named_cultivators`、`events`、`sim_state` 表（`daily_reports` 保留）。身份系统的姓名去重集合 SHALL 同步清空。

#### Scenario: Command from any client
- **WHEN** 多客户端连接且其中一个发送 pause 命令
- **THEN** 所有客户端 SHALL 收到 paused 消息

#### Scenario: Conflicting commands
- **WHEN** 客户端 A 发送 `start`，客户端 B 几乎同时发送 `pause`
- **THEN** SHALL 按消息到达服务端的顺序依次处理

### Requirement: WebSocket data broadcast
后端 SHALL 向所有已连接客户端广播 `tick`、`paused`、`reset-done` 消息。消息格式与现有 `FromWorker` 一致。

#### Scenario: Tick broadcast
- **WHEN** 引擎完成一批计算
- **THEN** 所有已连接客户端 SHALL 收到 `{ type: 'tick', tickId: N, summaries: [...], events: [...] }`

#### Scenario: No clients connected
- **WHEN** 引擎运行但无客户端连接
- **THEN** 引擎 SHALL 继续运行，tick 数据 SHALL 仍然被事件系统处理（持久化），但不发送 WebSocket 消息

### Requirement: ACK backpressure adaptation
后端 SHALL 实现 ACK 背压机制。引擎发送 tick（携带单调递增 `tickId`）后 SHALL 等待至少一个客户端的 `{ type: 'ack', tickId }` 消息才调度下一批。仅接受 tickId 匹配的 ack。当无客户端连接时，引擎 SHALL 自动 ack（无背压）以保持持续运行。

#### Scenario: Single client backpressure
- **WHEN** 一个客户端连接且引擎发送 tick
- **THEN** 引擎 SHALL 等待该客户端的 ack 才调度下一批

#### Scenario: No clients — auto ack
- **WHEN** 无客户端连接且引擎发送 tick
- **THEN** 引擎 SHALL 自动视为已 ack，立即调度下一批

#### Scenario: Multiple clients — first ack wins
- **WHEN** 多个客户端连接且引擎发送 tick
- **THEN** 收到第一个 ack 即 SHALL 解除背压，后续 ack SHALL 被忽略

#### Scenario: Last client disconnects during awaitingAck
- **WHEN** `awaitingAck === true` 且最后一个客户端断开连接
- **THEN** SHALL 立即触发 auto-ack（连接数降为 0 时检测），引擎继续运行

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
后端 SHALL 提供 `POST /api/report` REST 端点，手动触发日报生成。支持可选查询参数 `?date=YYYY-MM-DD` 指定目标日期，默认为昨天（UTC+8）。

#### Scenario: Manual trigger
- **WHEN** 客户端 POST `/api/report`
- **THEN** SHALL 触发昨天的日报聚合 + LLM 润色 + QQ 推送流程，返回 `{ status: 'ok', reportId }` 或错误信息

#### Scenario: Manual trigger with date
- **WHEN** 客户端 POST `/api/report?date=2026-03-01`
- **THEN** SHALL 聚合 2026-03-01（UTC+8）的事件并生成日报

#### Scenario: Concurrent trigger protection
- **WHEN** 日报正在生成时再次触发
- **THEN** SHALL 返回 `{ status: 'busy' }` 而非重复生成

### Requirement: Simulation state persistence
后端 SHALL 在 SQLite `sim_state` 表中持久化引擎关键状态（current_year, seed, speed, running, highest_levels_ever），以支持进程重启后恢复。

#### Scenario: State saved periodically
- **WHEN** 引擎每完成一批计算
- **THEN** SHALL 将当前年份和运行状态写入 sim_state 表

#### Scenario: Process restart recovery
- **WHEN** 后端进程重启且 sim_state 中存在有效记录
- **THEN** SHALL 从 sim_state 读取上次状态，自动重建引擎到上次年份，以暂停状态启动。用户通过前端发送 start 命令继续。身份系统 SHALL 从 `named_cultivators` 表重建内存活跃 Map 和姓名去重集合。

#### Scenario: Startup missed-report backfill
- **WHEN** 后端进程启动时，检测到 `daily_reports` 表中昨天（UTC+8）无记录，且 `events` 表中存在昨天的事件
- **THEN** SHALL 自动触发一次昨天的日报生成

### Requirement: Batch persistence transaction
每批计算完成后的落库操作（events INSERT + named_cultivators UPDATE + sim_state UPDATE）SHALL 在单个 SQLite 事务中执行。事务失败时 SHALL 记录错误日志并继续引擎运行（事件数据丢失但模拟不中断）。

#### Scenario: Batch persistence success
- **WHEN** 引擎完成一批计算，产生 30 个事件和 5 个修士履历变更
- **THEN** SHALL 在单个 BEGIN/COMMIT 事务中完成所有 INSERT/UPDATE

#### Scenario: Batch persistence failure
- **WHEN** SQLite 写入失败（磁盘满/IO 错误）
- **THEN** 事务 SHALL 回滚，引擎 SHALL 继续运行，错误 SHALL 记录到日志

## PBT Properties

### Property: State snapshot on connect
每个成功的 `/ws` 连接收到的第一条消息 SHALL 始终为 `state` 类型，先于任何 `tick/paused/reset-done`。
- **Falsification**: 并发建立/断开连接并截取每个客户端的消息序列，验证首条消息类型。

### Property: Command effect ordering
合法命令的效果 SHALL 严格按服务端到达顺序生效；非法 JSON / 未知类型为无操作且不关闭连接。
- **Falsification**: 多客户端随机延迟发送冲突命令 + 畸形 payload，对比效果日志与到达日志。

### Property: Broadcast completeness
每条 `tick/paused/reset-done` 消息 SHALL 恰好送达发送时刻所有已连接客户端（exactly-once per client）。
- **Falsification**: 随机化客户端加入/离开时机，排列内部客户端迭代顺序，验证接收集合一致性。

### Property: ACK backpressure FSM
`awaitingAck` 状态机仅允许以下转移：tick（有客户端）`false→true`、匹配 tickId 的 ack `true→false`、无客户端/断连 auto-ack `true→false`、start/pause/reset 强制 `→false`。
- **Falsification**: 模型驱动状态 PBT，随机命令/ack/客户端数量，对比实现轨迹与 FSM oracle。

### Property: Batch persistence atomicity
每批落库要么 events+named_cultivators+sim_state 全部提交，要么全部回滚（all-or-nothing）。
- **Falsification**: 在事务内随机位置注入 SQLite 故障，验证三张表的 delta 一致性。

### Property: Restart round-trip
persist→restart 后重建的引擎状态 SHALL 与最后一次保存的 `{current_year, seed, speed, highest_levels_ever}` 一致，且身份去重集合与 DB 一致。
- **Falsification**: 随机引擎状态 → 保存 → 重启循环，对比重建状态哈希。

### Property: Report concurrency lock
对同一目标日期的并发 `POST /api/report` 最多启动一个生成任务，其余返回 `{status:'busy'}`。
- **Falsification**: 高并发相同/不同日期请求，验证单飞行任务语义。

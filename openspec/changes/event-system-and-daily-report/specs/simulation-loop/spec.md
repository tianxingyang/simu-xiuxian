## MODIFIED Requirements

### Requirement: Worker backpressure via ACK

引擎批量循环的背压机制 SHALL 从 Web Worker postMessage 迁移到 WebSocket server 端实现。

Server runner 在批量模式下发送 `tick` 消息到所有 WebSocket 客户端后 SHALL 设置 `awaitingAck = true` 并停止调度下一批，直到收到任一客户端的 `{ type: 'ack', tickId }` 消息。每条 `tick` 消息 SHALL 携带单调递增的 `tickId: number`（从 1 开始）。客户端收到 tick 后 SHALL 在 ack 中回传相同 `tickId`。runner 仅接受 `tickId` 与当前等待值匹配的 ack，不匹配的 SHALL 忽略。当无客户端连接时，runner SHALL 自动视为 ack（不阻塞），以保持引擎持续运行。

收到匹配 `tickId` 的 `ack` 且 `awaitingAck === true` 时 SHALL 设置 `awaitingAck = false` 并通过 `setTimeout(runBatch, 0)` 调度下一批。

`step` 模式不受背压影响 — 单步执行后直接返回结果，不设置 `awaitingAck`。

状态重置规则：
- `start` 命令 SHALL 重置 `awaitingAck = false`，然后直接调用 `runBatch()`
- `pause` 命令 SHALL 重置 `awaitingAck = false`（通过 `stop()`）
- `reset` 命令 SHALL 重置 `awaitingAck = false`（通过 `stop()`）
- `setSpeed` 命令 SHALL 仅更新 `speed`，不影响 `awaitingAck` 状态

#### Scenario: Server waits for ACK before next batch
- **WHEN** Server runner 完成一批计算并向所有客户端发送 `{ type: 'tick', tickId: N, ... }` 消息
- **THEN** runner SHALL NOT 调度下一批，直到收到任一客户端的 `{ type: 'ack', tickId: N }`

#### Scenario: ACK resumes batch loop
- **WHEN** runner 收到客户端 `{ type: 'ack', tickId: N }` 且 `awaitingAck === true` 且当前等待的 tickId 为 N 且 `running === true`
- **THEN** runner SHALL 设置 `awaitingAck = false` 并调度 `setTimeout(runBatch, 0)` 执行下一批

#### Scenario: Stale ACK ignored
- **WHEN** runner 收到 `{ type: 'ack', tickId: M }` 但当前等待的 tickId 为 N（M ≠ N）
- **THEN** runner SHALL 忽略该消息

#### Scenario: No clients — auto ACK
- **WHEN** 无 WebSocket 客户端连接且 runner 完成一批计算
- **THEN** runner SHALL 自动解除背压，立即调度下一批

#### Scenario: ACK when not awaiting is no-op
- **WHEN** runner 收到 `{ type: 'ack', tickId: N }` 但 `awaitingAck === false`
- **THEN** runner SHALL 忽略该消息

命令处理时机：所有 WebSocket 命令（start/pause/step/setSpeed/reset）SHALL 在两次 tick 计算之间处理。若命令在 batch 计算期间到达，SHALL 排队等待当前 tick 完成后再处理。

#### Scenario: Step mode unaffected by backpressure
- **WHEN** 用户在暂停状态下执行单步
- **THEN** runner SHALL 执行一年并立即返回结果，不需要 ACK

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=MORTAL_MAX_AGE(60), injuredUntil=0`. The `courage` attribute SHALL be sampled from truncated normal distribution with μ=0.50, σ=0.15, bounds [0.01, 1.00], using Box-Muller transform + rejection sampling on seeded PRNG, then rounded to two decimal places via `round2`。超出 [0.01, 1.00] 的值 SHALL 重新采样而非 clamp。Each cultivator SHALL have a unique numeric ID (monotonically increasing integer).

`injuredUntil=0` 表示未受伤。该字段 SHALL 仅由战败结局系统设置。

晋升到 Lv2 时 SHALL 触发命名（见 `cultivator-identity` spec）。创建时不命名。

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, injuredUntil=0, a unique ID, and no name

#### Scenario: Courage range
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL all be in [0.01, 1.00]，且每个值 SHALL 为精确的两位小数

### Requirement: Simulation termination
The simulation SHALL stop under two conditions: (1) client sends pause command via WebSocket, or (2) total population reaches zero. When population reaches zero, the server SHALL broadcast paused message to all clients with reason 'extinction'.

When extinction occurs during a batch, server runner SHALL 广播 `tick`（含已计算的数据）+ `paused` 消息到所有客户端，然后停止。不需要等待 ACK。

#### Scenario: Manual pause
- **WHEN** any client sends pause command via WebSocket
- **THEN** simulation SHALL stop after completing the current year, all clients SHALL receive paused message

#### Scenario: Population extinction
- **WHEN** all cultivators die (total population = 0) at end of a year
- **THEN** simulation SHALL auto-pause, all clients SHALL receive `{ type: 'paused', reason: 'extinction' }`

#### Scenario: Extinction stops without ACK
- **WHEN** extinction occurs during batch computation
- **THEN** server runner SHALL broadcast tick + paused messages and stop, without waiting for ACK

## PBT Properties

### Property: awaitingAck FSM correctness
状态机仅允许 spec 定义的转移：batch tick(有客户端) `false→true`、匹配 tickId 的 ack `true→false`、ack 不匹配/不等待时为 no-op、start/pause/reset 强制 `→false`、step 永不设为 `true`。
- **Falsification**: 模型驱动状态 PBT，随机命令/ack/客户端数量序列，对比实现轨迹与 FSM oracle。

### Property: Cultivator creation field template
新修士字段固定 `(age=10, cultivation=0, level=0, maxAge=60, injuredUntil=0, name=nil)`，`courage ∈ [0.01, 1.00]` 精确两位小数，ID 严格递增唯一。
- **Falsification**: 大量 seeded 创建，断言字段模板、数值边界/精度、ID 单调性。

### Property: Termination reason constraints
暂停原因 SHALL 仅为 `'manual'` 或 `'extinction'`。extinction 期间 SHALL 先发 tick 再发 paused，且不等待 ACK。
- **Falsification**: 高死亡率 + 延迟/缺失 ACK + 随机手动暂停，验证终止消息顺序和原因枚举。

### Property: Command queue inter-tick processing
所有命令在两次 tick 之间处理，不在计算中途生效。
- **Falsification**: 在 batch 计算期间发送命令，验证命令效果仅在 tick 边界体现。

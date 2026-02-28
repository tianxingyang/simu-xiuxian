## ADDED Requirements

### Requirement: Worker backpressure via ACK

Worker 在批量模式下发送 `tick` 消息后 SHALL 设置 `awaitingAck = true` 并停止调度下一批，直到收到主线程的 `{ type: 'ack' }` 消息。收到 `ack` 且 `awaitingAck === true` 时 SHALL 设置 `awaitingAck = false` 并通过 `setTimeout(runBatch, 0)` 调度下一批。

`step` 模式不受背压影响 — 单步执行后直接返回结果，不设置 `awaitingAck`，不进入等待状态。主线程可能对 step 产生的 tick 发送 ack，Worker SHALL 因 `awaitingAck === false` 忽略之。

状态重置规则：
- `start` 命令 SHALL 重置 `awaitingAck = false`，然后直接调用 `runBatch()`
- `pause` 命令 SHALL 重置 `awaitingAck = false`（通过 `stop()`）
- `reset` 命令 SHALL 重置 `awaitingAck = false`（通过 `stop()`）
- `setSpeed` 命令 SHALL 仅更新 `speed`，不影响 `awaitingAck` 状态

#### Scenario: Worker waits for ACK before next batch
- **WHEN** Worker 完成一批计算并发送 `tick` 消息
- **THEN** Worker SHALL NOT 调度下一批，直到收到 `{ type: 'ack' }`

#### Scenario: ACK resumes batch loop
- **WHEN** Worker 收到 `{ type: 'ack' }` 且 `awaitingAck === true` 且 `running === true`
- **THEN** Worker SHALL 设置 `awaitingAck = false` 并调度 `setTimeout(runBatch, 0)` 执行下一批

#### Scenario: ACK when not awaiting is no-op
- **WHEN** Worker 收到 `{ type: 'ack' }` 但 `awaitingAck === false`（如 step 模式后的 ack、pause 后的迟到 ack）
- **THEN** Worker SHALL 忽略该消息，不调度任何操作

#### Scenario: ACK when paused is no-op
- **WHEN** Worker 收到 `{ type: 'ack' }` 但 `running === false`
- **THEN** Worker SHALL 忽略该消息，不调度任何操作

#### Scenario: Step mode unaffected by backpressure
- **WHEN** 用户在暂停状态下执行单步
- **THEN** Worker SHALL 执行一年并立即返回结果，不需要 ACK

### Properties (PBT)

#### P1: Single-flight guarantee
**Invariant**: `count(unacked_batches_in_flight) ∈ {0, 1}` — Worker 在连续模式下最多有一个未确认的批次。
**Falsification**: 高频注入 start/step/pause/ack 命令序列，对 Worker 插桩计数 tick 发送/ack 接收，断言计数器永不超过 1。

#### P2: Reset idempotency
**Invariant**: `reset(reset(S)) = reset(S)` — 对任意脏状态（awaitingAck=true, 非空 buffer, pending rAF）连续 reset 等价于一次 reset。
**Falsification**: 生成随机脏状态，连续 reset 2..N 次，断言最终状态一致（buffer=[], awaitingAck=false, running=false）。

#### P3: ACK noop idempotency
**Invariant**: `(!awaitingAck || !running) ⟹ ack(S) = S` — 不在等待状态时，任意数量的 ack 不改变系统状态。
**Falsification**: 在 step/stopped/extinction/reset-after 状态下批量发送 ack，断言无 runBatch 调度。

#### P4: Liveness (no deadlock)
**Invariant**: `(running ∧ ¬extinct) ⟹ ◇(year > currentYear)` — 运行中的系统始终能推进模拟年份。
**Falsification**: 随机 start/pause/setSpeed/step 命令 + 变化的消息延迟，检测是否存在 `running=true ∧ awaitingAck=true` 持续超过一个 rAF 周期的死锁。

#### P5: Batch size bound
**Invariant**: `yearsPerBatch ∈ {100, 500, 1000}` — 连续模式批次大小严格受限于 BATCH_SIZES 映射。
**Falsification**: 运行中切换 speed tier，断言每次 tick 的 summaries.length 属于允许集合。

## MODIFIED Requirements

### Requirement: Simulation termination
The simulation SHALL stop under two conditions: (1) user manually pauses, or (2) total population reaches zero. When population reaches zero, the simulation SHALL auto-pause and the UI SHALL indicate the reason.

When extinction occurs during a batch, Worker SHALL 发送 `tick`（含已计算的数据）+ `paused` 消息，然后停止。不需要等待 ACK。

#### Scenario: Manual pause
- **WHEN** user clicks pause
- **THEN** simulation SHALL stop after completing the current year

#### Scenario: Population extinction
- **WHEN** all cultivators die (total population = 0) at end of a year
- **THEN** simulation SHALL auto-pause and UI SHALL display an extinction notice

#### Scenario: Extinction stops without ACK
- **WHEN** extinction occurs during batch computation
- **THEN** Worker SHALL post tick + paused messages and stop, without waiting for ACK

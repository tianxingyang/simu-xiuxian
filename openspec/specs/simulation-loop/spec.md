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

### Requirement: YearSummary levelStats field
`YearSummary` SHALL 包含 `levelStats: LevelStat[]` 字段，长度为 `LEVEL_COUNT`（8），index 与 `levelCounts` 对齐。该字段 SHALL 在每次 `getSummary()` 调用时计算并填充。

#### Scenario: levelStats array length
- **WHEN** `getSummary()` 生成 `YearSummary`
- **THEN** `levelStats` 数组长度 SHALL 为 8

#### Scenario: levelStats alignment with levelCounts
- **WHEN** `levelCounts[2]` 为 50（Lv2 有 50 名修士）
- **THEN** `levelStats[2]` SHALL 反映这 50 名 Lv2 修士的 age/courage 统计

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=MORTAL_MAX_AGE(60), injuredUntil=0`. The `courage` attribute SHALL be sampled from truncated normal distribution with μ=0.50, σ=0.15, bounds [0.01, 1.00], using Box-Muller transform + rejection sampling on seeded PRNG, then rounded to two decimal places via `round2`。超出 [0.01, 1.00] 的值 SHALL 重新采样而非 clamp。Each cultivator SHALL have a unique numeric ID (monotonically increasing integer).

`injuredUntil=0` 表示未受伤。该字段 SHALL 仅由战败结局系统设置。

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, injuredUntil=0, and a unique ID

#### Scenario: Courage range
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL all be in [0.01, 1.00]，且每个值 SHALL 为精确的两位小数

#### Scenario: Courage truncated normal distribution
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL approximate a normal distribution with μ≈0.50, σ≈0.15，约 68% 的值落在 [0.35, 0.65] 范围内，且边界处无概率堆积

#### Scenario: No boundary spike
- **WHEN** 10000 cultivators are created
- **THEN** courage=0.01 和 courage=1.00 的频次 SHALL NOT 显著高于相邻值（即无 clamp 导致的边界堆积）

### Requirement: Injured cultivation growth
`naturalCultivation` SHALL 对重伤修士（`injuredUntil > currentYear`）应用减速因子。重伤修士每年修为增长 SHALL 为 `INJURY_GROWTH_RATE`(0.5) 而非 1。年龄增长不受影响。

```
for each alive cultivator c:
  c.age += 1
  if c.injuredUntil > this.year:
    c.cultivation += INJURY_GROWTH_RATE   // 0.5
  else:
    c.cultivation += 1
```

#### Scenario: Normal cultivator full growth
- **WHEN** 未受伤修士经过 naturalCultivation
- **THEN** cultivation SHALL 增加 1

#### Scenario: Injured cultivator halved growth
- **WHEN** 重伤修士（injuredUntil=105）在第 102 年经过 naturalCultivation
- **THEN** cultivation SHALL 增加 0.5

#### Scenario: Recovered cultivator full growth
- **WHEN** 修士 injuredUntil=105，在第 105 年经过 naturalCultivation
- **THEN** cultivation SHALL 增加 1（已恢复）

#### Scenario: Aging unaffected by injury
- **WHEN** 重伤修士经过 naturalCultivation
- **THEN** age SHALL 正常增加 1

### Requirement: Gradual maxAge decay in naturalCultivation
`naturalCultivation` SHALL 在年龄/修为增长之后，对 `maxAge` 超出当前境界可维持寿元的修士执行渐进式衰减：

```
sustainableMaxAge = [60, 100, 900, 8900, 88900, 888900, 8888900, 88888900]
for each alive cultivator c:
  // ... age/cultivation growth ...
  target = sustainableMaxAge[c.level]
  if c.maxAge > target:
    decay = (c.maxAge - target) * LIFESPAN_DECAY_RATE
    c.maxAge = max(MORTAL_MAX_AGE, Math.round(c.maxAge - decay))
```

- `LIFESPAN_DECAY_RATE = 0.2`
- 衰减在 age/cultivation 增长之后执行
- `maxAge` 下限为 `MORTAL_MAX_AGE`(60)

#### Scenario: No decay when maxAge matches level
- **WHEN** Lv2 修士 maxAge=900（等于 sustainableMaxAge[2]）
- **THEN** maxAge SHALL 不变

#### Scenario: Decay applied after demotion
- **WHEN** 修士上一轮从 Lv3 跌境至 Lv2（maxAge=8900）
- **THEN** 本轮 naturalCultivation SHALL 衰减 maxAge：(8900-900)×0.2=1600，maxAge → round(7300) = 7300

#### Scenario: Normal cultivator unaffected
- **WHEN** Lv3 修士 maxAge=8900（等于 sustainableMaxAge[3]）
- **THEN** maxAge SHALL 不变

### Requirement: YearSummary defeat statistics
`YearSummary` SHALL 新增以下字段统计本年战败结局：

- `combatDemotions: number` — 本年跌境次数
- `combatInjuries: number` — 本年重伤次数
- `combatCultLosses: number` — 本年损失修为次数

`combatDeaths` SHALL 仅统计战败死亡次数（不含存活结局）。

`getSummary` SHALL 返回上述新字段。引擎 SHALL 在 `resetYearCounters` 中重置这些计数器。

#### Scenario: Year with mixed outcomes
- **WHEN** 某年发生 10 次战败：3 死亡、2 跌境、3 重伤、2 损失修为
- **THEN** combatDeaths=3, combatDemotions=2, combatInjuries=3, combatCultLosses=2

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

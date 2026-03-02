## ADDED Requirements

### Requirement: rAF render throttle

主线程 SHALL 使用 `requestAnimationFrame` 缓冲合并 Worker 消息。`onmessage` 回调仅将消息 push 到缓冲区（`tick` 和 `paused` 消息），不直接调用 `setState`。`reset-done` 消息 SHALL 绕过缓冲区直接在 `onmessage` 中处理。每帧至多触发一次 `setState`。

flush 原子性：flush 回调 SHALL 先执行 snapshot-and-swap（`const batch = bufferRef.current; bufferRef.current = []`），再遍历 batch，确保 flush 期间到达的新消息不丢失。

合并规则：
- `summaries`：所有缓冲消息的 summaries 按序 concat
- `events`：所有缓冲消息的 events 合并，reverse 后 prepend 到现有 events，截断到 `MAX_EVENTS`（保留最新）
- `yearSummary`：取最后一条 tick 消息的最后一个 summary
- `paused`：取最后一条 paused 消息，保留 `startedRef` 过滤逻辑（stale `paused:manual` 在 restart 后被忽略）

ack 时序：flush 完成后 SHALL 在 rAF 回调中与 `setState` 同步发送单个 `{ type: 'ack' }`，Worker 可在 React 渲染期间并行计算下一批。

reset 缓冲清空：当主线程调用 `reset` 时 SHALL 同步清空 `bufferRef.current = []` 并 `cancelAnimationFrame(rafRef.current)`，防止旧数据在 reset-done 后被 flush 污染新状态。

后台 tab 行为：当浏览器 tab 不在前台时 `requestAnimationFrame` 停止触发，模拟将因背压暂停。此为可接受行为 — 背压保证内存安全，tab 回到前台后自动恢复。

#### Scenario: Multiple messages merged into single render
- **WHEN** 两条 tick 消息在同一帧内到达（summaries 各 100 条）
- **THEN** SHALL 合并为单次 setState，trendData 追加 200 条 summaries

#### Scenario: ACK sent after flush
- **WHEN** rAF 回调 flush 完所有缓冲消息
- **THEN** SHALL 向 Worker 发送恰好一个 `{ type: 'ack' }`

#### Scenario: No ACK when no tick messages buffered
- **WHEN** 缓冲区中只有 paused 消息（无 tick）
- **THEN** flush 后 SHALL NOT 发送 ack

#### Scenario: Empty buffer flush is no-op
- **WHEN** rAF 回调触发但缓冲区为空
- **THEN** SHALL 立即返回，不调用 setState，不发送 ack

#### Scenario: Flush atomicity via snapshot-and-swap
- **WHEN** rAF flush 开始执行
- **THEN** SHALL 先执行 `const batch = bufferRef.current; bufferRef.current = []`，再处理 batch 中的消息

#### Scenario: Reset clears buffer
- **WHEN** 用户触发 reset
- **THEN** SHALL 同步清空 bufferRef 并取消 pending rAF，再发送 reset 消息给 Worker

#### Scenario: Cleanup on unmount
- **WHEN** useSimulation hook unmount
- **THEN** SHALL 取消 pending 的 requestAnimationFrame 并清空 bufferRef

### Properties (PBT)

#### P1: Memory boundedness
**Invariant**: `|events| ≤ MAX_EVENTS ∧ |trendData| ≤ MAX_TREND_POINTS` — 无论运行多久，UI 状态数组严格受限。
**Falsification**: 模拟百万年数据流，每次 flush 后断言数组长度不超过上限。测试 downsampling 边界（恰好 2001 点）。

#### P2: Data integrity (exactly-once)
**Invariant**: 每条 Worker 消息在 flush 中被处理恰好一次，不丢失不重复。
**Falsification**: 为每条消息赋唯一 ID，模拟不同 rAF 频率下的 buffer 大小，断言 flush 后 ID 集合无交集（跨 flush）且完整。

#### P3: Summary ordering monotonicity
**Invariant**: `∀i: trendData[i].year < trendData[i+1].year` — 趋势数据严格按年份递增，跨 flush 和 downsampling 均成立。
**Falsification**: 随机化 flush 边界和批次大小，密集触发 downsampling，断言年份严格递增。

#### P4: Event recency ordering
**Invariant**: `events[0]` 为最新事件 — flush 合并后 events 按年份降序排列（同年内按到达序）。
**Falsification**: 多批次合并含标记序号的事件，断言 reverse+prepend 后降序成立。

#### P5: One ack per flush
**Invariant**: 每次 flush 调用最多发送一个 ack（有 tick 时恰好 1 个，无 tick 时 0 个）。
**Falsification**: 单帧内缓冲大量消息，对 postMessage 插桩计数 ack 发送次数。

#### P6: Downsampling stability
**Invariant**: `|data| ≤ MAX_TREND_POINTS ⟹ downsample(data) = data` — 未超限的数据不被降采样改变。`downsample(downsample(data)) = downsample(data)` — 降采样幂等。
**Falsification**: 在阈值附近 fuzz 数据长度，多次 downsample 后断言稳定。

## MODIFIED Requirements

### Requirement: Statistics panel
统计面板 SHALL 展示：总人口、本年新增、本年死亡（战斗+寿尽分项）、本年晋升、最高境界、最高修为。面板 SHALL 额外展示一个按境界分组的统计表格，固定展示全部 8 个境界行（Lv0-Lv7），列为：境界名、年龄均值、年龄中位数、勇气均值、勇气中位数。

#### Scenario: Stats update
- **WHEN** a year summary arrives from Worker
- **THEN** all statistics SHALL reflect the latest year's data

#### Scenario: Level stats table display
- **WHEN** 当前年份 Lv0 有 5000 名修士、Lv1 有 200 名修士、Lv2 有 10 名修士
- **THEN** 统计表格 SHALL 展示这三个境界各自的 ageAvg、ageMedian、courageAvg、courageMedian 数值

#### Scenario: Empty level display
- **WHEN** 某境界存活修士数为 0
- **THEN** 该境界行 SHALL 保持显示，四个统计列 SHALL 展示「-」而非数值，以保持表格布局稳定

### Requirement: Population trend chart
趋势图 SHALL 支持三个 tab 切换：「人口趋势」、「年龄趋势」、「勇气趋势」。默认展示「人口趋势」。切换 tab SHALL 不影响底层 trendData 数据，仅改变图表渲染的 dataKey。三个 tab 统一展示 Lv1–Lv7（7 条线），排除 Lv0（炼气）。

「人口趋势」tab SHALL 展示 Recharts LineChart，7 条线（Lv1–Lv7），X 轴 = 模拟年份，Y 轴 = 修士数量。

「年龄趋势」tab SHALL 展示 Lv1–Lv7 各境界 `ageAvg` 的折线，X 轴 = 模拟年份，Y 轴 = 平均年龄。

「勇气趋势」tab SHALL 展示 Lv1–Lv7 各境界 `courageAvg` 的折线，X 轴 = 模拟年份，Y 轴 = 平均勇气值。

当某年某境界 `levelCounts[i] === 0` 时，该年该境界的趋势数据点 SHALL 为 `null`，Recharts 折线在该点断开（不连接到 0），准确表达「无数据」。

趋势数据 SHALL 保持最多 2,000 个数据点上限，超出时对旧数据降采样。

#### Scenario: Tab default state
- **WHEN** 模拟启动后趋势图首次渲染
- **THEN** SHALL 默认展示「人口趋势」tab

#### Scenario: Tab switching
- **WHEN** 用户点击「年龄趋势」tab
- **THEN** 图表 SHALL 切换为展示 Lv1–Lv7 各境界 ageAvg 折线，X/Y 轴标签相应变化

#### Scenario: Empty level trend line
- **WHEN** 某年 Lv3 存活修士数为 0
- **THEN** 该年 Lv3 的 ageAvg/courageAvg 数据点 SHALL 为 null，折线在该点断开

#### Scenario: Trend data downsampling
- **WHEN** trend data exceeds 2,000 points
- **THEN** the oldest data SHALL be downsampled to maintain the cap

### Requirement: Worker-UI communication
The Worker SHALL communicate via postMessage. Message types from main to Worker: start (with speed tier), pause, step, setSpeed, reset, **ack**. Message types from Worker to main: tick (with YearSummary array and events), paused, reset-done. In batch mode, the Worker SHALL send summaries array and events, then wait for ack before next batch.

#### Scenario: Batch mode with backpressure
- **WHEN** Worker runs 100 years in batch at Tier 1
- **THEN** it SHALL post a single message with 100 YearSummary entries and up to 1000 events, then wait for ack

#### Scenario: ACK message type
- **WHEN** main thread finishes processing a tick message
- **THEN** it SHALL post `{ type: 'ack' }` to the Worker

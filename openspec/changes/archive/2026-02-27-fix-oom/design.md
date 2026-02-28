## Context

修仙模拟器的数据流：`SimulationEngine`（Worker 线程）→ `postMessage` → `useSimulation`（主线程 hook）→ React 状态 → Recharts/DOM 渲染。

当前问题：Worker 以 `setTimeout(0)` 紧循环发送批量数据，无任何流控机制。主线程每收一条消息就触发 `setState` + 全量 spread 拷贝数组 + Recharts SVG 重建。Tier3 速度下 Worker 产出远快于主线程消费能力，structured clone 副本在浏览器消息队列中无限堆积，最终 OOM。

## Goals / Non-Goals

**Goals:**

- 消除 OOM：内存使用在长时间运行后趋于稳定，不持续增长
- 保持模拟吞吐量：背压机制不应显著降低模拟速度
- 保持渲染流畅：≥30fps

**Non-Goals:**

- 不更换图表库（Recharts → Canvas 方案留作后续优化）
- 不改动模拟引擎逻辑（`simulation.ts` / `combat.ts` / `prng.ts`）
- 不改动 UI 组件接口

## Decisions

### D1: 背压模型选型 — ACK 模式 vs rAF 回调通知

**选择：ACK 模式**

Worker 发完 `postMessage` 后停止调度，等收到主线程 `{ type: 'ack' }` 才 `setTimeout(runBatch, 0)`。

替代方案：主线程用 `MessagePort` 或 `SharedArrayBuffer` 信号量通知 Worker。过于复杂，ACK 消息足够简单且无兼容性问题。

```
Worker                    Main Thread
  │                           │
  ├── postMessage(tick) ──▶  │
  │   (停止调度，等待)        ├── onmessage → buffer.push
  │                           ├── rAF → flush → setState
  │  ◀── postMessage(ack) ───┤   (渲染完成后)
  ├── setTimeout(runBatch,0)  │
  │                           │
```

### D2: 主线程消息处理 — rAF 缓冲合并

`onmessage` 不直接调用 `setState`，仅 push 到 `bufferRef`。通过 `requestAnimationFrame` 调度 flush 回调，将两帧之间积累的所有消息合并为**单次 `setState`**。

合并逻辑：
- `summaries`：所有批次的 summaries 按序 concat
- `events`：所有批次的 events 合并后截断到 `MAX_EVENTS`
- `yearSummary`：取最后一条消息的最后一个 summary
- `paused` 消息：取最后一条

flush 完成后发送一个 `ack`（无论缓冲了多少条 tick 消息，只发一个 ack）。

### D3: 趋势图数据点密度

**选择：`MAX_TREND_POINTS` 从 10000 降至 2000**

折线图宽度一般 600-1000px，2000 个数据点已是 2-3x 像素分辨率。降采样逻辑（每 2 取 1）不变，只是触发阈值降低。SVG 元素从 ~70000 降至 ~14000。

替代方案：动态根据图表宽度计算最大点数。增加了复杂度，收益有限，不采用。

### D4: 类型扩展方式

`ToWorker` union 新增 `{ type: 'ack' }` 分支。Worker 的 `onmessage` switch 增加 `ack` case。这是最小侵入的扩展方式。

## Risks / Trade-offs

**[模拟吞吐量下降]** → ACK 模式引入一次往返延迟（Worker → Main → Worker）。缓解：rAF flush 在 ~16ms 内完成，相比 Tier3 每批 1000 年的计算时间，往返延迟占比很小。净效果是 Worker 以"渲染帧率"为上限节拍运行，而非无限制全速。

**[降采样信息损失]** → `MAX_TREND_POINTS` 降低意味着更早触发降采样，长期趋势曲线分辨率下降。缓解：2000 点对于折线图视觉效果已足够，用户不可能从 SVG 折线图中分辨 10000 与 2000 点的差异。

**[rAF 不在后台 tab 触发]** → 浏览器切到后台时 `requestAnimationFrame` 停止调用，buffer 会堆积。缓解：由于背压机制的存在，Worker 也不会发送新数据（等待 ack），所以 buffer 中最多只有一批未处理数据。

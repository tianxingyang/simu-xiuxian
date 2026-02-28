# 修复浏览器长时间运行 OOM

## 问题

修仙模拟器长时间运行后浏览器报 `out of memory`。根因是 Worker 与主线程之间的**生产-消费失衡**，引发三层级联内存膨胀：

1. **消息队列堆积** — Worker 以 `setTimeout(0)` 紧循环发送批量数据，主线程忙于渲染无法及时消费，structured clone 副本在浏览器内部消息队列中无限积压
2. **SVG DOM 爆炸** — `TrendChart` 用 Recharts 渲染 `MAX_TREND_POINTS=10000` × 7 条线 = 70000+ SVG path 段常驻 DOM，每次更新触发完整 SVG 协调
3. **高频数组分配** — 每条 Worker 消息触发 `setState`，通过 spread 创建大型临时数组（≤11000 元素），GC 无法跟上分配速率

## 修复策略

三层修复，由内到外：

### L1: rAF 渲染节流 — `src/hooks/useSimulation.ts`

用 `requestAnimationFrame` 将 Worker 消息缓冲合并。多条消息在同一帧内合并为单次 `setState`，将渲染频率从"每条消息触发"降至"每帧一次"（~60fps）。

- Worker `onmessage` 只做 push 到 buffer
- rAF 回调一次性 flush 所有缓冲消息
- 合并逻辑：summaries 追加，events 取最新 MAX_EVENTS 条，yearSummary 取最后一条
- flush 完成后向 Worker 发送 `ack`

### L2: 背压机制 — `src/engine/worker.ts` + `src/types.ts`

Worker 发完一批后进入等待状态，收到主线程 `ack` 后才调度下一批。杜绝消息队列无限堆积。

- 新增 `ToWorker` 类型 `{ type: 'ack' }`
- `runBatch` 发完 `postMessage` 后不再 `setTimeout(runBatch, 0)`
- `onmessage` 收到 `ack` 时才 `setTimeout(runBatch, 0)` 调度下一轮
- `step` 模式不受影响（无循环）

### L3: 降低趋势图数据密度 — `src/constants.ts`

`MAX_TREND_POINTS` 从 10000 降至 2000。一个 ~800px 宽的折线图无法区分超过 800 个数据点，2000 已远超视觉分辨率。SVG 元素从 70000+ 降至 14000。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `ToWorker` 新增 `ack` 类型 |
| `src/engine/worker.ts` | 移除紧循环，改为等待 ack |
| `src/hooks/useSimulation.ts` | 新增 rAF 缓冲层 + ack 发送 |
| `src/constants.ts` | `MAX_TREND_POINTS` 10000 → 2000 |

## 不涉及

- 模拟引擎逻辑（`simulation.ts` / `combat.ts` / `prng.ts`）
- UI 组件（`Dashboard` / `Controls` / `LevelChart` / `EventLog` / `StatsPanel`）
- 构建配置

## 验证标准

- Tier3 速度运行 10 万年+，浏览器内存稳定在合理范围（不持续增长）
- 渲染帧率保持流畅（≥30fps）
- 模拟结果与修复前一致（确定性 PRNG 不受影响）

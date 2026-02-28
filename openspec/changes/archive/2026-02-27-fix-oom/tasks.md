## 1. 类型扩展

- [x] 1.1 `src/types.ts`: `ToWorker` union 新增 `{ type: 'ack' }` 分支

## 2. Worker 背压

- [x] 2.1 `src/engine/worker.ts`: 新增模块级变量 `let awaitingAck = false`
- [x] 2.2 `src/engine/worker.ts`: `runBatch` 发完 `postMessage` 后设置 `awaitingAck = true`，移除 `loopTimer = self.setTimeout(runBatch, 0)`
- [x] 2.3 `src/engine/worker.ts`: `onmessage` 新增 `ack` case — 若 `awaitingAck && running && !extinct` 则 `awaitingAck = false` + `setTimeout(runBatch, 0)`；否则忽略
- [x] 2.4 `src/engine/worker.ts`: `stop()` 函数增加 `awaitingAck = false`
- [x] 2.5 `src/engine/worker.ts`: `start` case 中在 `runBatch()` 前增加 `awaitingAck = false`
- [x] 2.6 `src/engine/worker.ts`: extinction 路径保持不变 — 不设 `awaitingAck`，直接 post tick + paused

## 3. 主线程 rAF 缓冲

- [x] 3.1 `src/hooks/useSimulation.ts`: 新增 `bufferRef: useRef<FromWorker[]>([])` 和 `rafRef: useRef<number>(0)`
- [x] 3.2 `src/hooks/useSimulation.ts`: `onmessage` 改为：`reset-done` 直接处理（保持现有逻辑）；`tick`/`paused` push 到 bufferRef + 请求 rAF（若未请求）；`drainingRef` 检查保持在 push 前
- [x] 3.3 `src/hooks/useSimulation.ts`: 实现 `flush` 函数 — snapshot-and-swap（`const batch = bufferRef.current; bufferRef.current = []`）→ 合并所有消息为单次 setState（summaries concat, events reverse+prepend 截断 MAX_EVENTS, yearSummary 取最后, paused 保留 startedRef 过滤）→ 若有 tick 消息则发送单个 ack
- [x] 3.4 `src/hooks/useSimulation.ts`: `reset` 回调中同步 `bufferRef.current = []` + `cancelAnimationFrame(rafRef.current)`，在 post reset 消息之前
- [x] 3.5 `src/hooks/useSimulation.ts`: cleanup 时 `cancelAnimationFrame(rafRef.current)` + `bufferRef.current = []`

## 4. 趋势图密度

- [x] 4.1 `src/constants.ts`: `MAX_TREND_POINTS` 从 10000 改为 2000

## 5. 验证

- [x] 5.1 Tier3 速度运行 10 万年+，确认浏览器内存不持续增长（headless shell 验证：×10 速度运行至 52 万年，暂停后内存回落并稳定，无 OOM 崩溃，零控制台错误）
- [x] 5.2 确认模拟结果（相同 seed）与修复前一致

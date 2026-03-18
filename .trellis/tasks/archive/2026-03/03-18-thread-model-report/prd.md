# Server 进程模型重构

## Goal
将当前单进程单线程 server 重构为多进程架构，解决日报生成超时、模拟阻塞 I/O、以及 `_busy` 锁泄漏等问题。

## Problem Analysis

### Symptom
CLI POST `/api/report` 后等待数分钟，最终 `fetch failed`（120s 超时）。

### Root Cause Chain
```
CLI fetch (120s timeout)
  → Server generateReport():
    → aggregateEvents() [SYNC DB]
    → callLLM() [ASYNC, up to 120s]
      ← Runner.runBatch() 每秒阻塞事件循环 50-200ms
      ← LLM stream chunk 处理被延迟
    → CLI timeout fires → "fetch failed"
    → Server 端 _busy=true 残留 → 后续请求 409
```

### Event Loop Contention Map
| Operation | Type | Severity |
|---|---|---|
| `engine.tickYear()` x1-5 | SYNC CPU | HIGH |
| `engine.serialize()` | SYNC CPU | MEDIUM |
| `DB.transaction()` (persistBatch) | SYNC I/O | HIGH |
| `runEviction()` + memory decay | SYNC I/O | HIGH (O(dead×events×cultivators)) |
| `aggregateEvents()` | SYNC I/O | MEDIUM |
| `queryEventsForCultivator()` | SYNC I/O | MEDIUM (json_extract full scan) |
| `callLLM()` stream reading | ASYNC I/O | Blocked by above |
| `llmConfig` getters | SYNC I/O | LOW (readFileSync per access) |

## Technical Approach

### Decision: `child_process.fork()`, not `worker_threads`

Reasons:
- better-sqlite3 native module has thread-safety issues with shared connections
- Process isolation gives complete event loop independence
- WAL mode allows each process its own DB connection (concurrent reads, single writer)
- IdentityManager hooks stay synchronous within simulation process — no cross-boundary shared mutable state

### Phase 1 Architecture (3 processes)

```
┌─────────── Gateway / Control Plane (main process) ──────────┐
│ server/index.ts + server/bot.ts                              │
│ - HTTP: /health /api/report /api/biography /api/config/llm   │
│ - WebSocket: /ws (broadcast tick to clients)                 │
│ - QQ Bot gateway                                             │
│ - Child supervisor + job registry                            │
│ - NO SQLite, NO engine tick, NO LLM streaming                │
└──────────┬──────────────────────────────┬────────────────────┘
           │ IPC: sim commands            │ IPC: job RPC
           │ sim events (tick/paused)     │ report/bio/cancel
           ▼                              ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│ Simulation Process   │      │ LLM/Query Worker             │
│ server/runner.ts     │      │ server/reporter.ts           │
│ src/engine/*         │      │ server/biography.ts          │
│ server/identity.ts   │      │ shared callLLM()             │
│ server/eviction.ts   │      │ Own DB conn (read + write)   │
│ Own DB conn (writer) │      │ Cancelable per-job AbortCtrl │
└──────────────────────┘      └──────────────────────────────┘
```

### IPC Message Protocol

**Gateway ↔ Simulation:**
- To sim: `sim:start`, `sim:pause`, `sim:step`, `sim:setSpeed`, `sim:reset`, `sim:ack`, `sim:clientCount`
- From sim: `sim:state`, `sim:tick { tickId, summaries, events }`, `sim:paused`, `sim:resetDone`

**Gateway ↔ LLM Worker:**
- To worker: `job:report:start { jobId, fromTs, toTs }`, `job:biography:start { jobId, name, year }`, `job:cancel { jobId }`
- From worker: `job:result { jobId, kind, payload }`, `job:error { jobId, error }`

### Phase 1 File Changes

| Action | File | Change |
|--------|------|--------|
| Add | `server/ipc.ts` | Shared IPC message types |
| Add | `server/processes/sim-worker.ts` | Simulation process entry |
| Add | `server/processes/llm-worker.ts` | LLM/query worker entry |
| Modify | `server/index.ts` | Spawn children, IPC dispatch, remove direct runner/reporter imports |
| Modify | `server/bot.ts` | Send IPC jobs instead of direct generateReport/generateBiography |
| Modify | `server/reporter.ts` | Accept AbortSignal, remove _busy flag |
| Modify | `server/biography.ts` | Accept AbortSignal |
| Modify | `server/config.ts` | Load config once at startup, remove per-access readFileSync |

### Phase 2 Architecture (5 processes, future)

Further splits:
1. Simulation process drops all DB access → sends persist payload via IPC
2. Dedicated DB service process (sole writer + eviction + memory decay)
3. Report and biography split into separate workers
4. DB query optimizations: batch `queryNamedCultivatorsByIds()`, index-based biography query

## Requirements
- Simulation ticks must not block HTTP/WS/Bot/LLM streaming
- LLM calls must not block simulation ticks
- Report/biography requests must be cancelable (HTTP disconnect → abort)
- `_busy` lock must not leak across request lifecycle
- Each process has its own better-sqlite3 connection (WAL mode)
- Config loaded once per process at startup

## Acceptance Criteria
- [ ] 模拟运行期间请求日报，LLM 流能在 120s 内正常完成
- [ ] 日报生成期间模拟 tick 无卡顿
- [ ] CLI 断开后重新请求日报不再返回 409
- [ ] HTTP/WS/Bot 在模拟全速运行时保持响应

## Out of Scope
- 前端改动
- LLM 模型/prompt 优化
- Phase 2 (DB service 独立进程) — 留作后续

## Technical Notes
- Dev: `tsx` spawn children; Prod: fork built JS
- Each process set `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout`
- `db.ts` singleton 在进程隔离后自然变成 process-local
- Phase 2 中若 DB service queue 积压，合并 snapshot 更新但不丢事件

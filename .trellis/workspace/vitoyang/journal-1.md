# Journal - vitoyang (Part 1)

> AI development session journal
> Started: 2026-03-11

---



## Session 1: Bootstrap trellis guidelines

**Date**: 2026-03-11
**Task**: Bootstrap trellis guidelines

### Summary

(Add summary)

### Main Changes

Filled all `.trellis/spec/` guideline files with project-specific conventions extracted from actual codebase analysis.

| Area | Files Updated | Key Content |
|------|--------------|-------------|
| Frontend | 7 files (index, directory-structure, components, hooks, state-management, type-safety, css-design, quality) | React 19 + Web Worker architecture, memo() patterns, rAF buffering, render-props Dashboard, Recharts config |
| Shared | 4 files (index, code-quality, typescript, git-conventions) | Naming conventions, TypeScript patterns (as const, satisfies, discriminated unions), commit scopes |

**Key decisions**:
- Rewrote all templates from Electron to pure frontend SPA context
- Documented actual patterns found in codebase (not idealized)
- Archived `00-bootstrap-guidelines` task


### Git Commits

| Hash | Message |
|------|---------|
| `c7822af` | (see git log) |
| `d0c0ccf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Implement Lv7 Tribulation & Ascension

**Date**: 2026-03-11
**Task**: Implement Lv7 Tribulation & Ascension

### Summary

(Add summary)

### Main Changes

## Summary

Multi-Agent Pipeline 完成 Lv7 天劫飞升机制的完整实现。

## Changes

| File | Change |
|------|--------|
| `src/types.ts` | Cultivator.reachedMaxLevelAt, RichTribulationEvent, EngineHooks.onTribulation, YearSummary 新增字段, SimEvent.type 扩展 |
| `src/balance.ts` | TribulationBalance 类型, BalanceProfile/Input/freeze/clone/merge 全链路 |
| `src/constants.ts` | tribulationChance() sigmoid 函数 |
| `src/engine/simulation.ts` | tryTribulation(), 计数器管理, tickCultivators 集成, reachedMaxLevelAt 初始化 |
| `src/engine/combat.ts` | scoreNewsRank tribulation → S |
| `src/engine/worker.ts` | richToSimEvent tribulation case |
| `src/balance-presets/*.ts` | v2026-03-08, v2026-03-09 增加 tribulation 参数 |
| `src/components/EventLog.tsx` | tribulation 事件渲染 |
| `src/components/StatsPanel.tsx` | 飞升/陨落统计 |
| `server/events.ts` | toDisplayEvent tribulation case |
| `server/identity.ts` | IdentityManager 飞升处理 |
| `server/runner.ts` | onTribulation hook 绑定 |

## Review Fix

- Codex bot review: 飞升成功时不应触发 checkDeath milestone → 已修复 (78b66ed)

## PR

https://github.com/tianxingyang/simu-xiuxian/pull/7


### Git Commits

| Hash | Message |
|------|---------|
| `a64dbf6` | (see git log) |
| `78b66ed` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Event System Integration: Multi-Agent Pipeline + Spec Update

**Date**: 2026-03-12
**Task**: Event System Integration: Multi-Agent Pipeline + Spec Update

### Summary

(Add summary)

### Main Changes


## Summary

Completed the event-system-and-daily-report OpenSpec change (tasks 7-10) using multi-agent pipeline, then performed integration verification, PR creation, review feedback fixes, README update, and frontend spec documentation migration.

## Work Done

| Phase | Description |
|-------|-------------|
| Multi-agent dispatch | Launched 3 parallel worktree agents: daily-report-pipeline, frontend-websocket, qq-bot-push |
| Integration merge | Merged 3 feature branches into `integration/event-system`, resolved conflicts |
| Integration verification | Cross-branch defect fix (duplicate pushToQQ), end-to-end validation |
| PR #10 | Created PR with all integration commits |
| PR review fixes | Dynamic WS_URL derivation, generateDailyReport busy guard |
| README update | Added backend architecture, identity system, daily report, env vars |
| Spec docs update | Updated all 7 frontend spec files for Worker→WebSocket migration |

## Key Files Modified

- `server/reporter.ts` — Daily report pipeline (aggregate → prompt → DeepSeek → store → QQ push)
- `server/bot.ts` — QQ Bot push (OneBot v11)
- `server/index.ts` — Cron scheduling, backfill check, POST /api/report
- `src/hooks/useSimulation.ts` — Worker→WebSocket migration, reconnection, tickId ACK
- `src/types.ts` — ToServer/FromServer types with tickId and state variant
- `src/components/Controls.tsx` — connectionStatus indicator
- `README.md` — Full documentation update
- `.trellis/spec/frontend/*.md` (7 files) — Architecture docs Worker→WebSocket

## Decisions

- **pushToQQ dedup**: Removed inline implementation in reporter.ts, imported from bot.ts
- **WS_URL**: Derived from `location` with `VITE_WS_URL` env override instead of hardcoded
- **Busy guard**: Moved `_busy` check into `generateDailyReport()` itself (covers cron + backfill + API)


### Git Commits

| Hash | Message |
|------|---------|
| `9825aad` | (see git log) |
| `57508da` | (see git log) |
| `b38baea` | (see git log) |
| `e0123f6` | (see git log) |
| `eda3a31` | (see git log) |
| `892ea2e` | (see git log) |
| `47f1c41` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: TUI Console + Runner Robustness

**Date**: 2026-03-14
**Task**: TUI Console + Runner Robustness

### Summary

(Add summary)

### Main Changes

| Feature | Description |
|---------|-------------|
| TUI Console | blessed dashboard with grid-navigable actions, service management, simulation control, log tailing |
| Ack Timeout | Runner auto-continues after ACK_TIMEOUT if no client responds |
| SQLite Fix | INSERT OR IGNORE + pendingInserts cleanup prevents persist snowball |
| Vite Proxy | /ws, /api, /health proxied to backend |
| Speed Control | TUI 'v' hotkey cycles speed ×1→×5→×10 |

**Root Cause**: Simulation appeared to "only run once" due to two issues:
1. `named_cultivators` INSERT conflict caused every `persistBatch` to fail (snowball effect — pendingInserts never cleared after transaction rollback)
2. TUI had no visible tick counter, making continuous simulation invisible to user

**Updated Files**:
- `cli.ts` — new TUI dashboard (blessed)
- `cli.sh` — wrapper script
- `server/runner.ts` — ack timeout fallback
- `server/db.ts` — INSERT OR IGNORE
- `server/identity.ts` — flushToDB cleanup logic
- `vite.config.ts` — dev proxy
- `package.json` — blessed deps + cli script


### Git Commits

| Hash | Message |
|------|---------|
| `69ac549` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Corpus-based bigram name generator

**Date**: 2026-03-16
**Task**: Corpus-based bigram name generator

### Summary

(Add summary)

### Main Changes

## Summary
Redesigned the 修仙 name generator using data from Chinese-Names-Corpus (120W modern + 25W ancient names). Replaced independent random character selection with a bigram transition model.

## Changes

| Item | Before | After |
|------|--------|-------|
| Single surnames | 60 | 100 |
| Compound surnames | 14 | 20 |
| Name generation | Independent random chars (90) | Bigram model (4,921 corpus-validated pairs) |
| Surname selection | Uniform random | Corpus frequency-weighted |
| Name capacity | ~600K | ~610K |

## Key Decisions
- **Bigram over neural model**: Chinese given names are 1-2 chars — too short for neural networks to add value. Bigram captures all learnable context while maintaining PRNG determinism.
- **Ancient/modern frequency ratio analysis**: Explored using corpus frequency ratios to objectively identify "修仙风" characters. Concluded it works as an exclusion filter but 修仙 aesthetics remain subjective.
- **Unified surname weights**: Merged single/compound surname pools with corpus-proportional weights instead of hardcoded 85/15 split.

## Files Modified
- `server/identity.ts` — Name pools, bigram table, weighted selection logic


### Git Commits

| Hash | Message |
|------|---------|
| `f4cdbf1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 32x32 toroidal grid map system

**Date**: 2026-03-16
**Task**: 32x32 toroidal grid map system

### Summary

(Add summary)

### Main Changes

## 完成内容

为修仙模拟器引入 32x32 环绕网格地图系统：

| 特性 | 描述 |
|------|------|
| 修士坐标 | Cultivator 新增 x, y 字段，出生时均匀随机分布 |
| 空间战斗匹配 | 遭遇半径随境界递增 (Lv0=2 → Lv7=16)，替代全局同境界匹配 |
| 随机游走 | 每年 15%+境界加成 概率移动 1 步 |
| 事件触发移动 | 战败逃逸 2-3 格、突破远行 2-4 格 |
| 空间索引 | SpatialIndex 类管理 grid[level][cell] 三维索引 |

## 性能优化

原始空间查询导致 73ms/tick → 经过两轮优化降至 7ms/tick：
1. 拒绝采样替代 Set 遍历选对手
2. 遭遇概率按 (境界, 格子) 预计算缓存

## 变更文件

- `src/types.ts` — Cultivator +x, y
- `src/constants.ts` — MAP_SIZE, ENCOUNTER_RADIUS, 移动参数
- `src/engine/spatial.ts` — **新增** 空间索引 + 移动 + 匹配
- `src/engine/combat.ts` — 空间匹配替代全局匹配
- `src/engine/simulation.ts` — 集成空间索引到引擎生命周期
- `test/spatial-sanity.test.ts` — **新增** 空间系统测试


### Git Commits

| Hash | Message |
|------|---------|
| `5f2ce7c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 名字回收机制

**Date**: 2026-03-16
**Task**: 名字回收机制

### Summary

(Add summary)

### Main Changes

**问题**: 修士命名系统因姓氏概率加权，长时间模拟后频繁碰撞，出现 ②③ 编号后缀，破坏沉浸感。

**方案选择**: 讨论了三个方案（提高命名阈值到元婴 / 名字回收 / 组合），最终选择名字回收 — 死亡修士的名字从 `usedNames` 中移除，允许后来者复用。

**改动** (`server/identity.ts`):
- `flushToDB()`: 死亡修士移除 active 时同步从 `usedNames` 删除
- `rebuildFromDB()`: 只加载存活修士名字到去重集合


### Git Commits

| Hash | Message |
|------|---------|
| `152b5c4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: Event Log Smart Scroll

**Date**: 2026-03-16
**Task**: Event Log Smart Scroll

### Summary

(Add summary)

### Main Changes

| Change | Description |
|--------|-------------|
| EventLog.tsx | 新增 pinned/frozen 机制：滚动离开顶部时冻结列表，显示 "N 条新事件" 提示条 |
| index.css | 新增 `.event-pending` 样式 |

**Core Logic**: scroll away → freeze snapshot + count pending via ID lookup → click badge or scroll back → resume live


### Git Commits

| Hash | Message |
|------|---------|
| `edf80c3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 角色生平传记 API

**Date**: 2026-03-17
**Task**: 角色生平传记 API

### Summary

(Add summary)

### Main Changes

| 模块 | 变更 |
|------|------|
| `server/biography.ts` | **新增** 传记生成核心模块：艾宾浩斯遗忘曲线记忆衰减、内存缓存、说书人风格 prompt 构建 |
| `server/db.ts` | 新增 `queryNamedCultivatorByName` 和 `queryEventsForCultivator` 查询函数 |
| `server/reporter.ts` | `callDeepSeek` → `callLLM`，导出 `PromptMessage` 类型 |
| `server/config.ts` | LLM 配置迁移：`DEEPSEEK_API_KEY` → `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（默认 OpenRouter） |
| `server/index.ts` | 注册 `POST /api/biography` 端点 |
| `cli.ts` | ENV_SCHEMA 更新 + 新增 `m Model` 快捷键切换 LLM 模型 |

**设计要点**:
- 记忆衰减使用艾宾浩斯遗忘曲线 `R(t) = e^(-t/S)`，等级越高记忆越久，飞升者永不遗忘
- 四级记忆：鲜活 → 模糊 → 传说 → 遗忘，控制 LLM 叙事详细程度
- 简单内存缓存（6h TTL），避免重复 LLM 调用
- LLM 端点可配置，支持 OpenRouter 切换任意模型


### Git Commits

| Hash | Message |
|------|---------|
| `6d3cf62` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 后端重启快照优化 + EventLog类型修复

**Date**: 2026-03-17
**Task**: 后端重启快照优化 + EventLog类型修复

### Summary

(Add summary)

### Main Changes

## 主要改动

| 模块 | 改动 |
|------|------|
| `src/engine/prng.ts` | PRNG 暴露 `state` getter，支持序列化/恢复内部种子状态 |
| `src/engine/simulation.ts` | 新增 `serialize()` / `static deserialize()` 二进制快照方法 |
| `server/db.ts` | sim_state 表新增 `snapshot BLOB` 列（含迁移逻辑） |
| `server/runner.ts` | restore() 优先使用快照，fallback 到原有重放 |
| `src/engine/combat.ts` | 战斗事件生成增加 eventMinLevel 过滤优化 |
| `src/components/EventLog.tsx` | frozenFirstIdRef 类型从 string 修正为 number |

## 技术要点

- 后端重启恢复时间从 O(years) 降为 O(population)
- 快照格式：version header + PRNG state + cultivators binary + milestones
- 典型 1000 人口快照 ~100KB，反序列化 <10ms
- 向后兼容：无快照时自动 fallback 到原有确定性重放


### Git Commits

| Hash | Message |
|------|---------|
| `7cb2521` | (see git log) |
| `b343e7c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: LLM 模型热切换

**Date**: 2026-03-17
**Task**: LLM 模型热切换

### Summary

将 LLM 配置从 as const 冻结对象拆分为可变 llmConfig，新增 GET/POST /api/config/llm 端点，CLI 切换模型后自动热更新无需重启后端

### Main Changes



### Git Commits

| Hash | Message |
|------|---------|
| `904440e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: Migrate QQ Bot from OneBot v11 to Official API v2

**Date**: 2026-03-17
**Task**: Migrate QQ Bot from OneBot v11 to Official API v2

### Summary

(Add summary)

### Main Changes

| 改动 | 说明 |
|------|------|
| server/bot.ts | 全部重写：OAuth Token 管理、QQ Bot Gateway WebSocket（心跳/鉴权/Resume/断线重连）、被动消息回复、"日报"和"传记"命令路由 |
| server/config.ts | 移除 onebotHttpUrl/onebotToken/qqGroupId/reportCron，新增 qqBotAppId/qqBotAppSecret |
| server/db.ts | 新增 bot_request_log 表（per-group last_request_ts），UPSERT 访问函数 |
| server/reporter.ts | 提取 classifyRows 共享逻辑，新增 aggregateEventsByTsRange + generateReportForRange，移除 pushToQQ 和 checkMissedReport |
| server/index.ts | 移除 node-cron 和定时任务，启动时调用 startBot() |
| cli.ts | ENV_SCHEMA 和状态显示从 OneBot 更新为 QQ Bot |
| package.json | 移除 node-cron 依赖 |
| README.md | 更新技术栈、环境变量、功能描述 |

**关键设计决策**：
- QQ Bot API v2 自 2025-04-21 起停用主动推送，因此日报改为按需生成（用户 @机器人 触发）
- 日报覆盖「上次请求时间 → 本次请求时间」的事件，首次请求默认回溯 24 小时
- 新增传记查询命令，复用已有 generateBiography 系统


### Git Commits

| Hash | Message |
|------|---------|
| `57cb5c1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: Event eviction, report/biography CLI, config auto-reload

**Date**: 2026-03-18
**Task**: Event eviction, report/biography CLI, config auto-reload

### Summary

(Add summary)

### Main Changes

## Changes

| Area | Description |
|------|-------------|
| CLI | 新增传记测试入口(b键)、日报生成后直接展示 LLM 输出 |
| Config | llmConfig 改为 getter 实时读 .env，移除 CLI 同步机制 |
| Reporter | 统一为时间戳范围查询，删除日期方式；LLM prompt 改用 YAML 格式省 token |
| DB | 新增 event_cultivators 关联表、protected 字段、记忆曲线淘汰机制 |
| Eviction | Ebbinghaus 遗忘曲线：B=200年/A=2000年/S=15000年，分批删除+decay 扫描 |
| Runner | 模拟速度调整为 1/3/5 年/秒，setImmediate 让出事件循环 |
| Rename | daily_reports → reports（含 DB 迁移） |

## Key Decisions

- 事件淘汰基于记忆曲线而非简单保留期
- 用 event_cultivators 关联表替代 json_extract 全表扫描（性能从阻塞→<100ms）
- eviction 分 fast path（10s 删过期）和 slow path（60s decay 扫描）
- protectEventsForCultivator 的 backfill 方案放弃（全表扫描不可行），改为插入时标记

## New Files

- `server/eviction.ts` — 淘汰模块
- `server/yaml.ts` — 轻量 YAML 序列化器


### Git Commits

| Hash | Message |
|------|---------|
| `fe6d1ca` | (see git log) |
| `c4e2411` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: 修复日报生成阻塞与输出格式

**Date**: 2026-03-18
**Task**: 修复日报生成阻塞与输出格式

### Summary

(Add summary)

### Main Changes

| 改动 | 描述 |
|------|------|
| 提示词优化 | 去除S/A/B等级标记，禁止Markdown输出，栏目标题改用【】包裹，适配QQ纯文本 |
| rank字段移除 | formatEventForPrompt不再传递newsRank给LLM，避免等级标记泄露 |
| 流式响应 | callLLM改用stream:true，AbortController双超时(30s卡顿/120s总超时) |
| OpenRouter优化 | 添加HTTP-Referer/X-Title headers，启用provider fallback和latency排序 |
| 事件循环修复 | runner无客户端场景setImmediate→setTimeout(50)，解决I/O饿死问题 |
| 全链路日志 | reporter各阶段添加详细日志(聚合/请求/流式/存储)，console统一加HH:MM:SS时间戳 |
| CLI超时 | report请求添加120s AbortSignal.timeout保护 |

**根因分析**：runner在无WebSocket客户端时通过setImmediate紧密循环调度runBatch，
tickYear+serialize+DB事务的同步开销占满事件循环，导致HTTP请求和流式读取无法推进。


### Git Commits

| Hash | Message |
|------|---------|
| `460486a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: Server 多进程架构重构

**Date**: 2026-03-18
**Task**: Server 多进程架构重构

### Summary

(Add summary)

### Main Changes

## Summary
将单线程 server 重构为 3 进程架构（Gateway + Sim Worker + LLM Worker），解决日报生成阻塞主线程导致超时的问题。

## Architecture
```
Gateway (main)           Sim Worker (child)       LLM Worker (child)
HTTP/WS/Bot routing      Runner + Engine          Reporter + Biography
NO DB, NO engine         Own DB conn (writer)     Own DB conn (read+write)
```

## Changes

| File | Change |
|------|--------|
| `server/ipc.ts` | 新增 IPC 消息类型定义 |
| `server/processes/sim-worker.ts` | 新增模拟子进程入口 |
| `server/processes/llm-worker.ts` | 新增 LLM 子进程入口 |
| `server/index.ts` | 重写为 Gateway 控制面 |
| `server/bot.ts` | IPC 任务分发 + per-group lastRequestTs |
| `server/reporter.ts` | AbortSignal 支持 + 移除 _busy 锁 |
| `server/biography.ts` | AbortSignal 支持 |
| `server/config.ts` | 一次性加载，移除 per-access readFileSync |
| `server/db.ts` | busy_timeout=5000 WAL 并发 |

## Key Decisions
- 选择 `child_process.fork()` 而非 `worker_threads`：better-sqlite3 native 模块线程安全问题
- WAL 模式 + 每进程独立连接：允许并发读取
- Report single-flight guard：Gateway 侧防止并发日报请求
- Worker 崩溃 fail-fast：立即 reject 所有 pending jobs

## Review Findings Fixed (via Codex)
Round 1: 6 issues (abort leak, cancel missing, worker crash handling, state sync)
Round 2: 3 issues (report concurrency, per-group ts, IPC send guard)


### Git Commits

| Hash | Message |
|------|---------|
| `8fa1014` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: perf: processMemoryDecay N+1 查询消除

**Date**: 2026-03-18
**Task**: perf: processMemoryDecay N+1 查询消除

### Summary

(Add summary)

### Main Changes

## 问题
`processMemoryDecay` 每60秒扫描全量死亡修士，对每个遗忘修士执行 N+1 DB 查询。year ~1550+ 时死亡修士累积上千，导致每次执行 ~130s，阻塞 tick。

## 方案 (Approach C: 增量标记 + 集合SQL + 反向索引)

| 改动 | 说明 |
|------|------|
| `forgotten` 列 | 标记已处理的遗忘修士，只处理增量 |
| 集合化 SQL | JOIN + NOT EXISTS 替代 N+1 循环 |
| 反向索引 | `event_cultivators(event_id)` |
| Migration | 兼容已有数据库 |

## 变更文件
- `server/db.ts` — schema + migration + `processMemoryDecayBatch()`
- `server/eviction.ts` — 85行→33行，完全消除 N+1
- `.trellis/spec/backend/database.md` — 新增周期任务反模式文档

## 性能影响
- 每周期 DB 调用: ~10000+ → 3-5 条
- 工作集: O(全部死亡) → O(新遗忘) → 趋近 0
- 预计耗时: ~130s → <10ms


### Git Commits

| Hash | Message |
|------|---------|
| `c90ef99` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: feat: 修士数据库物理删除机制

**Date**: 2026-03-18
**Task**: feat: 修士数据库物理删除机制

### Summary

(Add summary)

### Main Changes

在 `processMemoryDecayBatch` 事务末尾增加物理删除步骤，清理 `forgotten = 1` 的修士记录。

| 改动 | 说明 |
|------|------|
| `server/db.ts` | 事务三个退出路径末尾均增加 `DELETE FROM named_cultivators WHERE forgotten = 1`，返回值增加 `purged` 字段 |
| `server/eviction.ts` | 日志输出和条件判断中增加 `purged` 计数 |

**设计决策**: 无额外宽限期，forgotten 标记前已有基于 peak_level 的完整衰减周期（100~15000 年）。飞升修士永不遗忘，不受影响。


### Git Commits

| Hash | Message |
|------|---------|
| `d72f67a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: feat(map): 地图地域系统

**Date**: 2026-03-18
**Task**: feat(map): 地图地域系统

### Summary

(Add summary)

### Main Changes

为 32×32 环形地图引入地域概念（纯叙事层，不影响游戏机制）。

| 改动 | 说明 |
|------|------|
| `src/constants.ts` | 新增 RegionCode 类型、REGION_NAMES、32×32 地图布局、getRegionCode/getRegionName |
| `src/types.ts` | 5 个 RichEvent 接口新增 `region?: string` |
| `src/engine/simulation.ts` | expiry/promotion/breakthrough_fail/tribulation 事件填充 region |
| `src/engine/combat.ts` | combat 事件填充 region |
| `server/events.ts` | toDisplayEvent 加〔地域名〕前缀 |
| `server/reporter.ts` | LLM 提示词包含 region 字段 |

**地域**: 朔北冻原、苍茫草海、西嶂高原、天断山脉、河洛中野、东陵林海、赤岚丘陵、南淮泽国、裂潮海岸、潮生群岛、外海（共 11 种）


### Git Commits

| Hash | Message |
|------|---------|
| `d5e8c07` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: AreaTag 地块标记系统

**Date**: 2026-03-19
**Task**: AreaTag 地块标记系统

### Summary

(Add summary)

### Main Changes

## 实现内容

为 32x32 地图每个格子添加属性标记系统，影响核心游戏机制。

| 标记 | 机制影响 |
|------|---------|
| 灵气浓度 (1-5) | 突破概率加成 (0.7x~1.5x) + 修士移动偏向高灵气区域 |
| 地势险要 (1-5) | 战斗遭遇率加成 (0.6x~1.6x) + 逃跑概率调整 (+0.05~-0.1) |

**技术方案**:
- `Int8Array(1024)` 存储，程序化噪声生成（value noise + bilinear interpolation）
- 缓变动态：支持事件驱动的标记值变更
- 快照序列化兼容 v1/v2

**新增/修改文件**:
- `src/engine/area-tag.ts` (new) — AreaTagSystem 核心模块
- `src/engine/simulation.ts` — 集成 areaTags，突破概率加成
- `src/engine/spatial.ts` — 灵气加权移动，地势险要遭遇率
- `src/engine/combat.ts` — 地势险要降低逃跑成功率


### Git Commits

| Hash | Message |
|------|---------|
| `afba249` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 20: feat: Cultivator Behavior State Machine

**Date**: 2026-03-19
**Task**: feat: Cultivator Behavior State Machine

### Summary

(Add summary)

### Main Changes

## Changes

| File | Description |
|------|-------------|
| `src/types.ts` | Added `BehaviorState` union type + `behaviorState`, `settlingUntil` fields to Cultivator |
| `src/constants.ts` | Behavior constants (courage modifiers, move probs), `effectiveCourage` state-aware |
| `src/engine/spatial.ts` | Removed `fleeCultivator`, restructured `moveCultivators` to dispatch by state |
| `src/engine/combat.ts` | Removed `fleeCultivator` import and call |
| `src/engine/simulation.ts` | Added `evaluateBehaviorStates()` state machine, serialize v3 with backward compat |

## Design Decisions

- **Hybrid persistence model**: Condition-driven states (escaping/recuperating) persist until condition clears; re-evaluated states (wandering/settling/seeking_breakthrough) evaluated at lifespan-scaled intervals
- **seeking_breakthrough trigger**: Remaining lifespan insufficient for natural breakthrough at current spiritual energy → move to higher SE area → auto-transition to settling
- **escaping replaces fleeCultivator**: Sustained movement toward low terrainDanger instead of instant teleport
- **wandering is pure random**: No spiritual energy weighting (reserved for seeking_breakthrough)
- **Courage modifiers**: escaping 0.3x, recuperating 0.6x, others 1.0x
- **State priority**: escaping > recuperating > seeking_breakthrough > settling > wandering


### Git Commits

| Hash | Message |
|------|---------|
| `ac74590` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 21: fix: report 接口 409 锁死 + 诊断日志

**Date**: 2026-03-19
**Task**: fix: report 接口 409 锁死 + 诊断日志

### Summary

修复 cancelHttpJob 未 reject promise 导致 activeReportJobId 永久锁死，补充 gateway/worker 关键路径日志

### Main Changes

| File | Change |
|------|--------|
| `server/index.ts` | `cancelHttpJob` 加 `pending.reject()`；gateway timeout / client disconnect / 409 reject 三处加日志 |
| `server/processes/llm-worker.ts` | report/biography job abort 时输出日志 |
| `.trellis/spec/backend/error-handling.md` | 新增 Pattern 5: Promise Cancellation Must Settle |


### Git Commits

| Hash | Message |
|------|---------|
| `da6b479` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 22: 丰富日报 LLM 数据：事件嵌入 + 世界快照 IPC

**Date**: 2026-03-19
**Task**: 丰富日报 LLM 数据：事件嵌入 + 世界快照 IPC

### Summary

(Add summary)

### Main Changes

## 改动概览

两条路径丰富日报 LLM prompt 上下文：

### A. 事件级嵌入
- RichEvent 各子类型新增 `behaviorState`、`spiritualEnergy`、`terrainDanger` 可选字段
- combat/promotion 事件补充 `age` 字段
- 引擎创建事件时从 AreaTagSystem 和 Cultivator 读取并嵌入

### B. 世界快照 IPC (sim→gateway→llm)
- 新增 `WorldContext` 类型：currentYear、population、levelCounts、regionProfiles、behaviorDistribution
- sim-worker 响应 `sim:getWorldContext`，从 `SimulationEngine.getWorldContext()` 聚合数据
- gateway 在 report 请求时先向 sim 拿 context，再附加到 `job:report` 发给 llm-worker
- bot 请求同样走此路径

### C. Reporter Prompt 增强
- `formatEventForPrompt` 输出 spiritual_energy/terrain_danger/age/state（中文映射）
- `buildPrompt` 注入 world_context 区域（人口、境界分布、行为分布、区域画像）
- System prompt 增加「天机阁轮值真人」身份设定
- `current_year` 取自引擎真实年份

**涉及文件**: src/types.ts, src/engine/simulation.ts, src/engine/combat.ts, server/ipc.ts, server/runner.ts, server/processes/sim-worker.ts, server/processes/llm-worker.ts, server/index.ts, server/bot.ts, server/reporter.ts


### Git Commits

| Hash | Message |
|------|---------|
| `78560e0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 23: Migrate QQ bot to OneBot v11 (NapCat)

**Date**: 2026-03-19
**Task**: Migrate QQ bot to OneBot v11 (NapCat)

### Summary

(Add summary)

### Main Changes

## Summary

将 QQ 机器人从官方 Bot API v2 迁回 OneBot v11 协议（NapCat），解决官方 API 支持度不足的问题。

## Changes

| File | Change |
|------|--------|
| `server/bot.ts` | 重写：OAuth + Gateway WS → OneBot v11 正向 WS |
| `server/config.ts` | 配置项替换：`qqBotAppId/Secret` → `onebotWsUrl/Token/qqGroupId` |
| `server/ipc.ts` | 字段名：`groupOpenid` → `groupId` |
| `server/processes/llm-worker.ts` | 同步字段名变更 |
| `napcat/docker-compose.yml` | 新增 NapCat Docker 部署配置 |
| `.gitignore` | 排除 napcat 数据目录 |

## Key Decisions

- 使用正向 WebSocket 连接 NapCat（与原官方 Gateway 模式一致，改动最小）
- 通过 WS action `send_group_msg` 发送消息（支持主动推送，不再受被动回复限制）
- 保留命令交互（日报、传记），非命令消息静默忽略
- NapCat 通过 Docker 部署，WS 端口映射到宿主机 3002


### Git Commits

| Hash | Message |
|------|---------|
| `7656ae0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 24: feat(reporter): insight detection engine

**Date**: 2026-03-19
**Task**: feat(reporter): insight detection engine

### Summary

(Add summary)

### Main Changes

## Summary
Replaced the valueless 简讯 (statistics dump) section in 修仙界日报 with a server-side insight detection engine. The LLM now receives structured "narrative hooks" based on surprising changes instead of raw numbers.

## Changes

| File | Change |
|------|--------|
| `server/reporter.ts` | Removed Statistics/B-level logic; added `computeInsights()` with 4 detectors (spike, trend_reversal, ranking_change, threshold); refactored `buildPrompt()` and `SYSTEM_MESSAGE` |
| `server/db.ts` | Added `world_context` column to reports table; added `queryRecentWorldContexts(n)`; removed dead `queryEventStats()` |
| `server/logger.ts` | New unified logger module |
| `server/*.ts`, `cli.ts` | Migrated from `console.log` to structured logger |

## Design Decisions
- **Only surprising changes are reported**: Insight detectors only trigger when data deviates significantly from the rolling baseline (spike >30%, trend reversal after 3+ periods, ranking shifts, milestone crossings)
- **World context snapshots stored per report**: Enables cross-period comparison without schema redesign
- **日报 structure simplified**: 4 sections → 3 sections (头条/要闻/天下大势), no more 简讯
- **No insight = 天下太平**: LLM writes calm summary when nothing noteworthy happened


### Git Commits

| Hash | Message |
|------|---------|
| `2e0f0fd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 25: QQ Bot: @mention support & report length tuning

**Date**: 2026-03-19
**Task**: QQ Bot: @mention support & report length tuning

### Summary

Added @bot mention parsing for QQ commands; reduced report word limit to 300 chars with per-section caps

### Main Changes

| Change | File | Description |
|--------|------|-------------|
| @mention parsing | `server/bot.ts` | `parseCommand` now strips `[CQ:at,qq=selfId]` so `@天机阁 日报` triggers commands |
| Report word limit | `server/reporter.ts` | Total 300 chars, per-section caps (头条80/要闻120/天下大势80), max_tokens 800 |

**Modified Files**:
- `server/bot.ts` — parseCommand, handleMessage, handleEvent updated for selfId propagation
- `server/reporter.ts` — SYSTEM_MESSAGE word limits, max_tokens reduced


### Git Commits

| Hash | Message |
|------|---------|
| `uncommitted` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 26: Unified logger module + CLI log panel fix

**Date**: 2026-03-19
**Task**: Unified logger module + CLI log panel fix

### Summary

(Add summary)

### Main Changes

## Summary
Unified logging module for server + fixed CLI log panel not rendering backend logs.

## Changes

| Area | Change |
|------|--------|
| `server/logger.ts` | New unified logger with levels (debug/info/warn/error), scoped tags, UTC+8 timestamps |
| `server/index.ts` | Removed console patch, use `getLogger('gateway')` |
| `server/processes/llm-worker.ts` | Removed console patch, `initLogger({ tag: 'llm' })` |
| `server/processes/sim-worker.ts` | Removed console patch, `initLogger({ tag: 'sim' })` |
| `server/bot.ts` | Added happy-path logging (received command, dispatched job, result sent) |
| `server/reporter.ts` | `console.log` → `log.info` |
| `server/biography.ts` | `console.error` → `log.error` |
| `server/runner.ts` | `console.log/warn/error` → `log.info/warn/error` |
| `server/eviction.ts` | Downgraded to `log.debug` (hidden by default, reduces log volume ~95%) |
| `cli.ts` | Added `screen.render()` to watchFile callback + `startLogTail()` to key '3' + LOG_LEVEL env var + log rotation on startup |
| `spec/big-question/` | Added blessed render pitfall documentation |

## Bug Fixed
CLI Log panel never showed backend logs due to:
1. Missing `screen.render()` after `logBox.log()` in file watcher callback
2. Missing `startLogTail()` when starting backend via key '3' (only called from Start All)

## Key Decisions
- Logger writes to stdout/stderr (same fd chain as before), no architecture change
- Eviction logs as debug level eliminates ~95% of log volume by default
- Log rotation on CLI startup (>2MB → rename to .1/.2/.3), not in-flight rotation


### Git Commits

| Hash | Message |
|------|---------|
| `527362b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 27: fix: multi-process DB schema race condition

**Date**: 2026-03-19
**Task**: fix: multi-process DB schema race condition

### Summary

(Add summary)

### Main Changes

## 问题
清空数据库后重启，sim-worker 崩溃报 `SqliteError: duplicate column name: snapshot`。

## 根因
`getDB()` 混合了连接和 schema 初始化职责。sim-worker 和 llm-worker 作为独立进程同时调用 `getDB()`，都触发 `ALTER TABLE ADD COLUMN`，形成 TOCTOU 竞态。

## 修复
| 文件 | 改动 |
|------|------|
| `server/db.ts` | 拆分 `getDB()`（纯连接）和 `initSchema()`（建表+迁移） |
| `server/processes/sim-worker.ts` | 启动时调用 `initSchema()`，独占 schema 管理 |
| `server/processes/llm-worker.ts` | 移除 `getDB()` 调用，按需懒连接 |
| `.trellis/spec/backend/database.md` | 新增 Schema Ownership 规则文档 |


### Git Commits

| Hash | Message |
|------|---------|
| `05d5686` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 28: refactor(bot): centralize command routing in gateway

**Date**: 2026-03-19
**Task**: refactor(bot): centralize command routing in gateway

### Summary

(Add summary)

### Main Changes

| Change | Description |
|--------|-------------|
| `server/bot.ts` | Stripped to thin OneBot WS transport layer (connect/reconnect/send). Removed command parsing, job tracking, business handlers |
| `server/index.ts` | Added `Bot Command Routing` section with `parseCommand`, `handleBotReport`, `handleBotBiography`, `handleBotMessage`. Unified `pendingJobs` map for both HTTP and bot jobs |

**Motivation**: bot.ts previously managed its own job tracking and could only dispatch to llm-worker via callbacks. Moving routing to the gateway enables future bot commands to dispatch to sim-worker or llm-worker.

**Key decisions**:
- bot.ts remains in main process (not a child process), just acts as connection adapter
- Single `pendingJobs` map replaces separate `pendingHttpJobs` + bot `_pendingJobs`
- `startBot(onMessage)` simplified to single callback interface


### Git Commits

| Hash | Message |
|------|---------|
| `d7c8b82` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 29: fix: protect cultivators from premature forgotten marking

**Date**: 2026-03-20
**Task**: fix: protect cultivators from premature forgotten marking

### Summary

(Add summary)

### Main Changes

## 问题
日报和传记生成的内容互相矛盾：
- 日报称"化神大能杨涛海"被"章峰君"所斩
- 传记却描述杨涛海在结丹期被"陈亦松"杀死

## 根因
`processMemoryDecayBatch` 标记遗忘时一刀切，未考虑事件关联关系。
当修士 A 被标记遗忘并 purge 后，其 ID 被复用给新修士，
`INSERT OR IGNORE` + `UPDATE` 组合导致老记录被新修士数据覆盖，
传记 LLM 拿到脏数据后生成了矛盾内容。

## 修复
在 `server/db.ts` 的 `processMemoryDecayBatch` 标记遗忘查询中增加 `NOT EXISTS` 子查询：
如果修士与任何未遗忘修士共享事件（通过 `event_cultivators` 关联），则不标记为遗忘。

**修改文件**: `server/db.ts`


### Git Commits

| Hash | Message |
|------|---------|
| `94966fc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 30: feat: mortal settlement simulation system

**Date**: 2026-03-20
**Task**: feat: mortal settlement simulation system

### Summary

(Add summary)

### Main Changes

## Summary

Replace fixed `spawnCultivators(1000)` with organic household-driven cultivator awakening system. Complete mortal settlement simulation: households grow naturally, awaken cultivators based on spiritual energy, and upgrade into settlements (hamlet/village/town/city).

## Key Decisions (from brainstorm)

| Decision | Choice |
|----------|--------|
| Mortal simulation granularity | Household-level (not individual) |
| Map organization | Settlement layer (settlement -> household[]) |
| Spiritual root mechanism | Pure random awakening, affected by spiritualEnergy |
| Cultivator-mortal relationship | Indirect: disciple source + territory + war byproduct |
| Settlement-faction relationship | Settlement as faction infrastructure layer |
| Household-settlement lifecycle | Unified growth model (household upgrades to settlement) |
| Initial world | Start from zero, wilderness era |

## New Files

- `src/engine/household.ts` — HouseholdSystem (growth, awakening, splitting, combat collateral)
- `src/engine/settlement.ts` — SettlementSystem (creation, expansion, pruning, naming, type classification)
- `test/household.test.ts` — 21 unit tests
- `test/settlement.test.ts` — 15 unit tests
- `test/settlement-integration.test.ts` — 11 PRD-based integration tests

## Modified Files

- `src/engine/simulation.ts` — Core refactor: tickYear household-driven, snapshot v4
- `src/types.ts` — Household, Settlement interfaces, Cultivator origin fields
- `src/constants.ts` — Growth rate, awakening rate, settlement thresholds
- `src/engine/combat.ts` — Combat collateral damage to both cells
- `server/identity.ts` — Origin settlement name in JieDan naming
- `server/runner.ts` — Extinction check includes household count
- `server/ipc.ts` — WorldContext settlement summary
- `src/components/Controls.tsx` — Label "初始家户数", default 200
- `src/components/StatsPanel.tsx` — Settlement stats display
- `cli.ts` — Prompt "Households", default 200

## Review Notes

- Codex review found 2 critical + 8 warning issues, all critical + 5 warnings fixed
- Remaining: settlement persistence (DB table), legacy v1-v3 migration semantics


### Git Commits

| Hash | Message |
|------|---------|
| `4164eb5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 31: RL-based character AI decision system

**Date**: 2026-03-30
**Task**: RL-based character AI decision system
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## 概要

为修仙模拟引入 RL 训练的小型神经网络（MLP 12→32→16→5，1029参数），替换 `evaluateBehaviorStates()` 中的硬编码优先级规则，使角色行为决策具备涌现式智慧。

## 架构

- **配置驱动**：单一 `ai-policy/config.json` 定义 features/actions/rewards/network，同时驱动 Python 训练和 TS 推理
- **Python 训练**：简化版引擎 (Gymnasium env) + stable-baselines3 PPO，5M timesteps
- **TS 推理**：零外部依赖手写 forward()，<1ms/1000角色
- **Fallback**：权重缺失或版本不匹配时自动退回规则系统

## 训练环境改进

初版 env 行为-结果因果链太弱（地形每年随机重摇），导致策略接近均匀分布。改进后：
- 持久位置 + 行为驱动漂移（seeking 提升灵气，escaping 降低危险，settling 锁定位置）
- 灵气直接影响修炼增长速率
- Lv0 有小概率战斗遭遇
- Recuperating 加速伤势恢复

改进后模型在关键场景有明确行为分化：受伤选 recuperating、低灵气选 seeking、经脉伤选 settling。

## 新增文件

| 文件 | 说明 |
|------|------|
| `ai-policy/config.json` | 配置源 (12 features / 5 actions / 6 rewards) |
| `ai-policy/weights/v1.json` | 训练权重 (22KB, 1029 params) |
| `ai-policy/train/env.py` | Gymnasium 训练环境 |
| `ai-policy/train/train.py` | PPO 训练脚本 |
| `ai-policy/train/export.py` | 权重导出 JSON |
| `src/engine/ai-policy.ts` | 通用 MLP 推理引擎 |
| `src/engine/ai-state-extract.ts` | 12维状态提取 |

## 修改文件

| 文件 | 说明 |
|------|------|
| `src/engine/simulation.ts` | 添加 `aiPolicy` 集成点 |
| `.gitignore` | 排除 .venv/、model/、__pycache__/ |


### Git Commits

| Hash | Message |
|------|---------|
| `fb8686e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 32: feat: character memory system

**Date**: 2026-03-30
**Task**: feat: character memory system
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## 完成内容

为修仙模拟中的每个角色植入完整记忆系统，涵盖 5 大维度：

| 维度 | 内容 | 行为效果 |
|------|------|---------|
| 角色间记忆 | 12 槽对手记忆 + 同乡识别 | 曾败逃跑+35%, 同乡战斗-60% |
| 地点记忆 | 4 槽危险/福地记忆 | 回避受伤处, 返回突破地, 故乡归巢 |
| 性格演化 | 6 情感状态 + 指数衰减 | confidence/caution/ambition/bloodlust/rootedness/breakthroughFear |
| 突破心理 | 恐惧累积 + ambition 交互 | "心魔"延迟突破, 高 courage 不服输 |
| 叙事里程碑 | 首次战斗/突破/杀人/最惨失败/最辉煌胜利 | biography 系统素材 |

## 技术实现

- **数据**: `src/engine/memory.ts` — 类型、工厂、环形缓冲、序列化、事件驱动更新
- **配置**: `src/sim-tuning.ts` — MemoryTuning (22 个可调参数)
- **序列化**: v5 格式, v4 向后兼容, ~234 bytes/角色
- **RL 训练**: 状态向量 12→18 维, 网络 [32,16]→[64,32], 2M steps 重训完成
- **测试**: 27 个新增单元测试, 全部 79 测试通过

## 修改文件

- `src/engine/memory.ts` (新) — 核心记忆模块
- `src/engine/simulation.ts` — memories[], serialize v5, 情感衰减, 突破心理
- `src/engine/combat.ts` — 对手记忆, 同乡抑制, confidence/bloodlust
- `src/engine/spatial.ts` — 故乡归巢, 危险回避, 福地吸引, 戾气趋危
- `src/engine/ai-state-extract.ts` — 18 维状态向量
- `src/sim-tuning.ts` — MemoryTuning 配置
- `src/types.ts` — CharacterMemorySnapshot, EngineHooks 扩展
- `server/runner.ts` — getMemorySnapshot hook
- `ai-policy/config.json` — v2 配置
- `ai-policy/train/env.py` — 训练环境记忆模拟
- `ai-policy/weights/v2.json` — 重训权重
- `test/memory.test.ts` — 27 个测试


### Git Commits

| Hash | Message |
|------|---------|
| `6424314` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 33: 凡人人口平衡：自然死亡率 + 天灾系统

**Date**: 2026-03-30
**Task**: 凡人人口平衡：自然死亡率 + 天灾系统
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## 变更概述

为凡人人口引入双重平衡机制，解决无限指数增长问题：

| 机制 | 说明 |
|------|------|
| 密度死亡率 | `deaths = pop × baseDeathRate × (1 + densityPressure × max(0, ratio-1))`，低密度 0.5%/年，超载时加速 |
| 天灾事件 | 5 类：瘟疫/饥荒/洪水/兽潮/灵气紊乱，密度触发 + 随机散发 |
| 两层承载力 | 单格硬上限 1500 + 聚落层面密度压力 |
| 事件记录 | 聚落损失 ≥10% 时生成 RichDisasterEvent |

**新增文件**: `src/engine/disaster.ts`

**修改文件**:
- `src/sim-tuning.ts` — MortalDeathTuning + DisasterTuning 类型及默认参数
- `src/types.ts` — Household.deathAccum, RichDisasterEvent, YearSummary 计数器
- `src/engine/household.ts` — tickAll() 密度死亡率 + 序列化 v6
- `src/engine/simulation.ts` — tickYear() 天灾处理 + 快照版本 v6
- `server/events.ts` — toDisplayEvent 天灾分支
- `server/runner.ts` — getNamedCultivatorIds 天灾分支

**调参记录**: baseDeathRate 0.02→0.005, carryingCapacityPerCell 500→1500


### Git Commits

| Hash | Message |
|------|---------|
| `895e8df` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 34: fix: settlement level distribution

**Date**: 2026-03-30
**Task**: fix: settlement level distribution
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## Root Cause

Every household split unconditionally created a new settlement. Settlements could never accumulate
population past ~250 because all households split out in the same tick, leaving 0 pop → pruned.
Village (200-999) and town (1000-4999) were structurally unreachable.

## Fix

- Added `SettlementSystem.addCell()` method for expanding settlements to new cells
- Modified split logic in `tickYear()`: splits within an existing settlement expand it; only unaffiliated households create new settlements

**Files**:
- `src/engine/settlement.ts` — new `addCell()` method
- `src/engine/simulation.ts` — conditional split handling


### Git Commits

| Hash | Message |
|------|---------|
| `98bfe4a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 35: 聚落地盘收缩机制

**Date**: 2026-03-30
**Task**: 聚落地盘收缩机制
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## 实现内容

| 变更 | 说明 |
|------|------|
| `SettlementTuning.shrinkThreshold` | 新增收缩阈值参数（默认 300/cell），与扩张阈值（1000/cell）形成滞后带防止振荡 |
| `SettlementSystem.tryShrink()` | 人口密度低于阈值时释放末尾 cell，取消该 cell 上 household 的聚落归属 |
| `SimulationEngine.tickYear` | 在扩张循环后、清理前调用 tryShrink 循环 |

**修改文件**:
- `src/sim-tuning.ts` — SettlementTuning 类型、默认值、merge 函数
- `src/engine/settlement.ts` — 新增 tryShrink 方法
- `src/engine/simulation.ts` — tick 循环中集成收缩逻辑


### Git Commits

| Hash | Message |
|------|---------|
| `079796a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 36: Dashboard UI/UX overhaul + WebSocket proxy fix

**Date**: 2026-03-30
**Task**: Dashboard UI/UX overhaul + WebSocket proxy fix
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

| 改动 | 说明 |
|------|------|
| index.css 全量重写 | 更深配色(#050510)、圆角面板、渐变标题、发光边框、微交互动效、自定义滚动条 |
| EventLog 左边框 | 事件类型彩色左边框指示(战斗红/晋升金/寿尽灰等) |
| vite.config.ts | 添加 /ws WebSocket 代理到后端 3001 端口，修复 dev 模式连接问题 |

**设计方向**: 修仙主题暗色 Dashboard — 深邃虚空背景 + 灵气辐射渐变 + 蓝金渐变标题
**工具**: 使用 ui-ux-pro-max skill 生成设计系统(Dark Mode OLED + Gaming Dashboard)


### Git Commits

| Hash | Message |
|------|---------|
| `42503cf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

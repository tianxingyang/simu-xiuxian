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

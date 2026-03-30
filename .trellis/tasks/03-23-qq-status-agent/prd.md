# QQ Bot LLM 自然语言查询 Agent

## Goal

为 QQ bot 增加 LLM 自然语言查询能力，用户 @bot 后可用自然语言提问修仙世界的任何问题。通过 tool call（db_query + mem_query）+ 上下文注入实现，支持多轮对话。

## Requirements

### 交互模式
- 所有 bot 交互统一改为 @bot 触发（包括现有命令）
- 现有命令（状态/日报/传记/about/help）保持原有逻辑，不纳入对话历史
- 未匹配命令的消息 → LLM agent 处理

### 对话管理
- 对话历史 key = `(groupId, userId)`，多轮上下文
- Auto compact：设定 token 上限，达 80% 触发压缩摘要
- 同一群同时只处理一个 LLM 请求（复用 `_busyGroups`）

### 上下文注入（每次 LLM 调用刷新）
- WorldContext（实时人口、境界分布、区域概况、聚落摘要）
- YearSummary（当年统计）
- SimTuning + 常量（系统设定）
- DB schema（DDL）
- 引擎内存接口描述（可用对象、属性、方法）

### Tool Call
- **`db_query`**：LLM 生成 SQL，只读连接，仅允许 SELECT
- **`mem_query`**：LLM 生成 JS 表达式，通过 IPC 发送到 sim-worker，在 `vm.runInNewContext()` 沙箱中执行，返回 JSON 结果
  - 安全：只读 Proxy 防修改、执行超时、受限上下文（仅引擎对象，无 process/fs/require）

## Acceptance Criteria

- [ ] @bot + 自然语言问题 → LLM 理解并回答
- [ ] db_query 可查询事件、修士、日报等历史数据
- [ ] mem_query 可查询引擎内存（修士实时状态、聚落详情、区域数据、系统设定）
- [ ] 多轮对话 per-group+per-user，auto compact 正常工作
- [ ] 现有命令功能不受影响，统一 @bot 触发
- [ ] 同群串行处理，有"生成中"提示
- [ ] db_query 安全：只读、仅 SELECT
- [ ] mem_query 安全：沙箱执行、只读、有超时

## Definition of Done

- Lint / typecheck pass
- 手动测试：自然语言问答、tool call、多轮对话、现有命令兼容
- 无安全漏洞（SQL 注入、内存修改）

## Decision (ADR-lite)

**Context**: 需要让 QQ bot 支持自然语言查询修仙世界状态
**Decision**: 混合型架构 — 现有命令走原逻辑（快），其余走 LLM + tool call（灵活）
- 数据获取：上下文注入（WorldContext/YearSummary/SimTuning）+ 两个原子 tool（db_query/mem_query）
- 对话管理：per-group+per-user 多轮，auto compact
- mem_query 用表达式式（LLM 写 JS），通过 IPC 在 sim-worker 的 vm 沙箱执行
**Consequences**: 灵活度高，新增数据字段只需更新 prompt 描述；vm 沙箱需要仔细控制安全边界

## Out of Scope

- 主动推送通知
- 图片/图表生成
- 私聊支持

## Technical Notes

### 架构变更
- LLM worker 扩展：新增 `job:chat` 类型，支持 tool call 循环
- Gateway 扩展：
  - 对话 session store（内存 `Map<'${groupId}:${userId}', ConversationHistory>`）
  - 路由未匹配消息到 LLM
  - 触发改为 @bot（移除 `/` 前缀依赖）
- Sim-worker 扩展：新增 `sim:memQuery` IPC 命令，vm 沙箱执行 JS 表达式

### 关键文件
- `server/index.ts` — 消息路由、session 管理、IPC 转发
- `server/bot.ts` — OneBot 连接（无需大改）
- `server/ipc.ts` — IPC 类型定义
- `server/processes/sim-worker.ts` — mem_query 执行
- `server/processes/llm-worker.ts` — chat job 处理
- `server/reporter.ts` — 复用 callLLM 基础设施
- `src/sim-tuning.ts` — SimTuning 常量
- `src/constants/*` — 系统常量

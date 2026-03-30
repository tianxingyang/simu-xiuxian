# brainstorm: 模拟交互系统 - 非暴力角色交互机制

## Goal

在现有修仙模拟中引入非暴力角色交互机制，让修仙者之间除了战斗以外，还能通过其他方式产生有意义的互动，丰富模拟世界的叙事深度。

## What I already know

### 现有系统状态
* 角色之间唯一的交互方式是**战斗**（combat.ts）
* 没有经济/交易/物品系统 — 唯一的"资源"是修为点数（cultivation points）
* 角色有丰富的记忆系统（encounters ring buffer、emotional states、narrative milestones）
* 角色有行为状态系统（behaviorState: escaping/recuperating/seeking_breakthrough/settling/wandering）
* 同源聚落的修仙者有亲缘识别（combat willingness -60%）
* 空间系统：32x32 环形网格，基于距离的相遇机制
* 事件系统：RichEvent 支持多种类型，带 S/A/B/C 新闻等级
* 角色在结丹（level 2+）时获得中文名字
* 存在 AI Policy 系统（MLP 神经网络决策行为状态）

### 技术约束
* 每年 tick 一次，需要高性能（大量角色同时模拟）
* 事件需要序列化存储到 SQLite
* 前端通过 WebSocket 接收事件流
* 需要与现有的 LLM 报告/传记系统兼容

## Assumptions (temporary)

* 交互应该产生有意义的机械效果（不仅仅是叙事装饰）
* 交互频率和战斗类似，基于空间邻近性触发
* 需要新的 RichEvent 类型来记录交互事件

## Open Questions

1. ~~**交互的核心目的**~~：已确认 — 综合型（资源交换 + 关系构建 + 合作任务）
2. **MVP 范围**：三类交互全部做还是分阶段？优先哪一类？
3. **对现有系统的影响**：交互结果是否应该影响战斗意愿、行为状态等现有系统？
4. **与势力系统的关系**：是否作为势力系统（03-20-faction-system）的前置基础？

## Requirements (evolving)

* 角色之间能够进行非暴力交互
* 交互基于空间邻近性触发（类似战斗相遇机制）
* 交互产生有意义的事件记录
* 与现有记忆系统和事件系统集成

## Acceptance Criteria (evolving)

* [ ] 角色在空间上相遇时，除了战斗外有概率触发非暴力交互
* [ ] 交互产生 RichEvent 并在前端显示
* [ ] 交互结果对角色状态产生机械影响
* [ ] 性能不显著下降（tick 耗时增加 <20%）

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Decision (ADR-lite)

**Context**: 三类交互（关系构建、资源交换、合作任务）之间有依赖关系，一次全做工程量过大。
**Decision**: 按依赖链分三个阶段实现：关系构建 → 资源交换 → 合作任务。关系构建同时作为势力系统（03-20-faction-system）的前置基础。
**Consequences**: Phase 2/3 需要等 Phase 1 完成后才能开始；每个阶段独立可交付。

## Implementation Phases

1. **Phase 1 — 关系构建** (`03-30-relationship-system`): 道友/师徒/对立关系
2. **Phase 2 — 资源交换** (`03-30-resource-exchange`): 切磋/传授/交易（依赖 Phase 1）
3. **Phase 3 — 合作任务** (`03-30-cooperative-tasks`): 组队突破/联手御敌（依赖 Phase 1+2）

## Out of Scope (explicit)

* 道侣关系（需性别系统前置）
* 势力/宗门系统（属于 03-20-faction-system）
* 物品/装备系统
* 货币/市场系统

## Technical Notes

* 战斗相遇逻辑在 `src/engine/combat.ts` 的 `processEncounters()`
* 空间索引在 `src/engine/spatial.ts`
* 记忆系统在 `src/engine/memory.ts`（encounters ring buffer 12 slots, emotional states）
* 行为评估在 `simulation.ts` 的 `evaluateBehaviorStates()`
* 事件类型定义在 `src/types.ts`
* 事件展示转换在 `server/events.ts`

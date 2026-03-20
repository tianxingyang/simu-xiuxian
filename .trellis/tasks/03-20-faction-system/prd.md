# 势力系统设计

## Goal

为修仙模拟器引入势力/宗门系统，让修士从纯个体行为演变为有组织的群体行为，增加模拟的丰富度和故事性。

## What I already know

### 现有架构
- 修士均为独立个体，无任何组织归属
- 32x32 环形地图，10 个地理区域，每格有灵气浓度(1-5)和危险度(1-5)
- 8 大境界：炼气(0) → 筑基(1) → 结丹(2) → 元婴(3) → 化神(4) → 炼虚(5) → 合体(6) → 大乘(7)
- 结丹(Lv2)自动命名
- 行为状态：wandering / escaping / recuperating / seeking_breakthrough / settling
- 战斗仅同境界，胜率由修为比决定
- 每年 tick 生成 1000 新修士

### 关键约束
- 数据库：raw SQL（better-sqlite3），非 ORM
- 引擎状态通过二进制快照持久化（v3 格式）
- 前后端 WebSocket 通信
- 确定性 PRNG（种子可复现）

## Assumptions (temporary)

- 势力是自然涌现的，非手动创建
- 势力与地图系统深度绑定（领地概念）
- 需要在性能上可控（当前每年 tick 处理大量修士）

## Open Questions

1. **势力的形成机制**：如何产生势力？
2. **势力的核心玩法**：势力之间的互动是什么？
3. **势力与个体的关系**：修士加入/离开势力的机制？
4. **MVP 范围**：第一版需要实现哪些核心功能？

## Requirements (evolving)

- (待讨论确认)

## Acceptance Criteria (evolving)

- [ ] (待讨论确认)

## Out of Scope (explicit)

- (待讨论确认)

## Technical Notes

- 关键文件：
  - `src/engine/simulation.ts` — tick 主循环
  - `src/engine/combat.ts` — 战斗系统
  - `src/engine/spatial.ts` — 空间索引
  - `src/types.ts` — 核心类型
  - `server/db.ts` — 数据库 schema
  - `src/constants.ts` — 境界/地图常量
  - `src/balance.ts` — 平衡参数

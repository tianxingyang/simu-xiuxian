# Event Eviction Based on Memory Curve

## Goal

为 events 表设计基于 Ebbinghaus 记忆曲线的统一淘汰机制。所有事件按 rank 映射不同记忆年限，随模拟时间推移逐渐"被世界遗忘"并从 DB 中清除。涉及具名修士的事件受 protected 保护，直到相关修士也被遗忘。

## Requirements

- 统一淘汰规则：超过 rank 对应记忆年限且 protected = 0 → 删除
- events 表 `protected` 字段标记是否涉及具名修士
- 新建 `event_cultivators` 关联表，插入事件时同步写入
- 修士死亡后记忆衰减，所有涉及的具名修士都 forgotten 后 protected → 0
- 每次 tick batch 结束后触发淘汰
- 分批删除（LIMIT 5000），不阻塞模拟

## Memory Duration by Rank

| Rank | 记忆年限 |
|------|---------|
| B | 200 |
| A | 2000 |
| S | 15000 |

## Event Lifecycle

```
事件入库（insertEvents）
  ├─ 涉及具名修士 → protected = 1, 写入 event_cultivators
  └─ 匿名修士 → protected = 0

淘汰扫描（每次 tick batch 后）：
  1. Fast path: DELETE protected=0 且超过记忆年限的事件（分批 LIMIT 5000）
  2. Slow path（每 60s 真实时间）:
     - 查 forgotten 修士 ID
     - 通过 event_cultivators 找其事件
     - 确认事件中无其他 remembered 修士 → unprotect
     - 同时清理 event_cultivators 中的过期条目
```

## Decision (ADR-lite)

**Context**: processMemoryDecay 用 json_extract 全表扫描查找修士事件，阻塞事件循环
**Decision**: 新建 event_cultivators 关联表，通过索引查找替代 json_extract
**Consequences**: 额外存储（每条涉及具名修士的事件多 1-2 行），insertEvents 多一步写入

## Schema

```sql
CREATE TABLE IF NOT EXISTS event_cultivators (
  event_id INTEGER NOT NULL,
  cultivator_id INTEGER NOT NULL,
  PRIMARY KEY (cultivator_id, event_id)
);
```

- PK 顺序 (cultivator_id, event_id): 按 cultivator_id 查找最高效
- 只存涉及具名修士的事件（大部分事件不需要）

## Acceptance Criteria

- [ ] 新建 event_cultivators 表
- [ ] insertEvents 时对 protected=1 的事件写入 event_cultivators
- [ ] processMemoryDecay 通过 event_cultivators 查找事件（不再用 json_extract）
- [ ] 事件被 evict 时同步清理 event_cultivators 条目
- [ ] 不阻塞模拟性能（< 100ms per tick batch）

## Out of Scope

- 历史存量数据清理（用户会清空 DB）
- C 级事件（不入库）

## Technical Notes

- 当前已实现：protected 字段、insert 时标记、fast path 分批删除
- 待实现：event_cultivators 表 + 重写 processMemoryDecay
- db.ts 中 protectEventsForCultivator / queryProtectedEventsForCultivator 等使用 json_extract 的函数可删除
- eviction.ts 中 processMemoryDecay 需重写为基于关联表查询

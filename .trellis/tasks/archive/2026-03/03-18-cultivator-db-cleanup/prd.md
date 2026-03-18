# 修士数据库物理删除

## Goal

在 `processMemoryDecayBatch` 中增加物理删除步骤，将已标记 `forgotten = 1` 的修士从 `named_cultivators` 表中删除，避免记录无限累积。

## Requirements

- 在 `processMemoryDecayBatch` 现有流程（标记 forgotten → 清理孤儿事件）之后，新增一步：`DELETE FROM named_cultivators WHERE forgotten = 1`
- 批量删除，复用现有的 CHUNK 分批机制
- 返回值中增加 `purged` 计数
- 飞升修士不受影响（已有 `death_cause != 'ascension'` 条件保护，不会被标记 forgotten）

## Acceptance Criteria

- [ ] `processMemoryDecayBatch` 执行后，`forgotten = 1` 的行被物理删除
- [ ] 返回值包含 `purged` 字段
- [ ] `eviction.ts` 日志输出包含 purged 计数
- [ ] 飞升修士记录不被删除
- [ ] `biography.ts` 查询已删除修士时返回 undefined（已有兜底逻辑）
- [ ] `reporter.ts` 查询已删除修士时返回 undefined（已有兜底逻辑）
- [ ] 构建通过（`npm run build` 0 error）

## Decision (ADR-lite)

**Context**: `named_cultivators` 只增不删，长期运行后数据膨胀。`forgotten = 1` 的修士已无功能用途（传记返回固定文本，event_cultivators 链接已清除）。

**Decision**: 在 `processMemoryDecayBatch` 的事务末尾直接 DELETE forgotten 行，无额外宽限期。forgotten 标记前已有基于 peak_level 的完整衰减周期（100~15000 年）。

**Consequences**: 物理删除后无法恢复历史修士数据。如未来需要"考古"功能，需另行设计归档机制。

## Out of Scope

- 历史修士归档/导出
- 修改 forgotten 标记的衰减年限
- 前端展示变更

## Technical Notes

- 修改文件：`server/db.ts`（`processMemoryDecayBatch` 函数）、`server/eviction.ts`（日志输出）
- `biography.ts:queryNamedCultivatorByName` 返回 undefined 时已有处理（返回 null）
- `reporter.ts:queryNamedCultivator` 返回 undefined 时已有条件判断

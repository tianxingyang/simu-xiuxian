# 聚落地盘收缩机制

## Goal
当聚落人口下降时（天灾、修士战斗等），聚落应释放多余的 cells，使地盘与人口规模匹配。目前聚落只有 `tryExpand` 扩张逻辑，缺少对应的收缩逻辑。

## Requirements
- 每年 tick 中，在人口变动后检查聚落是否需要收缩
- 收缩条件：人口密度低于某个阈值时，释放边缘 cells（保留核心 cell）
- 释放的 cell 从 `cellToSettlement` 中移除，允许其他聚落占据
- 聚落至少保留 1 个 cell（origin cell），不会完全收缩为 0
- 收缩阈值应作为 sim-tuning 参数可配置

## Acceptance Criteria
- [ ] `SettlementSystem` 新增 `tryShrink` 方法
- [ ] 收缩阈值在 `sim-tuning.ts` 中可配置
- [ ] 每年 tick 中调用 `tryShrink`
- [ ] 收缩时释放边缘 cells，保留至少 1 个 cell
- [ ] 释放的 cell 上无归属聚落的 household 设为 unaffiliated（settlementId = -1）
- [ ] 现有测试通过

## Technical Notes
- 扩张阈值为 `settlement.expandThreshold`（每 cell 人口上限），收缩阈值应低于此值，避免反复扩缩
- 收缩优先释放远离 origin cell 的边缘 cells
- 需处理释放 cell 上仍有 household 的情况（重新标记为 unaffiliated 或迁移）

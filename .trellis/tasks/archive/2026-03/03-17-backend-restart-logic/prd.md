# 后端重启性能优化 - 快照替代重放

## Goal

消除后端重启时从 year 1 线性重放到 current_year 的耗时，改为直接从快照恢复引擎状态。

## What I already know

- 当前 `runner.restore()` 使用确定性重放：`while (engine.year < target) engine.tickYear(false)`
- 重放时间与 current_year 线性正相关，年份越高重启越慢
- PRNG 使用 Mulberry32 闭包，当前无法提取/恢复内部 seed 状态
- Cultivator 有 14 个字段，典型 population ~1000
- `levelGroups` 和 `spatialIndex` 可从 cultivators 数组重建
- Milestones 和 IdentityManager 已有独立的持久化/恢复逻辑

## Requirements

- 引擎状态可序列化/反序列化，恢复后行为与重放完全一致
- PRNG 状态可提取和恢复（修改 mulberry32 实现）
- 快照存储在 SQLite sim_state 表（新增 BLOB 列）
- 恢复时间 O(population) 而非 O(years)
- 向后兼容：无快照时 fallback 到原有重放逻辑

## Acceptance Criteria

- [ ] PRNG 支持 getSeed() / 从 seed 恢复
- [ ] SimulationEngine 支持 serialize() / 静态 deserialize()
- [ ] Runner.restore() 优先使用快照，无快照时 fallback 到重放
- [ ] 恢复后引擎状态与重放结果一致（确定性验证）
- [ ] sim_state 表新增 snapshot BLOB 列

## Out of Scope

- 前端变更
- 增量快照 / 周期性快照策略
- 快照压缩

## Technical Notes

### 需要序列化的状态

| 组件 | 序列化方式 |
|------|-----------|
| PRNG 内部 seed (i32) | 修改闭包为对象，暴露 state |
| cultivators[] (0..nextId) | 逐字段写入 binary buffer |
| nextId, year, aliveCount, yearlySpawn | header 区域 |
| freeSlots[] | 变长 i32 数组 |

### 可重建的派生状态（不需要序列化）

- levelGroups: 遍历 alive cultivators 按 level 分组
- spatialIndex: 遍历 alive cultivators 调用 add()
- aliveIds / levelArrayCache: 每 tick 重建
- _defeatedBuf / _levelArrayIndex: 每 tick 重建

### 估算快照大小

每 Cultivator ~72 bytes，1000 人口 ~72KB，含 header/freeSlots 总计 <100KB

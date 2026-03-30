# 凡人人口增长平衡机制

## Goal

解决凡人人口无限指数增长的问题，引入自然死亡率 + 天灾事件的双重平衡机制，使人口在长期模拟中收敛到由承载力决定的稳态值。

## Requirements

### 机制一：自然死亡率
- 每户每年计算死亡：`deaths = pop × baseDeathRate × (1 + densityPressure × pop / cellCapacity)`
- 基础死亡率抵消部分增长，密度越高死亡越多
- 新增参数：`baseDeathRate`、`densityPressureFactor`、`carryingCapacityPerCell`

### 机制二：天灾事件
- 5 种天灾类型：
  - **瘟疫（plague）**：高密度聚落，损失 15-40%
  - **饥荒（famine）**：高密度 + 低安全地形，损失 10-25%，最常见
  - **洪水（flood）**：随机性强，损失 5-15%
  - **兽潮（beast_tide）**：高危险地形 + 高灵气，损失 10-30%
  - **灵气紊乱（qi_disruption）**：极高灵气区域，损失 5-20%
- 触发机制：密度触发为主 + 极低概率随机散发
- 所有级别聚落均可触发
- 保底：任何灾害后户口人口不低于 1

### 承载力模型（两层）
- 单格硬上限：`carryingCapacityPerCell`
- 聚落层面密度压力：聚落总人口 / (聚落格数 × 单格承载力)

### 事件记录
- 单次灾害导致聚落人口损失 ≥ 10% 时生成事件记录
- 小规模灾害静默计算

### 参数管理
- 全部通过 sim-tuning 配置
- 自适应总量：不设全局目标，由每格承载力 × 可居住格数自然决定

## Acceptance Criteria

- [ ] 人口增长曲线呈 S 形收敛（非指数 J 形）
- [ ] 天灾事件正常触发和记录
- [ ] 现有 balance test 不受影响
- [ ] 所有参数可通过 sim-tuning 调整

## Definition of Done

- Lint / typecheck pass
- 现有测试不 break

## Out of Scope

- 个体凡人生命周期追踪
- 修仙者人口平衡
- 前端 UI 变更
- 天灾事件的前端展示

## Decision (ADR-lite)

**Context**: 凡人人口 3%/年复利增长无上限，约每 23 年翻倍，长期模拟后达到 10^10+ 级别
**Decision**: 自然死亡率（密度相关）+ 5 类天灾事件（密度触发 + 随机散发），两层承载力模型
**Consequences**: 需要调参确定合理的 carryingCapacityPerCell；天灾系统日后可扩展更多类型

## Technical Notes

- 关键文件：`src/engine/household.ts`（增长/觉醒/分裂逻辑）
- 参数定义：`src/sim-tuning.ts`（HouseholdTuning 类型）
- 聚落系统：`src/engine/settlement.ts`（扩张逻辑）
- 聚落常量：`src/constants/settlement.ts`
- 地形数据通过 `AreaTagSystem` 获取（terrainDanger, spiritualEnergy）
- 天灾系统需要新建模块或嵌入 household tick 流程

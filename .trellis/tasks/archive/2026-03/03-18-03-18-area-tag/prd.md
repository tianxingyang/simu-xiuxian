# AreaTag 地块标记系统

## Goal

为 32x32 地图的每个格子添加属性标记（灵气浓度、地势险要程度），影响修炼突破、修士移动、战斗遭遇、逃跑等核心游戏机制。

## Requirements

- 粒度：单格级别（1024 格），每格独立属性
- 值域：1-5 离散等级
- 初始生成：程序化算法（Perlin noise 等），种子可控可复现
- 变化模式：缓变动态，事件驱动的低频变化
- 标记类型可扩展（后续可加新标记）

### 标记类型与机制影响

| 标记 | 机制影响 |
|------|---------|
| 灵气浓度 (1-5) | 突破概率加成 + 修士倾向往高灵气区域移动 |
| 地势险要 (1-5) | 战斗遭遇率加成 + 逃跑成功率降低 |

## Acceptance Criteria

- [ ] 1024 格各有独立的灵气浓度和地势险要等级 (1-5)
- [ ] 初始值由程序化算法生成，种子可控
- [ ] 灵气浓度影响突破概率
- [ ] 灵气浓度影响修士移动倾向
- [ ] 地势险要影响战斗遭遇率
- [ ] 地势险要影响逃跑成功率
- [ ] 支持事件驱动的标记值变更
- [ ] 标记类型可扩展

## Definition of Done

- Lint / typecheck green
- Docs/notes updated if behavior changes

## Out of Scope

- 前端地图可视化标记
- 标记的数据库持久化
- 标记的 UI 编辑器

## Technical Approach

- 用 `Int8Array` 或类似结构存储 1024 格的标记值
- 程序化生成初始值（种子控制）
- 提供 `getAreaTag(x, y, tagType)` 查询接口
- 在 `spatial.ts` 的移动/遭遇逻辑中集成标记影响
- 预留标记类型的扩展能力

## Technical Notes

- 核心文件：`src/constants.ts`（地域定义）、`src/engine/spatial.ts`（空间索引）、`src/types.ts`
- 上一个任务 03-18-map-regions 预留了扩展点
- 32x32 环形网格，MAP_SIZE=32, MAP_MASK=31

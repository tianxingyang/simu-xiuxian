# 地图地域系统

## Goal

为 32×32 环形地图引入"地域"概念，将格子划分到不同的命名区域，赋予地图空间叙事能力。纯叙事层，不影响任何游戏机制。

## Requirements

* 每个格子归属于一个地域（含外海），共 11 种地域
* 地域有 code、中文名称等元数据
* 地域数据以静态常量形式存在（1024 格逐格定义）
* 提供 `getRegion(x, y)` 查询接口，O(1) 查询
* 地域信息可用于事件描述文案

## Region Layout

10 个地域 + 外海，手绘地图如下：

| Code | Name     |
|------|----------|
| N    | 朔北冻原 |
| G    | 苍茫草海 |
| P    | 西嶂高原 |
| M    | 天断山脉 |
| C    | 河洛中野 |
| F    | 东陵林海 |
| H    | 赤岚丘陵 |
| S    | 南淮泽国 |
| D    | 裂潮海岸 |
| I    | 潮生群岛 |
| ~    | 外海     |

## Acceptance Criteria

* [ ] 每个格子都能通过坐标查询所属地域
* [ ] 地图布局与用户提供的手绘图完全一致
* [ ] 地域信息可用于事件描述（如"朔北冻原上，一名修士突破至筑基"）
* [ ] 不影响现有任何游戏机制（移动、战斗、修炼）

## Decision (ADR-lite)

**Context**: 地域系统的复杂度选择
**Decision**: MVP 采用纯叙事层，地域仅作为标签用于事件描述
**Consequences**: 数据结构设计预留扩展性（后续可添加地域属性），但本次不实现任何机制影响

## Out of Scope

* 地域对游戏机制的影响（灵气浓度、修炼加成、战斗修正等）
* 外海格子的移动限制
* 前端地图可视化组件
* 地域间边界/过渡带特殊逻辑

## Technical Approach

* 在 `src/constants.ts` 或独立文件中定义地域元数据（enum + name map）
* 用 32×32 字符串数组编码地图布局，每行一个字符串
* 提供 `getRegion(x, y): RegionCode` 函数，通过 cellIdx 直接索引
* 事件系统调用 `getRegion` 获取地域名称插入描述文案

## Technical Notes

* `src/constants.ts` L198-204: MAP_SIZE=32, MAP_MASK=31
* `src/engine/spatial.ts`: SpatialIndex, moveCultivators, findSpatialOpponent
* 地图数据量小（1024 格），适合硬编码为常量数组，无需 DB
* 坐标系：用户地图 (1,1) 起始，代码中 (0,0) 起始，转换时 -1

# Map System with Spatial Matching

## Goal

为修仙模拟器引入 32x32 网格地图系统，使修士拥有空间坐标，出生在随机位置，战斗匹配仅限于固定半径内的同境界修士，并支持随机游走和事件触发的移动。

## Requirements

### 1. 地图结构
- 32x32 均质网格（1024 格），纯后端数据，无前端展示
- 网格边界环绕（toroidal），避免边缘效应

### 2. 修士坐标
- `Cultivator` 增加 `x: number, y: number` 字段
- 新生修士在 32x32 网格上均匀随机分配位置

### 3. 空间战斗匹配
- 战斗匹配从全局同境界改为 **同境界 + 空间半径内**
- 遭遇半径随境界递增（体现高境界"神通广大"）：

| 境界 | Lv0 炼气 | Lv1 筑基 | Lv2 结丹 | Lv3 元婴 | Lv4 化神 | Lv5 炼虚 | Lv6 合体 | Lv7 大乘 |
|------|---------|---------|---------|---------|---------|---------|---------|---------|
| 半径 R | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 16 |

- 遭遇概率基于 **局部密度**（半径内同境界人数 / 半径内总人数）

### 4. 移动机制

**随机游走**：
- 每年每个存活修士有一定概率移动 1 步到相邻格子（8 方向）
- 移动概率随境界递增（高境界修士更活跃）

**事件触发移动**：
- 战败存活：向远离胜者方向逃逸 2~3 格
- 突破成功：随机方向移动 2~4 格（探索新领地）
- 大乘天劫前：不移动（闭关状态）

### 5. 空间索引
- 维护 `spatialGrid[level][y][x] = Set<cultivatorId>` 三维索引
- 索引在出生、死亡、境界变化、移动时同步更新

## Acceptance Criteria

- [ ] Cultivator 拥有 x, y 坐标
- [ ] 新生修士均匀随机分布在 32x32 网格上
- [ ] 战斗仅发生在遭遇半径内的同境界修士之间
- [ ] 修士每年有概率随机游走
- [ ] 战败/突破等事件触发位移
- [ ] 网格边界环绕（坐标 mod 32）
- [ ] 引擎 tick 性能不显著退化

## Definition of Done

- Lint / typecheck pass
- 性能基准对比（tick 时间 < 2x 当前值）

## Out of Scope

- 前端地图可视化
- 区域属性差异（灵气浓度等）
- 门派/势力领地系统
- 区域间经济/交易系统

## Technical Approach

### 数据模型变更
```typescript
// types.ts - Cultivator 增加字段
interface Cultivator {
  // ...existing fields
  x: number;   // 0-31
  y: number;   // 0-31
}
```

### 新增引擎模块: `src/engine/spatial.ts`
- `SpatialIndex` 类：管理三维空间索引
- `queryNeighbors(level, x, y, radius)`: 查询半径内同境界修士
- `moveCultivators(engine)`: 随机游走逻辑
- `fleeCultivator(c, fromX, fromY, distance)`: 事件触发移动

### combat.ts 改造
- `processEncounters` 从全局 levelArrayCache 改为空间查询
- 每个修士在自己的遭遇半径内寻找对手

### simulation.ts 改造
- `spawnCultivators` 分配随机坐标
- `tickYear` 新增移动阶段（在战斗之前）
- 死亡时从空间索引中移除
- 境界变化时更新索引

### constants.ts 新增
```typescript
export const MAP_SIZE = 32;
export const ENCOUNTER_RADIUS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 16];
export const WANDER_BASE_PROB = 0.15;    // 基础游走概率
export const WANDER_LEVEL_BONUS = 0.03;  // 每境界额外概率
export const FLEE_DISTANCE = [2, 3];     // 逃逸距离范围
export const BREAKTHROUGH_MOVE = [2, 4]; // 突破移动范围
```

### 性能考量
- 空间查询 O(R²) per cultivator，R≤16 → 最多 1089 cells
- 但 Lv7 修士极少，大部分是 Lv0-3 (R≤5, 最多 121 cells)
- 使用 toroidal wrap 避免边界判断分支

## Decision (ADR-lite)

**Context**: 需要为修仙模拟器引入空间维度
**Decision**: 32x32 toroidal grid + 境界递增遭遇半径 + 随机游走&事件触发移动
**Consequences**:
- 战斗变为局部化，形成自然的空间竞争格局
- 高境界修士影响范围大，低境界修士在局部活动
- 为未来门派/领地系统奠定空间基础
- 引擎性能会有一定开销（空间查询替代直接数组访问）

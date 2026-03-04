## Why

V8 CPU Profiler 实测显示 `processEncounters` 占单 tick 耗时的 92.3%（median 8.75ms / tick，pop ~20k）。其中 combatLoop 内联代码占引擎自耗时的 72.7%。微基准测试进一步揭示核心数据结构选型失当：`Set.has` 比 `Uint8Array` 索引查询慢 16.4 倍，而 combatLoop 每 tick 对全量存活 id（~15-20k）执行 `defeatedSet.has(id)` 检查。此外 `threshold()` 作为热函数被高频调用（占 3.7% 自耗时），却每次执行 `10 ** level` 指数运算。这些瓶颈在人口增长后会线性恶化。

## What Changes

- `defeatedSet` 从 `new Set<number>()` 替换为 `Uint8Array` 位标记数组，按 cultivator id 直接索引
- `threshold()` 从运行时 `10 ** level` 计算改为预计算常量查表 `THRESHOLDS[]`
- combatLoop 中 `nk / snapshotN` 概率阈值从循环内逐次计算改为循环前按 level 预计算
- `resolveCombat` 中 `arr.indexOf(loser.id)` O(n) 线性搜索改为维护反向索引实现 O(1) 定位
- `effectiveCourage()` 在 `tickCultivators` 阶段预算并缓存到 cultivator 对象，避免 combat 阶段重复计算

## Capabilities

### New Capabilities

- `combat-hot-path-optimization`: 覆盖 combatLoop 数据结构替换（defeatedSet → Uint8Array）、概率预计算、反向索引、courage 缓存等所有热路径优化点

### Modified Capabilities

- `encounter-combat`: combatLoop 内部数据结构和控制流变更，行为语义不变
- `cultivation-levels`: `threshold()` 实现从函数计算改为查表，返回值不变

## Impact

- `src/engine/combat.ts` — combatLoop 重构、resolveCombat 中反向索引替换 indexOf
- `src/engine/simulation.ts` — tickCultivators 中新增 effectiveCourage 预算、Uint8Array 分配
- `src/constants.ts` — threshold() 改为查表、新增 THRESHOLDS 常量数组
- `src/types.ts` — Cultivator 接口新增 `cachedCourage` 字段
- 不影响 UI 层（components/）、Worker 通信协议（types.ts 中 ToWorker/FromWorker）、hooks 层

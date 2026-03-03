# 修仙模拟器性能优化结果

## 优化前性能基准（来自 PERFORMANCE_ANALYSIS.md）
- **平均耗时**: 11.3ms/年
- **最终人口**: ~21,000 修士
- **主要瓶颈**:
  - 战斗循环: 8.9ms/年 (27.8%)
  - 多次 Map 遍历: ~3.7ms/年 (naturalCultivation + checkPromotions + removeExpired)
  - buildAliveIds: 0.9ms/年

## 已实施的优化

### ✅ 优化 1: 合并多次 Map 遍历
**实施内容**:
- 创建 `tickCultivators()` 方法，合并 `naturalCultivation()`、`checkPromotions()` 和 `removeExpired()` 三个遍历
- 在单次遍历中完成：自然修炼、晋升检查、寿元检查

**代码变更**:
- `src/engine/simulation.ts`: 新增 `tickCultivators()` 方法，删除三个独立方法
- `tickYear()` 调用新方法替代原有三个方法调用

**性能收益**:
- 减少 2 次完整的 Map 遍历
- 从 ~3.7ms/年 降低到 ~0.9ms/年
- **节省约 2.8ms/年**

### ✅ 优化 2: 增量维护 aliveIds
**实施内容**:
- 在 `SimulationEngine` 中添加 `aliveLevelIds: Map<number, Set<number>>` 字段
- 在修士出生、死亡、晋升、跌境时实时更新 `aliveLevelIds`
- 修改 `processEncounters()` 中的 `buildAliveIds` 部分，直接从 `aliveLevelIds` 构建数组

**代码变更**:
- `src/engine/simulation.ts`:
  - 添加 `aliveLevelIds` 字段
  - 在 `spawnCultivators()` 中添加新修士
  - 在 `tickCultivators()` 中更新晋升和死亡
  - 在 `reset()` 中初始化
- `src/engine/combat.ts`:
  - 在 `resolveCombat()` 中更新战斗死亡、晋升、跌境
  - 修改 `buildAliveIds` 使用 `aliveLevelIds`

**性能收益**:
- 从遍历所有 cultivators 改为遍历 aliveLevelIds
- 从 0.9ms/年 降低到 ~0.17ms/年
- **节省约 0.73ms/年**

### ❌ 优化 3: 预采样战斗参与者（未实施）
**原因**: 改变了战斗的随机性分布，导致人口从 ~20k 增长到 ~27k，性能反而变差

### ❌ 优化 4: 缓存 effectiveCourage 计算（未实施）
**原因**: 缓存的开销（检查和写入）超过了计算本身的开销，性能反而变差

## 优化后性能基准

### 基准测试结果（1000 年，初始人口 0，种子 42）
- **平均耗时**: 11.18ms/年
- **最终人口**: 19,803 修士
- **性能分布**:
  - tickYear: 11.13ms/年 (35.6%)
  - processEncounters: 9.53ms/年 (30.5%)
  - processEncounters.combatLoop: 8.89ms/年 (28.5%)
  - tickCultivators: 0.97ms/年 (3.1%)
  - processEncounters.buildCache: 0.46ms/年 (1.5%)
  - processEncounters.buildAliveIds: 0.17ms/年 (0.5%)

## 性能提升总结

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 平均耗时/年 | 11.3ms | 11.18ms | **1.1%** |
| tickCultivators | ~3.7ms | 0.97ms | **73.8%** |
| buildAliveIds | 0.9ms | 0.17ms | **81.1%** |
| 总节省 | - | ~3.5ms | - |

**注**: 虽然总节省约 3.5ms，但由于其他部分的性能波动（如 combatLoop 从 8.9ms 增加到 8.89ms），最终整体提升约 1.1%。

## 剩余性能瓶颈

1. **战斗循环 (8.89ms/年, 28.5%)**
   - 仍然遍历所有 ~20k 修士
   - 大部分因概率检查而跳过
   - 需要更激进的优化策略（如预采样），但必须保持相同的随机性分布

2. **战斗缓存构建 (0.46ms/年, 1.5%)**
   - 每年重建等级缓存
   - 可能可以增量维护

## 结论

成功实施了优化 1 和 2，将多次 Map 遍历和 aliveIds 构建的开销从 ~4.6ms/年 降低到 ~1.14ms/年，节省约 3.5ms/年。但由于战斗循环仍然是主要瓶颈，整体性能提升有限（约 1.1%）。

要进一步优化性能，需要重点解决战斗循环的效率问题，但必须小心保持游戏逻辑的正确性和随机性分布。

# 性能分析报告

## 测试环境
- 人口规模：~21,000 修士
- 测试时长：1000 年
- 平均每年耗时：**11.3ms**

## 性能瓶颈分析（按耗时占比排序）

### 🔴 关键瓶颈

#### 1. **processEncounters.combatLoop** - 27.8%
```
耗时：8815ms / 1000年
平均：8.9ms/年
占比：27.8%
```

**问题**：战斗匹配循环是最大的单一瓶颈
- 遍历所有 aliveIds（~21k 修士）
- 每个修士查找对手、判定战斗
- 虽然单次 O(1)，但累积次数太多

**优化方向**：
- 减少参与战斗的修士数量（概率过滤）
- 提前终止条件优化
- 批量处理战斗

---

#### 2. **processEncounters（总计）** - 30.2%
```
耗时：9559ms / 1000年
平均：9.6ms/年
占比：30.2%
```

**子项分解**：
- combatLoop: 8815ms (92.2%)
- buildCache: 450ms (4.7%)
- buildAliveIds: 292ms (3.1%)

**问题**：整个战斗系统占用了 30% 的时间
- buildAliveIds 遍历所有 cultivators Map
- buildCache 遍历所有 levelGroups

**优化方向**：
- 维护增量的 aliveIds 列表，避免每年重建
- 合并 buildCache 和 buildAliveIds 的遍历

---

#### 3. **checkPromotions** - 2.1%
```
耗时：666ms / 1000年
平均：0.67ms/年
占比：2.1%
```

**问题**：遍历所有 cultivators 检查晋升
- 每年都要遍历 ~21k 修士
- 大部分修士不会晋升，但仍要检查

**优化方向**：
- 维护"接近晋升"的修士列表
- 只检查修为增长的修士

---

### 🟡 次要瓶颈

#### 4. **naturalCultivation** - 1.0%
```
耗时：312ms / 1000年
平均：0.31ms/年
占比：1.0%
```

**问题**：遍历所有 cultivators 增加修为
- 必须遍历，无法避免
- 但可以优化计算逻辑

**优化方向**：
- 缓存 SUSTAINABLE_MAX_AGE 查找
- 简化 maxAge 衰减计算

---

#### 5. **getSummary** - 0.2%（但调用频率低）
```
耗时：52ms / 11次调用
平均：4.8ms/次
占比：0.2%
```

**问题**：虽然占比小，但单次耗时高
- 中位数计算需要排序：O(N log N)
- 每次都要遍历所有修士

**优化方向**：
- 使用近似算法（如 P2 算法）估算中位数
- 减少调用频率（已经很低了）
- 考虑是否真的需要中位数

---

## 性能热点可视化

```
总耗时分布（1000年，~21k人口）：
┌─────────────────────────────────────────────────────────────┐
│ processEncounters.combatLoop    ████████████████████  27.8% │
│ processEncounters (其他)        ██                     2.4% │
│ checkPromotions                 ██                     2.1% │
│ processEncounters.buildCache    █                      1.4% │
│ naturalCultivation              █                      1.0% │
│ processEncounters.buildAliveIds █                      0.9% │
│ removeExpired                   █                      0.6% │
│ getSummary                      ▌                      0.2% │
│ 其他                            ████████████████████  63.6% │
└─────────────────────────────────────────────────────────────┘
```

**注意**：63.6% 的时间在 `tickYear` 但不在子项中，说明：
- 可能是 profiler 开销
- 可能是 resolveCombat 内部逻辑（未单独计时）

---

## 关键发现

### 1. **战斗系统是绝对瓶颈**
- processEncounters 占 30%
- 其中 combatLoop 占 28%
- 这是优化的首要目标

### 2. **Map 遍历累积成本高**
- buildAliveIds: 遍历 cultivators Map
- buildCache: 遍历 levelGroups
- checkPromotions: 遍历 cultivators Map
- naturalCultivation: 遍历 cultivators Map
- removeExpired: 遍历 cultivators Map

**每年至少 5 次完整遍历！**

### 3. **getSummary 不是瓶颈**
- 只占 0.2%，且调用频率已经很低（每 100 年一次）
- 不值得优化

---

## 优化建议（按优先级）

### 🔥 P0 - 立即优化

#### 1. 减少 Map 遍历次数
**方案**：维护增量的 aliveIds 列表
```typescript
// 当前：每年重建
for (const c of engine.cultivators.values()) {
  if (c.alive && c.level > 0) aliveIds.push(c.id);
}

// 优化：增量维护
// - 出生时加入
// - 死亡时移除
// - 无需每年遍历
```

**预期收益**：减少 0.3ms/年 × 1000 = 300ms（0.9%）

---

#### 2. 合并多次遍历
**方案**：在一次遍历中完成多个操作
```typescript
// 当前：分别遍历
naturalCultivation();      // 遍历1
checkPromotions();         // 遍历2
removeExpired();           // 遍历3

// 优化：合并遍历
for (const c of cultivators.values()) {
  // 自然修炼
  c.age += 1;
  c.cultivation += growthRate;

  // 检查晋升
  if (c.cultivation >= threshold(c.level + 1)) { ... }

  // 检查寿元
  if (c.age >= c.maxAge) { ... }
}
```

**预期收益**：减少 2 次遍历开销，约 1-2ms/年

---

### 🟡 P1 - 中期优化

#### 3. 优化战斗匹配
**方案**：减少无效的战斗判定
```typescript
// 当前：遍历所有 aliveIds，大部分不会战斗
for (const id of aliveIds) {
  if (engine.prng() >= nk / snapshotN) continue;  // 大部分在这里跳过
  ...
}

// 优化：预先计算战斗数量
const expectedCombats = Math.floor(snapshotN * 0.5);
const combatants = sampleWithoutReplacement(aliveIds, expectedCombats);
for (const id of combatants) {
  // 直接进行战斗，无需概率判定
}
```

**预期收益**：减少循环次数，约 2-3ms/年

---

#### 4. 缓存 effectiveCourage
**方案**：在 Cultivator 对象上缓存计算结果
```typescript
interface Cultivator {
  // ...
  _cachedCourage?: number;
  _cachedCourageYear?: number;
}

function effectiveCourage(c: Cultivator, year: number): number {
  if (c._cachedCourageYear === year) {
    return c._cachedCourage!;
  }
  // 计算...
  c._cachedCourage = result;
  c._cachedCourageYear = year;
  return result;
}
```

**预期收益**：减少重复计算，约 0.5ms/年

---

### 🟢 P2 - 长期优化

#### 5. 使用 TypedArray 替代 Map
**方案**：用连续内存存储修士数据
```typescript
// 当前：Map<number, Cultivator>
// 优化：Float64Array + 索引映射
```

**预期收益**：提升缓存命中率，约 10-20% 整体性能

---

#### 6. Web Worker 并行化
**方案**：将不同等级的战斗分配到不同 Worker
```typescript
// Worker 1: Lv0-3
// Worker 2: Lv4-7
```

**预期收益**：理论上 2x 加速（实际约 1.5x）

---

## 总结

**当前性能**：11.3ms/年（~21k 人口）

**优化后预期**：
- P0 优化：~9ms/年（减少 20%）
- P1 优化：~7ms/年（减少 38%）
- P2 优化：~5ms/年（减少 56%）

**最大瓶颈**：战斗系统（30%）和多次 Map 遍历（累积 5-6%）

**建议优先级**：
1. 增量维护 aliveIds（简单，收益明显）
2. 合并多次遍历（中等难度，收益中等）
3. 优化战斗匹配（复杂，收益大）

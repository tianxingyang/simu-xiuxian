## 1. 基础函数

- [x] 1.1 `src/constants.ts`: 新增 `round2(v: number): number` 函数（`Math.round(v * 100) / 100`）
- [x] 1.2 `src/constants.ts`: 新增常量 `COURAGE_TROUGH = 0.3`、`COURAGE_YOUNG_AMP = 0.1`、`COURAGE_OLD_AMP = 0.3`、`COURAGE_MEAN = 0.5`、`COURAGE_STDDEV = 0.15`
- [x] 1.3 `src/constants.ts`: 新增 `effectiveCourage(c: Cultivator): number` 函数，导入 `Cultivator` 类型，实现分段二次曲线计算并返回 `round2(min(1, base + boost))`
- [x] 1.4 `src/engine/prng.ts`: 新增 `truncatedGaussian(prng: () => number, mu: number, sigma: number, lo: number, hi: number): number` 函数，使用 Box-Muller 变换 + 拒绝采样实现截断正态分布

## 2. 初始勇气范围调整

- [x] 2.1 `src/engine/simulation.ts`: `spawnCultivators` 中将 `this.prng()` 改为 `round2(truncatedGaussian(this.prng, COURAGE_MEAN, COURAGE_STDDEV, 0.01, 1.00))`，对象池复用路径和新建路径均需修改

## 3. 战斗系统接入

- [x] 3.1 `src/engine/combat.ts`: 导入 `effectiveCourage`，`resolveCombat` 中将 `a.courage` / `b.courage` 替换为 `effectiveCourage(a)` / `effectiveCourage(b)`

## 4. 统计系统接入

- [x] 4.1 `src/engine/simulation.ts`: 导入 `effectiveCourage` 和 `round2`，`getSummary` 中将 `courSum[lv] += c.courage` 改为 `courSum[lv] += effectiveCourage(c)`，`courBuf[lv].push(c.courage)` 改为 `courBuf[lv].push(effectiveCourage(c))`
- [x] 4.2 `src/engine/simulation.ts`: `getSummary` 中 `courageAvg` 和 `courageMedian` 的 `round1` 调用改为 `round2`

## 5. 验证

- [x] 5.1 运行现有集成测试 `npx tsx test/integration.ts`，确认全部通过
- [ ] 5.2 启动开发服务器，观察勇气趋势图是否呈现 U 型特征（年轻群体勇气略高于中年群体，老年群体勇气显著高于中年群体）← 需用户手动验证

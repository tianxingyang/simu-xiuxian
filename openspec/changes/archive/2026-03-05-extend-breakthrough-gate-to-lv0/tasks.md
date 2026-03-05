## 1. 常量变更

- [x] 1.1 `src/constants.ts` — `THRESHOLDS` 数组变更：`[0]` 从 `Infinity` 改为 `0`，`[1]` 从 `10` 改为 `13`
- [x] 1.2 `src/constants.ts` — 验证 `breakthroughChance(0)` 返回 `exp(-0.75) ≈ 0.4724`（公式本身无需修改，仅 spec 中 k 的有效范围从 k≥1 扩展到 k≥0）

## 2. tryBreakthrough 前置条件

- [x] 2.1 `src/engine/simulation.ts` — `tryBreakthrough` 函数移除 `c.level < 1` 检查，仅保留 `c.level >= MAX_LEVEL` 上限检查

## 3. 移除自动升级代码

- [x] 3.1 `src/engine/simulation.ts` — `tickCultivators` 中移除 `if (c.level === 0 && c.cultivation >= threshold(1))` 自动升级代码块及其内部的 level/maxAge/promotionCounts/levelGroups/aliveLevelIds 操作
- [x] 3.2 `src/engine/simulation.ts` — `tickCultivators` 中移除 `if (c.level >= 1)` 条件，改为对所有修仙者直接调用 `tryBreakthrough(this, c, events, 'natural')`
- [x] 3.3 `src/engine/combat.ts` — `resolveCombat` 中移除 winner 的 Lv0→Lv1 自动升级代码块（`if (winner.level === 0 && winner.cultivation >= threshold(1))` 及其内部操作）
- [x] 3.4 `src/engine/combat.ts` — `resolveCombat` 中移除 `if (winner.level >= 1)` 条件，改为直接调用 `tryBreakthrough`

## 4. 验证

- [x] 4.1 运行现有测试套件，确认无回归
- [x] 4.2 分布验证：3 seed × 5000 tick，Lv0 占比须在 50%-65% 范围内

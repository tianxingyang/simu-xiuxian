## Why

当前 Lv0→Lv1 为自动升级（修为达到 10 即可），Lv0 仅是 10 年的等待期，所有修仙者必然进入筑基。这与修仙世界观不符——绝大多数人应终身停留在炼气期。同时现有目标分布公式 `w_k = e^{-(0.6k + 0.15k²)}` 扩展到 k=0 后，Lv0 应占总人口 59.17%，但当前自动升级机制无法实现此分布。需要将突破概率门扩展至 Lv0→Lv1 转换，并配合修为门槛调整来限制突破尝试次数。

## What Changes

- 将 `breakthroughChance(k)` 公式的适用范围从 k≥1 扩展到 k≥0，Lv0→Lv1 突破概率为 `e^{-(0.6+0.15)} ≈ 47.2%`
- `THRESHOLDS[1]` 从 10 调整为 13，使 Lv0 修仙者（寿元 60 年）从 age=23 起可尝试突破，稳态下约 59.8% 留在炼气
- `THRESHOLDS[0]` 从 `Infinity` 改为 `0`，修复突破失败修为损失惩罚中 `threshold(0)` 溢出问题
- 移除 `tickCultivators` 和 `resolveCombat` 中 Lv0→Lv1 自动升级代码，统一由 `tryBreakthrough` 处理
- 移除 `tryBreakthrough` 中 `c.level < 1` 的前置条件限制
- Lv0→Lv1 升级后 maxAge 改为 `60 + lifespanBonus(1) = 160`，由寿元衰减系统自然收敛至 `SUSTAINABLE_MAX_AGE[1] = 100`
- 战斗经济连锁：`THRESHOLDS[1]` 从 10→13 影响 Lv1 baseLoot（0.5→0.65）、修为地板（10→13）— 影响较小

## Capabilities

### New Capabilities

无

### Modified Capabilities

- `breakthrough-gate`: 突破前置条件从 `level ≥ 1` 放宽为 `level ≥ 0`；Lv0 失败事件规则：不产生 `RichBreakthroughEvent`（与 Lv1 一致）；PBT-13 反转为验证 Lv0 进入门控
- `cultivation-levels`: `THRESHOLDS` 数组变更 — `[0]` 从 `Infinity` 改为 `0`，`[1]` 从 `10` 改为 `48`；移除 Lv0→Lv1 自动升级行为

## Impact

- `src/constants.ts`: `THRESHOLDS` 数组两项值变更
- `src/engine/simulation.ts`: `tryBreakthrough` 移除 level<1 guard；`tickCultivators` 移除 Lv0 自动升级代码块
- `src/engine/combat.ts`: `resolveCombat` 移除 winner Lv0→Lv1 自动升级代码块（Lv0 不参与战斗，此代码不可达，清理死代码）
- 战斗经济连锁：`THRESHOLDS[1]` 从 10→13 影响 Lv1 战斗掠夺基础量（0.5→0.65）、逃跑/战败/突破失败修为地板（10→13）— 影响较小
- PRNG 序列变化：Lv0 修仙者现在消耗 PRNG 进行突破判定，相同种子下模拟结果将改变
- 目标稳态分布：Lv0:59.17%, Lv1:27.95%, Lv2:9.78%, Lv3:2.53%
- 验证协议：3 seed × 5000 tick，Lv0 占比须在 50%-65% 范围内

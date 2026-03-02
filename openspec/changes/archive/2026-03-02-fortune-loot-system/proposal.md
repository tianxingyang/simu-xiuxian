## Why

当前战斗胜利后固定吸收败者 10% 修为（`ABSORB_RATE = 0.1`），不符合修仙世界观中"机缘"的特征。真实修仙设定中，战斗后的收获（天材地宝、功法、神兵）具有随机性，且与败者的境界积累相关，而非简单的修为线性比例。固定比例导致叙事扁平，缺少"命运分化"的模拟效果。

## What Changes

- 移除 `ABSORB_RATE` 常量，替换为机缘系统的常量组：`LOOT_BASE_RATE`、`LOOT_VARIABLE_RATE`、`LUCK_MEAN`、`LUCK_STDDEV`、`LUCK_MAX`
- 战斗收益公式变更为：`机缘 = 基础机缘 + 浮动机缘`
  - 基础机缘 = `levelBase(loser.level) × LOOT_BASE_RATE`，其中 `levelBase(lv)` 对 Lv0 返回 0，Lv1+ 返回 `threshold(lv)`
  - 浮动机缘 = `excess × LOOT_VARIABLE_RATE × luck`，其中 `excess = loser.cultivation - levelBase(loser.level)`，`luck` 服从截断正态分布
- 复用现有 `truncatedGaussian` 函数生成 luck 因子

## Capabilities

### New Capabilities

### Modified Capabilities
- `encounter-combat`: 战斗结算中的修为吸收逻辑替换为机缘计算公式，引入基础机缘 + 浮动机缘 + 运气因子

## Impact

- `src/constants.ts`: 移除 `ABSORB_RATE`，新增 `LOOT_BASE_RATE`、`LOOT_VARIABLE_RATE`、`LUCK_MEAN`、`LUCK_STDDEV`、`LUCK_MIN`、`LUCK_MAX` 常量
- `src/engine/combat.ts`: `resolveCombat` 中添加 pre-penalty cultivation 快照；替换固定吸收为机缘公式（含 `truncatedGaussian`、`max(0, excess)`、`max(0.1, loot)` 防御）；变量名 `absorbed` → `loot`；事件文本 `吸收修为` → `获得机缘`
- `openspec/specs/encounter-combat/spec.md`: 更新 Combat resolution 需求（前置断言、pre-penalty 快照、防御边界、事件文本）

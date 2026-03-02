## 1. 常量替换

- [x] 1.1 `src/constants.ts`: 移除 `ABSORB_RATE`，新增 `LOOT_BASE_RATE = 0.05`、`LOOT_VARIABLE_RATE = 0.1`、`LUCK_MEAN = 1.0`、`LUCK_STDDEV = 0.3`、`LUCK_MIN = 0`、`LUCK_MAX = 2.5`

## 2. 机缘计算实现

- [x] 2.1 `src/engine/combat.ts`: 在 `resolveCombat` 顶部快照 `a.cultivation` 和 `b.cultivation`（pre-penalty snapshot）
- [x] 2.2 `src/engine/combat.ts`: 将 `loser.cultivation * ABSORB_RATE` 替换为机缘公式，使用 `truncatedGaussian` 生成 luck 因子，使用快照值计算 `excess`，应用 `max(0, excess)` 和 `max(0.1, round1(...))` 防御
- [x] 2.3 `src/engine/combat.ts`: 更新 import，引入新常量和 `truncatedGaussian`，移除 `ABSORB_RATE`
- [x] 2.4 `src/engine/combat.ts`: 事件文本从 `吸收修为${buf[off+2]}` 改为 `获得机缘${buf[off+2]}`，变量名 `absorbed` 改为 `loot`

## 3. Spec 归档

- [x] 3.1 `openspec/specs/encounter-combat/spec.md`: 将 Combat resolution 需求中的固定 10% 吸收描述替换为机缘公式描述（含前置断言、pre-penalty 快照、防御边界、事件文本）

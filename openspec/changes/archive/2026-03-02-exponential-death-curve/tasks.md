## 1. 常量替换

- [x] 1.1 在 `src/constants.ts` 中移除 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION`、`DEFEAT_MIN_DEATH`，新增 `DEFEAT_DEATH_BASE = 0.40` 和 `DEFEAT_DEATH_DECAY = 0.72`

## 2. 致死率公式重写

- [x] 2.1 在 `src/engine/combat.ts` 的 `resolveDefeatOutcome` 函数中，将致死率计算从 `clamp(DEFEAT_BASE_DEATH - DEFEAT_LEVEL_PROTECTION * loserLevel + DEFEAT_GAP_SEVERITY * gap, MIN, MAX)` 替换为 `Math.min(DEFEAT_MAX_DEATH, DEFEAT_DEATH_BASE * DEFEAT_DEATH_DECAY ** loserLevel * (1 + DEFEAT_GAP_SEVERITY * gap))`
- [x] 2.2 更新 `combat.ts` 的 import 声明：移除 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION`、`DEFEAT_MIN_DEATH`，新增 `DEFEAT_DEATH_BASE`、`DEFEAT_DEATH_DECAY`

## 3. 规格文档同步

- [x] 3.1 更新 `openspec/specs/combat-defeat-outcomes/spec.md`，将 delta spec 合并到主 spec 中

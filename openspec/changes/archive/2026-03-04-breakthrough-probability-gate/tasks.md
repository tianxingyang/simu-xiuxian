## 1. 常量与类型定义

- [x] 1.1 `src/constants.ts` — 新增常量 `BREAKTHROUGH_A = 0.6`、`BREAKTHROUGH_B = 0.15`、`BREAKTHROUGH_COOLDOWN = 3`、`BREAKTHROUGH_CULT_LOSS_RATE = 0.2`、`BREAKTHROUGH_NOTHING_W = 5.0`、`BREAKTHROUGH_CULT_LOSS_W = 2.0`、`BREAKTHROUGH_INJURY_W = 2.0`
- [x] 1.2 `src/constants.ts` — 新增 `breakthroughChance(level: number): number` 函数，返回 `Math.exp(-(BREAKTHROUGH_A + BREAKTHROUGH_B * (2 * level + 1)))`
- [x] 1.3 `src/types.ts` — `Cultivator` 接口新增 `breakthroughCooldownUntil: number` 字段
- [x] 1.4 `src/types.ts` — 新增 `RichBreakthroughEvent` 接口：`{ type: 'breakthrough_fail', year, newsRank, subject: { id, name?, level }, penalty: 'cooldown_only' | 'cultivation_loss' | 'injury', cause: 'natural' | 'combat' }`
- [x] 1.5 `src/types.ts` — `RichEvent` 联合类型新增 `RichBreakthroughEvent`；`SimEvent.type` 新增 `'breakthrough_fail'`
- [x] 1.6 `src/types.ts` — `YearSummary` 新增 `breakthroughAttempts: number`、`breakthroughSuccesses: number`、`breakthroughFailures: number`

## 2. spawnCultivators 初始化

- [x] 2.1 `src/engine/simulation.ts` — `spawnCultivators` 对象池复用路径新增 `c.breakthroughCooldownUntil = 0`
- [x] 2.2 `src/engine/simulation.ts` — `spawnCultivators` 新建路径的对象字面量新增 `breakthroughCooldownUntil: 0`

## 3. 引擎计数器

- [x] 3.1 `src/engine/simulation.ts` — `SimulationEngine` 新增属性 `breakthroughAttempts = 0`、`breakthroughSuccesses = 0`、`breakthroughFailures = 0`
- [x] 3.2 `src/engine/simulation.ts` — `resetYearCounters` 中归零上述三个计数器
- [x] 3.3 `src/engine/simulation.ts` — `getSummary` 中将三个计数器填入 `YearSummary`

## 4. tryBreakthrough 共享函数

- [x] 4.1 `src/engine/simulation.ts` — 实现 `tryBreakthrough(engine, c, events, cause): boolean` 函数：检查前置条件（level≥1, level<MAX_LEVEL, cultivation≥threshold, cooldown, injury）→ 不满足则 return false 不消耗 prng
- [x] 4.2 同函数 — 突破判定：`engine.breakthroughAttempts++`，roll `prng()` vs `breakthroughChance(c.level)`
- [x] 4.3 同函数 — 成功路径：单级升级（level++, maxAge += lifespanBonus, levelGroups/aliveLevelIds 迁移, promotionCounts++），产生 `RichPromotionEvent`，触发 `onPromotion` hook，`breakthroughSuccesses++`，return true
- [x] 4.4 同函数 — 失败路径：设置 `breakthroughCooldownUntil = year + BREAKTHROUGH_COOLDOWN`，roll prng() 选择额外惩罚（无额外 < 5/9 / 修为损失 < 7/9 / 受伤），修为损失使用 `round1`，`breakthroughFailures++`，Lv2+ 产生 `RichBreakthroughEvent`（Lv4+ newsRank='B', Lv2-3 newsRank='C'），return false

## 5. tickCultivators 突破判定

- [x] 5.1 `src/engine/simulation.ts` — 将 `tickCultivators` 中的自动升级 `while` 循环拆分为：Lv0 自动升级（`if level === 0 && cultivation >= threshold(1)`，保留 while 语义用于 Lv0→Lv1 自动升级）+ Lv1+ 调用 `tryBreakthrough(engine, c, events, 'natural')`

## 6. resolveCombat 突破判定

- [x] 6.1 `src/engine/combat.ts` — 将战斗胜利后的自动升级 `while` 循环拆分为：Lv0 自动升级 + Lv1+ 调用 `tryBreakthrough(engine, c, events, 'combat')`，调用位置在 combat 事件推入 events 之后

## MODIFIED Requirements

### Requirement: Defeat outcome determination
战败后系统 SHALL 根据实力差距和境界计算死亡概率，再掷骰决定结局。公式：

```
gap = (winner.cultivation - loser.cultivation) / (winner.cultivation + loser.cultivation)
rawDeath = DEFEAT_DEATH_BASE × DEFEAT_DEATH_DECAY ^ loser.level
deathChance = min(DEFEAT_MAX_DEATH, rawDeath × (1 + DEFEAT_GAP_SEVERITY × gap))
```

- `gap` SHALL 使用败者**战前快照**（闪避惩罚前）修为计算
- `gap` 可为负值（弱者赢时 winner.cult < loser.cult）
- 常量：`DEFEAT_DEATH_BASE=0.40`, `DEFEAT_DEATH_DECAY=0.72`, `DEFEAT_GAP_SEVERITY=0.3`（乘性系数）, `DEFEAT_MAX_DEATH=0.95`
- 无下限 clamp：指数衰减公式天然保证正值

第一次掷骰 `r1 = prng()`：若 `r1 < deathChance` → 死亡。否则进入存活结局判定。

#### Scenario: Lv1 equal fight death chance
- **WHEN** Lv1 败者与胜者修为相近（gap ≈ 0）
- **THEN** deathChance SHALL ≈ 0.29（0.40 × 0.72^1）

#### Scenario: Lv7 equal fight death chance
- **WHEN** Lv7 败者与胜者修为相近（gap ≈ 0）
- **THEN** deathChance SHALL ≈ 0.04（0.40 × 0.72^7）

#### Scenario: Large gap increases death chance multiplicatively
- **WHEN** Lv3 败者 gap = 0.5
- **THEN** deathChance SHALL ≈ 0.17（rawDeath 0.149 × 1.15），比均势的 0.149 高出约 15%

#### Scenario: Death chance capped at MAX_DEATH
- **WHEN** 计算结果超出 DEFEAT_MAX_DEATH
- **THEN** deathChance SHALL 被 cap 到 0.95

#### Scenario: Negative gap lowers death chance
- **WHEN** 弱者赢了（winner.cult < loser.cult），gap 为负值
- **THEN** deathChance SHALL 低于均势时的值（败者实力更强，存活概率更高）

#### Scenario: High level not blown up by gap
- **WHEN** Lv7 败者 gap = 0.5
- **THEN** deathChance SHALL ≈ 0.046（0.04 × 1.15），而非加性设计下的 0.22

### Requirement: Defeat outcome constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：

- `DEFEAT_DEATH_BASE = 0.40`
- `DEFEAT_DEATH_DECAY = 0.72`
- `DEFEAT_GAP_SEVERITY = 0.3`
- `DEFEAT_MAX_DEATH = 0.95`
- `DEFEAT_DEMOTION_W = 1`
- `DEFEAT_INJURY_W = 1.5`
- `DEFEAT_LOSS_W = 1.5`
- `DEFEAT_CULT_LOSS_RATE = 0.3`
- `INJURY_DURATION = 5`
- `INJURY_GROWTH_RATE = 0.5`
- `LIFESPAN_DECAY_RATE = 0.2`

系统 SHALL NOT 定义 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION` 或 `DEFEAT_MIN_DEATH`（已移除）。

#### Scenario: Constants are importable
- **WHEN** `combat.ts` 或 `simulation.ts` 导入上述常量
- **THEN** 值 SHALL 与定义一致

#### Scenario: Old constants removed
- **WHEN** 代码中引用 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION` 或 `DEFEAT_MIN_DEATH`
- **THEN** SHALL 编译失败（常量不存在）

### Requirement: PBT — Death chance bounds
对所有合法输入（`loser.level ∈ [1, 7]`, `gap ∈ (-1, 1)`），`deathChance` SHALL 始终满足 `0 < deathChance <= DEFEAT_MAX_DEATH`。

#### Scenario: Extreme inputs positive
- **WHEN** level=7, gap=-0.9（最低死亡率）
- **THEN** deathChance SHALL > 0（≈ 0.03）

#### Scenario: Maximum gap bounded
- **WHEN** level=1, gap=0.9（最高死亡率）
- **THEN** deathChance SHALL <= 0.95

### Requirement: PBT — Level monotonicity
固定 gap 值时，`deathChance` SHALL 随 `loser.level` 递增而严格单调递减。

#### Scenario: Higher level lower death chance
- **WHEN** gap 固定为 0.3，level 从 1 递增到 7
- **THEN** deathChance SHALL 严格递减

### Requirement: PBT — Gap monotonicity
固定 level 值时，`deathChance` SHALL 随 `gap` 递增而严格单调递增。

#### Scenario: Higher gap higher death chance
- **WHEN** level 固定为 3，gap 从 -0.5 递增到 0.5
- **THEN** deathChance SHALL 严格递增

### Requirement: PBT — Exponential level ratio
固定 gap 值时，相邻级别的 `deathChance` 之比 SHALL 恒等于 `DEFEAT_DEATH_DECAY`：`D(l+1, g) / D(l, g) = 0.72`。

#### Scenario: Adjacent level ratio is DECAY
- **WHEN** gap 固定为任意值，level 从 1 到 6
- **THEN** D(level+1) / D(level) SHALL ≈ 0.72（浮点容差内）

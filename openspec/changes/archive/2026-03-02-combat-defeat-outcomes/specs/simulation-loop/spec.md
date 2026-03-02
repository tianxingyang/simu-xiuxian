## MODIFIED Requirements

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=MORTAL_MAX_AGE(60), injuredUntil=0`. The `courage` attribute SHALL be sampled from truncated normal distribution with μ=0.50, σ=0.15, bounds [0.01, 1.00], using Box-Muller transform + rejection sampling on seeded PRNG, then rounded to two decimal places via `round2`。超出 [0.01, 1.00] 的值 SHALL 重新采样而非 clamp。Each cultivator SHALL have a unique numeric ID (monotonically increasing integer).

`injuredUntil=0` 表示未受伤。该字段 SHALL 仅由战败结局系统设置。

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, injuredUntil=0, and a unique ID

#### Scenario: Courage range
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL all be in [0.01, 1.00]，且每个值 SHALL 为精确的两位小数

#### Scenario: Courage truncated normal distribution
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL approximate a normal distribution with μ≈0.50, σ≈0.15，约 68% 的值落在 [0.35, 0.65] 范围内，且边界处无概率堆积

#### Scenario: No boundary spike
- **WHEN** 10000 cultivators are created
- **THEN** courage=0.01 和 courage=1.00 的频次 SHALL NOT 显著高于相邻值（即无 clamp 导致的边界堆积）

## ADDED Requirements

### Requirement: Injured cultivation growth
`naturalCultivation` SHALL 对重伤修士（`injuredUntil > currentYear`）应用减速因子。重伤修士每年修为增长 SHALL 为 `INJURY_GROWTH_RATE`(0.5) 而非 1。年龄增长不受影响。

```
for each alive cultivator c:
  c.age += 1
  if c.injuredUntil > this.year:
    c.cultivation += INJURY_GROWTH_RATE   // 0.5
  else:
    c.cultivation += 1
```

#### Scenario: Normal cultivator full growth
- **WHEN** 未受伤修士经过 naturalCultivation
- **THEN** cultivation SHALL 增加 1

#### Scenario: Injured cultivator halved growth
- **WHEN** 重伤修士（injuredUntil=105）在第 102 年经过 naturalCultivation
- **THEN** cultivation SHALL 增加 0.5

#### Scenario: Recovered cultivator full growth
- **WHEN** 修士 injuredUntil=105，在第 105 年经过 naturalCultivation
- **THEN** cultivation SHALL 增加 1（已恢复）

#### Scenario: Aging unaffected by injury
- **WHEN** 重伤修士经过 naturalCultivation
- **THEN** age SHALL 正常增加 1

### Requirement: Gradual maxAge decay in naturalCultivation
`naturalCultivation` SHALL 在年龄/修为增长之后，对 `maxAge` 超出当前境界可维持寿元的修士执行渐进式衰减：

```
sustainableMaxAge = [60, 100, 900, 8900, 88900, 888900, 8888900, 88888900]
for each alive cultivator c:
  // ... age/cultivation growth ...
  target = sustainableMaxAge[c.level]
  if c.maxAge > target:
    decay = (c.maxAge - target) * LIFESPAN_DECAY_RATE
    c.maxAge = max(MORTAL_MAX_AGE, Math.round(c.maxAge - decay))
```

- `LIFESPAN_DECAY_RATE = 0.2`
- 衰减在 age/cultivation 增长之后执行
- `maxAge` 下限为 `MORTAL_MAX_AGE`(60)

#### Scenario: No decay when maxAge matches level
- **WHEN** Lv2 修士 maxAge=900（等于 sustainableMaxAge[2]）
- **THEN** maxAge SHALL 不变

#### Scenario: Decay applied after demotion
- **WHEN** 修士上一轮从 Lv3 跌境至 Lv2（maxAge=8900）
- **THEN** 本轮 naturalCultivation SHALL 衰减 maxAge：(8900-900)×0.2=1600，maxAge → round(7300) = 7300

#### Scenario: Normal cultivator unaffected
- **WHEN** Lv3 修士 maxAge=8900（等于 sustainableMaxAge[3]）
- **THEN** maxAge SHALL 不变

### Requirement: YearSummary defeat statistics
`YearSummary` SHALL 新增以下字段统计本年战败结局：

- `combatDemotions: number` — 本年跌境次数
- `combatInjuries: number` — 本年重伤次数
- `combatCultLosses: number` — 本年损失修为次数

`combatDeaths` SHALL 仅统计战败死亡次数（不含存活结局）。

`getSummary` SHALL 返回上述新字段。引擎 SHALL 在 `resetYearCounters` 中重置这些计数器。

#### Scenario: Year with mixed outcomes
- **WHEN** 某年发生 10 次战败：3 死亡、2 跌境、3 重伤、2 损失修为
- **THEN** combatDeaths=3, combatDemotions=2, combatInjuries=3, combatCultLosses=2

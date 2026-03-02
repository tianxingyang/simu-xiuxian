## MODIFIED Requirements

### Requirement: Combat resolution
When combat occurs, the winner is determined by weighted random: A wins with probability `A.cultivation / (A.cultivation + B.cultivation)`. The loser SHALL be immediately removed (marked dead). The winner SHALL gain cultivation through the fortune loot formula, using the loser's **pre-evasion-penalty** cultivation snapshot:

**Precondition:** `loser.level >= 1` (Lv0 cultivators are excluded from encounters).

```
snapshotCult = loser's cultivation before any evasion penalty
levelBase    = threshold(loser.level)
baseLoot     = levelBase × LOOT_BASE_RATE
excess       = max(0, snapshotCult - levelBase)
luck         = truncatedGaussian(prng, LUCK_MEAN, LUCK_STDDEV, LUCK_MIN, LUCK_MAX)
variableLoot = excess × LOOT_VARIABLE_RATE × luck
loot         = max(0.1, round1(baseLoot + variableLoot))

winner.cultivation += loot
```

Constants: `LOOT_BASE_RATE = 0.05`, `LOOT_VARIABLE_RATE = 0.1`, `LUCK_MEAN = 1.0`, `LUCK_STDDEV = 0.3`, `LUCK_MIN = 0`, `LUCK_MAX = 2.5`. A promotion check SHALL execute immediately for the winner after loot gain. The combat event text SHALL display `获得机缘{loot}`.

#### Scenario: Lv1 winner with average luck
- **WHEN** a Lv1 cultivator defeats a Lv1 with cultivation 50, and luck = 1.0
- **THEN** levelBase = 10, baseLoot = 0.5, excess = 40, variableLoot = 4.0, loot = max(0.1, round1(4.5)) = 4.5

#### Scenario: High luck triggers large fortune
- **WHEN** a Lv2 cultivator defeats a Lv2 with cultivation 500, and luck = 2.3
- **THEN** levelBase = 100, baseLoot = 5.0, excess = 400, variableLoot = 92.0, loot = max(0.1, round1(97.0)) = 97.0

#### Scenario: Zero luck yields minimum loot
- **WHEN** a Lv1 cultivator defeats a Lv1 with cultivation 80, and luck = 0
- **THEN** baseLoot = 0.5, variableLoot = 0, loot = max(0.1, round1(0.5)) = 0.5

#### Scenario: Minimum loot floor
- **WHEN** a Lv1 cultivator defeats a Lv1 with cultivation exactly 10 (at threshold), and luck = 0
- **THEN** baseLoot = 0.5, excess = 0, variableLoot = 0, loot = max(0.1, round1(0.5)) = 0.5

#### Scenario: Pre-penalty snapshot for evasion failure
- **WHEN** evader has cultivation 80, evasion fails, penalty reduces to round1(80 × 0.95) = 76, evader then loses combat, luck = 1.0
- **THEN** loot uses snapshotCult = 80 (not 76): levelBase = 10, baseLoot = 0.5, excess = 70, variableLoot = 7.0, loot = max(0.1, round1(7.5)) = 7.5

#### Scenario: Winner gains loot and promotes
- **WHEN** a Lv1 cultivator with cultivation 95 defeats a Lv1 with cultivation 60, and luck = 1.0
- **THEN** baseLoot = 0.5, excess = 50, variableLoot = 5.0, loot = max(0.1, round1(5.5)) = 5.5, reaching 100.5, and SHALL promote to Lv2

#### Scenario: Loser removed immediately
- **WHEN** cultivator B loses a battle
- **THEN** B SHALL be marked dead immediately; subsequent encounters selecting B as opponent SHALL be cancelled

### Requirement: PBT — Loot lower bound
For any combat with `loser.level >= 1`, `loot >= 0.1` SHALL always hold. Furthermore, since `baseLoot = threshold(level) × 0.05 >= 10 × 0.05 = 0.5` for level >= 1, and `variableLoot >= 0`, the effective lower bound is `loot >= 0.5`.

#### Scenario: Minimum possible loot
- **WHEN** level = 1, snapshotCult = 10 (at threshold), luck = 0
- **THEN** loot = max(0.1, round1(0.5 + 0)) = 0.5 >= 0.1 ✓

### Requirement: PBT — Loot upper bound
For fixed `(level, snapshotCult)` with `L = threshold(level)` and `excess = max(0, snapshotCult - L)`, loot SHALL satisfy: `loot <= round1(0.05 × L + 0.25 × excess)` (since `luck <= 2.5` and `LOOT_VARIABLE_RATE = 0.1`).

#### Scenario: Maximum luck at Lv2
- **WHEN** level = 2, snapshotCult = 500, luck = 2.5
- **THEN** loot = round1(5.0 + 400 × 0.1 × 2.5) = round1(105.0) = 105.0 <= round1(5.0 + 100.0) = 105.0 ✓

### Requirement: PBT — Loot monotonicity in cultivation
For fixed `level` and fixed `luck`, if `c2 >= c1` then `loot(c2) >= loot(c1)` SHALL hold (non-decreasing). When `luck = 0`, loot is flat at `round1(baseLoot)`.

#### Scenario: Higher cultivation yields higher loot
- **WHEN** level = 1, luck = 1.0, c1 = 30, c2 = 50
- **THEN** loot(c1) = round1(0.5 + 20 × 0.1 × 1.0) = 2.5, loot(c2) = round1(0.5 + 40 × 0.1 × 1.0) = 4.5, 4.5 >= 2.5 ✓

### Requirement: PBT — Winner cultivation strictly increases
After loot gain, `winner.cultivation_after > winner.cultivation_before` SHALL always hold, since `loot >= 0.1 > 0`.

#### Scenario: Minimal loot still increases cultivation
- **WHEN** winner.cultivation = 100.0, loot = 0.5
- **THEN** winner.cultivation becomes 100.5 > 100.0 ✓

### Requirement: PBT — Pre-penalty snapshot independence
Loot SHALL depend only on `snapshotCult` (pre-evasion-penalty value), not on post-penalty cultivation. For identical `(level, snapshotCult, luck)`, varying the evasion penalty amount SHALL produce identical loot.

#### Scenario: Same snapshot, different penalties
- **WHEN** level = 1, snapshotCult = 50, luck = 1.0, penalty variants: 0%, 5%, 10%
- **THEN** loot = 4.5 in all three cases (post-penalty value is irrelevant to formula)

### Requirement: PBT — Threshold cultivation independence from luck
When `snapshotCult = threshold(level)` (excess = 0), loot SHALL equal `round1(baseLoot)` regardless of luck value, since `variableLoot = 0 × LOOT_VARIABLE_RATE × luck = 0`.

#### Scenario: At threshold, luck is irrelevant
- **WHEN** level = 1, snapshotCult = 10, luck values: 0, 1.0, 2.5
- **THEN** loot = round1(0.5) = 0.5 for all luck values

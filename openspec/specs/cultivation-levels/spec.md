## ADDED Requirements

### Requirement: Level hierarchy
The system SHALL support 8 cultivation levels (Lv0–Lv7). The promotion threshold to reach Lv(k) SHALL be `10^(k+1)` cultivation points (k >= 1). Lv7 (大乘) SHALL be the maximum level; no further promotion is possible.

| Level | Name | Threshold |
|-------|------|-----------|
| Lv0 | 炼气 | - |
| Lv1 | 筑基 | 10 |
| Lv2 | 结丹 | 100 |
| Lv3 | 元婴 | 1,000 |
| Lv4 | 化神 | 10,000 |
| Lv5 | 炼虚 | 100,000 |
| Lv6 | 合体 | 1,000,000 |
| Lv7 | 大乘 | 10,000,000 |

#### Scenario: Lv1 cultivator reaches Lv2 threshold
- **WHEN** a Lv1 cultivator's cultivation reaches 100
- **THEN** the cultivator SHALL promote to Lv2

#### Scenario: Lv7 cultivator cannot promote further
- **WHEN** a Lv7 cultivator accumulates any amount of cultivation beyond 10,000,000
- **THEN** no promotion SHALL occur; level remains Lv7

### Requirement: Lifespan calculation
Each cultivator SHALL maintain a `maxAge` attribute. At Lv1, `maxAge = 100`. Upon promotion to Lv(k) where k >= 2, `maxAge += 8 * 10^(k-1)`. The lifespan bonus is cumulative and applied immediately upon promotion.

| Level | maxAge increment |
|-------|-----------------|
| Lv1 | maxAge = 100 (absolute) |
| Lv2 | +800 |
| Lv3 | +8,000 |
| Lv4 | +80,000 |
| Lv5 | +800,000 |
| Lv6 | +8,000,000 |
| Lv7 | +80,000,000 |

#### Scenario: Promotion lifespan update
- **WHEN** a Lv1 cultivator at age 50 promotes to Lv2
- **THEN** `maxAge` SHALL become 100 + 800 = 900, remaining lifespan = 850 years

#### Scenario: Multi-level promotion lifespan
- **WHEN** a Lv1 cultivator promotes through Lv2 and Lv3 in a single promotion check
- **THEN** `maxAge` SHALL accumulate both bonuses: 100 + 800 + 8000 = 8900

### Requirement: Promotion condition
Promotion SHALL trigger when `cultivation >= threshold(level + 1)` (greater-than-or-equal). Multi-level promotion SHALL be supported: the system MUST loop checking promotion conditions until no further threshold is met.

#### Scenario: Exact threshold triggers promotion
- **WHEN** a Lv1 cultivator's cultivation equals exactly 100
- **THEN** promotion to Lv2 SHALL occur

#### Scenario: Multi-level promotion in one check
- **WHEN** a Lv1 cultivator's cultivation reaches 1,000 (skipping Lv2 threshold)
- **THEN** the cultivator SHALL promote from Lv1 → Lv2 → Lv3 in a single promotion check

### Requirement: Cultivation precision
Cultivation values SHALL be stored as floating-point numbers rounded to one decimal place. When absorbing 10% of a defeated opponent's cultivation, the result SHALL be rounded to one decimal: `Math.round(value * 10) / 10`.

#### Scenario: Cultivation absorption rounding
- **WHEN** a winner absorbs 10% of a loser with cultivation 11
- **THEN** the winner gains 1.1 cultivation points (11 * 0.1 = 1.1, already one decimal)

#### Scenario: Cultivation absorption rounding non-trivial
- **WHEN** a winner absorbs 10% of a loser with cultivation 33.3
- **THEN** the winner gains 3.3 cultivation points (33.3 * 0.1 = 3.33, rounded to 3.3)

### Requirement: PBT — Promotion idempotency
Running promotionCheck twice on the same cultivator state SHALL produce the same result as running it once. Formally: `promotionCheck(promotionCheck(state)) == promotionCheck(state)`.

#### Scenario: Double promotion check is idempotent
- **WHEN** promotionCheck is executed on a cultivator, then executed again without any state change
- **THEN** the cultivator's level and maxAge SHALL be identical after both checks

### Requirement: PBT — Level-cultivation consistency
After any promotion check, every alive cultivator MUST satisfy: `level == max(k) where cultivation >= threshold(k)` (capped at 7). No cultivator SHALL have cultivation >= threshold(level+1) while level < 7.

#### Scenario: No under-promoted cultivators exist
- **WHEN** the promotion phase completes in any year
- **THEN** for every alive cultivator with level < 7, `cultivation < threshold(level + 1)` SHALL hold

### Requirement: PBT — Lifespan monotonicity
For any two levels L1 < L2, `maxAge(L2) > maxAge(L1)` SHALL hold. Each promotion from Lv(k-1) to Lv(k) SHALL add exactly `8 * 10^(k-1)` to maxAge.

#### Scenario: Higher level always means longer lifespan
- **WHEN** comparing maxAge of a Lv2 cultivator and a Lv3 cultivator (both promoted from Lv1)
- **THEN** the Lv3 cultivator's maxAge SHALL be strictly greater

### Requirement: PBT — Cultivation one-decimal quantization
All cultivation values MUST satisfy `(cultivation * 10) % 1 == 0` at all times. The rounding function `round1` MUST be idempotent: `round1(round1(x)) == round1(x)`.

#### Scenario: Precision preserved over many absorptions
- **WHEN** a cultivator survives 1000 combats, absorbing cultivation each time
- **THEN** the cultivator's cultivation value SHALL satisfy the one-decimal quantization invariant

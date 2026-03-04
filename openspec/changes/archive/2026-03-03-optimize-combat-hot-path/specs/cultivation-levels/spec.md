## MODIFIED Requirements

### Requirement: Level hierarchy
The system SHALL support 8 cultivation levels (Lv0–Lv7). The promotion threshold SHALL be accessed via precomputed constant array `THRESHOLDS[level]`, where `THRESHOLDS = [Infinity, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]`. The function `threshold(level)` SHALL return `THRESHOLDS[level]`. Lv7 (大乘) SHALL be the maximum level; no further promotion is possible.

| Level | Name | Threshold | THRESHOLDS[level] |
|-------|------|-----------|-------------------|
| Lv0 | 炼气 | - | Infinity |
| Lv1 | 筑基 | 10 | 10 |
| Lv2 | 结丹 | 100 | 100 |
| Lv3 | 元婴 | 1,000 | 1_000 |
| Lv4 | 化神 | 10,000 | 10_000 |
| Lv5 | 炼虚 | 100,000 | 100_000 |
| Lv6 | 合体 | 1,000,000 | 1_000_000 |
| Lv7 | 大乘 | 10,000,000 | 10_000_000 |

#### Scenario: Lv1 cultivator reaches Lv2 threshold
- **WHEN** a Lv1 cultivator's cultivation reaches 100
- **THEN** the cultivator SHALL promote to Lv2

#### Scenario: Lv7 cultivator cannot promote further
- **WHEN** a Lv7 cultivator accumulates any amount of cultivation beyond 10,000,000
- **THEN** no promotion SHALL occur; level remains Lv7

#### Scenario: threshold() returns precomputed value
- **WHEN** `threshold(3)` is called
- **THEN** the return value SHALL be `THRESHOLDS[3]` = 1000, without executing `10 ** 3`

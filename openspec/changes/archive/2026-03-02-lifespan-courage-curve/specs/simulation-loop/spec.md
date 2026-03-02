## MODIFIED Requirements

### Requirement: Cultivator creation
Each new cultivator SHALL be created with: `age=10, cultivation=0, level=0, maxAge=MORTAL_MAX_AGE(60)`. The `courage` attribute SHALL be sampled from truncated normal distribution with μ=0.50, σ=0.15, bounds [0.01, 1.00], using Box-Muller transform + rejection sampling on seeded PRNG, then rounded to two decimal places via `round2`。超出 [0.01, 1.00] 的值 SHALL 重新采样而非 clamp。Each cultivator SHALL have a unique numeric ID (monotonically increasing integer).

#### Scenario: Cultivator initial state
- **WHEN** a new cultivator is created
- **THEN** it SHALL have age=10, cultivation=0, level=0, maxAge=60, and a unique ID

#### Scenario: Courage range
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL all be in [0.01, 1.00]，且每个值 SHALL 为精确的两位小数

#### Scenario: Courage truncated normal distribution
- **WHEN** 10000 cultivators are created
- **THEN** their courage values SHALL approximate a normal distribution with μ≈0.50, σ≈0.15，约 68% 的值落在 [0.35, 0.65] 范围内，且边界处无概率堆积

#### Scenario: No boundary spike
- **WHEN** 10000 cultivators are created
- **THEN** courage=0.01 和 courage=1.00 的频次 SHALL NOT 显著高于相邻值（即无 clamp 导致的边界堆积）

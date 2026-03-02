## Requirements

### Requirement: Effective courage calculation
系统 SHALL 提供 `effectiveCourage(c: Cultivator)` 函数，基于修仙者当前年龄和最大寿元计算有效勇气值。该函数 SHALL 使用不对称 U 型分段二次曲线：

```
lifeFrac = c.age / c.maxAge
P = 0.3, Ay = 0.1, Ao = 0.3

当 lifeFrac < P: boost = Ay * (1 - lifeFrac / P)²
当 lifeFrac >= P: boost = Ao * ((lifeFrac - P) / (1 - P))²

effectiveCourage = round2(min(1, c.courage + boost))
```

返回值 SHALL 经过 `round2` 保留两位小数，上界通过 `min(1, ...)` 约束。下界 0.01 由不变量保证（boost >= 0 且 baseCourage >= 0.01），无需显式 clamp。

#### Scenario: Young cultivator courage boost
- **WHEN** 修仙者 age=10, maxAge=100（lifeFrac=0.1, < P=0.3），baseCourage=0.50
- **THEN** boost = 0.1 * (1 - 0.1/0.3)² = 0.1 * (0.667)² ≈ 0.044，effectiveCourage = round2(0.544) = 0.54

#### Scenario: Midlife cultivator no boost
- **WHEN** 修仙者 age=30, maxAge=100（lifeFrac=0.3, = P），baseCourage=0.50
- **THEN** boost = 0（谷底），effectiveCourage = round2(0.50) = 0.50

#### Scenario: Near-death cultivator courage surge
- **WHEN** 修仙者 age=95, maxAge=100（lifeFrac=0.95），baseCourage=0.50
- **THEN** boost = 0.3 * ((0.95-0.3)/(1-0.3))² = 0.3 * (0.929)² ≈ 0.259，effectiveCourage = round2(0.759) = 0.76

#### Scenario: Asymmetry — old end higher than young end
- **WHEN** 修仙者 baseCourage=0.50，分别在 lifeFrac=0.0 和 lifeFrac=1.0
- **THEN** lifeFrac=0.0 时 boost=0.10，lifeFrac=1.0 时 boost=0.30；老年端加成为年轻端的 3 倍

#### Scenario: Clamping at upper bound
- **WHEN** 修仙者 baseCourage=0.90, lifeFrac=1.0
- **THEN** boost=0.30，base+boost=1.20，effectiveCourage SHALL 被 clamp 为 1.00

### Requirement: Courage curve constants
系统 SHALL 在 `src/constants.ts` 中定义以下常量：
- `COURAGE_TROUGH` = 0.3（谷底点 P，生命分数的 30% 处）
- `COURAGE_YOUNG_AMP` = 0.1（年轻端最大加成 Ay）
- `COURAGE_OLD_AMP` = 0.3（老年端最大加成 Ao）

#### Scenario: Constants are importable
- **WHEN** 其他模块导入 `COURAGE_TROUGH`, `COURAGE_YOUNG_AMP`, `COURAGE_OLD_AMP`
- **THEN** 值 SHALL 分别为 0.3, 0.1, 0.3

### Requirement: round2 precision function
系统 SHALL 在 `src/constants.ts` 中提供 `round2(v: number): number` 函数，返回 `Math.round(v * 100) / 100`，用于勇气相关数值的两位小数精度处理。

#### Scenario: round2 rounding behavior
- **WHEN** 输入值为 0.544
- **THEN** round2 SHALL 返回 0.54

#### Scenario: round2 boundary at .005
- **WHEN** 输入值为 0.505
- **THEN** round2 SHALL 返回 0.51（IEEE 754 banker's rounding 语义下 Math.round(50.5)=51）

### Requirement: Truncated Gaussian PRNG function
系统 SHALL 在 `src/engine/prng.ts` 中提供 `truncatedGaussian(prng: () => number, mu: number, sigma: number, lo: number, hi: number): number` 函数，使用 Box-Muller 变换 + 拒绝采样实现截断正态分布。实现约束：
- Box-Muller 每次消耗 2 次 `prng()` 调用，生成 1 个正态值，第二个值 SHALL 丢弃
- 当 `u1 = prng()` 返回 0 时，SHALL 使用 `1 - u1` 替代以避免 `log(0)`
- 当生成值落在 [lo, hi] 范围外时 SHALL 重新采样（重新消耗 2 次 `prng()`），而非 clamp 到边界值
- 接受区间为闭区间 `lo <= x <= hi`

#### Scenario: Truncated Gaussian output range
- **WHEN** 调用 `truncatedGaussian(prng, 0.50, 0.15, 0.01, 1.00)` 10000 次
- **THEN** 所有输出值 SHALL 在 [0.01, 1.00] 范围内，且无边界概率堆积

#### Scenario: Truncated Gaussian distribution shape
- **WHEN** 调用 `truncatedGaussian(prng, 0.50, 0.15, 0.01, 1.00)` 10000 次
- **THEN** 输出值 SHALL 近似正态分布（μ≈0.50, σ≈0.15），约 68% 的值落在 [0.35, 0.65]

#### Scenario: Fixed PRNG consumption per accepted sample
- **WHEN** 生成值未被拒绝
- **THEN** 该次调用 SHALL 恰好消耗 2 次 `prng()` 调用

## Property-Based Testing

### PBT: Boost monotonicity
对任意 t1 < t2 < P，boost(t1) >= boost(t2)（年轻段递减）。对任意 P <= t1 < t2 <= 1，boost(t1) <= boost(t2)（老年段递增）。边界重点测试 P±ε。

### PBT: Continuity at trough
boost(P) = 0，且 lim(t→P⁻) boost(t) = lim(t→P⁺) boost(t) = 0。使用 ε 从 1e-12 到 1e-2 多尺度验证。

### PBT: Effective courage bounds
对所有合法输入（baseCourage ∈ [0.01, 1.00], age ∈ [0, maxAge], maxAge > 0），baseCourage <= effectiveCourage <= 1.00。重点 fuzz 边界：t=0, t=P, t=1, base=0.01, base=1.00。

### PBT: round2 idempotency
round2(round2(x)) === round2(x) 对所有实数 x 成立。对抗性测试 n/100 ± 0.005 ± 1e-12 附近的值。

### PBT: Effective courage cent-quantized
effectiveCourage 输出始终为精确两位小数：abs(v*100 - round(v*100)) < 1e-10。

### PBT: Asymmetry ratio
boost(lifeFrac=0) / boost(lifeFrac=1) = Ay / Ao = 1/3。直接求值端点验证。

### PBT: Truncated Gaussian strict bounds
大量样本（N >= 10000，多种种子）生成的所有值 SHALL 在 [0.01, 1.00] 闭区间内。

### PBT: No boundary spike
直方图中 0.01 和 1.00 的频次 SHALL NOT 显著高于相邻 bin（0.02, 0.99）。使用 95% 置信区间检验。

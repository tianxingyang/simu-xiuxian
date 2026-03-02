## MODIFIED Requirements

### Requirement: Combat decision
When cultivator A encounters cultivator B: A's defeat rate = `B.cultivation / (A.cultivation + B.cultivation)`. A chooses to fight if `effectiveCourage(A) > defeat_rate` (strict greater-than). When `effectiveCourage(A) == defeat_rate`, A SHALL retreat. B's decision is computed independently with the same rule. `effectiveCourage` SHALL 替代原有的直接读取 `A.courage`，使战斗意愿随修仙者的生命阶段动态变化。`resolveCombat` 中 SHALL 对每个战斗者仅计算一次 `effectiveCourage`，缓存到局部变量后复用。当恰好一方想打（attacker）、一方不想打（evader）时，不再直接进入战斗，而是 SHALL 先执行避战判定（见 `combat-evasion` spec）。避战成功则无战斗；避战失败则 evader 承受修为惩罚后进入战斗。

#### Scenario: Both retreat
- **WHEN** A and B both have effectiveCourage <= their respective defeat rates
- **THEN** no combat occurs; both survive; no evasion check

#### Scenario: One fights one retreats — evasion succeeds
- **WHEN** A's effectiveCourage > A's defeat rate but B's effectiveCourage <= B's defeat rate, and B's evasion check succeeds
- **THEN** no combat SHALL occur; both cultivators survive

#### Scenario: One fights one retreats — evasion fails
- **WHEN** A's effectiveCourage > A's defeat rate but B's effectiveCourage <= B's defeat rate, and B's evasion check fails
- **THEN** B's cultivation SHALL be reduced by EVASION_PENALTY, then combat SHALL proceed between A and B(reduced cultivation)

#### Scenario: Both want to fight
- **WHEN** A's effectiveCourage > A's defeat rate AND B's effectiveCourage > B's defeat rate
- **THEN** combat SHALL occur immediately; no evasion check

#### Scenario: effectiveCourage equals defeat rate
- **WHEN** A's effectiveCourage exactly equals A's defeat rate (e.g., both 0.50)
- **THEN** A SHALL retreat

#### Scenario: Near-death cultivator more willing to fight
- **WHEN** 修仙者 baseCourage=0.30, lifeFrac=0.95, defeatRate=0.50
- **THEN** effectiveCourage ≈ 0.55 > 0.50，该修仙者 SHALL 选择战斗（若 baseCourage 未经寿元加成则会退缩）

## MODIFIED Requirements

### Requirement: Level hierarchy
The system SHALL support 8 cultivation levels (Lv0–Lv7). The promotion threshold SHALL be accessed via precomputed constant array `THRESHOLDS[level]`, where `THRESHOLDS = [0, 48, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]`. The function `threshold(level)` SHALL return `THRESHOLDS[level]`. Lv7 (大乘) SHALL be the maximum level; no further promotion is possible.

所有升级（Lv0→Lv1, Lv1→Lv2, ..., Lv6→Lv7）SHALL 在修为达到 `threshold(level+1)` 后，通过突破概率门判定。仅当突破成功时才执行升级。每个路径（`tickCultivators` / `resolveCombat`）内每个修仙者最多允许一次突破尝试，两路径独立计算。

| Level | Name | Threshold | THRESHOLDS[level] |
|-------|------|-----------|-------------------|
| Lv0 | 炼气 | - | 0 |
| Lv1 | 筑基 | 48 | 48 |
| Lv2 | 结丹 | 100 | 100 |
| Lv3 | 元婴 | 1,000 | 1_000 |
| Lv4 | 化神 | 10,000 | 10_000 |
| Lv5 | 炼虚 | 100,000 | 100_000 |
| Lv6 | 合体 | 1,000,000 | 1_000_000 |
| Lv7 | 大乘 | 10,000,000 | 10_000_000 |

#### Scenario: Lv0 promotes to Lv1 via breakthrough gate
- **WHEN** Lv0 修仙者 cultivation 达到 48
- **THEN** SHALL 通过突破概率门判定，仅在判定成功时升级至 Lv1

#### Scenario: Lv1 cultivator reaches Lv2 threshold
- **WHEN** Lv1 修仙者 cultivation 达到 100
- **THEN** SHALL 通过突破概率门判定，仅在判定成功时升级至 Lv2

#### Scenario: Lv7 cultivator cannot promote further
- **WHEN** a Lv7 cultivator accumulates any amount of cultivation beyond 10,000,000
- **THEN** no promotion SHALL occur; level remains Lv7

#### Scenario: threshold(0) returns zero
- **WHEN** `threshold(0)` is called
- **THEN** the return value SHALL be `THRESHOLDS[0]` = 0

#### Scenario: threshold(1) returns 48
- **WHEN** `threshold(1)` is called
- **THEN** the return value SHALL be `THRESHOLDS[1]` = 48

#### Scenario: threshold(3) returns precomputed value
- **WHEN** `threshold(3)` is called
- **THEN** the return value SHALL be `THRESHOLDS[3]` = 1000

### Requirement: THRESHOLDS[1] combat economy side effects
`THRESHOLDS[1]` 从 10 提高到 48 后，以下战斗系统行为 SHALL 随之变化（已确认接受）：

| 用途 | 公式 | 旧值 | 新值 |
|---|---|---|---|
| Lv1 baseLoot | `threshold(1) * LOOT_BASE_RATE` | 0.5 | 2.4 |
| Lv1 逃跑修为地板 | `max(threshold(evader.level), ...)` | 10 | 48 |
| Lv1 战败修为损失地板 | `max(threshold(loser.level), ...)` | 10 | 48 |
| Lv1 突破失败修为地板 | `max(threshold(c.level), ...)` | 10 | 48 |

#### Scenario: Lv1 combat base loot
- **WHEN** Lv1 修仙者在战斗中被击败
- **THEN** baseLoot SHALL 为 `48 * 0.05 = 2.4`

#### Scenario: Lv1 evasion cultivation floor
- **WHEN** Lv1 修仙者逃跑失败受到修为惩罚
- **THEN** 修为 SHALL NOT 低于 `threshold(1) = 48`

## ADDED PBT Properties

### PBT-08: Lv1 baseLoot 值验证
- **INVARIANT**: 对 loser.level=1 的战斗，baseLoot = threshold(1) * LOOT_BASE_RATE = 48 * 0.05 = 2.4（float 容差内）
- **FALSIFICATION**: 构造 loser.level=1 的战斗状态，拦截 baseLoot 计算结果，断言 |baseLoot - 2.4| < ε

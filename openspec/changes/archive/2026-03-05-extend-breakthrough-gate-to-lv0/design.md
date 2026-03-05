## Context

当前系统中 Lv0→Lv1 采用自动升级（修为达到 `threshold(1)=10` 即升级），`tryBreakthrough` 函数通过 `c.level < 1` 显式排除 Lv0 修仙者。目标分布公式 `w_k = e^{-(0.6k + 0.15k²)}` 扩展到 k=0 后要求 Lv0 占总人口 59.17%，但自动升级使 Lv0 仅是 10 年等待期，所有人必然进入筑基。

关键约束：
- Lv0 修仙者寿元 60 年（`MORTAL_MAX_AGE=60`），age=10 出生，cultivation 以 1/年增长
- Lv0 不参与战斗（`processEncounters` 跳过 level=0），唯一死亡途径是寿元耗尽
- `THRESHOLDS[0] = Infinity` 会导致突破失败修为损失惩罚中 `threshold(c.level)` 溢出

## Goals / Non-Goals

**Goals:**
- 将 `tryBreakthrough` 的适用范围从 k≥1 扩展到 k≥0，复用同一套公式和惩罚逻辑
- 通过提高 `THRESHOLDS[1]` 限制 Lv0 修仙者的突破尝试次数，使约 53% 终身留在炼气
- 移除所有 Lv0→Lv1 自动升级的硬编码路径，统一由 `tryBreakthrough` 处理
- 修复 `THRESHOLDS[0]` 溢出问题

**Non-Goals:**
- 调整死亡率参数（先观察实际分布再决定）
- 调整突破公式的 a/b 参数
- 修改 Lv0 的战斗参与规则

## Decisions

### D1: THRESHOLDS[1] 取值

**选择**: `THRESHOLDS[1] = 48`

Lv0 修仙者 cultivation 以 1/年增长，age=10 出生，maxAge=60。cultivation 在 age=58 时达到 48。从 age=58 到 age=60（死亡）仅有 2 年，而突破冷却期为 3 年，因此一生最多 1 次尝试机会。

`breakthroughChance(0) = e^{-(0.6+0.15)} ≈ 47.2%`，1 次机会下 52.8% 的人终身留在炼气，接近目标 59.17%。

**备选方案**:
- `THRESHOLDS[1] = 45`：2 次机会，仅 27.9% 留在 Lv0 → 偏离目标
- `THRESHOLDS[1] = 50`：age=60 才达标，但 age=60 即死亡（`age >= maxAge`），0 次机会 → 过于极端

### D2: THRESHOLDS[0] 修复

**选择**: `THRESHOLDS[0] = 0`

Lv0 没有"入门修为门槛"的概念。将其设为 0 使得突破失败时的修为损失计算 `max(threshold(0), cultivation - excess * rate)` 正确工作：base=0，损失 20% 的全部修为。

### D3: 移除自动升级代码

**选择**: 完全移除 `tickCultivators` 和 `resolveCombat` 中的 Lv0→Lv1 自动升级代码块。

`tickCultivators` 中移除：
```
if (c.level === 0 && c.cultivation >= threshold(1)) {
    c.level = 1; c.maxAge = 100; ...
}
```
改为让后续的 `tryBreakthrough(this, c, events, 'natural')` 统一处理（移除 `c.level >= 1` 条件）。

`resolveCombat` 中移除 winner 的 Lv0→Lv1 自动升级代码块。该代码本身不可达（Lv0 不参与战斗），属于死代码清理。

### D4: tryBreakthrough 前置条件调整

**选择**: 移除 `c.level < 1` 检查，保留 `c.level >= MAX_LEVEL` 检查。

修改前：`if (c.level < 1 || c.level >= MAX_LEVEL) return false;`
修改后：`if (c.level >= MAX_LEVEL) return false;`

Lv0 修仙者进入 tryBreakthrough 后的行为：
- `c.cultivation < threshold(1)` 检查：threshold(1)=48，cultivation<48 时直接 return false（无 PRNG 消耗）
- `breakthroughCooldownUntil` 检查：正常生效
- `injuredUntil` 检查：Lv0 不参与战斗且未曾突破失败过，初始值 0，不会阻止
- 成功路径：`level++ → 1`，`maxAge += lifespanBonus(1) = 100`，得到 maxAge=160
- 失败路径：cooldown、修为损失、受伤惩罚正常生效（但 Lv0 只有 1 次机会，惩罚对后续无影响）
- 事件产生：`c.level >= 2` 检查 → Lv0 失败不产生 `RichBreakthroughEvent`（与 Lv1 一致）

### D5: Lv0→Lv1 升级后的 maxAge

**选择**: 走 `tryBreakthrough` 的通用路径 `c.maxAge += lifespanBonus(c.level)`。

Lv0→Lv1 成功时：maxAge = 60 + lifespanBonus(1) = 60 + 100 = 160。`SUSTAINABLE_MAX_AGE[1] = 100`，寿元衰减（`LIFESPAN_DECAY_RATE=0.2`）将在约 15 个 tick 内把 maxAge 拉回 ~100。

vs 原自动升级硬编码 `maxAge = 100`：新方式给予约 10-15 年的额外寿元缓冲，但这与高级别突破后的 maxAge 处理方式一致，更统一。

### D6: tickCultivators 中 tryBreakthrough 的调用位置

**选择**: 移除 `if (c.level >= 1)` 条件，对所有活着的修仙者调用 tryBreakthrough。

修改前：
```
if (c.level === 0 && c.cultivation >= threshold(1)) { 自动升级 }
if (c.level >= 1) { tryBreakthrough(this, c, events, 'natural'); }
```
修改后：
```
tryBreakthrough(this, c, events, 'natural');
```

tryBreakthrough 内部已有完整的前置条件检查（level < MAX_LEVEL, cultivation >= threshold, cooldown, injury），对 Lv0 不满足条件的修仙者会直接 return false 且零副作用。

### D7: THRESHOLDS[1]=48 对战斗经济的连锁影响

**选择**: 接受副作用，不拆分 threshold 用途。

`threshold(level)` 在战斗系统中被用于：掠夺基础量（`baseLoot = threshold(loser.level) * LOOT_BASE_RATE`）、逃跑惩罚地板、战败修为损失地板、突破失败修为损失地板。`THRESHOLDS[1]` 从 10 提高到 48 后：

| 用途 | 旧值 | 新值 | 变化 |
|---|---|---|---|
| Lv1 baseLoot | 0.5 | 2.4 | +380% |
| Lv1 逃跑/战败修为地板 | 10 | 48 | +380% |
| Lv1 突破失败修为地板 | 10 | 48 | +380% |

Lv1 入门修为从 10 提高到 48，战斗经济参数跟随上调是自然的。Lv1 修仙者的修为基数更高，对应更高的掠夺基础量和更高的修为保底。

### D8: 新晋 Lv0→Lv1 立即参战

**选择**: 允许同年参战，与高级别突破后行为一致。

`tickCultivators` 在 `processEncounters` 之前执行。Lv0→Lv1 升级后，修仙者被加入 `aliveLevelIds[1]`，同年进入战斗池。新晋 Lv1（age=58, cultivation=48）面对可能 cultivation=200+ 的老 Lv1 时处于劣势，但这与所有级别突破后的行为一致——高级别突破后同样立即参战。

## Risks / Trade-offs

- **PRNG 序列变化**: Lv0 修仙者现在参与突破判定（即使大部分因 cultivation 不足直接 return），cultivation=48 时消耗 1-2 次 prng()。相同种子下模拟结果不再与变更前一致 → 预期行为，非兼容性问题
- **分布精度偏差**: 52.8% 留在 Lv0 vs 目标 59.17%，约 6% 缺口。稳态分布受多因素影响（战斗动态、寿元系统），实际偏差需跑模拟验证。若偏差过大，后续可微调 a/b 参数或 THRESHOLDS[1] → 风险可接受
- **Lv1 入口年龄变大**: 修仙者在 age=58 才可能进入 Lv1（原为 age=20），进入时 cultivation=48（原为 10），意味着到达 Lv2 threshold=100 只需额外 52 年修为增长。配合 maxAge 从 160 衰减至 ~100，有约 42 年可用，仍需战斗掠夺补充 → 符合设计意图
- **Lv1 战斗经济变化**: baseLoot 从 0.5 上调至 2.4，配合 Lv1 修为地板从 10 提高到 48。新 Lv1 修仙者初始修为更高（48 vs 10），更高的掠夺基础量和修为保底合理匹配其更高的起点 → 接受

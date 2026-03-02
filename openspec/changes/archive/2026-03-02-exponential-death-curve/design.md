## Context

当前 `resolveDefeatOutcome` 使用线性公式计算致死率：`clamp(0.7 - 0.09 × level + 0.3 × gap, 0.05, 0.95)`。该公式从 100% 纯淘汰制降下来，出发点是控制人口膨胀，但与修炼-寿命系统的缺口问题未联合校准，导致 Lv1 均势致死率 61%，作为结丹唯一路径的战斗系统通过率过低。

## Goals / Non-Goals

**Goals:**
- 致死率曲线从线性改为指数，低阶致死率大幅降低、高阶保持低致死率
- gap 影响从加性改为乘性，确保高阶修士不会被 gap 不合理地拉高致死率
- 替换相关常量，移除不再需要的旧常量

**Non-Goals:**
- 不改变战斗触发逻辑（遭遇概率、对手选择、闪避判定）
- 不改变胜者战利品公式
- 不改变存活结局分配权重（跌境/重伤/损失修为）
- 不改变 PRNG 调用顺序
- 不调整修炼速率或寿命参数

## Decisions

### D1: 指数致死率公式

```
rawDeath = DEFEAT_DEATH_BASE × DEFEAT_DEATH_DECAY ^ loser.level
deathChance = min(DEFEAT_MAX_DEATH, rawDeath × (1 + DEFEAT_GAP_SEVERITY × gap))
```

常量：`DEFEAT_DEATH_BASE=0.40`, `DEFEAT_DEATH_DECAY=0.72`, `DEFEAT_GAP_SEVERITY=0.3`（语义改变为乘性系数）, `DEFEAT_MAX_DEATH=0.95`

移除 `DEFEAT_MIN_DEATH`：指数衰减公式天然保证正值，无需下限 clamp。

各境界致死率：

| 境界 | 均势(gap≈0) | 被碾压(gap=0.5) | 以弱胜强(gap=-0.5) |
|------|------------|----------------|-------------------|
| Lv1 筑基 | 29% | 33% | 24% |
| Lv2 结丹 | 21% | 24% | 17% |
| Lv3 元婴 | 15% | 17% | 12% |
| Lv4 化神 | 11% | 12% | 9% |
| Lv5 炼虚 | 8% | 9% | 6% |
| Lv6 合体 | 6% | 6% | 5% |
| Lv7 大乘 | 4% | 5% | 3% |

**Rationale**: 指数衰减天然符合修仙体系"越高阶越难杀"的幂次级差距。两个参数（BASE + DECAY）控制整条曲线形状，比线性的截距+斜率更贴合需求。

### D2: 乘性 gap 影响

旧公式的 gap 影响是加性的：`+ 0.3 × gap`，最大偏移 ±0.15（gap 范围 -0.5~0.5 典型值）。这导致高阶修士（base 已很低）被 gap 不成比例地拉高——Lv7 从 7% 飙到 22%。

新公式改为乘性：`× (1 + 0.3 × gap)`。gap=0.5 时乘以 1.15，gap=-0.5 时乘以 0.85。高阶修士的 gap 影响与其 base 成比例，不会出现大乘被打到 22% 的情况。

`DEFEAT_GAP_SEVERITY` 数值保持 0.3 不变，但语义从加性偏移量变为乘性系数。

### D3: 常量替换

移除：
- `DEFEAT_BASE_DEATH`（0.7）
- `DEFEAT_LEVEL_PROTECTION`（0.09）
- `DEFEAT_MIN_DEATH`（0.05）—— 指数公式天然正值，无需下限

新增：
- `DEFEAT_DEATH_BASE`（0.40）—— 指数曲线基准
- `DEFEAT_DEATH_DECAY`（0.72）—— 每级衰减率

保持不变：
- `DEFEAT_GAP_SEVERITY`（0.3，语义改变）
- `DEFEAT_MAX_DEATH`（0.95）
- 所有存活结局相关常量

### D4: 代码变更范围

`src/constants.ts`:
- 替换两个常量声明
- 移除对应 export

`src/engine/combat.ts` — `resolveDefeatOutcome` 函数:
- 移除 `DEFEAT_BASE_DEATH`、`DEFEAT_LEVEL_PROTECTION` 的 import
- 新增 `DEFEAT_DEATH_BASE`、`DEFEAT_DEATH_DECAY` 的 import
- 致死率计算从 `clamp(DEFEAT_BASE_DEATH - DEFEAT_LEVEL_PROTECTION * loserLevel + DEFEAT_GAP_SEVERITY * gap, MIN, MAX)` 改为 `Math.min(DEFEAT_MAX_DEATH, DEFEAT_DEATH_BASE * DEFEAT_DEATH_DECAY ** loserLevel * (1 + DEFEAT_GAP_SEVERITY * gap))`

函数签名不变，返回值语义不变，PRNG 调用顺序不变。

## Risks / Trade-offs

- **种群规模变化** → 致死率降低将显著增加 Lv1 存活人数，可能导致种群膨胀。寿元过期（`removeExpired`）是天然对冲机制；若膨胀过度，可后续调整 `DEFEAT_DEATH_BASE` 或 `YEARLY_NEW`。
- **PRNG 序列不兼容** → 公式变更不影响 PRNG 调用次数和顺序（仍是同一位置的同一次 `prng()` 调用），但相同种子下模拟结果会因致死率阈值不同而产生不同分支路径。这是预期行为。
- **高阶致死率可能过低** → Lv6/Lv7 触底到 5% 附近，同阶战斗几乎无致死风险。当前高阶人口极少，此影响可忽略；若后续高阶人口增长，可通过提高 `DEFEAT_DEATH_BASE` 微调。

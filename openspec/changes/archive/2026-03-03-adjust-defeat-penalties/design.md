## Context

当前战败结局系统使用两阶段判定：第一阶段判定死亡，第二阶段在存活结局中按权重分配。现有存活结局包括跌境（权重1）、重伤（权重1.5）、损失修为（权重1.5），总权重4.0。跌境占存活结局的25%，导致结丹期修士频繁跌境，形成"旋转门"效应。

## Goals / Non-Goals

**Goals:**
- 将跌境概率降至1%，使其成为极罕见事件
- 新增轻伤和经脉受损两种中间层次的惩罚
- 形成清晰的严重程度梯度：死亡 > 跌境 > 经脉受损 > 重伤 > 损失修为 > 轻伤
- 保持战败结局判定的两阶段结构不变
- 保持死亡概率计算公式不变

**Non-Goals:**
- 不改变战斗触发逻辑（遭遇概率、对手选择、闪避判定）
- 不改变胜者战利品（loot）公式
- 不改变死亡概率公式
- 不改变跌境、重伤、损失修为的具体效果（只调整概率）

## Decisions

### D1: 权重分配方案

存活结局权重调整为：

| 结局 | 权重 | 概率 | 说明 |
|------|------|------|------|
| 轻伤 | 4.0 | 40% | 最常见，轻度惩罚 |
| 重伤 | 2.9 | 29% | 较常见，中度惩罚 |
| 损失修为 | 2.0 | 20% | 中等频率 |
| 经脉受损 | 1.0 | 10% | 较少见，长期影响 |
| 跌境 | 0.1 | 1% | 极罕见，灾难性 |

总权重 = 10.0

**Rationale**:
- 跌境权重从 1.0 降至 0.1，使其概率从 25% 降至 1%
- 轻伤作为最常见结局（40%），提供轻度惩罚，避免过度淘汰
- 经脉受损（10%）作为长期削弱机制，比重伤更严重但比跌境轻
- 保持固定权重分配的简单性，便于调试和平衡

### D2: 轻伤机制设计

```typescript
// 新增字段
interface Cultivator {
  lightInjuryUntil: number;  // 轻伤恢复年份，0表示未受伤
}

// naturalCultivation 中的处理
let growthRate = 1;
if (c.injuredUntil > this.year) {
  growthRate = INJURY_GROWTH_RATE;  // 0.5 重伤
} else if (c.lightInjuryUntil > this.year) {
  growthRate = LIGHT_INJURY_GROWTH_RATE;  // 0.7 轻伤
}
c.cultivation += growthRate * (1 - (c.foundationDamage || 0));
```

**Rationale**:
- 轻伤与重伤使用相同的时间判定模式，代码结构一致
- 轻伤不影响战斗参与（与重伤不同），只影响修炼速度
- 2年恢复期短于重伤的5年，符合"轻伤"定位
- 修为增长×0.7（重伤是×0.5），惩罚力度适中

### D3: 经脉受损机制设计

```typescript
// 新增字段
interface Cultivator {
  meridianDamagedUntil: number;  // 经脉受损恢复年份，0表示未受损
}

// resolveCombat 中战斗力计算
function resolveCombat(engine, a, b, ...) {
  const aCultSnap = a.cultivation;
  const bCultSnap = b.cultivation;

  // 经脉受损期间战力打折
  let aCombatPower = a.cultivation;
  let bCombatPower = b.cultivation;
  if (a.meridianDamagedUntil > engine.year) {
    aCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);  // 0.7
  }
  if (b.meridianDamagedUntil > engine.year) {
    bCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);  // 0.7
  }

  // 使用 combatPower 进行战斗判定
  // 但 loot 仍基于原始 cultivation 计算
}
```

**Rationale**:
- 经脉受损影响战斗力，但不影响修炼速度（与重伤/轻伤互补）
- 10年恢复期长于重伤的5年，体现其严重性
- 战力削弱30%（按70%计算），使受损修士在战斗中处于劣势
- 不影响 loot 计算，保持战利品公式不变
- 受损修士仍可参与战斗（与重伤不同），但胜率降低

### D4: 结局判定顺序

保持现有的两阶段判定结构：

```typescript
function resolveDefeatOutcome(prng, winnerSnap, loserSnap, loserLevel) {
  // 第一阶段：死亡判定
  const deathChance = Math.min(DEFEAT_MAX_DEATH,
    DEFEAT_DEATH_BASE * DEFEAT_DEATH_DECAY ** loserLevel * (1 + DEFEAT_GAP_SEVERITY * gap));
  if (prng() < deathChance) return 0;  // 死亡

  // 第二阶段：存活结局判定
  const total = DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W
                + DEFEAT_MERIDIAN_W + DEFEAT_DEMOTION_W;
  const r = prng();

  if (r < DEFEAT_LIGHT_INJURY_W / total) return 6;  // 轻伤
  if (r < (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W) / total) return 2;  // 重伤
  if (r < (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W) / total) return 3;  // 损失修为
  if (r < (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W + DEFEAT_MERIDIAN_W) / total) return 5;  // 经脉受损
  return 1;  // 跌境
}
```

**Rationale**:
- 保持两阶段结构，最小化对现有代码的改动
- 按概率从高到低排列判定顺序，提高代码可读性
- 使用新的返回值编码：0=死亡, 1=跌境, 2=重伤, 3=损失修为, 5=经脉受损, 6=轻伤

### D5: 状态优先级

当修士同时处于多种受伤状态时的处理：

- **修炼速度**：重伤 > 轻伤（重伤优先，×0.5）
- **战斗参与**：重伤禁战，轻伤和经脉受损可参战
- **战斗力**：经脉受损削弱战力（×0.7），轻伤不影响战力

**Rationale**:
- 重伤是最严重的临时状态，优先级最高
- 轻伤和经脉受损可以共存（一个影响修炼，一个影响战斗）
- 简单的优先级规则，避免复杂的状态叠加计算

## Risks / Trade-offs

**[风险] 跌境概率过低导致结丹期人数过多**
→ 缓解：跌境概率1%仍然存在，且结丹期突破本身就很难（需要90修为，寿命100年）。可通过实际模拟数据调整权重。

**[风险] 新增状态字段增加内存占用**
→ 缓解：每个 Cultivator 新增 2 个 number 字段（8字节×2），在1000人规模下增加约16KB内存，可接受。

**[风险] 经脉受损修士在战斗中持续处于劣势，可能形成"弱者螺旋"**
→ 缓解：10年恢复期后自动恢复；战力削弱30%不至于完全无法获胜；可通过闪避机制避免战斗。

**[风险] 轻伤和重伤的判定逻辑可能冲突**
→ 缓解：使用明确的优先级规则（重伤 > 轻伤），在 naturalCultivation 中先判断重伤再判断轻伤。

**[权衡] 固定权重 vs 动态权重**
→ 选择固定权重：简单、可预测、易调试。动态权重（基于gap/level）会增加复杂度，且当前设计已通过死亡概率体现了gap/level的影响。

**[权衡] 经脉受损影响战力 vs 影响修炼**
→ 选择影响战力：与重伤/轻伤形成互补（它们影响修炼），提供更丰富的惩罚维度。影响战力也更符合"经脉受损"的世界观（战斗力受限）。

## Implementation Constraints

以下约束在 gudaspec:plan 阶段通过多模型分析和用户确认明确定义，实施时必须严格遵守：

### Timing and State Lifecycle
1. **状态生效时机**：新增的受伤状态（轻伤/经脉受损）在战斗发生的同一年立即生效，影响该年剩余阶段
2. **轻伤持续时间语义**：`LIGHT_INJURY_DURATION=2` 表示影响 2 次 naturalCultivation 调用，而非 2 个日历年
3. **战败锁定**：所有战败结局（包括轻伤和经脉受损）触发同年战败锁定，被锁定修士本年不能再次战斗

### Combat Mechanics
4. **战斗参与规则**：
   - 重伤：禁止战斗
   - 轻伤：允许战斗，只影响修炼速度
   - 经脉受损：允许战斗，战力削弱×0.7
5. **闪避与经脉独立计算**：闪避失败直接扣除修为（永久），经脉受损影响战斗力（临时），两者不叠加
6. **死亡概率 gap 计算**：使用经脉受损调整后的战斗力计算 gap，而非原始修为
7. **战斗力精度**：使用完整浮点数精度，不进行四舍五入

### State Management
8. **状态字段保留**：战败结局只修改其目标字段，其他状态字段保持不变（如跌境不清除轻伤状态）
9. **多状态共存**：轻伤和经脉受损可以同时存在，独立生效
10. **字段初始化**：新修士和对象池复用时显式初始化为 0；旧数据的 undefined/NaN 视为 0

### Constants and Validation
11. **常量命名**：使用 `DEFEAT_CULT_LOSS_W` 而非 `DEFEAT_LOSS_W`
12. **PRNG 边界**：PRNG 返回 [0, 1) 区间，使用 `<` 比较符，边界值 1.0 永远不会出现
13. **概率精度**：使用 epsilon=1e-6 作为浮点数比较容差
14. **统计测试标准**：10000 样本，跌境 [80, 120]（1%±0.2%），轻伤 [3800, 4200]（40%±2%），经脉 [800, 1200]（10%±2%）
15. **outcomeCode 保留**：编码值 4 保留为未来扩展，解码器遇到无效值返回错误
16. **配置验证**：启动时验证所有权重>0、持续时间>0、惩罚比例在[0,1]，失败则抛出错误

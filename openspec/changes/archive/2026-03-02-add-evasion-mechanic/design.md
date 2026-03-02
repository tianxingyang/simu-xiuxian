## Context

当前 `resolveCombat` 中的战斗决策是二元的：双方都不想打则跳过，否则直接战斗。缺乏"一方想打、一方试图逃跑"的中间状态。避战机制需要插入到勇气判定和战斗结算之间，作为一个新的决策层。

现有代码结构（`src/engine/combat.ts:72-115`）：
```
resolveCombat(a, b)
  ├─ 计算双方 effectiveCourage 和 defeatRate
  ├─ 双方都怯战 → return（跳过）
  ├─ 决定胜负（prng）
  ├─ 败者死亡、胜者吸收修为
  └─ 胜者晋级检查
```

## Goals / Non-Goals

**Goals:**
- 在 `resolveCombat` 中插入避战判定，不改变现有函数签名
- 新增 `EVASION_SENSITIVITY` 和 `EVASION_PENALTY` 两个可调常量
- 避战判定仅影响"一方想打一方不想打"的场景

**Non-Goals:**
- 不引入避战事件日志（静默机制）
- 不修改双方都想打或双方都不想打的现有行为
- 不改变 `processEncounters` 的遭遇匹配逻辑

## Decisions

### 1. 避战逻辑嵌入位置：`resolveCombat` 内部

在现有勇气判定（`aCourage <= ... && bCourage <= ...`）之后、胜负决定之前，新增避战分支。

修改后流程：
```
resolveCombat(a, b)
  ├─ 计算双方 effectiveCourage 和 defeatRate
  ├─ 双方都怯战 → return
  ├─ [NEW] 判断是否恰好一方想打一方不想打
  │    ├─ 确定 attacker / evader
  │    ├─ 计算 gap 和 P(避战)
  │    ├─ 避战成功 → return
  │    └─ 避战失败 → evader.cultivation *= (1 - EVASION_PENALTY)
  ├─ 决定胜负（prng，使用 evader 削弱后的修为）
  ├─ 败者死亡、胜者吸收修为
  └─ 胜者晋级检查
```

**理由**：保持 `processEncounters` 不变，避战逻辑完全封装在 `resolveCombat` 内部，对外透明。

### 2. 避战概率公式：修为差偏移式

```
gap = (evader.cultivation - attacker.cultivation) / (evader.cultivation + attacker.cultivation)
P = clamp(0.5 + EVASION_SENSITIVITY × gap, 0, 1)
```

**备选方案**：修为占比式 `P = evader.cult / total`。放弃原因：与胜率公式完全同构，缺乏独立的调参空间。偏移式通过 `EVASION_SENSITIVITY` 提供额外控制维度。

### 3. 失败惩罚：扣除 evader 自身修为的 5%，钳位至等级门槛

`penalized = round1(evader.cultivation * (1 - EVASION_PENALTY))`
`evader.cultivation = max(threshold(evader.level), penalized)`

使用 `round1` 保持与现有修为计算的精度一致。惩罚后修为钳位至当前等级门槛，防止修为低于等级要求。战斗 `total` 在惩罚后重新计算：`total = attacker.cultivation + evader.cultivation`，使惩罚直接影响胜率。

### 5. PRNG 短路策略

当 P=0 时直接失败、P=1 时直接成功，均不消耗 `prng()` 调用。仅当 0 < P < 1 时消耗一次 `prng()` 进行判定。

**理由**：避免在确定性结果上浪费 PRNG 序列位，保持语义清晰。

### 6. 战斗意愿单次评估

`effectiveCourage` 和 `defeatRate` 在避战判定前计算一次，存入局部变量。避战惩罚不触发重新评估。

### 7. 避战成功后的遭遇资格

避战成功后双方均保持存活、等级不变、修为不变，在同一年遭遇阶段可继续被其他修仙者选为对手。

### 4. attacker / evader 角色确定

- A 想打且 B 不想打 → attacker = A, evader = B
- B 想打且 A 不想打 → attacker = B, evader = A
- 双方都想打 → 无避战，直接战斗
- 双方都不想打 → 已被前置逻辑跳过

## Risks / Trade-offs

- [避战降低战斗死亡率] → 高修为谨慎修仙者存活率上升，可能导致高等级人口膨胀。可通过调整 `EVASION_SENSITIVITY` 缓解
- [惩罚修为使用 round1] → 低修为时惩罚可能被四舍五入为 0（如 cult=5, penalty=0.25→round1=0.3→cult=4.7; cult=1, penalty=0.05→round1=0.1→cult=0.9）。修为极低时惩罚微乎其微，可接受

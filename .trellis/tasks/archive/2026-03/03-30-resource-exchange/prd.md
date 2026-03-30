# 资源交换系统 - 切磋/传授

## Goal

在关系系统（Phase 1）基础上，引入切磋和传授两种非暴力交互机制，让修仙者之间能通过友好方式互相提升修为。

## Requirements

### 切磋（Sparring）

友好型对抗，双方以武会友，不产生死亡/重伤结果。

- 触发条件:
  - 双方空间邻近（encounter range 内）
  - 境界差 ≤ 1（差距太大无切磋意义）
  - 双方无宿敌/血仇关系
  - 有道友关系、同门关系、或亲缘关系（至少满足一项）
  - 概率由 AI Policy 决策，rule-based fallback 中基于道友 strength 调节
- 结果:
  - 双方各获得少量修为（远小于真实战斗的 loot，如 +0.3~0.8）
  - 弱势方获得略多（切磋中领悟更多）
  - 不产生死亡、重伤、降级、经脉损伤等负面结果
  - 道友 strength +0.05（友谊加深）
- 与战斗的区别:
  - 战斗: 高风险高收益，可能死亡/重伤/降级，loot 修为多
  - 切磋: 零风险低收益，安全稳定，强化道友关系

### 传授（Teaching）

高境界修仙者指点低境界者，加速其修炼速度。

- 触发条件:
  - 双方空间邻近
  - 传授方境界 - 受教方境界 ≥ 2（需要足够差距才有传授价值）
  - 存在师徒关系、或道友关系（strength ≥ 0.3）
  - 传授方处于 settling 状态（有余力指点他人）
  - 概率由 AI Policy 决策
- 结果:
  - 受教方: 修炼速度临时加成（持续 N 年，如 +0.3/年，可叠加但有上限）
  - 师徒间传授效果更强（如 +0.5/年）
  - 传授方: 教学相长，获得微量修为（+0.1）
  - 道友 strength +0.05 / 师徒关系不额外变化（已有师徒加成）
- 加速机制:
  - 在 Cultivator 上新增 `teachingBoostUntil: number` 和 `teachingBoostRate: number`
  - 每年 tick 修为增长时: `cultivation += 1 + teachingBoostRate`（若当前年 < teachingBoostUntil）
  - 多次传授可刷新 duration，rate 叠加但有上限（如 max 0.8）

### 相遇决策扩展

Phase 1 的相遇流程扩展为：

```
相遇判定（空间邻近）
  ├── AI Policy / rule-based 决策
  │     输入: 关系特征 + 新增交互特征
  │     输出: 战斗 / 切磋 / 传授 / 忽略
  ├── 战斗 → 现有 combat 逻辑
  ├── 切磋 → sparring 逻辑（需满足前置条件）
  ├── 传授 → teaching 逻辑（需满足前置条件）
  └── 忽略 → 可能形成新道友关系
```

### AI Policy 特征扩展

在 Phase 1 的关系特征基础上新增:
- `can_spar`: 是否满足切磋前置条件 (0/1)
- `can_teach`: 是否满足传授前置条件 (0/1)
- `can_be_taught`: 是否可被传授 (0/1)
- `teaching_boost_active`: 当前是否有传授加成 (0/1)

AI Policy 输出 action space 扩展:
- 现有: escaping / recuperating / seeking_breakthrough / settling / wandering
- 新增行为状态或在相遇决策中新增 action

### 事件系统扩展

新增 RichEvent subtype:
- `RichSparringEvent`: 切磋事件
  - actors: 双方
  - cultivationGained: [a, b] 双方获得修为
  - 新闻等级: 高境界切磋(B), 一般(C)
- `RichTeachingEvent`: 传授事件
  - actors: teacher, student
  - boostRate, boostDuration
  - isMentorTeaching: 是否师徒传授
  - 新闻等级: 师徒传授(C), 高境界传授(B)

## Acceptance Criteria

- [ ] 满足条件的角色能进行切磋，双方获得少量修为且无负面结果
- [ ] 高境界角色能传授低境界角色，加速其修炼速度
- [ ] 师徒间传授效果强于道友间
- [ ] 切磋/传授作为 AI Policy 特征和 action，可由神经网络决策
- [ ] rule-based fallback 中切磋/传授有合理的触发概率
- [ ] 新增 RichSparringEvent / RichTeachingEvent 前端可展示
- [ ] 切磋不会产生死亡/重伤/降级等负面结果
- [ ] 传授加成正确叠加、衰减、序列化

## Definition of Done

- Tests added/updated
- Lint / typecheck / CI green
- 存档格式向后兼容

## Out of Scope

- 物品/丹药/法宝系统
- 交易/市场机制
- 灵石/货币系统
- 双修（需性别系统）

## Technical Notes

- 依赖 Phase 1 关系系统（道友/师徒关系作为前置条件）
- 切磋可复用部分 combat.ts 的战力计算逻辑，但跳过 defeat outcome
- 传授加速通过 Cultivator 新增字段实现，在 simulation.ts tickCultivators 中生效
- 需要扩展 AI Policy action space（或在 encounter 阶段引入子决策）

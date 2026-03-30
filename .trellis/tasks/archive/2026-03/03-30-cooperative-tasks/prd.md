# 合作任务系统 - 协助突破（护法）

## Goal

引入"护法"机制，让道友或师徒在修仙者突破时提供协助，提升突破成功率。这是修仙题材中最经典的合作场景之一。

## Requirements

### 护法机制（Breakthrough Assistance）

修仙者尝试突破时，若附近有关系者，可获得突破成功率加成。

- 触发条件:
  - 突破者正在尝试突破（现有 breakthrough 逻辑触发时）
  - 附近（encounter range 内）存在道友/师徒/同门
  - 护法者境界 ≥ 突破者当前境界（护法者需有足够实力）
  - 护法者非受伤/逃跑状态
  - 护法行为由 AI Policy 决策（是否愿意护法）
- 效果:
  - 突破成功率加成，幅度由护法者境界差和关系类型决定:
    - 师父护法: 加成最大（如 +15%~20% 基础突破率）
    - 道友护法（strength ≥ 0.5）: 中等加成（如 +5%~10%）
    - 同门护法: 中等加成（如 +5%~10%）
  - 多人护法可叠加但有上限（如最多 +25%）
  - 护法者在突破期间不参与其他交互（占用该 tick 的行动）
- 突破失败时:
  - 护法者存在可减轻失败惩罚（如修为损失减半，避免重伤）
  - 具体减轻幅度由关系类型调节

### AI Policy 特征扩展

在 Phase 1/2 基础上新增:
- `ally_breakthrough_nearby`: 附近是否有关系者正在突破 (0/1)
- `can_guard`: 自己是否满足护法条件 (0/1)
- `guard_available`: 自己突破时附近是否有可用护法者 (0/1)

AI Policy 新增 action:
- `guarding`: 护法行为状态（或作为 settling 的子状态）

### 事件系统扩展

扩展现有 RichBreakthroughEvent / RichPromotionEvent:
- 新增 `guardians: Array<{id, level}>` 字段 — 参与护法的修仙者
- 有护法者的突破事件新闻等级提升一档（更具叙事价值）
- 如: 师父护法下弟子突破(A), 道友护法突破(B)

## Acceptance Criteria

- [ ] 突破时附近的道友/师徒/同门可提供成功率加成
- [ ] 师父护法加成 > 道友/同门护法加成
- [ ] 多人护法叠加有上限
- [ ] 护法可减轻突破失败的惩罚
- [ ] 护法行为由 AI Policy 决策
- [ ] 突破事件记录护法者信息，前端可展示
- [ ] 护法不引入新的存储字段（仅在突破 tick 时即时判定）

## Definition of Done

- Tests added/updated
- Lint / typecheck / CI green
- 存档格式向后兼容

## Out of Scope

- 联手战斗（合并战力对抗共同敌人）
- 共同抵御灾害
- 组队探险

## Technical Notes

- 依赖 Phase 1 关系系统（道友/师徒关系判定）
- 突破逻辑在 `simulation.ts` tickCultivators 中
- 突破成功率计算在 balance.ts 的 sigmoid/gaussian 曲线
- 护法是即时判定（突破发生时扫描附近关系者），不需要额外持久化
- 需扩展 AI Policy action space 增加 guarding 行为

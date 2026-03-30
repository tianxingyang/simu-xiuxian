# 关系构建系统 - 道友/师徒/宿敌/血仇

## Goal

在现有修仙模拟中引入角色间持久关系机制，让修仙者之间除战斗外能建立道友、师徒、宿敌、血仇等关系，产生有意义的机械效果和叙事事件。作为势力系统（03-20-faction-system）和后续交互系统的基础。

## Requirements

### 关系类型定义

#### 固定 Slot 关系（稀有/唯一）

**师徒关系**
- 存储: `mentor: id | null` + `disciples: id[]`（上限 3）
- 形成条件:
  - 师父境界 - 弟子境界 ≥ 2
  - 师父弟子数未满，弟子无师父
  - 双方在同一空间区域（相邻格子内）
  - 师父处于 settling 状态
  - 概率受师父 rootedness、弟子 ambition 调节
- 机械效果:
  - 弟子: 每年修炼 +0.3~0.5（受师父境界加成）
  - 师父: 教学相长，每弟子每年 +0.1 修为
  - 弟子行为状态倾向跟随师父位置
  - 同门弟子（共同师父）战斗意愿 -50%
- 解除条件:
  - 一方死亡 → 自动解除
  - 师父死亡 → 弟子获得 ambition boost，可能触发血仇
  - 弟子境界 ≥ 师父境界 → 自动"出师"，转为道友

#### Ring Buffer 关系（可积累/衰减）

**道友关系** `allies: Array<{id, strength, formedAt}>`（上限 6）
- 形成条件:
  - 境界差 ≤ 2
  - 空间相邻（encounter range 内）
  - 双方无宿敌/血仇关系
  - 非战斗相遇时，基于 courage 和 confidence 判定
- strength: 0.0 ~ 1.0，每次正面相遇 +0.1，每年自然衰减 -0.02
- 机械效果: **不硬编码行为规则**，仅作为 AI Policy 特征输入
  - rule-based fallback 中做轻量调节（战斗概率 -X%）
  - 是 Phase 2 资源交换/切磋的前置条件
- 淘汰: strength 衰减到 0 时移除，buffer 满时替换最弱的

**宿敌关系** `rivals: Array<{id, intensity, formedAt}>`（上限 4）
- 形成条件:
  - 与同一对手战斗 ≥ 3 次且双方存活（从 encounters ring buffer 统计）
  - 或: 对方曾击败自己导致重伤/降级
- intensity: 0.0 ~ 1.0，每次战斗 +0.2，每年衰减 -0.01（比道友衰减慢）
- 机械效果: **不硬编码行为规则**，仅作为 AI Policy 特征输入
  - rule-based fallback 中做轻量调节（战斗概率 +X%）
- 淘汰: 对方死亡时移除，intensity 衰减到 0 时移除

**血仇关系** `vendettas: Array<{targetId, reason, formedAt}>`（上限 2）
- 形成条件（自动触发，无概率判定）:
  - 对方杀死了自己的师父
  - 对方杀死了自己的弟子
  - 对方杀死了自己的高亲密道友
- reason: 'killed_mentor' | 'killed_disciple' | 'killed_close_ally'
- 不衰减（除非目标死亡）
- 机械效果: **不硬编码行为规则**，仅作为 AI Policy 特征输入
  - 关系数据暴露为神经网络特征（has_vendetta, vendetta_level_gap 等）
  - 由 AI Policy MLP 学习决策（战斗意愿、移动方向等）
  - rule-based fallback 中仅做轻量调节（如战斗概率 +X%）
- 解除: 目标死亡

#### 推导关系（不存储）

**同门关系**
- 判定: 两个角色的 mentor 相同 且 mentor !== null
- 效果: 战斗意愿 -50%（与亲缘识别类似）

### 相遇决策流程

相遇时的行为决策主要交给 AI Policy 神经网络，关系数据作为特征输入：

```
相遇判定（空间邻近）
  ├── 提取关系特征（道友/宿敌/血仇/师徒/同门/亲缘）
  ├── AI Policy MLP 输出行为决策（战斗/交互/忽略）
  ├── rule-based fallback（无 AI 权重时）:
  │     关系仅做轻量概率调节，不硬编码复杂逻辑
  └── 非战斗相遇 → 判定关系变化（形成/加深/衰减）
```

### AI Policy 特征扩展

在 `ai-state-extract.ts` 中新增关系特征:
- `has_mentor`: 是否有师父 (0/1)
- `disciple_count`: 弟子数量 (0-3, normalized)
- `ally_nearby`: 附近是否有道友 (0/1)
- `strongest_ally_strength`: 最强道友的 strength (0-1)
- `rival_nearby`: 附近是否有宿敌 (0/1)
- `max_rival_intensity`: 最强宿敌的 intensity (0-1)
- `has_vendetta`: 是否有血仇目标 (0/1)
- `vendetta_target_nearby`: 血仇目标是否在附近 (0/1)
- `is_fellow_disciple`: 对方是否同门 (0/1)

这些特征让神经网络学习关系对行为的影响，而非硬编码规则。

### 事件系统扩展

新增 RichEvent 类型:
- `RichRelationshipEvent`: 关系形成/解除/变化
  - subtype: 'mentor_accept' | 'graduate' | 'ally_formed' | 'rival_formed' | 'vendetta_declared' | 'vendetta_fulfilled'
  - actors: 关系双方
  - 新闻等级: 高境界师徒(A), 一般师徒(B), 血仇宣告(B), 复仇成功(A), 道友(C), 宿敌(C)

### 记忆系统扩展

在 CharacterMemory 中新增:
- `gratitude`: 感恩情感 [0,1]，被师父收徒/被道友救助时增加
- `grief`: 悲伤情感 [0,1]，关系者死亡时增加，衰减较慢
- 关系相关的 narrative milestones: firstMentorYear, firstAllyYear, vendettaDeclaredYear

## Acceptance Criteria

- [ ] 角色能形成师徒关系（固定 slot），弟子获得修炼加速
- [ ] 角色能积累道友关系（ring buffer + 衰减）
- [ ] 多次战斗自动产生宿敌关系
- [ ] 杀死关系者自动触发血仇
- [ ] 同门关系从师徒自动推导
- [ ] 关系数据作为 AI Policy 特征输入（ai-state-extract.ts 扩展）
- [ ] rule-based fallback 中关系仅做轻量战斗概率调节
- [ ] 新增 RichRelationshipEvent 事件类型，前端可展示
- [ ] 关系数据正确序列化/反序列化（存档兼容）
- [ ] 性能: tick 耗时增加 < 20%

## Definition of Done

- Tests added/updated
- Lint / typecheck / CI green
- 存档格式向后兼容（旧存档加载时关系字段为空）

## Out of Scope

- 道侣关系（需性别系统前置）
- 结拜关系（用高亲密道友代替）
- 供奉/附庸/主仆（属于势力系统）
- 宗门层级（外门/内门/真传）
- 资源交换/切磋机制（Phase 2）
- 合作任务（Phase 3）

## Technical Notes

- 战斗相遇逻辑: `src/engine/combat.ts` processEncounters()
- 空间索引: `src/engine/spatial.ts`
- 记忆系统: `src/engine/memory.ts`
- 行为评估: `src/engine/simulation.ts` evaluateBehaviorStates()
- 事件类型: `src/types.ts`
- 事件展示: `server/events.ts`
- 序列化: SimulationEngine.serialize() / deserialize()
- 关系数据需要加入序列化，并考虑与 AI Policy 特征提取的集成

# 角色记忆系统

## Goal

为修仙模拟中的每个角色植入完整的记忆系统，涵盖角色间记忆、地点记忆、经历驱动的性格演化、突破心理和叙事里程碑，使角色决策基于个人经历而非纯实时状态。

## Requirements

### A. 角色间记忆 (Inter-character Memory)

**A1. 战斗对手记忆**
- 环形缓冲记录最近 12 次战斗遭遇: `{ opponentId, outcome, yearDelta }`
- 再遇曾败之人 → 逃跑概率显著提升
- 再遇曾胜之人 → 更自信，愿意再战
- 多次交手同一人 → 宿敌效应 (累积查找 buffer 中出现次数)

**A2. 同乡记忆**
- 基于已有 `originSettlementId` 判定同乡
- 同乡相遇 → 战斗意愿降低
- 同乡被杀 → 记录凶手 ID 进入对手记忆 (outcome = 'kin_killed')

### B. 地点记忆 (Place Memory)

**B1. 危险地点**
- 受重伤时记录 cellIdx → 移动时避开

**B2. 福地记忆**
- 突破成功时记录 cellIdx → seeking_breakthrough 时优先向该地移动

**B3. 故乡归巢**
- escaping / recuperating 状态下，移动权重偏向 origin settlement 方向

### C. 经历 → 性格演化 (Emotional States + Decay)

每个情感值为 float，范围 [0, 1]（或 [-1, 1]），每 tick 向基线指数衰减。

**C1. 战斗自信 (confidence)** — 基线 = courage
- 战胜 → +delta，战败 → -delta
- 影响: wantsFight 判定中的勇气阈值

**C2. 谨慎程度 (caution)** — 基线 = 0
- 重伤 → +大，轻伤 → +小
- 影响: 更早进入 escaping，移动更偏向安全区

**C3. 修炼执念 (ambition)** — 基线 = 0.5
- 突破成功 → +，突破失败 → 取决于 courage
  - 高 courage: 失败 → +（不服输型）
  - 低 courage: 失败 → -（佛系型）
- 影响: seeking_breakthrough 时机

**C4. 戾气 (bloodlust)** — 基线 = 0
- 战斗获胜 + 击杀 → +大，仅获胜 → +小
- 长期修炼/闭关/settling → 衰减
- 影响: 高戾气主动移向高危区域

**C5. 安定感 (rootedness)** — 基线 = 0
- settling 状态每年 → +小
- 战斗/被迫流浪 → -
- 影响: settling 持续时长，wander 概率

### D. 突破心理

**D1. 突破恐惧 (breakthroughFear)** — 基线 = 0
- 连续突破失败 → 累积
- 突破成功 → 清零
- 影响: 即使修为充足也可能延迟尝试（"心魔"）
- 与 ambition 交互: 高 ambition 可抑制恐惧

### E. 叙事里程碑

**E1. 关键人生事件标记**
- 首次战斗年 (firstCombatYear)
- 首次受伤年 (firstInjuryYear)
- 首次突破年 (firstBreakthroughYear)
- 首次杀人年 (firstKillYear)
- 最惨失败 (worstDefeatYear + opponentId)
- 最辉煌胜利 (greatestVictoryYear + opponentId)
- 不影响决策，为 biography 系统提供素材

## Acceptance Criteria

- [ ] 每角色额外内存 ≤ 1KB (目标 ~250 bytes)
- [ ] 相同初始状态的角色因不同经历产生不同行为 (行为多样性)
- [ ] 角色记忆事件可反哺 biography 叙事 (叙事丰富性)
- [ ] 曾败于某人的角色再遇时逃跑概率可观测提升 (模拟真实性)
- [ ] 同乡相遇战斗概率可观测降低
- [ ] 突破失败累积后出现明显的犹豫行为
- [ ] 受伤角色倾向返回故乡方向
- [ ] 旧版快照 (v4) 可正常加载，记忆默认为空
- [ ] 记忆系统可通过 SimTuning 开关及参数调节
- [ ] 所有衰减率、增量、阈值可配置
- [ ] 现有测试不被破坏

## Definition of Done

- Tests added/updated (unit + integration)
- Lint / typecheck / CI green
- 旧版快照兼容性验证

## Technical Approach

### 数据结构

```typescript
interface CharacterMemory {
  // C. 情感状态 (6 × float64 = 48 bytes)
  confidence: number;       // 战斗自信, baseline = courage
  caution: number;          // 谨慎, baseline = 0
  ambition: number;         // 修炼执念, baseline = 0.5
  bloodlust: number;        // 戾气, baseline = 0
  rootedness: number;       // 安定感, baseline = 0
  breakthroughFear: number; // 突破恐惧, baseline = 0

  // A. 对手记忆环形缓冲 (12 entries)
  encounters: EncounterEntry[];
  encounterHead: number;

  // B. 地点记忆环形缓冲 (4 entries)
  places: PlaceEntry[];
  placeHead: number;

  // Accumulated stats (8 × uint16 = 16 bytes)
  combatWins: number;
  combatLosses: number;
  kills: number;
  breakthroughAttempts: number;
  breakthroughSuccesses: number;
  heavyInjuries: number;
  yearsSettled: number;
  timesDisplaced: number;

  // E. 叙事里程碑
  milestones: MilestoneMarkers;
}

interface EncounterEntry {
  opponentId: number;   // u32
  outcome: number;      // u8: 0=win, 1=loss, 2=fled, 3=kin_killed
  yearDelta: number;    // u16: year - birthYear (compact)
}

interface PlaceEntry {
  cellIdx: number;      // u16: y * MAP_SIZE + x
  type: number;         // u8: 0=danger, 1=breakthrough_success
  yearDelta: number;    // u16
}

interface MilestoneMarkers {
  firstCombatYear: number;
  firstInjuryYear: number;
  firstBreakthroughYear: number;
  firstKillYear: number;
  worstDefeat: { year: number; opponentId: number };
  greatestVictory: { year: number; opponentId: number };
}
```

### 存储方式

- `SimulationEngine` 新增 `memories: CharacterMemory[]`，与 `cultivators[]` 同索引
- `spawnCultivator` 时初始化空记忆
- slot 回收时重置记忆

### 记忆写入点

| 事件 | 写入位置 | 写入内容 |
|------|---------|---------|
| 战斗结算 | `resolveCombat()` | encounters buffer, confidence/caution/bloodlust, stats, milestones |
| 突破成功 | `tryBreakthrough()` | places buffer (福地), ambition, breakthroughFear=0, stats, milestones |
| 突破失败 | `tryBreakthrough()` | ambition, breakthroughFear, stats |
| 受伤 | `resolveCombat()` | places buffer (危险地点), caution |
| 每年 tick | `tickCultivators()` | 情感衰减, rootedness (if settling) |
| 同乡被杀 | `resolveCombat()` | encounters buffer (kin_killed) |

### 记忆消费点

| 决策环节 | 消费内容 | 效果 |
|---------|---------|------|
| `resolveCombat` 战斗意愿 | encounters (对手记忆), confidence, originSettlementId | 曾败逃跑↑, 同乡不打, 自信→敢战 |
| `evaluateBehaviorStates` | caution, ambition, breakthroughFear, rootedness | 影响状态转换阈值 |
| `moveCultivators` | places (危险/福地), originSettlementId, bloodlust | 影响移动权重 |

### 序列化

- `SNAPSHOT_VERSION` 升至 5
- 在 cultivator 数据后追加 memory block
- v4 反序列化: 所有记忆初始化为空/默认值

### 配置

SimTuning 新增 `memory` 分组:

```typescript
memory: {
  enabled: boolean;
  emotionalDecayRate: number;        // 每年衰减乘数, 如 0.95
  confidenceDelta: number;           // 战胜/败时的增量
  cautionHeavyInjuryDelta: number;
  cautionLightInjuryDelta: number;
  ambitionBreakthroughDelta: number;
  bloodlustKillDelta: number;
  bloodlustWinDelta: number;
  rootednessDelta: number;
  breakthroughFearDelta: number;
  encounterFleeThreshold: number;    // 对手记忆中有败绩时的额外逃跑概率
  kinCombatReduction: number;        // 同乡战斗意愿降低比例
  homingStrength: number;            // 故乡归巢权重
  dangerPlaceAvoidance: number;      // 危险地点回避权重
  powerSpotAttraction: number;       // 福地吸引权重
}
```

## Decision (ADR-lite)

**Context**: 角色行为完全基于实时状态 (12 维 Markov)，缺乏个人历史，导致行为单一、叙事贫乏。

**Decision**: 采用 "情感状态 + 衰减" 为核心，辅以环形缓冲对手/地点记忆和叙事里程碑的混合架构。不使用 LLM，纯数值系统。

**Consequences**:
- 每角色 ~250 bytes 额外内存，远低于 1KB 上限
- RL 状态向量需从 12 维扩展至 ~18 维，训练需重跑
- 序列化格式升至 v5，旧快照兼容
- 需大量调参确保记忆系统不破坏现有平衡

## Out of Scope

- LLM-per-tick 记忆检索
- 跨代记忆传承（师徒/血脉）
- 门派/势力层面的群体记忆
- 角色间主动社交互动（结盟/拜师）

## Implementation Plan

**PR1: 数据基础**
- `CharacterMemory` 类型定义
- `SimulationEngine.memories[]` 存储
- 工厂函数 `createEmptyMemory()` + `resetMemory()`
- `spawnCultivator` 初始化记忆
- 序列化/反序列化 (v5)
- `SimTuning.memory` 配置
- 单元测试: 数据结构、序列化往返

**PR2: 情感状态 + 衰减 + 累积统计**
- 每年 tick 中的衰减逻辑
- 战斗 → confidence/caution/bloodlust 更新
- 突破 → ambition/breakthroughFear 更新
- settling → rootedness 更新
- 累积统计计数
- 单元测试: 衰减曲线、事件触发

**PR3: 角色间记忆 + 战斗行为**
- 对手记忆环形缓冲写入/查询
- 同乡识别 → 战斗意愿修改
- 对手记忆 → 逃跑/自信修改
- 同乡被杀 → 仇人记录
- `resolveCombat` 中的 wantsFight 逻辑重构
- 单元测试: 逃跑概率、同乡效果

**PR4: 地点记忆 + 移动行为**
- 地点记忆环形缓冲写入/查询
- 危险地点回避 → `moveCultivators` 权重
- 福地吸引 → seeking_breakthrough 移动权重
- 故乡归巢 → escaping/recuperating 移动偏向
- 戾气 → 向高危区域移动
- 单元测试: 移动倾向验证

**PR5: 突破心理 + 行为决策**
- breakthroughFear 影响突破时机
- 情感状态 → `evaluateBehaviorStates` 阈值修改
- caution/ambition/rootedness 对状态转换的影响
- RL 状态向量扩展 (extractState 增加记忆维度)
- 单元测试: 行为分叉验证

**PR6: 叙事里程碑 + Biography 联动**
- MilestoneMarkers 写入逻辑
- biography 系统消费里程碑数据
- EngineHooks 扩展记忆相关回调
- 集成测试

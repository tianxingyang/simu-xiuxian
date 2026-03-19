# 优化日报 LLM 数据丰富度

## Goal

丰富喂给 LLM 生成日报的上下文数据，通过事件级嵌入 + gateway 中继世界快照两条路径，让日报内容更具世界观沉浸感。

## Requirements

### A. 事件级嵌入 (RichEvent 扩展)

在引擎创建 RichEvent 时嵌入以下字段：

1. **behaviorState** — 修士当时的行为状态 (escaping/recuperating/seeking_breakthrough/settling/wandering)
   - combat: winner + loser 双方
   - promotion / breakthrough_fail / tribulation / expiry: subject
2. **spiritualEnergy** — 事发地点灵气浓度 (1-5)
3. **terrainDanger** — 事发地点地势险要度 (1-5)
4. **age** — 修士年龄 (combat 的 winner/loser，promotion 的 subject，目前缺失)

### B. 世界快照注入 (sim→gateway→llm IPC)

新增 WorldContext 通信机制：

1. **IPC 扩展**
   - 新增 `sim:getWorldContext` 命令 → sim-worker 返回 WorldContext
   - `job:report` 命令扩展，附带可选 `worldContext` 字段

2. **WorldContext 数据结构**
   ```ts
   interface WorldContext {
     population: number;
     levelCounts: number[];          // 各境界人数
     regionProfiles: {               // 各区域画像
       name: string;
       population: number;
       avgSpiritualEnergy: number;   // 1-5
       avgTerrainDanger: number;     // 1-5
     }[];
     behaviorDistribution: Record<BehaviorState, number>; // 各状态修士数量
   }
   ```

3. **数据流**
   - 报告请求 → Gateway 先向 sim-worker 发 `sim:getWorldContext`
   - sim-worker 从 Runner/Engine 聚合数据并返回
   - Gateway 将 WorldContext 附加到 `job:report` 发给 llm-worker
   - reporter.ts `generateReport` 接收 WorldContext
   - `buildPrompt` 将 WorldContext 注入 LLM prompt

### C. Reporter Prompt 增强

1. `formatEventForPrompt` 输出新字段 (behaviorState → 中文映射, spiritualEnergy, terrainDanger, age)
2. `buildPrompt` 新增 `world_context` 区域：region_profiles, population, level_distribution, behavior_distribution
3. SYSTEM_MESSAGE 提示 LLM 利用世界背景数据

## Acceptance Criteria

- [ ] RichEvent 各子类型包含 behaviorState / spiritualEnergy / terrainDanger
- [ ] combat/promotion 事件包含 age 字段
- [ ] sim:getWorldContext IPC 工作正常
- [ ] 日报 prompt 中包含 world_context 区域
- [ ] 日报 prompt 中 S 级事件附带修士行为状态的中文描述
- [ ] 日报 prompt 中事件附带灵气/地势信息
- [ ] TypeScript 编译通过 (npm run build)

## Out of Scope

- 修改 LLM 模型或温度参数
- 修改日报输出字数限制
- 前端 UI 变更
- biography 生成的修改

## Technical Notes

### 关键文件改动清单

| 文件 | 改动 |
|------|------|
| `src/types.ts` | RichEvent 子类型加可选字段 |
| `src/engine/simulation.ts` | 事件创建处填充新字段；新增 getWorldContext() |
| `src/engine/combat.ts` | combat 事件创建处填充新字段 |
| `server/ipc.ts` | WorldContext 类型 + sim:getWorldContext + job:report 扩展 |
| `server/runner.ts` | 新增 getWorldContext() 聚合方法 |
| `server/processes/sim-worker.ts` | 响应 sim:getWorldContext |
| `server/processes/llm-worker.ts` | 接收并传递 WorldContext |
| `server/index.ts` | report 时先从 sim 拿 context 再发给 llm |
| `server/reporter.ts` | buildPrompt / formatEventForPrompt 使用新数据 |

### 行为状态中文映射

| State | 中文 |
|-------|------|
| escaping | 逃窜中 |
| recuperating | 疗伤中 |
| seeking_breakthrough | 寻求突破中 |
| settling | 定居修炼中 |
| wandering | 云游中 |

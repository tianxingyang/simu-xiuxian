# Tasks: 修仙世界模拟器

## T1: 项目脚手架
- [x] `npm create vite@latest . -- --template react-ts`
- [x] 安装依赖：`recharts`
- [x] 配置 `tsconfig.json` 启用 Web Worker 类型支持
- [x] 清理 Vite 模板默认文件，建立 `src/` 目录结构

**产出**: 可运行的空白 React + TS 项目

## T2: 核心类型与常量
- [x] `src/types.ts`: 定义 `Cultivator`(含 alive 字段、cultivation 为 float), `YearSummary`, `SimEvent`, `ToWorker`(含 reset/seed/initialPop), `FromWorker`(含 paused reason/reset-done)
- [x] `src/constants.ts`: 境界名称数组、`threshold(level)` = `10^(level+1)`, `lifespanBonus(level)`, `YEARLY_NEW = 1000`(默认), `ABSORB_RATE = 0.1`, `MAX_EVENTS = 1000`, `MAX_TREND_POINTS = 10000`, `EVENTS_PER_TICK = 50`

**产出**: 全部类型定义和游戏参数常量

## T3: 种子 PRNG
- [x] `src/engine/prng.ts`: 实现 Mulberry32 算法，返回 [0, 1) 浮点数
- [x] 导出 `createPRNG(seed: number): () => number`
- [x] 辅助函数: `prngInt(prng, min, max)`, `prngShuffle(prng, array)`

**产出**: 可复现的随机数生成器

## T4: 模拟引擎 — 核心类
- [x] `src/engine/simulation.ts`: `SimulationEngine` 类
  - 构造函数接收 `seed` 和 `initialPopCount`
  - 维护 `cultivators: Map<number, Cultivator>`, `levelGroups: Map<number, Set<number>>`, `nextId: number`
  - `spawnCultivators(count)`: 批量创建 Lv1 修士 (age=20, cultivation=10, courage=prng() [0,1))
  - `naturalCultivation()`: 全体 cultivation += 1, age += 1
  - `checkPromotions()`: 遍历检查晋升条件 (cultivation >= threshold)，支持连续多级晋升，立即更新 maxAge
  - `removeExpired()`: 移除 age >= maxAge 的修士
  - `getSummary()`: 生成 YearSummary
  - `reset(seed, initialPop)`: 重置全部状态至 Year 0
  - `resetYearCounters()`: 重置每年计数器 (combatDeaths/expiryDeaths/promotionCounts/spawned)
  - `purgeDead()`: 从 Map 中清除已死亡修士，释放内存

**产出**: 除遭遇/战斗外的完整生命周期管理

## T5: 模拟引擎 — 遭遇与战斗
- [x] `src/engine/combat.ts`:
  - `processEncounters(engine)`: 阶段开始时快照 Nk/N；用 PRNG shuffle 全部存活修士；遍历触发遭遇
  - `resolveCombat(a, b, prng)`: courage > defeatRate 严格大于判定战斗意愿; 败者 alive=false; 胜者 += round1(败者修为 × 0.1); 立即检查胜者晋升
  - 已死亡修士（alive=false）跳过或取消遭遇
  - 无有效对手（同级仅剩自己）跳过
- [x] 事件收集：每 tick 最多 50 条 SimEvent，Lv3+ 事件优先

**产出**: 完整的遭遇-决策-战斗-吸收流水线

## T6: 模拟引擎 — 年度循环与 Worker
- [x] `SimulationEngine.tickYear()`: 按 spawn → natural → encounters → promotionCheck → expiry → summary 顺序
- [x] `src/engine/worker.ts`: Web Worker 入口
  - 接收 ToWorker: start(speed,seed,initialPop) / pause / step / setSpeed / reset
  - start: 按速度档位批量计算 (Tier1=100年/Tier2=500年/Tier3=1000年 per batch)，每批 ~2 秒后 postMessage 聚合结果
  - step: 单次 tickYear()
  - pause: 停止循环
  - reset: 重建引擎，postMessage reset-done
  - 终止条件：人口归零时自动 pause，reason='extinction'

**产出**: 独立线程运行的模拟引擎，批量计算 + 消息协议通信

## T7: useSimulation Hook
- [x] `src/hooks/useSimulation.ts`:
  - 创建并管理 Worker 生命周期
  - 暴露 `start(seed, initialPop)`, `pause()`, `step()`, `setSpeed(tier)`, `reset(seed, initialPop)` 控制方法
  - 维护 `yearSummary`, `events`(ring buffer cap=1000), `trendData`(cap=10000, 超出时降采样)
  - 维护 `isRunning`, `isPaused`, `extinctionNotice` 状态
  - 返回供组件消费的响应式数据

**产出**: React 与 Worker 之间的桥接层

## T8: 仪表盘布局与控制栏
- [x] `src/App.tsx`: 引入 useSimulation，传递数据到子组件
- [x] `src/components/Dashboard.tsx`: CSS Grid 四象限布局
- [x] `src/components/Controls.tsx`: 开始/暂停/单步/重置 按钮 + 三档速度选择器 + 年份显示 + 种子显示 + 初始人口输入（仅暂停/未开始时可编辑）
- [x] `src/index.css`: 全局样式，暗色主题

**产出**: 可交互的仪表盘骨架（含种子/初始人口配置）

## T9: 数据可视化面板
- [x] `src/components/LevelChart.tsx`: Recharts BarChart，Lv1~Lv7 人数分布，线性/对数刻度切换
- [x] `src/components/TrendChart.tsx`: Recharts LineChart，7 条线各境界人口趋势
- [x] `src/components/EventLog.tsx`: 滚动事件列表（最新在顶部），按境界筛选，颜色区分事件类型
- [x] `src/components/StatsPanel.tsx`: 总人口、新增、死亡(战斗+寿尽)、晋升、最高境界修士信息

**产出**: 完整的四面板数据展示

## T10: 集成联调
- [x] 连接所有组件，端到端验证数据流：Worker → Hook → Components
- [x] 验证模拟正确性：Lv1 修士稳态人数、Lv2+ 修士能自然涌现、寿元计算无溢出
- [x] 验证性能：稳态数万修士下各速度档位流畅运行
- [x] 边界情况：同级仅剩 1 人无法遭遇、Lv7 不再晋升、连续多级晋升、人口归零自动暂停、重置功能
- [x] 验证种子复现性：同种子同配置两次运行结果完全一致

**产出**: 功能完整、数值正确、可复现的模拟器

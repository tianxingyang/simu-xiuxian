## 1. 项目基础设施

- [x] 1.1 新增后端依赖到 `package.json`：`ws`、`better-sqlite3`、`node-cron`；devDeps：`tsx`、`tsup`、`@types/ws`、`@types/better-sqlite3`
- [x] 1.2 创建 `server/tsconfig.json`（target ES2022, module NodeNext, 引用 `src/engine/` 和 `src/types.ts`、`src/constants.ts`）
- [x] 1.3 在 `package.json` 中新增 scripts：`"server:dev": "tsx server/index.ts"`、`"server:build": "tsup server/index.ts"`
- [x] 1.4 创建 `server/config.ts`：从环境变量读取 PORT、DEEPSEEK_API_KEY、ONEBOT_HTTP_URL、QQ_GROUP_ID、REPORT_CRON 等配置

## 2. 数据库层

- [x] 2.1 创建 `server/db.ts`：初始化 SQLite 数据库（better-sqlite3, WAL mode），建表 `named_cultivators`、`events`、`events` 索引（real_ts, rank）、`daily_reports`、`sim_state`
- [x] 2.2 实现 DB 操作函数：`insertEvents(events[])`、`insertNamedCultivator(data)`、`updateNamedCultivators(data[])`、`queryEventsByDateRange(from, to)`、`queryNamedCultivator(id)`、`upsertDailyReport(...)`、`getSimState()`、`setSimState()`

## 3. 身份系统

- [x] 3.1 创建 `server/identity.ts`：姓氏池（50+ 单姓 + 10+ 复姓）+ 名字用字池（80+ 修仙风味单字）
- [x] 3.2 实现 `generateName(prng): string` — 姓(1-2字)+名(1-2字)，PRNG 驱动，Set 去重保证唯一
- [x] 3.3 实现 `IdentityManager` 类：管理内存中活跃 `NamedCultivator` Map，提供 `onPromotion(cultivator, year)` → 首次 Lv2 时命名、`onCombatResult(winner, loser, outcome, year)` → 更新履历、`onExpiry(cultivator, year)` → 记录死因、`flushToDB()` → 批量写入变更
- [x] 3.4 在 `NamedCultivator` 死亡时从内存 Map 移除，写入最终状态到 DB

## 4. 结构化事件系统

- [x] 4.1 在 `src/types.ts` 中新增 `RichEvent` 联合类型定义（combat / promotion / expiry / milestone 四个变体，各含 newsRank 字段）
- [x] 4.2 创建 `server/events.ts`：实现 `scoreNewsRank(event): 'S'|'A'|'B'|'C'` 评分函数（按 spec 中 S/A/B/C 条件判定）
- [x] 4.3 实现里程碑检测状态：`MilestoneTracker` 类，维护 `highestLevelEverReached`、`levelEverPopulated[]`，提供 `checkPromotion(level)` 和 `checkDeath(level, groupSize)` 方法，返回 milestone RichEvent 或 null
- [x] 4.4 实现 `toDisplayEvent(e: RichEvent): SimEvent` 转换函数，将 RichEvent 转为前端兼容的扁平 SimEvent 格式

## 5. 引擎事件集成

- [x] 5.1 修改 `src/engine/combat.ts`：`resolveCombat` 产出 `RichEvent`（替代现有 highBuf/lowBuf stride-4 编码），包含 winner/loser 完整信息
- [x] 5.2 修改 `src/engine/simulation.ts`：`checkPromotions` 产出 promotion `RichEvent`，`removeExpired` 产出 expiry `RichEvent`
- [x] 5.3 修改 `tickYear` 返回类型：`events` 改为 `RichEvent[]`（始终收集，不再有 `collectEvents` 开关）
- [x] 5.4 在 combat/promotion 代码路径中调用 `IdentityManager` 的 hook 方法（onPromotion / onCombatResult / onExpiry）

## 6. 引擎运行器 + HTTP/WebSocket 服务

- [x] 6.1 创建 `server/runner.ts`：封装 `SimulationEngine` 生命周期，用 setTimeout 调度批量循环（复用 worker.ts 的 BATCH_SIZES / TARGET_INTERVAL 逻辑），每 tick 调用 IdentityManager 和事件收集
- [x] 6.2 Runner 每批结束后：调用 `IdentityManager.flushToDB()`，批量 INSERT rank ≤ B 的事件到 DB，调用 `toDisplayEvent` 生成显示事件发给前端
- [x] 6.3 Runner 实现无客户端时自动 ack 逻辑（检查 WebSocket 连接数，0 则跳过等待）
- [x] 6.4 创建 `server/index.ts`：启动 HTTP server（原生 `http` 模块），提供 `/health` 和 `POST /api/report` 端点
- [x] 6.5 实现 WebSocket server（ws 库）：监听 `/ws` 路径，处理 upgrade，连接时推送 `{ type: 'state' }` 消息
- [x] 6.6 实现 WebSocket 命令分发：接收 start/pause/step/setSpeed/reset/ack 消息，转发给 runner
- [x] 6.7 实现 tick/paused/reset-done 消息广播到所有已连接客户端
- [x] 6.8 实现 sim_state 持久化：每批结束写入当前年份和状态，启动时读取恢复

## 7. 日报生成管线

- [ ] 7.1 创建 `server/reporter.ts`：实现 `aggregateEvents(from, to)` — 查询 events 表，S/A 级完整展开（查询关联修士履历），B 级聚合为统计
- [ ] 7.2 实现 `buildPrompt(aggregated)` — 组装 system message（修仙史官角色设定 + 格式要求 + 800 字限制）和 user message（JSON 素材），A 级事件超 15 个时按境界排序截断
- [ ] 7.3 实现 `callDeepSeek(prompt)` — HTTP 调用 DeepSeek Chat Completions API（model: deepseek-chat, temperature: 0.7, max_tokens: 2000），处理成功/失败/key 缺失
- [ ] 7.4 实现 `generateDailyReport()` 完整流程：聚合 → 构建 prompt → 调用 LLM → 存储到 daily_reports 表 → 推送
- [ ] 7.5 在 `server/index.ts` 中注册 node-cron 定时任务（默认 08:00 UTC+8），调用 `generateDailyReport()`
- [ ] 7.6 `POST /api/report` 端点实现：调用 `generateDailyReport()`，返回 reportId，并发保护（busy 状态）

## 8. QQ Bot 推送

- [ ] 8.1 创建 `server/bot.ts`：实现 `pushToQQ(text)` — HTTP POST 调用 OneBot v11 `send_group_msg` 接口
- [ ] 8.2 处理推送失败（OneBot 不可用、配置缺失）：记录错误日志，不影响日报生成和存储

## 9. 前端改造

- [ ] 9.1 修改 `src/hooks/useSimulation.ts`：将 Worker 实例替换为 WebSocket 连接（`new WebSocket(url)`），`postMessage` → `ws.send(JSON.stringify)`，`onmessage` → `ws.onmessage` + `JSON.parse`
- [ ] 9.2 新增 `state` 消息处理：收到后初始化 yearSummary、isRunning、isPaused
- [ ] 9.3 实现断线重连：指数退避（1s → 2s → 4s → ... → 30s 上限），重连成功后通过 state 消息恢复状态
- [ ] 9.4 暴露 `connectionStatus` 状态（connected / connecting / disconnected），在 `src/components/Controls.tsx` 中展示连接状态指示
- [ ] 9.5 移除 `src/engine/worker.ts`（Web Worker 入口不再使用）

## 10. 集成验证

- [ ] 10.1 端到端验证：启动后端 → 前端连接 → 控制按钮（start/pause/step/reset/setSpeed）功能正常 → 仪表盘数据实时更新
- [ ] 10.2 验证事件持久化：运行一段时间后查询 SQLite events 表，确认有 S/A/B 级事件，无 C 级事件
- [ ] 10.3 验证身份系统：查询 named_cultivators 表，确认 Lv2+ 修士有姓名和履历
- [ ] 10.4 验证日报生成：手动触发 `POST /api/report`，确认日报文本生成并存储
- [ ] 10.5 验证 QQ 推送：配置 OneBot 后触发日报，确认 QQ 群收到消息

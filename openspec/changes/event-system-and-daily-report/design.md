## Context

当前项目是纯前端 SPA（React + Vite + TypeScript），模拟引擎运行在 Web Worker 中，通过 postMessage 传递 `ToWorker`/`FromWorker` 消息。事件系统产生扁平的 `SimEvent { type, actorLevel, detail: string }`，每 tick 上限 50 条，仅供前端 EventLog 组件渲染。

本次改造需要将项目从"纯前端 SPA"演进为"前端 + 后端服务"架构，支撑修士身份追踪、事件持久化、日报生成、QQ 推送等能力。

## Goals / Non-Goals

**Goals:**

- 模拟引擎在 Node.js 后端持续运行，前端通过 WebSocket 保留实时仪表盘 + 控制能力
- Lv2+ 修士获得修仙风格姓名和个体履历追踪
- 事件系统产出结构化、带身份、带新闻价值评分的事件，持久化到 SQLite
- 每现实天定时聚合事件，经 DeepSeek 润色后通过 QQ 机器人推送"修仙世界日报"

**Non-Goals:**

- 门派/势力系统
- 日报的 Web UI 展示
- 多实例/多用户支持
- 模拟规则调整（如 exponential-death-curve，独立变更）

## Decisions

### 1. 项目结构：同仓库平铺，不做 monorepo

```
simu-xiuxian/
├── src/
│   ├── engine/          # 共享引擎（simulation.ts, combat.ts, prng.ts）
│   ├── components/      # React 前端组件
│   ├── hooks/           # useSimulation → 改为 WebSocket
│   ├── types.ts         # 共享类型
│   └── constants.ts     # 共享常量
├── server/
│   ├── index.ts         # 入口：HTTP + WebSocket server
│   ├── runner.ts        # 引擎运行器（替代 worker.ts 的循环逻辑）
│   ├── identity.ts      # 姓名生成 + 身份管理
│   ├── events.ts        # 事件收集 + 价值评分
│   ├── db.ts            # SQLite 数据层
│   ├── reporter.ts      # 日报聚合 + Prompt 构建 + DeepSeek 调用
│   └── bot.ts           # QQ Bot（OneBot v11 HTTP API）
├── server/tsconfig.json # 后端独立 TS 配置
├── package.json
└── vite.config.ts
```

**替代方案**：monorepo（packages/engine + packages/server + packages/web）。不采用，因为项目规模小，共享代码量少（仅 engine/ + types + constants），monorepo 的工具链开销不值得。

**引擎共享方式**：后端通过相对路径直接 import `src/engine/`。引擎代码（simulation.ts, combat.ts, prng.ts）无浏览器依赖，可直接在 Node.js 运行。`worker.ts` 是浏览器专属入口，后端不使用，用 `server/runner.ts` 替代。

### 2. 后端运行时：tsx 直接执行

开发期用 `tsx server/index.ts` 直接运行 TypeScript。生产部署可加 `tsup` 编译为 JS。

新增依赖：

| 包 | 用途 |
|---|---|
| `ws` | WebSocket server |
| `better-sqlite3` | SQLite |
| `node-cron` | 定时任务 |
| `tsx` | TS 直接执行（devDep） |
| `tsup` | 后端构建（devDep） |

HTTP 服务器用 Node.js 原生 `http` 模块，仅需提供 WebSocket upgrade 和少量 REST 端点（如手动触发日报），无需 Express/Fastify。

### 3. WebSocket 协议：复用现有消息格式

现有 `ToWorker`/`FromWorker` 协议直接映射到 WebSocket：

```
前端                        后端
  │                           │
  │── { type: 'start', ... } ──▶  开始/继续模拟
  │── { type: 'pause' } ──────▶  暂停
  │── { type: 'step' } ───────▶  单步
  │── { type: 'setSpeed', speed } ▶ 切换倍速
  │── { type: 'reset', ... } ──▶  重置
  │── { type: 'ack' } ─────────▶  确认收到 tick
  │                           │
  │◀── { type: 'tick', summaries, events } ── 批量数据
  │◀── { type: 'paused', reason } ─────────── 暂停通知
  │◀── { type: 'reset-done' } ────────────── 重置完成
```

前端 `useSimulation` hook 改造：`Worker.postMessage` → `ws.send(JSON.stringify)`，`worker.onmessage` → `ws.onmessage`。rAF 缓冲和 ACK 背压机制保持不变。

新增一条服务端主动消息 `{ type: 'state', ... }` 用于客户端连接时同步当前模拟状态（年份、运行中/暂停、速度档位）。

### 4. 引擎运行器：与 worker.ts 同构

`server/runner.ts` 替代 `worker.ts` 的职责——管理引擎生命周期和批量循环：

- 用 `setTimeout` 替代 Worker 的消息循环
- 保留 BATCH_SIZES、TARGET_INTERVAL、ACK 背压机制
- 区别：**每个 tick 都收集事件**（现有 worker 只收集 batch 最后一个 tick 的事件）
- 显示用事件（发给前端）仍做采样（每 batch 末尾 tick，上限 50）
- 持久化用事件（写 DB）收集全量，但只写入达到最低价值阈值（≥ B 级）的事件

### 5. 身份系统

**命名时机**：修士晋升到 Lv2（结丹）时触发。此前匿名，此后有名。

**姓名生成器**（`server/identity.ts`）：
- 姓氏池：~50 个常见 + 10 个复姓
- 名字用字池：~80 个修仙风味单字
- 组合规则：姓(1-2字) + 名(1-2字)，PRNG 驱动，保证同一 seed 可复现
- 唯一性：用 Set 去重，碰撞时重新生成

**履历追踪**：命名后在内存中维护 `NamedCultivator` 对象，引擎每次战斗/晋升/死亡时更新：

```ts
interface NamedCultivator {
  id: number;
  name: string;
  namedAtYear: number;     // 命名年份（= 结丹年份）
  killCount: number;
  combatWins: number;
  combatLosses: number;
  promotionYears: number[];  // 每次晋升的年份
  peakLevel: number;
  peakCultivation: number;
  deathYear?: number;
  deathCause?: 'combat' | 'expiry';
  killedBy?: string;         // 击杀者姓名（如有）
}
```

**生命周期**：
- 晋升 Lv2 → 创建 `NamedCultivator`，分配姓名，写入 DB
- 每次战斗/晋升 → 更新内存对象，定期批量刷入 DB
- 死亡 → 记录死因，从内存活跃表移除（DB 保留）

### 6. 事件系统重构

**弃用现有的 `SimEvent`**（扁平 detail 字符串），改为带类型判别的结构化事件：

```ts
type RichEvent =
  | {
      type: 'combat';
      year: number;
      level: number;
      winner: { id: number; name?: string; cultivation: number };
      loser: { id: number; name?: string; cultivation: number };
      absorbed: number;
      outcome: 'death' | 'demotion' | 'injury' | 'cult_loss';
      newsRank: 'S' | 'A' | 'B' | 'C';
    }
  | {
      type: 'promotion';
      year: number;
      subject: { id: number; name?: string };
      fromLevel: number;
      toLevel: number;
      cause: 'natural' | 'combat';
      newsRank: 'S' | 'A' | 'B' | 'C';
    }
  | {
      type: 'expiry';
      year: number;
      subject: { id: number; name?: string; age: number };
      level: number;
      newsRank: 'S' | 'A' | 'B' | 'C';
    }
  | {
      type: 'milestone';
      year: number;
      kind: 'first_at_level' | 'last_at_level' | 'population_milestone';
      detail: Record<string, unknown>;
      newsRank: 'S';
    };
```

**新闻价值评分逻辑**（`server/events.ts`）：

| 评分 | 条件 |
|------|------|
| S | `milestone` 类事件（首位达到某境界、某境界末位陨落）；Lv6+ 修士死亡 |
| A | Lv4+ 战斗；以弱胜强（修为差距 > 50% 的一方获胜）；跨 2 级以上晋升；Lv4+ 知名修士死亡 |
| B | Lv2-3 晋升；Lv3 战斗；Lv2-3 知名修士死亡 |
| C | Lv0-1 所有事件；Lv2 普通战斗 |

**里程碑检测**：runner 维护一个 `highestLevelEverReached` 数组，每次晋升时对比检测"首位"事件。每个 level group 人数降为 0 时检测"末位"事件。

**前端兼容**：`RichEvent` 发送给前端前，用一个 `toDisplayEvent(e: RichEvent): SimEvent` 函数转为现有的扁平格式，前端 EventLog 组件无需改动。后续迭代可让前端直接消费 RichEvent 以展示更丰富的信息。

### 7. 数据库 Schema（SQLite）

```sql
CREATE TABLE named_cultivators (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  named_at  INTEGER NOT NULL,  -- 命名时的模拟年份
  data      TEXT NOT NULL       -- JSON: NamedCultivator 完整数据
);

CREATE TABLE events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  year      INTEGER NOT NULL,
  real_ts   INTEGER NOT NULL,  -- Unix timestamp（用于按现实天聚合）
  type      TEXT NOT NULL,
  rank      TEXT NOT NULL,     -- S/A/B/C
  payload   TEXT NOT NULL      -- JSON: RichEvent
);
CREATE INDEX idx_events_ts ON events(real_ts);
CREATE INDEX idx_events_rank ON events(rank);

CREATE TABLE daily_reports (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL UNIQUE,  -- YYYY-MM-DD
  year_from INTEGER NOT NULL,
  year_to   INTEGER NOT NULL,
  prompt    TEXT NOT NULL,      -- 发送给 LLM 的完整 prompt
  report    TEXT NOT NULL,      -- LLM 生成的日报文本
  created   INTEGER NOT NULL
);

CREATE TABLE sim_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 存储：current_year, seed, running, speed, highest_levels 等
```

事件只持久化 rank ≤ B 的（C 级丢弃）。`real_ts` 用于日报聚合时按现实天筛选。

### 8. 日报生成管线

**触发**：`node-cron` 每天定时（如 08:00）触发，也支持 HTTP 端点手动触发。

**聚合流程**（`server/reporter.ts`）：

1. 查询 events 表中 `real_ts` 在前一天 00:00 ~ 23:59:59 的所有事件
2. 按 rank 分组：S 级 + A 级完整展开，B 级聚合为统计数字
3. 对 S/A 级事件中出现的 named_cultivators，查询其完整履历作为 bio 补充
4. 构建结构化 JSON 素材（见 proposal 中的 Prompt 素材结构）
5. 组装 DeepSeek prompt：system prompt（角色设定 + 格式要求）+ user prompt（JSON 素材）
6. 调用 DeepSeek API（HTTP，`/v1/chat/completions`）
7. 存储结果到 daily_reports 表
8. 推送到 QQ Bot

**DeepSeek System Prompt 设计要点**：
- 角色：修仙世界的史官/记者
- 格式：日报体裁，含头条、要闻、简讯、统计栏
- 约束：不得编造素材中没有的事件，可以润色措辞和增加修仙氛围描写
- 长度：控制在 QQ 消息的合理阅读长度内（~800 字）

### 9. QQ Bot 集成

使用 OneBot v11 HTTP API（NapCat / LLOneBot 等实现）。仅需一个 HTTP POST 调用发送群消息：

```
POST http://<onebot-host>:port/send_group_msg
{ "group_id": <群号>, "message": <日报文本> }
```

配置项（环境变量或配置文件）：
- `ONEBOT_HTTP_URL`：OneBot HTTP API 地址
- `QQ_GROUP_ID`：推送目标群号
- `DEEPSEEK_API_KEY`：DeepSeek API Key

### 10. 前端改造范围

改动集中在 `useSimulation` hook：

| 原始 | 改为 |
|------|------|
| `new Worker(...)` | `new WebSocket(url)` |
| `worker.postMessage(msg)` | `ws.send(JSON.stringify(msg))` |
| `worker.onmessage` | `ws.onmessage` + `JSON.parse` |
| `worker.terminate()` | `ws.close()` |
| 组件挂载时创建 Worker | 组件挂载时连接 WebSocket，支持断线重连 |

新增连接状态指示（connected / connecting / disconnected），在 Controls 组件中展示。

其余组件（Dashboard, LevelChart, TrendChart, EventLog, StatsPanel）**不改动**。

## Risks / Trade-offs

**引擎性能差异** — Web Worker 中引擎独占线程，Node.js 中引擎运行在主线程（单线程）。WebSocket I/O 和 DB 写入可能与引擎循环竞争。→ 缓解：DB 写入用批量 INSERT（每 batch 一次而非每 tick），WebSocket 消息量与现有 Worker 相同。如果成为瓶颈，后续可用 `worker_threads` 隔离引擎。

**全量事件收集的开销** — 现有 Worker 只收集每 batch 最后一个 tick 的事件（其余 tick 的 collectEvents=false）。后端需要每个 tick 都收集以确保不遗漏重要事件。→ 缓解：combat.ts 的 highBuf/lowBuf 机制已有效控制单 tick 事件量，每 tick 额外开销主要在 materialize 阶段，可控。

**SQLite 并发** — 单写者模型，日报生成的聚合查询会与引擎写入竞争。→ 缓解：SQLite WAL 模式支持读写并发，日报生成频率低（每天一次），不构成实际问题。

**DeepSeek API 不可用** — 网络异常或 API 限流。→ 缓解：日报生成失败时记录错误，保留原始素材，支持手动重试。

**QQ Bot 依赖外部进程** — NapCat/LLOneBot 需要独立部署运行。→ 缓解：bot.ts 仅做 HTTP 调用，不直接依赖 Bot 进程。Bot 不可用时日报仍然生成并存储，推送失败会记录。

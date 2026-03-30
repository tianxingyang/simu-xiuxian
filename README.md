<h1 align="center">修仙世界模拟器</h1>

<p align="center">
  <b>Cultivation World Simulator</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-6-purple?logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/Node.js-backend-green?logo=nodedotjs" alt="Node.js">
  <img src="https://img.shields.io/badge/SQLite-storage-blue?logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-Apache_2.0-green" alt="License">
</p>

---

一个修仙世界演化模拟器。模拟修仙者在 32×32 环面地图上的修炼、突破、战斗与陨落，实时可视化种群动态与境界分布。后端以多进程架构（Gateway + 模拟引擎子进程 + LLM 子进程）持续运行，通过 WebSocket 将实时数据推送至前端仪表盘与 TUI 控制台，并按需聚合事件经 LLM 润色后生成"修仙世界日报"，通过 OneBot v11 协议推送至 QQ 群聊。支持查询具名修士传记，记忆细节随时间按艾宾浩斯遗忘曲线衰减。

## Features

### 境界体系

炼气 → 筑基 → 结丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘，八大境界（Lv0–Lv7）逐级突破。Lv0→Lv1 修为达标自动升级；Lv1+ 需通过**突破概率门**判定，突破概率随境界升高而递减，失败触发冷却期并可能附带修为损失或受伤惩罚。

### 渡劫与飞升

大乘（Lv7）修士在该境界停留越久，触发**天劫**的概率越高（Sigmoid 曲线）。渡劫结果：
- **飞升** — 永久脱离世界，被世人铭记
- **陨落** — 渡劫失败身死，自动评为 S 级头条新闻

### 空间系统

修士分布在 32×32 环面网格地图上，战斗匹配从全局同境界池改为**空间邻域匹配**——遭遇半径随境界递增（Lv0=2 至 Lv7=16）。修士具备随机游走行为，战败后逃窜、突破后位移，高境界修士活动范围更大。

### 地域系统

32×32 地图划分为 11 个命名区域：朔北冻原、苍茫草海、西嶂高原、天断山脉、河洛中野、东陵林海、赤岚丘陵、南淮泽国、裂潮海岸、潮生群岛、外海。事件记录中携带地域信息，增强叙事沉浸感。

### 地块标记系统

基于 Perlin 风格平滑噪声生成的地块属性系统，每个格子拥有两项标记（1–5 级）：
- **灵气浓度** — 影响突破成功率（1 级 ×0.7 至 5 级 ×1.5）
- **地形危险度** — 影响遭遇频率（1 级 ×0.6 至 5 级 ×1.6）和避战成功率

### 战斗系统

同境界且处于遭遇半径内的修仙者随机遭遇，基于**勇气值**与**胜率预估**决定战斗意愿：
- **双方皆战** — 直接进入战斗
- **一方想战一方退避** — 触发**避战判定**（成功概率受双方修为差距与地形危险度影响），避战失败则扣减 5% 修为后被迫应战
- **双方皆退** — 无事发生
- **经脉受损**修士战斗力降低 30%

### 战败结局

战败后根据实力差距和境界计算死亡概率（高境界修士存活率更高），存活者随机进入六种结局之一：

| 结局 | 概率 | 效果 |
|------|------|------|
| 轻伤 | 40% | 修炼速度 ×0.7，持续 2 年 |
| 重伤 | 29% | 修炼速度 ×0.5 + 无法战斗，持续 5 年 |
| 损失修为 | 20% | 扣减 30% 修为（不低于当前境界门槛） |
| 经脉受损 | 10% | 战斗力 ×0.7，持续 10 年 |
| 跌境 | 1% | 降低一级，修为重置至新境界门槛，寿元渐进衰减 |

### 勇气与寿元

- **勇气曲线** — 不对称 U 型：年轻时勇气略高（冲劲），中年最低（谨慎），临终时勇气大幅上升（绝境一搏）
- **寿元体系** — 晋升获得寿元加成，跌境后寿元以 20%/年速率渐进衰减至当前境界可维持水平
- **机缘掠夺** — 胜者按败者修为和运气因子获得战利品

### 修士身份系统

修士晋升至结丹（Lv2）时获得修仙风格姓名，并开始追踪个体履历：击杀数、战斗胜败、晋升记录、巅峰修为、死因等。

姓名生成基于 **120W 现代 + 25W 古代中文姓名语料** 训练的**二元组转移模型**（bigram），包含 100 个单姓、20 个复姓、4921 组语料验证字对，总唯一姓名容量约 61 万。死亡修士姓名自动回收，避免重名后缀。

### 修士传记

通过 `POST /api/biography` 查询具名修士的叙事传记。LLM 以"茶馆说书人"视角生成，记忆细节随时间按 **Ebbinghaus 遗忘曲线** R(t)=e^(−t/S) 衰减——境界越高被铭记越久（结丹 100 年，大乘 15000 年），飞升者永不遗忘。

### 结构化事件与新闻评级

事件系统产出带完整上下文的结构化 `RichEvent`（战斗、晋升、寿尽、突破失败、渡劫、里程碑），每个事件自动评定新闻价值等级：

| 等级 | 类型 | 处理方式 |
|------|------|---------|
| S（头条） | 全服首位达到某境界 / 某境界最后一人陨落 / 渡劫飞升或陨落 | 完整展开，含人物履历 |
| A（要闻） | 高阶战斗(Lv4+) / 以弱胜强 / 跨级晋升 | 完整展开 |
| B（简讯） | 中阶晋升(Lv2-3) / 普通高阶战斗 | 聚合为统计数字 |
| C（忽略） | 低阶日常 | 不入库 |

### 数据淘汰

后台持续运行淘汰策略，防止数据库无限膨胀：
- **事件淘汰** — B 级保留 200 年、A 级 2000 年、S 级 15000 年
- **记忆衰减** — 修士记录按境界决定保护期（结丹 100 年至大乘 15000 年），超期后标记遗忘并最终清除

### 修仙世界日报

在群聊中 @机器人 或发送 `/日报` 按需聚合模拟事件，按新闻价值筛选分级，构建结构化 Prompt 发送至 LLM（默认 OpenRouter，可配置任意兼容 API），由"修仙史官"视角润色生成日报文本（~300字），通过 OneBot v11 协议推送至 QQ 群。发送 `传记 <名字>` 或 `/传记 <名字>` 查询修士传记。同一群组内自动防重复提交，上一条请求完成前新请求会被拒绝。

### 可视化仪表盘

- 境界分布柱状图
- 种群趋势折线图（人口 / 平均年龄 / 平均勇气，Lv1–Lv7 分线展示）
- 事件日志（战斗、晋升、渡劫、陨落，含败者结局详情；滚动时自动冻结列表并显示"N 条新事件"徽标）
- 统计面板（总人口、新增、死亡分项含天劫、天劫/飞升计数、晋升、境界统计表格含年龄/勇气均值和中位数）
- 连接状态指示（connected / connecting / disconnected）

### TUI 控制台

基于 blessed 的终端仪表盘（`npm run cli`），提供网格导航操作面板、服务生命周期管理、WebSocket 模拟控制、实时状态展示和日志尾随，适合无 GUI 环境下管理模拟。

### 模拟控制

- Start / Pause / Step 三态控制
- 多档变速（3 种批次大小：100 / 500 / 1000 年/批）
- 种子复现（确定性 PRNG 保证可重现）
- 灭绝检测与自动暂停

### 高性能架构

- **多进程架构** — Gateway（主进程）+ sim-worker（模拟引擎子进程）+ llm-worker（LLM 调用子进程），进程崩溃自动重启
- WebSocket 实时推送 + ACK 背压控制（含超时回退防卡死）
- **二进制快照恢复** — 重启时将完整引擎状态（PRNG、修士、里程碑、地块标记）序列化为 binary buffer 存入 `sim_state`，恢复时间从 O(years) 降至 O(population)，无快照时降级为逐年回放并立即持久化快照
- 前端断线自动重连（指数退避 1s–30s）
- 密集数组存储 + 对象槽位复用（无 GC 抖动）
- rAF 渲染节流（多条 WebSocket 消息合并为单次 React setState）
- 趋势数据自动降采样（上限 2000 点）
- SQLite 持久化（WAL 模式，事件/修士/日报/引擎状态/快照）+ 自动数据淘汰

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Recharts |
| Backend | Node.js + WebSocket (ws)，多进程架构 |
| Database | SQLite (better-sqlite3) |
| LLM | OpenRouter / DeepSeek / 任意 OpenAI 兼容 API |
| Bot | OneBot v11 (via NapCat) |
| Language | TypeScript 5.8 |
| Build | Vite 6 (frontend) + tsx/tsup (backend) |
| TUI | blessed (terminal dashboard) |
| Test | Vitest |

## Getting Started

```bash
# 安装依赖
npm install

# 启动后端服务
npm run server:dev

# 启动前端开发服务器（另一个终端）
npm run dev

# 或使用 TUI 控制台（集成服务管理 + 模拟控制）
npm run cli

# 构建生产版本
npm run build

# 运行测试
npm test
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 后端服务端口 |
| `HOST` | `0.0.0.0` | 后端绑定地址 |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | LLM API 基础地址（兼容 OpenAI 格式） |
| `LLM_API_KEY` | — | LLM API Key（不设置则跳过 LLM 调用） |
| `LLM_MODEL` | `deepseek/deepseek-chat` | LLM 模型名称 |
| `ONEBOT_WS_URL` | — | OneBot v11 WebSocket 地址（不设置则不启动 Bot） |
| `ONEBOT_TOKEN` | — | OneBot 认证 Token |
| `QQ_GROUP_ID` | — | 目标 QQ 群号（不设置则响应所有群） |
| `DB_PATH` | `./data/simu-xiuxian.db` | SQLite 数据库路径 |
| `LOG_LEVEL` | `info` | 日志级别（debug / info / warn / error） |
| `VITE_WS_URL` | — | 前端 WebSocket 地址覆盖（默认从 origin 推导） |

启动后端后访问 `http://localhost:5173`，点击 **Start** 开始模拟。

### REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | 健康检查（返回模拟年份、子进程状态） |
| `POST` | `/api/report` | 按需生成修仙世界日报 |
| `POST` | `/api/biography` | 查询修士传记（body: `{"name": "修士名"}`) |
| `GET` | `/api/config/llm` | 查询当前 LLM 配置 |

## Project Structure

```
src/
├── engine/
│   ├── simulation.ts    # 核心模拟：年度循环、修炼、突破、渡劫、寿尽、战败结局、快照序列化
│   ├── combat.ts        # 战斗系统：空间邻域遭遇、避战、胜负判定、机缘掠夺
│   ├── spatial.ts       # 空间索引：32×32 环面网格、遭遇半径、移动逻辑
│   ├── area-tag.ts      # 地块标记系统：灵气浓度 + 地形危险度（Perlin 噪声生成）
│   ├── prng.ts          # 伪随机数生成器 + 截断正态分布
│   ├── benchmark.ts     # 性能基准测试
│   └── profiler.ts      # 性能分析工具
├── components/
│   ├── Dashboard.tsx     # 主面板布局
│   ├── LevelChart.tsx    # 境界分布图
│   ├── TrendChart.tsx    # 趋势图（人口/年龄/勇气三 Tab）
│   ├── EventLog.tsx      # 事件日志（滚动冻结 + 新事件徽标）
│   ├── StatsPanel.tsx    # 统计面板 + 境界统计表格
│   └── Controls.tsx      # 控制栏 + 连接状态指示
├── hooks/
│   └── useSimulation.ts  # WebSocket 通信 + rAF 缓冲合并 + 断线重连
├── balance.ts            # 平衡参数（突破、战斗、渡劫）
├── balance-presets/      # 历史平衡性预设版本
├── constants.ts          # 境界阈值、战斗参数、突破概率、空间常量、地域地图
└── types.ts              # TypeScript 类型定义

server/
├── index.ts              # Gateway 主进程：HTTP + WebSocket + 子进程管理
├── processes/
│   ├── sim-worker.ts     # 模拟引擎子进程
│   └── llm-worker.ts     # LLM 调用子进程
├── ipc.ts                # 进程间通信类型定义
├── runner.ts             # 引擎运行器：生命周期管理、批量调度、背压控制、快照持久化
├── identity.ts           # 修士身份系统：语料库二元组姓名生成、履历追踪、姓名回收
├── biography.ts          # 修士传记：Ebbinghaus 记忆衰减 + LLM 叙事生成
├── events.ts             # 事件收集 + 新闻价值评分
├── reporter.ts           # 日报管线：聚合 → Prompt → LLM → 存储
├── eviction.ts           # 数据淘汰：事件过期清理 + 修士记忆衰减
├── bot.ts                # QQ Bot (OneBot v11 WebSocket + @mention / 斜杠命令)
├── db.ts                 # SQLite 数据层
├── config.ts             # 环境变量配置
├── logger.ts             # 统一日志（级别控制 + 标签标识）
└── yaml.ts               # 轻量 YAML 序列化器（Prompt 构建）

cli.ts                    # TUI 控制台（blessed 终端仪表盘）
```

## License

[Apache License 2.0](LICENSE)

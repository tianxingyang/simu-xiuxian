<h1 align="center">修仙世界模拟器</h1>

<p align="center">
  <b>Cultivation World Simulator</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-6-purple?logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/License-Apache_2.0-green" alt="License">
</p>

---

一个基于 Web Worker 的修仙世界演化模拟器。模拟修仙者的修炼、突破、战斗与陨落，实时可视化种群动态与境界分布。

## Features

### 境界体系

炼气 → 筑基 → 结丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘，八大境界（Lv0–Lv7）逐级突破。Lv0→Lv1 修为达标自动升级；Lv1+ 需通过**突破概率门**判定，突破概率随境界升高而递减，失败触发冷却期并可能附带修为损失或受伤惩罚。

### 战斗系统

同境界修仙者随机遭遇，基于**勇气值**与**胜率预估**决定战斗意愿：
- **双方皆战** — 直接进入战斗
- **一方想战一方退避** — 触发**避战判定**（成功概率受双方修为差距影响），避战失败则扣减 5% 修为后被迫应战
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

### 可视化仪表盘

- 境界分布柱状图
- 种群趋势折线图（人口 / 平均年龄 / 平均勇气，Lv1–Lv7 分线展示）
- 事件日志（战斗、晋升、陨落，含败者结局详情）
- 统计面板（总人口、新增、死亡分项、晋升、境界统计表格含年龄/勇气均值和中位数）

### 模拟控制

- Start / Pause / Step 三态控制
- 多档变速（3 种批次大小：100 / 500 / 1000 年/批）
- 种子复现（确定性 PRNG 保证可重现）
- 灭绝检测与自动暂停

### 高性能架构

- Web Worker 后台运算 + ACK 背压控制
- 密集数组存储 + 对象槽位复用（无 GC 抖动）
- rAF 渲染节流（多条 Worker 消息合并为单次 React setState）
- 趋势数据自动降采样（上限 2000 点）

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19 + Recharts |
| Language | TypeScript 5.8 |
| Build | Vite 6 |
| Compute | Web Worker |

## Getting Started

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

启动后访问 `http://localhost:5173`，点击 **Start** 开始模拟。

## Project Structure

```
src/
├── engine/
│   ├── simulation.ts   # 核心模拟：年度循环、修炼、突破、寿尽、战败结局
│   ├── combat.ts       # 战斗系统：遭遇、避战、胜负判定、机缘掠夺
│   ├── worker.ts       # Web Worker：批量调度、背压控制、消息协议
│   ├── prng.ts         # 伪随机数生成器 + 截断正态分布
│   ├── benchmark.ts    # 性能基准测试
│   └── profiler.ts     # 性能分析工具
├── components/
│   ├── Dashboard.tsx    # 主面板布局
│   ├── LevelChart.tsx   # 境界分布图
│   ├── TrendChart.tsx   # 趋势图（人口/年龄/勇气三 Tab）
│   ├── EventLog.tsx     # 事件日志
│   ├── StatsPanel.tsx   # 统计面板 + 境界统计表格
│   └── Controls.tsx     # 控制栏
├── hooks/
│   └── useSimulation.ts # Worker 通信 + rAF 缓冲合并
├── constants.ts         # 境界阈值、战斗参数、突破概率、伤害常量
└── types.ts             # TypeScript 类型定义
```

## License

[Apache License 2.0](LICENSE)

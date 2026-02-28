<h1 align="center">修仙世界模拟器</h1>

<p align="center">
  <b>Cultivation World Simulator</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-6-purple?logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

一个基于 Web Worker 的修仙世界演化模拟器。模拟修仙者的修炼、突破、战斗与陨落，实时可视化种群动态与境界分布。

## Features

- **境界体系** — 炼气 → 筑基 → 结丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘，八大境界逐级突破
- **战斗系统** — 同境界修仙者遭遇战斗，胜者夺取修为，败者陨落
- **种群演化** — 每年新增修仙者，自然修炼、寿元耗尽、战斗淘汰多因素驱动
- **实时可视化** — 境界分布柱状图、种群趋势折线图、事件日志、统计面板四屏联动
- **可控模拟** — 支持 Start/Pause/Step 控制、多档变速、种子复现、灭绝检测
- **高性能** — Web Worker 后台运算、对象池、流式事件投递、趋势数据自动降采样

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
│   ├── simulation.ts   # 核心模拟逻辑
│   ├── combat.ts       # 战斗系统
│   ├── worker.ts       # Web Worker 消息处理
│   └── prng.ts         # 伪随机数生成器
├── components/
│   ├── Dashboard.tsx    # 主面板布局
│   ├── LevelChart.tsx   # 境界分布图
│   ├── TrendChart.tsx   # 种群趋势图
│   ├── EventLog.tsx     # 事件日志
│   ├── StatsPanel.tsx   # 统计面板
│   └── Controls.tsx     # 控制栏
├── hooks/
│   └── useSimulation.ts # Worker 通信 Hook
├── constants.ts         # 境界阈值、生成参数
└── types.ts             # TypeScript 类型定义
```

## License

MIT

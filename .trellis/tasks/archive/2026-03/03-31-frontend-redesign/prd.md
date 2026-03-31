# 前端 UI/UX 彻底重构

## Goal

使用 `/ui-ux-pro-max` 对修仙模拟器前端进行彻底的 UI/UX 重构，从当前功能性仪表盘升级为具有修仙世界沉浸感的高品质界面。

## Current State

### 技术栈
- React 19.1 + TypeScript 5.8 + Vite 6.3
- Recharts 2.15（图表）
- 纯手写 CSS（CSS custom properties，单文件 index.css ~587 行）
- WebSocket 实时通信（useSimulation hook）
- 无路由、无状态管理库、无组件库

### 当前布局
```
┌──────────────── Controls Bar ──────────────────┐
├──────────────┬──────────────┬──────────────────┤
│  LevelChart  │  TrendChart  │  StatsPanel      │
│  (境界分布)   │  (趋势图)    │  (统计数据)       │
├──────────────┤──────────────┤──────────────────┤
│              │  EventLog    │  FactionPanel    │
│              │  (事件日志)   │  (势力面板)       │
└──────────────┴──────────────┴──────────────────┘
```
- 2x2 CSS Grid + 右侧上下分割
- 深色主题（#050510 底色，蓝紫 accent）
- render-props 插槽式 Dashboard 组件

### 现有组件
| 组件 | 功能 |
|------|------|
| Dashboard | Grid 布局壳，接收 6 个 ReactNode 插槽 |
| Controls | 顶栏：种子输入、速度按钮、开始/暂停/单步/重置、连接状态 |
| LevelChart | Recharts 柱状/面积图：各境界修仙者数量 |
| TrendChart | Recharts 折线图：历史趋势（人口、死亡等） |
| EventLog | 可滚动事件流，支持类型筛选 |
| StatsPanel | 键值对统计：人口、死亡、突破、天灾、势力 |
| FactionPanel | 势力列表：名称、区域、成员数 |

## Requirements

### 视觉风格
- 打造"修仙世界"沉浸感，而非通用数据仪表盘
- 融入中国传统美学元素（水墨、山水、仙气氛围）
- 保持深色主题基调，但提升质感和层次感
- 色彩体系需与修仙境界体系呼应（炼气→大乘，由浅入深）

### 布局优化
- 重新设计信息层级和空间分配
- 优化各面板的视觉权重
- 考虑响应式适配（至少支持 1920x1080 和 1440x900）

### 组件升级
- Controls：更具仪式感的操控界面
- LevelChart：境界分布可视化需更具表现力
- TrendChart：趋势展示更清晰直观
- EventLog：事件流需要更好的视觉层次和可读性
- StatsPanel：关键数据需要更突出的展示
- FactionPanel：势力信息需要更丰富的呈现

### 技术约束
- 保持现有技术栈不变（React 19 + Recharts + 纯 CSS）
- 不引入新的 CSS 框架或组件库
- 保持 useSimulation hook 接口不变
- 保持 Dashboard render-props 架构
- 所有现有功能必须保留

## Acceptance Criteria

- [ ] 视觉风格具有明显的"修仙世界"辨识度
- [ ] 所有现有功能正常工作（控制、图表、事件、统计、势力）
- [ ] WebSocket 连接和实时更新正常
- [ ] 无 TypeScript 类型错误
- [ ] 无 lint 错误
- [ ] 在 1920x1080 分辨率下布局正常

## Technical Notes

- 重构范围：`src/components/` 全部组件 + `src/index.css`
- 不改动：`src/hooks/useSimulation.ts`、`src/types.ts`、`src/engine/`
- 使用 `/ui-ux-pro-max` skill 进行设计和实现

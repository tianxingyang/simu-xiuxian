## Why

构建一个纯前端修仙世界模拟器，以离散年为单位模拟修士群体的修炼、遭遇、战斗、晋升和死亡。通过统计仪表盘实时展示各境界人口分布、趋势变化和关键事件，验证"弱肉强食"世界观下修士群体的涌现行为。

## What Changes

- 新建完整的修仙世界模拟引擎（Web Worker 内运行）
- 新建 React 仪表盘 UI（四象限布局 + 控制栏）
- 实现 8 级境界体系、遭遇/战斗/晋升/寿元清算机制
- 实现种子 PRNG 支持可复现模拟
- 实现三档速度模式（每 2 秒 100/500/1000 年）

## Capabilities

### New Capabilities
- `cultivation-levels`: 境界体系、修为阈值、寿元计算、晋升规则
- `encounter-combat`: 遭遇概率、战斗决策、胜负结算、修为吸收
- `simulation-loop`: 年度循环、修士生命周期、初始状态、种子 PRNG、终止条件
- `dashboard`: UI 布局、图表可视化、事件日志、控制栏、速度模式

### Modified Capabilities

## Impact

- 新建 React + TypeScript + Vite 项目
- 依赖：recharts（图表）
- 使用 Web Worker 实现模拟引擎与 UI 解耦
- 纯前端 SPA，无后端依赖

# Journal - vitoyang (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-03-31

---



## Session 39: 前端 UI 重构 — 天道监察视觉体系

**Date**: 2026-03-31
**Task**: 前端 UI 重构 — 天道监察视觉体系
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## 改动概要

| 文件 | 改动 |
|------|------|
| `src/index.css` | 完整重写 — 水墨虚空主题、多层径向渐变背景、灵气光线动画、面板悬停发光 |
| `src/components/Dashboard.tsx` | 布局从 2x2 改为 2x3，Stats/Faction 各占独立面板，EventLog 底部通栏 |
| `src/constants/level.ts` | 境界色阶升级为修仙主题色（翠/碧/金/紫/霞/焰/朱/辉） |
| `src/components/TrendChart.tsx` | 修复非空断言（`!` → `?.`） |

## 设计体系

- **风格**: 天道监察 — 水墨暗夜 + 仙气氛围
- **背景**: 4 层径向渐变（紫/蓝交错）营造虚空水墨感
- **面板**: 微光边框 + hover 时灵气响应（glow transition 300ms）
- **控制栏**: 底部灵力光线（breath animation 8s），标题金→蓝渐变
- **图表标题**: 左侧金色起笔装饰线（::after 伪元素）
- **布局**: 2 列 3 行 grid（2fr 2fr 1.5fr），统计和势力面板独立展示


### Git Commits

| Hash | Message |
|------|---------|
| `e14ce59` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 40: Analytical Balance Derivation + New Preset v2026-04-01

**Date**: 2026-04-01
**Task**: Analytical Balance Derivation + New Preset v2026-04-01
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## Problem
筑基期人数(37.5%)超过练气期(42.0%)，分布严重倒挂。根因：breakthrough a=0.454 太低，lv0 突破率高达 58%。

## Approach: Birth-Death Process Steady-State Derivation
用数学方法替代暴力搜索：从目标分布反推游戏参数，而非随机搜索 100 个参数。

核心公式：`p_L = R_L × (p_{L+1} + d_{L+1})`，从最高级往下逐级反推突破率。

与 Codex 讨论确定了半马尔可夫链模型：
- 显式建模冷却占用 `F_L = 1/(1 + τλf)`
- 反推公式 `s_L = p(1+τλ) / (λ(1+τp))`
- 固定点迭代校准（derive → sim → measure → re-derive）

## Results

| Level | Target | Before | After |
|-------|--------|--------|-------|
| 炼气 | 59.17% | 42.02% | **52.62%** |
| 筑基 | 27.95% | **37.51%** | **30.50%** |
| 化神 | 0.487% | 0.46% | **0.496%** |

Key param change: `a: 0.454 → 1.796`, lv0 breakthrough: 58% → 16%

## New Tools
- `scripts/derive-params.ts` — 稳态求解器
- `scripts/measure-rates.ts` — per-level 速率测量
- `search-balance.ts --search-mode=guided` — 数学引导的搜索模式

## Files Changed
- `src/balance-presets/v2026-04-01.ts` — new preset
- `src/balance-presets/index.ts` — switch to new preset
- `src/engine/simulation.ts` — per-level instrumentation
- `src/engine/combat.ts` — per-level combat death counter
- `src/types.ts` — YearSummary new fields
- `scripts/search-balance.ts` — expanded search space + guided mode
- `scripts/derive-params.ts` — new: steady-state solver
- `scripts/measure-rates.ts` — new: rate measurement

## Known Remaining Gaps
- 练气 still ~6.5% below target (needs household/awakening tuning via lv0 scope)
- 炼虚+ levels still zero (needs lifespan/threshold tuning via lv2 scope)
- search-balance lv0 scope hangs on population explosion (needs pop cap in evaluator)


### Git Commits

| Hash | Message |
|------|---------|
| `051e573` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

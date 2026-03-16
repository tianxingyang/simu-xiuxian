# brainstorm: 名字碰撞问题优化

## Goal

解决修士命名系统中因姓氏概率分布导致的大量重名问题，消除编号后缀（②③）对沉浸感的破坏。

## What I already know

**当前系统**:
- 命名阈值: Lv2（结丹）— 修士晋升结丹时触发命名
- 姓氏池: 100 单姓 + 20 复姓 = 120 个，按语料库频率加权
- 名字: 30% 单字名（~200 字），70% 双字名（bigram 模型，~90 首字 × ~30 后继字）
- 理论姓名空间: ~120 × 1950 ≈ 234,000
- 碰撞处理: 重试 100 次 → 加编号后缀 ②③④...⑩ → ⑪

**碰撞根因**:
- 姓氏按真实语料频率加权，前 10 姓（李王张刘陈杨黄吴周赵）占全部选取的 ~35%
- 有效姓名多样性远低于理论值（高频姓氏复用严重）
- 每年新增 1000 修士，长时间模拟后结丹修士累积量巨大
- usedNames 包含全历史（含已死亡），池子只出不进

**事件系统现状**:
- C 级: Lv0-1 所有事件 + Lv2 普通战斗（不入库）
- B 级: Lv2-3 晋升 + Lv3 战斗 + Lv2-3 命名修士死亡
- A 级: Lv4+ 战斗 + 以弱胜强 + 跨 2 级晋升 + Lv4+ 死亡
- S 级: 里程碑 + 天劫 + Lv6+ 死亡

## Open Questions

1. 是否同时调整事件关注度阈值，还是仅改命名？
2. 是否需要保留结丹期修士的任何叙事能力？

## Requirements (evolving)

(待方案确认后填写)

## Acceptance Criteria (evolving)

- [ ] 长时间模拟不再出现编号后缀
- [ ] 叙事聚焦高境界修士

## Out of Scope (explicit)

(待确认)

## Technical Notes

- `server/identity.ts:333` — `if (toLevel < 2) return;` 是命名阈值
- `src/engine/combat.ts:50-68` — `scoreNewsRank()` 是事件评级
- `src/engine/simulation.ts:26` — milestone 检测从 Lv2 开始

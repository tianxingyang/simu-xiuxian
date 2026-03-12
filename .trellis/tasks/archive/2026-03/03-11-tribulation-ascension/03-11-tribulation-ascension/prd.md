# Lv7 天劫飞升机制 (Tribulation & Ascension)

## Goal

为 Lv7（大乘期）设计符合修仙世界规则的流出机制。
当前 Lv7 无晋升出口，唯一出口是寿尽死亡，但 Lv7 可持续寿命高达 100,000 年（Lv6 仅 ~57,682 年），
导致长期运行后 Lv7 人口反超 Lv6，违反预期的金字塔分布。

通过「天劫飞升」机制，为 Lv7 提供一个既符合修仙世界观、又能有效控制人口的出口。

## What I already know

- Lv7 是最高等级（`MAX_LEVEL = 7`），当前 `tryBreakthrough` 直接 return false
- Lv7 `SUSTAINABLE_MAX_AGE` = 100,000，Lv6 = ~57,682（1.73 倍差距）
- 目标分布：Lv7=0.001%、Lv6=0.007%，即 Lv7 人数约为 Lv6 的 1/7
- 现有退出方式：寿尽死亡（expiry）、战斗死亡（combat death）
- `BalanceProfile` 已有 breakthrough / threshold / combat 三大模块
- `proposal.md` 已完成初步设计

## Assumptions (temporary)

- 天劫仅对 Lv7 修士触发，不影响其他等级
- 飞升统计独立于死亡统计
- sigmoid 曲线参数需可通过 BalanceProfile 调节

## Decisions

- **执行位置**: tickCultivators 中先天劫检查 → 再寿尽检查
- **伤病免疫**: 天劫不考虑受伤/冷却状态，无论状态如何都会判定
- **保护期**: 需要，刚晋升 Lv7 不会立即遭遇天劫（sigmoid 曲线提供前期低概率）
- **飞升记录**: 飞升修士需保留记录（milestone 事件）
- **飞升成功率**: 极低（~10-15%），九死一生，绝大多数陨落，飞升者极稀有
- **扩展性**: 严格 Lv7 专属，不预留 Lv8
- **sigmoid 参数**: 不精确指定，给合理默认值，后续通过 `search-balance.ts` 自动寻优

## Open Questions

(none)

## Requirements (evolving)

- Cultivator 新增 `reachedMaxLevelAt` 字段，记录到达 Lv7 的年份
- `tribulationChance(yearsAtLv7)` sigmoid 递增概率函数
- `tryTribulation()` 在 tickCultivators 中对 Lv7 修士执行
- 二元判定：成功 → 飞升（移除），失败 → 陨落（死亡）
- 飞升成功率为固定值，纳入 `BalanceProfile.tribulation.successRate`
- 新增 `RichTribulationEvent`（`outcome: 'ascension' | 'death'`）
- `YearSummary` 新增 `tribulations`、`ascensions`、`tribulationDeaths`
- `SimEvent.type` 新增 `'tribulation'`
- `EngineHooks` 新增 `onAscension` 回调
- `scoreNewsRank` 中天劫事件评为 S 级
- `toDisplayEvent` 支持天劫事件渲染
- 分布测试适配

## Acceptance Criteria (evolving)

- [ ] Lv7 修士在停留足够年份后开始触发天劫
- [ ] 天劫成功 → 飞升，修士被移除，不计入死亡统计
- [ ] 天劫失败 → 陨落，修士死亡
- [ ] 长期运行后 Lv7 人口不再反超 Lv6
- [ ] 天劫参数可通过 BalanceProfile 调节
- [ ] 事件系统正确生成天劫事件（含 newsRank）
- [ ] 所有现有测试通过
- [ ] `npm run build` 无类型错误

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes

## Out of Scope

- UI 新增飞升专属展示（趋势图、飞升计数面板等）
- 天劫的视觉特效
- 非 Lv7 的天劫机制

## Technical Notes

- 现有 proposal: `openspec/changes/tribulation-ascension/proposal.md`
- 关键文件: `src/types.ts`, `src/constants.ts`, `src/balance.ts`, `src/engine/simulation.ts`, `src/engine/combat.ts`
- 现有 balance presets: `src/balance-presets/`
- Worker protocol: `src/engine/worker.ts`

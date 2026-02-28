## Why

`src/engine/combat.ts` 的 `processEncounters` 函数未排除 Lv0（炼气）修士参与遭遇/战斗，违反了 `openspec/specs/encounter-combat/spec.md` 第4行的规格要求："Lv0 cultivators SHALL NOT participate"。当前实现中 `snapshotN` 包含 Lv0 计数、`aliveIds` 包含 Lv0 修士，导致炼气期修士间发生大量无意义战斗。

## What Changes

- 修复 `processEncounters` 的 snapshot 循环：跳过 `level === 0`，使 `snapshotN` 仅统计 Lv≥1 修士
- 修复 `processEncounters` 的 `aliveIds` 构建：排除 Lv0 修士，消除无效迭代
- 附带性能收益：减少每年数千次无效循环迭代

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `encounter-combat`: 实现代码需匹配已有规格中 "Lv0 cultivators SHALL NOT participate" 的要求。规格本身无需修改，仅修复实现。

## Impact

- `src/engine/combat.ts`: `processEncounters` 函数两处过滤条件
- `combatDeaths` 统计值将下降（排除了 Lv0 间战斗死亡），UI 自动反映，无需改动
- Lv1+ 修士遭遇概率因 `N` 减小而微升（正确行为，符合规格定义）

## Context

`processEncounters` 的 snapshot 循环遍历 `engine.levelGroups` 全部等级（含 Lv0），将 Lv0 计入 `snapshotN` 并填充 `levelArrayCache`。主遍历循环通过 `aliveIds` 迭代所有存活修士（含 Lv0），Lv0 修士因 `snapshotNk[0] > 1` 不被跳过，最终进入 `resolveCombat`。

## Goals / Non-Goals

**Goals:**
- 使 `processEncounters` 实现与 `encounter-combat` 规格的 Lv0 排除条款一致
- 从 `snapshotN` 计算中排除 Lv0，确保 Lv1+ 遭遇概率正确
- 从遭遇迭代中排除 Lv0，消除无效循环

**Non-Goals:**
- 不修改规格文档（已正确）
- 不重构战斗系统架构
- 不改变 Lv1+ 修士间的战斗逻辑

## Decisions

### D1: 在 snapshot 循环中跳过 Lv0（清理后 continue）

在 `combat.ts:21` 的 `for (const [level, ids] of engine.levelGroups)` 循环中，先清理 `levelArrayCache`，再对 `level === 0` 执行 `continue`：

```typescript
for (const [level, ids] of engine.levelGroups) {
    const arr = engine.levelArrayCache.get(level)!;
    arr.length = 0;                    // 始终清理缓存（含 Lv0）
    if (level === 0) continue;         // 清理后跳过 Lv0
    snapshotNk[level] = ids.size;
    snapshotN += ids.size;
    if (ids.size > 1) for (const id of ids) arr.push(id);
}
```

关键：`continue` 必须放在 `arr.length = 0` 之后，否则 `levelArrayCache[0]` 保留前一 tick 的过期 ID。虽然当前主循环不会访问 `levelArrayCache[0]`（Lv0 已排除），但清理缓存是正确的资源管理实践。

备选方案：在循环开头直接 `continue`。不采用，因为跳过缓存清理会导致 Lv0 缓存残留。

### D2: 在 aliveIds 构建中排除 Lv0

在 `combat.ts:33` 的条件从 `c.alive` 改为 `c.alive && c.level > 0`。

效果：Lv0 修士不进入 `aliveIds`，主循环不迭代数千 Lv0 条目。

备选方案：保留 `aliveIds` 含 Lv0，依赖 `snapshotNk[0] === 0` → `nk <= 1` → `continue` 自动跳过。不采用，因为仍需迭代大量 Lv0 条目浪费 CPU。

## Risks / Trade-offs

- [Lv1+ 遭遇概率微升] → 预期行为，符合规格定义 `N = Lv≥1 总数`
- [combatDeaths 统计下降] → 预期行为，UI 通过 `engine.combatDeaths` 自动反映
- [同种子 PRNG 输出漂移] → Lv0 不消耗 PRNG 调用，改变 Lv1+ 的随机序列。无测试依赖种子确定性，可接受
- [`resolveCombat` 中 Lv0→Lv1 晋升路径变为死代码] → `winner.level === 1` 分支仅在原 Lv0 战斗胜利时触发，现已不可达。保留作为防御性代码，不删除

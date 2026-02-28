## 1. 修复 processEncounters

- [x] 1.1 `src/engine/combat.ts`: snapshot 循环中，将 `levelArrayCache` 清理提前到 `if (level === 0) continue` 之前，确保 Lv0 缓存被清理后再跳过计数
- [x] 1.2 `src/engine/combat.ts`: `aliveIds` 构建条件从 `c.alive` 改为 `c.alive && c.level > 0`，排除 Lv0 修士

## 2. 验证

- [x] 2.1 运行构建 `npm run build`，确认无编译错误
- [x] 2.2 启动应用，观察模拟初期（全 Lv0 阶段）combatDeaths 为 0

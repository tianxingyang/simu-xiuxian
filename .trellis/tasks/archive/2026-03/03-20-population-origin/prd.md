# 重新设计人口新增机制 — 凡人聚落模拟系统

## Goal

当前每年固定 spawnCultivators(1000) 凭空生成修士，缺乏合理性。新增「凡人聚落模拟」模块，让新修士从凡人家户中自然觉醒，聚落从家户有机涌现，修士与凡人通过灵脉土地间接交互。

## Decisions

- 凡人模拟粒度：**家户级**
- 地图组织：**有聚落层**，聚落可跨多格，一格可有多个聚落
- 灵根机制：**纯随机觉醒**，概率受格子 spiritualEnergy 影响
- 灵气系统：**复用现有 AreaTagSystem**
- 修士与凡人：**间接交互**（弟子来源 + 领地即灵脉 + 战争副产品）
- 聚落与势力：**聚落是势力的基建层**
- 家户与聚落：**统一生长模型**，家户升格为聚落
- 初始世界：**从零开始**，蛮荒时代自然涌现

## Requirements

### 1. 家户系统 (Household)

**数据结构：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 唯一标识 |
| `settlementId` | number \| null | 所属聚落（null = 散居） |
| `population` | number | 家户人口数 |
| `growthAccum` | number | 增长累积小数部分 |

**每年 tick 行为：**
- 人口增长：`增量 = population × baseRate × terrainSafetyFactor(terrainDanger)`
  - baseRate: ~3%
  - terrainSafetyFactor: terrainDanger 越高，增长越慢
  - 小数部分累积到 growthAccum，取整加到 population
- 修士觉醒判定：`概率 = baseAwakeningRate × population × spiritualEnergyFactor`
  - 觉醒时 population -= 1，生成新修士
  - 散居家户也能觉醒（直接用格子的 spiritualEnergy）
- 升格判定：population >= 50 时，从原聚落独立为新聚落
  - 新聚落出现在相邻格子（找空位，找不到则不扩张）
  - 升格后拆分为若干小家户
- 消亡：population <= 0 时移除

### 2. 聚落系统 (Settlement)

**数据结构：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 唯一标识 |
| `name` | string | 聚落名称（升格时生成） |
| `cells` | number[] | 占据的格子索引列表 |
| `originHouseholdId` | number | 起源家户 ID |
| `foundedYear` | number | 建立年份 |

**计算属性（不存储）：**
- `totalPopulation`: 所有下属家户 population 之和
- `type`: 由 totalPopulation 决定
  - 村落 hamlet: < 200
  - 村庄 village: 200 ~ 999
  - 镇 town: 1000 ~ 4999
  - 城 city: 5000+

**生命周期：**
- 建立：家户升格时创建
- 扩张：totalPopulation 达到城镇级别时，尝试占据相邻格子（空间冲突则不扩张）
- 降级：人口下降时类型自动降级
- 毁灭：所有家户消亡时，聚落变为废墟/移除

**命名：** 升格时自动生成名称

### 3. 修士出身追溯

- Cultivator 新增 `originSettlementId` 和 `originHouseholdId` 字段
- 结丹命名时可结合出身聚落（如"青石村陈氏"）
- 追溯修士来源：哪个聚落、哪个家户

### 4. 修士↔聚落交互

- **修士战斗波及**：同格子内的修士战斗对附近聚落家户造成人口损失
- **灵脉效应**：高 spiritualEnergy 的格子觉醒率更高 → 自然吸引势力争夺
- **战争破坏**：修士战斗发生在聚落格子上时，直接扣减家户人口

### 5. 初始世界生成

- 模拟开始时无聚落，地图上散布初始家户（数量可配置）
- 家户位置受 terrainDanger 影响（倾向低危险区域）
- 初始家户人口 ~5 人
- 前几十年为蛮荒时代，无修士
- 聚落从家户增长中自然涌现

### 6. 引擎集成

- 替换现有 `spawnCultivators(YEARLY_NEW)` 调用
- tickYear 中新增家户 tick 阶段（增长→觉醒→升格）
- 快照序列化扩展：新增家户和聚落数据的序列化/反序列化
- 前端展示：聚落数据通过 WebSocket 推送（YearSummary 扩展）

## Acceptance Criteria

- [ ] 移除固定 spawnCultivators，修士完全从家户觉醒产生
- [ ] 家户每年自然增长，受 terrainDanger 影响
- [ ] 家户达到阈值升格为新聚落
- [ ] 聚落类型随人口动态升降级（hamlet/village/town/city）
- [ ] 聚落可跨多格
- [ ] 修士携带出身信息（originSettlementId, originHouseholdId）
- [ ] 修士战斗波及聚落人口
- [ ] 初始世界从零开始，聚落有机涌现
- [ ] 聚落和家户数据可序列化/反序列化（快照兼容）
- [ ] 结丹命名结合出身聚落

## Definition of Done

- Tests added/updated
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- 快照版本号升级

## Out of Scope

- 势力系统（单独 task，但数据结构为其预留接口）
- 凡人个体模拟（只到家户级）
- 经济/贸易系统
- 聚落间道路/交通

## Technical Notes

- 替换目标：`src/engine/simulation.ts` 中的 `spawnCultivators()` + `YEARLY_NEW`
- 复用：`src/engine/area-tag.ts` (AreaTagSystem)
- 扩展：`src/types.ts` (Cultivator 新增 origin 字段, 新增 Household/Settlement 类型)
- 扩展：`server/db.ts` (可能需要 settlements 表用于命名聚落持久化)
- 新增：`src/engine/settlement.ts` (聚落引擎模块)
- 新增：`src/engine/household.ts` (家户引擎模块)
- 快照序列化：版本升级，新增家户+聚落二进制段

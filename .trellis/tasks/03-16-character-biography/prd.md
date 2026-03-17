# 角色生平传记

## Goal

为修仙模拟器中的命名修士提供"茶馆说书人"风格的叙事传记生成功能。QQ 群用户发送修士名字，机器人返回一段有血有肉的传记故事。传记详细程度随时间推移衰减，高阶修士和飞升者被记忆更久。

## Requirements

### 核心功能
- **叙事风格**：茶馆说书人讲故事，事实为骨、故事为肉
- **事实准确性**：晋升、战斗战绩、死因等重要事件必须与数据一致
- **创意填充**：事件间的过渡、心理描写、场景渲染可适当展开
- **触发方式**：HTTP API 端点（`POST /api/biography`，body: `{ "name": "XXX" }`），QQ 机器人调用
- **支持范围**：在世修士（半部传记）+ 已故/飞升修士（完整传记）

### 记忆衰减机制
传记详细程度由"记忆强度"决定，取决于修士等级和距死亡的时间：

| 记忆等级 | 触发条件 | 叙事风格 |
|---------|---------|---------|
| 鲜活 | 在世 / 近期死亡 / 飞升者 | 完整叙事，具体对手、战斗细节 |
| 模糊 | 死亡较久 | 关键事件为主，"据说当年..." |
| 传说 | 死亡很久 | 寥寥数语，"江湖上曾有此人..." |
| 遗忘 | 超出记忆期限 | "此人已不可考" |

- 等级越高 → 记忆持续越久（具体参数在实现时调整）
- 飞升者 → 记忆永不衰减
- 在世修士 → 始终为"鲜活"级别

### 缓存
- 同一修士在缓存有效期内重复查询返回缓存结果
- 缓存过期后重新生成

### 异常处理
- 名字不存在 → 说书人风格回应："老朽不曾听闻此人"
- 无名修士（Lv0-1） → 系统无记录，同上

## Acceptance Criteria

- [ ] `POST /api/biography` body `{ "name": "张天风" }` 返回 JSON `{ status: 'ok', biography: '...' }`
- [ ] 传记文本包含修士的真实数据（境界、战绩、死因等）
- [ ] 在世修士返回"半部传记"（故事仍在继续）
- [ ] 已故修士返回完整传记，详细程度受记忆衰减影响
- [ ] 飞升修士始终返回详细传记
- [ ] 不存在的名字返回说书人风格的"未知"回应
- [ ] 缓存有效期内重复查询不重复调用 LLM
- [ ] LLM 调用失败时返回合理错误信息

## Definition of Done

- Lint / typecheck 通过
- 手动测试 API 端点各场景

## Out of Scope

- 前端 UI 展示（本期仅做 API）
- QQ 机器人端的消息接收/解析（由外部机器人框架处理）
- 批量生成传记
- 传记持久化到数据库（仅内存缓存）

## Technical Approach

### 数据查询
1. 按名字查 `named_cultivators` 表 → 获取 ID + 统计数据
2. 按 cultivator ID 查 `events` 表 → 获取该修士相关的结构化事件
3. 根据当前模拟年份计算记忆衰减等级

### LLM 调用
- 复用 `reporter.ts` 中的 `callDeepSeek()`
- 构建专用 system prompt（说书人角色设定 + 记忆等级对应的详细度要求）
- user message 包含修士数据 + 事件时间线的结构化 JSON

### 新增/修改文件
- `server/biography.ts`（新增）：核心逻辑 — 数据查询、记忆衰减计算、prompt 构建、缓存
- `server/db.ts`（修改）：新增按名字查修士、按 cultivator ID 查事件的查询函数
- `server/index.ts`（修改）：注册 `/api/biography` 端点

## Technical Notes

- 关键文件：`server/identity.ts`、`server/db.ts`、`server/reporter.ts`
- 数据库表：`named_cultivators`（修士数据）、`events`（事件，payload 为 JSON）
- LLM：DeepSeek API（已有集成）
- 事件 payload 中的 cultivator ID 字段位置因事件类型而异（winner.id / loser.id / subject.id）
- 境界名称映射：`LEVEL_NAMES` from `src/constants.ts`

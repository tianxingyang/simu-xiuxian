## ADDED Requirements

### Requirement: Daily event aggregation
系统 SHALL 提供每日事件聚合功能，收集前一个现实天（00:00:00 ~ 23:59:59 UTC+8）内产生的所有 rank ≤ B 的事件，按新闻价值分级组织。

聚合输出结构：
- `headlines: RichEvent[]` — S 级事件，完整展开
- `major_events: RichEvent[]` — A 级事件，完整展开
- `statistics` — B 级事件聚合为统计数字（各境界晋升数、战斗死亡数等）
- `meta` — 元信息（模拟年份范围、总人口变化等）

#### Scenario: Normal day aggregation
- **WHEN** 前一天模拟了 370 年，产生 2 个 S 级事件、15 个 A 级事件、200 个 B 级事件
- **THEN** 聚合结果 SHALL 包含 2 个 headlines、15 个 major_events、B 级统计数字

#### Scenario: No events day
- **WHEN** 前一天模拟暂停，无事件产生
- **THEN** 聚合结果 SHALL 为空，日报生成 SHALL 被跳过

#### Scenario: Bio enrichment
- **WHEN** S/A 级事件涉及命名修士
- **THEN** 聚合器 SHALL 从 named_cultivators 表查询该修士的完整履历，附加到事件数据中

### Requirement: Prompt construction
系统 SHALL 将聚合结果构建为 DeepSeek API 的 prompt。prompt 由 system message 和 user message 组成。

**system message** SHALL 设定角色为"修仙世界的史官"，要求：
- 以日报体裁撰写，含头条、要闻、简讯、天下大势等栏目
- 不得编造素材中没有的事件
- 可以润色措辞、增加修仙氛围描写
- 总长度控制在 800 字以内

**user message** SHALL 为 JSON 格式的结构化素材，包含：
- `real_date` — 现实日期
- `sim_year_range` — 模拟年份范围
- `years_simulated` — 模拟年数
- `headlines` — S 级事件（含人物履历）
- `major_events` — A 级事件
- `statistics` — B 级统计

#### Scenario: Prompt with headlines
- **WHEN** 聚合结果含 1 个 S 级 first_at_level 事件（首位炼虚期修士）
- **THEN** prompt 中 headlines 数组 SHALL 包含该事件完整信息及人物履历

#### Scenario: Prompt length control
- **WHEN** A 级事件超过 20 个
- **THEN** SHALL 按 newsRank 和参与者境界排序，保留前 15 个最重要的

### Requirement: DeepSeek API integration
系统 SHALL 调用 DeepSeek Chat Completions API（`POST https://api.deepseek.com/v1/chat/completions`）生成日报文本。

- model SHALL 为 `deepseek-chat`
- API Key 从环境变量 `DEEPSEEK_API_KEY` 读取
- temperature SHALL 为 0.7
- max_tokens SHALL 为 2000

#### Scenario: Successful generation
- **WHEN** DeepSeek API 返回 200
- **THEN** SHALL 提取 `choices[0].message.content` 作为日报文本

#### Scenario: API error
- **WHEN** DeepSeek API 返回非 200 或网络超时
- **THEN** SHALL 记录错误日志，保留原始素材到 daily_reports 表（report 字段为空），支持后续手动重试

#### Scenario: API key missing
- **WHEN** `DEEPSEEK_API_KEY` 环境变量未设置
- **THEN** 日报生成 SHALL 跳过 LLM 调用，仅保存原始素材，日志输出警告

### Requirement: Report storage
生成的日报 SHALL 存储到 SQLite `daily_reports` 表，包含：日期（UNIQUE）、模拟年份范围、完整 prompt、LLM 生成的日报文本、创建时间戳。

#### Scenario: Report stored
- **WHEN** 日报生成成功
- **THEN** SHALL INSERT 一条记录，date 为 YYYY-MM-DD 格式

#### Scenario: Duplicate date prevention
- **WHEN** 同一天重复触发日报生成
- **THEN** SHALL UPDATE 现有记录而非 INSERT，覆盖旧的日报内容

### Requirement: Scheduled daily trigger
系统 SHALL 使用 `node-cron` 在每天固定时间（默认 08:00 UTC+8）自动触发日报生成。定时时间 SHALL 可通过配置修改。

#### Scenario: Daily cron execution
- **WHEN** 系统时间到达 08:00
- **THEN** SHALL 自动触发日报聚合 + LLM 生成 + 推送流程

#### Scenario: Configurable time
- **WHEN** 配置中设置 `REPORT_CRON='0 20 * * *'`
- **THEN** 日报 SHALL 在每天 20:00 触发

### Requirement: QQ Bot push
系统 SHALL 通过 OneBot v11 HTTP API 将日报文本推送到指定 QQ 群。

- OneBot HTTP 地址从配置 `ONEBOT_HTTP_URL` 读取
- 目标群号从配置 `QQ_GROUP_ID` 读取
- 调用 `POST <ONEBOT_HTTP_URL>/send_group_msg` 发送消息

#### Scenario: Successful push
- **WHEN** 日报生成成功且 OneBot 服务可用
- **THEN** SHALL 发送群消息，消息内容为日报文本

#### Scenario: Push failure
- **WHEN** OneBot 服务不可用或返回错误
- **THEN** SHALL 记录错误日志，日报 SHALL 仍然保存在 daily_reports 表中

#### Scenario: Configuration missing
- **WHEN** `ONEBOT_HTTP_URL` 或 `QQ_GROUP_ID` 未配置
- **THEN** 推送 SHALL 被跳过，日志输出警告，日报 SHALL 仍然生成并存储

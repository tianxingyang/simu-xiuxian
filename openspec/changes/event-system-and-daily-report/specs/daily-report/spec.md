## ADDED Requirements

### Requirement: Daily event aggregation
系统 SHALL 提供每日事件聚合功能，收集前一个现实天（00:00:00 ~ 23:59:59 UTC+8）内产生的所有 rank ≤ B 的事件，按新闻价值分级组织。

聚合输出结构：
- `headlines: RichEvent[]` — S 级事件，完整展开，按模拟年份升序
- `major_events: RichEvent[]` — A 级事件，完整展开，排序规则：参与者最高境界降序 → 模拟年份升序 → event_id 升序
- `statistics` — B 级事件聚合为统计数字，固定 schema：
  - `promotions: Record<string, number>` — 各境界晋升数（key 为 `"lv2"` ~ `"lv7"`，值为 0 时包含）
  - `combat_deaths: number` — 战斗死亡总数
  - `expiry_deaths: number` — 寿尽死亡总数
  - `notable_deaths: number` — 命名修士死亡数（B 级中涉及命名修士的寿尽/战斗死亡）
- `meta` — 元信息，固定 schema：
  - `real_date: string` — 现实日期（YYYY-MM-DD）
  - `year_from: number` — 当日模拟起始年份
  - `year_to: number` — 当日模拟结束年份
  - `years_simulated: number` — 当日模拟总年数（`year_to - year_from`）
  - `population_start: number` — 当日起始总人口
  - `population_end: number` — 当日结束总人口

#### Scenario: Normal day aggregation
- **WHEN** 前一天模拟了 370 年，产生 2 个 S 级事件、15 个 A 级事件、200 个 B 级事件
- **THEN** 聚合结果 SHALL 包含 2 个 headlines、15 个 major_events、B 级统计数字

#### Scenario: No events day
- **WHEN** 前一天模拟暂停或无 rank ≤ B 的事件产生
- **THEN** 聚合结果 SHALL 为空，但日报 SHALL 仍然生成——调用 LLM 生成一份简短的"天下太平"报道，推送到 QQ

#### Scenario: Bio enrichment
- **WHEN** S/A 级事件涉及命名修士
- **THEN** 聚合器 SHALL 从 named_cultivators 表查询该修士聚合时刻的当前状态（而非事件发生时的快照），附加到事件数据中。若查询结果为空（数据异常），SHALL 跳过该修士的履历附加并记录警告日志

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
- **WHEN** A 级事件超过 15 个
- **THEN** SHALL 截取前 15 个。排序规则：参与者最高境界降序 → 模拟年份升序 → event_id 升序

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
- **THEN** SHALL 记录错误日志，保留原始素材到 daily_reports 表（report 字段为空），QQ 推送 SHALL 跳过。支持后续通过 `POST /api/report?date=YYYY-MM-DD` 手动重试

#### Scenario: API key missing
- **WHEN** `DEEPSEEK_API_KEY` 环境变量未设置
- **THEN** 日报生成 SHALL 跳过 LLM 调用，仅保存原始素材，日志输出警告

### Requirement: Report storage
生成的日报 SHALL 存储到 SQLite `daily_reports` 表，包含：日期（UNIQUE）、模拟年份范围、完整 prompt（JSON）、LLM 生成的日报文本（成功时为字符串，LLM 失败时为 `NULL`）、创建时间戳。

#### Scenario: Report stored
- **WHEN** 日报生成成功
- **THEN** SHALL INSERT 一条记录，date 为 YYYY-MM-DD 格式

#### Scenario: Duplicate date prevention
- **WHEN** 同一天重复触发日报生成
- **THEN** SHALL UPDATE 现有记录而非 INSERT，覆盖旧的日报内容

### Requirement: Scheduled daily trigger
系统 SHALL 使用 `node-cron` 在每天固定时间（默认 08:00 UTC+8）自动触发日报生成。cron 时区 SHALL 显式配置为 `Asia/Shanghai`（不依赖系统时区）。定时时间 SHALL 可通过 `REPORT_CRON` 环境变量修改。

#### Scenario: Daily cron execution
- **WHEN** 系统时间到达 08:00
- **THEN** SHALL 自动触发日报聚合 + LLM 生成 + 推送流程

#### Scenario: Configurable time
- **WHEN** 配置中设置 `REPORT_CRON='0 20 * * *'`
- **THEN** 日报 SHALL 在每天 20:00 触发

#### Scenario: Startup missed-report backfill
- **WHEN** 进程启动时，检测到 `daily_reports` 表中昨天（UTC+8）无记录，且 `events` 表中存在昨天的事件
- **THEN** SHALL 自动触发一次昨天的日报生成

### Requirement: QQ Bot push
系统 SHALL 通过 OneBot v11 HTTP API 将日报文本推送到指定 QQ 群。

- OneBot HTTP 地址从配置 `ONEBOT_HTTP_URL` 读取
- 目标群号从配置 `QQ_GROUP_ID` 读取
- 可选认证令牌从 `ONEBOT_TOKEN` 环境变量读取，设置时 SHALL 在请求头中附加 `Authorization: Bearer <token>`
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

## PBT Properties

### Property: Aggregation partitions events correctly
UTC+8 日窗口 `[d 00:00, d+1 00:00)` 内的合格事件完全分类：S→headlines, A→major_events, B→statistics，计数守恒。聚合结果与输入顺序无关。
- **Falsification**: 在日边界随机生成事件 real_ts，打乱输入顺序，对比归一化聚合输出。

### Property: major_events deterministic sort and cap
`major_events` SHALL 按 (参与者最高境界 desc, simYear asc, event_id asc) 排序且 `length <= 15`。
- **Falsification**: 生成超量未排序 A 级事件（含并列），验证排序确定性和截断长度。

### Property: Report idempotent unique key
同一日期重复生成 → `daily_reports` 表该日期行数始终为 1，内容为最近一次结果。
- **Falsification**: 对同一日期多次触发（含失败/成功组合），断言行基数 = 1。

### Property: LLM failure isolation
API 失败 → raw material 保存（report = NULL）且 QQ 不推送；API 成功 → report 非 NULL。
- **Falsification**: 随机 stub API 成功/失败/超时，验证 DB 字段和推送行为的组合约束。

### Property: Cron timezone determinism
触发时间 SHALL 严格按 `Asia/Shanghai` 时区，不随宿主 TZ 变化。
- **Falsification**: 在不同 TZ 环境变量下启动，验证触发时刻一致。

### Property: QQ push shape
请求 SHALL 恰好为 `POST <ONEBOT_HTTP_URL>/send_group_msg`，body 含 `group_id`；`Authorization` header 存在 iff `ONEBOT_TOKEN` 已设置。推送失败不删除已存报告。
- **Falsification**: 排列配置组合 + mock OneBot 故障，验证请求形状和存储独立性。

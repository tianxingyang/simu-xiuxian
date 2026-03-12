# 日报生成管线

## Goal

实现完整的日报生成管线：事件聚合 → Prompt 构建 → DeepSeek API 调用 → 存储 → 推送。对应 OpenSpec tasks 7.1-7.6。

## Requirements

- 创建 `server/reporter.ts`，实现以下功能：
  - `aggregateEvents(from, to)` — 查询 events 表，按 UTC+8 日边界筛选，S 级→headlines，A 级→major_events（按境界降序→年份升序→id 升序，上限 15），B 级→statistics 聚合
  - S/A 级事件涉及命名修士时，查询 named_cultivators 表附加履历（bio enrichment）
  - `buildPrompt(aggregated)` — 组装 system message（修仙史官角色 + 日报体裁 + 800 字限制）+ user message（JSON 素材）
  - `callDeepSeek(prompt)` — HTTP POST `https://api.deepseek.com/v1/chat/completions`，model=deepseek-chat，temperature=0.7，max_tokens=2000
  - `generateDailyReport(date?)` — 完整流程：聚合→prompt→LLM→存储→推送
- 在 `server/index.ts` 注册 node-cron 定时任务（默认 `0 8 * * *` Asia/Shanghai），可通过 `REPORT_CRON` 环境变量配置
- `POST /api/report` 端点：手动触发日报生成，支持 `?date=YYYY-MM-DD`，有并发保护（busy 状态）
- 启动时 missed-report backfill：检测昨天无日报记录但有事件时自动补生成

## Acceptance Criteria

- [ ] `aggregateEvents` 正确按 UTC+8 日边界分组，S/A/B 分级正确
- [ ] A 级事件超 15 个时正确截断，排序规则符合 spec
- [ ] 无事件日仍生成"天下太平"日报
- [ ] DeepSeek API 调用成功时日报存入 daily_reports 表
- [ ] API 失败时保留原始素材（report=NULL），不推送
- [ ] DEEPSEEK_API_KEY 缺失时跳过 LLM 调用，仅存素材
- [ ] 同一日期重复生成时 UPDATE 而非 INSERT
- [ ] cron 定时任务按 Asia/Shanghai 时区触发
- [ ] POST /api/report 并发调用返回 `{ status: 'busy' }`
- [ ] 启动时 backfill 正确触发

## Technical Notes

- 详细 spec: `openspec/changes/event-system-and-daily-report/specs/daily-report/spec.md`
- 依赖已完成的 tasks 1-6（DB 层、身份系统、事件系统）
- QQ 推送部分由独立任务 `03-11-qq-bot-push` 负责，本任务中调用 bot.pushToQQ() 接口即可
- statistics schema: `{ promotions: Record<string, number>, combat_deaths, expiry_deaths, notable_deaths }`
- meta schema: `{ real_date, year_from, year_to, years_simulated, population_start, population_end }`

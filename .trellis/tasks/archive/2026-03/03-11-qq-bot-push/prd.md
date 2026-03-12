# QQ Bot 推送

## Goal

通过 OneBot v11 HTTP API 将日报文本推送到指定 QQ 群。对应 OpenSpec tasks 8.1-8.2。

## Requirements

- 创建 `server/bot.ts`，实现 `pushToQQ(text): Promise<boolean>`
  - HTTP POST `<ONEBOT_HTTP_URL>/send_group_msg`，body: `{ group_id, message }`
  - 支持可选 `ONEBOT_TOKEN` 环境变量，设置时附加 `Authorization: Bearer <token>` 请求头
- 配置缺失处理：`ONEBOT_HTTP_URL` 或 `QQ_GROUP_ID` 未配置时跳过推送，日志输出警告，返回 false
- 推送失败处理：OneBot 不可用或返回错误时记录错误日志，返回 false，不影响日报存储
- 配置项从 `server/config.ts` 读取（已有 ONEBOT_HTTP_URL、QQ_GROUP_ID）

## Acceptance Criteria

- [ ] 配置完整时正确发送 HTTP POST 到 OneBot
- [ ] ONEBOT_TOKEN 存在时请求头包含 Authorization
- [ ] 配置缺失时跳过推送并记录警告
- [ ] 推送失败时记录错误，不抛异常
- [ ] 日报存储不受推送结果影响

## Technical Notes

- 详细 spec: `openspec/changes/event-system-and-daily-report/specs/daily-report/spec.md` (QQ Bot push 部分)
- 仅需一个 HTTP POST 调用，无需 WebSocket 或长连接
- NapCat / LLOneBot 需要独立部署运行，本模块不管理 Bot 进程

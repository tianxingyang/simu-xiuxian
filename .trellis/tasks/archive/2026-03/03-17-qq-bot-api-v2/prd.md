# Migrate from OneBot to QQ Bot API v2

## Goal

将 QQ Bot 推送从 OneBot v11 HTTP API 迁移到 QQ 官方 Bot API v2，移除对第三方 OneBot 实现（NapCat/LLOneBot）的依赖。

## What I already know

- 当前实现：`server/bot.ts` 使用 OneBot v11 HTTP POST `/send_group_msg` 推送群消息
- 配置项：`ONEBOT_HTTP_URL`, `ONEBOT_TOKEN`, `QQ_GROUP_ID`（在 `server/config.ts`）
- 调用方：`server/reporter.ts` 的 `generateDailyReport()` 在生成日报后调用 `pushToQQ(report)`
- QQ Bot API v2 鉴权：AppID + AppSecret → OAuth AccessToken（7200s 有效期）
- QQ Bot API v2 群消息接口：`POST /v2/groups/{group_openid}/messages`
- 群标识使用 `group_openid`（非 QQ 群号），通过 `GROUP_ADD_ROBOT` 事件获取
- 事件订阅支持 WebSocket 和 Webhook 两种方式

## Critical Constraint

**主动推送能力已于 2025-04-21 停用**。QQ Bot API v2 群聊场景只能发送被动消息（需携带 msg_id 或 event_id）。

## Assumptions (temporary)

- 用户已在 QQ 开放平台注册机器人并获得 AppID / AppSecret
- 机器人已被添加到目标群聊（可获得 group_openid）

## Open Questions

1. ~~核心问题：推送模式~~ → **已决定：方案 A 被动回复 + 按需生成**
2. ~~首次请求行为~~ → **已决定：默认回溯最近 24 小时**

## Requirements

- 移除 OneBot v11 相关代码和配置，移除 cron 定时触发
- 使用 QQ Bot API v2 OAuth 鉴权（AppID + AppSecret → AccessToken）
- 被动回复群消息（携带 msg_id），接口 `/v2/groups/{group_openid}/messages`
- 新配置项：`QQ_BOT_APP_ID`, `QQ_BOT_APP_SECRET`
- WebSocket 连接 QQ Bot Gateway，订阅 GROUP_AND_C2C_EVENT (1<<25)
- 监听 GROUP_AT_MESSAGE_CREATE，支持两个命令：
  - "日报"：聚合「上次请求时间 → 当前时间」的事件，生成日报
  - "传记 <名字>"：调用已有 generateBiography，返回修士传记
- 日报按需生成，首次请求默认回溯最近 24 小时
- 持久化每个群的 last_request_time（SQLite `bot_request_log` 表）
- AccessToken 自动刷新（7200s 有效期，过期前获取新 token）
- WebSocket 断线自动重连（指数退避）

## Acceptance Criteria

- [ ] OneBot 代码/配置/cron 完全移除
- [ ] WebSocket 连接 QQ Bot Gateway，断线自动重连
- [ ] @机器人 + "日报" → 生成时间段内日报并回复
- [ ] @机器人 + "传记 X" → 返回修士传记
- [ ] AccessToken 过期前自动刷新
- [ ] 配置缺失时优雅跳过（不崩溃）
- [ ] 推送失败不影响日报存储

## Definition of Done

- Lint / typecheck 通过
- 配置缺失时不崩溃
- 文档（README 环境变量部分）更新

## Out of Scope (explicit)

- 富媒体消息（Markdown/Ark/Embed）— 仅文本
- 频道消息支持
- 单聊消息支持
- 除"日报"和"传记"外的其他命令

## Technical Notes

### QQ Bot API v2 鉴权流程

```
POST https://bots.qq.com/app/getAppAccessToken
Body: { "appId": "xxx", "clientSecret": "xxx" }
Response: { "access_token": "xxx", "expires_in": "7200" }
```

### 群消息发送接口

```
POST https://api.sgroup.qq.com/v2/groups/{group_openid}/messages
Headers: { "Authorization": "QQBot {ACCESS_TOKEN}" }
Body: { "content": "消息文本", "msg_type": 0 }
```

- 被动消息需携带 `msg_id` 或 `event_id`
- 主动消息已于 2025-04-21 停用

### 事件订阅（WebSocket）

- Gateway: `wss://api.sgroup.qq.com/websocket/`
- Intents: `GROUP_AND_C2C_EVENT` (1 << 25) — 包含 GROUP_AT_MESSAGE_CREATE
- 鉴权: OpCode 2 Identify with `"QQBot {AccessToken}"`

### 影响文件

- `server/bot.ts` — 重写：Gateway WS + OAuth + 命令路由 + 被动回复
- `server/config.ts` — 替换配置项，移除 onebot/cron 相关
- `server/reporter.ts` — aggregateEvents 改为接受时间戳范围
- `server/db.ts` — 新增 bot_request_log 表
- `server/index.ts` — 移除 cron，启动 bot 连接，传递 runner 上下文
- `README.md` — 更新环境变量和架构说明

### 官方 SDK

- Node.js: [bot-node-sdk](https://github.com/tencent-connect/bot-node-sdk)
- 考虑直接使用 REST API（避免引入重依赖）

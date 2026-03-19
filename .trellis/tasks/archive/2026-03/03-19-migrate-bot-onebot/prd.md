# Migrate QQ Bot back to OneBot v11

## Goal

将 QQ 机器人从官方 Bot API v2 迁回 OneBot v11 协议（NapCat/LLOneBot），因官方 API 支持度有问题。

## What I already know

- 当前实现：`server/bot.ts` 使用 QQ 官方 Bot API v2
  - OAuth 鉴权（AppID + AppSecret → AccessToken）
  - WebSocket 连接官方 Gateway，监听 GROUP_AT_MESSAGE_CREATE
  - 被动回复（必须携带 msg_id），主动推送已于 2025-04-21 停用
  - 支持命令：日报、传记
  - LLM Job dispatch 机制（submitJob / pendingJobs / onLlmResult）
- 旧实现（commit 47f1c41）：OneBot v11 HTTP POST
  - 单一 `pushToQQ(text)` 函数，仅推送无接收
  - 配置：`ONEBOT_HTTP_URL`, `ONEBOT_TOKEN`, `QQ_GROUP_ID`
  - 通过 NapCat/LLOneBot 实现
- OneBot v11 优势：
  - 可主动推送消息（不受官方 API 限制）
  - 协议成熟，NapCat 等实现稳定
  - 配置简单（HTTP URL + Token）

## Assumptions (temporary)

- 用户本地已部署 NapCat 或类似 OneBot v11 实现
- OneBot 实现提供 HTTP API 和正向/反向 WebSocket

## Open Questions

1. 是否保留当前的命令交互功能（日报、传记）？还是只需要推送？
2. 消息接收方式：正向 WS / 反向 WS / HTTP POST？

## Requirements (evolving)

- 移除 QQ 官方 Bot API v2 代码（OAuth、Gateway WS）
- 使用 OneBot v11 HTTP API 发送群消息
- 配置项改回 OneBot 风格

## Acceptance Criteria (evolving)

- [ ] 能通过 OneBot HTTP API 发送群消息
- [ ] 配置缺失时优雅跳过
- [ ] lint / typecheck 通过

## Out of Scope (explicit)

- NapCat 部署和配置（用户自行管理）

## Technical Notes

- `server/bot.ts` — 需要重写
- `server/config.ts` — 配置项替换
- `server/index.ts` — bot 启动方式调整
- LLM Job dispatch 机制（onLlmResult / submitJob）需保留或调整

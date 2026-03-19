# Unified Logger Module

## Goal
Replace scattered `console.log/warn/error` + manual timestamp patches with a shared logger supporting levels, scopes, and file rotation.

## Requirements
- Create `server/logger.ts` as the single logging utility
- Support log levels: debug, info, warn, error
- Configurable via `LOG_LEVEL` env var (default: info)
- Scoped loggers with tags: `logger.scope('bot')` → `[bot]`
- Centralized UTC+8 timestamp formatting
- Replace all 3 console patches (gateway, llm-worker, sim-worker)
- Replace all `console.log/warn/error` in server/ with logger calls
- Add bot.ts happy-path logging (received command, dispatched job, result sent)
- Reduce eviction logs to debug level
- Add size-based log rotation in CLI (max 2MB, keep 3 files)

## Acceptance Criteria
- [ ] `server/logger.ts` exists with level filtering + scope support
- [ ] All server files use logger instead of raw console
- [ ] `LOG_LEVEL=debug` shows all, `LOG_LEVEL=warn` hides info/debug
- [ ] Bot normal flow has info-level logs
- [ ] Eviction logs are debug level (hidden by default)
- [ ] CLI rotates backend.log when exceeding 2MB
- [ ] No console patch blocks remain in any process entry file

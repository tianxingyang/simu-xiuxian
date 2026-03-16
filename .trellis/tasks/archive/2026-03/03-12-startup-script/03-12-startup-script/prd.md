# Startup Script - Interactive Console

## Goal

Create an interactive bash console (`cli.sh`) that manages environment configuration, service lifecycle, and operational controls for the simu-xiuxian project.

## Requirements

- Interactive menu console (bash script, zero dependencies)
- Start/stop all services (backend + frontend), running in background with PID tracking
- Start/stop individual services (backend only / frontend only)
- Service status display (running/stopped, PID, port)
- Environment variable configuration via interactive editor, persisted to `.env`
- Auto-load `.env` on service startup
- Manual trigger daily report generation (POST /api/report)
- View real-time logs (tail backend/frontend log files)
- Database reset with confirmation prompt (delete SQLite file)
- PID files in `.pid/`, logs in `.logs/`, both gitignored

## Acceptance Criteria

- [ ] `./cli.sh` launches interactive menu
- [ ] Can start/stop backend and frontend via menu
- [ ] Can interactively configure env vars, persisted to `.env`
- [ ] Can view service status (running/stopped + PID)
- [ ] Can manually trigger daily report
- [ ] Can view real-time logs
- [ ] Can reset database (with confirmation)
- [ ] `.env`, `.pid/`, `.logs/` are gitignored

## Definition of Done

- Lint clean (shellcheck if available)
- All menu options functional
- `.gitignore` updated

## Out of Scope

- systemd/docker deployment
- Production environment config
- Auto-restart / daemon / watchdog
- Windows support

## Technical Notes

- Backend: `npm run server:dev` (tsx server/index.ts) on PORT (default 3001)
- Frontend: `npm run dev` (vite) on port 5173
- Env vars read in `server/config.ts`
- Daily report endpoint: `POST http://localhost:$PORT/api/report`
- DB file: `$DB_PATH` (default `./data/simu-xiuxian.db`)

# Telegram activity monitoring (adapted for Exco Express + Vite)

Production wiring lives in:

- `lib/telegramLogger.mjs` — send messages (server only)
- `src/hooks/useActivityLogger.js` — React Router page views
- `POST /api/activity-log` in `server.js` — authenticated client logs
- Login/logout Telegram events fire from `/api/auth/login` and `/api/auth/logout`

Configure in `.env`:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_MONITORED_USERS=email1@example.com,username2
TELEGRAM_MONITOR_ALL=0
```

Or edit the `MONITORED_USERS` array in `lib/telegramLogger.mjs`.

Do not commit bot tokens into source files.

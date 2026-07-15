# Telegram activity monitoring (adapted for Exco Express + Vite)

## Push alerts (optional monitored users)
- `lib/telegramLogger.mjs`
- Login/logout from `/api/auth/login` and `/api/auth/logout`
- Page views via `src/hooks/useActivityLogger.js` → `POST /api/activity-log`

## Chat the bot (Q&A)
After the server is running, message your bot in the configured Telegram chat:

- `/lastlogin jane` or `when did jane last login`
- `/recent jane 10`
- `/help`

Only `TELEGRAM_CHAT_ID` is answered. History comes from `User_Activity_Log` (all logins are stored; push alerts still respect the monitored list).

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_MONITORED_USERS=email1@example.com
TELEGRAM_MONITOR_ALL=0
TELEGRAM_BOT_POLL=1
```

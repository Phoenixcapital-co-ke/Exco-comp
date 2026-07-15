// Long-polling Telegram bot for activity Q&A (authorized chat only).

import {
  getLastLogin,
  getRecentActivity,
  getRecentFailedLogins,
  getRecentErrors,
} from './userActivity.mjs'

function getConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim()
  const enabled = !['0', 'false', 'no'].includes(
    String(process.env.TELEGRAM_BOT_POLL || '1').toLowerCase()
  )
  return {
    token,
    chatId,
    enabled: enabled && !!token && !!chatId,
    apiBase: token ? `https://api.telegram.org/bot${token}` : null,
  }
}

async function replyPlain(chatId, text) {
  const { apiBase } = getConfig()
  if (!apiBase) return
  try {
    await fetch(`${apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).slice(0, 4000),
      }),
    })
  } catch (e) {
    console.warn('[TelegramBot] reply failed:', e.message)
  }
}

function helpText() {
  return (
    `Phoenix activity bot\n\n` +
    `Commands:\n` +
    `/lastlogin <user> — last login time\n` +
    `/recent <user> [n] — last n events (default 5)\n` +
    `/failed [user] [n] — recent failed logins\n` +
    `/errors [n] — recent app/auth errors\n` +
    `/help — this message\n\n` +
    `Or ask in plain English, e.g.\n` +
    `"when did jane last login"\n` +
    `"failed logins for jane"`
  )
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} text
 */
function handleQuery(db, text) {
  const raw = String(text || '').trim()
  if (!raw) return helpText()

  const lower = raw.toLowerCase()
  if (lower === '/help' || lower === 'help' || lower === '/start') {
    return helpText()
  }

  let m = raw.match(/^\/lastlogin(?:@\w+)?\s+(.+)$/i)
  if (m) return getLastLogin(db, m[1].trim()).message

  m = raw.match(/^\/recent(?:@\w+)?\s+(\S+)(?:\s+(\d+))?$/i)
  if (m) return getRecentActivity(db, m[1], m[2] ? Number(m[2]) : 5).message

  m = raw.match(/^\/failed(?:@\w+)?(?:\s+(\S+))?(?:\s+(\d+))?$/i)
  if (m || lower === '/failed') {
    const maybeUser = m?.[1]
    const maybeLimit = m?.[2]
    // "/failed 10" → limit only; "/failed jane 5" → user + limit
    if (maybeUser && /^\d+$/.test(maybeUser) && !maybeLimit) {
      return getRecentFailedLogins(db, '', Number(maybeUser)).message
    }
    return getRecentFailedLogins(db, maybeUser || '', maybeLimit ? Number(maybeLimit) : 10).message
  }

  m = raw.match(/^\/errors(?:@\w+)?(?:\s+(\d+))?$/i)
  if (m || lower === '/errors') {
    return getRecentErrors(db, m?.[1] ? Number(m[1]) : 10).message
  }

  m =
    raw.match(/last\s+login\s+for\s+(.+)$/i) ||
    raw.match(/when\s+(?:was\s+the\s+last\s+time\s+)?(.+?)\s+(?:last\s+)?(?:logged\s*in|login)/i) ||
    raw.match(/when\s+did\s+(.+?)\s+last\s+login/i) ||
    raw.match(/last\s+time\s+(.+?)\s+logged\s*in/i)
  if (m) {
    const who = m[1].replace(/[?!.]+$/g, '').trim()
    return getLastLogin(db, who).message
  }

  m =
    raw.match(/failed\s+logins?(?:\s+for)?\s+(.+)$/i) ||
    raw.match(/failed\s+logins?/i)
  if (m) {
    const who = m[1] ? m[1].replace(/[?!.]+$/g, '').trim() : ''
    return getRecentFailedLogins(db, who, 10).message
  }

  if (/recent\s+errors?/i.test(raw) || /^errors?$/i.test(raw)) {
    return getRecentErrors(db, 10).message
  }

  m = raw.match(/recent\s+activity\s+(?:for\s+)?(.+)$/i)
  if (m) {
    return getRecentActivity(db, m[1].replace(/[?!.]+$/g, '').trim(), 5).message
  }

  return `I didn't understand that.\n\n${helpText()}`
}

/**
 * Start long-polling in the background. Call once per process.
 * @param {import('better-sqlite3').Database} db
 */
export function startTelegramBot(db) {
  const { enabled } = getConfig()
  if (!enabled) {
    console.log('[TelegramBot] Polling disabled or missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID')
    return { stop: () => {} }
  }

  let offset = 0
  let stopped = false

  const pollLoop = async () => {
    console.log('[TelegramBot] Listening for commands in configured chat')
    while (!stopped) {
      const cfg = getConfig()
      if (!cfg.enabled || !cfg.apiBase) {
        await new Promise((r) => setTimeout(r, 10000))
        continue
      }
      let data
      try {
        const res = await fetch(
          `${cfg.apiBase}/getUpdates?timeout=25&offset=${offset}` +
            `&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`
        )
        data = await res.json()
      } catch (e) {
        console.warn('[TelegramBot] poll error:', e.message)
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      if (!data?.ok) {
        console.warn('[TelegramBot] getUpdates failed:', data?.description || data)
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      for (const upd of data.result || []) {
        offset = upd.update_id + 1
        const msg = upd.message
        if (!msg?.text) continue
        const fromChat = String(msg.chat?.id ?? '')
        if (fromChat !== String(cfg.chatId)) continue
        try {
          await replyPlain(fromChat, handleQuery(db, msg.text))
        } catch (e) {
          console.warn('[TelegramBot] handle error:', e.message)
          await replyPlain(fromChat, 'Sorry, something went wrong answering that.')
        }
      }
    }
  }

  pollLoop().catch((e) => console.error('[TelegramBot] stopped:', e.message))

  return {
    stop: () => {
      stopped = true
    },
  }
}

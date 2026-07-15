// Server-side Telegram activity logger for monitored users.
// All logins/logouts/page views are stored in SQLite for chat Q&A.
// Push alerts to Telegram only for monitored users.

import { recordUserActivity } from './userActivity.mjs'

// Add emails, usernames, or user ids to track for push alerts. Example:
//   ["john@phoenixcapital.co.ke", "jane"]
const MONITORED_USERS = [
  // "john@example.com",
]

/** @type {import('better-sqlite3').Database | null} */
let activityDb = null

/** @param {import('better-sqlite3').Database} db */
export function setActivityDb(db) {
  activityDb = db
}

function getTelegramConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim()
  return {
    token,
    chatId,
    api: token ? `https://api.telegram.org/bot${token}/sendMessage` : null,
    monitorAll: ['1', 'true', 'yes'].includes(
      String(process.env.TELEGRAM_MONITOR_ALL || '').toLowerCase()
    ),
    envMonitored: String(process.env.TELEGRAM_MONITORED_USERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

async function sendToTelegram(message) {
  const { api, chatId } = getTelegramConfig()
  if (!api || !chatId) return
  try {
    const response = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      console.error('[TelegramLogger] Failed to send:', data.description)
    }
  } catch (err) {
    console.error('[TelegramLogger] Error:', err.message)
  }
}

function shouldMonitor(user) {
  if (!user) return false
  const { monitorAll, envMonitored } = getTelegramConfig()
  if (monitorAll) return true
  const list = [...MONITORED_USERS, ...envMonitored]
  if (list.length === 0) return false

  const candidates = [user.email, user.username, user.id, user.fullName, user.name]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).toLowerCase())

  return list.some((m) => candidates.includes(String(m).toLowerCase()))
}

function formatUser(user) {
  const name =
    user.fullName || user.name || user.displayName || user.username || 'Unknown'
  const email = user.email ? ` (${user.email})` : ''
  return `<b>${escapeHtml(name)}</b>${email ? escapeHtml(email) : ''}`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatTime() {
  return new Date().toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function persist(type, user, extra = {}) {
  if (!activityDb) return
  recordUserActivity(activityDb, { type, user: user || {}, ...extra })
}

function alertFailedLoginsEnabled() {
  // Default ON when Telegram is configured
  return !['0', 'false', 'no'].includes(
    String(process.env.TELEGRAM_ALERT_FAILED_LOGINS || '1').toLowerCase()
  )
}

function alertErrorsEnabled() {
  return !['0', 'false', 'no'].includes(
    String(process.env.TELEGRAM_ALERT_ERRORS || '1').toLowerCase()
  )
}

/** @param {object} user */
export async function logLogin(user) {
  persist('login', user)
  if (!shouldMonitor(user)) return
  const msg =
    `🔐 <b>Login</b>\n` +
    `👤 User: ${formatUser(user)}\n` +
    `🕐 Time: ${formatTime()}`
  await sendToTelegram(msg)
}

/**
 * Always stored. Telegram alert goes to the configured chat (security).
 * @param {{ loginId?: string, user?: object|null, reason: string, ip?: string, statusCode?: number }} opts
 */
export async function logLoginFailed(opts = {}) {
  const reason = String(opts.reason || 'Login failed').slice(0, 500)
  const loginId = String(opts.loginId || opts.user?.username || opts.user?.email || 'unknown').trim()
  const user =
    opts.user ||
    ({
      username: loginId,
      email: loginId.includes('@') ? loginId : null,
      fullName: null,
      id: null,
    })
  // Store IP in page column for failed attempts (no schema change)
  persist('login_failed', user, {
    action: reason,
    page: opts.ip ? String(opts.ip).slice(0, 128) : null,
    title: opts.statusCode != null ? String(opts.statusCode) : null,
  })

  if (!alertFailedLoginsEnabled()) return
  const who = opts.user ? formatUser(opts.user) : `<b>${escapeHtml(loginId)}</b>`
  const msg =
    `🚫 <b>Failed login</b>\n` +
    `👤 Attempt: ${who}\n` +
    `📝 ${escapeHtml(reason)}\n` +
    (opts.ip ? `🌐 IP: <code>${escapeHtml(opts.ip)}</code>\n` : '') +
    `🕐 Time: ${formatTime()}`
  await sendToTelegram(msg)
}

/**
 * App/server error — always stored; Telegram when enabled.
 * @param {{ message: string, source?: string, user?: object|null, stack?: string }} opts
 */
export async function logError(opts = {}) {
  const message = String(opts.message || 'Unknown error').slice(0, 1000)
  const source = String(opts.source || 'server').slice(0, 120)
  const user = opts.user || null
  persist('error', user || { username: null }, {
    action: message,
    title: source,
    page: opts.stack ? String(opts.stack).slice(0, 500) : null,
  })

  if (!alertErrorsEnabled()) return
  const who = user ? `\n👤 User: ${formatUser(user)}` : ''
  const msg =
    `⚠️ <b>Error</b>\n` +
    `📍 <code>${escapeHtml(source)}</code>${who}\n` +
    `📝 ${escapeHtml(message)}\n` +
    `🕐 Time: ${formatTime()}`
  await sendToTelegram(msg)
}

/** @param {object} user */
export async function logLogout(user) {
  persist('logout', user)
  if (!shouldMonitor(user)) return
  const msg =
    `🚪 <b>Logout</b>\n` +
    `👤 User: ${formatUser(user)}\n` +
    `🕐 Time: ${formatTime()}`
  await sendToTelegram(msg)
}

/**
 * @param {object} user
 * @param {string} page
 * @param {string} [title]
 */
export async function logPageView(user, page, title = '') {
  persist('pageView', user, { page, title })
  if (!shouldMonitor(user)) return
  const label = title ? `${title} (${page})` : page
  const msg =
    `📄 <b>Page View</b>\n` +
    `👤 User: ${formatUser(user)}\n` +
    `🗂 Page: <code>${escapeHtml(label)}</code>\n` +
    `🕐 Time: ${formatTime()}`
  await sendToTelegram(msg)
}

/**
 * @param {object} user
 * @param {string} action
 */
export async function logAction(user, action) {
  persist('action', user, { action })
  if (!shouldMonitor(user)) return
  const msg =
    `⚡ <b>Action</b>\n` +
    `👤 User: ${formatUser(user)}\n` +
    `📝 ${escapeHtml(action)}\n` +
    `🕐 Time: ${formatTime()}`
  await sendToTelegram(msg)
}

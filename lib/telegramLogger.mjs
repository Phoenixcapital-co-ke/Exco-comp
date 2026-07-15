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
  if (!activityDb || !user) return
  recordUserActivity(activityDb, { type, user, ...extra })
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

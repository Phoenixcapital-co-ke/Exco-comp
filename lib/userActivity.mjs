// Persist and query user activity for Telegram Q&A and monitoring.

/**
 * @param {import('better-sqlite3').Database} db
 */
export function initUserActivityTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS User_Activity_Log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      email TEXT,
      full_name TEXT,
      event_type TEXT NOT NULL,
      page TEXT,
      title TEXT,
      action TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_user_activity_created ON User_Activity_Log (created_at DESC)`
  ).run()
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_user_activity_user ON User_Activity_Log (user_id, event_type, created_at DESC)`
  ).run()
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_user_activity_username ON User_Activity_Log (username COLLATE NOCASE)`
  ).run()
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ type: string, user?: object, page?: string, title?: string, action?: string }} evt
 */
export function recordUserActivity(db, evt) {
  if (!db || !evt?.type) return
  const user = evt.user || {}
  try {
    db.prepare(
      `INSERT INTO User_Activity_Log
        (user_id, username, email, full_name, event_type, page, title, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      user.id ?? null,
      user.username ?? null,
      user.email ?? null,
      user.fullName || user.name || null,
      String(evt.type),
      evt.page ?? null,
      evt.title ?? null,
      evt.action ?? null
    )
  } catch (e) {
    console.warn('[UserActivity] record failed:', e.message)
  }
}

function nairobiTime(isoOrSqlite) {
  if (!isoOrSqlite) return 'unknown'
  // SQLite datetime('now') is UTC-ish; treat as UTC for display
  const raw = String(isoOrSqlite)
  const asUtc = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
  const d = new Date(asUtc)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
}

/**
 * Find best matching user activity identity from a free-text query.
 * @param {import('better-sqlite3').Database} db
 * @param {string} query
 */
export function findActivityUser(db, query) {
  const q = String(query || '').trim()
  if (!q) return null

  // Prefer live Users table when available
  try {
    const user = db
      .prepare(
        `SELECT id, username, email, full_name
         FROM Users
         WHERE lower(username) = lower(?)
            OR lower(COALESCE(email,'')) = lower(?)
            OR lower(COALESCE(full_name,'')) = lower(?)
            OR username LIKE ?
            OR email LIKE ?
            OR full_name LIKE ?
         ORDER BY
           CASE
             WHEN lower(username) = lower(?) THEN 0
             WHEN lower(COALESCE(email,'')) = lower(?) THEN 1
             WHEN lower(COALESCE(full_name,'')) = lower(?) THEN 2
             ELSE 3
           END
         LIMIT 1`
      )
      .get(q, q, q, `%${q}%`, `%${q}%`, `%${q}%`, q, q, q)
    if (user) {
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
      }
    }
  } catch {
    // Users table may be unavailable in some contexts
  }

  const row = db
    .prepare(
      `SELECT user_id, username, email, full_name
       FROM User_Activity_Log
       WHERE lower(COALESCE(username,'')) = lower(?)
          OR lower(COALESCE(email,'')) = lower(?)
          OR lower(COALESCE(full_name,'')) = lower(?)
          OR username LIKE ?
          OR email LIKE ?
          OR full_name LIKE ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(q, q, q, `%${q}%`, `%${q}%`, `%${q}%`)
  if (!row) return null
  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} query username/email/name fragment
 */
export function getLastLogin(db, query) {
  const user = findActivityUser(db, query)
  if (!user) return { found: false, message: `No user matched "${query}".` }

  const clauses = []
  const params = []
  if (user.id != null) {
    clauses.push('user_id = ?')
    params.push(user.id)
  }
  if (user.username) {
    clauses.push('lower(username) = lower(?)')
    params.push(user.username)
  }
  if (user.email) {
    clauses.push('lower(email) = lower(?)')
    params.push(user.email)
  }
  if (!clauses.length) {
    return { found: false, message: `No activity identity for "${query}".` }
  }

  const row = db
    .prepare(
      `SELECT * FROM User_Activity_Log
       WHERE event_type = 'login' AND (${clauses.join(' OR ')})
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 1`
    )
    .get(...params)

  const label = [user.fullName, user.username, user.email].filter(Boolean).join(' / ')
  if (!row) {
    return {
      found: true,
      user,
      message: `No login recorded yet for ${label}.`,
    }
  }
  return {
    found: true,
    user,
    row,
    message: `Last login for ${label}:\n${nairobiTime(row.created_at)} (Africa/Nairobi)`,
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} query
 * @param {number} [limit]
 */
export function getRecentActivity(db, query, limit = 5) {
  const user = findActivityUser(db, query)
  if (!user) return { found: false, message: `No user matched "${query}".` }

  const clauses = []
  const params = []
  if (user.id != null) {
    clauses.push('user_id = ?')
    params.push(user.id)
  }
  if (user.username) {
    clauses.push('lower(username) = lower(?)')
    params.push(user.username)
  }
  if (user.email) {
    clauses.push('lower(email) = lower(?)')
    params.push(user.email)
  }

  const lim = Math.min(Math.max(Number(limit) || 5, 1), 20)
  const rows = db
    .prepare(
      `SELECT * FROM User_Activity_Log
       WHERE (${clauses.join(' OR ')})
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`
    )
    .all(...params, lim)

  const label = [user.fullName, user.username, user.email].filter(Boolean).join(' / ')
  if (!rows.length) {
    return { found: true, message: `No activity recorded for ${label}.` }
  }

  const lines = rows.map((r) => {
    const detail =
      r.event_type === 'pageView'
        ? `page ${r.page || '?'}`
        : r.event_type === 'login_failed' || r.event_type === 'error'
          ? `${r.event_type}: ${r.action || '?'}`
          : r.event_type === 'action'
            ? r.action || 'action'
            : r.event_type
    return `• ${nairobiTime(r.created_at)} — ${detail}`
  })
  return {
    found: true,
    message: `Recent activity for ${label}:\n${lines.join('\n')}`,
  }
}

/**
 * Recent failed logins (optionally filtered by user/attempted id).
 * @param {import('better-sqlite3').Database} db
 * @param {string} [query]
 * @param {number} [limit]
 */
export function getRecentFailedLogins(db, query = '', limit = 10) {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 30)
  const q = String(query || '').trim()
  let rows
  if (q) {
    rows = db
      .prepare(
        `SELECT * FROM User_Activity_Log
         WHERE event_type = 'login_failed'
           AND (
             lower(COALESCE(username,'')) LIKE lower(?)
             OR lower(COALESCE(email,'')) LIKE lower(?)
             OR lower(COALESCE(full_name,'')) LIKE lower(?)
             OR lower(COALESCE(action,'')) LIKE lower(?)
           )
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ?`
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, lim)
  } else {
    rows = db
      .prepare(
        `SELECT * FROM User_Activity_Log
         WHERE event_type = 'login_failed'
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ?`
      )
      .all(lim)
  }
  if (!rows.length) {
    return { found: false, message: q ? `No failed logins matched "${q}".` : 'No failed logins recorded yet.' }
  }
  const lines = rows.map((r) => {
    const who = [r.full_name, r.username, r.email].filter(Boolean).join(' / ') || 'unknown'
    return `• ${nairobiTime(r.created_at)} — ${who}\n  ${r.action || 'failed'}${r.page ? ` [ip ${r.page}]` : ''}`
  })
  return { found: true, message: `Failed logins:\n${lines.join('\n')}` }
}

/**
 * Recent error events.
 * @param {import('better-sqlite3').Database} db
 * @param {number} [limit]
 */
export function getRecentErrors(db, limit = 10) {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 30)
  const rows = db
    .prepare(
      `SELECT * FROM User_Activity_Log
       WHERE event_type = 'error'
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`
    )
    .all(lim)
  if (!rows.length) {
    return { found: false, message: 'No errors recorded yet.' }
  }
  const lines = rows.map((r) => {
    const who = [r.username, r.email].filter(Boolean).join(' / ')
    const src = r.title ? `[${r.title}] ` : ''
    return `• ${nairobiTime(r.created_at)}${who ? ` — ${who}` : ''}\n  ${src}${r.action || 'error'}`
  })
  return { found: true, message: `Recent errors:\n${lines.join('\n')}` }
}

export { nairobiTime }

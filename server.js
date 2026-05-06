import express from 'express'
import cors from 'cors'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import Database from 'better-sqlite3'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import cron from 'node-cron'
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import axios from 'axios'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isProduction = process.env.NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-me-in-production'
const JWT_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 24)
const AUTH_COOKIE_NAME = 'pcdash_auth'
const COOKIE_SECURE =
  typeof process.env.COOKIE_SECURE !== 'undefined'
    ? ['1', 'true', 'yes'].includes(String(process.env.COOKIE_SECURE).toLowerCase())
    : isProduction
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: COOKIE_SECURE,
  maxAge: JWT_TTL_HOURS * 60 * 60 * 1000,
  path: '/'
}

const events = new EventEmitter()
const db = new Database('data/app.db', { readonly: true });
// Separate write-enabled handle for inserts/updates
const dbRW = new Database('data/app.db');

// --- SMS log table (dedupe) ---
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS TopUp_SMS_Log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    send_date TEXT NOT NULL,
    slot TEXT NOT NULL,
    client_id TEXT,
    phone TEXT,
    status TEXT,
    response TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(send_date, slot, client_id)
  );
`)

// --- Collection arrears SMS log (dedupe per day+slot+client) ---
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Collection_Arrears_SMS_Log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    send_date TEXT NOT NULL,
    slot TEXT NOT NULL,
    client_id TEXT,
    phone TEXT,
    total_outstanding REAL,
    status TEXT,
    response TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(send_date, slot, client_id)
  );
`)

// Migrate old SMS log schema (client+loan dedupe) → new schema (client-only dedupe)
try {
  const cols = dbRW.prepare(`PRAGMA table_info(TopUp_SMS_Log);`).all().map((c) => c.name)
  if (cols.includes('loan_id')) {
    dbRW.exec('BEGIN')
    dbRW.exec(`
      CREATE TABLE IF NOT EXISTS TopUp_SMS_Log_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        send_date TEXT NOT NULL,
        slot TEXT NOT NULL,
        client_id TEXT,
        phone TEXT,
        status TEXT,
        response TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(send_date, slot, client_id)
      );
    `)
    dbRW.exec(`
      INSERT OR IGNORE INTO TopUp_SMS_Log_v2 (send_date, slot, client_id, phone, status, response, created_at)
      SELECT send_date, slot, client_id, phone, status, response, created_at
      FROM TopUp_SMS_Log
    `)
    dbRW.exec(`DROP TABLE TopUp_SMS_Log`)
    dbRW.exec(`ALTER TABLE TopUp_SMS_Log_v2 RENAME TO TopUp_SMS_Log`)
    dbRW.exec('COMMIT')
  }
} catch (e) {
  try { dbRW.exec('ROLLBACK') } catch {}
  console.warn('[SMS] TopUp_SMS_Log migration skipped:', e.message)
}

// --- FX rates (cached) ---
// NOTE: the /api/fx/rates route is registered after CORS middleware below,
// otherwise the browser blocks it (no Access-Control-Allow-Origin header).
let fxCache = { fetchedAt: 0, base: 'USD', rates: null }
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

async function fetchFxRatesUSD() {
  // Free endpoint that returns many currency rates with base USD
  const url = 'https://open.er-api.com/v6/latest/USD'
  const resp = await fetch(url, { headers: { 'User-Agent': 'PhoenixDashboard/1.0' } })
  if (!resp.ok) throw new Error(`FX fetch failed: ${resp.status}`)
  const json = await resp.json()
  if (!json || json.result !== 'success' || !json.rates) throw new Error('FX fetch returned invalid payload')
  return { base: 'USD', rates: json.rates, fetchedAt: Date.now() }
}
// Ensure PAR table exists
dbRW.prepare('CREATE TABLE IF NOT EXISTS PAR (time TEXT, Past_Arrears_missed REAL)').run();
// Add Open_loans column if it doesn't exist
try {
  dbRW.prepare('ALTER TABLE PAR ADD COLUMN Open_loans REAL').run();
} catch (e) {
  // Column already exists, ignore
}
// Create tables for branch-level loan data
// Store full loan records as JSON with branch_code and timestamp
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS Open_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_code TEXT NOT NULL,
    loan_data TEXT NOT NULL,
    time TEXT NOT NULL
  )
`).run();
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS Past_Missed_repayment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_code TEXT NOT NULL,
    loan_data TEXT NOT NULL,
    time TEXT NOT NULL
  )
`).run();
// History table: daily last record per Borrower Access ID for PAR
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS PAR_Borrower_Access_History (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_time TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    officer_id TEXT NOT NULL,
    open_loans REAL NOT NULL,
    past_missed REAL NOT NULL,
    par_rate REAL NOT NULL,
    branches TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(officer_id, snapshot_date)
  )
`).run();
// Add indexes for faster queries on time/date columns
try {
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_open_loans_time ON Open_loans(time)').run();
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_past_missed_time ON Past_Missed_repayment(time)').run();
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_par_time ON PAR(time)').run();
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_par_borrower_hist_date ON PAR_Borrower_Access_History(snapshot_date)').run();
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_par_borrower_hist_officer ON PAR_Borrower_Access_History(officer_id)').run();
} catch (e) {
  // Indexes might already exist, ignore
}
// Create table to track PAR snapshot last run time
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS PAR_Snapshot_LastRun (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_run_time TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS DataRefresh_Status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_run_time TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();


// Oversea durable local storage tables
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS oversea_vehicles (
    product_id TEXT PRIMARY KEY,
    db_id TEXT NOT NULL,
    system_no TEXT,
    model_id TEXT,
    model TEXT,
    imei TEXT,
    group_id TEXT,
    group_name TEXT,
    company_id TEXT,
    company_name TEXT,
    phone_number1 TEXT,
    object_id TEXT,
    name TEXT,
    owner_name TEXT,
    owner_phone TEXT,
    brand TEXT,
    type TEXT,
    iccid TEXT,
    veh_id TEXT,
    tot_id TEXT,
    timezone TEXT,
    server_ip TEXT,
    tracker_status TEXT,
    activate_time TEXT,
    expire_date TEXT,
    cexpire_date TEXT,
    last_sync_at TEXT DEFAULT CURRENT_TIMESTAMP,
    source_payload TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_oversea_vehicles_db_id ON oversea_vehicles(db_id);
  CREATE INDEX IF NOT EXISTS idx_oversea_vehicles_system_no ON oversea_vehicles(system_no);
`);

dbRW.exec(`
  CREATE TABLE IF NOT EXISTS oversea_parking_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    db_id TEXT NOT NULL,
    plate_no TEXT,
    parking_day TEXT,
    start_time TEXT,
    end_time TEXT,
    park_coordinates TEXT,
    duration_text TEXT,
    duration_minutes REAL,
    park_address TEXT,
    condition_type INTEGER NOT NULL DEFAULT 1,
    source_hash TEXT NOT NULL,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
    source_payload TEXT,
    UNIQUE(product_id, db_id, start_time, end_time, source_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_oversea_parking_product_time ON oversea_parking_records(product_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_oversea_parking_day ON oversea_parking_records(parking_day);
`);

dbRW.exec(`
  CREATE TABLE IF NOT EXISTS oversea_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    vehicles_seen INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    error_message TEXT
  );
`);

// Help / knowledge for Gemini assistant (FTS5)
dbRW.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS chat_knowledge_fts USING fts5(
    title,
    body,
    topic,
    tokenize = 'porter'
  );
`)
try {
  const seedCount = dbRW.prepare('SELECT COUNT(*) AS c FROM chat_knowledge_fts').get().c
  if (seedCount === 0) {
    const ins = dbRW.prepare('INSERT INTO chat_knowledge_fts (title, body, topic) VALUES (?, ?, ?)')
    const seedRows = [
      [
        'PAR (Portfolio at Risk)',
        'PAR aggregates past-due arrears and open loans. Country-level PAR filters loans to branches in that country and the user’s allowed branch scope. Global PAR rows without a country filter use the stored PAR table totals.',
        'logbook'
      ],
      [
        'Logbook branches',
        'Branches are stored in Logbook_Branches with code, name, country, and active flag. Custom-role users may only see branches assigned in User_Logbook_Branches.',
        'logbook'
      ],
      [
        'Zidisha',
        'Zidisha dashboards use branch-level data from Zidisha. Users may have User_Zidisha_Branches limiting which branch names they see.',
        'zidisha'
      ],
      [
        'Oversea Kajea sync',
        'Oversea vehicle and parking data sync jobs are recorded in oversea_sync_runs. The Kajea OS parking report uses oversea_vehicles and oversea_parking_records.',
        'kajea'
      ],
      [
        'Custom role',
        'Users with role custom only see pages listed in User_Pages and branches in User_Logbook_Branches.',
        'auth'
      ]
    ]
    for (const row of seedRows) {
      ins.run(row[0], row[1], row[2])
    }
  }
} catch (e) {
  console.warn('chat_knowledge_fts seed:', e.message)
}

// Loan Officers table (LOs)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS LOs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_access_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Global key/value settings (e.g., maintenance mode)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS System_Settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Chat logs (assistant observability)
try {
  dbRW.exec(`
    CREATE TABLE IF NOT EXISTS Chat_Logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER,
      username TEXT,
      role TEXT,
      provider TEXT,
      handler TEXT,
      user_message TEXT,
      reply_preview TEXT,
      latency_ms INTEGER,
      error TEXT
    );
  `)
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON Chat_Logs(created_at)').run()
  dbRW.prepare('CREATE INDEX IF NOT EXISTS idx_chat_logs_user ON Chat_Logs(user_id)').run()
} catch (e) {
  console.warn('Chat_Logs init:', e.message)
}

try {
  dbRW.exec(`
    CREATE TABLE IF NOT EXISTS Audit_Log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      method TEXT,
      path TEXT,
      ip TEXT,
      user_agent TEXT,
      status_code INTEGER,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );
  `)
  dbRW.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON Audit_Log (created_at DESC)`).run()
  dbRW.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON Audit_Log (user_id)`).run()
} catch (e) {
  console.warn('Audit_Log init:', e.message)
}

const PUBLIC_API_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/confirm-email',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/system/status',
])

// Settings helpers
const getSettingStmt = dbRW.prepare('SELECT value FROM System_Settings WHERE key = ? LIMIT 1')
const upsertSettingStmt = dbRW.prepare(
  `INSERT INTO System_Settings (key, value)
   VALUES (@key, @value)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
)

const getSetting = (key, defaultValue = null) => {
  try {
    const row = getSettingStmt.get(key)
    if (!row || typeof row.value === 'undefined' || row.value === null) {
      return defaultValue
    }
    return row.value
  } catch {
    return defaultValue
  }
}

const setSetting = (key, value) => {
  upsertSettingStmt.run({ key, value: String(value ?? '') })
}

const isMaintenanceEnabled = () => String(getSetting('maintenance_mode', '0')) === '1'

const signAuthToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: `${JWT_TTL_HOURS}h` }
  )

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS)
}

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 0,
  })
}

const extractTokenFromRequest = (req) => {
  const fromCookie = req.cookies?.[AUTH_COOKIE_NAME]
  if (fromCookie) return fromCookie
  const authHeader = req.headers?.authorization || ''
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }
  return null
}

const attachAuthFromToken = (req, res, next) => {
  const token = extractTokenFromRequest(req)
  if (!token) return next()
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const userRow = getUserByIdStmt.get(payload.sub)
    if (!userRow || !userRow.active) {
      clearAuthCookie(res)
      return next()
    }
    req.authUser = mapUserRow(userRow)
  } catch (err) {
    clearAuthCookie(res)
  }
  next()
}

const requireAuth = (req, res, next) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim().slice(0, 128)
  }
  const addr = req.socket?.remoteAddress || req.ip || ''
  return String(addr).slice(0, 128)
}

function insertAuditLog({
  userId = null,
  username = null,
  action = 'event',
  method = '',
  path = '',
  ip = '',
  userAgent = '',
  statusCode = null,
  meta = null,
}) {
  try {
    dbRW
      .prepare(
        `INSERT INTO Audit_Log (user_id, username, action, method, path, ip, user_agent, status_code, meta_json, created_at)
         VALUES (@user_id, @username, @action, @method, @path, @ip, @user_agent, @status_code, @meta_json, @created_at)`,
      )
      .run({
        user_id: userId ?? null,
        username: username ?? null,
        action,
        method: method || null,
        path: path || null,
        ip: ip || null,
        user_agent: userAgent ? String(userAgent).slice(0, 512) : null,
        status_code: statusCode != null ? Number(statusCode) : null,
        meta_json: meta != null ? JSON.stringify(meta) : null,
        created_at: nowIso(),
      })
  } catch (e) {
    console.warn('[audit]', e.message)
  }
}

/** Records mutating API calls (writes). Mounted under /api — req.path is relative (e.g. /auth/login). */
function auditApiWritesMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') return next()
  const m = String(req.method || '').toUpperCase()
  if (m === 'GET' || m === 'HEAD') return next()

  const ip = getClientIp(req)
  const ua = req.headers['user-agent']

  res.on('finish', () => {
    const pathname = '/api' + (req.path || '')
    insertAuditLog({
      userId: req.authUser?.id ?? null,
      username: req.authUser?.username ?? null,
      action: 'api_write',
      method: m,
      path: pathname,
      ip,
      userAgent: ua,
      statusCode: res.statusCode,
      meta: null,
    })
  })
  next()
}

const setEventStreamHeaders = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
}

const updateDataRefreshTime = (time = getNairobiTime()) => {
  try {
    dbRW
      .prepare(`
        INSERT INTO DataRefresh_Status (id, last_run_time, updated_at)
        VALUES (1, @time, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          last_run_time = excluded.last_run_time,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run({ time })
  } catch (err) {
    console.error('Failed to update DataRefresh_Status:', err.message)
  }
  return time
}

const LOANDISK_BASE_URL = 'https://api-main.loandisk.com/7125'
const LOANDISK_AUTH = 'Basic hM2PPcacbMJPKsE4mAM3hbYNqbY5vSJtjrKYHRad'
const LOANDISK_PAGE_SIZE = 20
const MAX_PAGE_ATTEMPTS = 4
const FETCH_TIMEOUT_MS = 60000
const FETCH_MAX_RETRIES = 5

// Get current time in UTC (stored as ISO string)
// Note: We store UTC time in the database, and convert to Nairobi time when displaying
function getNairobiTime() {
  // Just return UTC time - conversion to Nairobi time happens on display
  return new Date().toISOString()
}

function getNairobiDateKey() {
  // Date key in Africa/Nairobi timezone (YYYY-MM-DD)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (t) => parts.find((p) => p.type === t)?.value
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function parseDateLoose(v) {
  const s = String(v || '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})$/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function normalizeKenyanPhone(phone) {
  let p = String(phone || '').trim()
  if (!p) return ''
  p = p.replace(/\s+/g, '').replace(/^\+/, '')
  if (p.startsWith('254') && p.length >= 12) return p
  if (p.startsWith('0') && p.length >= 10) {
    p = `254${p.slice(1)}`
    return p
  }
  // e.g. 712345678 → 254712345678
  if (/^7\d{8}$/.test(p)) {
    return `254${p}`
  }
  return p
}

/** Kenyan MSISDN normalizer: returns '' unless it can be normalized to 254XXXXXXXXX. */
function normalizeKenyanPhoneStrict(phone) {
  let p = String(phone || '').trim()
  if (!p) return ''
  p = p.replace(/\s+/g, '').replace(/^\+/, '')
  if (p.startsWith('254') && p.length >= 12) return p
  if (p.startsWith('0') && p.length >= 10) return `254${p.slice(1)}`
  if (/^7\d{8}$/.test(p)) return `254${p}`
  return ''
}

function maskEmail(email) {
  const e = String(email || '').trim()
  const at = e.indexOf('@')
  if (at <= 0) return '***'
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  const first = local[0] || '*'
  const maskedLocal = `${first}${'*'.repeat(Math.max(1, local.length - 1))}`
  const domainParts = domain.split('.').filter(Boolean)
  const safeDomain =
    domainParts.length >= 2
      ? `${'*'.repeat(Math.min(6, domainParts[0].length || 3))}.${domainParts.slice(1).join('.')}`
      : '*'.repeat(Math.min(8, domain.length || 3))
  return `${maskedLocal}@${safeDomain}`
}

/** Mask phone for reset UI: only last 2 digits visible */
function maskPhoneLastTwoVisible(phone) {
  const p = normalizeKenyanPhone(phone)
  if (!p || p.length < 3) return '****'
  return `${'*'.repeat(p.length - 2)}${p.slice(-2)}`
}

/** 5-digit numeric first-time sign-in code (hashed like password until user sets a real password). */
function generateFirstTimeCode() {
  return String(crypto.randomInt(10000, 100000))
}

async function sendInviteSms(phone, message) {
  const url = String(process.env.ONFON_SMS_URL || 'https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS')
  const apiKey = String(process.env.ONFON_API_KEY || '').trim()
  const clientId = String(process.env.ONFON_CLIENT_ID || '').trim()
  const senderId = String(process.env.ONFON_SENDER_ID || '').trim()
  if (!apiKey || !clientId || !senderId) {
    const err = new Error(
      'SMS gateway not configured: ONFON_API_KEY, ONFON_CLIENT_ID, and ONFON_SENDER_ID must be set on the server process.'
    )
    err.code = 'SMS_NOT_CONFIGURED'
    throw err
  }
  const payload = {
    ApiKey: apiKey,
    ClientId: clientId,
    SenderId: senderId,
    MessageParameters: [{ Number: normalizeKenyanPhone(phone), Text: String(message || '').trim() }],
  }
  const resp = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 })
  return resp.data
}

async function sendTopUpSMS(name, phone) {
  const url = String(process.env.ONFON_SMS_URL || 'https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS')
  const apiKey = String(process.env.ONFON_API_KEY || '').trim()
  const clientId = String(process.env.ONFON_CLIENT_ID || '').trim()
  const senderId = String(process.env.ONFON_SENDER_ID || '').trim()
  if (!apiKey || !clientId || !senderId) {
    throw new Error('Missing ONFON_API_KEY / ONFON_CLIENT_ID / ONFON_SENDER_ID')
  }

  const fullName = String(name || '').trim()
  // Use first token only (e.g., "Jacktone Onyango Ochieng" -> "Jacktone")
  const safeName = (fullName.split(/\s+/).filter(Boolean)[0] || '').trim() || 'Customer'
  const rawTemplate = String(process.env.TOPUP_SMS_TEMPLATE || '').trim()
  const messageTemplate =
    rawTemplate || `Dear ${safeName}, you have qualified for a top-up loan. To access visit your nearest branch or call 0747100100`
  const message = String(messageTemplate).replace(/\$\{safeName\}/g, safeName)

  const payload = {
    ApiKey: apiKey,
    ClientId: clientId,
    SenderId: senderId,
    MessageParameters: [{ Number: phone, Text: message }],
  }

  const resp = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 })
  return resp.data
}

function getBodaTopUpMaturityFilterDate() {
  const today = new Date()
  try {
    const key = getNairobiDateKey()
    const d = parseDateLoose(key)
    if (d) {
      d.setHours(0, 0, 0, 0)
      today.setTime(d.getTime())
    } else {
      today.setHours(0, 0, 0, 0)
    }
  } catch {
    today.setHours(0, 0, 0, 0)
  }
  return today
}

/** Aggregate Zidisha Boda rows by client (not-yet-matured loans only). */
function buildBodaTopUpZidishaByClient(today) {
  const rows = db
    .prepare(`
      SELECT
        "Client Id" as clientId,
        "Client Name" as clientName,
        "Loan ID" as loanId,
        "Phone Number" as phoneNumber,
        "Principal Amount" as principalAmount,
        "Principal Outstanding Derived" as principalOutstanding,
        "Expected Matured On Date" as expectedMaturedOnDate
      FROM zidisha_data
      WHERE "Product Name" COLLATE NOCASE = 'Zidisha Boda'
    `)
    .all()

  const byClient = new Map()
  for (const r of rows) {
    const clientId = String(r.clientId || '').trim()
    if (!clientId) continue

    const expected = String(r.expectedMaturedOnDate || '').trim()
    const expectedDate = parseDateLoose(expected)
    if (!expectedDate || expectedDate <= today) continue

    const principalAmount = Number(r.principalAmount) || 0
    const principalOutstanding = Number(r.principalOutstanding) || 0

    const phone = normalizeKenyanPhone(r.phoneNumber)
    const name = String(r.clientName || '').trim()

    const existing = byClient.get(clientId) || {
      clientId,
      name: name || '',
      phone: phone || '',
      totalPrincipal: 0,
      totalOutstanding: 0,
      latestExpected: expectedDate,
    }

    existing.totalPrincipal += principalAmount
    existing.totalOutstanding += principalOutstanding
    if (!existing.phone && phone) existing.phone = phone
    if (!existing.name && name) existing.name = name
    if (expectedDate > existing.latestExpected) existing.latestExpected = expectedDate

    byClient.set(clientId, existing)
  }
  return byClient
}

function bodaTopUpClientPercentPaid(c) {
  const paid = c.totalPrincipal - c.totalOutstanding
  const safePaid = paid > 0 ? paid : 0
  return c.totalPrincipal > 0 ? (safePaid / c.totalPrincipal) * 100 : 0
}

function formatKes(amount) {
  const n = Number(amount) || 0
  try {
    return `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
  } catch {
    return `KES ${Math.round(n).toString()}`
  }
}

function getOnfonConfigured() {
  return !!(
    String(process.env.ONFON_API_KEY || '').trim() &&
    String(process.env.ONFON_CLIENT_ID || '').trim() &&
    String(process.env.ONFON_SENDER_ID || '').trim()
  )
}

/** Standard JSON when forgot-password cannot send SMS because Onfon env is missing. */
function respondForgotPasswordSmsNotConfigured(res) {
  return res.status(503).json({
    code: 'sms_not_configured',
    error:
      'Password reset by SMS is unavailable because the SMS gateway is not configured on this server. Ask your administrator to set ONFON_API_KEY, ONFON_CLIENT_ID, and ONFON_SENDER_ID for the dashboard process (for example in PM2), restart the app, then try again.',
  })
}

async function runBodaTopUpSmsJob(slot) {
  const slotNorm = String(slot || '').trim() || 'unknown'
  const sendDate = getNairobiDateKey()
  const minPct = Number(process.env.TOPUP_MIN_PERCENT_PAID || 70)
  const minPctSafe = Number.isFinite(minPct) ? minPct : 70

  // New source of truth: Client Performance tables (precomputed)
  // Recipients: Gold/Silver AND principal paid >= minPctSafe
  let recipients = []
  try {
    recipients = dbRW
      .prepare(
        `SELECT
           TRIM(client_id) AS clientId,
           TRIM(client_name) AS name,
           TRIM(phone) AS phone,
           CAST(current_principal_amount AS REAL) AS principalAmount,
           CAST(current_principal_outstanding AS REAL) AS principalOutstanding,
           TRIM(band) AS band,
           'boda' AS product
         FROM credit_scores_boda
         WHERE band IN ('Gold', 'Silver')
         UNION ALL
         SELECT
           TRIM(client_id) AS clientId,
           TRIM(client_name) AS name,
           TRIM(phone) AS phone,
           CAST(current_principal_amount AS REAL) AS principalAmount,
           CAST(current_principal_outstanding AS REAL) AS principalOutstanding,
           TRIM(band) AS band,
           'zidisha' AS product
         FROM credit_scores_zidisha
         WHERE band IN ('Gold', 'Silver')`,
      )
      .all()
  } catch (e) {
    // If tables are missing/empty, try a refresh once and re-read
    try {
      console.warn('[SMS] credit_scores_* missing; attempting refresh:', e.message)
      ensureCreditIndexes()
      refreshCreditScoresForProduct('boda', { scopeProducts: ['Zidisha Boda'] })
      refreshCreditScoresForProduct('zidisha', {
        scopeProducts: ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express'],
      })
      recipients = dbRW
        .prepare(
          `SELECT
             TRIM(client_id) AS clientId,
             TRIM(client_name) AS name,
             TRIM(phone) AS phone,
             CAST(current_principal_amount AS REAL) AS principalAmount,
             CAST(current_principal_outstanding AS REAL) AS principalOutstanding,
             TRIM(band) AS band,
             'boda' AS product
           FROM credit_scores_boda
           WHERE band IN ('Gold', 'Silver')
           UNION ALL
           SELECT
             TRIM(client_id) AS clientId,
             TRIM(client_name) AS name,
             TRIM(phone) AS phone,
             CAST(current_principal_amount AS REAL) AS principalAmount,
             CAST(current_principal_outstanding AS REAL) AS principalOutstanding,
             TRIM(band) AS band,
             'zidisha' AS product
           FROM credit_scores_zidisha
           WHERE band IN ('Gold', 'Silver')`,
        )
        .all()
    } catch (e2) {
      throw new Error(`Unable to load credit_scores_* for SMS: ${e2.message}`)
    }
  }

  let attempted = 0
  let sent = 0
  let skipped = 0
  let errors = 0

  for (const r of recipients) {
    const clientId = String(r.clientId || '').trim()
    if (!clientId) continue

    const principalAmount = Number(r.principalAmount) || 0
    const principalOutstanding = Number(r.principalOutstanding) || 0
    const paid = principalAmount - principalOutstanding
    const safePaid = paid > 0 ? paid : 0
    const pctPaid = principalAmount > 0 ? (safePaid / principalAmount) * 100 : 0

    if (pctPaid < minPctSafe) {
      skipped += 1
      continue
    }
    const phone = normalizeKenyanPhone(r.phone)
    if (!phone) {
      skipped += 1
      continue
    }

    // Dedupe per day+slot+client
    const exists = dbRW
      .prepare('SELECT 1 FROM TopUp_SMS_Log WHERE send_date = ? AND slot = ? AND client_id = ? LIMIT 1')
      .get(sendDate, slotNorm, clientId)
    if (exists) {
      skipped += 1
      continue
    }

    attempted += 1
    try {
      const resp = await sendTopUpSMS(r.name, phone)
      dbRW
        .prepare(
          `INSERT INTO TopUp_SMS_Log (send_date, slot, client_id, phone, status, response)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(sendDate, slotNorm, clientId, phone, 'sent', JSON.stringify(resp || {}))
      sent += 1
    } catch (e) {
      errors += 1
      dbRW
        .prepare(
          `INSERT OR IGNORE INTO TopUp_SMS_Log (send_date, slot, client_id, phone, status, response)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(sendDate, slotNorm, clientId, phone, 'error', String(e?.message || e))
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return { sendDate, slot: slotNorm, attempted, sent, skipped, errors, minPct: minPctSafe }
}

async function runBodaCollectionArrearsSmsJob(slot) {
  const slotNorm = String(slot || '').trim() || 'unknown'
  const sendDate = getNairobiDateKey()

  if (!getOnfonConfigured()) {
    return { sendDate, slot: slotNorm, attempted: 0, sent: 0, skipped: 0, errors: 0, reason: 'sms_not_configured' }
  }

  // Use Nairobi date key as "today" reference (midnight boundary for overdue)
  const todayKey = getNairobiDateKey()
  const minDaysProducts = ['advans emergency loan', 'salary advans', 'unsecured loans']

  let rows = []
  try {
    rows = dbRW
      .prepare(
        `SELECT
           TRIM("Client Id") AS clientId,
           TRIM("Client Name") AS clientName,
           TRIM("Phone Number") AS phone,
           SUM(COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0)) AS totalOutstanding
         FROM boda_Schedule
         WHERE date("Due Date") < date(?)
           AND (
             LOWER(COALESCE(TRIM("Product Name"), '')) NOT IN (${minDaysProducts.map(() => '?').join(', ')})
             OR date("Due Date") < date(?, '-15 day')
           )
         GROUP BY TRIM("Client Id"), TRIM("Client Name"), TRIM("Phone Number")
         HAVING totalOutstanding > 0`,
      )
      .all(todayKey, ...minDaysProducts, todayKey)
  } catch (e) {
    console.error('[CRON] Collection arrears query failed:', e.message)
    throw e
  }

  const templateRaw = String(process.env.COLLECTION_ARREARS_SMS_TEMPLATE || '').trim()
  const template =
    templateRaw ||
    'Dear ${firstName}, you are in arrears of ${amount}. Please pay up your dues to stay active.'

  let attempted = 0
  let sent = 0
  let skipped = 0
  let errors = 0

  for (const r of rows) {
    const clientId = String(r.clientId || '').trim()
    if (!clientId) continue

    // Dedupe per day+slot+client
    const exists = dbRW
      .prepare('SELECT 1 FROM Collection_Arrears_SMS_Log WHERE send_date = ? AND slot = ? AND client_id = ? LIMIT 1')
      .get(sendDate, slotNorm, clientId)
    if (exists) {
      skipped += 1
      continue
    }

    const phoneKenya = normalizeKenyanPhoneStrict(r.phone)
    if (!phoneKenya) {
      skipped += 1
      dbRW
        .prepare(
          `INSERT OR IGNORE INTO Collection_Arrears_SMS_Log (send_date, slot, client_id, phone, total_outstanding, status, response)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sendDate, slotNorm, clientId, String(r.phone || ''), Number(r.totalOutstanding || 0), 'skipped', 'non_kenyan_or_missing_phone')
      continue
    }

    const fullName = String(r.clientName || '').trim()
    const firstName = (fullName.split(/\s+/).filter(Boolean)[0] || '').trim() || 'Customer'
    const amount = formatKes(Number(r.totalOutstanding || 0))
    const msg = template
      .replace(/\$\{firstName\}/g, firstName)
      .replace(/\$\{amount\}/g, amount)
      .replace(/\$\{totalOutstanding\}/g, String(Number(r.totalOutstanding || 0)))

    attempted += 1
    try {
      const resp = await sendInviteSms(phoneKenya, msg)
      dbRW
        .prepare(
          `INSERT INTO Collection_Arrears_SMS_Log (send_date, slot, client_id, phone, total_outstanding, status, response)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sendDate, slotNorm, clientId, phoneKenya, Number(r.totalOutstanding || 0), 'sent', JSON.stringify(resp || {}))
      sent += 1
    } catch (e) {
      errors += 1
      dbRW
        .prepare(
          `INSERT OR IGNORE INTO Collection_Arrears_SMS_Log (send_date, slot, client_id, phone, total_outstanding, status, response)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sendDate, slotNorm, clientId, phoneKenya, Number(r.totalOutstanding || 0), 'error', String(e?.message || e))
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return { sendDate, slot: slotNorm, attempted, sent, skipped, errors }
}

function buildBodaCollectionArrearsPreview({ asOfDate, slot, limit = 200, includeAlreadySent = false } = {}) {
  const sendDate = String(asOfDate || getNairobiDateKey()).slice(0, 10)
  const slotNorm = String(slot || '07:05').trim() || '07:05'
  const limitSafe = Math.min(Math.max(Number(limit) || 200, 1), 1000)
  const minDaysProducts = ['advans emergency loan', 'salary advans', 'unsecured loans']

  const templateRaw = String(process.env.COLLECTION_ARREARS_SMS_TEMPLATE || '').trim()
  const template =
    templateRaw ||
    'Dear ${firstName}, you are in arrears of ${amount}. Please pay up your dues to stay active.'

  const rows = dbRW
    .prepare(
      `SELECT
         TRIM("Client Id") AS clientId,
         TRIM("Client Name") AS clientName,
         TRIM("Phone Number") AS phone,
         SUM(COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0)) AS totalOutstanding
       FROM boda_Schedule
       WHERE date("Due Date") < date(?)
         AND (
           LOWER(COALESCE(TRIM("Product Name"), '')) NOT IN (${minDaysProducts.map(() => '?').join(', ')})
           OR date("Due Date") < date(?, '-15 day')
         )
       GROUP BY TRIM("Client Id"), TRIM("Client Name"), TRIM("Phone Number")
       HAVING totalOutstanding > 0
       ORDER BY totalOutstanding DESC
       LIMIT ?`,
    )
    .all(sendDate, ...minDaysProducts, sendDate, limitSafe)

  const out = []
  for (const r of rows) {
    const clientId = String(r.clientId || '').trim()
    if (!clientId) continue
    const fullName = String(r.clientName || '').trim()
    const firstName = (fullName.split(/\s+/).filter(Boolean)[0] || '').trim() || 'Customer'
    const totalOutstanding = Number(r.totalOutstanding || 0)
    const amount = formatKes(totalOutstanding)
    const message = template
      .replace(/\$\{firstName\}/g, firstName)
      .replace(/\$\{amount\}/g, amount)
      .replace(/\$\{totalOutstanding\}/g, String(totalOutstanding))

    const alreadySent = !!dbRW
      .prepare('SELECT 1 FROM Collection_Arrears_SMS_Log WHERE send_date = ? AND slot = ? AND client_id = ? LIMIT 1')
      .get(sendDate, slotNorm, clientId)

    if (!includeAlreadySent && alreadySent) continue

    out.push({
      clientId,
      clientName: fullName,
      firstName,
      phone: String(r.phone || '').trim(),
      totalOutstanding,
      sendDate,
      slot: slotNorm,
      alreadySent,
      message,
    })
  }

  return { sendDate, slot: slotNorm, count: out.length, items: out }
}

// Helper function to fetch with retry and timeout
async function fetchWithRetry(url, options, maxRetries = FETCH_MAX_RETRIES, timeoutMs = FETCH_TIMEOUT_MS) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      
      try {
        const resp = await fetch(url, {
          ...options,
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        
        if (!resp.ok) {
          // Retry on 5xx errors, but not on 4xx errors
          if (resp.status >= 500 && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // Exponential backoff, max 10s
            console.log(`Retrying fetch (attempt ${attempt}/${maxRetries}) after ${delay}ms for ${url}`)
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
        }
        
        return resp
      } catch (err) {
        clearTimeout(timeoutId)
        if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('terminated')) {
          throw new Error(`Request timeout after ${timeoutMs}ms`)
        }
        throw err
      }
    } catch (err) {
      // Enhanced error logging to diagnose failures
      const errorDetails = {
        message: err.message || String(err),
        name: err.name,
        code: err.code,
        cause: err.cause?.message || err.cause,
        stack: err.stack?.split('\n').slice(0, 3).join(' | ') // First 3 stack lines
      }
      const errorSummary = `${errorDetails.message} [type: ${errorDetails.name || 'unknown'}, code: ${errorDetails.code || 'none'}]`
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // Exponential backoff
        console.log(`Retrying fetch (attempt ${attempt}/${maxRetries}) after ${delay}ms: ${errorSummary}`)
        if (attempt === 1) {
          // Log full details on first attempt for debugging
          console.log(`  Error details:`, JSON.stringify(errorDetails, null, 2))
        }
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
}

async function fetchLoanPrincipalSum(branchCode, loanStatusId) {
  const branchCodeClean = String(branchCode ?? '').trim()
  if (!branchCodeClean) {
    throw new Error('Missing branch code')
  }

  const url = `${LOANDISK_BASE_URL}/${encodeURIComponent(branchCodeClean)}/advanced_search_loans`
  let page = 1
  let grandTotal = 0
  let fetched = 0
  let totalResults = 0
  const allLoans = [] // Store all loan records

  for (;;) {
    const payload = {
      from: page,
      count: LOANDISK_PAGE_SIZE,
      loan_status_id: loanStatusId
    }

    let results = []
    let pageSucceeded = false

    for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
      try {
        const resp = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers: {
              'Authorization': LOANDISK_AUTH,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          FETCH_MAX_RETRIES,
          FETCH_TIMEOUT_MS
        )

        const json = await resp.json()
        if (json && json.error) {
          const err = typeof json.error === 'string' ? json.error : JSON.stringify(json.error)
          throw new Error(err)
        }

        const response = json?.response || {}
        const rawResults = Array.isArray(response.Results) ? response.Results : []
        results = Array.isArray(rawResults[0]) ? rawResults.flat() : rawResults
        if (typeof response.TotalResults === 'number') totalResults = response.TotalResults
        pageSucceeded = true
        break
      } catch (err) {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000)
        const errorDetails = {
          message: err.message || String(err),
          name: err.name,
          code: err.code,
          cause: err.cause?.message || err.cause
        }
        const errMsg = `${errorDetails.message} [type: ${errorDetails.name || 'unknown'}, code: ${errorDetails.code || 'none'}]`
        
        console.error(
          `Error fetching page ${page} for branch ${branchCodeClean} (attempt ${attempt}/${MAX_PAGE_ATTEMPTS}):`,
          errMsg
        )
        if (attempt === 1) {
          // Log full error details on first attempt
          console.error(`  Full error:`, JSON.stringify(errorDetails, null, 2))
        }
        if (attempt === MAX_PAGE_ATTEMPTS) {
          throw new Error(`Failed to fetch page ${page} for branch ${branchCodeClean} after ${MAX_PAGE_ATTEMPTS} attempts: ${errMsg}`)
        }
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    if (!pageSucceeded) {
      throw new Error(`Failed to fetch page ${page} for branch ${branchCodeClean}`)
    }

    for (const item of results) {
      const rawPrincipal =
        item.principal_balance_amount ??
        item.PrincipalBalanceAmount ??
        item['principal_balance_amount'] ??
        item['Principal Balance Amount'] ??
        item['Principal Balance'] ??
        0
      const principal = Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0
      grandTotal += principal
      
      // Store full loan record
      allLoans.push(item)
    }

    fetched += results.length
    if (results.length < LOANDISK_PAGE_SIZE) break
    page += 1
    if (totalResults && fetched >= totalResults) break
    if (page > 500) break // safety cap
    
    // Add small delay between pages to avoid rate limiting
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return { sum: grandTotal, fetched, totalResults, loans: allLoans }
}

// Fetch collectors from Loandisk API for a specific branch
async function fetchCollectors(branchCode) {
  const branchCodeClean = String(branchCode ?? '').trim()
  if (!branchCodeClean) {
    throw new Error('Missing branch code')
  }

  let page = 1
  let allCollectors = []
  let totalResults = 0
  const pageSize = 100

  for (;;) {
    const pageUrl = `${LOANDISK_BASE_URL}/${encodeURIComponent(branchCodeClean)}/collector/from/${page}/count/${pageSize}`
    let pageSucceeded = false
    let results = []
    let returnResults = 0

    for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
      try {
        const resp = await fetchWithRetry(
          pageUrl,
          {
            method: 'GET',
            headers: {
              'Authorization': LOANDISK_AUTH,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
          },
          FETCH_MAX_RETRIES,
          FETCH_TIMEOUT_MS
        )

        const json = await resp.json()
        if (json && json.error) {
          const err = typeof json.error === 'string' ? json.error : JSON.stringify(json.error)
          throw new Error(err)
        }

        const response = json?.response || {}
        const rawResults = Array.isArray(response.Results) ? response.Results : []
        // Handle nested array structure: Results can be [ [collector1, collector2, ...] ] or [collector1, collector2, ...]
        results = Array.isArray(rawResults[0]) ? rawResults.flat() : rawResults
        
        if (typeof response.TotalResults === 'number') {
          totalResults = response.TotalResults
        }
        
        if (typeof response.ReturnResults === 'number') {
          returnResults = response.ReturnResults
        } else {
          returnResults = results.length
        }
        
        // Log for debugging
        console.log(`Branch ${branchCodeClean} page ${page}: Found ${results.length} collectors (TotalResults: ${totalResults}, ReturnResults: ${returnResults})`)

        // Add branch code to each collector record
        for (const collector of results) {
          allCollectors.push({
            ...collector,
            branch_code: branchCodeClean
          })
        }

        pageSucceeded = true
        break
      } catch (err) {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000)
        const errorDetails = {
          message: err.message || String(err),
          name: err.name,
          code: err.code,
          cause: err.cause?.message || err.cause
        }
        const errMsg = `${errorDetails.message} [type: ${errorDetails.name || 'unknown'}, code: ${errorDetails.code || 'none'}]`
        
        console.error(
          `Error fetching collectors page ${page} for branch ${branchCodeClean} (attempt ${attempt}/${MAX_PAGE_ATTEMPTS}):`,
          errMsg
        )
        if (attempt === 1) {
          console.error(`  Full error:`, JSON.stringify(errorDetails, null, 2))
        }
        if (attempt === MAX_PAGE_ATTEMPTS) {
          throw new Error(`Failed to fetch collectors page ${page} for branch ${branchCodeClean} after ${MAX_PAGE_ATTEMPTS} attempts: ${errMsg}`)
        }
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    if (!pageSucceeded) {
      throw new Error(`Failed to fetch collectors page ${page} for branch ${branchCodeClean}`)
    }

    // Check if we've fetched all results
    if (returnResults < pageSize) break
    if (totalResults && allCollectors.length >= totalResults) break
    page += 1
    if (page > 500) break // safety cap
    
    // Add small delay between pages to avoid rate limiting
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return { collectors: allCollectors, fetched: allCollectors.length, totalResults }
}

// Function to fetch and save collectors for all active branches (reusable for cron and API)
async function fetchAndSaveCollectors() {
  const activeBranches = dbRW.prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1').all()
  
  if (activeBranches.length === 0) {
    throw new Error('No active branches found')
  }

  const insertStmt = dbRW.prepare(`
    INSERT OR REPLACE INTO collectors (collector_id, branch_code, collector_data, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `)

  let totalFetched = 0
  let totalSaved = 0
  const errors = []

  for (const branch of activeBranches) {
    try {
      console.log(`Fetching collectors for branch ${branch.code} (${branch.name})...`)
      const result = await fetchCollectors(branch.code)
      
      // Save collectors to database
      const tx = dbRW.transaction((collectors) => {
        let saved = 0
        for (const collector of collectors) {
          try {
            const collectorId = collector.collector_id ?? collector.id ?? collector.CollectorId ?? collector['Collector Id'] ?? null
            if (!collectorId) {
              console.warn(`Skipping collector without ID for branch ${branch.code}`)
              continue
            }
            
            const collectorDataJson = JSON.stringify(collector)
            
            // INSERT OR REPLACE will handle uniqueness - since collector_id is unique globally,
            // each collector will only be saved once (the last branch that processes it will update it)
            insertStmt.run(collectorId, branch.code, collectorDataJson)
            saved++
          } catch (e) {
            console.error(`Error saving collector for branch ${branch.code}:`, e.message)
          }
        }
        return saved
      })

      const saved = tx(result.collectors)
      totalFetched += result.fetched
      totalSaved += saved
      console.log(`✓ Branch ${branch.code}: Fetched ${result.fetched}, Saved ${saved} collectors`)
      
      // Small delay between branches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200))
    } catch (e) {
      const errorMsg = `Failed to fetch collectors for branch ${branch.code}: ${e.message}`
      console.error(errorMsg)
      errors.push({ branch: branch.code, error: e.message })
    }
  }

  return {
    success: true,
    branchesProcessed: activeBranches.length,
    totalFetched,
    totalSaved,
    errors: errors.length > 0 ? errors : undefined
  }
}

// Fetch and save collectors for all active branches (API endpoint)
app.post('/api/collectors/fetch', async (req, res) => {
  try {
    const result = await fetchAndSaveCollectors()
    res.json(result)
  } catch (e) {
    console.error('Error fetching collectors:', e)
    res.status(500).json({ error: e.message })
  }
})


// Ensure Logbook_Branches table exists
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Branches (
    code TEXT PRIMARY KEY,
    name TEXT,
    active INTEGER DEFAULT 1
  );
`);
// Add country column if missing (migration for existing DBs)
try {
  const hasCountry = dbRW.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('Logbook_Branches') WHERE name = 'country'"
  ).get().c > 0
  if (!hasCountry) {
    dbRW.exec(`ALTER TABLE Logbook_Branches ADD COLUMN country TEXT DEFAULT 'Kenya'`)
  }
} catch (e) {
  // Column may already exist or DB read-only
}

// Users table (dashboard users)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT,
    email TEXT,
    role TEXT,
    active INTEGER DEFAULT 1,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Email verification + password reset tables
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Email_Verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
  );
`);

dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Password_Reset_Codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
  );
`);

// Migrations for older DBs
try {
  dbRW.exec(`ALTER TABLE Users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;`)
} catch (e) {
  // ignore if exists
}

// Ensure existing privileged accounts are not locked out (they may predate email verification flow)
try {
  dbRW
    .prepare(
      `UPDATE Users
       SET email_verified = 1, updated_at = CURRENT_TIMESTAMP
       WHERE email_verified = 0
         AND lower(role) IN ('admin', 'superuser')`
    )
    .run()
} catch (e) {
  // ignore
}

// Unique email (case-insensitive) when email is not empty
try {
  dbRW.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON Users(lower(email)) WHERE email <> '';`)
} catch (e) {
  // ignore
}

// Phone + first-login password change (SMS onboarding)
try {
  dbRW.exec(`ALTER TABLE Users ADD COLUMN phone TEXT;`)
} catch (e) {
  // ignore
}
try {
  dbRW.exec(`ALTER TABLE Users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;`)
} catch (e) {
  // ignore
}
try {
  dbRW.exec(`ALTER TABLE Users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;`)
} catch (e) {
  // ignore
}
try {
  dbRW.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON Users(phone) WHERE phone IS NOT NULL AND phone <> '';`)
} catch (e) {
  // ignore
}
try {
  dbRW.exec(
    `UPDATE Users SET phone_verified = 1 WHERE COALESCE(phone_verified, 0) = 0 AND COALESCE(email_verified, 0) = 1`,
  )
} catch (e) {
  // ignore
}

// Table to store page permissions for custom role users
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS User_Pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    page_path TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE(user_id, page_path)
  );
`);

// Table to store Zidisha branch permissions for custom role users
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS User_Zidisha_Branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    branch_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE(user_id, branch_name)
  );
`);

// Table to store Boda branch permissions for custom role users
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS User_Boda_Branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    branch_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE(user_id, branch_name)
  );
`);

// Table to store Logbook branch permissions for users (e.g. branch managers)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS User_Logbook_Branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    branch_code TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE(user_id, branch_code)
  );
`);

// Targets tables
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    disbursement_target REAL NOT NULL DEFAULT 0,
    collection_target REAL NOT NULL DEFAULT 0,
    working_days INTEGER NOT NULL DEFAULT 0,
    holidays TEXT DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Zidisha_Targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    disbursement_target REAL NOT NULL DEFAULT 0,
    collection_target REAL NOT NULL DEFAULT 0,
    new_clients_amount_per_month REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add new_clients_amount_per_month column if it doesn't exist (for existing databases)
try {
  dbRW.exec(`ALTER TABLE Zidisha_Targets ADD COLUMN new_clients_amount_per_month REAL NOT NULL DEFAULT 0;`)
} catch (e) {
  // Column already exists, ignore error
}

// Add working_days column to Logbook_Targets if it doesn't exist (for existing databases)
try {
  dbRW.exec(`ALTER TABLE Logbook_Targets ADD COLUMN working_days INTEGER NOT NULL DEFAULT 0;`)
} catch (e) {
  // Column already exists, ignore error
}

// Add holidays column to Logbook_Targets if it doesn't exist (for existing databases)
try {
  dbRW.exec(`ALTER TABLE Logbook_Targets ADD COLUMN holidays TEXT DEFAULT '[]';`)
} catch (e) {
  // Column already exists, ignore error
}

// Collectors table
// Note: collector_id is unique globally (not per branch) - each collector appears only once
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS collectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collector_id INTEGER UNIQUE NOT NULL,
    branch_code TEXT NOT NULL,
    collector_data TEXT, -- JSON string of all collector fields from API
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing collectors table if it has the old UNIQUE(collector_id, branch_code) constraint
try {
  // Check if there are duplicate collector_ids (indicating old schema)
  const duplicates = dbRW.prepare(`
    SELECT collector_id, COUNT(*) as count 
    FROM collectors 
    WHERE collector_id IS NOT NULL 
    GROUP BY collector_id 
    HAVING count > 1
  `).all()
  
  if (duplicates.length > 0) {
    console.log(`Migrating collectors table: Found ${duplicates.length} duplicate collector_ids, consolidating...`)
    // Keep only the most recent record for each collector_id
    dbRW.exec(`
      DELETE FROM collectors
      WHERE id NOT IN (
        SELECT MAX(id) FROM collectors GROUP BY collector_id
      )
    `)
    console.log('✓ Collectors table migrated: removed duplicates')
  }
} catch (e) {
  // Migration check failed, table might not exist or already be correct
}

// RO Targets table (Loan Officer Targets)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS RO_Targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_officer_name TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    sum_of_target REAL NOT NULL DEFAULT 0,
    sum_of_principal_balance REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(loan_officer_name, month, year)
  );
`);

const hashPassword = (plainText) =>
  crypto.createHash('sha256').update(String(plainText ?? '')).digest('hex')

const hashToken = (token) => crypto.createHash('sha256').update(String(token ?? '')).digest('hex')

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()

const validatePasswordOrThrow = (pw) => {
  const p = String(pw || '')
  if (p.length < 6) {
    const err = new Error('Password must be at least 6 characters.')
    err.statusCode = 400
    throw err
  }
  // Basic requirement: at least 1 letter + 1 number
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    const err = new Error('Password must contain at least one letter and one number.')
    err.statusCode = 400
    throw err
  }
}

const nowIso = () => new Date().toISOString()

const addMinutesIso = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString()

const getAppBaseUrl = () => String(process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')

const getMailer = () => {
  const host = process.env.SMTP_HOST
  if (!host) return null
  const port = Number(process.env.SMTP_PORT || 587)
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true'
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  })
}

const sendEmail = async ({ to, subject, text, html }) => {
  const from = process.env.SMTP_FROM || 'no-reply@phoenixcapitalkenya.com'
  const mailer = getMailer()
  if (!mailer) {
    console.log('[email] SMTP not configured. Would send:', { to, subject, text })
    return { ok: false, skipped: true }
  }
  await mailer.sendMail({ from, to, subject, text, html })
  return { ok: true }
}

try {
  const userCount = dbRW.prepare('SELECT COUNT(*) as c FROM Users').get().c
  if (userCount === 0) {
    dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, role, active, password_hash, email_verified)
         VALUES (@username, @full_name, @email, @role, 1, @password_hash, 1)`
      )
      .run({
        username: 'admin',
        full_name: 'System Administrator',
        email: 'admin@example.com',
        role: 'admin',
        password_hash: hashPassword('admin123')
      })
    console.log('Seeded default admin user (username: admin, password: admin123)')
  }
  const existingDev = dbRW.prepare('SELECT id FROM Users WHERE username = ? LIMIT 1').get('dev')
  if (!existingDev) {
    dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, role, active, password_hash, email_verified)
         VALUES (@username, @full_name, @email, @role, 1, @password_hash, 1)`
      )
      .run({
        username: 'dev',
        full_name: 'Superuser',
        email: 'dev@example.com',
        role: 'superuser',
        password_hash: hashPassword('dev@123')
      })
    console.log('Seeded superuser (username: dev, password: dev@123)')
  }
} catch (err) {
  console.error('Unable to ensure default admin user:', err)
}

// Prepared statement to fetch user by id (after Users table exists)
const getUserByIdStmt = dbRW.prepare('SELECT * FROM Users WHERE id = ? LIMIT 1')

const DEFAULT_LOAN_OFFICERS = [
  { borrower_access_id: '40280', name: 'Anne Nekesa' },
  { borrower_access_id: '97469', name: 'Brian Omondi' },
  { borrower_access_id: '39213', name: 'Clement Nandunga' },
  { borrower_access_id: '23914', name: 'Edward Magero' },
  { borrower_access_id: '103140', name: 'External Debt Collector-Leigh' },
  { borrower_access_id: '72709', name: 'Joab Simiyu' },
  { borrower_access_id: '39214', name: 'Julius Kamau' },
  { borrower_access_id: '82115', name: 'Marine India' },
  { borrower_access_id: '76895', name: 'Moureen Nyongesa' },
  { borrower_access_id: '99956', name: 'Nebert Kangwana' },
  { borrower_access_id: '97555', name: 'Vincent Odede' },
  { borrower_access_id: '97470', name: 'Caroline Kanini' },
  { borrower_access_id: '83751', name: 'Clement Onyango' },
  { borrower_access_id: '95751', name: 'George Edgar Obuyi' },
  { borrower_access_id: '99603', name: 'Precious Beth' },
  { borrower_access_id: '86981', name: 'Rhoda Mwende' },
  { borrower_access_id: '91476', name: 'Victor Kedogo' },
  { borrower_access_id: '93980', name: 'Armstrong Murungi' },
  { borrower_access_id: '35863', name: 'Clement Onyango' },
  { borrower_access_id: '17027', name: 'Diana Sigei' },
  { borrower_access_id: '98932', name: 'Elsie Odia' },
  { borrower_access_id: '89478', name: 'Linet Nyanya' },
  { borrower_access_id: '77749', name: 'Richard Litunya' },
  { borrower_access_id: '58087', name: 'Vesto Moseti' },
  { borrower_access_id: '97274', name: 'Clement Onyango' },
  { borrower_access_id: '102234', name: 'Justin Kaberia' },
  { borrower_access_id: '97472', name: "Peter King'eru" },
  { borrower_access_id: '97617', name: 'Sarah Wambui' },
  { borrower_access_id: '100645', name: 'Clement Onyango' },
  { borrower_access_id: '102488', name: 'Cosmas Njogu' },
  { borrower_access_id: '101853', name: 'Macdonald Mwanzia Ndeti' },
  { borrower_access_id: '102773', name: 'Peter Desmond' },
  { borrower_access_id: '100737', name: 'Teckla Owino' },
  { borrower_access_id: '28283', name: 'Beatrice Olwith' },
  { borrower_access_id: '53625', name: "Clare Magdaline Akong'o" },
  { borrower_access_id: '101563', name: 'Gedion Omondi' },
  { borrower_access_id: '99851', name: 'Geoffrey Odhiambo' },
  { borrower_access_id: '98928', name: 'Gregory Kaiser' },
  { borrower_access_id: '63325', name: 'Imela Marion' },
  { borrower_access_id: '65481', name: 'IRENE MUTINDA' },
  { borrower_access_id: '81423', name: 'Jose Benedict' },
  { borrower_access_id: '39954', name: 'Kelvin Mise' },
  { borrower_access_id: '89991', name: 'Kelvin Ndungu' },
  { borrower_access_id: '90295', name: 'Kennedy Ndunga' },
  { borrower_access_id: '95480', name: 'Kevin Okuche' },
  { borrower_access_id: '97091', name: 'Mark William Efumbi' },
  { borrower_access_id: '79140', name: 'Nelly Mukir' },
  { borrower_access_id: '101500', name: 'Phinehas Wanjohi' },
  { borrower_access_id: '98929', name: 'System Phoenix' },
  { borrower_access_id: '84143', name: 'Tom Mutuku' },
  { borrower_access_id: '77262', name: 'Valary Mudavadi' }
]

try {
  const stmt = dbRW.prepare(`
    INSERT INTO LOs (borrower_access_id, name, active)
    VALUES (@borrower_access_id, @name, 1)
    ON CONFLICT(borrower_access_id) DO UPDATE
      SET name = excluded.name,
          active = excluded.active,
          updated_at = CURRENT_TIMESTAMP
  `)
  const seedTx = dbRW.transaction((rows) => {
    for (const row of rows) {
      stmt.run(row)
    }
  })
  seedTx(DEFAULT_LOAN_OFFICERS)
  console.log(`Ensured ${DEFAULT_LOAN_OFFICERS.length} default loan officers are present.`)
} catch (err) {
  console.error('Unable to seed loan officers:', err)
}

// Seed Logbook_Branches from existing data if empty
try {
  const existingCount = dbRW.prepare('SELECT COUNT(*) as c FROM Logbook_Branches').get().c
  if (existingCount === 0) {
    // Provided default branches to seed when no data-derived codes are found
    const DEFAULT_LOGBOOK_BRANCHES = [
      { code: '12936', name: 'BURUBURU BRANCH' },
      { code: '63796', name: 'Kiambu Branch' },
      { code: '27133', name: 'KIlimani Branch' },
      { code: '77791', name: 'Kitengela Branch' },
      { code: '8678',  name: 'Mombasa Road' },
      { code: '75092', name: 'P.C Insurance Agency' },
      { code: '59535', name: 'TECH AND DEMO ACCOUNT' },
      { code: '75350', name: 'Thika Branch' },
      { code: '8550',  name: 'TOWN BRANCH' },
      { code: '55886', name: 'Utawala Branch' },
    ];
    // Collect distinct branch codes from logbook tables
    const codes = new Set()
    try {
      const d1 = dbRW.prepare('SELECT DISTINCT branch FROM Logbook_Disbursement WHERE branch IS NOT NULL AND TRIM(branch) <> ""').all()
      d1.forEach(r => r.branch && codes.add(String(r.branch)))
    } catch {}
    try {
      const d2 = dbRW.prepare('SELECT DISTINCT branch FROM Logbook_collection WHERE branch IS NOT NULL AND TRIM(branch) <> ""').all()
      d2.forEach(r => r.branch && codes.add(String(r.branch)))
    } catch {}
    const upsert = dbRW.prepare(`
      INSERT INTO Logbook_Branches (code, name, active)
      VALUES (@code, @name, 1)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name
    `)
    if (codes.size === 0) {
      const tx = dbRW.transaction((arr) => {
        for (const b of arr) {
          upsert.run({ code: b.code, name: b.name })
        }
      })
      tx(DEFAULT_LOGBOOK_BRANCHES)
      console.log(`Seeded Logbook_Branches with ${DEFAULT_LOGBOOK_BRANCHES.length} default branches.`)
    } else {
      const tx = dbRW.transaction((arr) => {
        for (const code of arr) {
          upsert.run({ code, name: code })
        }
      })
      tx(Array.from(codes))
      console.log(`Seeded Logbook_Branches with ${codes.size} codes from existing data.`)
    }
  }
} catch (e) {
  console.warn('Branch seeding skipped:', e.message)
}

// Allow dev client (both localhost and network access)
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)
    
    // Allow localhost and network IP access
    if (origin.startsWith('http://localhost:') || 
        origin.startsWith('http://192.168.') ||
        origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true)
    }
    
    callback(null, true) // Allow all for development
  },
  credentials: true 
}))

// FX rates endpoint (cached). Must be registered after CORS middleware.
app.get('/api/fx/rates', async (req, res) => {
  try {
    // Explicit CORS headers (some environments bypass global cors middleware)
    const origin = req.headers.origin
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    const now = Date.now()
    if (fxCache.rates && now - fxCache.fetchedAt < FX_CACHE_TTL_MS) {
      return res.json({ base: fxCache.base, rates: fxCache.rates, fetchedAt: fxCache.fetchedAt })
    }
    const fresh = await fetchFxRatesUSD()
    fxCache = { fetchedAt: fresh.fetchedAt, base: fresh.base, rates: fresh.rates }
    res.json({ base: fresh.base, rates: fresh.rates, fetchedAt: fresh.fetchedAt })
  } catch (e) {
    // Fallback: return cached if present
    if (fxCache.rates) {
      return res.json({ base: fxCache.base, rates: fxCache.rates, fetchedAt: fxCache.fetchedAt, stale: true })
    }
    res.status(500).json({ error: e.message })
  }
})

app.use(cookieParser())
app.use(express.json())
app.use(compression())
app.use(attachAuthFromToken)
app.use('/api', auditApiWritesMiddleware)
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next()
  }
  const path = req.path?.toLowerCase?.() || ''
  if (PUBLIC_API_PATHS.has(path)) {
    return next()
  }
  if (!req.authUser) {
  return requireAuth(req, res, next)
  }

  // Global maintenance gate: block non-superusers from all API routes (except public status)
  const isSuperuser = String(req.authUser.role || '').toLowerCase() === 'superuser'
  const maintenanceOn = isMaintenanceEnabled()
  if (maintenanceOn && !isSuperuser && path !== '/system/status') {
    return res.status(503).json({ error: 'System under maintenance' })
  }

  return next()
})

// Get all collectors (defined after CORS middleware)
app.get('/api/collectors', (req, res) => {
  try {
    const { branch_code } = req.query
    let query = 'SELECT * FROM collectors'
    const params = []
    
    if (branch_code) {
      query += ' WHERE branch_code = ?'
      params.push(branch_code)
    }
    
    query += ' ORDER BY branch_code, collector_id'
    
    const rows = dbRW.prepare(query).all(...params)
    
    // Parse collector_data JSON for each row
    const collectors = rows.map(row => {
      try {
        const data = JSON.parse(row.collector_data || '{}')
        return {
          id: row.id,
          collector_id: row.collector_id,
          branch_code: row.branch_code,
          ...data,
          created_at: row.created_at,
          updated_at: row.updated_at
        }
      } catch (e) {
        return {
          id: row.id,
          collector_id: row.collector_id,
          branch_code: row.branch_code,
          collector_data: row.collector_data,
          created_at: row.created_at,
          updated_at: row.updated_at
        }
      }
    })
    
    res.json(collectors)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// SSE endpoint for dashboard clients to receive live update notifications
app.get('/api/events', (req, res) => {
  setEventStreamHeaders(req, res)

  const onDataUpdated = () => res.write('data: data_updated\n\n')
  events.on('data_updated', onDataUpdated)
  req.on('close', () => {
    events.off('data_updated', onDataUpdated)
  })
})

// Zidisha data endpoint
app.get('/api/zidisha/data', requireAuth, (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSizeRaw = parseInt(req.query.pageSize, 10)
    const pageSize = Math.min(Math.max(pageSizeRaw || 2000, 100), 10000)
    const offset = (page - 1) * pageSize

    // Support filtering by product name (exact match or list)
    const product = req.query.product
    const products = req.query.products ? req.query.products.split(',').map(p => p.trim()) : null
    
    // Support filtering by branch (exact match)
    const branch = req.query.branch
    
    // Support excluding a branch
    const excludeBranch = req.query.excludeBranch
    
    // Support excluding client IDs
    const excludeClientIds = req.query.excludeClientIds ? req.query.excludeClientIds.split(',').map(id => id.trim()).filter(Boolean) : null

    // Support filtering by month/year for "Expected Matured On Date"
    const month = req.query.month ? parseInt(req.query.month, 10) : null
    const year = req.query.year ? parseInt(req.query.year, 10) : null
  // Which date column month/year applies to (default: expected matured)
  const dateField = String(req.query.dateField || '').trim().toLowerCase()

    // Build WHERE clause
    const whereConditions = []
    const params = []

    // Enforce branch restrictions for custom users.
    // If requesting "Zidisha Boda", use allowedBodaBranches. Otherwise, use allowedZidishaBranches.
    const authRole = String(req.authUser?.role || '').toLowerCase()
    const productNorm = product != null ? String(product).trim().toLowerCase() : ''
    const productsNorm = Array.isArray(products) ? products.map((p) => String(p || '').trim().toLowerCase()).filter(Boolean) : null
    const requestingBoda =
      productNorm === 'zidisha boda' ||
      (productsNorm && productsNorm.includes('zidisha boda'))

    const allowed = requestingBoda ? getAllowedBodaBranches(req) : getAllowedZidishaBranches(req)
    const deniedMsg = requestingBoda ? 'No Boda branch access configured for this user' : 'No Zidisha branch access configured for this user'
    if (authRole === 'custom' && allowed.length === 0) {
      return res.status(403).json({ error: deniedMsg })
    }

    if (allowed.length > 0) {
      const allowedNorm = new Set(allowed.map((b) => String(b || '').trim()).filter(Boolean))
      if (branch) {
        const bNorm = String(branch || '').trim()
        if (!allowedNorm.has(bNorm)) {
          return res.status(403).json({ error: 'Branch not allowed for this user' })
        }
      } else {
        const placeholders = allowed.map(() => '?').join(', ')
        whereConditions.push(`"Branch Name" COLLATE NOCASE IN (${placeholders})`)
        params.push(...allowed.map((b) => String(b || '').trim()))
      }
    }

    if (product) {
      // Use LIKE for case-insensitive matching (can use index with COLLATE NOCASE)
      whereConditions.push('"Product Name" COLLATE NOCASE = ?')
      params.push(product.trim())
    } else if (products && products.length > 0) {
      // Filter by multiple products - use COLLATE NOCASE for case-insensitive matching
      const placeholders = products.map(() => '?').join(', ')
      whereConditions.push(`"Product Name" COLLATE NOCASE IN (${placeholders})`)
      params.push(...products.map(p => p.trim()))
    }

    if (branch) {
      // Use COLLATE NOCASE for case-insensitive matching (can use index)
      whereConditions.push('"Branch Name" COLLATE NOCASE = ?')
      params.push(branch.trim())
    }

    if (excludeBranch) {
      // Use COLLATE NOCASE for case-insensitive matching
      whereConditions.push('"Branch Name" COLLATE NOCASE != ?')
      params.push(excludeBranch.trim())
    }
    
    if (excludeClientIds && excludeClientIds.length > 0) {
      const placeholders = excludeClientIds.map(() => '?').join(', ')
      whereConditions.push(`"Client Id" NOT IN (${placeholders})`)
      params.push(...excludeClientIds.map(id => id.trim()))
    }

    // Filter by month/year if provided.
    // Default behavior remains: month/year filters "Expected Matured On Date".
    // If dateField=disbursed, month/year filters "Disbursed On Date" (used by Disbursement page).
    if (month && year && month >= 1 && month <= 12) {
      const monthStr = String(month).padStart(2, '0')
      const yearStr = String(year)
      const col = dateField === 'disbursed' ? 'Disbursed On Date' : 'Expected Matured On Date'

      whereConditions.push(`(
        ("${col}" LIKE ?) OR
        ("${col}" LIKE ?) OR
        (substr("${col}", 7, 4) = ? AND substr("${col}", 4, 2) = ?)
      )`)
      params.push(`${yearStr}-${monthStr}-%`, `%/${monthStr}/${yearStr}%`, yearStr, monthStr)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count with filters
    const countQuery = `SELECT COUNT(*) as count FROM zidisha_data ${whereClause}`
    const totalRow = db.prepare(countQuery).get(...params)
    const total = totalRow?.count || 0

    // Get rows with filters
    // Remove ORDER BY for better performance - let client sort if needed
    // If ordering is needed, use indexed column instead of rowid
    const dataQuery = `SELECT * FROM zidisha_data ${whereClause} LIMIT ? OFFSET ?`
    const rows = db.prepare(dataQuery).all(...params, pageSize, offset)

    res.json({
      meta: {
        page,
        pageSize,
        total,
        totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0
      },
      results: rows
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Report generation endpoint - processes data and returns aggregated monthly report
app.post('/api/reports/generate', requireAuth, async (req, res) => {
  try {
    const { type, fromMonth, toMonth } = req.body || {}
    
    if (!type || !fromMonth || !toMonth) {
      return res.status(400).json({ error: 'type, fromMonth, and toMonth are required' })
    }

    // Simulate processing delay (3 seconds)
    await new Promise(resolve => setTimeout(resolve, 3000))

    const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number)
    const [toYear, toMonthNum] = toMonth.split('-').map(Number)

    // Build base query filters based on report type
    const whereConditions = []
    const params = []

    if (type === 'zidisha') {
      const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']
      const placeholders = zidishaProducts.map(() => '?').join(', ')
      whereConditions.push(`LOWER(TRIM("Product Name")) IN (${placeholders})`)
      params.push(...zidishaProducts.map(p => p.toLowerCase()))
      whereConditions.push('LOWER(TRIM("Branch Name")) != LOWER(?)')
      params.push('Advans Branch')
    } else if (type === 'advans') {
      whereConditions.push('LOWER(TRIM("Branch Name")) = LOWER(?)')
      params.push('Advans Branch')
    } else if (type === 'boda') {
      whereConditions.push('LOWER(TRIM("Product Name")) = LOWER(?)')
      params.push('Zidisha Boda')
      whereConditions.push('TRIM("Client Id") != ?')
      params.push('3926')
    } else if (type === 'zidisha-branchwise') {
      const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']
      const placeholders = zidishaProducts.map(() => '?').join(', ')
      whereConditions.push(`LOWER(TRIM("Product Name")) IN (${placeholders})`)
      params.push(...zidishaProducts.map(p => p.toLowerCase()))
      whereConditions.push('LOWER(TRIM("Branch Name")) != LOWER(?)')
      params.push('Advans Branch')
    } else {
      return res.status(400).json({ error: 'Invalid report type' })
    }

    // Enforce branch restrictions for custom users
    const authRole = String(req.authUser?.role || '').toLowerCase()
    if (authRole === 'custom' && (type === 'zidisha' || type === 'zidisha-branchwise')) {
      const allowed = Array.isArray(req.authUser?.allowedZidishaBranches) ? req.authUser.allowedZidishaBranches : []
      if (allowed.length === 0) {
        return res.status(403).json({ error: 'No Zidisha branch access configured for this user' })
      }
      const placeholders = allowed.map(() => '?').join(', ')
      whereConditions.push(`LOWER(TRIM("Branch Name")) IN (${placeholders})`)
      params.push(...allowed.map((b) => String(b || '').trim().toLowerCase()))
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get all rows matching filters
    const rows = db.prepare(`SELECT * FROM zidisha_data ${whereClause}`).all(...params)

    const monthMap = new Map()

    // Process each row for monthly aggregation
    rows.forEach(row => {
      // Process disbursements
      const disbursedDate = row['Disbursed On Date'] || row.disbursed_on_date
      if (disbursedDate) {
        const d = new Date(disbursedDate)
        if (!isNaN(d.getTime())) {
          const rowYear = d.getFullYear()
          const rowMonth = d.getMonth() + 1
          
          if (rowYear < fromYear || (rowYear === fromYear && rowMonth < fromMonthNum)) return
          if (rowYear > toYear || (rowYear === toYear && rowMonth > toMonthNum)) return
          
          const monthKey = `${rowYear}-${String(rowMonth).padStart(2, '0')}`
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const monthLabel = `${monthNames[d.getMonth()]}-${d.getFullYear()}`
          
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, {
              month: monthLabel,
              year: rowYear,
              monthNum: rowMonth,
              totalCollected: 0,
              totalDisbursed: 0,
              totalExpectedRepayment: 0
            })
          }
          const principal = Number(row['Principal Amount'] || row.principal_amount || 0)
          monthMap.get(monthKey).totalDisbursed += principal
        }
      }

      // Process collections
      const maturedDate = row['Expected Matured On Date'] || row.expected_matured_on_date
      if (maturedDate) {
        const d = new Date(maturedDate)
        if (!isNaN(d.getTime())) {
          const rowYear = d.getFullYear()
          const rowMonth = d.getMonth() + 1
          
          if (rowYear < fromYear || (rowYear === fromYear && rowMonth < fromMonthNum)) return
          if (rowYear > toYear || (rowYear === toYear && rowMonth > toMonthNum)) return
          
          const monthKey = `${rowYear}-${String(rowMonth).padStart(2, '0')}`
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const monthLabel = `${monthNames[d.getMonth()]}-${d.getFullYear()}`
          
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, {
              month: monthLabel,
              year: rowYear,
              monthNum: rowMonth,
              totalCollected: 0,
              totalDisbursed: 0,
              totalExpectedRepayment: 0
            })
          }
          const repayment = Number(row['Total Repayment Derived'] || row.total_repayment_derived || 0)
          const expectedRepayment = Number(row['Total Expected Repayment Derived'] || row.total_expected_repayment_derived || 0)
          monthMap.get(monthKey).totalCollected += repayment
          monthMap.get(monthKey).totalExpectedRepayment += expectedRepayment
        }
      }
    })

    let reportData = Array.from(monthMap.values())
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year
        return a.monthNum - b.monthNum
      })

    // For branchwise report, aggregate by branch instead
    if (type === 'zidisha-branchwise') {
      const branchMap = new Map()
      
      rows.forEach(row => {
        const branchName = (row['Branch Name'] || row.branch_name || 'Unknown').trim()
        
        // Process disbursements
        const disbursedDate = row['Disbursed On Date'] || row.disbursed_on_date
        if (disbursedDate) {
          const d = new Date(disbursedDate)
          if (!isNaN(d.getTime())) {
            const rowYear = d.getFullYear()
            const rowMonth = d.getMonth() + 1
            
            if (rowYear < fromYear || (rowYear === fromYear && rowMonth < fromMonthNum)) return
            if (rowYear > toYear || (rowYear === toYear && rowMonth > toMonthNum)) return
            
            if (!branchMap.has(branchName)) {
              branchMap.set(branchName, {
                branch: branchName,
                totalCollected: 0,
                totalDisbursed: 0,
                totalExpectedRepayment: 0
              })
            }
            const principal = Number(row['Principal Amount'] || row.principal_amount || 0)
            branchMap.get(branchName).totalDisbursed += principal
          }
        }

        // Process collections
        const maturedDate = row['Expected Matured On Date'] || row.expected_matured_on_date
        if (maturedDate) {
          const d = new Date(maturedDate)
          if (!isNaN(d.getTime())) {
            const rowYear = d.getFullYear()
            const rowMonth = d.getMonth() + 1
            
            if (rowYear < fromYear || (rowYear === fromYear && rowMonth < fromMonthNum)) return
            if (rowYear > toYear || (rowYear === toYear && rowMonth > toMonthNum)) return
            
            if (!branchMap.has(branchName)) {
              branchMap.set(branchName, {
                branch: branchName,
                totalCollected: 0,
                totalDisbursed: 0,
                totalExpectedRepayment: 0
              })
            }
            const repayment = Number(row['Total Repayment Derived'] || row.total_repayment_derived || 0)
            const expectedRepayment = Number(row['Total Expected Repayment Derived'] || row.total_expected_repayment_derived || 0)
            branchMap.get(branchName).totalCollected += repayment
            branchMap.get(branchName).totalExpectedRepayment += expectedRepayment
          }
        }
      })

      reportData = Array.from(branchMap.values())
        .sort((a, b) => a.branch.localeCompare(b.branch))
    }

    res.json({ data: reportData })
  } catch (e) {
    console.error('[Report Generation API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Report: Boda top up qualifiers (from zidisha_data where Product Name = Zidisha Boda)
app.get('/api/reports/boda-topup-qualifiers', requireAuth, (req, res) => {
  try {
    const minPercentPaid = req.query && req.query.minPercentPaid != null ? Number(req.query.minPercentPaid) : 70
    const minPercentPaidSafe = Number.isFinite(minPercentPaid) ? minPercentPaid : 70

    const authRole = String(req.authUser?.role || '').toLowerCase()
    const allowed = getAllowedBodaBranches(req)
    if (authRole === 'custom' && allowed.length === 0) {
      return res.status(403).json({ error: 'No Boda branch access configured for this user' })
    }

    const allowedNorm = allowed.length > 0 ? new Set(allowed.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean)) : null

    const rows = db
      .prepare(`
        SELECT
          "Branch Name" as branchName,
          "Client Id" as clientId,
          "Client Name" as clientName,
          "Principal Amount" as principalAmount,
          "Principal Outstanding Derived" as principalOutstanding,
          "Expected Matured On Date" as expectedMaturedOnDate
        FROM zidisha_data
        WHERE "Product Name" COLLATE NOCASE = 'Zidisha Boda'
      `)
      .all()

    const parseDateLoose = (s) => {
      const v = String(s || '').trim()
      if (!v) return null
      // Accept YYYY-MM-DD or YYYY/MM/DD
      const iso = v.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})$/)
      if (iso) {
        const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
        return Number.isNaN(d.getTime()) ? null : d
      }
      // Accept DD/MM/YYYY
      const dmy = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
      if (dmy) {
        const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
        return Number.isNaN(d.getTime()) ? null : d
      }
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? null : d
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Aggregate by Client Id across all not-yet-matured loans
    const byClient = new Map()
    for (const r of rows) {
      const branchName = String(r.branchName || '').trim()
      if (allowedNorm) {
        const b = branchName.toLowerCase()
        if (!b || !allowedNorm.has(b)) continue
      }

      const expectedMaturedOnDate = String(r.expectedMaturedOnDate || '').trim()
      const expectedDate = parseDateLoose(expectedMaturedOnDate)
      // Only include loans whose Expected Matured On Date is AFTER today
      if (!expectedDate || expectedDate <= today) continue

      const clientId = String(r.clientId || '').trim()
      if (!clientId) continue

      const principalAmount = Number(r.principalAmount) || 0
      const principalOutstanding = Number(r.principalOutstanding) || 0

      const existing = byClient.get(clientId) || {
        clientId,
        clientName: String(r.clientName || '').trim(),
        branchName,
        principalAmountTotal: 0,
        principalOutstandingTotal: 0,
        nextExpectedMaturedOnDate: expectedMaturedOnDate,
        nextExpectedDate: expectedDate,
      }
      existing.principalAmountTotal += principalAmount
      existing.principalOutstandingTotal += principalOutstanding
      // pick earliest upcoming expected date as "next"
      if (expectedDate < existing.nextExpectedDate) {
        existing.nextExpectedDate = expectedDate
        existing.nextExpectedMaturedOnDate = expectedMaturedOnDate
      }
      // keep a representative branch name (first non-empty)
      if (!existing.branchName && branchName) existing.branchName = branchName
      if (!existing.clientName && String(r.clientName || '').trim()) existing.clientName = String(r.clientName || '').trim()
      byClient.set(clientId, existing)
    }

    const cleaned = []
    for (const c of byClient.values()) {
      const paid = c.principalAmountTotal - c.principalOutstandingTotal
      const safePaid = paid > 0 ? paid : 0
      const pctPaid = c.principalAmountTotal > 0 ? (safePaid / c.principalAmountTotal) * 100 : 0
      if (pctPaid < minPercentPaidSafe) continue
      cleaned.push({
        branchName: c.branchName,
        clientId: c.clientId,
        clientName: c.clientName,
        principalAmount: c.principalAmountTotal,
        principalOutstanding: c.principalOutstandingTotal,
        percentPrincipalPaid: pctPaid,
        expectedMaturedOnDate: c.nextExpectedMaturedOnDate,
      })
    }

    // Sort by Expected Matured On Date ascending (so it appears after the % paid column, but is still meaningful)
    cleaned.sort((a, b) => String(a.expectedMaturedOnDate).localeCompare(String(b.expectedMaturedOnDate)))

    return res.json({ data: cleaned })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})

// Test Boda top-up SMS (Onfon): dry-run, single qualified client, or forced test number. Admin/superuser only.
app.post('/api/sms/boda-topup/test', requireAuth, async (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const body = req.body || {}
    const sendDate = getNairobiDateKey()
    const today = getBodaTopUpMaturityFilterDate()
    const minPct = body.minPercentPaid != null ? Number(body.minPercentPaid) : Number(process.env.TOPUP_MIN_PERCENT_PAID || 70)
    const minPctSafe = Number.isFinite(minPct) ? minPct : 70
    const onfonConfigured = getOnfonConfigured()

    if (body.force === true && body.phone) {
      const phone = normalizeKenyanPhone(body.phone)
      if (!phone) return res.status(400).json({ error: 'Invalid phone' })
      const name = String(body.name || 'Test').trim() || 'Test'
      if (!onfonConfigured) {
        return res.status(400).json({ error: 'Missing ONFON_API_KEY / ONFON_CLIENT_ID / ONFON_SENDER_ID', onfonConfigured: false })
      }
      try {
        const response = await sendTopUpSMS(name, phone)
        return res.json({ ok: true, mode: 'force', phone, response, onfonConfigured })
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e), onfonConfigured })
      }
    }

    const byClient = buildBodaTopUpZidishaByClient(today)

    const logRowsFor = (clientId) =>
      dbRW.prepare('SELECT slot, status FROM TopUp_SMS_Log WHERE send_date = ? AND client_id = ?').all(sendDate, clientId)

    if (body.clientId && body.send === true) {
      const id = String(body.clientId || '').trim()
      const c = byClient.get(id)
      if (!c) {
        return res
          .status(404)
          .json({ error: 'Client not found in Boda not-yet-matured aggregates (check zidisha_data and maturity dates)' })
      }
      const pctPaid = bodaTopUpClientPercentPaid(c)
      if (pctPaid < minPctSafe) return res.status(400).json({ error: 'Client below min % paid for top-up', percentPrincipalPaid: pctPaid })
      if (!c.phone) return res.status(400).json({ error: 'No phone in zidisha_data for this client' })
      if (!onfonConfigured) {
        return res.status(400).json({ error: 'Missing ONFON_API_KEY / ONFON_CLIENT_ID / ONFON_SENDER_ID', onfonConfigured: false })
      }

      const slotTest = 'test'
      if (!body.bypassDedupe) {
        const exists = dbRW
          .prepare('SELECT 1 FROM TopUp_SMS_Log WHERE send_date = ? AND slot = ? AND client_id = ? LIMIT 1')
          .get(sendDate, slotTest, c.clientId)
        if (exists) {
          return res
            .status(409)
            .json({ error: 'Test SMS already logged for this client today (use bypassDedupe: true to resend)' })
        }
      }
      try {
        const response = await sendTopUpSMS(c.name, c.phone)
        dbRW
          .prepare(
            `INSERT INTO TopUp_SMS_Log (send_date, slot, client_id, phone, status, response)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(sendDate, slotTest, c.clientId, c.phone, 'sent', JSON.stringify(response || {}))
        return res.json({
          ok: true,
          mode: 'client',
          clientId: c.clientId,
          phone: c.phone,
          response,
          sendDate,
          slot: slotTest,
        })
      } catch (e) {
        dbRW
          .prepare(
            `INSERT OR IGNORE INTO TopUp_SMS_Log (send_date, slot, client_id, phone, status, response)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(sendDate, slotTest, c.clientId, c.phone, 'error', String(e?.message || e))
        return res.status(500).json({ ok: false, error: String(e?.message || e) })
      }
    }

    let belowMinPercent = 0
    let noPhone = 0
    const qualified = []
    for (const c of byClient.values()) {
      const pctPaid = bodaTopUpClientPercentPaid(c)
      if (pctPaid < minPctSafe) {
        belowMinPercent += 1
        continue
      }
      if (!c.phone) {
        noPhone += 1
        continue
      }
      qualified.push({
        clientId: c.clientId,
        name: c.name,
        phone: c.phone,
        totalPrincipal: c.totalPrincipal,
        totalOutstanding: c.totalOutstanding,
        percentPrincipalPaid: pctPaid,
        smsLogToday: logRowsFor(c.clientId),
      })
    }
    qualified.sort((a, b) => String(a.clientId).localeCompare(String(b.clientId)))

    return res.json({
      dryRun: true,
      nairobiDate: sendDate,
      minPercentPaid: minPctSafe,
      onfonConfigured,
      counts: {
        wouldMessage: qualified.length,
        belowMinPercent,
        noPhone,
        totalAggregatedClients: byClient.size,
      },
      qualified,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})

// Zidisha branches endpoint (distinct branches for Zidisha products)
app.get('/api/zidisha/branches', requireAuth, (req, res) => {
  try {
    const zidishaProducts = [
      'Zidisha Kifaru',
      'Zidisha Nyati',
      'Zidisha Simba',
      'Zidisha Tembo',
      'Zidisha Express',
    ]

    const placeholders = zidishaProducts.map(() => '?').join(', ')
    const sql = `
      SELECT DISTINCT TRIM("Branch Name") AS branch
      FROM zidisha_data
      WHERE TRIM("Branch Name") IS NOT NULL
        AND TRIM("Branch Name") != ''
        AND LOWER(TRIM("Product Name")) IN (${placeholders})
      ORDER BY branch COLLATE NOCASE
    `
    let branches = db.prepare(sql).all(...zidishaProducts.map((p) => p.toLowerCase())).map((r) => r.branch).filter(Boolean)

    // Enforce Zidisha branch restrictions if configured (all roles)
    const allowedZidisha = getAllowedZidishaBranches(req)
    if (allowedZidisha.length > 0) {
      const allowedNorm = new Set(
        allowedZidisha.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean)
      )
      branches = branches.filter((b) => allowedNorm.has(String(b || '').trim().toLowerCase()))
    }

    res.json(branches)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Boda branches endpoint (distinct branches for Zidisha Boda product)
app.get('/api/boda/branches', requireAuth, (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT TRIM("Branch Name") AS branch
      FROM zidisha_data
      WHERE TRIM("Branch Name") IS NOT NULL
        AND TRIM("Branch Name") != ''
        AND LOWER(TRIM("Product Name")) = LOWER(?)
      ORDER BY branch COLLATE NOCASE
    `
    let branches = db.prepare(sql).all('Zidisha Boda').map((r) => r.branch).filter(Boolean)

    // Enforce Boda branch restrictions if configured (all roles)
    const allowedBoda = getAllowedBodaBranches(req)
    if (allowedBoda.length > 0) {
      const allowedNorm = new Set(
        allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean)
      )
      branches = branches.filter((b) => allowedNorm.has(String(b || '').trim().toLowerCase()))
    }

    res.json(branches)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Boda repayments endpoint - get repayment sums by Client Id, Loan Id, and month/year
app.get('/api/boda/repayments', (req, res) => {
  try {
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }

    // Build date range for the selected month
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    // Query: sum Transaction Amount grouped by Client Id and Loan Id for the selected month
    const rows = db.prepare(`
      SELECT 
        "Client Id" as clientId,
        "Loan Id" as loanId,
        SUM("Transaction Amount") as totalRepaid
      FROM boda_repayments
      WHERE "Submitted On Date" >= ? AND "Submitted On Date" < ?
        AND "Transaction Amount" IS NOT NULL
      GROUP BY "Client Id", "Loan Id"
    `).all(monthStart, monthEnd)

    // Convert to a map for easy lookup: key = "clientId|loanId", value = totalRepaid
    const repaymentMap = {}
    for (const row of rows) {
      const key = `${row.clientId}|${row.loanId}`
      repaymentMap[key] = Number(row.totalRepaid || 0)
    }

    res.json(repaymentMap)
  } catch (e) {
    console.error('[Boda Repayments API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda all repayments endpoint - get all repayments (all time) grouped by Client Id and Loan Id
app.get('/api/boda/repayments/all', (req, res) => {
  try {
    // Query: sum Transaction Amount grouped by Client Id and Loan Id (all time)
    const rows = db.prepare(`
      SELECT 
        "Client Id" as clientId,
        "Loan Id" as loanId,
        SUM("Transaction Amount") as totalRepaid
      FROM boda_repayments
      WHERE "Transaction Amount" IS NOT NULL
      GROUP BY "Client Id", "Loan Id"
    `).all()

    // Convert to a map for easy lookup: key = "clientId|loanId", value = totalRepaid
    const repaymentMap = {}
    for (const row of rows) {
      const key = `${row.clientId}|${row.loanId}`
      repaymentMap[key] = Number(row.totalRepaid || 0)
    }

    res.json(repaymentMap)
  } catch (e) {
    console.error('[Boda All Repayments API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda repayments by date - which clients paid on a given date (for "paid today" filter)
// Table: boda_repayments. Columns: "Client Id", "Loan Id", "Submitted On Date", "Transaction Amount"
app.get('/api/boda/repayments/by-date', (req, res) => {
  try {
    const dateStr = String(req.query.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' })
    }
    // Next calendar day for exclusive upper bound (matches "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS")
    const [y, m, d] = dateStr.split('-').map(Number)
    const nextDayStr = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
    const rows = db.prepare(`
      SELECT
        "Client Id" as clientId,
        "Loan Id" as loanId,
        SUM(CAST("Transaction Amount" AS REAL)) as amount
      FROM boda_repayments
      WHERE "Submitted On Date" >= ? AND "Submitted On Date" < ?
        AND "Transaction Amount" IS NOT NULL
        AND "Transaction Amount" != ''
        AND CAST("Transaction Amount" AS REAL) > 0
      GROUP BY "Client Id", "Loan Id"
    `).all(dateStr, nextDayStr)
    const map = {}
    for (const row of rows) {
      const key = `${String(row.clientId || '').trim()}|${String(row.loanId || '').trim()}`
      if (key !== '|') map[key] = Number(row.amount || 0)
    }
    res.json(map)
  } catch (e) {
    console.error('[Boda Repayments By Date] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda daily repayments endpoint - get daily repayment breakdown for a month
app.get('/api/boda/repayments/daily', (req, res) => {
  try {
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }

    // Build date range for the selected month
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    // Query: sum Transaction Amount grouped by day for the selected month
    // Extract day from date string (format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)
    // Day is at positions 9-10 (1-indexed) in "YYYY-MM-DD" format
    const rows = db.prepare(`
      SELECT 
        CAST(SUBSTR("Submitted On Date", 9, 2) AS INTEGER) as day,
        SUM(CAST("Transaction Amount" AS REAL)) as totalRepaid
      FROM boda_repayments
      WHERE "Submitted On Date" >= ? 
        AND "Submitted On Date" < ?
        AND "Transaction Amount" IS NOT NULL
        AND "Transaction Amount" != ''
        AND CAST("Transaction Amount" AS REAL) > 0
      GROUP BY day
      ORDER BY day
    `).all(monthStart, monthEnd)

    // Convert to a map: key = day (1-31), value = totalRepaid
    const dailyRepayments = {}
    for (const row of rows) {
      const day = Number(row.day || 0)
      if (day >= 1 && day <= 31) {
        dailyRepayments[day] = Number(row.totalRepaid || 0)
      }
    }

    console.log(`[Boda Daily Repayments] Month: ${month}/${year}, Found ${rows.length} days with repayments`)
    res.json(dailyRepayments)
  } catch (e) {
    console.error('[Boda Daily Repayments API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Preview: which clients would receive the arrears SMS (no sending)
app.get('/api/boda/arrears-sms/preview', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 1000)
    const slot = String(req.query.slot ?? '07:05').trim() || '07:05'
    const asOfDate = req.query.date != null ? String(req.query.date).trim() : ''
    const includeAlreadySent = ['1', 'true', 'yes'].includes(String(req.query.includeAlreadySent || '').toLowerCase())

    const result = buildBodaCollectionArrearsPreview({
      asOfDate: asOfDate || undefined,
      slot,
      limit,
      includeAlreadySent,
    })
    res.json(result)
  } catch (e) {
    console.error('[Boda Arrears SMS Preview API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// --- Credit scorecard acceleration: precomputed tables + indexes ---
function ensureCreditIndexes() {
  try {
    dbRW.exec(`CREATE INDEX IF NOT EXISTS idx_repay_loan_date ON boda_repayments("Loan Id", "Submitted On Date");`)
  } catch {}
  try {
    dbRW.exec(`CREATE INDEX IF NOT EXISTS idx_repay_date ON boda_repayments("Submitted On Date");`)
  } catch {}
  try {
    dbRW.exec(`CREATE INDEX IF NOT EXISTS idx_zidisha_loan ON zidisha_data("Loan ID");`)
  } catch {}
  try {
    dbRW.exec(`CREATE INDEX IF NOT EXISTS idx_zidisha_client ON zidisha_data("Client Id");`)
  } catch {}
}

function refreshCreditScoresForProduct(product, { scopeBranches = [], scopeProducts = [] } = {}) {
  const p = String(product || '').trim().toLowerCase()
  const loanScoresTable = p === 'boda' ? 'loan_scores_boda' : p === 'zidisha' ? 'loan_scores_zidisha' : 'loan_scores_all'
  const creditScoresTable = p === 'boda' ? 'credit_scores_boda' : p === 'zidisha' ? 'credit_scores_zidisha' : 'credit_scores'

  const products = Array.isArray(scopeProducts) ? scopeProducts.filter(Boolean) : []
  const branches = Array.isArray(scopeBranches) ? scopeBranches.filter(Boolean) : []

  const productClause =
    products.length > 0
      ? ` AND LOWER(TRIM(z."Product Name")) IN (${products.map(() => '?').join(', ')}) `
      : ''
  const branchClause =
    branches.length > 0
      ? ` AND LOWER(TRIM(z."Branch Name")) IN (${branches.map(() => '?').join(', ')}) `
      : ''

  const params = [...products.map((x) => String(x).toLowerCase()), ...branches.map((x) => String(x).toLowerCase())]

  // Stage 1: shared repayment stats per loan (scan repayments once)
  dbRW.exec(`
    DROP TABLE IF EXISTS loan_repay_stats;
    CREATE TABLE loan_repay_stats AS
    SELECT
      "Loan Id" AS loan_id,
      COUNT(DISTINCT date("Submitted On Date")) AS paid_days,
      COUNT(DISTINCT CASE
        WHEN date("Submitted On Date") >= date('now','-30 days')
        THEN date("Submitted On Date")
      END) AS paid_days_last_30,
      MAX(date("Submitted On Date")) AS last_payment_date,
      SUM(CAST("Transaction Amount" AS REAL)) AS total_paid
    FROM boda_repayments
    WHERE "Submitted On Date" IS NOT NULL
      AND CAST("Transaction Amount" AS REAL) > 0
    GROUP BY "Loan Id";

    CREATE INDEX IF NOT EXISTS idx_lrs_loan ON loan_repay_stats(loan_id);
  `)

  // Stage 2: per-loan scores for the requested product scope (single join, no recursion)
  dbRW.exec(`DROP TABLE IF EXISTS ${loanScoresTable};`)
  const stage2 = `
    CREATE TABLE ${loanScoresTable} AS
    WITH base AS (
      SELECT
        z."Loan ID" AS loan_id,
        z."Client Id" AS client_id,
        z."Client Name" AS client_name,
        z."Phone Number" AS phone,
        z."Branch Name" AS branch,
        z."Loan Officer Name" AS loan_officer,
        z."Loan Status Id" AS loan_status,
        CAST(z."Principal Amount" AS REAL) AS principal_amount,
        CAST(z."Principal Outstanding Derived" AS REAL) AS principal_outstanding,
        CAST(z."Total Outstanding Derived" AS REAL) AS outstanding,
        CAST(z."Total Expected Repayment Derived" AS REAL) AS total_expected,
        julianday(z."Disbursed On Date") AS j_start,
        julianday(z."Expected Matured On Date") AS j_maturity,
        julianday('now') AS j_now,
        COALESCE(r.paid_days, 0) AS paid_days,
        COALESCE(r.paid_days_last_30, 0) AS paid_days_last_30,
        r.last_payment_date,
        CASE
          WHEN z."Loan Status Id" IN ('600','700') OR CAST(z."Total Outstanding Derived" AS REAL) <= 1
            THEN COALESCE(julianday(r.last_payment_date), julianday('now'))
          ELSE julianday('now')
        END AS j_end
      FROM zidisha_data z
      LEFT JOIN loan_repay_stats r
        ON r.loan_id = z."Loan ID"
      WHERE z."Disbursed On Date" IS NOT NULL
        AND z."Loan ID" IS NOT NULL
        AND (
          CASE
            WHEN TRIM(COALESCE(z."Expected Matured On Date", '')) LIKE '__/__/____'
              THEN date(
                substr(TRIM(z."Expected Matured On Date"), 7, 4) || '-' ||
                substr(TRIM(z."Expected Matured On Date"), 4, 2) || '-' ||
                substr(TRIM(z."Expected Matured On Date"), 1, 2)
              )
            ELSE date(TRIM(z."Expected Matured On Date"))
          END
        ) > date('now')
        ${productClause}
        ${branchClause}
    ),
    derived AS (
      SELECT
        b.*,
        MAX(1, CAST(j_end - j_start AS INTEGER)) AS expected_days,
        MIN(30, MAX(1, CAST(j_end - j_start AS INTEGER))) AS recent_window,
        CASE
          WHEN last_payment_date IS NULL THEN 9999
          ELSE CAST(j_now - julianday(last_payment_date) AS INTEGER)
        END AS days_since_last_pay,
        CASE
          WHEN (j_maturity - j_start) > 0 THEN total_expected / (j_maturity - j_start)
          ELSE 0
        END AS expected_daily
      FROM base b
    ),
    scored AS (
      SELECT
        d.*,
        MAX(0, (expected_days - paid_days) * expected_daily) AS missed_expected_amount,
        MIN(100.0, 100.0 * paid_days * 1.0 / expected_days) AS consistency_score,
        MIN(100.0, 100.0 * paid_days_last_30 * 1.0 / recent_window) AS recent_score,
        CASE
          WHEN loan_status IN ('600','700') OR outstanding <= 1 THEN 100.0
          WHEN outstanding <= 0.01 THEN 0.0
          ELSE MAX(0.0, 100.0 * (1.0 - MAX(0,(expected_days - paid_days) * expected_daily) / outstanding))
        END AS exposure_score,
        CASE
          WHEN loan_status IN ('600','700') OR outstanding <= 1 THEN 100.0
          WHEN days_since_last_pay <= 7  THEN 100.0
          WHEN days_since_last_pay <= 14 THEN 80.0
          WHEN days_since_last_pay <= 30 THEN 50.0
          ELSE 0.0
        END AS recency_score
      FROM derived d
    )
    SELECT
      loan_id, client_id, client_name, phone, branch, loan_officer,
      loan_status, principal_amount, principal_outstanding, outstanding, expected_days, paid_days,
      paid_days_last_30, last_payment_date, days_since_last_pay,
      ROUND(consistency_score,1) AS consistency_score,
      ROUND(recent_score,1)      AS recent_score,
      ROUND(exposure_score,1)    AS exposure_score,
      ROUND(recency_score,1)     AS recency_score,
      ROUND(0.40*consistency_score + 0.30*recent_score + 0.20*exposure_score + 0.10*recency_score, 1) AS score,
      CASE
        WHEN ROUND(0.40*consistency_score + 0.30*recent_score + 0.20*exposure_score + 0.10*recency_score, 1) >= 70 THEN 'Gold'
        WHEN ROUND(0.40*consistency_score + 0.30*recent_score + 0.20*exposure_score + 0.10*recency_score, 1) >= 50 THEN 'Silver'
        WHEN ROUND(0.40*consistency_score + 0.30*recent_score + 0.20*exposure_score + 0.10*recency_score, 1) >= 40 THEN 'Bronze'
        ELSE 'At Risk'
      END AS band
    FROM scored;
  `
  dbRW.prepare(stage2).run(...params)

  dbRW.exec(`
    CREATE INDEX IF NOT EXISTS idx_${loanScoresTable}_client ON ${loanScoresTable}(client_id);
    CREATE INDEX IF NOT EXISTS idx_${loanScoresTable}_loan ON ${loanScoresTable}(loan_id);
  `)

  // Stage 3: collapse to one row per client
  dbRW.exec(`DROP TABLE IF EXISTS ${creditScoresTable};`)
  dbRW.exec(`
    CREATE TABLE ${creditScoresTable} AS
    WITH ranked AS (
      SELECT ls.*,
        ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY loan_id DESC) AS rn
      FROM ${loanScoresTable} ls
    )
    SELECT
      client_id, client_name, phone, branch, loan_officer,
      MAX(CASE WHEN rn=1 THEN loan_id END) AS current_loan_id,
      MAX(CASE WHEN rn=1 THEN loan_status END) AS current_status,
      MAX(CASE WHEN rn=1 THEN principal_amount END) AS current_principal_amount,
      MAX(CASE WHEN rn=1 THEN principal_outstanding END) AS current_principal_outstanding,
      MAX(CASE WHEN rn=1 THEN outstanding END) AS current_outstanding,
      MAX(CASE WHEN rn=1 THEN score END) AS score,
      MAX(CASE WHEN rn=1 THEN band END) AS band,
      MAX(CASE WHEN rn=1 THEN consistency_score END) AS consistency_score,
      MAX(CASE WHEN rn=1 THEN recent_score END) AS recent_score,
      MAX(CASE WHEN rn=1 THEN exposure_score END) AS exposure_score,
      MAX(CASE WHEN rn=1 THEN recency_score END) AS recency_score,
      MAX(CASE WHEN rn=1 THEN paid_days_last_30 END) AS paid_days_last_30,
      MAX(CASE WHEN rn=1 THEN last_payment_date END) AS last_payment_date,
      MAX(CASE WHEN rn=1 THEN days_since_last_pay END) AS days_since_last_pay,
      COUNT(*) AS total_loans,
      ROUND(AVG(score),1) AS avg_score,
      MAX(score) AS best_score,
      MIN(score) AS worst_score,
      SUM(paid_days) AS lifetime_paid_days,
      SUM(expected_days - paid_days) AS lifetime_missed_days
    FROM ranked
    GROUP BY client_id, client_name, phone, branch, loan_officer;
    CREATE INDEX IF NOT EXISTS idx_${creditScoresTable}_client ON ${creditScoresTable}(client_id);
    CREATE INDEX IF NOT EXISTS idx_${creditScoresTable}_score ON ${creditScoresTable}(score);
    CREATE INDEX IF NOT EXISTS idx_${creditScoresTable}_band ON ${creditScoresTable}(band);
  `)

  return { product: p, tables: { loanScoresTable, creditScoresTable }, rows: dbRW.prepare(`SELECT COUNT(*) as c FROM ${creditScoresTable}`).get().c }
}

function tryQueryCreditScoresTable(tableName, limit) {
  try {
    const c = dbRW.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get().c
    if (!c) return []
    return dbRW.prepare(`SELECT * FROM ${tableName} ORDER BY score DESC LIMIT ?`).all(limit)
  } catch {
    return null
  }
}

// Credit scorecard / client performance (Zidisha + Boda repayments)
// product:
// - boda   => zidisha_data filtered to Product Name = 'Zidisha Boda' (and boda branch permissions)
// - zidisha => zidisha_data filtered to Zidisha core products (and zidisha branch permissions)
app.get('/api/credit/client-performance', requireAuth, (req, res) => {
  try {
    const product = String(req.query.product || '').trim().toLowerCase()
    const limitRaw = req.query.limit != null ? Number(req.query.limit) : 5000
    const limit = Number.isFinite(limitRaw) ? Math.max(100, Math.min(50000, Math.floor(limitRaw))) : 5000
    const minPrincipalPaidRaw = req.query.minPrincipalPaid != null ? Number(req.query.minPrincipalPaid) : 70
    const minPrincipalPaid = Number.isFinite(minPrincipalPaidRaw) ? Math.max(0, Math.min(100, minPrincipalPaidRaw)) : 70

    // Enforce branch scoping (if configured for this user)
    const allowedBranches =
      product === 'boda' ? getAllowedBodaBranches(req) : product === 'zidisha' ? getAllowedZidishaBranches(req) : []
    const allowedNorm =
      Array.isArray(allowedBranches) && allowedBranches.length > 0
        ? new Set(allowedBranches.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
        : null

    // Fast path: serve from precomputed table if present
    const tableName = product === 'boda' ? 'credit_scores_boda' : product === 'zidisha' ? 'credit_scores_zidisha' : 'credit_scores'
    const pre = tryQueryCreditScoresTable(tableName, limit)
    if (Array.isArray(pre)) {
      const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
      const clients = pre
        .map((r) => ({
        clientId: String(r.client_id || ''),
        clientName: String(r.client_name || ''),
        phone: String(r.phone || ''),
        branch: String(r.branch || ''),
        loanOfficer: String(r.loan_officer || ''),
        currentLoanId: String(r.current_loan_id || ''),
        score: safeNum(r.score),
        band: String(r.band || ''),
        behaviourScore: null,
        exposureScore: safeNum(r.exposure_score),
        missedLast30: safeNum(r.paid_days_last_30) ? 0 : safeNum(r.paid_days_last_30), // legacy field not present; keep shape
        lastPaymentDate: r.last_payment_date || null,
        daysSinceLastPay: r.days_since_last_pay == null ? null : safeNum(r.days_since_last_pay),
        principalAmount: safeNum(r.current_principal_amount),
        outstandingKes: safeNum(r.current_outstanding),
        percentPrincipalPaid:
          safeNum(r.current_principal_amount) > 0
            ? ((safeNum(r.current_principal_amount) - safeNum(r.current_principal_outstanding)) / safeNum(r.current_principal_amount)) * 100
            : 0,
        totalLoans: safeNum(r.total_loans),
        avgScore: safeNum(r.avg_score),
        bestScore: safeNum(r.best_score),
        worstScore: safeNum(r.worst_score),
        lifetimePaidDays: safeNum(r.lifetime_paid_days),
        lifetimeMissedDays: safeNum(r.lifetime_missed_days),
      }))
        .filter((c) => Number(c.percentPrincipalPaid || 0) >= minPrincipalPaid)
        .filter((c) => {
          if (!allowedNorm) return true
          const b = String(c.branch || '').trim().toLowerCase()
          return b && allowedNorm.has(b)
        })

      const kpis = {
        totalClients: clients.length,
        avgScore: clients.length ? safeNum((clients.reduce((s, c) => s + safeNum(c.score), 0) / clients.length).toFixed(1)) : 0,
        totalOutstanding: clients.reduce((s, c) => s + safeNum(c.outstandingKes), 0),
        atRisk: clients.filter((c) => c.band === 'At Risk').length,
        gold: clients.filter((c) => c.band === 'Gold').length,
        silver: clients.filter((c) => c.band === 'Silver').length,
        bronze: clients.filter((c) => c.band === 'Bronze').length,
        atRiskOutstanding: clients.filter((c) => c.band === 'At Risk').reduce((s, c) => s + safeNum(c.outstandingKes), 0),
        branches: new Set(clients.map((c) => String(c.branch || '').trim()).filter(Boolean)).size,
        officers: new Set(clients.map((c) => String(c.loanOfficer || '').trim()).filter(Boolean)).size,
      }

      const byBranch = new Map()
      const byOfficer = new Map()
      for (const c of clients) {
        const b = c.branch || 'Unknown'
        const o = c.loanOfficer || 'Unknown'
        const bump = (m, key) => {
          const e = m.get(key) || { key, clients: 0, avgScoreSum: 0, outstanding: 0, gold: 0, silver: 0, bronze: 0, atRisk: 0, missed30: 0 }
          e.clients += 1
          e.avgScoreSum += safeNum(c.score)
          e.outstanding += safeNum(c.outstandingKes)
          if (c.band === 'Gold') e.gold += 1
          else if (c.band === 'Silver') e.silver += 1
          else if (c.band === 'Bronze') e.bronze += 1
          else e.atRisk += 1
          m.set(key, e)
        }
        bump(byBranch, b)
        bump(byOfficer, o)
      }

      const branchesAgg = Array.from(byBranch.values())
        .map((e) => ({
          branch: e.key,
          clients: e.clients,
          avgScore: e.clients ? Number((e.avgScoreSum / e.clients).toFixed(1)) : 0,
          outstanding: e.outstanding,
          gold: e.gold,
          silver: e.silver,
          bronze: e.bronze,
          atRisk: e.atRisk,
          missed30: e.missed30,
          atRiskPct: e.clients ? Number(((e.atRisk / e.clients) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.clients - a.clients)

      const officersAgg = Array.from(byOfficer.values())
        .map((e) => ({
          officer: e.key,
          clients: e.clients,
          avgScore: e.clients ? Number((e.avgScoreSum / e.clients).toFixed(1)) : 0,
          outstanding: e.outstanding,
          gold: e.gold,
          silver: e.silver,
          bronze: e.bronze,
          atRisk: e.atRisk,
          atRiskPct: e.clients ? Number(((e.atRisk / e.clients) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.clients - a.clients)

      const watchlist = clients
        .filter((c) => c.band === 'At Risk' && safeNum(c.outstandingKes) > 0)
        .sort((a, b) => safeNum(b.outstandingKes) - safeNum(a.outstandingKes))
        .slice(0, 50)

      return res.json({
        product: product || null,
        limit,
        kpis,
        branchesAgg,
        officersAgg,
        watchlist,
        clients,
        branchNames: Array.from(new Set(clients.map((c) => c.branch).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        officerNames: Array.from(new Set(clients.map((c) => c.loanOfficer).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        generatedAt: new Date().toISOString(),
        source: 'precomputed',
        minPrincipalPaid,
      })
    }

    const zidishaCoreProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']

    let productWhere = ''
    const params = []

    if (product === 'boda') {
      productWhere = ` AND TRIM("Product Name") COLLATE NOCASE = 'Zidisha Boda' `
      const allowed = getAllowedBodaBranches(req)
      if (allowed.length > 0) {
        const placeholders = allowed.map(() => '?').join(', ')
        productWhere += ` AND LOWER(TRIM("Branch Name")) IN (${placeholders}) `
        params.push(...allowed.map((b) => String(b || '').trim().toLowerCase()))
      }
    } else if (product === 'zidisha') {
      const placeholders = zidishaCoreProducts.map(() => '?').join(', ')
      productWhere = ` AND LOWER(TRIM("Product Name")) IN (${placeholders}) `
      params.push(...zidishaCoreProducts.map((p) => String(p).toLowerCase()))
      const allowed = getAllowedZidishaBranches(req)
      if (allowed.length > 0) {
        const branchPH = allowed.map(() => '?').join(', ')
        productWhere += ` AND LOWER(TRIM("Branch Name")) IN (${branchPH}) `
        params.push(...allowed.map((b) => String(b || '').trim().toLowerCase()))
      }
    } else {
      // default: include everything
      const allowedZ = getAllowedZidishaBranches(req)
      const allowedB = getAllowedBodaBranches(req)
      const allowedAny = [...allowedZ, ...allowedB].map((b) => String(b || '').trim().toLowerCase()).filter(Boolean)
      if (allowedAny.length > 0) {
        const branchPH = allowedAny.map(() => '?').join(', ')
        productWhere = ` AND LOWER(TRIM("Branch Name")) IN (${branchPH}) `
        params.push(...allowedAny)
      }
    }

    // NOTE: Recursive CTE can be heavy. Limit is applied after aggregation.
    const sql = `
WITH loan_window AS (
  SELECT
    z."Loan ID"                             AS loan_id,
    z."Client Id"                           AS client_id,
    z."Client Name"                         AS client_name,
    z."Phone Number"                        AS phone,
    z."Branch Name"                         AS branch,
    z."Loan Officer Name"                   AS loan_officer,
    z."Loan Status Id"                      AS loan_status,
    date(z."Disbursed On Date")             AS start_date,
    date(z."Expected Matured On Date")      AS expected_maturity,
    CAST(z."Principal Amount" AS REAL)      AS principal,
    CAST(z."Principal Outstanding Derived" AS REAL) AS principal_outstanding,
    CAST(z."Total Expected Repayment Derived" AS REAL) AS total_expected,
    CAST(z."Total Outstanding Derived" AS REAL)        AS outstanding,
    CAST(julianday(z."Expected Matured On Date") - julianday(z."Disbursed On Date") AS INTEGER) AS tenor_days,
    CASE
      WHEN z."Loan Status Id" IN ('600', '700')
        OR CAST(z."Total Outstanding Derived" AS REAL) <= 1
      THEN (
        SELECT date(MAX(r."Submitted On Date"))
        FROM   boda_repayments r
        WHERE  r."Loan Id" = z."Loan ID"
      )
      ELSE date('now')
    END                                     AS end_date,
    CASE
      WHEN (julianday(z."Expected Matured On Date") - julianday(z."Disbursed On Date")) > 0
      THEN CAST(z."Total Expected Repayment Derived" AS REAL)
           / (julianday(z."Expected Matured On Date") - julianday(z."Disbursed On Date"))
      ELSE 0
    END AS expected_daily
  FROM zidisha_data z
  WHERE z."Disbursed On Date" IS NOT NULL
    AND z."Loan ID"           IS NOT NULL
    AND (
      CASE
        WHEN TRIM(COALESCE(z."Expected Matured On Date", '')) LIKE '__/__/____'
          THEN date(
            substr(TRIM(z."Expected Matured On Date"), 7, 4) || '-' ||
            substr(TRIM(z."Expected Matured On Date"), 4, 2) || '-' ||
            substr(TRIM(z."Expected Matured On Date"), 1, 2)
          )
        ELSE date(TRIM(z."Expected Matured On Date"))
      END
    ) > date('now')
    ${productWhere}
),
date_spine AS (
  SELECT
    loan_id, client_id, client_name, phone, branch, loan_officer,
    loan_status, principal, principal_outstanding, outstanding, expected_daily,
    start_date, end_date,
    start_date AS day,
    0 AS day_n
  FROM loan_window
  WHERE end_date IS NOT NULL
    AND end_date >= start_date
  UNION ALL
  SELECT
    ds.loan_id, ds.client_id, ds.client_name, ds.phone, ds.branch, ds.loan_officer,
    ds.loan_status, ds.principal, ds.principal_outstanding, ds.outstanding, ds.expected_daily,
    ds.start_date, ds.end_date,
    date(ds.day, '+1 day'),
    ds.day_n + 1
  FROM date_spine ds
  WHERE ds.day < ds.end_date
    AND ds.day_n < 1000
),
paid_days AS (
  SELECT DISTINCT
    "Loan Id"                 AS loan_id,
    date("Submitted On Date") AS pay_day
  FROM boda_repayments
  WHERE "Submitted On Date" IS NOT NULL
    AND CAST("Transaction Amount" AS REAL) > 0
),
spine_flagged AS (
  SELECT
    ds.*,
    CASE WHEN pd.pay_day IS NOT NULL THEN 1 ELSE 0 END AS paid
  FROM date_spine ds
  LEFT JOIN paid_days pd
    ON pd.loan_id = ds.loan_id
   AND pd.pay_day = ds.day
),
weighted AS (
  SELECT
    *,
    CAST(julianday('now') - julianday(day) AS INTEGER) AS days_ago,
    EXP(-0.693147 * (julianday('now') - julianday(day)) / 14.0) AS weight
  FROM spine_flagged
),
loan_agg AS (
  SELECT
    loan_id, client_id, client_name, phone, branch, loan_officer,
    loan_status, principal, principal_outstanding, outstanding, expected_daily,
    MIN(day) AS window_start,
    MAX(day) AS window_end,
    ROUND(100.0 * SUM(weight * paid) / SUM(weight), 1) AS behaviour_score,
    SUM(CASE WHEN paid = 0 THEN expected_daily * weight ELSE 0 END) AS exposure_kes_days,
    SUM(paid) AS paid_days,
    SUM(1 - paid) AS missed_days,
    COUNT(*) AS total_days,
    SUM(CASE WHEN days_ago <= 30 AND paid = 0 THEN 1 ELSE 0 END) AS missed_last_30,
    MAX(CASE WHEN paid = 1 THEN day END) AS last_payment_date,
    CAST(julianday('now') - julianday(MAX(CASE WHEN paid = 1 THEN day END)) AS INTEGER) AS days_since_last_pay
  FROM weighted
  GROUP BY loan_id, client_id, client_name, phone, branch,
           loan_officer, loan_status, principal, principal_outstanding, outstanding, expected_daily
),
loan_final AS (
  SELECT
    la.*,
    CASE
      WHEN la.loan_status IN ('600', '700') OR la.outstanding <= 1 THEN 100.0
      WHEN la.outstanding <= 0.01 THEN 0.0
      ELSE MAX(0.0, 100.0 * (1.0 - la.exposure_kes_days / la.outstanding))
    END AS exposure_score,
    ROUND(
      0.60 * la.behaviour_score +
      0.40 * CASE
               WHEN la.loan_status IN ('600', '700') OR la.outstanding <= 1 THEN 100.0
               WHEN la.outstanding <= 0.01 THEN 0.0
               ELSE MAX(0.0, 100.0 * (1.0 - la.exposure_kes_days / la.outstanding))
             END,
      1
    ) AS score,
    CASE
      WHEN ROUND(0.60 * la.behaviour_score + 0.40 *
           CASE WHEN la.loan_status IN ('600','700') OR la.outstanding <= 1 THEN 100.0
                WHEN la.outstanding <= 0.01 THEN 0.0
                ELSE MAX(0.0, 100.0 * (1.0 - la.exposure_kes_days / la.outstanding))
           END, 1) >= 70 THEN 'Gold'
      WHEN ROUND(0.60 * la.behaviour_score + 0.40 *
           CASE WHEN la.loan_status IN ('600','700') OR la.outstanding <= 1 THEN 100.0
                WHEN la.outstanding <= 0.01 THEN 0.0
                ELSE MAX(0.0, 100.0 * (1.0 - la.exposure_kes_days / la.outstanding))
           END, 1) >= 50 THEN 'Silver'
      WHEN ROUND(0.60 * la.behaviour_score + 0.40 *
           CASE WHEN la.loan_status IN ('600','700') OR la.outstanding <= 1 THEN 100.0
                WHEN la.outstanding <= 0.01 THEN 0.0
                ELSE MAX(0.0, 100.0 * (1.0 - la.exposure_kes_days / la.outstanding))
           END, 1) >= 40 THEN 'Bronze'
      ELSE 'At Risk'
    END AS band
  FROM loan_agg la
),
ranked AS (
  SELECT
    lf.*,
    ROW_NUMBER() OVER (PARTITION BY lf.client_id ORDER BY lf.window_start DESC, lf.loan_id DESC) AS rn
  FROM loan_final lf
),
client_scores AS (
  SELECT
    client_id, client_name, phone, branch, loan_officer,
    MAX(CASE WHEN rn = 1 THEN loan_id END) AS current_loan_id,
    MAX(CASE WHEN rn = 1 THEN loan_status END) AS current_status,
    MAX(CASE WHEN rn = 1 THEN principal END) AS current_principal_amount,
    MAX(CASE WHEN rn = 1 THEN outstanding END) AS current_outstanding,
    MAX(CASE WHEN rn = 1 THEN score END) AS score,
    MAX(CASE WHEN rn = 1 THEN band END) AS band,
    MAX(CASE WHEN rn = 1 THEN behaviour_score END) AS behaviour,
    MAX(CASE WHEN rn = 1 THEN exposure_score END) AS exposure,
    MAX(CASE WHEN rn = 1 THEN missed_last_30 END) AS missed_last_30,
    MAX(CASE WHEN rn = 1 THEN last_payment_date END) AS last_payment_date,
    MAX(CASE WHEN rn = 1 THEN days_since_last_pay END) AS days_since_last_pay,
    COUNT(*) AS total_loans,
    ROUND(AVG(score), 1) AS avg_score,
    MAX(score) AS best_score,
    MIN(score) AS worst_score,
    SUM(paid_days) AS lifetime_paid_days,
    SUM(missed_days) AS lifetime_missed_days
  FROM ranked
  GROUP BY client_id, client_name, phone, branch, loan_officer
)
SELECT
  client_id,
  client_name,
  phone,
  branch,
  loan_officer,
  current_loan_id,
  current_principal_amount AS principal_amount,
  current_principal_outstanding AS principal_outstanding,
  score,
  band,
  ROUND(behaviour, 1) AS behaviour_score,
  ROUND(exposure, 1) AS exposure_score,
  missed_last_30,
  last_payment_date,
  days_since_last_pay,
  ROUND(current_outstanding, 0) AS outstanding_kes,
  total_loans,
  avg_score,
  best_score,
  worst_score,
  lifetime_paid_days,
  lifetime_missed_days
FROM client_scores
WHERE COALESCE(current_principal_amount, 0) > 0
  AND (((COALESCE(current_principal_amount, 0) - COALESCE(current_principal_outstanding, 0)) * 100.0) / current_principal_amount) >= ${minPrincipalPaid}
ORDER BY score DESC
LIMIT ${limit};
`

    const rows = db.prepare(sql).all(...params)

    const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    const clients = rows.map((r) => ({
      clientId: String(r.client_id || ''),
      clientName: String(r.client_name || ''),
      phone: String(r.phone || ''),
      branch: String(r.branch || ''),
      loanOfficer: String(r.loan_officer || ''),
      currentLoanId: String(r.current_loan_id || ''),
      score: safeNum(r.score),
      band: String(r.band || ''),
      behaviourScore: safeNum(r.behaviour_score),
      exposureScore: safeNum(r.exposure_score),
      missedLast30: safeNum(r.missed_last_30),
      lastPaymentDate: r.last_payment_date || null,
      daysSinceLastPay: r.days_since_last_pay == null ? null : safeNum(r.days_since_last_pay),
      principalAmount: safeNum(r.principal_amount),
      outstandingKes: safeNum(r.outstanding_kes),
      percentPrincipalPaid:
        safeNum(r.principal_amount) > 0
          ? ((safeNum(r.principal_amount) - safeNum(r.principal_outstanding)) / safeNum(r.principal_amount)) * 100
          : 0,
      totalLoans: safeNum(r.total_loans),
      avgScore: safeNum(r.avg_score),
      bestScore: safeNum(r.best_score),
      worstScore: safeNum(r.worst_score),
      lifetimePaidDays: safeNum(r.lifetime_paid_days),
      lifetimeMissedDays: safeNum(r.lifetime_missed_days),
    }))

    const kpis = {
      totalClients: clients.length,
      avgScore: clients.length ? safeNum((clients.reduce((s, c) => s + safeNum(c.score), 0) / clients.length).toFixed(1)) : 0,
      totalOutstanding: clients.reduce((s, c) => s + safeNum(c.outstandingKes), 0),
      atRisk: clients.filter((c) => c.band === 'At Risk').length,
      gold: clients.filter((c) => c.band === 'Gold').length,
      silver: clients.filter((c) => c.band === 'Silver').length,
      bronze: clients.filter((c) => c.band === 'Bronze').length,
      atRiskOutstanding: clients.filter((c) => c.band === 'At Risk').reduce((s, c) => s + safeNum(c.outstandingKes), 0),
      branches: new Set(clients.map((c) => String(c.branch || '').trim()).filter(Boolean)).size,
      officers: new Set(clients.map((c) => String(c.loanOfficer || '').trim()).filter(Boolean)).size,
    }

    // Aggregates
    const byBranch = new Map()
    const byOfficer = new Map()
    for (const c of clients) {
      const b = c.branch || 'Unknown'
      const o = c.loanOfficer || 'Unknown'
      const bump = (m, key) => {
        const e = m.get(key) || { key, clients: 0, avgScoreSum: 0, outstanding: 0, gold: 0, silver: 0, bronze: 0, atRisk: 0, missed30: 0 }
        e.clients += 1
        e.avgScoreSum += safeNum(c.score)
        e.outstanding += safeNum(c.outstandingKes)
        if (c.band === 'Gold') e.gold += 1
        else if (c.band === 'Silver') e.silver += 1
        else if (c.band === 'Bronze') e.bronze += 1
        else e.atRisk += 1
        e.missed30 += safeNum(c.missedLast30)
        m.set(key, e)
      }
      bump(byBranch, b)
      bump(byOfficer, o)
    }
    const branchesAgg = Array.from(byBranch.values())
      .map((e) => ({
        branch: e.key,
        clients: e.clients,
        avgScore: e.clients ? Number((e.avgScoreSum / e.clients).toFixed(1)) : 0,
        outstanding: e.outstanding,
        gold: e.gold,
        silver: e.silver,
        bronze: e.bronze,
        atRisk: e.atRisk,
        missed30: e.missed30,
        atRiskPct: e.clients ? Number(((e.atRisk / e.clients) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.clients - a.clients)

    const officersAgg = Array.from(byOfficer.values())
      .map((e) => ({
        officer: e.key,
        clients: e.clients,
        avgScore: e.clients ? Number((e.avgScoreSum / e.clients).toFixed(1)) : 0,
        outstanding: e.outstanding,
        gold: e.gold,
        silver: e.silver,
        bronze: e.bronze,
        atRisk: e.atRisk,
        atRiskPct: e.clients ? Number(((e.atRisk / e.clients) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.clients - a.clients)

    const watchlist = clients
      .filter((c) => c.band === 'At Risk' && safeNum(c.outstandingKes) > 0)
      .sort((a, b) => safeNum(b.outstandingKes) - safeNum(a.outstandingKes))
      .slice(0, 50)

    return res.json({
      product: product || null,
      limit,
      kpis,
      branchesAgg,
      officersAgg,
      watchlist,
      clients,
      branchNames: Array.from(new Set(clients.map((c) => c.branch).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
      officerNames: Array.from(new Set(clients.map((c) => c.loanOfficer).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
      generatedAt: new Date().toISOString(),
      minPrincipalPaid,
    })
  } catch (e) {
    console.error('[Credit Client Performance API] Error:', e)
    return res.status(500).json({ error: e.message })
  }
})

// Admin/superuser: refresh the precomputed credit score tables
app.post('/api/credit/refresh', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    ensureCreditIndexes()

    const product = String(req.query.product || req.body?.product || '').trim().toLowerCase() || 'boda'
    const zidishaCoreProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']

    if (product === 'boda') {
      const allowed = getAllowedBodaBranches(req)
      const result = refreshCreditScoresForProduct('boda', {
        scopeProducts: ['Zidisha Boda'],
        scopeBranches: allowed.length > 0 ? allowed : [],
      })
      return res.json({ ok: true, ...result })
    }
    if (product === 'zidisha') {
      const allowed = getAllowedZidishaBranches(req)
      const result = refreshCreditScoresForProduct('zidisha', {
        scopeProducts: zidishaCoreProducts,
        scopeBranches: allowed.length > 0 ? allowed : [],
      })
      return res.json({ ok: true, ...result })
    }

    // all
    const result = refreshCreditScoresForProduct('all', {})
    return res.json({ ok: true, ...result })
  } catch (e) {
    console.error('[Credit Refresh API] Error:', e)
    return res.status(500).json({ error: e.message })
  }
})


// Boda schedule (export id 30) - branch summary for Daily Break-down table
// Table: boda_Schedule. Columns: Branch Name, Client Id, Client Name, Due Date, Loan Id, Period, Total Expected, Total Outstanding
app.get('/api/boda/schedule/branch-summary', requireAuth, (req, res) => {
  try {
    const productName = 'Zidisha Boda'
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    const dueDay = req.query.dueDay != null && String(req.query.dueDay).trim() !== '' ? Number(req.query.dueDay) : null
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''

    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }
    if (dueDay != null && (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31)) {
      return res.status(400).json({ error: 'dueDay must be 1-31' })
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    const allowedBoda = getAllowedBodaBranches(req)
    const allowedNorm = allowedBoda.length
      ? new Set(allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
      : null

    if (branch && branch.toLowerCase() !== 'all' && allowedNorm && !allowedNorm.has(branch.toLowerCase())) {
      return res.status(403).json({ error: 'Branch not allowed for this user' })
    }

    const baseRows = db.prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         TRIM("Client Id") AS clientId,
         TRIM("Client Name") AS clientName,
         TRIM("Loan Id") AS loanId,
         TRIM("Due Date") AS dueDate,
         TRIM("Period") AS period,
         COALESCE(CAST(REPLACE("Total Expected", ',', '') AS REAL), 0) AS totalExpected,
         COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0) AS totalOutstanding
       FROM boda_Schedule
       WHERE "Due Date" >= ? AND "Due Date" < ?
         AND COALESCE(TRIM("Product Name"), '') COLLATE NOCASE = ?`
    ).all(monthStart, monthEnd, productName)

    // Distinct due-day options for the month (used by UI dropdown)
    const dueDaysSet = new Set()

    // Filter + aggregate in JS for flexibility with due-day + branch scoping
    const byBranch = new Map()
    for (const r of baseRows) {
      const b = String(r.branch || '').trim() || 'Unknown'
      const bKey = b.toLowerCase()

      if (allowedNorm && !allowedNorm.has(bKey)) continue
      if (branch && branch.toLowerCase() !== 'all' && bKey !== branch.toLowerCase()) continue

      const d = String(r.dueDate || '').trim()
      const dt = d ? new Date(d) : null
      if (!dt || isNaN(dt.getTime())) continue
      const day = dt.getDate()
      dueDaysSet.add(day)
      if (dueDay != null && day !== dueDay) continue

      if (!byBranch.has(b)) {
        byBranch.set(b, { branch: b, totalExpected: 0, totalOutstanding: 0, clients: [] })
      }
      const entry = byBranch.get(b)
      entry.totalExpected += Number(r.totalExpected || 0)
      entry.totalOutstanding += Number(r.totalOutstanding || 0)
      entry.clients.push({
        clientId: r.clientId || '',
        clientName: r.clientName || '',
        loanId: r.loanId || '',
        dueDate: r.dueDate || '',
        period: r.period || '',
        expected: Number(r.totalExpected || 0),
        outstanding: Number(r.totalOutstanding || 0),
      })
    }

    const rows = Array.from(byBranch.values()).map((x) => {
      const expected = x.totalExpected || 0
      const outstanding = x.totalOutstanding || 0
      const ratePercent = expected > 0 ? ((expected - outstanding) / expected) * 100 : 0
      // Client-level rate (optional; matches branch logic)
      const clients = Array.isArray(x.clients)
        ? x.clients.map((c) => ({
            ...c,
            ratePercent: c.expected > 0 ? ((c.expected - c.outstanding) / c.expected) * 100 : 0,
          }))
        : []
      return { ...x, ratePercent, clients }
    }).sort((a, b) => String(a.branch).localeCompare(String(b.branch)))

    const dueDays = Array.from(dueDaysSet).sort((a, b) => a - b)
    res.json({ rows, dueDays })
  } catch (e) {
    console.error('[Boda Schedule Branch Summary API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda schedule month summary - values for top cards
app.get('/api/boda/schedule/summary', requireAuth, (req, res) => {
  try {
    const productName = 'Zidisha Boda'
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''
    const cutoffDayRaw = req.query.cutoffDay != null && String(req.query.cutoffDay).trim() !== '' ? Number(req.query.cutoffDay) : null

    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }
    if (cutoffDayRaw != null && (!Number.isFinite(cutoffDayRaw) || cutoffDayRaw < 1 || cutoffDayRaw > 31)) {
      return res.status(400).json({ error: 'cutoffDay must be 1-31' })
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    const allowedBoda = getAllowedBodaBranches(req)
    const allowedNorm = allowedBoda.length
      ? new Set(allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
      : null

    if (branch && branch.toLowerCase() !== 'all' && allowedNorm && !allowedNorm.has(branch.toLowerCase())) {
      return res.status(403).json({ error: 'Branch not allowed for this user' })
    }

    const rows = db.prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         TRIM("Loan Id") AS loanId,
         TRIM("Due Date") AS dueDate,
         COALESCE(CAST(REPLACE("Total Expected", ',', '') AS REAL), 0) AS totalExpected,
         COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0) AS totalOutstanding
       FROM boda_Schedule
       WHERE "Due Date" >= ? AND "Due Date" < ?
         AND COALESCE(TRIM("Product Name"), '') COLLATE NOCASE = ?`
    ).all(monthStart, monthEnd, productName)

    let totalExpected = 0
    let totalOutstanding = 0
    let mtdExpected = 0
    let mtdOutstanding = 0
    const loans = new Set()
    const mtdLoans = new Set()
    for (const r of rows) {
      const b = String(r.branch || '').trim()
      const bKey = b.toLowerCase()
      if (allowedNorm && !allowedNorm.has(bKey)) continue
      if (branch && branch.toLowerCase() !== 'all' && bKey !== branch.toLowerCase()) continue
      totalExpected += Number(r.totalExpected || 0)
      totalOutstanding += Number(r.totalOutstanding || 0)
      const loanId = String(r.loanId || '').trim()
      if (loanId) loans.add(loanId)

      if (cutoffDayRaw != null) {
        const d = String(r.dueDate || '').trim()
        const dt = d ? new Date(d) : null
        if (dt && !isNaN(dt.getTime()) && dt.getDate() <= cutoffDayRaw) {
          mtdExpected += Number(r.totalExpected || 0)
          mtdOutstanding += Number(r.totalOutstanding || 0)
          if (loanId) mtdLoans.add(loanId)
        }
      }
    }
    const netCollected = Math.max(0, totalExpected - totalOutstanding)
    const ratePercent = totalExpected > 0 ? (netCollected / totalExpected) * 100 : 0
    const mtdNetCollected = Math.max(0, mtdExpected - mtdOutstanding)
    const mtdRatePercent = mtdExpected > 0 ? (mtdNetCollected / mtdExpected) * 100 : 0

    res.json({
      totalExpected,
      totalOutstanding,
      netCollected,
      ratePercent,
      totalLoans: loans.size,
      mtdExpected,
      mtdOutstanding,
      mtdNetCollected,
      mtdRatePercent,
      mtdTotalLoans: mtdLoans.size,
    })
  } catch (e) {
    console.error('[Boda Schedule Summary API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda schedule MTD by branch - for "MTD Collection by Branch" table
app.get('/api/boda/schedule/mtd-by-branch', requireAuth, (req, res) => {
  try {
    const productName = 'Zidisha Boda'
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    const cutoffDayRaw = req.query.cutoffDay != null && String(req.query.cutoffDay).trim() !== '' ? Number(req.query.cutoffDay) : null
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''

    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }
    if (cutoffDayRaw == null || !Number.isFinite(cutoffDayRaw) || cutoffDayRaw < 1 || cutoffDayRaw > 31) {
      return res.status(400).json({ error: 'cutoffDay (1-31) is required' })
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    const allowedBoda = getAllowedBodaBranches(req)
    const allowedNorm = allowedBoda.length
      ? new Set(allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
      : null

    if (branch && branch.toLowerCase() !== 'all' && allowedNorm && !allowedNorm.has(branch.toLowerCase())) {
      return res.status(403).json({ error: 'Branch not allowed for this user' })
    }

    const rows = db.prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         TRIM("Due Date") AS dueDate,
         COALESCE(CAST(REPLACE("Total Expected", ',', '') AS REAL), 0) AS totalExpected,
         COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0) AS totalOutstanding
       FROM boda_Schedule
       WHERE "Due Date" >= ? AND "Due Date" < ?
         AND COALESCE(TRIM("Product Name"), '') COLLATE NOCASE = ?`
    ).all(monthStart, monthEnd, productName)

    const agg = new Map()
    for (const r of rows) {
      const b = String(r.branch || '').trim() || 'Unknown'
      const bKey = b.toLowerCase()
      if (allowedNorm && !allowedNorm.has(bKey)) continue
      if (branch && branch.toLowerCase() !== 'all' && bKey !== branch.toLowerCase()) continue

      const d = String(r.dueDate || '').trim()
      const dt = d ? new Date(d) : null
      if (!dt || isNaN(dt.getTime())) continue
      if (dt.getDate() > cutoffDayRaw) continue

      const expected = Number(r.totalExpected || 0)
      const outstanding = Number(r.totalOutstanding || 0)
      if (!agg.has(b)) agg.set(b, { branch: b, expected: 0, outstanding: 0 })
      const cur = agg.get(b)
      cur.expected += expected
      cur.outstanding += outstanding
    }

    const result = Array.from(agg.values())
      .map((x) => {
        const collected = Math.max(0, x.expected - x.outstanding)
        const ratePercent = x.expected > 0 ? (collected / x.expected) * 100 : 0
        return { ...x, collected, ratePercent }
      })
      .sort((a, b) => b.collected - a.collected)

    res.json({ rows: result })
  } catch (e) {
    console.error('[Boda Schedule MTD By Branch API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda schedule daily expected vs collected (by Due Date day-of-month)
app.get('/api/boda/schedule/daily', requireAuth, (req, res) => {
  try {
    const productName = 'Zidisha Boda'
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''

    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
    const daysIn = new Date(year, month, 0).getDate()

    const allowedBoda = getAllowedBodaBranches(req)
    const allowedNorm = allowedBoda.length
      ? new Set(allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
      : null

    if (branch && branch.toLowerCase() !== 'all' && allowedNorm && !allowedNorm.has(branch.toLowerCase())) {
      return res.status(403).json({ error: 'Branch not allowed for this user' })
    }

    const rows = db.prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         TRIM("Due Date") AS dueDate,
         COALESCE(CAST(REPLACE("Total Expected", ',', '') AS REAL), 0) AS totalExpected,
         COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0) AS totalOutstanding
       FROM boda_Schedule
       WHERE "Due Date" >= ? AND "Due Date" < ?
         AND COALESCE(TRIM("Product Name"), '') COLLATE NOCASE = ?`
    ).all(monthStart, monthEnd, productName)

    const expectedByDay = Array(daysIn + 1).fill(0)
    const collectedByDay = Array(daysIn + 1).fill(0)
    for (const r of rows) {
      const b = String(r.branch || '').trim() || 'Unknown'
      const bKey = b.toLowerCase()
      if (allowedNorm && !allowedNorm.has(bKey)) continue
      if (branch && branch.toLowerCase() !== 'all' && bKey !== branch.toLowerCase()) continue

      const d = String(r.dueDate || '').trim()
      const dt = d ? new Date(d) : null
      if (!dt || isNaN(dt.getTime())) continue
      const day = dt.getDate()
      if (day < 1 || day > daysIn) continue

      const expected = Number(r.totalExpected || 0)
      const outstanding = Number(r.totalOutstanding || 0)
      const collected = Math.max(0, expected - outstanding)
      expectedByDay[day] += expected
      collectedByDay[day] += collected
    }

    const out = []
    for (let day = 1; day <= daysIn; day++) {
      const expected = expectedByDay[day] || 0
      const collected = collectedByDay[day] || 0
      const rate = expected > 0 ? (collected / expected) * 100 : 0
      out.push({ day: String(day), expected, collected, rate })
    }
    res.json({ rows: out })
  } catch (e) {
    console.error('[Boda Schedule Daily API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Boda daily loans endpoint - based on Zidisha_Daily table (Zidisha Boda only)
app.get('/api/boda/daily-loans', requireAuth, (req, res) => {
  try {
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)

    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

    // Read from Zidisha_Daily table (Zidisha Boda only, via ingestion filter)
    const rawRows = db.prepare(`
      SELECT *
      FROM "Zidisha_Daily"
      WHERE "Due Date" >= ? AND "Due Date" < ?
    `).all(monthStart, monthEnd)

    // Dynamically map columns so we don't depend on exact header names
    const normalizeNumber = (val) => {
      if (val == null) return 0
      const n = Number(String(val).replace(/,/g, ''))
      return Number.isFinite(n) ? n : 0
    }

    const normalized = rawRows.map((row) => {
      const keys = Object.keys(row)
      const lowerKeys = keys.map((k) => k.toLowerCase())

      const findKey = (pred) => {
        const idx = lowerKeys.findIndex(pred)
        return idx >= 0 ? keys[idx] : null
      }

      const branchKey = findKey((k) => k.includes('branch'))
      const dueKey = findKey((k) => k.includes('due date') || k.includes('due_date'))
      // Prefer a column that represents the expected amount:
      // - contains "expected"
      // - but is NOT a date field (no "date" / "due")
      // - and NOT a maturity descriptor (no "matur")
      // This will match names like "Total Expected", "Total Expected Repayment", etc.
      const expectedKey = findKey(
        (k) =>
          k.includes('expected') &&
          !k.includes('date') &&
          !k.includes('due') &&
          !k.includes('matur')
      )
      const outstandingKey = findKey(
        (k) => k.includes('total') && k.includes('outstanding')
      )
      const clientNameKey = findKey((k) => k.includes('client') && k.includes('name'))
      const clientIdKey = findKey((k) => k.includes('client') && (k.includes('id') || k === 'client id'))

      return {
        branchName: branchKey ? row[branchKey] : 'Unknown',
        dueDate: dueKey ? row[dueKey] : null,
        totalExpected: expectedKey ? normalizeNumber(row[expectedKey]) : 0,
        totalOutstanding: outstandingKey ? normalizeNumber(row[outstandingKey]) : 0,
        clientName: clientNameKey ? String(row[clientNameKey] || '').trim() : '',
        clientId: clientIdKey ? String(row[clientIdKey] ?? '').trim() : '',
      }
    })

    const requestedBranch = req.query && req.query.branch != null ? String(req.query.branch).trim() : ''
    const allowedBoda = getAllowedBodaBranches(req)
    const allowedNorm =
      allowedBoda.length > 0
        ? new Set(allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
        : null

    let filtered = normalized
    if (allowedNorm) {
      filtered = filtered.filter((r) => {
        const b = String(r.branchName || r['Branch Name'] || r.branch_name || '').trim().toLowerCase()
        return b && allowedNorm.has(b)
      })
    }
    if (requestedBranch && requestedBranch.toLowerCase() !== 'all') {
      const reqNorm = requestedBranch.toLowerCase()
      filtered = filtered.filter((r) => {
        const b = String(r.branchName || r['Branch Name'] || r.branch_name || '').trim().toLowerCase()
        return b === reqNorm
      })
    }

    res.json(filtered)
  } catch (e) {
    console.error('[Boda Daily Loans API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/logbook/disbursements', (req, res) => {
  const effective = getEffectiveLogbookBranches(req)
  let rows
  if (effective.length > 0) {
    const placeholders = effective.map(() => '?').join(', ')
    rows = db.prepare(`SELECT * FROM Logbook_Disbursement WHERE branch IN (${placeholders})`).all(...effective)
  } else if (req.query && req.query.country != null && String(req.query.country).trim()) {
    rows = [] // country filter but no branches in that country
  } else {
    rows = db.prepare('SELECT * FROM Logbook_Disbursement').all()
  }
  res.json(rows)
});

app.get('/api/logbook/collections', (req, res) => {
  const effective = getEffectiveLogbookBranches(req)
  let rows
  if (effective.length > 0) {
    const placeholders = effective.map(() => '?').join(', ')
    rows = db.prepare(`SELECT * FROM Logbook_collection WHERE branch IN (${placeholders})`).all(...effective)
  } else if (req.query && req.query.country != null && String(req.query.country).trim()) {
    rows = [] // country filter but no branches in that country
  } else {
    rows = db.prepare('SELECT * FROM Logbook_collection').all()
  }
  res.json(rows)
});

app.get('/api/logbook/collector-performance', (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }
    
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: 'Invalid month' });
    }
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null && String(req.query.country).trim()
    if (countryParam && effectiveBranches.length === 0) {
      return res.json([])
    }
    const hasBranchRestrictions = effectiveBranches.length > 0
    const allowedSet = hasBranchRestrictions ? new Set(effectiveBranches) : null

    // Get all borrower access IDs that have RO_Targets entries for the selected month/year
    const borrowerMap = new Map();
    const borrowerNameMap = new Map();
    const normalizeName = (v) => String(v || '').trim().toLowerCase()
    
    try {
      // Get all loan officer names from RO_Targets for the selected month/year
      let targetRows = []
      try {
        targetRows = dbRW
          .prepare('SELECT loan_officer_name FROM RO_Targets WHERE month = ? AND year = ?')
          .all(monthNum, yearNum)
      } catch (e) {
        // Fallback to RO_Target (singular) for backward compatibility
        try {
          targetRows = dbRW
            .prepare('SELECT loan_officer_name FROM RO_Target WHERE month = ? AND year = ?')
            .all(monthNum, yearNum)
        } catch (e2) {
          console.error('Error fetching RO targets:', e2.message)
        }
      }
      
      // Get all LOs to match names to borrower_access_ids
      const loRows = dbRW.prepare('SELECT borrower_access_id, name FROM LOs WHERE borrower_access_id IS NOT NULL').all();
      const loNameMap = new Map(); // normalized name -> borrower_access_id
      for (const loRow of loRows) {
        const normalizedName = normalizeName(loRow.name);
        if (normalizedName) {
          loNameMap.set(normalizedName, {
            borrower_access_id: String(loRow.borrower_access_id).trim(),
            name: loRow.name
          });
        }
      }
      
      // Match RO_Targets names to borrower_access_ids
      for (const targetRow of targetRows) {
        const targetName = normalizeName(targetRow.loan_officer_name);
        if (!targetName) continue;
        
        const loMatch = loNameMap.get(targetName);
        if (loMatch) {
          const borrowerId = loMatch.borrower_access_id;
          if (borrowerId && !borrowerMap.has(borrowerId)) {
            borrowerMap.set(borrowerId, {
              borrower_access_id: borrowerId,
              total_repayment_amount: 0,
              transaction_count: 0
            });
            borrowerNameMap.set(borrowerId, loMatch.name);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching borrower access IDs from RO_Targets:', e.message);
    }

    // Query to get collection data for the selected month/year
    // Date format in database is DD/MM/YYYY (split by '/')
    // We'll fetch all rows and filter in JavaScript for more reliable date parsing
    const allRows = db.prepare(`
      SELECT 
        repayment_amount,
        repayment_collected_date,
        borrower_access_ids,
        branch
      FROM Logbook_collection
      WHERE 
        repayment_collected_date IS NOT NULL
        AND repayment_collected_date != ''
        AND borrower_access_ids IS NOT NULL
        AND borrower_access_ids != ''
    `).all();
    
    // Filter and aggregate collection data by unique borrower_access_id for the selected month
    for (const row of allRows) {
      if (hasBranchRestrictions) {
        const branchCode = String(row.branch ?? '').trim()
        if (!branchCode || !allowedSet.has(branchCode)) continue;
      }

      const dateStr = String(row.repayment_collected_date || '').trim();
      if (!dateStr) continue;
      
      // Parse DD/MM/YYYY format
      const parts = dateStr.split('/');
      if (parts.length < 3) continue;
      
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      
      if (isNaN(month) || isNaN(year) || month !== monthNum || year !== yearNum) continue;
      
      const amount = parseFloat(row.repayment_amount) || 0;
      
      // Parse borrower_access_ids
      let borrowerIds = [];
      if (row.borrower_access_ids) {
        try {
          const parsed = JSON.parse(row.borrower_access_ids);
          if (Array.isArray(parsed)) {
            borrowerIds = parsed.map(id => String(id).trim()).filter(id => id);
          } else if (parsed) {
            borrowerIds = [String(parsed).trim()].filter(id => id);
          }
        } catch (e) {
          // If not JSON, try as string
          const strId = String(row.borrower_access_ids).trim();
          if (strId) {
            borrowerIds = [strId];
          }
        }
      }
      
      // Aggregate collection data by each unique borrower_access_id
      for (const borrowerId of borrowerIds) {
        if (!borrowerId) continue;
        
        // Initialize if not already in map (shouldn't happen if LOs table is complete, but safety check)
        if (!borrowerMap.has(borrowerId)) {
          borrowerMap.set(borrowerId, {
            borrower_access_id: borrowerId,
            total_repayment_amount: 0,
            transaction_count: 0
          });
        }
        
        const entry = borrowerMap.get(borrowerId);
        entry.total_repayment_amount += amount;
        entry.transaction_count += 1;
      }
    }
    
    // Convert to array and sort by total repayment amount (descending)
    let rows = Array.from(borrowerMap.values())
      .map(row => ({
      ...row,
      name: borrowerNameMap.get(String(row.borrower_access_id)) || null
      }))
      .sort((a, b) => (b.total_repayment_amount || 0) - (a.total_repayment_amount || 0));

    // Join with RO_Targets to get target by name for the selected month/year
    const targetByLoanOfficerName = new Map()
    try {
      // Primary table name
      const targetRows = dbRW
        .prepare(
          'SELECT loan_officer_name, sum_of_target FROM RO_Targets WHERE month = ? AND year = ?'
        )
        .all(monthNum, yearNum)

      for (const t of targetRows) {
        const key = normalizeName(t.loan_officer_name)
        if (!key) continue
        targetByLoanOfficerName.set(key, Number(t.sum_of_target) || 0)
      }
    } catch (e) {
      // Backward-compat (if someone created RO_Target instead of RO_Targets)
      try {
        const targetRows = dbRW
          .prepare(
            'SELECT loan_officer_name, sum_of_target FROM RO_Target WHERE month = ? AND year = ?'
          )
          .all(monthNum, yearNum)

        for (const t of targetRows) {
          const key = normalizeName(t.loan_officer_name)
          if (!key) continue
          targetByLoanOfficerName.set(key, Number(t.sum_of_target) || 0)
        }
      } catch (e2) {
        console.error('Error fetching RO targets:', e2.message)
      }
    }

    rows = rows.map((row) => {
      const key = normalizeName(row.name)
      return {
        ...row,
        target: key ? (targetByLoanOfficerName.get(key) ?? null) : null,
      }
    })

    // Attach Portfolio (Open Loans) from latest PAR snapshot, grouped by borrower_access_id
    // Portfolio definition matches PAR per Borrower Access ID "Open Loans" calculation:
    // sum of principal balance amounts across open loans for each borrower_access_id.
    try {
      const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
      const latestTime = latestPar?.time
      if (latestTime) {
        const openLoansRows = db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
        const portfolioMap = new Map()
        const accountCountMap = new Map()
        const customerSetMap = new Map()
        const effectiveSet = countryParam && effectiveBranches.length > 0 ? new Set(effectiveBranches) : null

        for (const row of openLoansRows) {
          const branchCode = String(row.branch_code || '').trim()
          if (effectiveSet && (!branchCode || !effectiveSet.has(branchCode))) {
            continue
          }

          let loan
          try {
            loan = JSON.parse(row.loan_data)
          } catch {
            continue
          }

          const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
          if (!borrowerAccessIds.length) continue

          const rawPrincipal =
            loan.principal_balance_amount ??
            loan.PrincipalBalanceAmount ??
            loan['principal_balance_amount'] ??
            loan['Principal Balance Amount'] ??
            loan['Principal Balance'] ??
            0

          const principal =
            typeof rawPrincipal === 'number'
              ? rawPrincipal
              : Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0

          const borrowerNo = String(
            loan.borrower_no ??
            loan.BorrowerNo ??
            loan.borrower_number ??
            loan.BorrowerNumber ??
            loan.borrower_id ??
            loan.BorrowerID ??
            loan['Borrower No'] ??
            loan['Borrower ID'] ??
            loan.client_id ??
            loan.ClientID ??
            ''
          ).trim()

          for (const officerId of borrowerAccessIds) {
            const key = String(officerId || '').trim()
            if (!key) continue
            accountCountMap.set(key, (Number(accountCountMap.get(key)) || 0) + 1)

            if (!customerSetMap.has(key)) {
              customerSetMap.set(key, new Set())
            }
            if (borrowerNo) {
              customerSetMap.get(key).add(borrowerNo)
            }

            if (principal !== 0) {
            portfolioMap.set(key, (Number(portfolioMap.get(key)) || 0) + principal)
            }
          }
        }

        rows = rows.map((r) => {
          const idKey = String(r.borrower_access_id || '').trim()
          return {
          ...r,
            portfolio: portfolioMap.get(idKey) ?? 0,
            accounts: accountCountMap.get(idKey) ?? 0,
            customers: customerSetMap.get(idKey)?.size ?? 0,
          }
        })
      } else {
        rows = rows.map((r) => ({ ...r, portfolio: 0, accounts: 0, customers: 0 }))
      }
    } catch (e) {
      console.error('Error attaching portfolio from Open_loans:', e.message)
      rows = rows.map((r) => ({ ...r, portfolio: 0, accounts: 0, customers: 0 }))
    }

    // Calculate Portfolio Target: highest Open Loans on the last day of any month
    try {
      const portfolioTargetMap = new Map()
      // Get all historical records for each borrower
      const histRows = db.prepare(`
        SELECT officer_id, snapshot_date, open_loans 
        FROM PAR_Borrower_Access_History 
        WHERE officer_id IS NOT NULL
        ORDER BY officer_id, snapshot_date
      `).all()

      // Group by officer_id and find the highest open_loans on the last day of each month
      const monthlyMaxMap = new Map() // officer_id -> Map(monthKey -> max open_loans on last day)
      
      for (const histRow of histRows) {
        const officerId = String(histRow.officer_id || '').trim()
        if (!officerId) continue
        
        const dateStr = String(histRow.snapshot_date || '')
        if (!dateStr || dateStr.length < 10) continue
        
        // Extract YYYY-MM-DD and check if it's the last day of the month
        const date = new Date(dateStr + 'T00:00:00')
        if (isNaN(date.getTime())) continue
        
        const year = date.getFullYear()
        const month = date.getMonth()
        const day = date.getDate()
        
        // Check if this is the last day of the month
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate()
        if (day !== lastDayOfMonth) continue
        
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
        const openLoans = Number(histRow.open_loans) || 0
        
        if (!monthlyMaxMap.has(officerId)) {
          monthlyMaxMap.set(officerId, new Map())
        }
        
        const officerMonthlyMap = monthlyMaxMap.get(officerId)
        const currentMax = officerMonthlyMap.get(monthKey) || 0
        if (openLoans > currentMax) {
          officerMonthlyMap.set(monthKey, openLoans)
        }
      }
      
      // Find the overall maximum across all months for each officer
      for (const [officerId, monthlyMap] of monthlyMaxMap.entries()) {
        let maxOpenLoans = 0
        for (const openLoans of monthlyMap.values()) {
          if (openLoans > maxOpenLoans) {
            maxOpenLoans = openLoans
          }
        }
        if (maxOpenLoans > 0) {
          portfolioTargetMap.set(officerId, maxOpenLoans)
        }
      }
      
    // Attach portfolio target to rows
    rows = rows.map((r) => ({
      ...r,
      portfolioTarget: portfolioTargetMap.get(String(r.borrower_access_id || '').trim()) ?? null,
    }))
    } catch (e) {
      console.error('Error calculating portfolio target:', e.message)
      rows = rows.map((r) => ({ ...r, portfolioTarget: null }))
    }

    // For country-scoped requests, hide "irrelevant" officers:
    // keep only officers that have either collections activity in the month or portfolio exposure in that country.
    if (countryParam) {
      const activeOfficerIds = new Set()
      for (const r of rows) {
        const id = String(r.borrower_access_id || '').trim()
        if (!id) continue
        const repaid = Number(r.total_repayment_amount) || 0
        const tx = Number(r.transaction_count) || 0
        if (repaid > 0 || tx > 0) activeOfficerIds.add(id)
      }

      // Add officers from latest PAR snapshot for the country branches
      try {
        const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
        const latestTime = latestPar?.time
        if (latestTime && effectiveBranches.length > 0) {
          const effectiveSet = new Set(effectiveBranches)
          const openRows = db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
          const missedRows = db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ?').all(latestTime)
          const addFromLoanData = (arr) => {
            for (const row of arr) {
              if (!effectiveSet.has(String(row.branch_code ?? '').trim())) continue
              let loan
              try { loan = JSON.parse(row.loan_data) } catch { continue }
              const ids = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
              for (const officerId of ids) {
                const id = String(officerId || '').trim()
                if (id) activeOfficerIds.add(id)
              }
            }
          }
          addFromLoanData(openRows)
          addFromLoanData(missedRows)
        }
      } catch (e) {
        // ignore
      }

      rows = rows.filter((r) => activeOfficerIds.has(String(r.borrower_access_id || '').trim()))
    }
    
    res.json(rows);
  } catch (e) {
    console.error('Error fetching collector performance:', e);
    res.status(500).json({ error: e.message });
  }
});

// New sales vs repeat sales for Logbook Productivity (by Borrower Access ID, selected month)
// New sales = sum(disbursed) for loans in the month where borrower_no appears for the first time ever in Logbook_Disbursement
// Repeat sales = sum(disbursed) for loans in the month where borrower_no had an earlier disbursement in the table
app.get('/api/logbook/productivity-sales', (req, res) => {
  try {
    const { month, year } = req.query
    const monthNum = parseInt(month, 10)
    const yearNum = parseInt(year, 10)
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ error: 'Month and year are required' })
    }

    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null && String(req.query.country).trim()
    if (countryParam && effectiveBranches.length === 0) {
      return res.json([])
    }
    const hasBranchRestrictions = effectiveBranches.length > 0
    const allowedSet = hasBranchRestrictions ? new Set(effectiveBranches) : null

    // Disbursement date format: DD/MM/YYYY
    const parseDMY = (str) => {
      if (!str) return null
      const s = String(str).trim()
      const parts = s.split('/')
      if (parts.length < 3) return null
      const dd = parseInt(parts[0], 10)
      const mm = parseInt(parts[1], 10)
      const yyyy = parseInt(parts[2], 10)
      if (isNaN(dd) || isNaN(mm) || isNaN(yyyy)) return null
      return new Date(yyyy, mm - 1, dd)
    }

    let disbursementRows = db.prepare(`
      SELECT loan_id, disbursed_date, branch, disbursed, borrower_no, loan_officer, sales_person
      FROM Logbook_Disbursement
      WHERE disbursed_date IS NOT NULL AND TRIM(disbursed_date) <> ''
        AND (borrower_no IS NOT NULL AND TRIM(borrower_no) <> '')
        AND disbursed IS NOT NULL
    `).all()

    if (hasBranchRestrictions) {
      disbursementRows = disbursementRows.filter((r) => {
        const code = String(r.branch || '').trim()
        return code && allowedSet.has(code)
      })
    }

    // Earliest disbursed_date per borrower_no (across entire table)
    const earliestByBorrowerNo = new Map()
    for (const r of disbursementRows) {
      const bn = String(r.borrower_no || '').trim()
      if (!bn) continue
      const d = parseDMY(r.disbursed_date)
      if (!d) continue
      const existing = earliestByBorrowerNo.get(bn)
      if (!existing || d < existing) earliestByBorrowerNo.set(bn, d)
    }

    // Map LO name (normalized) -> borrower_access_id
    const normalizeName = (v) => String(v || '').trim().toLowerCase()
    const loRows = dbRW.prepare('SELECT borrower_access_id, name FROM LOs WHERE borrower_access_id IS NOT NULL').all()
    const nameToAccessId = new Map()
    for (const lo of loRows) {
      const key = normalizeName(lo.name)
      if (key) nameToAccessId.set(key, String(lo.borrower_access_id).trim())
    }

    // For selected month: classify each row as new or repeat and aggregate by borrower_access_id
    const newSalesByOfficer = new Map()
    const repeatSalesByOfficer = new Map()
    for (const r of disbursementRows) {
      const d = parseDMY(r.disbursed_date)
      if (!d || d.getFullYear() !== yearNum || d.getMonth() + 1 !== monthNum) continue

      const borrowerNo = String(r.borrower_no || '').trim()
      if (!borrowerNo) continue

      // Attach sales to borrower_access_id by matching Sales Person name to LO name
      const salesName = String(r.sales_person || '').trim()
      const accessId = salesName ? nameToAccessId.get(normalizeName(salesName)) : null
      if (!accessId) continue

      const amount = Number(r.disbursed) || 0
      if (amount <= 0) continue

      const firstEver = earliestByBorrowerNo.get(borrowerNo)
      // New sale = borrower_no appears for the first time ever in the table, and that first time is in the selected month
      const isNewSale = firstEver &&
        firstEver.getFullYear() === yearNum &&
        (firstEver.getMonth() + 1) === monthNum

      if (isNewSale) {
        newSalesByOfficer.set(accessId, (newSalesByOfficer.get(accessId) || 0) + amount)
      } else {
        repeatSalesByOfficer.set(accessId, (repeatSalesByOfficer.get(accessId) || 0) + amount)
      }
    }

    const result = []
    const allIds = new Set([...newSalesByOfficer.keys(), ...repeatSalesByOfficer.keys()])
    for (const id of allIds) {
      result.push({
        borrower_access_id: id,
        newSales: newSalesByOfficer.get(id) || 0,
        repeatSales: repeatSalesByOfficer.get(id) || 0
      })
    }
    res.json(result)
  } catch (e) {
    console.error('Error fetching productivity sales:', e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/logbook/borrowers', (req, res) => {
  try {
    const effective = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null && String(req.query.country).trim()
    if (countryParam && effective.length === 0) {
      return res.json([])
    }
    let rows = db.prepare('SELECT * FROM Logbook_borrowers').all()
    if (effective.length > 0) {
      const allowedSet = new Set(effective)
      rows = rows.filter((row) => {
        const branchCode = String(row.branch ?? row.branch_code ?? '').trim()
        if (!branchCode) return false
        return allowedSet.has(branchCode)
      })
    }
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/ingest', (req, res) => {
  setEventStreamHeaders(req, res)
  res.flushHeaders && res.flushHeaders()

  // For manual refresh from the Overview page, skip heavy borrowers ingestion.
  const env = {
    ...process.env,
    SKIP_BORROWERS: '1',
  }

  const proc = spawn('npm run ingest:disbursements', [], { cwd: process.cwd(), shell: true, env })
  const send = (data) => {
    res.write(`data: ${data.replace(/\r?\n/g, '\ndata: ')}\n\n`)
  }
  proc.stdout.on('data', (chunk) => {
    send(chunk.toString())
  })
  proc.stderr.on('data', (chunk) => {
    send(chunk.toString())
  })
  proc.on('close', (code) => {
    send(`<completed with code ${code}>`)
    res.end()
    updateDataRefreshTime()
    events.emit('data_updated') // <-- notify all dashboards after ingestion
  })
  proc.on('error', (err) => {
    send(`<error: ${err.message}>`);
    res.end();
  })
  req.on('close', () => {
    proc.kill()
  })
})

// Branches CRUD (Logbook only)
app.get('/api/logbook/branches', (req, res) => {
  try {
    const authRole = String(req.authUser?.role || '').toLowerCase()
    const allowed = getAllowedLogbookBranches(req)
    let rows = dbRW.prepare('SELECT code, name, active, country FROM Logbook_Branches ORDER BY name COLLATE NOCASE').all()

    // Only enforce branch restrictions for custom users (admins/superusers should see all)
    if (authRole === 'custom' && allowed.length > 0) {
      const allowedSet = new Set(allowed.map(code => String(code || '').trim()))
      rows = rows.filter((row) => {
        const code = String(row.code ?? '').trim()
        return code && allowedSet.has(code)
      })
    }

    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const mapUserRow = (user) => {
  const base = {
  id: user.id,
  username: user.username,
  fullName: user.full_name,
  email: user.email,
  phone: user.phone || '',
  role: user.role,
  active: !!user.active,
  emailVerified: !!user.email_verified,
  phoneVerified: !!user.phone_verified,
  mustChangePassword: !!Number(user.must_change_password || 0),
  createdAt: user.created_at,
  updatedAt: user.updated_at
  }
  // For custom and manager role users, include their allowed pages/modules
  const userRole = String(user.role || '').toLowerCase()
  if (userRole === 'custom' || userRole === 'manager') {
    const pages = dbRW
      .prepare('SELECT page_path FROM User_Pages WHERE user_id = ? ORDER BY page_path')
      .all(user.id)
      .map(row => row.page_path)
    base.allowedPages = pages
  }

  // Zidisha branch permissions (all roles)
  try {
    const zidishaBranches = dbRW
      .prepare('SELECT branch_name FROM User_Zidisha_Branches WHERE user_id = ? ORDER BY branch_name COLLATE NOCASE')
      .all(user.id)
      .map(row => row.branch_name)
    base.allowedZidishaBranches = zidishaBranches
  } catch (e) {
    // Fail silently if table not ready
  }

  // Boda branch permissions (all roles)
  try {
    const bodaBranches = dbRW
      .prepare('SELECT branch_name FROM User_Boda_Branches WHERE user_id = ? ORDER BY branch_name COLLATE NOCASE')
      .all(user.id)
      .map(row => row.branch_name)
    base.allowedBodaBranches = bodaBranches
  } catch (e) {
    // Fail silently if table not ready
  }

  // Logbook branch permissions (all roles)
  try {
    const logbookBranches = dbRW
      .prepare('SELECT branch_code FROM User_Logbook_Branches WHERE user_id = ? ORDER BY branch_code')
      .all(user.id)
      .map(row => String(row.branch_code ?? '').trim())
      .filter(code => code)
    base.allowedLogbookBranches = logbookBranches
  } catch (e) {
    // If the table does not exist yet or another error occurs, fail silently
  }

  return base
}

// Helper: normalize allowed Logbook branch codes from the authenticated user
function getAllowedLogbookBranches(req) {
  const raw = Array.isArray(req.authUser?.allowedLogbookBranches)
    ? req.authUser.allowedLogbookBranches
    : []
  const seen = new Set()
  const result = []
  for (const code of raw) {
    const val = String(code || '').trim()
    if (!val || seen.has(val)) continue
    seen.add(val)
    result.push(val)
  }
  return result
}

// Helper: branch codes to use for this request (country filter + user allowed branches)
// When query.country is set, only branches in Logbook_Branches with that country are used.
function getEffectiveLogbookBranches(req) {
  const authRole = String(req.authUser?.role || '').toLowerCase()
  // Only custom users are restricted by allowedLogbookBranches
  const allowed = authRole === 'custom' ? getAllowedLogbookBranches(req) : []
  const country = req.query && req.query.country != null ? String(req.query.country).trim() : ''
  if (country) {
    const byCountry = dbRW.prepare('SELECT code FROM Logbook_Branches WHERE country = ?').all(country)
    let codes = byCountry.map((r) => String(r.code ?? '').trim()).filter(Boolean)
    if (allowed.length > 0) {
      const allowedSet = new Set(allowed)
      codes = codes.filter((c) => allowedSet.has(c))
    }
    return codes
  }
  return allowed
}

// Helper: normalize allowed Zidisha branches from the authenticated user
function getAllowedZidishaBranches(req) {
  const raw = Array.isArray(req.authUser?.allowedZidishaBranches)
    ? req.authUser.allowedZidishaBranches
    : []
  const seen = new Set()
  const result = []
  for (const name of raw) {
    const val = String(name || '').trim()
    if (!val || seen.has(val)) continue
    seen.add(val)
    result.push(val)
  }
  return result
}

// Helper: normalize allowed Boda branches from the authenticated user
function getAllowedBodaBranches(req) {
  const raw = Array.isArray(req.authUser?.allowedBodaBranches)
    ? req.authUser.allowedBodaBranches
    : []
  const seen = new Set()
  const result = []
  for (const name of raw) {
    const val = String(name || '').trim()
    if (!val || seen.has(val)) continue
    seen.add(val)
    result.push(val)
  }
  return result
}

function sanitizeChatFtsQuery(raw) {
  const s = String(raw || '')
    .trim()
    .slice(0, 200)
  const tokens = s.split(/\s+/).filter(Boolean).slice(0, 10)
  if (tokens.length === 0) return '""'
  return tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' AND ')
}

/** Logbook branches visible to the current user (same rules as list endpoints). */
function listLogbookBranchesForChat(req, countryOpt) {
  const authRole = String(req.authUser?.role || '').toLowerCase()
  const allowed = authRole === 'custom' ? getAllowedLogbookBranches(req) : null
  const country = countryOpt != null ? String(countryOpt).trim() : ''
  let rows = dbRW
    .prepare('SELECT code, name, active, country FROM Logbook_Branches ORDER BY name COLLATE NOCASE')
    .all()
  if (country) {
    rows = rows.filter((r) => String(r.country ?? '').trim() === country)
  }
  if (allowed && allowed.length > 0) {
    const allowedSet = new Set(allowed.map((c) => String(c || '').trim()))
    rows = rows.filter((r) => allowedSet.has(String(r.code ?? '').trim()))
  }
  return rows
}

const mapLoanOfficerRow = (row) => ({
  id: row.id,
  borrowerAccessId: row.borrower_access_id,
  name: row.name,
  active: !!row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// Helper function to calculate working days from holidays
const calculateWorkingDays = (month, year, holidays = []) => {
  const daysInMonth = new Date(year, month, 0).getDate()
  let workingDays = 0
  const holidayDates = Array.isArray(holidays) ? holidays.map(h => new Date(h)) : []
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day)
    const dayOfWeek = date.getDay() // 0 = Sunday, 6 = Saturday
    
    // Skip Sundays only (Saturdays are working days)
    if (dayOfWeek === 0) continue
    
    // Skip holidays
    const isHoliday = holidayDates.some(h => 
      h.getFullYear() === year && 
      h.getMonth() === month - 1 && 
      h.getDate() === day
    )
    if (isHoliday) continue
    
    workingDays++
  }
  
  return workingDays
}

const mapTargetRow = (row) => {
  let holidays = []
  try {
    holidays = row.holidays ? JSON.parse(row.holidays) : []
  } catch (e) {
    holidays = []
  }
  
  const month = Number(row.month)
  const year = Number(row.year)
  const workingDays = row.working_days != null ? Number(row.working_days) : calculateWorkingDays(month, year, holidays)
  
  return {
    id: row.id,
    branch: row.branch,
    month,
    year,
    disbursementTarget: Number(row.disbursement_target) || 0,
    collectionTarget: Number(row.collection_target) || 0,
    newClientsAmountPerMonth: Number(row.new_clients_amount_per_month) || 0,
    workingDays,
    holidays,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const normalizeZidishaBranchRow = (row) => {
  const name = String(row?.name || '').trim()
  return name
}

function findUserByUsernameOrEmail(loginId) {
  const trimmed = String(loginId || '').trim()
  if (!trimmed) return null
  const byUsername = dbRW.prepare('SELECT * FROM Users WHERE username = ? LIMIT 1').get(trimmed)
  if (byUsername) return byUsername
  const emailNorm = trimmed.toLowerCase()
  return (
    dbRW
      .prepare(`SELECT * FROM Users WHERE LOWER(TRIM(COALESCE(email, ''))) = ? LIMIT 1`)
      .get(emailNorm) || null
  )
}

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password, superuserOnly } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'Username or email and password are required' })
    }
    const loginId = String(username).trim()
    const user = findUserByUsernameOrEmail(loginId)
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const emailOk = !!Number(user.email_verified || 0)
    const phoneOk = !!Number(user.phone_verified || 0)
    if (!emailOk && !phoneOk) {
      return res.status(403).json({
        error: 'Account not activated. Use the link sent to your email (if provided) or sign in with the SMS you received.',
      })
    }
    if (!user.active) {
      return res.status(403).json({ error: 'User is deactivated' })
    }
    const isSuperuser = String(user.role || '').toLowerCase() === 'superuser'
    
    // If superuserOnly flag is set, only allow superuser login
    if (superuserOnly && !isSuperuser) {
      return res.status(403).json({ error: 'Access denied. Superuser credentials required.' })
    }
    
    const maintenanceOn = isMaintenanceEnabled()
    // During maintenance, only superusers can login (unless it's a superuser-only login attempt)
    if (maintenanceOn && !isSuperuser) {
      return res.status(503).json({ error: 'System under maintenance' })
    }
    const passwordHash = hashPassword(password)
    if (passwordHash !== user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = signAuthToken(user)
    setAuthCookie(res, token)
    res.json({ user: mapUserRow(user), mustChangePassword: !!Number(user.must_change_password || 0) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/confirm-email', async (req, res) => {
  try {
    const { token, password } = req.body || {}
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' })
    }
    validatePasswordOrThrow(password)
    const tokenHash = hashToken(token)
    const row = dbRW
      .prepare(
        `SELECT ev.*, u.id as user_id, u.email as email, u.active as active, u.email_verified as email_verified
         FROM Email_Verifications ev
         JOIN Users u ON u.id = ev.user_id
         WHERE ev.token_hash = ?
         LIMIT 1`
      )
      .get(tokenHash)
    if (!row) return res.status(400).json({ error: 'Invalid or expired token' })
    if (row.used_at) return res.status(400).json({ error: 'Token already used' })
    // Before confirmation, users are created as active=0. Allow confirmation in that state.
    // Only treat active=0 as "deactivated" if the account was already verified.
    if (Number(row.email_verified) === 1 && !row.active) return res.status(403).json({ error: 'User is deactivated' })
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Token expired' })
    }

    // Confirm account and activate it (email path sets password; no forced change after this)
    dbRW
      .prepare(
        `UPDATE Users SET email_verified = 1, active = 1, password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(hashPassword(password), row.user_id)
    dbRW.prepare(`UPDATE Email_Verifications SET used_at = ? WHERE id = ?`).run(nowIso(), row.id)

    res.json({ ok: true })
  } catch (e) {
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: e.message })
    }
    res.status(500).json({ error: e.message })
  }
})

function findUserByUsernameOrPhoneOrEmail(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const byUser = dbRW.prepare('SELECT * FROM Users WHERE username = ? LIMIT 1').get(trimmed)
  if (byUser) return byUser
  const phoneNorm = normalizeKenyanPhone(trimmed)
  if (phoneNorm) {
    const byPhone = dbRW.prepare('SELECT * FROM Users WHERE phone = ? LIMIT 1').get(phoneNorm)
    if (byPhone) return byPhone
  }
  const emailNorm = trimmed.toLowerCase()
  const byEmail = dbRW
    .prepare(`SELECT * FROM Users WHERE LOWER(TRIM(COALESCE(email, ''))) = ? LIMIT 1`)
    .get(emailNorm)
  if (byEmail) return byEmail
  return null
}

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.username ?? '').trim()
    if (!identifier) return res.status(400).json({ error: 'Username or phone number is required' })

    const user = findUserByUsernameOrPhoneOrEmail(identifier)
    if (!user) return res.status(404).json({ error: 'No account found for that username or phone number' })
    if (!user.active) return res.status(403).json({ error: 'User is deactivated' })
    const emailOk = !!Number(user.email_verified || 0)
    const phoneOk = !!Number(user.phone_verified || 0)
    if (!emailOk && !phoneOk) {
      return res.status(403).json({ error: 'Account not activated.' })
    }

    const phoneKenya = normalizeKenyanPhoneStrict(user.phone)
    const emailNorm = normalizeEmail(user.email)
    if (!phoneKenya && !emailNorm) {
      return res.status(400).json({
        error: 'No valid Kenyan phone or email address on file for this user. Contact an administrator.',
      })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = hashToken(code)
    const expiresAt = addMinutesIso(15)
    const insertResult = dbRW
      .prepare(`INSERT INTO Password_Reset_Codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)`)
      .run(user.id, codeHash, expiresAt)

    const smsText = `Phoenix Capital Dashboard password reset code: ${code}. Valid 15 minutes.`
    try {
      let smsSent = false
      let emailSent = false

      // Email always (when present) — helps non-Kenyan users
      if (emailNorm) {
        try {
          const subject = 'Password reset code'
          const text =
            `Your Phoenix Capital Dashboard password reset code is: ${code}\n\n` +
            `Valid for 15 minutes.\n\n` +
            `If you did not request this, you can ignore this email.`
          const html =
            `<p>Your Phoenix Capital Dashboard password reset code is:</p>` +
            `<p style="font-size:18px;font-weight:700;letter-spacing:0.08em">${code}</p>` +
            `<p>Valid for 15 minutes.</p>` +
            `<p>If you did not request this, you can ignore this email.</p>`
          const sendResult = await sendEmail({ to: emailNorm, subject, text, html })
          emailSent = !!sendResult?.ok
        } catch (emailErr) {
          console.error('[auth] forgot-password email failed:', emailErr)
        }
      }

      // SMS only if Kenyan number + Onfon configured
      if (phoneKenya) {
        if (!getOnfonConfigured()) {
          // If there's no email fallback, fail with actionable config message
          if (!emailNorm) return respondForgotPasswordSmsNotConfigured(res)
        } else {
          await sendInviteSms(phoneKenya, smsText)
          smsSent = true
        }
      }

      if (!smsSent && !emailSent) {
        throw new Error('Could not send reset code via SMS or email')
      }

      return res.json({
        ok: true,
        smsSent,
        emailSent,
        ...(smsSent ? { phoneHint: maskPhoneLastTwoVisible(phoneKenya) } : {}),
        ...(emailSent ? { emailHint: maskEmail(emailNorm) } : {}),
      })
    } catch (smsErr) {
      console.error('[auth] forgot-password SMS failed:', smsErr)
      try {
        if (insertResult?.lastInsertRowid) {
          dbRW.prepare(`DELETE FROM Password_Reset_Codes WHERE id = ?`).run(insertResult.lastInsertRowid)
        }
      } catch (rollbackErr) {
        console.error('[auth] forgot-password rollback failed:', rollbackErr)
      }
      if (smsErr.code === 'SMS_NOT_CONFIGURED') {
        return respondForgotPasswordSmsNotConfigured(res)
      }
      return res.status(503).json({
        error: 'Could not send SMS. Try again later or contact support.',
        details: String(smsErr.message || smsErr),
      })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/reset-password', (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.username ?? '').trim()
    const { code, newPassword } = req.body || {}
    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ error: 'Username or phone, code, and newPassword are required' })
    }
    validatePasswordOrThrow(newPassword)
    const user = findUserByUsernameOrPhoneOrEmail(identifier)
    if (!user) return res.status(404).json({ error: 'No account found for that username or phone number' })
    if (!user.active) return res.status(403).json({ error: 'User is deactivated' })
    const emailOk = !!Number(user.email_verified || 0)
    const phoneOk = !!Number(user.phone_verified || 0)
    if (!emailOk && !phoneOk) {
      return res.status(403).json({ error: 'Account not activated.' })
    }

    const latest = dbRW
      .prepare(
        `SELECT * FROM Password_Reset_Codes
         WHERE user_id = ?
           AND used_at IS NULL
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(user.id)
    if (!latest) return res.status(400).json({ error: 'No reset code found. Request a new one.' })
    if (new Date(latest.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Reset code expired. Request a new one.' })
    }
    if (hashToken(code) !== latest.code_hash) {
      return res.status(400).json({ error: 'Invalid reset code' })
    }

    dbRW
      .prepare(`UPDATE Users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(hashPassword(newPassword), user.id)
    dbRW.prepare(`UPDATE Password_Reset_Codes SET used_at = ? WHERE id = ?`).run(nowIso(), latest.id)
    res.json({ ok: true })
  } catch (e) {
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: e.message })
    }
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/first-password-change', requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    validatePasswordOrThrow(newPassword)
    const row = dbRW.prepare('SELECT * FROM Users WHERE id = ? LIMIT 1').get(req.authUser.id)
    if (!row) return res.status(401).json({ error: 'Unauthorized' })
    if (!Number(row.must_change_password || 0)) {
      return res.status(400).json({ error: 'Password change is not required for this account.' })
    }
    if (hashPassword(String(currentPassword ?? '')) !== row.password_hash) {
      return res.status(400).json({ error: 'Current password is incorrect' })
    }
    dbRW
      .prepare(
        `UPDATE Users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(hashPassword(newPassword), row.id)
    const fresh = dbRW.prepare('SELECT * FROM Users WHERE id = ? LIMIT 1').get(row.id)
    res.json({ ok: true, user: mapUserRow(fresh) })
  } catch (e) {
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: e.message })
    }
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', (req, res) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  res.json({ user: req.authUser })
})

app.post('/api/chat', requireAuth, async (req, res) => {
  // Assistant/chat feature removed.
  return res.status(404).json({ error: 'Not found' })
  const provider = String(process.env.CHAT_PROVIDER || '').trim().toLowerCase()
  const groqKey = process.env.GROQ_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const chosen =
    provider === 'groq' || provider === 'gemini'
      ? provider
      : groqKey
        ? 'groq'
        : geminiKey
          ? 'gemini'
          : ''

  if (!chosen) {
    return res.status(503).json({
      error: 'Chat is not configured (set GROQ_API_KEY or GEMINI_API_KEY).'
    })
  }
  const startedAt = Date.now()
  let lastUserText = ''
  const logChat = ({ handler, replyPreview, error }) => {
    try {
      dbRW
        .prepare(
          `INSERT INTO Chat_Logs (user_id, username, role, provider, handler, user_message, reply_preview, latency_ms, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.authUser?.id ?? null,
          req.authUser?.username ?? null,
          req.authUser?.role ?? null,
          chosen,
          handler || null,
          lastUserText.slice(0, 2000),
          String(replyPreview || '').slice(0, 500),
          Date.now() - startedAt,
          error ? String(error).slice(0, 2000) : null
        )
    } catch {
      // ignore logging failures
    }
  }
  try {
    const { messages } = req.body || {}
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' })
    }
    const last = messages[messages.length - 1]
    if (String(last.role) !== 'user' || !String(last.content ?? '').trim()) {
      return res.status(400).json({ error: 'Last message must be user with non-empty content' })
    }
    const userText = String(last.content || '').trim()
    lastUserText = userText
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '')
    }))

    const runTool = async (name, args) => {
      const a = args && typeof args === 'object' ? args : {}
      switch (name) {
        case 'get_user_scope':
          return {
            role: req.authUser.role,
            username: req.authUser.username,
            fullName: req.authUser.fullName,
            allowedPages: req.authUser.allowedPages ?? [],
            allowedLogbookBranches: req.authUser.allowedLogbookBranches ?? [],
            allowedZidishaBranches: req.authUser.allowedZidishaBranches ?? []
          }
        case 'search_knowledge': {
          const q = sanitizeChatFtsQuery(a.query)
          const rows = dbRW
            .prepare(
              `SELECT title, body, topic FROM chat_knowledge_fts WHERE chat_knowledge_fts MATCH ? LIMIT 20`
            )
            .all(q)
          return { results: rows }
        }
        case 'list_logbook_branches': {
          const country = a.country != null ? String(a.country).trim() : ''
          const branches = listLogbookBranchesForChat(req, country || undefined)
          return { branches }
        }
        case 'get_global_par_snapshot': {
          const rows = dbRW
            .prepare(
              'SELECT time, Past_Arrears_missed, Open_loans FROM PAR ORDER BY time DESC LIMIT 30'
            )
            .all()
          return { rows }
        }
        case 'get_oversea_sync_runs': {
          const lim = Math.min(25, Math.max(1, Number(a.limit) || 10))
          const runs = dbRW
            .prepare(
              `SELECT id, job_name, started_at, ended_at, status, vehicles_seen, records_inserted, records_updated, error_message
               FROM oversea_sync_runs ORDER BY id DESC LIMIT ?`
            )
            .all(lim)
          return { runs }
        }
        default:
          return { error: `Unknown tool: ${name}` }
      }
    }

    // Lightweight intent shortcuts for common dashboard queries.
    // This avoids model/tool-call flakiness and ensures scoped, correct answers.
    {
      const t = userText.toLowerCase()
      const recentUserText = Array.isArray(messages)
        ? messages
            .slice(Math.max(0, messages.length - 6))
            .filter((m) => String(m?.role || '').toLowerCase() === 'user')
            .map((m) => String(m?.content ?? '').toLowerCase())
            .join(' ')
        : ''

      const wantsZidishaBranches =
        t.includes('zidisha') && /\bbranch(es)?\b/.test(t) && (/\bhow many\b/.test(t) || /\blist\b/.test(t) || /\bshow\b/.test(t))
      const followupListThemForZidisha =
        (/\blist\b/.test(t) || /\blist them\b/.test(t) || /\bshow them\b/.test(t) || t === 'list them') &&
        recentUserText.includes('zidisha') &&
        /\bbranch(es)?\b/.test(recentUserText)
      if (wantsZidishaBranches || followupListThemForZidisha) {
        // Prefer db-backed, permissioned list (same as /api/zidisha/branches).
        const zidishaProducts = [
          'Zidisha Kifaru',
          'Zidisha Nyati',
          'Zidisha Simba',
          'Zidisha Tembo',
          'Zidisha Express',
        ]
        const placeholders = zidishaProducts.map(() => '?').join(', ')
        const sql = `
          SELECT DISTINCT TRIM("Branch Name") AS branch
          FROM zidisha_data
          WHERE TRIM("Branch Name") IS NOT NULL
            AND TRIM("Branch Name") != ''
            AND LOWER(TRIM("Product Name")) IN (${placeholders})
          ORDER BY branch COLLATE NOCASE
        `
        let branches = db
          .prepare(sql)
          .all(...zidishaProducts.map((p) => p.toLowerCase()))
          .map((r) => r.branch)
          .filter(Boolean)

        const allowedZidisha = getAllowedZidishaBranches(req)
        if (allowedZidisha.length > 0) {
          const allowedNorm = new Set(
            allowedZidisha.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean)
          )
          branches = branches.filter((b) => allowedNorm.has(String(b || '').trim().toLowerCase()))
        }

        if (/\bhow many\b/.test(t)) {
          return res.json({ reply: `You have ${branches.length} Zidisha branches in scope.` })
        }
        if (branches.length === 0) {
          return res.json({ reply: 'No Zidisha branches are available for your account scope.' })
        }
        return res.json({
          reply: `Zidisha branches (${branches.length}):\n` + branches.map((b, i) => `${i + 1}. ${b}`).join('\n')
        })
      }

      const wantsActiveZidishaBranches =
        (t.includes('zidisha') && /\bactive\b/.test(t) && /\bbranch(es)?\b/.test(t)) ||
        ((/\bactive\b/.test(t) && /\bzidisha\b/.test(recentUserText) && /\bbranch(es)?\b/.test(recentUserText)) &&
          (/\bwhich\b/.test(t) || /\blist\b/.test(t) || /\bshow\b/.test(t)))
      const zidishaContext = t.includes('zidisha') || (recentUserText.includes('zidisha') && /\bbranch(es)?\b/.test(recentUserText))
      const wantsZidishaDisbursedThisMonth =
        zidishaContext && /\bdisburs/.test(t) && (/\bthis month\b/.test(t) || /\bthis month\b/.test(recentUserText))
      const wantsZidishaDisbursedByBranch =
        zidishaContext &&
        /\bdisburs/.test(t) &&
        (/\beach\b/.test(t) || /\bper\b/.test(t) || /\bby\b/.test(t)) &&
        /\bbranch(es)?\b/.test(t) ||
        (zidishaContext && /\bdisburs/.test(t) && /\beach\b/.test(t))
      const wantsZidishaCollectionRate =
        zidishaContext && (/\bcollection rate\b/.test(t) || (/\bcollection\b/.test(t) && /\brate\b/.test(t)))

      if (wantsActiveZidishaBranches || wantsZidishaDisbursedThisMonth || wantsZidishaDisbursedByBranch || wantsZidishaCollectionRate) {
        const zidishaProducts = [
          'Zidisha Kifaru',
          'Zidisha Nyati',
          'Zidisha Simba',
          'Zidisha Tembo',
          'Zidisha Express',
        ]
        const allowedZidisha = getAllowedZidishaBranches(req)
        const allowedNorm = allowedZidisha.length
          ? new Set(allowedZidisha.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
          : null

        const recentAnyText = Array.isArray(messages)
          ? messages
              .slice(Math.max(0, messages.length - 10))
              .map((m) => String(m?.content ?? ''))
              .join(' ')
          : ''
        const ym = recentAnyText.match(/\b(20\d{2})-(\d{2})\b/)
        const now = new Date()
        const year = ym ? Number(ym[1]) : now.getFullYear()
        const month = ym ? Number(ym[2]) : now.getMonth() + 1
        const monthStr = String(month).padStart(2, '0')
        const yearStr = String(year)

        const inProductsClause = zidishaProducts.map(() => '?').join(', ')
        const baseParams = zidishaProducts.map((p) => p.toLowerCase())

        const disbursedMonthWhere = `(
          ("Disbursed On Date" LIKE ?) OR
          ("Disbursed On Date" LIKE ?) OR
          (substr("Disbursed On Date", 7, 4) = ? AND substr("Disbursed On Date", 4, 2) = ?)
        )`
        const maturedMonthWhere = `(
          ("Expected Matured On Date" LIKE ?) OR
          ("Expected Matured On Date" LIKE ?) OR
          (substr("Expected Matured On Date", 7, 4) = ? AND substr("Expected Matured On Date", 4, 2) = ?)
        )`
        const disbDateParams = [`${yearStr}-${monthStr}-%`, `%/${monthStr}/${yearStr}%`, yearStr, monthStr]
        const matDateParams = [`${yearStr}-${monthStr}-%`, `%/${monthStr}/${yearStr}%`, yearStr, monthStr]

        if (wantsActiveZidishaBranches) {
          // Define "active" Zidisha branches as those that have disbursement activity in the current month.
          const sql = `
            SELECT DISTINCT TRIM("Branch Name") AS branch
            FROM zidisha_data
            WHERE TRIM("Branch Name") IS NOT NULL
              AND TRIM("Branch Name") != ''
              AND LOWER(TRIM("Product Name")) IN (${inProductsClause})
              AND ${disbursedMonthWhere}
            ORDER BY branch COLLATE NOCASE
          `
          let branches = db.prepare(sql).all(...baseParams, ...disbDateParams).map((r) => r.branch).filter(Boolean)
          if (allowedNorm) {
            branches = branches.filter((b) => allowedNorm.has(String(b || '').trim().toLowerCase()))
          }
          if (!branches.length) {
            return res.json({ reply: `No active Zidisha branches found for ${yearStr}-${monthStr} in your scope.` })
          }
          return res.json({
            reply:
              `Active Zidisha branches (${branches.length}) for ${yearStr}-${monthStr}:\n` +
              branches.map((b, i) => `${i + 1}. ${b}`).join('\n')
          })
        }

        if (wantsZidishaDisbursedThisMonth || wantsZidishaDisbursedByBranch) {
          // If the current context is "active Zidisha branches", restrict the breakdown to those.
          let activeSet = null
          if (/\bactive zidisha branches\b/i.test(recentAnyText)) {
            const activeSql = `
              SELECT DISTINCT TRIM("Branch Name") AS branch
              FROM zidisha_data
              WHERE TRIM("Branch Name") IS NOT NULL
                AND TRIM("Branch Name") != ''
                AND LOWER(TRIM("Product Name")) IN (${inProductsClause})
                AND ${disbursedMonthWhere}
              ORDER BY branch COLLATE NOCASE
            `
            let act = db.prepare(activeSql).all(...baseParams, ...disbDateParams).map((r) => r.branch).filter(Boolean)
            if (allowedNorm) act = act.filter((b) => allowedNorm.has(String(b || '').trim().toLowerCase()))
            activeSet = new Set(act.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
          }

          const sql = `
            SELECT TRIM("Branch Name") AS branch,
                   SUM(CAST("Principal Amount" AS REAL)) AS disbursed
            FROM zidisha_data
            WHERE TRIM("Branch Name") IS NOT NULL
              AND TRIM("Branch Name") != ''
              AND LOWER(TRIM("Product Name")) IN (${inProductsClause})
              AND ${disbursedMonthWhere}
              AND "Principal Amount" IS NOT NULL
            GROUP BY TRIM("Branch Name")
          `
          let rows = db.prepare(sql).all(...baseParams, ...disbDateParams)
          if (allowedNorm) {
            rows = rows.filter((r) => allowedNorm.has(String(r.branch || '').trim().toLowerCase()))
          }
          if (activeSet) {
            rows = rows.filter((r) => activeSet.has(String(r.branch || '').trim().toLowerCase()))
          }
          rows = rows
            .map((r) => ({ branch: String(r.branch || '').trim(), disbursed: Number(r.disbursed || 0) }))
            .filter((r) => r.branch)
            .sort((a, b) => b.disbursed - a.disbursed)
          const total = rows.reduce((s, r) => s + (Number(r.disbursed) || 0), 0)
          if (!rows.length) {
            return res.json({ reply: `No Zidisha disbursements found for ${yearStr}-${monthStr} in your scope.` })
          }
          if (wantsZidishaDisbursedByBranch && !wantsZidishaDisbursedThisMonth) {
            return res.json({
              reply:
                `Zidisha disbursed by branch in ${yearStr}-${monthStr}:\n` +
                rows.map((r, i) => `${i + 1}. ${r.branch}: ${r.disbursed.toLocaleString()}`).join('\n')
            })
          }
          return res.json({
            reply:
              `Zidisha disbursed in ${yearStr}-${monthStr}: ${total.toLocaleString()}\n` +
              rows.map((r, i) => `${i + 1}. ${r.branch}: ${r.disbursed.toLocaleString()}`).join('\n')
          })
        }

        if (wantsZidishaCollectionRate) {
          // Define "collection rate" for the month as totalCollected / totalExpectedRepayment
          // for loans whose Expected Matured On Date falls in the month.
          const sql = `
            SELECT TRIM("Branch Name") AS branch,
                   SUM(CAST("Total Repayment Derived" AS REAL)) AS collected,
                   SUM(CAST("Total Expected Repayment Derived" AS REAL)) AS expected
            FROM zidisha_data
            WHERE TRIM("Branch Name") IS NOT NULL
              AND TRIM("Branch Name") != ''
              AND LOWER(TRIM("Product Name")) IN (${inProductsClause})
              AND ${maturedMonthWhere}
              AND "Total Repayment Derived" IS NOT NULL
              AND "Total Expected Repayment Derived" IS NOT NULL
            GROUP BY TRIM("Branch Name")
          `
          let rows = db.prepare(sql).all(...baseParams, ...matDateParams)
          if (allowedNorm) {
            rows = rows.filter((r) => allowedNorm.has(String(r.branch || '').trim().toLowerCase()))
          }
          const cleaned = rows
            .map((r) => ({
              branch: String(r.branch || '').trim(),
              collected: Number(r.collected || 0),
              expected: Number(r.expected || 0),
            }))
            .filter((r) => r.branch && r.expected > 0)
            .map((r) => ({ ...r, rate: r.collected / r.expected }))
            .sort((a, b) => b.rate - a.rate)
          if (!cleaned.length) {
            return res.json({ reply: `No Zidisha collection-rate inputs found for ${yearStr}-${monthStr} in your scope.` })
          }
          const totalCollected = cleaned.reduce((s, r) => s + r.collected, 0)
          const totalExpected = cleaned.reduce((s, r) => s + r.expected, 0)
          const overallRate = totalExpected > 0 ? totalCollected / totalExpected : 0
          return res.json({
            reply:
              `Zidisha collection rate for ${yearStr}-${monthStr}: ${(overallRate * 100).toFixed(2)}%\n` +
              cleaned
                .map(
                  (r, i) =>
                    `${i + 1}. ${r.branch}: ${(r.rate * 100).toFixed(2)}% (collected ${r.collected.toLocaleString()} / expected ${r.expected.toLocaleString()})`
                )
                .join('\n')
          })
        }
      }

      const wantsBranches =
        /\b(branch|branches)\b/.test(t) &&
        (/\b(list|show|what|which)\b/.test(t) || t === 'branches' || t === 'list the branches')
      if (wantsBranches) {
        const { branches } = await runTool('list_logbook_branches', {})
        const rows = Array.isArray(branches) ? branches : []
        if (rows.length === 0) {
          return res.json({ reply: 'No logbook branches are available for your account scope.' })
        }
        const active = rows.filter((r) => r && r.active)
        const format = (r) => {
          const name = String(r.name ?? r.code ?? '').trim()
          const code = String(r.code ?? '').trim()
          const country = String(r.country ?? '').trim()
          const label = code ? `${name} (${code})` : name
          return country ? `${label} — ${country}` : label
        }
        const list = rows.map(format).filter(Boolean)
        const activeList = active.map(format).filter(Boolean)
        return res.json({
          reply:
            `Logbook branches (${rows.length}):\n` +
            list.map((s, i) => `${i + 1}. ${s}`).join('\n') +
            `\n\nActive (${active.length}):\n` +
            (activeList.length ? activeList.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'None')
        })
      }

      const wantsPortfolio =
        /\bportfolio\b/.test(t) && (/\btotal\b/.test(t) || /\bsize\b/.test(t) || /\bvalue\b/.test(t))
      if (wantsPortfolio) {
        const row = dbRW.prepare('SELECT time, Open_loans FROM PAR ORDER BY time DESC LIMIT 1').get()
        const time = String(row?.time || '').trim()
        const openLoans = Number(row?.Open_loans)
        if (!time || !Number.isFinite(openLoans)) {
          return res.json({ reply: 'Portfolio total is not available yet (no PAR snapshot found).' })
        }
        return res.json({
          reply:
            `Latest portfolio (open loans) total: ${openLoans.toLocaleString()}\n` +
            `Snapshot time: ${time}`
        })
      }

      const recentText = Array.isArray(messages)
        ? messages
            .slice(Math.max(0, messages.length - 6))
            .map((m) => String(m?.content ?? '').toLowerCase())
            .join(' ')
        : ''
      const wantsPortfolioByBranch =
        ((/\bportfolio\b/.test(t) && (/\bper\b/.test(t) || /\beach\b/.test(t) || /\bby\b/.test(t)) && /\bbranch\b/.test(t)) ||
          (/\bbreak\b/.test(t) && /\bdown\b/.test(t) && /\bbranch(es)?\b/.test(t) && (/\beach\b/.test(t) || /\bper\b/.test(t))) ||
          (/\bbreak\b/.test(t) && /\bdown\b/.test(t) && /\bbranch(es)?\b/.test(t) && (/\bportfolio\b/.test(recentText) || /\bopen loans\b/.test(recentText) || /\bopen_loans\b/.test(recentText))))
      if (wantsPortfolioByBranch) {
        const latestPar = dbRW.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
        const latestTime = String(latestPar?.time || '').trim()
        if (!latestTime) {
          return res.json({ reply: 'Portfolio per-branch is not available yet (no PAR snapshot found).' })
        }

        const branches = listLogbookBranchesForChat(req)
        const byCode = new Map()
        for (const b of Array.isArray(branches) ? branches : []) {
          const code = String(b?.code ?? '').trim()
          if (!code) continue
          byCode.set(code, b)
        }

        const rows = dbRW.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
        const sums = new Map()
        for (const r of rows) {
          const code = String(r.branch_code ?? '').trim()
          if (!code || !byCode.has(code)) continue // respect scope
          let loan
          try {
            loan = JSON.parse(r.loan_data)
          } catch {
            continue
          }
          const rawPrincipal =
            loan.principal_balance_amount ??
            loan.PrincipalBalanceAmount ??
            loan['principal_balance_amount'] ??
            loan['Principal Balance Amount'] ??
            loan['Principal Balance'] ??
            0
          const principal = Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0
          if (!principal) continue
          sums.set(code, (sums.get(code) || 0) + principal)
        }

        const items = Array.from(byCode.entries()).map(([code, b]) => ({
          code,
          name: String(b?.name ?? code).trim() || code,
          country: String(b?.country ?? '').trim(),
          active: !!b?.active,
          portfolio: Number(sums.get(code) || 0)
        }))

        items.sort((a, b) => b.portfolio - a.portfolio)

        const lines = items.map((it, idx) => {
          const status = it.active ? 'active' : 'inactive'
          const country = it.country ? ` — ${it.country}` : ''
          return `${idx + 1}. ${it.name} (${it.code})${country}: ${it.portfolio.toLocaleString()} (${status})`
        })

        return res.json({
          reply:
            `Portfolio (open loans) by branch — snapshot ${latestTime}:\n` +
            (lines.length ? lines.join('\n') : 'No branch-level portfolio data found for this snapshot.')
        })
      }

      // Follow-up: user says "amounts?" after discussing Logbook branches.
      // Interpret as portfolio/open-loans by branch for the implied country (if present).
      const wantsLogbookAmountsFollowup =
        (t === 'amounts?' || t === 'amounts' || /\bamounts\b/.test(t)) &&
        (recentText.includes('logbook') || recentText.includes('logbook branches')) &&
        recentText.includes('active')
      if (wantsLogbookAmountsFollowup) {
        const countryMatch = recentText.match(/\b(kenya|uganda)\b/i)
        const country = countryMatch ? String(countryMatch[1] || '').trim() : ''
        const latestPar = dbRW.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
        const latestTime = String(latestPar?.time || '').trim()
        if (!latestTime) {
          return res.json({ reply: 'No portfolio snapshot found yet.' })
        }

        const branches = listLogbookBranchesForChat(req, country || undefined).filter((b) => b && b.active)
        const byCode = new Map()
        for (const b of branches) {
          const code = String(b?.code ?? '').trim()
          if (!code) continue
          byCode.set(code, b)
        }
        const rows = dbRW.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
        const sums = new Map()
        for (const r of rows) {
          const code = String(r.branch_code ?? '').trim()
          if (!code || !byCode.has(code)) continue
          let loan
          try {
            loan = JSON.parse(r.loan_data)
          } catch {
            continue
          }
          const rawPrincipal =
            loan.principal_balance_amount ??
            loan.PrincipalBalanceAmount ??
            loan['principal_balance_amount'] ??
            loan['Principal Balance Amount'] ??
            loan['Principal Balance'] ??
            0
          const principal = Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0
          if (!principal) continue
          sums.set(code, (sums.get(code) || 0) + principal)
        }
        const items = Array.from(byCode.entries())
          .map(([code, b]) => ({
            code,
            name: String(b?.name ?? code).trim() || code,
            country: String(b?.country ?? '').trim(),
            portfolio: Number(sums.get(code) || 0),
          }))
          .sort((a, b) => b.portfolio - a.portfolio)

        return res.json({
          reply:
            `Logbook portfolio (open loans) amounts by active branch${country ? ` in ${country}` : ''} — snapshot ${latestTime}:\n` +
            items.map((it, i) => `${i + 1}. ${it.name} (${it.code})${it.country ? ` — ${it.country}` : ''}: ${it.portfolio.toLocaleString()}`).join('\n')
        })
      }

      // Logbook: disbursements / collections / collection rate (by branch, current or referenced month)
      const logbookContext = t.includes('logbook') || (recentText.includes('logbook') && /\bbranch(es)?\b/.test(recentText))
      const wantsLogbookDisbursed =
        logbookContext && (/\bdisburs/.test(t) || /\bdisbursement(s)?\b/.test(t))
      const wantsLogbookCollected =
        logbookContext && (/\bcollect/.test(t) || /\bcollections?\b/.test(t))
      const wantsLogbookCollectionRate =
        logbookContext && (/\bcollection rate\b/.test(t) || (/\bcollect/.test(t) && /\brate\b/.test(t)))

      if (wantsLogbookDisbursed || wantsLogbookCollected || wantsLogbookCollectionRate) {
        const ym = recentText.match(/\b(20\d{2})-(\d{2})\b/) || t.match(/\b(20\d{2})-(\d{2})\b/)
        const now = new Date()
        const year = ym ? Number(ym[1]) : now.getFullYear()
        const month = ym ? Number(ym[2]) : now.getMonth() + 1
        const monthStr = String(month).padStart(2, '0')
        const yearStr = String(year)

        const countryMatch = (t + ' ' + recentText).match(/\b(kenya|uganda)\b/i)
        const country = countryMatch ? String(countryMatch[1] || '').trim() : ''

        const activeBranches = listLogbookBranchesForChat(req, country || undefined).filter((b) => b && b.active)
        const branchNameByCode = new Map()
        for (const b of activeBranches) {
          const code = String(b?.code ?? '').trim()
          if (!code) continue
          branchNameByCode.set(code, String(b?.name ?? code).trim() || code)
        }
        if (branchNameByCode.size === 0) {
          return res.json({ reply: `No active Logbook branches found${country ? ` in ${country}` : ''} for your scope.` })
        }

        const start = `${yearStr}-${monthStr}-01`
        const nextMonth = month === 12 ? 1 : month + 1
        const nextYear = month === 12 ? year + 1 : year
        const end = `${String(nextYear)}-${String(nextMonth).padStart(2, '0')}-01`

        // Dates in these tables are stored as ISO-like strings in practice; we guard with substring matching too.
        const disbRows = wantsLogbookDisbursed || wantsLogbookCollectionRate
          ? db.prepare(
              `SELECT branch, SUM(CAST(amount AS REAL)) AS total
               FROM Logbook_Disbursement
               WHERE branch IS NOT NULL AND TRIM(branch) <> ''
                 AND branch IN (${Array.from(branchNameByCode.keys()).map(() => '?').join(', ')})
                 AND (
                   (date >= ? AND date < ?) OR
                   (substr(date, 1, 7) = ?)
                 )
               GROUP BY branch`
            ).all(...Array.from(branchNameByCode.keys()), start, end, `${yearStr}-${monthStr}`)
          : []

        const colRows = wantsLogbookCollected || wantsLogbookCollectionRate
          ? db.prepare(
              `SELECT branch, SUM(CAST(amount AS REAL)) AS total
               FROM Logbook_collection
               WHERE branch IS NOT NULL AND TRIM(branch) <> ''
                 AND branch IN (${Array.from(branchNameByCode.keys()).map(() => '?').join(', ')})
                 AND (
                   (date >= ? AND date < ?) OR
                   (substr(date, 1, 7) = ?)
                 )
               GROUP BY branch`
            ).all(...Array.from(branchNameByCode.keys()), start, end, `${yearStr}-${monthStr}`)
          : []

        const disbMap = new Map(disbRows.map((r) => [String(r.branch).trim(), Number(r.total || 0)]))
        const colMap = new Map(colRows.map((r) => [String(r.branch).trim(), Number(r.total || 0)]))

        const items = Array.from(branchNameByCode.keys()).map((code) => {
          const disb = Number(disbMap.get(code) || 0)
          const col = Number(colMap.get(code) || 0)
          const rate = disb > 0 ? col / disb : null
          return { code, name: branchNameByCode.get(code), disb, col, rate }
        })

        if (wantsLogbookDisbursed && !wantsLogbookCollectionRate && !wantsLogbookCollected) {
          const sorted = [...items].sort((a, b) => b.disb - a.disb)
          const total = sorted.reduce((s, r) => s + r.disb, 0)
          return res.json({
            reply:
              `Logbook disbursements in ${yearStr}-${monthStr}${country ? ` (${country})` : ''}: ${total.toLocaleString()}\n` +
              sorted.map((r, i) => `${i + 1}. ${r.name} (${r.code}): ${r.disb.toLocaleString()}`).join('\n')
          })
        }

        if (wantsLogbookCollected && !wantsLogbookCollectionRate) {
          const sorted = [...items].sort((a, b) => b.col - a.col)
          const total = sorted.reduce((s, r) => s + r.col, 0)
          return res.json({
            reply:
              `Logbook collections in ${yearStr}-${monthStr}${country ? ` (${country})` : ''}: ${total.toLocaleString()}\n` +
              sorted.map((r, i) => `${i + 1}. ${r.name} (${r.code}): ${r.col.toLocaleString()}`).join('\n')
          })
        }

        if (wantsLogbookCollectionRate) {
          const withRate = items.filter((r) => r.rate != null)
          const totalDisb = items.reduce((s, r) => s + r.disb, 0)
          const totalCol = items.reduce((s, r) => s + r.col, 0)
          const overall = totalDisb > 0 ? totalCol / totalDisb : 0
          withRate.sort((a, b) => (b.rate || 0) - (a.rate || 0))
          return res.json({
            reply:
              `Logbook collection rate in ${yearStr}-${monthStr}${country ? ` (${country})` : ''}: ${(overall * 100).toFixed(2)}%\n` +
              withRate
                .map(
                  (r, i) =>
                    `${i + 1}. ${r.name} (${r.code}): ${((r.rate || 0) * 100).toFixed(2)}% (collected ${r.col.toLocaleString()} / disbursed ${r.disb.toLocaleString()})`
                )
                .join('\n')
          })
        }
      }
    }

    const reply =
      chosen === 'groq'
        ? await runGroqChat({
            apiKey: groqKey,
            model: process.env.GROQ_MODEL,
            history,
            userMessage: last.content,
            runTool
          })
        : await runGeminiChat({
            apiKey: geminiKey,
            model: process.env.GEMINI_MODEL,
            history,
            userMessage: last.content,
            runTool
          })
    logChat({ handler: 'llm.fallback', replyPreview: reply })
    res.json({ reply })
  } catch (e) {
    console.error('POST /api/chat:', e)
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message || '') : String(e || '')
    const isRateLimit = /\b429\b/.test(msg) || /quota exceeded/i.test(msg) || /too many requests/i.test(msg)
    if (isRateLimit) {
      const m = msg.match(/retryDelay\"?\s*:\s*\"?(\d+)\s*s/i)
      const retryAfterSeconds = m ? Number(m[1]) : undefined
      if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
        res.setHeader('Retry-After', String(retryAfterSeconds))
      }
      return res.status(429).json({
        error: msg || 'Rate limited by Gemini API (quota exceeded).',
        retryAfterSeconds
      })
    }
    logChat({ handler: 'error', error: msg })
    res.status(500).json({ error: msg || 'Chat failed' })
  }
})

// Audit trail (admin / superuser): mutating API calls are logged automatically by auditApiWritesMiddleware
app.get('/api/audit/logs', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500)
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
    const userIdRaw = req.query.userId != null ? parseInt(String(req.query.userId), 10) : NaN
    const userIdFilter = Number.isFinite(userIdRaw) ? userIdRaw : null

    let where = ''
    const params = []
    if (userIdFilter != null) {
      where = ' WHERE user_id = ?'
      params.push(userIdFilter)
    }

    const rows = dbRW
      .prepare(
        `SELECT id, user_id, username, action, method, path, ip, user_agent, status_code, meta_json, created_at
         FROM Audit_Log${where}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)

    const totalRow = dbRW.prepare(`SELECT COUNT(*) as c FROM Audit_Log${where}`).get(...params)

    const items = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      action: r.action,
      method: r.method,
      path: r.path,
      ip: r.ip,
      userAgent: r.user_agent,
      statusCode: r.status_code,
      meta: (() => {
        try {
          return r.meta_json ? JSON.parse(r.meta_json) : null
        } catch {
          return null
        }
      })(),
      createdAt: r.created_at,
    }))

    res.json({
      items,
      limit,
      offset,
      total: Number(totalRow?.c || 0),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/users', (req, res) => {
  try {
    const rows = dbRW
      .prepare(
        'SELECT id, username, full_name, email, phone, role, active, email_verified, phone_verified, must_change_password, created_at, updated_at FROM Users ORDER BY username COLLATE NOCASE',
      )
      .all()
      .map(mapUserRow)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/users', async (req, res) => {
  try {
    const {
      username,
      fullName,
      email,
      phone,
      role = 'logbook',
      allowedPages = [],
      allowedZidishaBranches = [],
      allowedBodaBranches = [],
      allowedLogbookBranches = []
    } = req.body || {}
    if (!username) return res.status(400).json({ error: 'Username is required' })
    const emailNorm = normalizeEmail(email)
    const phoneRaw = String(phone ?? '').trim()
    const phoneKenya = normalizeKenyanPhoneStrict(phoneRaw)
    // Allow non-Kenyan users if they have email (Uganda, etc.)
    if (!phoneKenya && !emailNorm) {
      return res.status(400).json({ error: 'Provide a Kenyan phone number or an email address for onboarding' })
    }
    const roleStr = String(role || 'user').trim().toLowerCase()
    const firstTimeCode = generateFirstTimeCode()
    const loginUrl = `${getAppBaseUrl()}/login`

    // Insert user: active immediately; SMS delivers username + 5-digit code; optional email link for confirmation
    const result = dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, phone, role, active, password_hash, email_verified, phone_verified, must_change_password)
         VALUES (@username, @full_name, @email, @phone, @role, @active, @password_hash, @email_verified, @phone_verified, @must_change_password)`
      )
      .run({
        username: String(username).trim(),
        full_name: fullName ? String(fullName).trim() : '',
        email: emailNorm || '',
        phone: phoneKenya || phoneRaw,
        role: roleStr,
        active: 1,
        password_hash: hashPassword(firstTimeCode),
        email_verified: 0,
        phone_verified: phoneKenya ? 1 : 0,
        must_change_password: 1,
      })
    
    const userId = result.lastInsertRowid
    
    // If custom or manager role, save page/module permissions
    if ((roleStr === 'custom' || roleStr === 'manager') && Array.isArray(allowedPages)) {
      const insertPage = dbRW.prepare('INSERT INTO User_Pages (user_id, page_path) VALUES (?, ?)')
      for (const pagePath of allowedPages) {
        const path = String(pagePath || '').trim()
        if (path) {
          try {
            insertPage.run(userId, path)
          } catch (e) {
            // Ignore duplicates
            if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
          }
        }
      }
    }

    // If custom or manager role, save Zidisha branch permissions (required if any Zidisha page/module is assigned)
    if (roleStr === 'custom' || roleStr === 'manager') {
      const pagesArr = Array.isArray(allowedPages) ? allowedPages : []
      const hasZidishaPages = pagesArr.some((p) => String(p || '').startsWith('/zidisha/'))
      const branchesArr = Array.isArray(allowedZidishaBranches) ? allowedZidishaBranches : []

      if (hasZidishaPages && branchesArr.length === 0) {
        return res.status(400).json({ error: 'At least one Zidisha branch must be selected for Zidisha module access' })
      }

      if (branchesArr.length > 0) {
        const insertBranch = dbRW.prepare('INSERT INTO User_Zidisha_Branches (user_id, branch_name) VALUES (?, ?)')
        for (const b of branchesArr) {
          const branchName = String(b || '').trim()
          if (!branchName) continue
          try {
            insertBranch.run(userId, branchName)
          } catch (e) {
            if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
          }
        }
      }
    }

    // If custom or manager role, save Boda branch permissions (required if any Boda page/module is assigned)
    if (roleStr === 'custom' || roleStr === 'manager') {
      const pagesArr = Array.isArray(allowedPages) ? allowedPages : []
      const hasBodaPages = pagesArr.some((p) => String(p || '').startsWith('/boda/'))
      const branchesArr = Array.isArray(allowedBodaBranches) ? allowedBodaBranches : []

      if (hasBodaPages && branchesArr.length === 0) {
        return res.status(400).json({ error: 'At least one Boda branch must be selected for Boda module access' })
      }

      if (branchesArr.length > 0) {
        const insertBranch = dbRW.prepare('INSERT INTO User_Boda_Branches (user_id, branch_name) VALUES (?, ?)')
        for (const b of branchesArr) {
          const branchName = String(b || '').trim()
          if (!branchName) continue
          try {
            insertBranch.run(userId, branchName)
          } catch (e) {
            if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
          }
        }
      }
    }

    // Save Logbook branch permissions (for branch-level Logbook access)
    if (Array.isArray(allowedLogbookBranches) && allowedLogbookBranches.length > 0) {
      const insertLogbookBranch = dbRW.prepare('INSERT INTO User_Logbook_Branches (user_id, branch_code) VALUES (?, ?)')
      for (const code of allowedLogbookBranches) {
        const branchCode = String(code || '').trim()
        if (!branchCode) continue
        try {
          insertLogbookBranch.run(userId, branchCode)
        } catch (e) {
          if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
        }
      }
    }
    
    let emailSent = false
    let confirmUrl = ''
    if (emailNorm) {
      const token = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(token)
      const expiresAt = addMinutesIso(60 * 24) // 24 hours
      dbRW.prepare(`INSERT INTO Email_Verifications (user_id, token_hash, expires_at) VALUES (?, ?, ?)`).run(userId, tokenHash, expiresAt)
      confirmUrl = `${getAppBaseUrl()}/auth/confirm?token=${encodeURIComponent(token)}`
      const subject = 'Confirm your account'
      const text =
        `Your Phoenix Capital Dashboard account was created.\n\n` +
        `Please confirm your email and set your password using this link:\n${confirmUrl}\n\n` +
        `This link expires in 24 hours.\n\n` +
        `Login: ${loginUrl}\n` +
        `Username: ${String(username).trim()}\n` +
        `First-time code: ${firstTimeCode}\n\n` +
        `Use the first-time code as your password on first sign-in, then set a new password when prompted.`
      const html =
        `<p>Your Phoenix Capital Dashboard account was created.</p>` +
        `<p>Please confirm your email and set your password:</p>` +
        `<p><a href="${confirmUrl}">Confirm account</a></p>` +
        `<p>This link expires in 24 hours.</p>` +
        `<p><b>Login:</b> ${loginUrl}<br/>` +
        `<b>Username:</b> ${String(username).trim()}<br/>` +
        `<b>First-time code:</b> ${firstTimeCode}</p>` +
        `<p>Use the first-time code as your password on first sign-in, then set a new password when prompted.</p>`
      try {
        const sendResult = await sendEmail({ to: emailNorm, subject, text, html })
        emailSent = !!sendResult.ok
      } catch (err) {
        console.error('Failed to send confirmation email:', err)
      }
    }

    const uname = String(username).trim()
    const smsParts = [
      'Phoenix Capital Dashboard',
      `Login ${loginUrl}`,
      `Username ${uname}`,
      `First-time code ${firstTimeCode}`,
      'Use this code as your password on first sign-in then set a new password when prompted.',
    ]
    if (confirmUrl) smsParts.push(`Confirm email ${confirmUrl}`)
    let smsSent = false
    let smsErrorCode = null
    if (!phoneKenya) {
      smsErrorCode = 'sms_not_kenyan'
      console.warn('[users] invite SMS skipped: non-Kenyan or missing phone')
    } else if (!getOnfonConfigured()) {
      smsErrorCode = 'sms_not_configured'
      console.warn('[users] invite SMS skipped: Onfon env vars not set')
    } else {
      try {
        await sendInviteSms(phoneKenya, smsParts.join('. '))
        smsSent = true
      } catch (smsErr) {
        console.error('[users] invite SMS failed:', smsErr)
        smsErrorCode = smsErr.code === 'SMS_NOT_CONFIGURED' ? 'sms_not_configured' : 'sms_send_failed'
      }
    }

    res.json({ ok: true, emailSent, smsSent, ...(smsErrorCode ? { smsErrorCode } : {}) })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const msg = String(e.message || '')
      if (msg.includes('Users.username')) {
        return res.status(409).json({ error: 'Username already exists' })
      }
      if (msg.includes('idx_users_email_unique') || msg.includes('Users.email')) {
        return res.status(409).json({ error: 'Email already exists' })
      }
      if (msg.includes('idx_users_phone_unique') || msg.includes('Users.phone')) {
        return res.status(409).json({ error: 'Phone number already in use' })
      }
      return res.status(409).json({ error: 'Duplicate user' })
    }
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/users/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user id' })

    const existing = dbRW.prepare('SELECT * FROM Users WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ error: 'User not found' })
    }

    const { fullName, email, phone, role, active, password, allowedPages, allowedZidishaBranches, allowedBodaBranches, allowedLogbookBranches } = req.body || {}
    const fields = []
    const params = { id }

    if (typeof fullName !== 'undefined') {
      fields.push('full_name = @full_name')
      params.full_name = String(fullName ?? '').trim()
    }
    if (typeof email !== 'undefined') {
      fields.push('email = @email')
      params.email = normalizeEmail(email)
    }
    if (typeof phone !== 'undefined') {
      fields.push('phone = @phone')
      params.phone = normalizeKenyanPhone(phone) || ''
    }
    if (typeof role !== 'undefined') {
      fields.push('role = @role')
      params.role = String(role ?? 'user').trim()
    }
    if (typeof active !== 'undefined') {
      fields.push('active = @active')
      params.active = active ? 1 : 0
    }
    if (password) {
      fields.push('password_hash = @password_hash')
      fields.push('must_change_password = 0')
      params.password_hash = hashPassword(password)
    }

    if (
      !fields.length &&
      typeof allowedPages === 'undefined' &&
      typeof allowedZidishaBranches === 'undefined' &&
      typeof allowedBodaBranches === 'undefined' &&
      typeof allowedLogbookBranches === 'undefined'
    ) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    if (fields.length > 0) {
    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE Users SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
    }
    
    // Handle page/module permissions for custom and manager roles
    const roleStr = String(role !== undefined ? role : existing.role || 'user').trim().toLowerCase()
    if ((roleStr === 'custom' || roleStr === 'manager') && typeof allowedPages !== 'undefined') {
      // Delete existing pages
      dbRW.prepare('DELETE FROM User_Pages WHERE user_id = ?').run(id)
      // Insert new pages
      if (Array.isArray(allowedPages)) {
        const insertPage = dbRW.prepare('INSERT INTO User_Pages (user_id, page_path) VALUES (?, ?)')
        for (const pagePath of allowedPages) {
          const path = String(pagePath || '').trim()
          if (path) {
            try {
              insertPage.run(id, path)
            } catch (e) {
              if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
            }
          }
        }
      }
    } else if (roleStr !== 'custom' && roleStr !== 'manager') {
      // If role changed from custom/manager to something else, remove page permissions
      dbRW.prepare('DELETE FROM User_Pages WHERE user_id = ?').run(id)
    }

    // Handle Zidisha branch permissions for custom and manager roles
    if ((roleStr === 'custom' || roleStr === 'manager') && typeof allowedZidishaBranches !== 'undefined') {
      // Delete existing branches
      dbRW.prepare('DELETE FROM User_Zidisha_Branches WHERE user_id = ?').run(id)

      const branchesArr = Array.isArray(allowedZidishaBranches) ? allowedZidishaBranches : []
      if (branchesArr.length > 0) {
        const insertBranch = dbRW.prepare('INSERT INTO User_Zidisha_Branches (user_id, branch_name) VALUES (?, ?)')
        for (const b of branchesArr) {
          const branchName = String(b || '').trim()
          if (!branchName) continue
          try {
            insertBranch.run(id, branchName)
          } catch (e) {
            if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
          }
        }
      }

      // Validate: if user has Zidisha pages/modules, they must have at least one Zidisha branch
      const pagesNow = typeof allowedPages !== 'undefined'
        ? (Array.isArray(allowedPages) ? allowedPages : [])
        : dbRW.prepare('SELECT page_path FROM User_Pages WHERE user_id = ?').all(id).map(r => r.page_path)
      const hasZidishaPages = pagesNow.some((p) => String(p || '').startsWith('/zidisha/'))
      if (hasZidishaPages && branchesArr.length === 0) {
        return res.status(400).json({ error: 'At least one Zidisha branch must be selected for Zidisha module access' })
      }
    } else if (roleStr !== 'custom' && roleStr !== 'manager' && roleStr !== 'zidisha') {
      // If role changed away from custom/manager/zidisha, remove Zidisha branch permissions
      dbRW.prepare('DELETE FROM User_Zidisha_Branches WHERE user_id = ?').run(id)
    }

    // Handle Boda branch permissions for custom and manager roles
    if ((roleStr === 'custom' || roleStr === 'manager') && typeof allowedBodaBranches !== 'undefined') {
      // Delete existing branches
      dbRW.prepare('DELETE FROM User_Boda_Branches WHERE user_id = ?').run(id)

      const branchesArr = Array.isArray(allowedBodaBranches) ? allowedBodaBranches : []
      if (branchesArr.length > 0) {
        const insertBranch = dbRW.prepare('INSERT INTO User_Boda_Branches (user_id, branch_name) VALUES (?, ?)')
        for (const b of branchesArr) {
          const branchName = String(b || '').trim()
          if (!branchName) continue
          try {
            insertBranch.run(id, branchName)
          } catch (e) {
            if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
          }
        }
      }

      // Validate: if user has Boda pages/modules, they must have at least one Boda branch
      const pagesNow = typeof allowedPages !== 'undefined'
        ? (Array.isArray(allowedPages) ? allowedPages : [])
        : dbRW.prepare('SELECT page_path FROM User_Pages WHERE user_id = ?').all(id).map(r => r.page_path)
      const hasBodaPages = pagesNow.some((p) => String(p || '').startsWith('/boda/'))
      if (hasBodaPages && branchesArr.length === 0) {
        return res.status(400).json({ error: 'At least one Boda branch must be selected for Boda module access' })
      }
    } else if (roleStr !== 'custom' && roleStr !== 'manager' && roleStr !== 'boda') {
      // If role changed away from custom/manager/boda, remove Boda branch permissions
      dbRW.prepare('DELETE FROM User_Boda_Branches WHERE user_id = ?').run(id)
    }

    // Handle Logbook branch permissions (any role; empty list clears)
    if (typeof allowedLogbookBranches !== 'undefined') {
      // Delete existing Logbook branches for this user
      dbRW.prepare('DELETE FROM User_Logbook_Branches WHERE user_id = ?').run(id)

      const branchesArr = Array.isArray(allowedLogbookBranches) ? allowedLogbookBranches : []
      if (branchesArr.length > 0) {
        const insertBranch = dbRW.prepare('INSERT INTO User_Logbook_Branches (user_id, branch_code) VALUES (?, ?)')
        for (const b of branchesArr) {
          const branchCode = String(b || '').trim()
          if (!branchCode) continue
          try {
            insertBranch.run(id, branchCode)
          } catch (e) {
            if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e
          }
        }
      }
    }
    
    res.json({ ok: true })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const msg = String(e.message || '')
      if (msg.includes('Users.username')) return res.status(409).json({ error: 'Username already exists' })
      if (msg.includes('email') || msg.includes('idx_users_email_unique')) {
        return res.status(409).json({ error: 'Email already exists' })
      }
      if (msg.includes('phone') || msg.includes('idx_users_phone_unique')) {
        return res.status(409).json({ error: 'Phone number already in use' })
      }
      return res.status(409).json({ error: 'Duplicate value' })
    }
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/users/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user id' })
    // User_Pages will be deleted automatically due to CASCADE
    const result = dbRW.prepare('DELETE FROM Users WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Get all available pages for custom role selection
app.get('/api/pages', (req, res) => {
  try {
    const pages = [
      // Logbook pages
      { path: '/logbook/dashboard', label: 'Logbook - Dashboard', category: 'Logbook' },
      { path: '/logbook/disbursement', label: 'Logbook - Disbursement', category: 'Logbook' },
      { path: '/logbook/collection', label: 'Logbook - Collection', category: 'Logbook' },
      { path: '/logbook/par', label: 'Logbook - PAR', category: 'Logbook' },
      { path: '/logbook/productivity', label: 'Logbook - Productivity', category: 'Logbook' },
      { path: '/logbook/demographics', label: 'Logbook - Demographics', category: 'Logbook' },
      // Zidisha pages
      { path: '/zidisha/dashboard', label: 'Zidisha - Dashboard', category: 'Zidisha' },
      { path: '/zidisha/disbursement', label: 'Zidisha - Disbursement', category: 'Zidisha' },
      { path: '/zidisha/collection', label: 'Zidisha - Collection', category: 'Zidisha' },
      { path: '/zidisha/client-performance', label: 'Zidisha - Client Performance', category: 'Zidisha' },
      { path: '/zidisha/productivity', label: 'Zidisha - Productivity', category: 'Zidisha' },
      { path: '/zidisha/demographics', label: 'Zidisha - Demographics', category: 'Zidisha' },
      // Advans pages
      { path: '/advans/dashboard', label: 'Advans - Dashboard', category: 'Advans' },
      { path: '/advans/disbursement', label: 'Advans - Disbursement', category: 'Advans' },
      { path: '/advans/collection', label: 'Advans - Collection', category: 'Advans' },
      { path: '/advans/productivity', label: 'Advans - Productivity', category: 'Advans' },
      // Boda pages
      { path: '/boda/dashboard', label: 'Boda - Dashboard', category: 'Boda' },
      { path: '/boda/disbursement', label: 'Boda - Disbursement', category: 'Boda' },
      { path: '/boda/collection', label: 'Boda - Collection', category: 'Boda' },
      { path: '/boda/client-performance', label: 'Boda - Client Performance', category: 'Boda' },
      { path: '/boda/productivity', label: 'Boda - Productivity', category: 'Boda' },
      // Other pages
      { path: '/kajea/clients', label: 'Kajea - Clients', category: 'Other' },
      { path: '/insurance/dashboard', label: 'Insurance - Dashboard', category: 'Other' },
      // Data pages (admin only, but can be assigned to custom users)
      { path: '/data/overview', label: 'Data - Overview', category: 'Data' },
      { path: '/data/users', label: 'Data - Users', category: 'Data' },
      // Legacy routes
      { path: '/data/branches', label: 'Data - Branches', category: 'Data' },
      { path: '/data/loan-officers', label: 'Data - Loan Officers', category: 'Data' },
      // Logbook Data pages
      { path: '/data/logbook/branches', label: 'Logbook Data - Branches', category: 'Data' },
      { path: '/data/logbook/loan-officers', label: 'Logbook Data - Loan Officers', category: 'Data' },
      { path: '/data/logbook/targets', label: 'Logbook Data - Targets', category: 'Data' },
      // Zidisha Data pages
      { path: '/data/zidisha/targets', label: 'Zidisha Data - Targets', category: 'Data' },
    ]
    res.json(pages)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/loan-officers', (req, res) => {
  try {
    const rows = dbRW
      .prepare('SELECT id, borrower_access_id, name, active, created_at, updated_at FROM LOs ORDER BY name COLLATE NOCASE')
      .all()
      .map(mapLoanOfficerRow)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/loan-officers', (req, res) => {
  try {
    const { borrowerAccessId, name, active = 1 } = req.body || {}
    const idValue = String(borrowerAccessId || '').trim()
    const nameValue = String(name || '').trim()
    if (!idValue || !nameValue) {
      return res.status(400).json({ error: 'borrowerAccessId and name are required' })
    }
    dbRW.prepare(`
      INSERT INTO LOs (borrower_access_id, name, active)
      VALUES (@borrower_access_id, @name, @active)
    `).run({ borrower_access_id: idValue, name: nameValue, active: active ? 1 : 0 })
    res.json({ ok: true })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Borrower Access ID already exists' })
    }
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/loan-officers/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = dbRW.prepare('SELECT * FROM LOs WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ error: 'Loan Officer not found' })
    }

    const { borrowerAccessId, name, active } = req.body || {}
    const fields = []
    const params = { id }

    if (typeof borrowerAccessId !== 'undefined') {
      const val = String(borrowerAccessId || '').trim()
      if (!val) {
        return res.status(400).json({ error: 'borrowerAccessId cannot be empty' })
      }
      fields.push('borrower_access_id = @borrower_access_id')
      params.borrower_access_id = val
    }
    if (typeof name !== 'undefined') {
      const val = String(name || '').trim()
      if (!val) {
        return res.status(400).json({ error: 'name cannot be empty' })
      }
      fields.push('name = @name')
      params.name = val
    }
    if (typeof active !== 'undefined') {
      fields.push('active = @active')
      params.active = active ? 1 : 0
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE LOs SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
    res.json({ ok: true })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Borrower Access ID already exists' })
    }
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/loan-officers/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const result = dbRW.prepare('DELETE FROM LOs WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Loan Officer not found' })
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Zidisha branches (distinct from zidisha_data)
app.get('/api/zidisha/branches', (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT DISTINCT
          TRIM("Branch Name") AS name
        FROM zidisha_data
        WHERE "Branch Name" IS NOT NULL
          AND TRIM("Branch Name") <> ''
          AND LOWER(TRIM("Branch Name")) <> 'advans branch'
        ORDER BY name COLLATE NOCASE
      `)
      .all()
      .map(normalizeZidishaBranchRow)
      .filter(Boolean)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Logbook Targets
app.get('/api/targets/logbook', (req, res) => {
  try {
    const country = req.query && req.query.country != null ? String(req.query.country).trim() : ''
    let rows = dbRW
      .prepare('SELECT * FROM Logbook_Targets ORDER BY year DESC, month DESC, branch COLLATE NOCASE')
      .all()
      .map(mapTargetRow)

    // Optional country filter: only return targets for branches in Logbook_Branches for that country
    if (country) {
      const normalize = (v) =>
        String(v || '')
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\s*branch\s*$/i, '')
          .toLowerCase()

      const branchRows = dbRW
        .prepare('SELECT name FROM Logbook_Branches WHERE country = ?')
        .all(country)
      const branchNameSet = new Set(branchRows.map((r) => normalize(r.name)).filter(Boolean))

      rows = rows.filter((t) => branchNameSet.has(normalize(t.branch)))
    }

    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/targets/logbook', (req, res) => {
  try {
    const { branch, month, year, disbursementTarget = 0, collectionTarget = 0, holidays = [], active = 1 } = req.body || {}
    const branchVal = String(branch || '').trim()
    const monthVal = Number(month)
    const yearVal = Number(year)
    if (!branchVal || !Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'branch, month (1-12), and year are required' })
    }
    
    const holidaysArray = Array.isArray(holidays) ? holidays : []
    const holidaysJson = JSON.stringify(holidaysArray)
    const workingDays = calculateWorkingDays(monthVal, yearVal, holidaysArray)
    
    dbRW.prepare(`
      INSERT INTO Logbook_Targets (branch, month, year, disbursement_target, collection_target, working_days, holidays, active)
      VALUES (@branch, @month, @year, @disbursement_target, @collection_target, @working_days, @holidays, @active)
    `).run({
      branch: branchVal,
      month: monthVal,
      year: yearVal,
      disbursement_target: Number(disbursementTarget) || 0,
      collection_target: Number(collectionTarget) || 0,
      working_days: workingDays,
      holidays: holidaysJson,
      active: active ? 1 : 0,
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/targets/logbook/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = dbRW.prepare('SELECT * FROM Logbook_Targets WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Target not found' })

    const { branch, month, year, disbursementTarget, collectionTarget, holidays, active } = req.body || {}
    const fields = []
    const params = { id }
    
    // Get current month/year for working days calculation
    const currentMonth = typeof month !== 'undefined' ? Number(month) : Number(existing.month)
    const currentYear = typeof year !== 'undefined' ? Number(year) : Number(existing.year)

    if (typeof branch !== 'undefined') {
      const val = String(branch || '').trim()
      if (!val) return res.status(400).json({ error: 'branch cannot be empty' })
      fields.push('branch = @branch')
      params.branch = val
    }
    if (typeof month !== 'undefined') {
      const val = Number(month)
      if (!Number.isInteger(val) || val < 1 || val > 12) return res.status(400).json({ error: 'month must be 1-12' })
      fields.push('month = @month')
      params.month = val
    }
    if (typeof year !== 'undefined') {
      const val = Number(year)
      if (!Number.isInteger(val)) return res.status(400).json({ error: 'year must be an integer' })
      fields.push('year = @year')
      params.year = val
    }
    if (typeof disbursementTarget !== 'undefined') {
      fields.push('disbursement_target = @disbursement_target')
      params.disbursement_target = Number(disbursementTarget) || 0
    }
    if (typeof collectionTarget !== 'undefined') {
      fields.push('collection_target = @collection_target')
      params.collection_target = Number(collectionTarget) || 0
    }
    if (typeof holidays !== 'undefined') {
      const holidaysArray = Array.isArray(holidays) ? holidays : []
      const holidaysJson = JSON.stringify(holidaysArray)
      fields.push('holidays = @holidays')
      params.holidays = holidaysJson
      // Recalculate working days when holidays change
      const workingDays = calculateWorkingDays(currentMonth, currentYear, holidaysArray)
      fields.push('working_days = @working_days')
      params.working_days = workingDays
    }
    if (typeof active !== 'undefined') {
      fields.push('active = @active')
      params.active = active ? 1 : 0
    }

    if (!fields.length) return res.status(400).json({ error: 'No updates provided' })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE Logbook_Targets SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/targets/logbook/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const result = dbRW.prepare('DELETE FROM Logbook_Targets WHERE id = ?').run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'Target not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Zidisha branches for targets (all branches: from Zidisha_Targets + zidisha_data, no user filter)
app.get('/api/zidisha/branches/all', (req, res) => {
  try {
    const fromTargets = dbRW.prepare("SELECT DISTINCT TRIM(branch) AS name FROM Zidisha_Targets WHERE branch IS NOT NULL AND TRIM(branch) <> ''").all()
    const fromData = db.prepare(`
      SELECT DISTINCT TRIM("Branch Name") AS name
      FROM zidisha_data
      WHERE "Branch Name" IS NOT NULL AND TRIM("Branch Name") <> '' AND LOWER(TRIM("Branch Name")) <> 'advans branch'
    `).all()
    const seen = new Set()
    const names = []
    for (const row of [...fromTargets, ...fromData]) {
      const name = String(row?.name || '').trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      names.push(name)
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    res.json(names)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Zidisha Targets
app.get('/api/targets/zidisha', (req, res) => {
  try {
    const rows = dbRW
      .prepare('SELECT * FROM Zidisha_Targets ORDER BY year DESC, month DESC, branch COLLATE NOCASE')
      .all()
      .map(mapTargetRow)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/targets/zidisha', (req, res) => {
  try {
    const { branch, month, year, disbursementTarget = 0, collectionTarget = 0, newClientsAmountPerMonth = 0, active = 1 } = req.body || {}
    const branchVal = String(branch || '').trim()
    const monthVal = Number(month)
    const yearVal = Number(year)
    if (!branchVal || !Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'branch, month (1-12), and year are required' })
    }
    dbRW.prepare(`
      INSERT INTO Zidisha_Targets (branch, month, year, disbursement_target, collection_target, new_clients_amount_per_month, active)
      VALUES (@branch, @month, @year, @disbursement_target, @collection_target, @new_clients_amount_per_month, @active)
    `).run({
      branch: branchVal,
      month: monthVal,
      year: yearVal,
      disbursement_target: Number(disbursementTarget) || 0,
      collection_target: Number(collectionTarget) || 0,
      new_clients_amount_per_month: Number(newClientsAmountPerMonth) || 0,
      active: active ? 1 : 0,
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/targets/zidisha/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = dbRW.prepare('SELECT * FROM Zidisha_Targets WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Target not found' })

    const { branch, month, year, disbursementTarget, collectionTarget, newClientsAmountPerMonth, active } = req.body || {}
    const fields = []
    const params = { id }

    if (typeof branch !== 'undefined') {
      const val = String(branch || '').trim()
      if (!val) return res.status(400).json({ error: 'branch cannot be empty' })
      fields.push('branch = @branch')
      params.branch = val
    }
    if (typeof month !== 'undefined') {
      const val = Number(month)
      if (!Number.isInteger(val) || val < 1 || val > 12) return res.status(400).json({ error: 'month must be 1-12' })
      fields.push('month = @month')
      params.month = val
    }
    if (typeof year !== 'undefined') {
      const val = Number(year)
      if (!Number.isInteger(val)) return res.status(400).json({ error: 'year must be an integer' })
      fields.push('year = @year')
      params.year = val
    }
    if (typeof disbursementTarget !== 'undefined') {
      fields.push('disbursement_target = @disbursement_target')
      params.disbursement_target = Number(disbursementTarget) || 0
    }
    if (typeof collectionTarget !== 'undefined') {
      fields.push('collection_target = @collection_target')
      params.collection_target = Number(collectionTarget) || 0
    }
    if (typeof newClientsAmountPerMonth !== 'undefined') {
      fields.push('new_clients_amount_per_month = @new_clients_amount_per_month')
      params.new_clients_amount_per_month = Number(newClientsAmountPerMonth) || 0
    }
    if (typeof active !== 'undefined') {
      fields.push('active = @active')
      params.active = active ? 1 : 0
    }

    if (!fields.length) return res.status(400).json({ error: 'No updates provided' })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE Zidisha_Targets SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/targets/zidisha/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const result = dbRW.prepare('DELETE FROM Zidisha_Targets WHERE id = ?').run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'Target not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// RO Targets endpoints
const mapROTargetRow = (row) => ({
  id: row.id,
  loanOfficerName: row.loan_officer_name,
  month: row.month,
  year: row.year,
  sumOfTarget: row.sum_of_target || 0,
  sumOfPrincipalBalance: row.sum_of_principal_balance || 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

app.get('/api/targets/ro', (req, res) => {
  try {
    // Check if table exists and has correct structure
    let tableExists = false
    let needsRecreate = false
    
    try {
      const tableInfo = dbRW.prepare("PRAGMA table_info(RO_Targets)").all()
      if (tableInfo.length > 0) {
        tableExists = true
        const columnNames = tableInfo.map(col => col.name.toLowerCase())
        const requiredColumns = ['loan_officer_name', 'month', 'year', 'sum_of_target', 'sum_of_principal_balance']
        const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))
        
        if (missingColumns.length > 0) {
          console.log('RO_Targets table missing columns:', missingColumns)
          // Table exists but has wrong structure - drop and recreate
          needsRecreate = true
        }
      }
    } catch (checkErr) {
      // Table doesn't exist
      tableExists = false
    }
    
    // Drop and recreate if needed
    if (needsRecreate || !tableExists) {
      if (needsRecreate) {
        console.log('Dropping RO_Targets table to recreate with correct structure...')
        dbRW.exec('DROP TABLE IF EXISTS RO_Targets')
      }
      
      // Create table with correct structure
      dbRW.exec(`
        CREATE TABLE RO_Targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          loan_officer_name TEXT NOT NULL,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          sum_of_target REAL NOT NULL DEFAULT 0,
          sum_of_principal_balance REAL NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(loan_officer_name, month, year)
        );
      `)
      console.log('RO_Targets table created successfully')
    }
    
    const rows = dbRW
      .prepare('SELECT * FROM RO_Targets ORDER BY year DESC, month DESC, loan_officer_name COLLATE NOCASE')
      .all()
      .map(mapROTargetRow)
    res.json(rows)
  } catch (e) {
    console.error('Error fetching RO targets:', e)
    console.error('Stack:', e.stack)
    res.status(500).json({ error: e.message || 'Failed to fetch RO targets' })
  }
})

app.post('/api/targets/ro', (req, res) => {
  try {
    const { loanOfficerName, month, year, sumOfTarget = 0, sumOfPrincipalBalance = 0 } = req.body || {}
    const loanOfficerNameVal = String(loanOfficerName || '').trim()
    const monthVal = Number(month)
    const yearVal = Number(year)
    if (!loanOfficerNameVal || !Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'loanOfficerName, month (1-12), and year are required' })
    }
    
    dbRW.prepare(`
      INSERT INTO RO_Targets (loan_officer_name, month, year, sum_of_target, sum_of_principal_balance)
      VALUES (@loan_officer_name, @month, @year, @sum_of_target, @sum_of_principal_balance)
      ON CONFLICT(loan_officer_name, month, year) DO UPDATE SET
        sum_of_target = excluded.sum_of_target,
        sum_of_principal_balance = excluded.sum_of_principal_balance,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      loan_officer_name: loanOfficerNameVal,
      month: monthVal,
      year: yearVal,
      sum_of_target: Number(sumOfTarget) || 0,
      sum_of_principal_balance: Number(sumOfPrincipalBalance) || 0,
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/targets/ro/bulk', (req, res) => {
  try {
    const { month, year, targets } = req.body || {}
    const monthVal = Number(month)
    const yearVal = Number(year)
    if (!Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets array is required' })
    }

    const stmt = dbRW.prepare(`
      INSERT INTO RO_Targets (loan_officer_name, month, year, sum_of_target, sum_of_principal_balance)
      VALUES (@loan_officer_name, @month, @year, @sum_of_target, @sum_of_principal_balance)
      ON CONFLICT(loan_officer_name, month, year) DO UPDATE SET
        sum_of_target = excluded.sum_of_target,
        sum_of_principal_balance = excluded.sum_of_principal_balance,
        updated_at = CURRENT_TIMESTAMP
    `)

    const tx = dbRW.transaction((items) => {
      for (const item of items) {
        const loanOfficerName = String(item.loanOfficerName || item['Loan Officers'] || '').trim()
        if (!loanOfficerName) continue
        stmt.run({
          loan_officer_name: loanOfficerName,
          month: monthVal,
          year: yearVal,
          sum_of_target: Number(item.sumOfTarget || item['Sum of Target'] || 0) || 0,
          sum_of_principal_balance: Number(item.sumOfPrincipalBalance || item['Sum of Principal Balance'] || 0) || 0,
        })
      }
    })

    tx(targets)
    res.json({ ok: true, count: targets.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/targets/ro/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = dbRW.prepare('SELECT * FROM RO_Targets WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Target not found' })

    const { loanOfficerName, month, year, sumOfTarget, sumOfPrincipalBalance } = req.body || {}
    const fields = []
    const params = { id }

    if (loanOfficerName !== undefined) {
      const val = String(loanOfficerName || '').trim()
      if (!val) return res.status(400).json({ error: 'loanOfficerName cannot be empty' })
      fields.push('loan_officer_name = @loan_officer_name')
      params.loan_officer_name = val
    }
    if (month !== undefined) {
      const val = Number(month)
      if (!Number.isInteger(val) || val < 1 || val > 12) return res.status(400).json({ error: 'month must be 1-12' })
      fields.push('month = @month')
      params.month = val
    }
    if (year !== undefined) {
      const val = Number(year)
      if (!Number.isInteger(val)) return res.status(400).json({ error: 'year must be a number' })
      fields.push('year = @year')
      params.year = val
    }
    if (sumOfTarget !== undefined) {
      fields.push('sum_of_target = @sum_of_target')
      params.sum_of_target = Number(sumOfTarget) || 0
    }
    if (sumOfPrincipalBalance !== undefined) {
      fields.push('sum_of_principal_balance = @sum_of_principal_balance')
      params.sum_of_principal_balance = Number(sumOfPrincipalBalance) || 0
    }

    if (!fields.length) return res.status(400).json({ error: 'No updates provided' })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE RO_Targets SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/targets/ro/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const result = dbRW.prepare('DELETE FROM RO_Targets WHERE id = ?').run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'Target not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/logbook/branches', (req, res) => {
  try {
    const { code, name, active = 1, country } = req.body || {}
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' })
    const countryVal = (country != null && String(country).trim()) ? String(country).trim() : 'Kenya'
    dbRW.prepare(`
      INSERT INTO Logbook_Branches (code, name, active, country)
      VALUES (@code, @name, @active, @country)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, active=excluded.active, country=excluded.country
    `).run({
      code: String(code).trim(),
      name: String(name).trim(),
      active: active ? 1 : 0,
      country: countryVal
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/logbook/branches/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim()
    if (!code) return res.status(400).json({ error: 'code is required' })
    
    const stmt = dbRW.prepare('DELETE FROM Logbook_Branches WHERE code = ?')
    const result = stmt.run(code)
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Branch not found' })
    }
    
    res.json({ ok: true, deleted: code, changes: result.changes })
  } catch (e) {
    console.error('Delete branch error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Fetch PAR data from Loandisk API, sum Principal Balance, persist to PAR
app.post('/api/par/fetch', async (req, res) => {
  try {
    const url = 'https://api-main.loandisk.com/7125/12936/advanced_search_repayments'
    const authHeader = 'Basic DgPRFGb7VPYrnz7K68b4KqHNkYZkvswVqFGaU7xD'
    const perPage = 200
    let from = 1
    let grandTotal = 0
    let fetched = 0
    let totalResults = 0
    const debug = String((req.query?.debug ?? '')).toLowerCase() === '1'
    const requestedStatuses = (req.query?.loan_status_id || '').toString().trim()
    const loanStatusParam = requestedStatuses.length ? requestedStatuses : '5||16||6'
    const itemBreakdown = []
    for (;;) {
      const form = new URLSearchParams()
      form.set('from', String(from))
      form.set('count', String(perPage))
      form.set('loan_status_id', loanStatusParam)
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PhoenixDashboard/1.0'
        },
        body: form.toString()
      })
      const json = await resp.json()
      if (json && json.error) {
        // If content-type was wrong or other issue, surface payload
        return res.status(400).json({ error: json.error, raw: json })
      }
      const response = json?.response || {}
      const results = Array.isArray(response.Results) ? response.Results : []
      if (typeof response.TotalResults === 'number') totalResults = response.TotalResults
      for (const item of results) {
        const rawCandidate = (
          item['Principal Balance'] ??
          item['PrincipalBalance'] ??
          item['Principal Balance (KES)'] ??
          item['PrincipalBalance(KES)'] ??
          item['Outstanding Principal'] ??
          item['Principal Outstanding'] ??
          item['Outstanding'] ??
          item['Balance'] ?? 0
        )
        const rawStr = String(rawCandidate)
        const normalized = rawStr.replace(/[^0-9.\-]/g, '').replace(/(\..*)\./g, '$1')
        const n = Number(normalized) || 0
        grandTotal += n
        if (debug && itemBreakdown.length < 10) {
          itemBreakdown.push({
            Loan: item['Loan#'] || item['Loan Id'] || undefined,
            Status: item['Status'] || undefined,
            Branch: item['Branch'] || undefined,
            PrincipalBalanceRaw: rawStr,
            Parsed: n
          })
        }
      }
      fetched += results.length
      if (results.length < perPage) break
      from += perPage
      // Safety cap
      if (from > 20000) break
    }
    const ts = getNairobiTime()
    if (!debug) {
      dbRW.prepare('INSERT INTO PAR (time, Past_Arrears_missed) VALUES (?, ?)').run(ts, grandTotal)
      return res.json({ time: ts, Past_Arrears_missed: grandTotal, fetched, totalResults })
    }
    return res.json({ time: ts, Past_Arrears_missed: grandTotal, fetched, totalResults, loan_status_id: loanStatusParam, sample: itemBreakdown })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Read PAR history
app.get('/api/par', (req, res) => {
  try {
    const countryParam = req.query && req.query.country != null ? String(req.query.country).trim() : ''

    // Default behavior (no country filter): return stored global totals.
    if (!countryParam) {
    const rows = dbRW.prepare('SELECT time, Past_Arrears_missed, Open_loans FROM PAR ORDER BY time DESC').all()
      return res.json(rows)
    }

    const effectiveBranches = getEffectiveLogbookBranches(req)
    if (!effectiveBranches || effectiveBranches.length === 0) {
      return res.json([])
    }

    const latestPar = dbRW.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    const latestTime = latestPar?.time || ''
    const sortedBranches = [...effectiveBranches].map((b) => String(b || '').trim()).filter(Boolean).sort()
    const cacheKey = `${latestTime}|${countryParam}|${sortedBranches.join(',')}`
    if (parHistoryCountryCache.has(cacheKey)) {
      return res.json(parHistoryCountryCache.get(cacheKey))
    }

    // Fast path: compute country history from pre-aggregated per-officer history table.
    // This avoids scanning/parsing all loan-level records for every request.
    const rows = dbRW
      .prepare(`
        SELECT snapshot_time, open_loans, past_missed, branches
        FROM PAR_Borrower_Access_History
        ORDER BY snapshot_time DESC
      `)
      .all()

    const effectiveSet = new Set(sortedBranches)
    const bySnapshot = new Map()

    for (const row of rows) {
      let branches = []
      try {
        const parsed = JSON.parse(row.branches || '[]')
        branches = Array.isArray(parsed) ? parsed : []
      } catch {
        branches = []
      }

      if (!branches.length) continue
      const intersects = branches.some((code) => effectiveSet.has(String(code || '').trim()))
      if (!intersects) continue

      const snapshot = String(row.snapshot_time || '').trim()
      if (!snapshot) continue

      const open = Number(row.open_loans) || 0
      const missed = Number(row.past_missed) || 0

      const existing = bySnapshot.get(snapshot) || { time: snapshot, Past_Arrears_missed: 0, Open_loans: 0 }
      existing.Past_Arrears_missed += missed
      existing.Open_loans += open
      bySnapshot.set(snapshot, existing)
    }

    const result = Array.from(bySnapshot.values()).sort((a, b) => String(b.time).localeCompare(String(a.time)))

    // Keep cache bounded to avoid unbounded memory growth.
    parHistoryCountryCache.set(cacheKey, result)
    if (parHistoryCountryCache.size > 50) {
      const firstKey = parHistoryCountryCache.keys().next().value
      if (firstKey) parHistoryCountryCache.delete(firstKey)
    }

    return res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/par/past-missed', async (req, res) => {
  try {
    const activeBranches = dbRW.prepare('SELECT code FROM Logbook_Branches WHERE active = 1').all()
    if (activeBranches.length === 0) {
      return res.status(400).json({ error: 'No active branches found' })
    }

    let totalSum = 0
    let totalFetched = 0
    for (const branch of activeBranches) {
      const branchCode = String(branch.code ?? '').trim()
      if (!branchCode) continue
      try {
        const result = await fetchLoanPrincipalSum(branchCode, '5||16||6')
        totalSum += result.sum
        totalFetched += result.fetched
      } catch (e) {
        console.error(`Error fetching past-missed for branch ${branchCode}:`, e.message)
      }
    }

    const ts = getNairobiTime()
    dbRW.prepare('INSERT INTO PAR (time, Past_Arrears_missed) VALUES (?, ?)').run(ts, totalSum)
    res.json({ time: ts, past_arrears_missed: totalSum, fetched: totalFetched, branchesProcessed: activeBranches.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/par/open', async (req, res) => {
  try {
    const activeBranches = dbRW.prepare('SELECT code FROM Logbook_Branches WHERE active = 1').all()
    if (activeBranches.length === 0) {
      return res.status(400).json({ error: 'No active branches found' })
    }

    let totalSum = 0
    let totalFetched = 0
    for (const branch of activeBranches) {
      const branchCode = String(branch.code ?? '').trim()
      if (!branchCode) continue
      try {
        const result = await fetchLoanPrincipalSum(branchCode, '1')
        totalSum += result.sum
        totalFetched += result.fetched
      } catch (e) {
        console.error(`Error fetching open loans for branch ${branchCode}:`, e.message)
      }
    }

    const ts = getNairobiTime()
    dbRW.prepare('INSERT INTO PAR (time, Open_loans) VALUES (?, ?)').run(ts, totalSum)
    res.json({ time: ts, open_loans: totalSum, fetched: totalFetched, branchesProcessed: activeBranches.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Simple in-memory cache keyed by latest PAR time
let parBranchesCache = { time: null, data: null }
let parBorrowerAccessCache = { time: null, data: null }
let parHistoryCountryCache = new Map()

app.get('/api/par/branches', async (req, res) => {
  try {
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null && String(req.query.country).trim()
    const requestedTime = req.query && req.query.time != null ? String(req.query.time).trim() : ''

    // Get active branches (optionally restricted by country)
    let activeBranches
    if (countryParam) {
      activeBranches = dbRW.prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1 AND country = ?').all(countryParam)
      if (activeBranches.length === 0) {
        return res.json([])
      }
    } else {
      activeBranches = dbRW.prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1').all()
    }
    if (activeBranches.length === 0) {
      return res.status(400).json({ error: 'No active branches found' })
    }

    // Resolve snapshot time (default: latest)
    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    
    if (!latestPar || !latestPar.time) {
      return res.json([]) // No data available yet
    }

    const snapshotTime = requestedTime || latestPar.time

    // Return cached if same snapshot time (only when not country-filtered)
    // Country-filtered results depend on Logbook_Branches config and should not reuse global cache.
    if (!requestedTime && !countryParam && parBranchesCache.time === latestPar.time && parBranchesCache.data) {
      const effectiveSet = effectiveBranches.length > 0 ? new Set(effectiveBranches) : null
      const data = !effectiveSet
        ? parBranchesCache.data
        : parBranchesCache.data.filter((b) => {
            const code = String(b.code ?? '').trim()
            return code && effectiveSet.has(code)
          })
      return res.json(data)
    }

    // Read all loan records from saved tables
    const openLoansRows = db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(snapshotTime)
    const pastMissedRows = db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ?').all(snapshotTime)

    // Aggregate by branch_code
    const openLoansMap = new Map()
    const pastMissedMap = new Map()

    // Process open loans
    for (const row of openLoansRows) {
      const branchCode = row.branch_code
      try {
        const loan = JSON.parse(row.loan_data)
        const rawPrincipal =
          loan.principal_balance_amount ??
          loan.PrincipalBalanceAmount ??
          loan['principal_balance_amount'] ??
          loan['Principal Balance Amount'] ??
          loan['Principal Balance'] ??
          0
        const principal = Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0
        openLoansMap.set(branchCode, (openLoansMap.get(branchCode) || 0) + principal)
      } catch (e) {
        console.error(`Error parsing open loan for branch ${branchCode}:`, e.message)
      }
    }

    // Process past-missed loans
    for (const row of pastMissedRows) {
      const branchCode = row.branch_code
      try {
        const loan = JSON.parse(row.loan_data)
        const rawPrincipal =
          loan.principal_balance_amount ??
          loan.PrincipalBalanceAmount ??
          loan['principal_balance_amount'] ??
          loan['Principal Balance Amount'] ??
          loan['Principal Balance'] ??
          0
        const principal = Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0
        pastMissedMap.set(branchCode, (pastMissedMap.get(branchCode) || 0) + principal)
      } catch (e) {
        console.error(`Error parsing past-missed loan for branch ${branchCode}:`, e.message)
      }
    }

    const branchData = []

    // Build branch data from aggregated records
    for (const branch of activeBranches) {
      const branchCode = String(branch.code ?? '').trim()
      if (!branchCode) continue
      
      const openLoans = Number(openLoansMap.get(branchCode) || 0)
      const pastMissed = Number(pastMissedMap.get(branchCode) || 0)
      const parRate = openLoans > 0 ? (pastMissed / openLoans) * 100 : 0

      branchData.push({
        code: branchCode,
        name: branch.name || branchCode,
        pastMissed: pastMissed,
        openLoans: openLoans,
        parRate: parRate
      })
    }

    // Sort by PAR rate descending
    branchData.sort((a, b) => b.parRate - a.parRate)
    
    if (!requestedTime && !countryParam) {
      parBranchesCache = { time: latestPar.time, data: branchData }
    }

    const effectiveSet = effectiveBranches.length > 0 ? new Set(effectiveBranches) : null
    const data = !effectiveSet
      ? branchData
      : branchData.filter((b) => {
          const code = String(b.code ?? '').trim()
          return code && effectiveSet.has(code)
        })

    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/par/borrower-access', async (req, res) => {
  try {
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null && String(req.query.country).trim()
    const { branch } = req.query // Optional branch filter

    // Get the latest snapshot time
    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    if (!latestPar || !latestPar.time) {
      return res.json([])
    }
    const latestTime = latestPar.time

    if (countryParam && effectiveBranches.length === 0) {
      return res.json([])
    }

    // Load saved loan records for the snapshot
    let openLoansRows = branch 
      ? db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ? AND branch_code = ?').all(latestTime, branch)
      : db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
    let pastMissedRows = branch
      ? db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ? AND branch_code = ?').all(latestTime, branch)
      : db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ?').all(latestTime)

    if (countryParam && effectiveBranches.length > 0) {
      const effectiveSet = new Set(effectiveBranches)
      openLoansRows = openLoansRows.filter((r) => effectiveSet.has(r.branch_code))
      pastMissedRows = pastMissedRows.filter((r) => effectiveSet.has(r.branch_code))
    }

    const officerMap = new Map()

    // Optimized accumulation function with faster processing
    const accumulateLoan = (rows, key) => {
      for (const row of rows) {
        try {
          // Fast JSON parse with early exit on error
          let loan
          try {
            loan = JSON.parse(row.loan_data)
          } catch (parseErr) {
            continue // Skip invalid JSON silently
          }
          
          const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
          if (!borrowerAccessIds.length) continue

          // Optimize principal extraction - check number type first
          const rawPrincipal = loan.principal_balance_amount ?? 
            loan.PrincipalBalanceAmount ??
            loan['principal_balance_amount'] ??
            loan['Principal Balance Amount'] ??
                              loan['Principal Balance'] ?? 0
          const principal = typeof rawPrincipal === 'number' 
            ? rawPrincipal 
            : Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0

          // Early exit if principal is 0
          if (principal === 0) continue

          borrowerAccessIds.forEach((officerId) => {
            const officerKey = String(officerId).trim()
            if (!officerKey) return

            if (!officerMap.has(officerKey)) {
              officerMap.set(officerKey, {
                officerId: officerKey,
                openLoans: 0,
                pastMissed: 0,
                branches: new Set()
              })
            }

            const entry = officerMap.get(officerKey)
            entry[key] += principal
            entry.branches.add(row.branch_code)
          })
        } catch (e) {
          // Silently skip errors to avoid logging overhead
          continue
        }
      }
    }

    accumulateLoan(openLoansRows, 'openLoans')
    accumulateLoan(pastMissedRows, 'pastMissed')

    const officerData = Array.from(officerMap.values()).map((entry) => {
      const parRate = entry.openLoans > 0 ? (entry.pastMissed / entry.openLoans) * 100 : 0
      return {
        officerId: entry.officerId,
        openLoans: entry.openLoans,
        pastMissed: entry.pastMissed,
        parRate,
        branches: Array.from(entry.branches),
        snapshotTime: latestTime,
      }
    })

    officerData.sort((a, b) => b.parRate - a.parRate)

    // Only cache if no branch/country filter (to avoid cache complexity)
    if (!branch && !countryParam && parBorrowerAccessCache.time !== latestPar.time) {
    parBorrowerAccessCache = { time: latestPar.time, data: officerData }
    }

    const effectiveSet = effectiveBranches.length > 0 ? new Set(effectiveBranches) : null
    const data = !effectiveSet
      ? officerData
      : officerData.filter((entry) => {
          if (!Array.isArray(entry.branches) || entry.branches.length === 0) return false
          return entry.branches.some((code) => {
            const c = String(code ?? '').trim()
            return c && effectiveSet.has(c)
          })
        })

    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// SSE endpoint for PAR snapshot progress
app.get('/api/par/progress', (req, res) => {
  setEventStreamHeaders(req, res)

  const onProgress = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  events.on('par_snapshot_progress', onProgress)
  req.on('close', () => {
    events.off('par_snapshot_progress', onProgress)
  })
})

// Function to execute PAR snapshot (reusable for cron and manual trigger)
async function executePARSnapshot() {
  try {
    // Get all active branches
    const activeBranches = dbRW.prepare('SELECT code FROM Logbook_Branches WHERE active = 1').all()
    
    if (activeBranches.length === 0) {
      throw new Error('No active branches found')
    }

    const totalBranches = activeBranches.length
    let totalPastMissed = 0
    let totalOpenLoans = 0
    let totalFetchedPastMissed = 0
    let totalFetchedOpenLoans = 0
    const branchStats = []
    const allOpenLoans = [] // Store all open loan records with branch_code
    const allPastMissedLoans = [] // Store all past-missed loan records with branch_code

    // Emit initial progress
    events.emit('par_snapshot_progress', {
      current: 0,
      total: totalBranches,
      branch: null,
      status: 'starting'
    })

    // Iterate through each active branch
    for (let i = 0; i < activeBranches.length; i++) {
      const branch = activeBranches[i]
      const branchCode = String(branch.code ?? '').trim()
      if (!branchCode) continue
      
      // Add delay between branches to avoid rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      
      try {
        // Emit progress: starting branch
        events.emit('par_snapshot_progress', {
          current: i + 1,
          total: totalBranches,
          branch: branchCode,
          status: 'processing'
        })

        // Fetch past-missed for this branch
        const pastMissed = await fetchLoanPrincipalSum(branchCode, '5||16||6')
        totalPastMissed += pastMissed.sum
        totalFetchedPastMissed += pastMissed.fetched

        // Store all past-missed loan records with branch_code
        for (const loan of pastMissed.loans || []) {
          allPastMissedLoans.push({
            branch_code: branchCode,
            loan_data: JSON.stringify(loan),
            time: null // Will be set later
          })
        }

        // Fetch open loans for this branch
        const openLoans = await fetchLoanPrincipalSum(branchCode, '1')
        totalOpenLoans += openLoans.sum
        totalFetchedOpenLoans += openLoans.fetched

        // Store all open loan records with branch_code
        for (const loan of openLoans.loans || []) {
          allOpenLoans.push({
            branch_code: branchCode,
            loan_data: JSON.stringify(loan),
            time: null // Will be set later
          })
        }

        branchStats.push({
          branch: branchCode,
          pastMissed: pastMissed.sum,
          openLoans: openLoans.sum
        })

        // Emit progress: branch completed
        events.emit('par_snapshot_progress', {
          current: i + 1,
          total: totalBranches,
          branch: branchCode,
          status: 'completed'
        })
      } catch (e) {
        const errorMsg = e.message || String(e)
        console.error(`Error fetching data for branch ${branchCode}:`, errorMsg)
        // Emit progress: branch failed
        events.emit('par_snapshot_progress', {
          current: i + 1,
          total: totalBranches,
          branch: branchCode,
          status: 'failed',
          error: errorMsg
        })
        // Continue with other branches even if one fails
        // Add a delay before processing next branch to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    // Emit progress: saving to database
    events.emit('par_snapshot_progress', {
      current: totalBranches,
      total: totalBranches,
      branch: null,
      status: 'saving'
    })

    const ts = getNairobiTime()
    dbRW.prepare('INSERT INTO PAR (time, Past_Arrears_missed, Open_loans) VALUES (?, ?, ?)').run(ts, totalPastMissed, totalOpenLoans)
    
    // Save branch-level loan data to tables
    // Clear old records for this timestamp (in case of re-runs)
    dbRW.prepare('DELETE FROM Open_loans WHERE time = ?').run(ts)
    dbRW.prepare('DELETE FROM Past_Missed_repayment WHERE time = ?').run(ts)
    
    // Insert all loan records
    const insertOpenLoans = dbRW.prepare('INSERT INTO Open_loans (branch_code, loan_data, time) VALUES (?, ?, ?)')
    const insertPastMissed = dbRW.prepare('INSERT INTO Past_Missed_repayment (branch_code, loan_data, time) VALUES (?, ?, ?)')
    
    // Save all open loan records
    for (const loanRecord of allOpenLoans) {
      insertOpenLoans.run(loanRecord.branch_code, loanRecord.loan_data, ts)
    }
    
    // Save all past-missed loan records
    for (const loanRecord of allPastMissedLoans) {
      insertPastMissed.run(loanRecord.branch_code, loanRecord.loan_data, ts)
    }
    
    // After saving loan-level data, also aggregate and persist per Borrower Access ID (officer) for history
    try {
      const officerMap = new Map()

      const accumulateLoanForHistory = (records, key) => {
        for (const rec of records) {
          try {
            let loan
            try {
              loan = JSON.parse(rec.loan_data)
            } catch {
              continue
            }

            const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
            if (!borrowerAccessIds.length) continue

            const rawPrincipal =
              loan.principal_balance_amount ??
              loan.PrincipalBalanceAmount ??
              loan['principal_balance_amount'] ??
              loan['Principal Balance Amount'] ??
              loan['Principal Balance'] ??
              0

            const principal =
              typeof rawPrincipal === 'number'
                ? rawPrincipal
                : Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0

            if (principal === 0) continue

            borrowerAccessIds.forEach((officerId) => {
              const officerKey = String(officerId || '').trim()
              if (!officerKey) return

              if (!officerMap.has(officerKey)) {
                officerMap.set(officerKey, {
                  officerId: officerKey,
                  openLoans: 0,
                  pastMissed: 0,
                  branches: new Set(),
                })
              }

              const entry = officerMap.get(officerKey)
              entry[key] += principal
              entry.branches.add(rec.branch_code)
            })
          } catch {
            continue
          }
        }
      }

      accumulateLoanForHistory(allOpenLoans, 'openLoans')
      accumulateLoanForHistory(allPastMissedLoans, 'pastMissed')

      const snapshotDate = String(ts).slice(0, 10) // YYYY-MM-DD from ISO string
      const insertHist = dbRW.prepare(`
        INSERT INTO PAR_Borrower_Access_History (
          snapshot_time,
          snapshot_date,
          officer_id,
          open_loans,
          past_missed,
          par_rate,
          branches
        ) VALUES (
          @snapshot_time,
          @snapshot_date,
          @officer_id,
          @open_loans,
          @past_missed,
          @par_rate,
          @branches
        )
        ON CONFLICT(officer_id, snapshot_date) DO UPDATE SET
          snapshot_time = excluded.snapshot_time,
          open_loans = excluded.open_loans,
          past_missed = excluded.past_missed,
          par_rate = excluded.par_rate,
          branches = excluded.branches,
          created_at = CURRENT_TIMESTAMP
      `)

      for (const entry of officerMap.values()) {
        const parRate = entry.openLoans > 0 ? (entry.pastMissed / entry.openLoans) * 100 : 0
        insertHist.run({
          snapshot_time: ts,
          snapshot_date: snapshotDate,
          officer_id: entry.officerId,
          open_loans: entry.openLoans,
          past_missed: entry.pastMissed,
          par_rate: parRate,
          branches: JSON.stringify(Array.from(entry.branches || [])),
        })
      }
    } catch (e) {
      console.error('[PAR] Failed to update PAR_Borrower_Access_History:', e.message)
    }

    // Update last run time
    const upsertLastRun = dbRW.prepare(`
      INSERT INTO PAR_Snapshot_LastRun (id, last_run_time, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_run_time = excluded.last_run_time, updated_at = excluded.updated_at
    `)
    upsertLastRun.run(ts, getNairobiTime())
    
    // Emit progress: completed
    events.emit('par_snapshot_progress', {
      current: totalBranches,
      total: totalBranches,
      branch: null,
      status: 'completed'
    })
    
    return {
      time: ts,
      past_arrears_missed: totalPastMissed,
      open_loans: totalOpenLoans,
      branchesProcessed: totalBranches,
      stats: {
        pastMissed: { sum: totalPastMissed, fetched: totalFetchedPastMissed },
        openLoans: { sum: totalOpenLoans, fetched: totalFetchedOpenLoans },
        branchStats
      }
    }
  } catch (e) {
    events.emit('par_snapshot_progress', {
      status: 'error',
      error: e.message
    })
    throw e
  }
}

app.post('/api/par/snapshot', async (req, res) => {
  try {
    const result = await executePARSnapshot()
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Get last run time for PAR snapshot
app.get('/api/par/last-run', (req, res) => {
  try {
    const row = dbRW.prepare('SELECT last_run_time FROM PAR_Snapshot_LastRun WHERE id = 1').get()
    if (row) {
      res.json({ last_run_time: row.last_run_time })
    } else {
      res.json({ last_run_time: null })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/data/last-refresh', (req, res) => {
  try {
    const row = dbRW.prepare('SELECT last_run_time FROM DataRefresh_Status WHERE id = 1').get()
    res.json({ last_run_time: row?.last_run_time || null })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// System maintenance status (public)
app.get('/api/system/status', (req, res) => {
  try {
    res.json({ maintenance: isMaintenanceEnabled() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Kajea stats endpoint
app.get('/api/kajea/stats', (req, res) => {
  try {
    let whiteLabelClientCount = 0
    let uniqueOwners = 0
    let overseaDeviceCount = 0
    let whitelabelDeviceCount = 0
    const vehicleTypes = new Set()
    let clientGrowth = []
    
    // Count clients from white_label table (if exists)
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM white_label').get()
      whiteLabelClientCount = Number(result?.count || 0)
    } catch (e) {
      console.warn('[Kajea Stats] white_label table not found or error:', e.message)
    }
    
    // Count unique owner_name from oversea_vehicles table (if exists)
    try {
      const result = db.prepare("SELECT COUNT(DISTINCT owner_name) as count FROM oversea_vehicles WHERE owner_name IS NOT NULL AND owner_name != ''").get()
      uniqueOwners = Number(result?.count || 0)
    } catch (e) {
      console.warn('[Kajea Stats] oversea_vehicles table not found or error:', e.message)
    }
    
    // Sum both to get total clients
    const clientCount = whiteLabelClientCount + uniqueOwners
    
    // Count devices from both oversea_vehicles and Whitelabel_devices (if exist)
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM oversea_vehicles').get()
      overseaDeviceCount = Number(result?.count || 0)
    } catch (e) {
      console.warn('[Kajea Stats] oversea_vehicles table not found for device count:', e.message)
    }
    
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM Whitelabel_devices').get()
      whitelabelDeviceCount = Number(result?.count || 0)
    } catch (e) {
      console.warn('[Kajea Stats] Whitelabel_devices table not found:', e.message)
    }
    
    const totalDevices = overseaDeviceCount + whitelabelDeviceCount
    
    // Get vehicle types from both tables (if exist)
    try {
      const overseaTypes = db.prepare("SELECT DISTINCT type FROM oversea_vehicles WHERE type IS NOT NULL AND type != ''").all()
      overseaTypes.forEach(row => {
        if (row.type) vehicleTypes.add(row.type)
      })
    } catch (e) {
      console.warn('[Kajea Stats] Error fetching oversea vehicle types:', e.message)
    }
    
    try {
      const whitelabelTypes = db.prepare("SELECT DISTINCT make FROM Whitelabel_devices WHERE make IS NOT NULL AND make != ''").all()
      whitelabelTypes.forEach(row => {
        if (row.make) vehicleTypes.add(row.make)
      })
    } catch (e) {
      console.warn('[Kajea Stats] Error fetching whitelabel vehicle types:', e.message)
    }
    
    // Build client growth series based on activate_time from oversea_vehicles
    try {
      const rows = db.prepare("SELECT activate_time FROM oversea_vehicles WHERE activate_time IS NOT NULL AND activate_time != ''").all()
      const byMonth = new Map()
      for (const row of rows) {
        const raw = String(row.activate_time || '').trim()
        if (!raw) continue
        let d = new Date(raw)
        if (isNaN(d.getTime())) {
          // Try parsing date-only part if there's a time component
          const dateOnly = raw.split('T')[0]
          d = new Date(dateOnly)
        }
        if (isNaN(d.getTime())) continue
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        const key = `${y}-${String(m).padStart(2, '0')}`
        byMonth.set(key, (byMonth.get(key) || 0) + 1)
      }
      const sorted = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      let cumulative = 0
      clientGrowth = sorted.map(([ym, count]) => {
        cumulative += count
        const [yStr, mStr] = ym.split('-')
        const labelDate = new Date(Number(yStr), Number(mStr) - 1, 1)
        const label = labelDate.toLocaleString('en-US', { month: 'short', year: '2-digit' })
        return {
          key: ym,
          month: label,
          count,
          cumulative,
        }
      })
    } catch (e) {
      console.warn('[Kajea Stats] Error building client growth series:', e.message)
      clientGrowth = []
    }
    
    res.json({
      clients: clientCount,
      devices: totalDevices,
      vehicleTypes: Array.from(vehicleTypes).sort(),
      clientGrowth,
    })
  } catch (e) {
    console.error('[Kajea Stats] Unexpected error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Oversea Tracking helpers and local long-term store for OS-Parking report
const OVERSEA_API_URL = 'http://api.overseetracking.com/WebProcessorApi.ashx'
const OVERSEA_LANGUAGE_TYPE = '2B72ABC6-19D7-4653-AAEE-0BE542026D46'
const OVERSEA_USERNAME = process.env.OVERSEA_USERNAME || 'GREGORY NYAMAO '
const OVERSEA_PASSWORD = process.env.OVERSEA_PASSWORD || 'NYAMAO@3077'

let overseaSyncInProgress = false

function parseDurationMinutes(durationText) {
  const text = String(durationText || '').trim()
  if (!text) return null
  const parts = text.split(':').map((x) => Number(x))
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length == 3) return (parts[0] * 60) + parts[1] + (parts[2] / 60)
  if (parts.length == 2) return parts[0] + (parts[1] / 60)
  return null
}

function normalizeOverseaDateTime(day, timeValue) {
  const d = String(day || '').trim()
  const t = String(timeValue || '').trim()
  if (!d || !t) return null
  const iso = `${d}T${t}`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  const normalized = iso.length == 16 ? `${iso}:00` : iso
  return normalized.replace('T', ' ')
}

function overseaSourceHash(row) {
  const base = [
    row.productId || '',
    row.dbId || '',
    row.startTime || '',
    row.endTime || '',
    row.parkCoordinates || '',
    row.duration || '',
  ].join('|')
  return crypto.createHash('sha256').update(base).digest('hex')
}

async function overseaSignIn() {
  const params = new URLSearchParams()
  params.append('Token', '')
  params.append('InformationType', 'User')
  params.append('OperationType', 'SignIn')
  params.append('LanguageType', OVERSEA_LANGUAGE_TYPE)
  params.append('Arguments', JSON.stringify({ UserName: OVERSEA_USERNAME, Password: OVERSEA_PASSWORD }))
  params.append('PageArguments', JSON.stringify({ PageSize: 1, PageIndex: 1 }))

  const resp = await fetch(OVERSEA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
      Origin: 'http://www.overseetracking.com',
      Referer: 'http://www.overseetracking.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PhoenixDashboard/1.0',
    },
    body: params.toString(),
  })

  const text = await resp.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Oversea sign-in parse failed (${resp.status}): ${(text || '').slice(0, 180)}`)
  }
  if (!json || json.State !== '0' || !json.Token) {
    throw new Error(json?.Error || 'Oversea sign-in failed')
  }
  return json.Token
}

async function overseaRequest(token, informationType, operationType, args, pageArgs = null, useFormData = false) {
  const headers = {
    Accept: '*/*',
    Origin: 'http://www.overseetracking.com',
    Referer: 'http://www.overseetracking.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PhoenixDashboard/1.0',
  }

  let body
  if (useFormData) {
    const form = new FormData()
    form.append('Token', token)
    form.append('InformationType', informationType)
    form.append('OperationType', operationType)
    form.append('LanguageType', OVERSEA_LANGUAGE_TYPE)
    form.append('Arguments', JSON.stringify(args || {}))
    if (pageArgs) form.append('PageArguments', JSON.stringify(pageArgs))
    body = form
  } else {
    const params = new URLSearchParams()
    params.append('Token', token)
    params.append('InformationType', informationType)
    params.append('OperationType', operationType)
    params.append('LanguageType', OVERSEA_LANGUAGE_TYPE)
    params.append('Arguments', JSON.stringify(args || {}))
    if (pageArgs) params.append('PageArguments', JSON.stringify(pageArgs))
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = params.toString()
  }

  const resp = await fetch(OVERSEA_API_URL, { method: 'POST', headers, body })
  const text = await resp.text()
  let json
  try {
    json = JSON.parse((text || '').trim() || '{}')
  } catch {
    throw new Error(`Oversea ${operationType} parse failed (${resp.status}): ${(text || '').slice(0, 180)}`)
  }
  if (!json || json.State !== '0') {
    throw new Error(json?.Error || `Oversea ${operationType} failed (State=${json?.State ?? 'unknown'})`)
  }
  return json
}

function normalizeTracker(t) {
  return {
    productId: t.ProductID || '',
    dbId: t.DbID || '',
    systemNo: t.SystemNo || '',
    modelId: t.ModelID || '',
    model: t.Model || '',
    imei: t.IMEI || '',
    groupId: t.GroupID || '',
    groupName: t.GroupName || '',
    companyId: t.CompanyID || '',
    companyName: t.CompanyName || '',
    phoneNumber1: t.PhoneNumber1 || '',
    objectId: t.ObjectID || '',
    name: t.Name || '',
    ownerName: t.OwnerName || '',
    ownerPhone: t.OwnerPhone || '',
    brand: t.Brand || '',
    type: t.Type || '',
    iccid: t.ICCID || '',
    vehId: t.VehID || '',
    totId: t.TotID || '',
    timezone: t.Timezone || '',
    serverIp: t.ServerIP || '',
    trackerStatus: t.TrackerStatus || '',
    activateTime: t.ActivateTime || '',
    expireDate: t.ExpireDate || '',
    cexpireDate: t.CExpireDate || '',
    raw: t,
  }
}

const upsertOverseaVehicleStmt = dbRW.prepare(`
  INSERT INTO oversea_vehicles (
    product_id, db_id, system_no, model_id, model, imei, group_id, group_name, company_id, company_name,
    phone_number1, object_id, name, owner_name, owner_phone, brand, type, iccid, veh_id, tot_id, timezone,
    server_ip, tracker_status, activate_time, expire_date, cexpire_date, last_sync_at, source_payload
  ) VALUES (
    @product_id, @db_id, @system_no, @model_id, @model, @imei, @group_id, @group_name, @company_id, @company_name,
    @phone_number1, @object_id, @name, @owner_name, @owner_phone, @brand, @type, @iccid, @veh_id, @tot_id, @timezone,
    @server_ip, @tracker_status, @activate_time, @expire_date, @cexpire_date, CURRENT_TIMESTAMP, @source_payload
  )
  ON CONFLICT(product_id) DO UPDATE SET
    db_id=excluded.db_id,
    system_no=excluded.system_no,
    model_id=excluded.model_id,
    model=excluded.model,
    imei=excluded.imei,
    group_id=excluded.group_id,
    group_name=excluded.group_name,
    company_id=excluded.company_id,
    company_name=excluded.company_name,
    phone_number1=excluded.phone_number1,
    object_id=excluded.object_id,
    name=excluded.name,
    owner_name=excluded.owner_name,
    owner_phone=excluded.owner_phone,
    brand=excluded.brand,
    type=excluded.type,
    iccid=excluded.iccid,
    veh_id=excluded.veh_id,
    tot_id=excluded.tot_id,
    timezone=excluded.timezone,
    server_ip=excluded.server_ip,
    tracker_status=excluded.tracker_status,
    activate_time=excluded.activate_time,
    expire_date=excluded.expire_date,
    cexpire_date=excluded.cexpire_date,
    last_sync_at=CURRENT_TIMESTAMP,
    source_payload=excluded.source_payload
`)

const insertParkingStmt = dbRW.prepare(`
  INSERT OR IGNORE INTO oversea_parking_records (
    product_id, db_id, plate_no, parking_day, start_time, end_time, park_coordinates,
    duration_text, duration_minutes, park_address, condition_type, source_hash, source_payload
  ) VALUES (
    @product_id, @db_id, @plate_no, @parking_day, @start_time, @end_time, @park_coordinates,
    @duration_text, @duration_minutes, @park_address, @condition_type, @source_hash, @source_payload
  )
`)

const insertSyncRunStmt = dbRW.prepare(
  `INSERT INTO oversea_sync_runs (job_name, started_at, status) VALUES (?, ?, 'running')`
)

const finishSyncRunStmt = dbRW.prepare(`
  UPDATE oversea_sync_runs
  SET ended_at = ?, status = ?, vehicles_seen = ?, records_inserted = ?, records_updated = ?, error_message = ?
  WHERE id = ?
`)

async function fetchOverseaTrackers(token) {
  const json = await overseaRequest(
    token,
    'Product',
    'GetMyTracker',
    { TrackerType: '1' },
    { PageSize: 500, PageIndex: 1 },
    false,
  )
  const trackers = Array.isArray(json?.Data?.Tracker) ? json.Data.Tracker : []
  return trackers.map(normalizeTracker).filter((v) => v.productId && v.dbId)
}

async function fetchParkingRows(token, vehicle, startTime, endTime, conditionType = 1, minDuration = 0, pageSize = 500) {
  const args = {
    ConditionType: String(conditionType),
    MinDuration: String(minDuration),
    ProductID: String(vehicle.productId),
    DbID: String(vehicle.dbId),
    StartTime: String(startTime),
    EndTime: String(endTime),
  }

  const all = []
  let pageIndex = 1
  let totalPages = 1

  while (pageIndex <= totalPages) {
    let json
    try {
      json = await overseaRequest(token, 'ParkingRecord', 'Query', args, { PageSize: pageSize, PageIndex: pageIndex }, true)
    } catch (err) {
      if (pageIndex == 1) {
        json = await overseaRequest(token, 'ParkingRecord', 'Query', args, null, true)
      } else {
        throw err
      }
    }

    const rows = Array.isArray(json?.Data?.ParkingRecord)
      ? json.Data.ParkingRecord
      : Array.isArray(json?.Data?.Record)
        ? json.Data.Record
        : Array.isArray(json?.Data)
          ? json.Data
          : []

    all.push(...rows)
    const apiTotalPages = Number(json?.TotalPage || 0)
    if (apiTotalPages > 0) {
      totalPages = apiTotalPages
      if (pageIndex >= totalPages) break
      pageIndex += 1
    } else {
      break
    }
  }

  return all
}

function mapParkingRow(vehicle, row, conditionType) {
  const productId = row.ProductID || vehicle.productId
  const dbId = row.DbID || vehicle.dbId
  const day = String(row.Day || '').trim()
  const startTime = row.StartTime || row.StartDateTime || row.Start || row.beginTime || ''
  const endTime = row.EndTime || row.EndDateTime || row.End || row.stopTime || ''
  const normalizedStart = normalizeOverseaDateTime(day, startTime)
  const normalizedEnd = normalizeOverseaDateTime(day, endTime)
  const duration = row.Duration || row.DurationTime || row.ParkTime || ''

  const normalized = {
    productId,
    dbId,
    plateNo: row.PlateNO || '',
    day,
    startTime: normalizedStart || startTime || null,
    endTime: normalizedEnd || endTime || null,
    parkCoordinates: row.ParkCoordinates || '',
    duration,
    parkAddress: row.ParkAddress || '',
    isTotalCount: String(row.IsTotalCount || ''),
    dayResultRowCount: row.DayResultRowCount || '',
    totalResultRowCount: row.TotalResultRowCount || '',
    conditionType: Number(conditionType || 1),
    raw: row,
  }
  return { ...normalized, sourceHash: overseaSourceHash(normalized) }
}

function upsertVehicles(vehicles) {
  const tx = dbRW.transaction((rows) => {
    for (const v of rows) {
      upsertOverseaVehicleStmt.run({
        product_id: v.productId,
        db_id: v.dbId,
        system_no: v.systemNo,
        model_id: v.modelId,
        model: v.model,
        imei: v.imei,
        group_id: v.groupId,
        group_name: v.groupName,
        company_id: v.companyId,
        company_name: v.companyName,
        phone_number1: v.phoneNumber1,
        object_id: v.objectId,
        name: v.name,
        owner_name: v.ownerName,
        owner_phone: v.ownerPhone,
        brand: v.brand,
        type: v.type,
        iccid: v.iccid,
        veh_id: v.vehId,
        tot_id: v.totId,
        timezone: v.timezone,
        server_ip: v.serverIp,
        tracker_status: v.trackerStatus,
        activate_time: v.activateTime,
        expire_date: v.expireDate,
        cexpire_date: v.cexpireDate,
        source_payload: JSON.stringify(v.raw || {}),
      })
    }
  })
  tx(vehicles)
}

function insertParkingRows(rows) {
  let inserted = 0
  const tx = dbRW.transaction((records) => {
    for (const r of records) {
      const res = insertParkingStmt.run({
        product_id: r.productId,
        db_id: r.dbId,
        plate_no: r.plateNo || null,
        parking_day: r.day || null,
        start_time: r.startTime || null,
        end_time: r.endTime || null,
        park_coordinates: r.parkCoordinates || null,
        duration_text: r.duration || null,
        duration_minutes: parseDurationMinutes(r.duration),
        park_address: r.parkAddress || null,
        condition_type: Number(r.conditionType || 1),
        source_hash: r.sourceHash,
        source_payload: JSON.stringify(r.raw || {}),
      })
      if (res.changes > 0) inserted += 1
    }
  })
  tx(rows)
  return inserted
}

function formatNairobiDateTime(dt) {
  const d = dt instanceof Date ? dt : new Date(dt)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function runOverseaSync({ jobName = 'nightly_incremental', lookbackDays = 3, conditionType = 1, minDuration = 0 } = {}) {
  if (overseaSyncInProgress) {
    return { skipped: true, reason: 'sync already in progress' }
  }

  overseaSyncInProgress = true
  const startedAtText = new Date().toISOString()
  const runId = insertSyncRunStmt.run(jobName, startedAtText).lastInsertRowid

  let vehiclesSeen = 0
  let recordsInserted = 0
  const recordsUpdated = 0

  try {
    const token = await overseaSignIn()
    const vehicles = await fetchOverseaTrackers(token)
    vehiclesSeen = vehicles.length
    upsertVehicles(vehicles)

    if (Number(lookbackDays) > 0) {
      const end = new Date()
      end.setHours(23, 59, 59, 0)
      const start = new Date(end)
      start.setDate(start.getDate() - Number(lookbackDays))
      start.setHours(0, 0, 0, 0)

      for (const vehicle of vehicles) {
        const rawRows = await fetchParkingRows(
          token,
          vehicle,
          formatNairobiDateTime(start),
          formatNairobiDateTime(end),
          conditionType,
          minDuration,
        )
        if (!rawRows.length) continue
        const mapped = rawRows.map((r) => mapParkingRow(vehicle, r, conditionType))
        recordsInserted += insertParkingRows(mapped)
      }
    }

    finishSyncRunStmt.run(new Date().toISOString(), 'success', vehiclesSeen, recordsInserted, recordsUpdated, null, runId)
    return { status: 'success', jobName, vehiclesSeen, recordsInserted, recordsUpdated }
  } catch (e) {
    finishSyncRunStmt.run(new Date().toISOString(), 'failed', vehiclesSeen, recordsInserted, recordsUpdated, e.message, runId)
    throw e
  } finally {
    overseaSyncInProgress = false
  }
}

async function ensureInitialOverseaBackfill() {
  try {
    const row = db.prepare('SELECT COUNT(1) AS c FROM oversea_parking_records').get()
    const count = Number(row?.c || 0)
    if (count > 0) return
    console.log('[OVERSEA] No local parking records found. Running initial 90-day backfill...')
    await runOverseaSync({ jobName: 'initial_backfill', lookbackDays: 90, conditionType: 1, minDuration: 0 })
    console.log('[OVERSEA] Initial 90-day backfill completed.')
  } catch (e) {
    console.error('[OVERSEA] Initial backfill failed:', e.message)
  }
}

app.get('/api/kajea/os/vehicles', async (req, res) => {
  try {
    const refresh = String(req.query.refresh || '') == '1'
    if (refresh) {
      await runOverseaSync({ jobName: 'manual_vehicle_refresh', lookbackDays: 0 })
    }

    const rows = db.prepare(`
      SELECT product_id, db_id, name, system_no, imei, model, owner_name, owner_phone, brand, activate_time, source_payload
      FROM oversea_vehicles
      ORDER BY name COLLATE NOCASE, product_id
    `).all()

    const vehicles = rows.map((r) => {
      let raw = {}
      try {
        raw = JSON.parse(r.source_payload || '{}')
      } catch {
        raw = {}
      }
      return {
        productId: r.product_id,
        dbId: r.db_id,
        name: r.name || '',
        systemNo: r.system_no || '',
        imei: r.imei || '',
        model: r.model || '',
        ownerName: r.owner_name || '',
        ownerPhone: r.owner_phone || '',
        brand: r.brand || '',
        activateTime: r.activate_time || '',
        raw,
      }
    })

    res.json({ vehicles, source: 'db' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/kajea/os/parking-report', async (req, res) => {
  try {
    const { productId, dbId, startTime, endTime, includeTotals = '1' } = req.query
    const p = String(productId || '').trim()
    const d = String(dbId || '').trim()
    const start = String(startTime || '').trim()
    const end = String(endTime || '').trim()

    if (!p || !d || !start || !end) {
      return res.status(400).json({ error: 'productId, dbId, startTime, endTime are required' })
    }

    const rows = db.prepare(`
      SELECT *
      FROM oversea_parking_records
      WHERE product_id = ?
        AND db_id = ?
        AND COALESCE(start_time, '') >= ?
        AND COALESCE(start_time, '') <= ?
      ORDER BY COALESCE(start_time, ''), id
    `).all(p, d, start, end)

    const records = rows
      .map((r) => {
        let raw = {}
        try {
          raw = JSON.parse(r.source_payload || '{}')
        } catch {
          raw = {}
        }
        const isTotalCount = String(raw.IsTotalCount || '')
        return {
          startTime: r.start_time || '',
          endTime: r.end_time || '',
          duration: r.duration_text || '',
          address: r.park_address || '',
          productId: r.product_id || '',
          plateNo: r.plate_no || '',
          day: r.parking_day || '',
          parkCoordinates: r.park_coordinates || '',
          isTotalCount,
          dayResultRowCount: raw.DayResultRowCount || '',
          totalResultRowCount: raw.TotalResultRowCount || '',
          parkAddress: r.park_address || raw.ParkAddress || '',
          raw,
        }
      })
      .filter((r) => includeTotals == '1' || String(r.isTotalCount || '') != '1')

    res.json({ records, raw: { source: 'db', count: records.length } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/kajea/os/sync/run', async (req, res) => {
  try {
    const lookbackDays = Number(req.body?.lookbackDays || 3)
    const conditionType = Number(req.body?.conditionType || 1)
    const minDuration = Number(req.body?.minDuration || 0)
    const jobName = String(req.body?.jobName || 'manual_sync')
    const result = await runOverseaSync({ jobName, lookbackDays, conditionType, minDuration })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/kajea/os/sync/runs', (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 200)
    const runs = db.prepare(`
      SELECT id, job_name, started_at, ended_at, status, vehicles_seen, records_inserted, records_updated, error_message
      FROM oversea_sync_runs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit)
    res.json({ runs, inProgress: overseaSyncInProgress })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Kajea clients list endpoint
// HR Management - Wingubox Employees
app.get('/api/hr/employees', (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT 
          id,
          employee_id,
          employee_number,
          active,
          full_name,
          first_name,
          middle_name,
          last_name,
          employment_type,
          job_title,
          department,
          department_code,
          region,
          region_code,
          contract_start,
          contract_end,
          residential_status,
          gender,
          date_of_birth,
          id_no,
          pin,
          telephone,
          official_email,
          personal_email,
          address_1,
          address_2,
          city,
          state_province_county,
          country,
          postal_code,
          zip_code,
          created_at,
          updated_at
        FROM wingubox_employees
        ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
      `)
      .all()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/kajea/clients', (req, res) => {
  try {
    const clients = []
    const gpsDeviceAgg = new Map()
    const overseaDeviceAgg = new Map()
    
    // Precompute device aggregates for GPSIoT clients
    try {
      const rows = db.prepare(`
        SELECT client_id, COUNT(*) AS devices, COUNT(DISTINCT make) AS vehicleTypes
        FROM Whitelabel_devices
        GROUP BY client_id
      `).all()
      rows.forEach((row) => {
        gpsDeviceAgg.set(row.client_id, {
          devices: Number(row.devices || 0),
          vehicleTypes: Number(row.vehicleTypes || 0),
        })
      })
    } catch (e) {
      console.warn('[Kajea Clients] Error aggregating Whitelabel_devices:', e.message)
    }
    
    // Precompute device aggregates for Oversea owners
    try {
      const rows = db.prepare(`
        SELECT owner_name, COUNT(*) AS devices, COUNT(DISTINCT brand) AS vehicleTypes, MAX(activate_time) AS lastActivate
        FROM oversea_vehicles
        WHERE owner_name IS NOT NULL AND owner_name != ''
        GROUP BY owner_name
      `).all()
      rows.forEach((row) => {
        overseaDeviceAgg.set(row.owner_name, {
          devices: Number(row.devices || 0),
          vehicleTypes: Number(row.vehicleTypes || 0),
          lastActivate: row.lastActivate || null,
        })
      })
    } catch (e) {
      console.warn('[Kajea Clients] Error aggregating oversea_vehicles:', e.message)
    }
    
    // Get clients from white_label table
    try {
      const whiteLabelClients = db.prepare('SELECT client_id, company_name, reseller_name FROM white_label ORDER BY company_name').all()
      whiteLabelClients.forEach(row => {
        const agg = gpsDeviceAgg.get(row.client_id) || { devices: 0, vehicleTypes: 0 }
        clients.push({
          id: row.client_id,
          name: row.company_name || 'Unknown',
          source: 'GPSIoT',
          reseller: row.reseller_name || '',
          devices: agg.devices,
          vehicleTypes: agg.vehicleTypes,
          lastActivate: null,
        })
      })
    } catch (e) {
      console.warn('[Kajea Clients] white_label table not found or error:', e.message)
    }
    
    // Get unique owners from oversea_vehicles table
    try {
      const overseaOwners = db.prepare("SELECT DISTINCT owner_name FROM oversea_vehicles WHERE owner_name IS NOT NULL AND owner_name != '' ORDER BY owner_name").all()
      overseaOwners.forEach(row => {
        const agg = overseaDeviceAgg.get(row.owner_name) || { devices: 0, vehicleTypes: 0, lastActivate: null }
        clients.push({
          id: `oversea_${row.owner_name}`,
          name: row.owner_name,
          source: 'Oversea',
          reseller: '',
          devices: agg.devices,
          vehicleTypes: agg.vehicleTypes,
          lastActivate: agg.lastActivate,
        })
      })
    } catch (e) {
      console.warn('[Kajea Clients] oversea_vehicles table not found or error:', e.message)
    }
    
    // Sort by name
    clients.sort((a, b) => a.name.localeCompare(b.name))
    
    res.json(clients)
  } catch (e) {
    console.error('[Kajea Clients] Unexpected error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Toggle maintenance (superuser only)
app.post('/api/system/maintenance', (req, res) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const isSuperuser = String(req.authUser.role || '').toLowerCase() === 'superuser'
    if (!isSuperuser) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const { enabled } = req.body || {}
    const flag = enabled ? '1' : '0'
    setSetting('maintenance_mode', flag)
    res.json({ maintenance: flag === '1' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Set up cron job to run PAR snapshot every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  console.log(`[CRON] Running scheduled PAR snapshot (every 30 min) at ${new Date().toISOString()}`)
  try {
    await executePARSnapshot()
    console.log(`[CRON] PAR snapshot completed successfully`)
  } catch (e) {
    console.error(`[CRON] PAR snapshot failed:`, e.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Every 10 minutes: run ingestion without borrowers (fast refresh)
cron.schedule('*/10 * * * *', () => {
  console.log(`[CRON] Running scheduled data refresh (no borrowers) at ${new Date().toISOString()}`)
  const env = {
    ...process.env,
    SKIP_BORROWERS: '1',
  }
  const proc = spawn('npm run ingest:disbursements', [], { cwd: process.cwd(), env, shell: true })
  proc.stdout.on('data', (chunk) => console.log(`[DATA-CRON-OUT] ${chunk.toString().trimEnd()}`))
  proc.stderr.on('data', (chunk) => console.error(`[DATA-CRON-ERR] ${chunk.toString().trimEnd()}`))
  proc.on('close', (code) => {
    console.log(`[CRON] Data refresh completed with code ${code}`)
    updateDataRefreshTime()
    events.emit('data_updated')
  })
  proc.on('error', (err) => console.error('[CRON] Data refresh failed to start:', err.message))
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

function creditScoresEmptyOrMissing(tableName) {
  try {
    const row = dbRW.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get()
    return !row || !row.c || Number(row.c) <= 0
  } catch {
    return true
  }
}

async function refreshCreditScoresJob() {
  try {
    ensureCreditIndexes()
    const zidishaCoreProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']

    const bodaEmpty = creditScoresEmptyOrMissing('credit_scores_boda')
    const zidishaEmpty = creditScoresEmptyOrMissing('credit_scores_zidisha')

    if (bodaEmpty) {
      console.log('[CRON] Credit scores (boda) empty/missing → refreshing now')
    }
    if (zidishaEmpty) {
      console.log('[CRON] Credit scores (zidisha) empty/missing → refreshing now')
    }

    // Always refresh on schedule; empty tables just get an extra startup refresh (below).
    const boda = refreshCreditScoresForProduct('boda', { scopeProducts: ['Zidisha Boda'] })
    const zidisha = refreshCreditScoresForProduct('zidisha', { scopeProducts: zidishaCoreProducts })
    console.log('[CRON] Credit scores refresh complete:', { boda: boda.rows, zidisha: zidisha.rows })
  } catch (e) {
    console.error('[CRON] Credit scores refresh failed:', e.message)
  }
}

// Every 6 hours: refresh credit score tables (fast dashboard reads)
cron.schedule('0 */6 * * *', async () => {
  console.log(`[CRON] Running scheduled credit scores refresh (6-hourly) at ${new Date().toISOString()}`)
  await refreshCreditScoresJob()
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Startup: if credit score tables are empty/missing, refresh immediately (one-off)
setTimeout(() => {
  try {
    if (creditScoresEmptyOrMissing('credit_scores_boda') || creditScoresEmptyOrMissing('credit_scores_zidisha')) {
      console.log('[CRON] Startup credit scores refresh (tables empty/missing)')
      refreshCreditScoresJob()
    }
  } catch (e) {
    console.warn('[CRON] Startup credit scores refresh skipped:', e.message)
  }
}, 15000)

// Daily SMS: Top-up qualifiers (Zidisha Boda) at 07:05 and 13:05 Nairobi time
cron.schedule('5 7 * * *', async () => {
  console.log(`[CRON] Running TopUp SMS job (07:05) at ${new Date().toISOString()}`)
  try {
    const result = await runBodaTopUpSmsJob('07:05')
    console.log('[CRON] TopUp SMS job (07:05) result:', result)
  } catch (e) {
    console.error('[CRON] TopUp SMS job (07:05) failed:', e.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

cron.schedule('5 13 * * *', async () => {
  console.log(`[CRON] Running TopUp SMS job (13:05) at ${new Date().toISOString()}`)
  try {
    const result = await runBodaTopUpSmsJob('13:05')
    console.log('[CRON] TopUp SMS job (13:05) result:', result)
  } catch (e) {
    console.error('[CRON] TopUp SMS job (13:05) failed:', e.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Daily SMS: Collection arrears (overdue schedule) at 07:05 and 21:05 Nairobi time
cron.schedule('5 7 * * *', async () => {
  console.log(`[CRON] Running Collection Arrears SMS job (07:05) at ${new Date().toISOString()}`)
  try {
    const result = await runBodaCollectionArrearsSmsJob('07:05')
    console.log('[CRON] Collection Arrears SMS job (07:05) result:', result)
  } catch (e) {
    console.error('[CRON] Collection Arrears SMS job (07:05) failed:', e.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

cron.schedule('5 21 * * *', async () => {
  console.log(`[CRON] Running Collection Arrears SMS job (21:05) at ${new Date().toISOString()}`)
  try {
    const result = await runBodaCollectionArrearsSmsJob('21:05')
    console.log('[CRON] Collection Arrears SMS job (21:05) result:', result)
  } catch (e) {
    console.error('[CRON] Collection Arrears SMS job (21:05) failed:', e.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Daily borrowers ingestion at 00:00 (Africa/Nairobi) - runs borrowers only
cron.schedule('0 0 * * *', () => {
  console.log(`[CRON] Running scheduled borrowers ingestion at ${new Date().toISOString()}`)
  const env = {
    ...process.env,
    SKIP_DISBURSEMENTS: '1',
    SKIP_COLLECTIONS: '1',
    SKIP_ZIDISHA: '1',
    SKIP_BORROWERS: '0',
  }
  const proc = spawn('node', ['scripts/fetch_disbursments.mjs'], { cwd: process.cwd(), env, shell: true })
  proc.stdout.on('data', (chunk) => {
    console.log(`[BORROWERS-CRON-OUT] ${chunk.toString().trimEnd()}`)
  })
  proc.stderr.on('data', (chunk) => {
    console.error(`[BORROWERS-CRON-ERR] ${chunk.toString().trimEnd()}`)
  })
  proc.on('close', (code) => {
    console.log(`[CRON] Borrowers ingestion completed with code ${code}`)
    updateDataRefreshTime()
    events.emit('data_updated')
  })
  proc.on('error', (err) => {
    console.error('[CRON] Borrowers ingestion failed to start:', err.message)
  })
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Daily at midnight: fetch collectors from Loandisk for all active branches
cron.schedule('0 0 * * *', async () => {
  console.log(`[CRON] Running scheduled collectors fetch at ${new Date().toISOString()}`)
  try {
    const result = await fetchAndSaveCollectors()
    console.log(`[CRON] Collectors fetch completed: ${result.branchesProcessed} branches, ${result.totalFetched} fetched, ${result.totalSaved} saved`)
    if (result.errors && result.errors.length > 0) {
      console.warn(`[CRON] Collectors fetch had ${result.errors.length} errors:`, result.errors)
    }
  } catch (e) {
    console.error(`[CRON] Collectors fetch failed:`, e.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Daily at 23:00 Nairobi: sync Oversea vehicles + parking incrementally
cron.schedule('0 23 * * *', async () => {
  console.log(`[CRON] Running scheduled Oversea parking sync at ${new Date().toISOString()}`)
  try {
    const result = await runOverseaSync({ jobName: 'nightly_incremental', lookbackDays: 3, conditionType: 1, minDuration: 0 })
    console.log(`[CRON] Oversea parking sync completed: vehicles=${result.vehiclesSeen}, inserted=${result.recordsInserted}`)
    events.emit('kajea_data_updated')
  } catch (err) {
    console.error('[CRON] Oversea parking sync failed:', err.message)
  }
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Every 30 minutes: fetch GPSIoT clients and assets
cron.schedule('*/30 * * * *', () => {
  console.log(`[CRON] Running scheduled GPSIoT clients/assets fetch at ${new Date().toISOString()}`)
  const proc = spawn('node', ['scripts/fetch_gpsiot_clients.mjs'], { cwd: process.cwd(), shell: true })
  proc.stdout.on('data', (chunk) => {
    console.log(`[GPSIOT-CRON-OUT] ${chunk.toString().trimEnd()}`)
  })
  proc.stderr.on('data', (chunk) => {
    console.error(`[GPSIOT-CRON-ERR] ${chunk.toString().trimEnd()}`)
  })
  proc.on('close', (code) => {
    console.log(`[CRON] GPSIoT clients/assets fetch completed with code ${code}`)
    events.emit('kajea_data_updated')
  })
  proc.on('error', (err) => {
    console.error('[CRON] GPSIoT clients/assets fetch failed to start:', err.message)
  })
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Cron job: Fetch Wingubox employees every 30 minutes
cron.schedule('*/30 * * * *', () => {
  console.log('[CRON] Starting Wingubox employees fetch...')
  const proc = spawn('node', ['scripts/fetch_wingubox_employees.mjs'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  })
  proc.on('close', (code) => {
    console.log(`[CRON] Wingubox employees fetch completed with code ${code}`)
  })
  proc.on('error', (err) => {
    console.error('[CRON] Wingubox employees fetch failed to start:', err.message)
  })
}, {
  scheduled: true,
  timezone: 'Africa/Nairobi'
})

// Serve static files in production (React build) - MUST be after all API routes
if (isProduction) {
  const distPath = join(__dirname, 'dist')
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    console.log('Serving static files from:', distPath)
    
    // Serve index.html for all non-API routes (SPA routing)
    // Use app.use() instead of app.get('*') for Express 5 compatibility
    app.use((req, res, next) => {
      // Skip API routes
      if (req.path.startsWith('/api/')) {
        return next()
      }
      // Serve index.html for all other routes (SPA fallback)
      res.sendFile(join(distPath, 'index.html'))
    })
  } else {
    console.warn('Production mode enabled but dist/ folder not found. Run "npm run build" first.')
  }
}

setTimeout(() => {
  ensureInitialOverseaBackfill()
}, 15000)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`)
  if (isProduction) {
    console.log(`Production mode: Serving app at http://localhost:${PORT}`)
  } else {
    console.log(`Development mode: API at http://localhost:${PORT}`)
    console.log(`Frontend dev server should run separately on port 5173`)
  }
})
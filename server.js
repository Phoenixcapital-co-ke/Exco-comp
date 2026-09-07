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
import {
  ensureLoandiskLoanTableColumns,
  insertLoandiskLoanRow,
  parseLoandiskLoanRecord,
  snapshotRowFromLoan,
  LOANDISK_LOAN_DB_COLUMNS,
  LOANDISK_LOAN_ROW_SELECT,
} from './lib/loandiskLoanSchema.mjs'
import { logLogin, logLogout, logPageView, logAction, logLoginFailed, logError, setActivityDb } from './lib/telegramLogger.mjs'
import { initUserActivityTable } from './lib/userActivity.mjs'
import { startTelegramBot } from './lib/telegramBot.mjs'
import { renderDailyParReportHTML } from './src/reports/dailyParReportTemplate.js'
import { renderWeeklyParReportHTML } from './src/reports/weeklyParReportTemplate.js'
import { renderDailyDisbursementReportHTML } from './src/reports/dailyDisbursementReportTemplate.js'

const LOANDISK_LOAN_SELECT_SQL = LOANDISK_LOAN_ROW_SELECT.join(', ')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Spawn a node script without opening a Windows console window (PM2/IIS-safe). */
function spawnNodeScript(scriptRelativePath, { args = [], env = process.env, cwd = process.cwd() } = {}) {
  return spawn(process.execPath, [scriptRelativePath, ...args], {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
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
try {
  dbRW.pragma('journal_mode = WAL')
  db.pragma('journal_mode = WAL')
} catch {
  // ignore if WAL unavailable
}
dbRW.pragma('busy_timeout = 60000')
db.pragma('busy_timeout = 30000')

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
for (const col of ['par_30', 'par_60', 'par_90', 'par_90_plus']) {
  try {
    dbRW.prepare(`ALTER TABLE PAR ADD COLUMN ${col} REAL`).run();
  } catch (e) {
    // already exists
  }
}
// Create tables for branch-level loan data
// Store full loan records as JSON with branch_code and timestamp
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS Open_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_code TEXT NOT NULL,
    time TEXT NOT NULL
  )
`).run();
dbRW.prepare(`
  CREATE TABLE IF NOT EXISTS Past_Missed_repayment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_code TEXT NOT NULL,
    time TEXT NOT NULL
  )
`).run();
ensureLoandiskLoanTableColumns(dbRW, 'Open_loans')
ensureLoandiskLoanTableColumns(dbRW, 'Past_Missed_repayment')
// Drop loan_data only via scripts/drop_loandisk_loan_data_column.mjs (not on every boot — blocks listen on large DBs).
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
for (const col of ['par_30', 'par_60', 'par_90', 'par_90_plus']) {
  try {
    dbRW.prepare(`ALTER TABLE PAR_Borrower_Access_History ADD COLUMN ${col} REAL DEFAULT 0`).run();
  } catch (e) {
    // already exists
  }
}
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

try {
  initUserActivityTable(dbRW)
  setActivityDb(dbRW)
} catch (e) {
  console.warn('User_Activity_Log init:', e.message)
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

const MAINTENANCE_MESSAGE_KEY = 'maintenance_display_message'
const DEFAULT_MAINTENANCE_MESSAGE = 'A Fatal Exception 0D has occurred on 098B:00000218'

const getMaintenanceDisplayMessage = () => {
  const raw = getSetting(MAINTENANCE_MESSAGE_KEY, DEFAULT_MAINTENANCE_MESSAGE)
  const trimmed = String(raw || '').trim()
  return trimmed || DEFAULT_MAINTENANCE_MESSAGE
}

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

/** Kenyan mobile MSISDN: 2547XXXXXXXX only (rejects landlines like 25411…). */
function normalizeKenyanPhoneStrict(phone) {
  const p = normalizeKenyanPhone(phone)
  return /^2547\d{8}$/.test(p) ? p : ''
}

/** Product scope for collection arrears SMS (comma-separated; use * or all for every product). */
function getCollectionArrearsProductFilter(alias = '') {
  const raw = String(process.env.COLLECTION_ARREARS_SMS_PRODUCTS || 'Zidisha Boda').trim()
  const col = alias
    ? `LOWER(COALESCE(TRIM(${alias}."Product Name"), ''))`
    : `LOWER(COALESCE(TRIM("Product Name"), ''))`
  if (!raw || raw === '*' || raw.toLowerCase() === 'all') {
    return { clause: '', params: [] }
  }
  const products = raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)
  if (!products.length) return { clause: '', params: [] }
  return {
    clause: ` AND ${col} IN (${products.map(() => '?').join(', ')}) `,
    params: products,
  }
}

const COLLECTION_ARREARS_MIN_DAYS_PRODUCTS = ['advans emergency loan', 'salary advans', 'unsecured loans']

/**
 * Clients eligible for collection arrears SMS.
 * Amount = sum(Principal Overdue Derived) from zidisha_data (live Musoni loan snapshot),
 * not SUM(Total Outstanding) on overdue schedule rows (stale export + interest/penalties inflate arrears).
 */
function queryCollectionArrearsSmsClients(todayKey, { orderByAmount = false, limit = null } = {}) {
  const productFilter = getCollectionArrearsProductFilter('z')
  const minPh = COLLECTION_ARREARS_MIN_DAYS_PRODUCTS.map(() => '?').join(', ')
  let sql = `
    SELECT
      TRIM(z."Client Id") AS clientId,
      TRIM(z."Client Name") AS clientName,
      TRIM(z."Phone Number") AS phone,
      SUM(CAST(z."Principal Overdue Derived" AS REAL)) AS totalOutstanding
    FROM zidisha_data z
    WHERE CAST(z."Principal Overdue Derived" AS REAL) > 0
      AND CAST(z."Total Outstanding Derived" AS REAL) > 1
      AND TRIM(COALESCE(z."Loan Status Id", '')) NOT IN ('600', '700')
      ${productFilter.clause}
      AND (
        LOWER(COALESCE(TRIM(z."Product Name"), '')) NOT IN (${minPh})
        OR EXISTS (
          SELECT 1 FROM boda_Schedule s
          WHERE TRIM(s."Loan Id") = TRIM(z."Loan ID")
            AND date(s."Due Date") < date(?, '-15 day')
            AND COALESCE(CAST(REPLACE(s."Total Outstanding", ',', '') AS REAL), 0) > 0
        )
      )
    GROUP BY TRIM(z."Client Id"), TRIM(z."Client Name"), TRIM(z."Phone Number")
    HAVING totalOutstanding > 0`
  if (orderByAmount) sql += ' ORDER BY totalOutstanding DESC'
  if (limit != null) sql += ' LIMIT ?'

  const params = [...productFilter.params, ...COLLECTION_ARREARS_MIN_DAYS_PRODUCTS, todayKey]
  if (limit != null) params.push(limit)
  return dbRW.prepare(sql).all(...params)
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

  // Zidisha Boda top-up only (credit_scores_boda). Gold/Silver + principal paid >= minPctSafe.
  const topUpSelectSql = `SELECT
           TRIM(client_id) AS clientId,
           TRIM(client_name) AS name,
           TRIM(phone) AS phone,
           CAST(current_principal_amount AS REAL) AS principalAmount,
           CAST(current_principal_outstanding AS REAL) AS principalOutstanding,
           TRIM(band) AS band
         FROM credit_scores_boda
         WHERE band IN ('Gold', 'Silver')`
  let recipients = []
  try {
    recipients = dbRW.prepare(topUpSelectSql).all()
  } catch (e) {
    // If tables are missing/empty, try a refresh once and re-read
    try {
      console.warn('[SMS] credit_scores_boda missing; attempting refresh:', e.message)
      ensureCreditIndexes()
      refreshCreditScoresForProduct('boda', { scopeProducts: ['Zidisha Boda'] })
      recipients = dbRW.prepare(topUpSelectSql).all()
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
    const phone = normalizeKenyanPhoneStrict(r.phone)
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

  let rows = []
  try {
    rows = queryCollectionArrearsSmsClients(todayKey)
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

    // Dedupe once per client per calendar day (07:05 and 21:05 share the same cap)
    const exists = dbRW
      .prepare(
        `SELECT 1 FROM Collection_Arrears_SMS_Log
         WHERE send_date = ? AND client_id = ? AND status IN ('sent', 'skipped') LIMIT 1`,
      )
      .get(sendDate, clientId)
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

  console.log('[SMS] Collection arrears job done:', {
    sendDate,
    slot: slotNorm,
    products: String(process.env.COLLECTION_ARREARS_SMS_PRODUCTS || 'Zidisha Boda'),
    attempted,
    sent,
    skipped,
    errors,
  })
  return { sendDate, slot: slotNorm, attempted, sent, skipped, errors }
}

function buildBodaCollectionArrearsPreview({ asOfDate, slot, limit = 200, includeAlreadySent = false } = {}) {
  const sendDate = String(asOfDate || getNairobiDateKey()).slice(0, 10)
  const slotNorm = String(slot || '07:05').trim() || '07:05'
  const limitSafe = Math.min(Math.max(Number(limit) || 200, 1), 1000)

  const templateRaw = String(process.env.COLLECTION_ARREARS_SMS_TEMPLATE || '').trim()
  const template =
    templateRaw ||
    'Dear ${firstName}, you are in arrears of ${amount}. Please pay up your dues to stay active.'

  const rows = queryCollectionArrearsSmsClients(sendDate, { orderByAmount: true, limit: limitSafe })

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
      .prepare(
        `SELECT 1 FROM Collection_Arrears_SMS_Log
         WHERE send_date = ? AND client_id = ? AND status IN ('sent', 'skipped') LIMIT 1`,
      )
      .get(sendDate, clientId)

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

  return {
    sendDate,
    slot: slotNorm,
    count: out.length,
    products: String(process.env.COLLECTION_ARREARS_SMS_PRODUCTS || 'Zidisha Boda'),
    items: out,
  }
}

/** Admin report: SMS log history, invalid numbers, and next-run eligibility counts. */
function buildSmsAuditReport({ days = 30 } = {}) {
  const daysSafe = Math.min(Math.max(Number(days) || 30, 7), 90)
  const report = {
    generatedAt: new Date().toISOString(),
    days: daysSafe,
    onfonConfigured: getOnfonConfigured(),
    config: {
      topUpMinPercentPaid: Number(process.env.TOPUP_MIN_PERCENT_PAID || 70),
      collectionArrearsProducts: String(process.env.COLLECTION_ARREARS_SMS_PRODUCTS || 'Zidisha Boda'),
    },
    tables: {},
    nextRunEstimates: {},
  }

  const tableExists = (name) => {
    try {
      return !!dbRW.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)
    } catch {
      return false
    }
  }

  const summarizeLog = (tableName) => {
    if (!tableExists(tableName)) {
      return { exists: false, dailySent: [], byDateSlotStatus: [], byStatus: [], invalidSentPhones: [], skippedReasons: [] }
    }
    const dailySent = dbRW
      .prepare(
        `SELECT send_date AS sendDate, COUNT(*) AS sent
         FROM ${tableName} WHERE status = 'sent'
           AND send_date >= date('now', ?)
         GROUP BY send_date ORDER BY send_date DESC`,
      )
      .all(`-${daysSafe} days`)

    const byDateSlotStatus = dbRW
      .prepare(
        `SELECT send_date AS sendDate, slot, status, COUNT(*) AS n
         FROM ${tableName}
         WHERE send_date >= date('now', ?)
         GROUP BY send_date, slot, status
         ORDER BY send_date DESC, slot, status`,
      )
      .all(`-${daysSafe} days`)

    const byStatus = dbRW
      .prepare(
        `SELECT status, COUNT(*) AS n FROM ${tableName}
         WHERE send_date >= date('now', ?) GROUP BY status ORDER BY n DESC`,
      )
      .all(`-${daysSafe} days`)

    const sentPhones = dbRW
      .prepare(
        `SELECT phone, COUNT(*) AS n FROM ${tableName}
         WHERE status = 'sent' AND send_date >= date('now', ?)
         GROUP BY phone`,
      )
      .all(`-${daysSafe} days`)

    const invalidSentPhones = []
    let invalidSentCount = 0
    for (const r of sentPhones) {
      const norm = normalizeKenyanPhoneStrict(r.phone)
      if (!norm) {
        invalidSentCount += r.n
        if (invalidSentPhones.length < 25) {
          invalidSentPhones.push({ phone: r.phone, count: r.n })
        }
      }
    }

    const skippedReasons = dbRW
      .prepare(
        `SELECT COALESCE(response, status) AS reason, COUNT(*) AS n
         FROM ${tableName}
         WHERE status = 'skipped' AND send_date >= date('now', ?)
         GROUP BY reason ORDER BY n DESC LIMIT 15`,
      )
      .all(`-${daysSafe} days`)

    return {
      exists: true,
      dailySent,
      byDateSlotStatus,
      byStatus,
      invalidSentCount,
      invalidSentPhones,
      skippedReasons,
    }
  }

  report.tables.topUp = summarizeLog('TopUp_SMS_Log')
  report.tables.collectionArrears = summarizeLog('Collection_Arrears_SMS_Log')

  try {
    const gs = dbRW.prepare(`SELECT COUNT(*) AS n FROM credit_scores_boda WHERE band IN ('Gold','Silver')`).get().n
    let invalidPool = 0
    const phones = dbRW.prepare(`SELECT phone FROM credit_scores_boda WHERE band IN ('Gold','Silver')`).all()
    for (const r of phones) {
      if (!normalizeKenyanPhoneStrict(r.phone)) invalidPool += 1
    }
    report.nextRunEstimates.topUp = {
      goldSilverPool: gs,
      invalidPhonesInPool: invalidPool,
      note: 'Actual sends also require principal paid >= TOPUP_MIN_PERCENT_PAID and per-day slot dedupe',
    }
  } catch (e) {
    report.nextRunEstimates.topUp = { error: e.message }
  }

  try {
    const preview = buildBodaCollectionArrearsPreview({ limit: 5000, includeAlreadySent: false })
    const withValidPhone = preview.items.filter((i) => normalizeKenyanPhoneStrict(i.phone)).length
    const alreadySentToday = preview.items.filter((i) => i.alreadySent).length
    report.nextRunEstimates.collectionArrears = {
      eligibleClients: preview.count,
      withValidMobile: withValidPhone,
      alreadySentToday: alreadySentToday,
      wouldAttemptNew: Math.max(0, withValidPhone - alreadySentToday),
      products: preview.products,
    }
  } catch (e) {
    report.nextRunEstimates.collectionArrears = { error: e.message }
  }

  return report
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

/** Principal balance from a Loandisk advanced_search_loans row. */
function parseParLoanPrincipal(loan) {
  const rawPrincipal =
    loan?.principal_balance_amount ??
    loan?.PrincipalBalanceAmount ??
    loan?.['principal_balance_amount'] ??
    loan?.['Principal Balance Amount'] ??
    loan?.['Principal Balance'] ??
    0
  return typeof rawPrincipal === 'number'
    ? rawPrincipal
    : Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0
}

/** Days past due from Loandisk loan row or flattened DB columns. */
function parseParLoanDaysPastDue(loan, row) {
  const candidates = [
    row?.days_past_due,
    loan?.days_past_due,
    loan?.DaysPast,
    loan?.days_past,
    loan?.['Days Past Due'],
    loan?.['Days Past Maturity'],
    loan?.days_past_maturity,
    loan?.daysPastMaturity,
  ]
  for (const c of candidates) {
    if (c == null || c === '') continue
    const n = Number(String(c).replace(/[^\d.-]/g, ''))
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n))
  }
  return null
}

/**
 * PAR aging bucket from days_past_due on Past_Missed_repayment rows:
 * PAR 30 = 1–30, PAR 60 = 31–60, PAR 90 = 61–90, PAR 90+ = 91+.
 * Returns null if days missing or 0 (loan still counts in total PAR).
 */
function parAgingBucketFromDays(days) {
  if (days == null || days < 1) return null
  if (days <= 30) return 30
  if (days <= 60) return 60
  if (days <= 90) return 90
  return '90plus'
}

function createParTotals() {
  return {
    openLoans: 0,
    pastMissed: 0,
    par30: 0,
    par60: 0,
    par90: 0,
    par90Plus: 0,
  }
}

function addParOpenLoan(totals, principal) {
  const p = Number(principal) || 0
  if (p > 0) totals.openLoans += p
}

function addParDelinquentLoan(totals, loan, row) {
  const p = parseParLoanPrincipal(loan)
  if (p <= 0) return
  // Total PAR: all past-missed / arrears / past-maturity (no days_past_due filter)
  totals.pastMissed += p
  const days = parseParLoanDaysPastDue(loan, row)
  const bucket = parAgingBucketFromDays(days)
  if (bucket === 30) totals.par30 += p
  else if (bucket === 60) totals.par60 += p
  else if (bucket === 90) totals.par90 += p
  else if (bucket === '90plus') totals.par90Plus += p
}

function finalizeParTotals(totals) {
  const denom = totals.openLoans > 0 ? totals.openLoans : 0
  const pct = (n) => (denom > 0 ? (n / denom) * 100 : 0)
  return {
    openLoans: totals.openLoans,
    pastMissed: totals.pastMissed,
    par30: totals.par30,
    par60: totals.par60,
    par90: totals.par90,
    par90Plus: totals.par90Plus,
    parRate: pct(totals.pastMissed),
    par30Rate: pct(totals.par30),
    par60Rate: pct(totals.par60),
    par90Rate: pct(totals.par90),
    par90PlusRate: pct(totals.par90Plus),
  }
}

/** Aggregate PAR totals + per-branch from stored snapshot loan rows. */
function aggregateParFromSnapshotLoanRows(openLoansRows, pastMissedRows) {
  const global = createParTotals()
  const byBranch = new Map()

  const branchTotals = (code) => {
    const key = String(code || '').trim()
    if (!byBranch.has(key)) byBranch.set(key, createParTotals())
    return byBranch.get(key)
  }

  for (const row of openLoansRows || []) {
    try {
      const loan = parseLoandiskLoanRecord(row)
      if (!loan) continue
      const p = parseParLoanPrincipal(loan)
      addParOpenLoan(global, p)
      addParOpenLoan(branchTotals(row.branch_code), p)
    } catch {
      continue
    }
  }

  for (const row of pastMissedRows || []) {
    try {
      const loan = parseLoandiskLoanRecord(row)
      if (!loan) continue
      addParDelinquentLoan(global, loan, row)
      addParDelinquentLoan(branchTotals(row.branch_code), loan, row)
    } catch {
      continue
    }
  }

  const branches = {}
  for (const [code, t] of byBranch.entries()) {
    branches[code] = finalizeParTotals(t)
  }
  return { global: finalizeParTotals(global), branches }
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

// Monthly sales-person disbursement targets (Logbook)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Sales_Person_Targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sales_person TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Kenya',
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    disbursement_target REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sales_person, country, month, year)
  );
`)

dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Sales_Persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Kenya',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, country)
  );
`)

// Seed Kenya sales-person roster (official Loandisk dropdown list = active; all others inactive)
try {
  const seedKenyaSales = [
    'VICTOR KEDOGO',
    'linet Nyanya',
    'TECKLA OWINO',
    'EDWARD MAGERO',
    'LAVYNE ANYANGO',
    'MAGDALINE AMOLO',
    'Susan Kasoo',
    'JARED OMAE',
    'QUINTER ATIENO',
    'Samson Namale',
    'NORAH ANGOTE',
    'anne nekesa',
    'SILAS WANJALA',
    'Allan Kimutai',
    'Mary Muthoni',
    'Richard Litunya',
    'AMINA MUMBUA',
    'Linet Kibuga',
    'LUCY AKINYI',
    'MARTIN KURUI',
    'VIOLET MORAA',
    'LEONIDA GESARE',
    'KELLY ONYANGO',
    'Vincent Odede',
    'Judy Wangu',
    'Paul Wanjala',
    'Eric Antony Munene',
    'Daniel Omondi',
    'BRENDA KAWIRA',
    'Vivian Kirui',
    'Stephen Muthui',
    'MOUREEN NYONGESA',
    'Dennis Ndegwa',
    'Pius Muroki',
    'Kenneth Ndiba',
  ]
  const upsertActive = dbRW.prepare(`
    INSERT INTO Logbook_Sales_Persons (name, country, active)
    VALUES (?, 'Kenya', 1)
    ON CONFLICT(name, country) DO UPDATE SET
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `)
  const seedTx = dbRW.transaction((names) => {
    // Only the official dropdown list stays active
    dbRW.prepare(`UPDATE Logbook_Sales_Persons SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE country = 'Kenya'`).run()
    for (const n of names) upsertActive.run(n)
  })
  seedTx(seedKenyaSales)
} catch (e) {
  console.warn('[Sales Persons] Seed skipped:', e.message)
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

// Recurring vendor / SaaS payment obligations (Data → Payments)
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Payment_Obligations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    due_day INTEGER,
    amount_display TEXT,
    amount_value REAL,
    currency TEXT,
    notes TEXT,
    reminder_days_before INTEGER NOT NULL DEFAULT 3,
    reminder_email TEXT NOT NULL DEFAULT 'gregory@phoenixcapital.co.ke',
    active INTEGER NOT NULL DEFAULT 1,
    last_reminded_period TEXT,
    last_reminded_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`)

dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Payment_Obligation_Months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obligation_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(obligation_id, year, month),
    FOREIGN KEY (obligation_id) REFERENCES Payment_Obligations(id) ON DELETE CASCADE
  );
`)

try {
  const paymentCount = dbRW.prepare('SELECT COUNT(*) AS c FROM Payment_Obligations').get()?.c || 0
  if (paymentCount === 0) {
    const seedPayments = [
      { name: 'Loandisk', due_day: 30, amount_display: 'Varies', amount_value: null, currency: null, notes: null },
      { name: 'Google Email - Uganda', due_day: 30, amount_display: 'Varies', amount_value: null, currency: null, notes: null },
      { name: 'Google Email - Kajea', due_day: 30, amount_display: 'Varies', amount_value: null, currency: null, notes: null },
      { name: 'Onfon USSD', due_day: null, amount_display: 'Varies', amount_value: null, currency: null, notes: 'Due day not set — add a day to enable reminders' },
      { name: 'Google Email - Kenya', due_day: 30, amount_display: 'Varies', amount_value: null, currency: null, notes: null },
      { name: 'Zoho', due_day: 25, amount_display: 'Varies', amount_value: null, currency: null, notes: null },
      { name: 'Wingubox Plus (Paid twice)', due_day: null, amount_display: null, amount_value: null, currency: null, notes: 'Paid twice; due day not set' },
      { name: 'Claude AI subscription monthly & top up', due_day: 25, amount_display: '$435', amount_value: 435, currency: 'USD', notes: null },
      { name: 'Musoni', due_day: 30, amount_display: null, amount_value: null, currency: null, notes: null },
      { name: 'Onfon', due_day: 30, amount_display: 'Varies', amount_value: null, currency: null, notes: null },
      { name: 'ChatGPT', due_day: 30, amount_display: '$20', amount_value: 20, currency: 'USD', notes: null },
      { name: 'Cursor', due_day: 30, amount_display: '$20', amount_value: 20, currency: 'USD', notes: null },
      { name: 'Quickbooks', due_day: 16, amount_display: null, amount_value: null, currency: null, notes: null },
    ]
    const insertPayment = dbRW.prepare(`
      INSERT INTO Payment_Obligations
        (name, due_day, amount_display, amount_value, currency, notes, reminder_days_before, reminder_email, active)
      VALUES
        (@name, @due_day, @amount_display, @amount_value, @currency, @notes, 3, 'gregory@phoenixcapital.co.ke', 1)
    `)
    const seedTx = dbRW.transaction((rows) => {
      for (const row of rows) insertPayment.run(row)
    })
    seedTx(seedPayments)
    console.log(`Seeded ${seedPayments.length} payment obligations`)
  }
} catch (err) {
  console.error('Unable to seed payment obligations:', err)
}

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

const sendEmail = async ({ to, cc, bcc, subject, text, html, attachments }) => {
  const from = process.env.SMTP_FROM || 'no-reply@phoenixcapitalkenya.com'
  const mailer = getMailer()
  if (!mailer) {
    console.log('[email] SMTP not configured. Would send:', { to, cc, subject, text })
    return { ok: false, skipped: true }
  }
  await mailer.sendMail({
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    text,
    html,
    attachments: attachments || undefined,
  })
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

/** Relationship Officers included in Daily PAR report (temporary fixed roster). */
const DAILY_PAR_RELATIONSHIP_OFFICERS = [
  { borrower_access_id: '23914', name: 'Edward Magero' },
  { borrower_access_id: '117924', name: 'Leonida Gesare' },
  { borrower_access_id: '40280', name: 'Anne Nekesa' },
  { borrower_access_id: '70406', name: 'Magdalene Amolo' },
  { borrower_access_id: '89478', name: 'Linet Nyanya' },
  { borrower_access_id: '77749', name: 'Richard Litunya' },
  { borrower_access_id: '39172', name: 'Samson Namale' },
  { borrower_access_id: '97555', name: 'Vincent Odede' },
  { borrower_access_id: '91476', name: 'Victor Kedogo' },
  { borrower_access_id: '117388', name: 'Linet Kabuga' },
  { borrower_access_id: '108687', name: 'Jared Omae' },
]
const DAILY_PAR_RO_IDS = new Set(DAILY_PAR_RELATIONSHIP_OFFICERS.map((o) => o.borrower_access_id))
const DAILY_PAR_RO_NAME_BY_ID = new Map(
  DAILY_PAR_RELATIONSHIP_OFFICERS.map((o) => [o.borrower_access_id, o.name]),
)

try {
  const stmt = dbRW.prepare(`
    INSERT INTO LOs (borrower_access_id, name, active)
    VALUES (@borrower_access_id, @name, 1)
    ON CONFLICT(borrower_access_id) DO UPDATE
      SET name = excluded.name,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
  `)
  const seedTx = dbRW.transaction((rows) => {
    for (const row of rows) stmt.run(row)
  })
  seedTx(DAILY_PAR_RELATIONSHIP_OFFICERS)
} catch (err) {
  console.error('Unable to ensure Daily PAR relationship officers:', err)
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
app.use(express.json({ limit: '5mb' }))
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

const ZIDISHA_CORE_PRODUCTS = [
  'Zidisha Kifaru',
  'Zidisha Nyati',
  'Zidisha Simba',
  'Zidisha Tembo',
  'Zidisha Express',
]

function aggregateMtdBranchOfficerRows(flatRows, { targetRate = 0.95 } = {}) {
  const byBranch = new Map()
  for (const r of flatRows) {
    const b = String(r.branch || '').trim() || 'Unknown'
    const bKey = b.toLowerCase()
    if (!bKey || bKey === 'unknown' || bKey === 'advans branch') continue

    const officer = String(r.officer || 'Unknown').trim() || 'Unknown'
    const expected = Number(r.expected || 0)
    const collected =
      r.collected != null
        ? Number(r.collected || 0)
        : Math.max(0, expected - Number(r.outstanding || 0))

    if (!byBranch.has(b)) {
      byBranch.set(b, { branch: b, expected: 0, outstanding: 0, collected: 0, officers: new Map() })
    }
    const branchEntry = byBranch.get(b)
    branchEntry.expected += expected
    branchEntry.collected += collected
    branchEntry.outstanding += Number(r.outstanding || 0)

    if (!branchEntry.officers.has(officer)) {
      branchEntry.officers.set(officer, { officer, expected: 0, outstanding: 0, collected: 0 })
    }
    const officerEntry = branchEntry.officers.get(officer)
    officerEntry.expected += expected
    officerEntry.collected += collected
    officerEntry.outstanding += Number(r.outstanding || 0)
  }

  return Array.from(byBranch.values())
    .map((x) => {
      const collected = Math.max(0, x.collected)
      const ratePercent = x.expected > 0 ? (collected / x.expected) * 100 : 0
      const targetGap = x.expected > 0 ? Math.max(0, targetRate * x.expected - collected) : 0
      const officers = Array.from(x.officers.values())
        .map((o) => {
          const oCollected = Math.max(0, o.collected)
          const oRate = o.expected > 0 ? (oCollected / o.expected) * 100 : 0
          return {
            officer: o.officer,
            expected: o.expected,
            outstanding: o.outstanding,
            collected: oCollected,
            ratePercent: oRate,
            targetGap: o.expected > 0 ? Math.max(0, targetRate * o.expected - oCollected) : 0,
          }
        })
        .sort((a, b) => {
          if (b.ratePercent === a.ratePercent) return b.collected - a.collected
          return b.ratePercent - a.ratePercent
        })
      return {
        branch: x.branch,
        expected: x.expected,
        outstanding: x.outstanding,
        collected,
        ratePercent,
        targetGap,
        officers,
      }
    })
    .sort((a, b) => {
      if (b.ratePercent === a.ratePercent) return b.collected - a.collected
      return b.ratePercent - a.ratePercent
    })
}

// Zidisha productivity: MTD collection by branch + loan officer (single aggregated query)
app.get('/api/zidisha/productivity/mtd-by-branch-officers', requireAuth, (req, res) => {
  try {
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    const cutoffDayRaw =
      req.query.cutoffDay != null && String(req.query.cutoffDay).trim() !== ''
        ? Number(req.query.cutoffDay)
        : null
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
    const maturity = zidishaExpectedMaturityExpr('z')

    const allowed = getAllowedZidishaBranches(req)
    const authRole = String(req.authUser?.role || '').toLowerCase()
    if (authRole === 'custom' && allowed.length === 0) {
      return res.status(403).json({ error: 'No Zidisha branch access configured for this user' })
    }

    const where = [
      `z."Product Name" COLLATE NOCASE IN (${ZIDISHA_CORE_PRODUCTS.map(() => '?').join(', ')})`,
      `z."Branch Name" COLLATE NOCASE != ?`,
      `${maturity} >= date(?)`,
      `${maturity} < date(?)`,
      `CAST(strftime('%d', ${maturity}) AS INTEGER) <= ?`,
    ]
    const params = [...ZIDISHA_CORE_PRODUCTS, 'Advans Branch', monthStart, monthEnd, cutoffDayRaw]

    if (allowed.length > 0) {
      if (branch && branch.toLowerCase() !== 'all') {
        const allowedNorm = new Set(allowed.map((b) => String(b || '').trim().toLowerCase()))
        if (!allowedNorm.has(branch.toLowerCase())) {
          return res.status(403).json({ error: 'Branch not allowed for this user' })
        }
        where.push('z."Branch Name" COLLATE NOCASE = ?')
        params.push(branch.trim())
      } else {
        where.push(`z."Branch Name" COLLATE NOCASE IN (${allowed.map(() => '?').join(', ')})`)
        params.push(...allowed.map((b) => String(b || '').trim()))
      }
    } else if (branch && branch.toLowerCase() !== 'all') {
      where.push('z."Branch Name" COLLATE NOCASE = ?')
      params.push(branch.trim())
    }

    const rows = db
      .prepare(
        `SELECT
           TRIM(z."Branch Name") AS branch,
           TRIM(COALESCE(z."Loan Officer Name", 'Unknown')) AS officer,
           COALESCE(CAST(z."Total Expected Repayment Derived" AS REAL), 0) AS expected,
           COALESCE(CAST(z."Total Repayment Derived" AS REAL), 0) AS collected
         FROM zidisha_data z
         WHERE ${where.join(' AND ')}`,
      )
      .all(...params)

    const result = aggregateMtdBranchOfficerRows(rows, { targetRate: 0.95 })
    res.json({ rows: result })
  } catch (e) {
    console.error('[Zidisha Productivity MTD API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

/** Calendar parts in Africa/Nairobi (Mon–Sun week for LO ranking lock). */
function getNairobiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: String(get('weekday') || ''),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function ymdFromParts({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDaysToYmdString(ymd, deltaDays) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/**
 * Most recent Mon–Fri productivity week, locked Fridays 20:00 Africa/Nairobi.
 * Before Fri 20:00 → prior Mon–Fri; from Fri 20:00 onward → current Mon–Fri.
 */
function getCompletedZidishaProductivityWeek(now = new Date()) {
  const p = getNairobiDateParts(now)
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }
  const dow = weekdayMap[p.weekday]
  if (dow == null) {
    throw new Error(`Unable to resolve Nairobi weekday: ${p.weekday}`)
  }
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  const todayYmd = ymdFromParts(p)
  const mondayYmd = addDaysToYmdString(todayYmd, -daysSinceMonday)
  const fridayYmd = addDaysToYmdString(mondayYmd, 4)
  const weekLocked = (dow === 5 && p.hour >= 20) || dow === 6 || dow === 0
  if (weekLocked) {
    return { monday: mondayYmd, friday: fridayYmd, lockedAt: `${fridayYmd}T20:00:00+03:00` }
  }
  return {
    monday: addDaysToYmdString(mondayYmd, -7),
    friday: addDaysToYmdString(fridayYmd, -7),
    lockedAt: `${addDaysToYmdString(fridayYmd, -7)}T20:00:00+03:00`,
  }
}

function flattenRankedOfficersFromBranches(branchRows, { targetRate = 0.95 } = {}) {
  const officers = []
  for (const branch of branchRows || []) {
    for (const o of branch.officers || []) {
      const expected = Number(o.expected || 0)
      const collected = Number(o.collected || 0)
      const ratePercent = Number(o.ratePercent || 0)
      officers.push({
        officer: o.officer,
        branch: branch.branch,
        expected,
        collected,
        ratePercent,
        targetGap: expected > 0 ? Math.max(0, targetRate * expected - collected) : 0,
      })
    }
  }
  return officers.sort((a, b) => {
    if (b.ratePercent === a.ratePercent) return b.collected - a.collected
    return b.ratePercent - a.ratePercent
  })
}

// Zidisha productivity: top LO for the most recent completed Mon–Fri week (lock Fri 20:00 EAT)
app.get('/api/zidisha/productivity/weekly-top-performer', requireAuth, (req, res) => {
  try {
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''
    const week = getCompletedZidishaProductivityWeek()
    const maturity = zidishaExpectedMaturityExpr('z')

    const allowed = getAllowedZidishaBranches(req)
    const authRole = String(req.authUser?.role || '').toLowerCase()
    if (authRole === 'custom' && allowed.length === 0) {
      return res.status(403).json({ error: 'No Zidisha branch access configured for this user' })
    }

    const where = [
      `z."Product Name" COLLATE NOCASE IN (${ZIDISHA_CORE_PRODUCTS.map(() => '?').join(', ')})`,
      `z."Branch Name" COLLATE NOCASE != ?`,
      `${maturity} >= date(?)`,
      `${maturity} <= date(?)`,
    ]
    const params = [...ZIDISHA_CORE_PRODUCTS, 'Advans Branch', week.monday, week.friday]

    if (allowed.length > 0) {
      if (branch && branch.toLowerCase() !== 'all') {
        const allowedNorm = new Set(allowed.map((b) => String(b || '').trim().toLowerCase()))
        if (!allowedNorm.has(branch.toLowerCase())) {
          return res.status(403).json({ error: 'Branch not allowed for this user' })
        }
        where.push('z."Branch Name" COLLATE NOCASE = ?')
        params.push(branch.trim())
      } else {
        where.push(`z."Branch Name" COLLATE NOCASE IN (${allowed.map(() => '?').join(', ')})`)
        params.push(...allowed.map((b) => String(b || '').trim()))
      }
    } else if (branch && branch.toLowerCase() !== 'all') {
      where.push('z."Branch Name" COLLATE NOCASE = ?')
      params.push(branch.trim())
    }

    const rows = db
      .prepare(
        `SELECT
           TRIM(z."Branch Name") AS branch,
           TRIM(COALESCE(z."Loan Officer Name", 'Unknown')) AS officer,
           COALESCE(CAST(z."Total Expected Repayment Derived" AS REAL), 0) AS expected,
           COALESCE(CAST(z."Total Repayment Derived" AS REAL), 0) AS collected
         FROM zidisha_data z
         WHERE ${where.join(' AND ')}`,
      )
      .all(...params)

    const branchRows = aggregateMtdBranchOfficerRows(rows, { targetRate: 0.95 })
    const officers = flattenRankedOfficersFromBranches(branchRows, { targetRate: 0.95 })
    const top = officers[0] || null

    res.json({
      week: {
        monday: week.monday,
        friday: week.friday,
        lockedAt: week.lockedAt,
        label: `${week.monday} → ${week.friday}`,
      },
      topPerformer: top
        ? {
            officer: top.officer,
            branch: top.branch,
            expected: top.expected,
            collected: top.collected,
            ratePercent: top.ratePercent,
            targetGap: top.targetGap,
          }
        : null,
      officers,
    })
  } catch (e) {
    console.error('[Zidisha Weekly Top Performer API] Error:', e)
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

function enumerateMonthKeys(fromMonth, toMonth) {
  const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number)
  const [toYear, toMonthNum] = toMonth.split('-').map(Number)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const out = []
  let y = fromYear
  let m = fromMonthNum
  while (y < toYear || (y === toYear && m <= toMonthNum)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push({
      key,
      year: y,
      monthNum: m,
      month: `${monthNames[m - 1]}-${y}`,
      logbook: 0,
      zidisha: 0,
      zidishaTarget: 0,
      zidishaOtc: 0,
      boda: 0,
      bodaTarget: 0,
      bodaOtc: 0,
      advans: 0,
      advansTarget: 0,
      advansOtc: 0,
      total: 0,
      totalOtc: 0,
    })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

function buildRepaymentsByMonthReport(fromMonth, toMonth) {
  const months = enumerateMonthKeys(fromMonth, toMonth)
  const byKey = new Map(months.map((row) => [row.key, { ...row }]))

  const addAmount = (key, field, amt, { otc = false } = {}) => {
    if (!byKey.has(key)) return
    const row = byKey.get(key)
    const n = Number(amt) || 0
    row[field] += n
    if (otc) row.totalOtc += n
    else row.total += n
  }

  // Logbook Kenya — Collection "Total Collected" (Logbook_collection)
  const kenyaBranches = listActiveLogbookBranchesForCountry('Kenya')
  const kenyaCodes = new Set(kenyaBranches.map((b) => String(b.code || '').trim()).filter(Boolean))
  const kenyaResolver = buildLogbookBranchResolver(kenyaBranches)
  const colRows = db.prepare('SELECT branch, repayment_collected_date, repayment_amount FROM Logbook_collection').all()
  for (const r of colRows) {
    const code = kenyaResolver.resolve(r.branch)
    if (!kenyaCodes.has(code)) continue
    const d = parseLogbookDirectorDMY(r.repayment_collected_date)
    if (!d) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    addAmount(key, 'logbook', r.repayment_amount)
  }

  const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number)
  const [toYear, toMonthNum] = toMonth.split('-').map(Number)
  const rangeStart = `${fromYear}-${String(fromMonthNum).padStart(2, '0')}-01`
  const nextAfterTo =
    toMonthNum === 12 ? `${toYear + 1}-01-01` : `${toYear}-${String(toMonthNum + 1).padStart(2, '0')}-01`

  const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']
  const advansOtcProducts = ['Salary Advans', 'Advans Emergency Loan']
  const zidishaProductSet = new Set(zidishaProducts.map((p) => p.toLowerCase()))
  const advansProductSet = new Set(advansOtcProducts.map((p) => p.toLowerCase()))

  // Zidisha / Advans / Boda Collection — Expected − Outstanding by installment due month.
  // Prefer historical schedule table when present; otherwise use current boda_Schedule.
  // Live zidisha_data maturity snapshots cannot fill past months.
  const scheduleTableExists = (name) =>
    Boolean(db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?`).get(name))

  const collectedByDueMonthSql = (tableName, productFilterSql = '') => `
    SELECT
      strftime('%Y-%m', date("Due Date")) AS monthKey,
      LOWER(TRIM(COALESCE("Product Name", ''))) AS product,
      SUM(
        COALESCE(CAST(REPLACE(COALESCE("Total Expected", '0'), ',', '') AS REAL), 0)
      ) AS expected,
      SUM(
        CASE
          WHEN COALESCE(CAST(REPLACE(COALESCE("Total Expected", '0'), ',', '') AS REAL), 0)
             > COALESCE(CAST(REPLACE(COALESCE("Total Outstanding", '0'), ',', '') AS REAL), 0)
          THEN COALESCE(CAST(REPLACE(COALESCE("Total Expected", '0'), ',', '') AS REAL), 0)
             - COALESCE(CAST(REPLACE(COALESCE("Total Outstanding", '0'), ',', '') AS REAL), 0)
          ELSE 0
        END
      ) AS collected
    FROM ${tableName}
    WHERE "Due Date" IS NOT NULL
      AND TRIM(COALESCE("Due Date", '')) <> ''
      AND date("Due Date") >= date(?)
      AND date("Due Date") < date(?)
      ${productFilterSql}
    GROUP BY monthKey, product
  `

  const applyScheduleCollected = (rows, { preferExisting = false } = {}) => {
    for (const r of rows) {
      if (!r.monthKey) continue
      const product = String(r.product || '').trim().toLowerCase()
      const amt = Number(r.collected || 0)
      let field = null
      if (product === 'zidisha boda') field = 'boda'
      else if (zidishaProductSet.has(product)) field = 'zidisha'
      else if (advansProductSet.has(product) || product.includes('advans')) field = 'advans'
      if (!field) continue
      if (preferExisting) {
        const existing = byKey.get(r.monthKey)
        if (
          existing &&
          (Number(existing[field] || 0) > 0 || Number(existing[`${field}Target`] || 0) > 0)
        ) {
          continue
        }
      }
      if (amt > 0) addAmount(r.monthKey, field, amt)
      const expected = Number(r.expected || 0)
      if (expected > 0) byKey.get(r.monthKey)[`${field}Target`] += expected
    }
  }

  const EXPECTED_VS_TABLE = 'Zidisha_Daily expected_vs_Repayed'
  if (scheduleTableExists(EXPECTED_VS_TABLE)) {
    applyScheduleCollected(
      db.prepare(collectedByDueMonthSql(`"${EXPECTED_VS_TABLE}"`)).all(rangeStart, nextAfterTo),
    )
  }
  // Fill any missing months / products from the current schedule export (always present after ingest)
  if (scheduleTableExists('boda_Schedule')) {
    applyScheduleCollected(
      db.prepare(collectedByDueMonthSql('boda_Schedule')).all(rangeStart, nextAfterTo),
      { preferExisting: true },
    )
  }

  // OTC from boda_repayments (actual Transaction Amount by Submitted On Date), split by Product Name
  const otcRows = db
    .prepare(
      `SELECT
         strftime('%Y-%m', date("Submitted On Date")) AS monthKey,
         TRIM("Product Name") AS product,
         SUM(CAST("Transaction Amount" AS REAL)) AS total
       FROM boda_repayments
       WHERE "Submitted On Date" IS NOT NULL
         AND date("Submitted On Date") >= date(?)
         AND date("Submitted On Date") < date(?)
         AND CAST("Transaction Amount" AS REAL) > 0
         AND NOT (
           COALESCE(TRIM("Product Name"), '') COLLATE NOCASE = 'Zidisha Boda'
           AND TRIM(COALESCE("Client Id", '')) = '3926'
         )
       GROUP BY monthKey, product`,
    )
    .all(rangeStart, nextAfterTo)

  for (const r of otcRows) {
    if (!r.monthKey) continue
    const product = String(r.product || '').trim().toLowerCase()
    if (product === 'zidisha boda') {
      addAmount(r.monthKey, 'bodaOtc', r.total, { otc: true })
    } else if (zidishaProductSet.has(product)) {
      addAmount(r.monthKey, 'zidishaOtc', r.total, { otc: true })
    } else if (advansProductSet.has(product) || product.includes('advans')) {
      addAmount(r.monthKey, 'advansOtc', r.total, { otc: true })
    }
  }

  return Array.from(byKey.values()).map((row) => ({
    ...row,
    logbook: Math.round(row.logbook),
    zidisha: Math.round(row.zidisha),
    zidishaTarget: Math.round(row.zidishaTarget),
    zidishaOtc: Math.round(row.zidishaOtc),
    boda: Math.round(row.boda),
    bodaTarget: Math.round(row.bodaTarget),
    bodaOtc: Math.round(row.bodaOtc),
    advans: Math.round(row.advans),
    advansTarget: Math.round(row.advansTarget),
    advansOtc: Math.round(row.advansOtc),
    total: Math.round(row.total),
    totalOtc: Math.round(row.totalOtc),
  }))
}

/** Portfolio outstanding as of latest data (point-in-time, not monthly). */
function buildPortfolioAsOfToday() {
  const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']

  // Logbook Kenya — open loan principal by branch from latest PAR snapshot
  let logbook = 0
  let logbookAsOf = null
  const logbookBranches = []
  const kenyaBranches = listActiveLogbookBranchesForCountry('Kenya')
  const kenyaCodes = new Set(kenyaBranches.map((b) => String(b.code || '').trim()).filter(Boolean))
  const kenyaResolver = buildLogbookBranchResolver(kenyaBranches)
  const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
  if (latestPar?.time && kenyaCodes.size > 0) {
    logbookAsOf = latestPar.time
    const openLoansRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(latestPar.time)
    const pastMissedRows = db
      .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`)
      .all(latestPar.time)
    const { branches: branchParMap } = aggregateParFromSnapshotLoanRows(openLoansRows, pastMissedRows)
    const totals = sumParTotalsForBranchCodes(branchParMap, kenyaCodes)
    logbook = Math.round(totals.openLoans || 0)
    for (const code of kenyaCodes) {
      const fin = branchParMap[code] || finalizeParTotals(createParTotals())
      const portfolio = Math.round(fin.openLoans || 0)
      if (portfolio <= 0) continue
      logbookBranches.push({
        branch: kenyaResolver.codeToName.get(String(code).toLowerCase()) || code,
        code,
        portfolio,
      })
    }
    logbookBranches.sort((a, b) => b.portfolio - a.portfolio)
  }

  // Zidisha — Principal Outstanding Derived by branch (core products, excl. Advans Branch)
  const zidishaBranchRows = db
    .prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         SUM(COALESCE(CAST("Principal Outstanding Derived" AS REAL), 0)) AS portfolio
       FROM zidisha_data
       WHERE "Product Name" COLLATE NOCASE IN (${zidishaProducts.map(() => '?').join(', ')})
         AND "Branch Name" COLLATE NOCASE != 'Advans Branch'
         AND COALESCE(CAST("Principal Outstanding Derived" AS REAL), 0) > 0
       GROUP BY TRIM("Branch Name")
       ORDER BY portfolio DESC`,
    )
    .all(...zidishaProducts)
  const zidishaBranches = zidishaBranchRows
    .map((r) => ({
      branch: String(r.branch || '').trim() || 'Unknown',
      portfolio: Math.round(Number(r.portfolio || 0)),
    }))
    .filter((r) => r.portfolio > 0)
  const zidisha = zidishaBranches.reduce((s, r) => s + r.portfolio, 0)

  // Boda — Principal Outstanding Derived by branch
  const bodaBranchRows = db
    .prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         SUM(COALESCE(CAST("Principal Outstanding Derived" AS REAL), 0)) AS portfolio
       FROM zidisha_data
       WHERE "Product Name" COLLATE NOCASE = 'Zidisha Boda'
         AND TRIM(COALESCE("Client Id", '')) != '3926'
         AND COALESCE(CAST("Principal Outstanding Derived" AS REAL), 0) > 0
       GROUP BY TRIM("Branch Name")
       ORDER BY portfolio DESC`,
    )
    .all()
  const bodaBranches = bodaBranchRows
    .map((r) => ({
      branch: String(r.branch || '').trim() || 'Unknown',
      portfolio: Math.round(Number(r.portfolio || 0)),
    }))
    .filter((r) => r.portfolio > 0)
  const boda = bodaBranches.reduce((s, r) => s + r.portfolio, 0)

  // Advans — typically one branch, still return branchwise for consistency
  const advansBranchRows = db
    .prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         SUM(COALESCE(CAST("Principal Outstanding Derived" AS REAL), 0)) AS portfolio
       FROM zidisha_data
       WHERE "Branch Name" COLLATE NOCASE = 'Advans Branch'
         AND COALESCE(CAST("Principal Outstanding Derived" AS REAL), 0) > 0
       GROUP BY TRIM("Branch Name")
       ORDER BY portfolio DESC`,
    )
    .all()
  const advansBranches = advansBranchRows
    .map((r) => ({
      branch: String(r.branch || '').trim() || 'Advans Branch',
      portfolio: Math.round(Number(r.portfolio || 0)),
    }))
    .filter((r) => r.portfolio > 0)
  const advans = advansBranches.reduce((s, r) => s + r.portfolio, 0)

  return {
    asOf: new Date().toISOString(),
    logbookAsOf,
    logbook,
    zidisha,
    boda,
    advans,
    total: Math.round(logbook + zidisha + boda + advans),
    byBranch: {
      logbook: logbookBranches,
      zidisha: zidishaBranches,
      boda: bodaBranches,
      advans: advansBranches,
    },
  }
}

app.post('/api/reports/repayments-by-month', requireAuth, (req, res) => {
  try {
    const { fromMonth, toMonth } = req.body || {}
    if (!fromMonth || !toMonth) {
      return res.status(400).json({ error: 'fromMonth and toMonth are required (YYYY-MM)' })
    }
    if (!/^\d{4}-\d{2}$/.test(String(fromMonth)) || !/^\d{4}-\d{2}$/.test(String(toMonth))) {
      return res.status(400).json({ error: 'fromMonth and toMonth must be YYYY-MM' })
    }
    const data = buildRepaymentsByMonthReport(fromMonth, toMonth)
    const portfolio = buildPortfolioAsOfToday()
    res.json({
      data,
      portfolio,
      meta: {
        fromMonth,
        toMonth,
        notes: {
          logbook: 'Collection Total Collected (Logbook_collection by payment date, Kenya)',
          zidisha:
            'Collection Total Collected (Zidisha_Daily expected_vs_Repayed: Expected − Outstanding by due month)',
          zidishaOtc: 'OTC from boda_repayments (core Zidisha products; data from Jun 2025)',
          boda: 'Collection EOM Total Collected (expected_vs_Repayed + boda_Schedule Expected − Outstanding; Boda history starts 2026)',
          bodaOtc: 'OTC from boda_repayments (Zidisha Boda; data from Dec 2025)',
          advans:
            'Collection Total Collected (expected_vs_Repayed Salary Advans / Advans Emergency by due month)',
          advansOtc: 'OTC from boda_repayments (Salary Advans / Advans Emergency Loan; data from Jun 2025)',
          portfolio:
            'As-of-today outstanding: Logbook = open loan principal (latest PAR); Zidisha/Boda/Advans = Principal Outstanding Derived',
        },
      },
    })
  } catch (e) {
    console.error('[Repayments By Month API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

function parseLogbookDirectorDMY(str) {
  if (!str) return null
  const s = String(str).trim()
  const slash = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slash) {
    const d = new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function listActiveLogbookBranchesForCountry(country) {
  return db
    .prepare('SELECT code, name, country FROM Logbook_Branches WHERE active = 1 AND country = ? ORDER BY name COLLATE NOCASE')
    .all(String(country || '').trim())
}

function buildLogbookBranchResolver(branches) {
  const codeSet = new Set()
  const nameToCode = new Map()
  const codeToName = new Map()
  for (const b of branches || []) {
    const code = String(b.code || '').trim()
    const name = String(b.name || '').trim()
    if (code) {
      codeSet.add(code)
      codeToName.set(code.toLowerCase(), name || code)
    }
    if (name && code) nameToCode.set(name.toLowerCase(), code)
  }
  return {
    resolve(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      if (codeSet.has(s)) return s
      return nameToCode.get(s.toLowerCase()) || s
    },
    codeSet,
    codeToName,
  }
}

function sumParTotalsForBranchCodes(branchParMap, branchCodes) {
  const combined = createParTotals()
  for (const code of branchCodes) {
    const fin = branchParMap?.[code]
    if (!fin) continue
    combined.openLoans += Number(fin.openLoans) || 0
    combined.pastMissed += Number(fin.pastMissed) || 0
    combined.par30 += Number(fin.par30) || 0
    combined.par60 += Number(fin.par60) || 0
    combined.par90 += Number(fin.par90) || 0
    combined.par90Plus += Number(fin.par90Plus) || 0
  }
  return finalizeParTotals(combined)
}

function aggregateLogbookDirectorMtd(year, monthNum, asAtDate, country) {
  const countryBranches = listActiveLogbookBranchesForCountry(country)
  const countryCodes = new Set(countryBranches.map((b) => String(b.code || '').trim()).filter(Boolean))
  const resolver = buildLogbookBranchResolver(countryBranches)
  const countryIdSet = new Set()
  for (const b of countryBranches) {
    if (b.code) countryIdSet.add(String(b.code).trim().toLowerCase())
    if (b.name) countryIdSet.add(String(b.name).trim().toLowerCase())
  }

  const monthStart = new Date(year, monthNum - 1, 1)
  const end = new Date(asAtDate)
  end.setHours(23, 59, 59, 999)

  const disbRows = db.prepare('SELECT branch, disbursed_date, disbursed FROM Logbook_Disbursement').all()
  const colRows = db.prepare('SELECT branch, repayment_collected_date, repayment_amount FROM Logbook_collection').all()

  let salesMtd = 0
  let collectionsMtd = 0
  for (const r of disbRows) {
    const code = resolver.resolve(r.branch)
    if (!countryCodes.has(code)) continue
    const d = parseLogbookDirectorDMY(r.disbursed_date)
    if (d && d >= monthStart && d <= end) salesMtd += Number(r.disbursed) || 0
  }
  for (const r of colRows) {
    const code = resolver.resolve(r.branch)
    if (!countryCodes.has(code)) continue
    const d = parseLogbookDirectorDMY(r.repayment_collected_date)
    if (d && d >= monthStart && d <= end) collectionsMtd += Number(r.repayment_amount) || 0
  }

  const targetRows = db
    .prepare('SELECT branch, disbursement_target, collection_target FROM Logbook_Targets WHERE month = ? AND year = ? AND active = 1')
    .all(monthNum, year)
  let salesTarget = 0
  let collectionTarget = 0
  for (const t of targetRows) {
    const rawBranch = String(t.branch || '').trim()
    const code = resolver.resolve(rawBranch)
    if (!countryCodes.has(code) && !countryIdSet.has(rawBranch.toLowerCase())) continue
    salesTarget += Number(t.disbursement_target) || 0
    collectionTarget += Number(t.collection_target) || 0
  }

  const historyRows = db.prepare('SELECT time FROM PAR ORDER BY time DESC').all()
  const endIso = end.toISOString()
  const snapshotTime =
    historyRows
      .map((r) => String(r.time || '').trim())
      .filter((t) => t && t <= endIso)
      .sort((a, b) => b.localeCompare(a))[0] || null

  let portfolio = 0
  let atRisk = 0
  let parRate = 0
  let par30Rate = 0
  let par60Rate = 0
  let par90Rate = 0
  let par90PlusRate = 0
  const topBranches = []

  if (snapshotTime && countryCodes.size > 0) {
    const openLoansRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(snapshotTime)
    const pastMissedRows = db
      .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`)
      .all(snapshotTime)
    const { branches: branchParMap } = aggregateParFromSnapshotLoanRows(openLoansRows, pastMissedRows)
    const totals = sumParTotalsForBranchCodes(branchParMap, countryCodes)
    portfolio = totals.openLoans
    atRisk = totals.pastMissed
    parRate = totals.parRate
    par30Rate = totals.par30Rate
    par60Rate = totals.par60Rate
    par90Rate = totals.par90Rate
    par90PlusRate = totals.par90PlusRate

    const branchRows = Array.from(countryCodes)
      .map((code) => {
        const fin = branchParMap[code] || finalizeParTotals(createParTotals())
        return {
          code,
          name: resolver.codeToName.get(String(code).toLowerCase()) || code,
          parRate: Number(fin.parRate.toFixed(1)),
          openLoans: Math.round(fin.openLoans),
          atRisk: Math.round(fin.pastMissed),
          par30Rate: Number(fin.par30Rate.toFixed(1)),
          par60Rate: Number(fin.par60Rate.toFixed(1)),
          par90PlusRate: Number(fin.par90PlusRate.toFixed(1)),
        }
      })
      .sort((a, b) => b.parRate - a.parRate)
      .slice(0, 8)

    topBranches.push(...branchRows)
  }

  const currency = String(country).trim() === 'Uganda' ? 'UGX' : 'KES'

  return {
    country,
    currency,
    branchCount: countryBranches.length,
    salesMtd: Math.round(salesMtd),
    collectionsMtd: Math.round(collectionsMtd),
    salesTarget: Math.round(salesTarget),
    collectionTarget: Math.round(collectionTarget),
    salesAchPct: salesTarget > 0 ? Number(((salesMtd / salesTarget) * 100).toFixed(1)) : 0,
    collectionsAchPct: collectionTarget > 0 ? Number(((collectionsMtd / collectionTarget) * 100).toFixed(1)) : 0,
    portfolio: Math.round(portfolio),
    atRisk: Math.round(atRisk),
    parRate: Number(parRate.toFixed(1)),
    par30Rate: Number(par30Rate.toFixed(1)),
    par60Rate: Number(par60Rate.toFixed(1)),
    par90Rate: Number(par90Rate.toFixed(1)),
    par90PlusRate: Number(par90PlusRate.toFixed(1)),
    parSnapshotTime: snapshotTime,
    topBranches,
  }
}

function aggregateZidishaFamilyMtd(config, year, monthNum, endDate) {
  const where = []
  const params = []
  if (config.products?.length) {
    where.push(`LOWER(TRIM("Product Name")) IN (${config.products.map(() => '?').join(', ')})`)
    params.push(...config.products.map((p) => String(p).trim().toLowerCase()))
  }
  if (config.excludeBranch) {
    where.push('LOWER(TRIM("Branch Name")) != LOWER(?)')
    params.push(String(config.excludeBranch).trim())
  }
  if (config.includeBranch) {
    where.push('LOWER(TRIM("Branch Name")) = LOWER(?)')
    params.push(String(config.includeBranch).trim())
  }
  if (config.excludeClientId) {
    where.push('TRIM("Client Id") != ?')
    params.push(String(config.excludeClientId).trim())
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM zidisha_data ${whereClause}`).all(...params)

  const monthStart = new Date(year, monthNum - 1, 1)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)

  let totalDisbursed = 0
  let totalCollected = 0
  let totalExpected = 0

  for (const row of rows) {
    const disbursedDate = row['Disbursed On Date'] || row.disbursed_on_date
    if (disbursedDate) {
      const d = new Date(disbursedDate)
      if (
        !Number.isNaN(d.getTime()) &&
        d.getFullYear() === year &&
        d.getMonth() + 1 === monthNum &&
        d >= monthStart &&
        d <= end
      ) {
        totalDisbursed += Number(row['Principal Amount'] || row.principal_amount || 0)
      }
    }
    const maturedDate = row['Expected Matured On Date'] || row.expected_matured_on_date
    if (maturedDate) {
      const d = new Date(maturedDate)
      if (
        !Number.isNaN(d.getTime()) &&
        d.getFullYear() === year &&
        d.getMonth() + 1 === monthNum &&
        d >= monthStart &&
        d <= end
      ) {
        totalCollected += Number(row['Total Repayment Derived'] || row.total_repayment_derived || 0)
        totalExpected += Number(row['Total Expected Repayment Derived'] || row.total_expected_repayment_derived || 0)
      }
    }
  }

  const collectionRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0
  return {
    totalDisbursed: Math.round(totalDisbursed),
    totalCollected: Math.round(totalCollected),
    totalExpected: Math.round(totalExpected),
    collectionRate: Number(collectionRate.toFixed(1)),
  }
}

function prevMonthYear(year, monthNum) {
  if (monthNum === 1) return { year: year - 1, month: 12 }
  return { year, month: monthNum - 1 }
}

function variancePct(curr, prev) {
  const c = Number(curr) || 0
  const p = Number(prev) || 0
  if (p === 0) return c === 0 ? 0 : 100
  return Number((((c - p) / p) * 100).toFixed(1))
}

function aggregateLogbookBranchesPerformance(country, year, monthNum, asAtDate) {
  const countryBranches = listActiveLogbookBranchesForCountry(country)
  const countryCodes = new Set(countryBranches.map((b) => String(b.code || '').trim()).filter(Boolean))
  const resolver = buildLogbookBranchResolver(countryBranches)
  const currency = String(country).trim() === 'Uganda' ? 'UGX' : 'KES'

  const monthStart = new Date(year, monthNum - 1, 1)
  const end = new Date(asAtDate)
  end.setHours(23, 59, 59, 999)
  const prev = prevMonthYear(year, monthNum)
  const prevStart = new Date(prev.year, prev.month - 1, 1)
  const prevEnd = new Date(prev.year, prev.month, 0, 23, 59, 59, 999)

  const byCode = new Map()
  for (const b of countryBranches) {
    byCode.set(String(b.code).trim(), {
      name: b.name || b.code,
      code: b.code,
      disbursedMtd: 0,
      disbursedPrev: 0,
      collectedMtd: 0,
      parRate: 0,
      par30Rate: 0,
      parOver30: 0,
      nplRate: 0,
      vsTarget: 0,
      salesTarget: 0,
    })
  }

  const disbRows = db.prepare('SELECT branch, disbursed_date, disbursed FROM Logbook_Disbursement').all()
  for (const r of disbRows) {
    const code = resolver.resolve(r.branch)
    if (!byCode.has(code)) continue
    const d = parseLogbookDirectorDMY(r.disbursed_date)
    if (!d) continue
    const amt = Number(r.disbursed) || 0
    const row = byCode.get(code)
    if (d >= monthStart && d <= end) row.disbursedMtd += amt
    if (d >= prevStart && d <= prevEnd) row.disbursedPrev += amt
  }

  const colRows = db.prepare('SELECT branch, repayment_collected_date, repayment_amount FROM Logbook_collection').all()
  for (const r of colRows) {
    const code = resolver.resolve(r.branch)
    if (!byCode.has(code)) continue
    const d = parseLogbookDirectorDMY(r.repayment_collected_date)
    if (!d || d < monthStart || d > end) continue
    byCode.get(code).collectedMtd += Number(r.repayment_amount) || 0
  }

  const targetRows = db
    .prepare('SELECT branch, disbursement_target FROM Logbook_Targets WHERE month = ? AND year = ? AND active = 1')
    .all(monthNum, year)
  for (const t of targetRows) {
    const code = resolver.resolve(t.branch)
    if (!byCode.has(code)) continue
    const row = byCode.get(code)
    row.salesTarget = Number(t.disbursement_target) || 0
    row.vsTarget = row.salesTarget > 0 ? Number((((row.disbursedMtd / row.salesTarget) * 100) - 100).toFixed(1)) : 0
  }

  const historyRows = db.prepare('SELECT time FROM PAR ORDER BY time DESC').all()
  const endIso = end.toISOString()
  const snapshotTime =
    historyRows
      .map((r) => String(r.time || '').trim())
      .filter((t) => t && t <= endIso)
      .sort((a, b) => b.localeCompare(a))[0] || null

  let globalPar = null
  if (snapshotTime) {
    const openLoansRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(snapshotTime)
    const pastMissedRows = db
      .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`)
      .all(snapshotTime)
    const { branches: branchParMap } = aggregateParFromSnapshotLoanRows(openLoansRows, pastMissedRows)
    globalPar = sumParTotalsForBranchCodes(branchParMap, countryCodes)
    for (const [code, row] of byCode.entries()) {
      const fin = branchParMap[code]
      if (!fin) continue
      row.parRate = Number(fin.parRate.toFixed(1))
      row.par30Rate = Number(fin.par30Rate.toFixed(1))
      row.parOver30 = Number((fin.par60Rate + fin.par90Rate + fin.par90PlusRate).toFixed(1))
      row.nplRate = Number(fin.par90PlusRate.toFixed(1))
      row.openLoans = Math.round(fin.openLoans)
    }
  }

  const branches = Array.from(byCode.values()).sort((a, b) => b.disbursedMtd - a.disbursedMtd)
  const totals = branches.reduce(
    (acc, b) => {
      acc.disbursedMtd += b.disbursedMtd
      acc.disbursedPrev += b.disbursedPrev
      acc.collectedMtd += b.collectedMtd
      return acc
    },
    {
      name: 'TOTAL / AVG',
      disbursedMtd: 0,
      disbursedPrev: 0,
      collectedMtd: 0,
      parRate: 0,
      par30Rate: 0,
      parOver30: 0,
      nplRate: 0,
      vsTarget: 0,
      salesTarget: 0,
    },
  )
  if (globalPar) {
    totals.parRate = Number(globalPar.parRate.toFixed(1))
    totals.par30Rate = Number(globalPar.par30Rate.toFixed(1))
    totals.parOver30 = Number(
      (globalPar.par60Rate + globalPar.par90Rate + globalPar.par90PlusRate).toFixed(1),
    )
    totals.nplRate = Number(globalPar.par90PlusRate.toFixed(1))
  }

  return { currency, branches, totals }
}

function isBodaDirectorConfig(config) {
  const products = Array.isArray(config?.products) ? config.products : []
  return products.length === 1 && String(products[0] || '').trim().toLowerCase() === 'zidisha boda'
}

/** Zidisha MTD collection by branch — matches /api/zidisha/productivity/mtd-by-branch-officers. */
function fetchZidishaMtdCollectionByBranch(config, year, monthNum, cutoffDay) {
  const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1
  const nextYear = monthNum === 12 ? year + 1 : year
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  const maturity = zidishaExpectedMaturityExpr('z')

  const where = [
    `${maturity} >= date(?)`,
    `${maturity} < date(?)`,
    `CAST(strftime('%d', ${maturity}) AS INTEGER) <= ?`,
  ]
  const params = [monthStart, monthEnd, cutoffDay]

  if (config.products?.length) {
    where.unshift(`z."Product Name" COLLATE NOCASE IN (${config.products.map(() => '?').join(', ')})`)
    params.unshift(...config.products.map((p) => String(p).trim()))
  }
  if (config.excludeBranch) {
    where.push('z."Branch Name" COLLATE NOCASE != ?')
    params.push(String(config.excludeBranch).trim())
  }
  if (config.includeBranch) {
    where.push('z."Branch Name" COLLATE NOCASE = ?')
    params.push(String(config.includeBranch).trim())
  }
  if (config.excludeClientId) {
    where.push('TRIM(z."Client Id") != ?')
    params.push(String(config.excludeClientId).trim())
  }

  const rows = db
    .prepare(
      `SELECT
         TRIM(z."Branch Name") AS branch,
         COALESCE(CAST(z."Total Expected Repayment Derived" AS REAL), 0) AS expected,
         COALESCE(CAST(z."Total Repayment Derived" AS REAL), 0) AS collected
       FROM zidisha_data z
       WHERE ${where.join(' AND ')}`,
    )
    .all(...params)

  const byBranch = new Map()
  for (const r of rows) {
    const b = String(r.branch || '').trim() || 'Unknown'
    if (!byBranch.has(b)) byBranch.set(b, { expected: 0, collected: 0 })
    const cur = byBranch.get(b)
    cur.expected += Number(r.expected || 0)
    cur.collected += Number(r.collected || 0)
  }
  return byBranch
}

/** Boda MTD collection by branch — matches /api/boda/schedule/mtd-by-branch. */
function fetchBodaMtdCollectionByBranch(year, monthNum, cutoffDay, excludeClientId = null) {
  const productName = 'Zidisha Boda'
  const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1
  const nextYear = monthNum === 12 ? year + 1 : year
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  const where = [
    `"Due Date" >= ?`,
    `"Due Date" < ?`,
    `COALESCE(TRIM("Product Name"), '') COLLATE NOCASE = ?`,
    `CAST(strftime('%d', "Due Date") AS INTEGER) <= ?`,
  ]
  const params = [monthStart, monthEnd, productName, cutoffDay]
  if (excludeClientId) {
    where.push('TRIM("Client Id") != ?')
    params.push(String(excludeClientId).trim())
  }

  const rows = db
    .prepare(
      `SELECT
         TRIM("Branch Name") AS branch,
         COALESCE(CAST(REPLACE("Total Expected", ',', '') AS REAL), 0) AS expected,
         COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0) AS outstanding
       FROM boda_Schedule
       WHERE ${where.join(' AND ')}`,
    )
    .all(...params)

  const byBranch = new Map()
  for (const r of rows) {
    const b = String(r.branch || '').trim() || 'Unknown'
    const expected = Number(r.expected || 0)
    const outstanding = Number(r.outstanding || 0)
    if (!byBranch.has(b)) byBranch.set(b, { expected: 0, collected: 0 })
    const cur = byBranch.get(b)
    cur.expected += expected
    cur.collected += Math.max(0, expected - outstanding)
  }
  return byBranch
}

/** Boda portfolio PAR by branch — matches /boda/dashboard (outstanding with overdue / total outstanding). */
function computeBodaPortfolioParByBranch(rows) {
  const byBranch = new Map()
  let totalOutstandingAll = 0
  let totalOutstandingAtRisk = 0

  for (const row of rows) {
    const branch = String(row['Branch Name'] || row.branch_name || 'Unknown').trim() || 'Unknown'
    const outstanding = Number(row['Principal Outstanding Derived'] || row.principal_outstanding_derived || 0)
    const overdue = Number(row['Principal Overdue Derived'] || row.principal_overdue_derived || 0)
    if (outstanding <= 0) continue

    totalOutstandingAll += outstanding
    if (overdue > 0) totalOutstandingAtRisk += outstanding

    if (!byBranch.has(branch)) {
      byBranch.set(branch, { outstandingAll: 0, outstandingAtRisk: 0 })
    }
    const entry = byBranch.get(branch)
    entry.outstandingAll += outstanding
    if (overdue > 0) entry.outstandingAtRisk += outstanding
  }

  const branchPar = new Map()
  for (const [branch, v] of byBranch) {
    branchPar.set(
      branch,
      v.outstandingAll > 0 ? Number(((v.outstandingAtRisk / v.outstandingAll) * 100).toFixed(1)) : 0,
    )
  }

  const globalPar =
    totalOutstandingAll > 0 ? Number(((totalOutstandingAtRisk / totalOutstandingAll) * 100).toFixed(1)) : 0

  return { byBranch: branchPar, globalPar }
}

/**
 * Boda PAR aging — same base as /boda/dashboard PAR
 * (Principal Outstanding where Principal Overdue > 0 / total Principal Outstanding),
 * filtered by days past due from the oldest unpaid boda_Schedule installment.
 */
function computeBodaParAging({ branch = '', allowedBranches = null } = {}) {
  const branchFilter = String(branch || '').trim()
  const wantBranch =
    branchFilter && branchFilter.toLowerCase() !== 'all' ? branchFilter.toLowerCase() : null
  const allowedNorm =
    allowedBranches instanceof Set && allowedBranches.size > 0 ? allowedBranches : null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const scheduleSql = `
    SELECT TRIM("Loan Id") AS loanId, "Due Date" AS dueDate, TRIM("Branch Name") AS branch
    FROM boda_Schedule
    WHERE CAST("Total Outstanding" AS REAL) > 0
      AND "Due Date" IS NOT NULL
      AND TRIM("Due Date") <> ''
      AND LOWER(TRIM(COALESCE("Product Name",''))) LIKE '%boda%'
      ${wantBranch ? 'AND LOWER(TRIM(COALESCE("Branch Name",\'\'))) = LOWER(?)' : ''}
  `
  const scheduleRows = db.prepare(scheduleSql).all(...(wantBranch ? [wantBranch] : []))

  const daysPastDueByLoan = new Map()
  for (const r of scheduleRows) {
    const b = String(r.branch || '').trim().toLowerCase()
    if (allowedNorm && !wantBranch && b && !allowedNorm.has(b)) continue
    const loanId = String(r.loanId || '').trim()
    if (!loanId) continue
    const due = parseDateLoose(r.dueDate)
    if (!due) continue
    due.setHours(0, 0, 0, 0)
    if (due > today) continue
    const days = Math.floor((today - due) / 86400000)
    const prev = daysPastDueByLoan.get(loanId)
    if (prev == null || days > prev) daysPastDueByLoan.set(loanId, days)
  }

  const where = [
    `LOWER(TRIM("Product Name")) LIKE '%boda%'`,
    `TRIM(COALESCE("Client Id",'')) != '3926'`,
    `CAST("Principal Outstanding Derived" AS REAL) > 0`,
  ]
  const params = []
  if (wantBranch) {
    where.push(`LOWER(TRIM(COALESCE("Branch Name",''))) = ?`)
    params.push(wantBranch)
  }

  const loanRows = db
    .prepare(
      `SELECT
         TRIM("Loan ID") AS loanId,
         TRIM("Branch Name") AS branch,
         TRIM(COALESCE("Loan Officer Name", 'Unknown')) AS officer,
         CAST("Principal Outstanding Derived" AS REAL) AS outstanding,
         CAST("Principal Overdue Derived" AS REAL) AS overdue
       FROM zidisha_data
       WHERE ${where.join(' AND ')}`,
    )
    .all(...params)

  let totalOutstanding = 0
  let atRiskOutstanding = 0
  let par7Outstanding = 0
  let par14Outstanding = 0
  let par21Outstanding = 0
  let par21PlusOutstanding = 0
  const branchAgg = new Map()
  const officerAgg = new Map() // key: `${branchLower}|||${officerLower}`

  // Non-overlapping arrears bands by days-past-due (oldest unpaid installment):
  //   par7 = 1-7 days, par14 = 8-14 days, par21 = 15-21 days, par21plus = 22+ days.
  // The whole remaining principal of a loan is treated as at risk once any
  // installment is past its due date and unpaid.
  const bump = (map, key, labelFields, outstanding, overdue, dpd) => {
    if (!map.has(key)) {
      map.set(key, {
        ...labelFields,
        outstandingAll: 0,
        outstandingAtRisk: 0,
        outstandingPar7: 0,
        outstandingPar14: 0,
        outstandingPar21: 0,
        outstandingPar21Plus: 0,
      })
    }
    const e = map.get(key)
    e.outstandingAll += outstanding
    if (overdue > 0) {
      e.outstandingAtRisk += outstanding
      if (dpd != null) {
        if (dpd <= 7) e.outstandingPar7 += outstanding
        else if (dpd <= 14) e.outstandingPar14 += outstanding
        else if (dpd <= 21) e.outstandingPar21 += outstanding
        else e.outstandingPar21Plus += outstanding
      }
    }
  }

  for (const r of loanRows) {
    const branchName = String(r.branch || '').trim() || 'Unknown'
    const b = branchName.toLowerCase()
    if (allowedNorm && !wantBranch && b && !allowedNorm.has(b)) continue
    const outstanding = Number(r.outstanding) || 0
    if (outstanding <= 0) continue
    const overdue = Number(r.overdue) || 0
    const officerName = String(r.officer || 'Unknown').trim() || 'Unknown'
    const dpd = daysPastDueByLoan.get(String(r.loanId || '').trim())

    totalOutstanding += outstanding
    if (overdue > 0) atRiskOutstanding += outstanding

    bump(branchAgg, b, { branch: branchName }, outstanding, overdue, dpd)
    bump(
      officerAgg,
      `${b}|||${officerName.toLowerCase()}`,
      { branch: branchName, officer: officerName },
      outstanding,
      overdue,
      dpd,
    )

    if (!(overdue > 0) || dpd == null) continue
    if (dpd <= 7) par7Outstanding += outstanding
    else if (dpd <= 14) par14Outstanding += outstanding
    else if (dpd <= 21) par21Outstanding += outstanding
    else par21PlusOutstanding += outstanding
  }

  const pct = (num, den = totalOutstanding) =>
    den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0

  const finalizePar = (v) => ({
    par: pct(v.outstandingAtRisk, v.outstandingAll),
    par7: pct(v.outstandingPar7, v.outstandingAll),
    par14: pct(v.outstandingPar14, v.outstandingAll),
    par21: pct(v.outstandingPar21, v.outstandingAll),
    par21plus: pct(v.outstandingPar21Plus, v.outstandingAll),
    outstanding: Math.round(v.outstandingAll),
    atRisk: Math.round(v.outstandingAtRisk),
    atRisk7: Math.round(v.outstandingPar7),
    atRisk14: Math.round(v.outstandingPar14),
    atRisk21: Math.round(v.outstandingPar21),
    atRisk21plus: Math.round(v.outstandingPar21Plus),
  })

  const byBranch = {}
  for (const [, v] of branchAgg) {
    byBranch[v.branch] = finalizePar(v)
  }

  const byOfficer = {}
  for (const [, v] of officerAgg) {
    if (!byOfficer[v.branch]) byOfficer[v.branch] = {}
    byOfficer[v.branch][v.officer] = finalizePar(v)
  }

  return {
    totalOutstanding: Math.round(totalOutstanding),
    atRiskOutstanding: Math.round(atRiskOutstanding),
    par7Outstanding: Math.round(par7Outstanding),
    par14Outstanding: Math.round(par14Outstanding),
    par21Outstanding: Math.round(par21Outstanding),
    par21plusOutstanding: Math.round(par21PlusOutstanding),
    par: pct(atRiskOutstanding),
    par7: pct(par7Outstanding),
    par14: pct(par14Outstanding),
    par21: pct(par21Outstanding),
    par21plus: pct(par21PlusOutstanding),
    loanCount: loanRows.length,
    byBranch,
    byOfficer,
  }
}

function aggregateZidishaBranchesPerformance(config, year, monthNum, asAtDate) {
  const where = []
  const params = []
  if (config.products?.length) {
    where.push(`LOWER(TRIM("Product Name")) IN (${config.products.map(() => '?').join(', ')})`)
    params.push(...config.products.map((p) => String(p).trim().toLowerCase()))
  }
  if (config.excludeBranch) {
    where.push('LOWER(TRIM("Branch Name")) != LOWER(?)')
    params.push(String(config.excludeBranch).trim())
  }
  if (config.includeBranch) {
    where.push('LOWER(TRIM("Branch Name")) = LOWER(?)')
    params.push(String(config.includeBranch).trim())
  }
  if (config.excludeClientId) {
    where.push('TRIM("Client Id") != ?')
    params.push(String(config.excludeClientId).trim())
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM zidisha_data ${whereClause}`).all(...params)

  const monthStart = new Date(year, monthNum - 1, 1)
  const end = new Date(asAtDate)
  end.setHours(23, 59, 59, 999)
  const prev = prevMonthYear(year, monthNum)
  const prevStart = new Date(prev.year, prev.month - 1, 1)
  const prevEnd = new Date(prev.year, prev.month, 0, 23, 59, 59, 999)
  const cutoffDay = asAtDate.getDate()
  const isBoda = isBodaDirectorConfig(config)

  const byBranch = new Map()
  const ensure = (name) => {
    const key = String(name || 'Unknown').trim() || 'Unknown'
    if (!byBranch.has(key)) {
      byBranch.set(key, {
        name: key,
        disbursedMtd: 0,
        disbursedPrev: 0,
        collectedMtd: 0,
        expectedMtd: 0,
      })
    }
    return byBranch.get(key)
  }

  for (const row of rows) {
    const branch = ensure(row['Branch Name'] || row.branch_name)
    const disbursedDate = row['Disbursed On Date'] || row.disbursed_on_date
    if (disbursedDate) {
      const d = new Date(disbursedDate)
      if (!Number.isNaN(d.getTime())) {
        const amt = Number(row['Principal Amount'] || row.principal_amount || 0)
        if (d >= monthStart && d <= end && d.getFullYear() === year && d.getMonth() + 1 === monthNum) branch.disbursedMtd += amt
        if (d >= prevStart && d <= prevEnd) branch.disbursedPrev += amt
      }
    }
  }

  const collectionByBranch = isBoda
    ? fetchBodaMtdCollectionByBranch(year, monthNum, cutoffDay, config.excludeClientId)
    : fetchZidishaMtdCollectionByBranch(config, year, monthNum, cutoffDay)

  for (const [branchName, coll] of collectionByBranch) {
    const branch = ensure(branchName)
    branch.collectedMtd = coll.collected
    branch.expectedMtd = coll.expected
  }

  const bodaPar = isBoda ? computeBodaPortfolioParByBranch(rows) : null
  if (bodaPar) {
    for (const branchName of bodaPar.byBranch.keys()) ensure(branchName)
  }

  const branches = Array.from(byBranch.values())
    .map((b) => {
      const collectionRate = b.expectedMtd > 0 ? (b.collectedMtd / b.expectedMtd) * 100 : 0
      const parGap = Number(Math.max(0, 100 - collectionRate).toFixed(1))
      const branchParRate = isBoda ? (bodaPar?.byBranch.get(b.name) ?? 0) : undefined
      return {
        ...b,
        collectionRate: Number(collectionRate.toFixed(1)),
        par30Rate: isBoda ? undefined : parGap,
        parRate: isBoda ? branchParRate : undefined,
        parOver30: isBoda ? branchParRate : parGap,
      }
    })
    .filter((b) => b.disbursedMtd > 0 || b.collectedMtd > 0 || b.disbursedPrev > 0 || (isBoda && b.parRate > 0))
    .sort((a, b) => b.disbursedMtd - a.disbursedMtd)

  const totals = branches.reduce(
    (acc, b) => {
      acc.disbursedMtd += b.disbursedMtd
      acc.disbursedPrev += b.disbursedPrev
      acc.collectedMtd += b.collectedMtd
      acc.expectedMtd += b.expectedMtd
      return acc
    },
    { name: 'TOTAL / AVG', disbursedMtd: 0, disbursedPrev: 0, collectedMtd: 0, expectedMtd: 0 },
  )
  totals.collectionRate =
    totals.expectedMtd > 0 ? Number(((totals.collectedMtd / totals.expectedMtd) * 100).toFixed(1)) : 0
  if (isBoda && bodaPar) {
    totals.parRate = bodaPar.globalPar
    totals.parOver30 = bodaPar.globalPar
  } else {
    const totalParGap = Number(Math.max(0, 100 - totals.collectionRate).toFixed(1))
    totals.parOver30 = totalParGap
    totals.par30Rate = totalParGap
  }

  return { currency: 'KES', branches, totals }
}

function buildExecutiveKpis(asAtDate, lbKe, zd, bd) {
  const year = asAtDate.getFullYear()
  const monthNum = asAtDate.getMonth() + 1
  const prev = prevMonthYear(year, monthNum)
  const prevEnd = new Date(prev.year, prev.month, 0, 23, 59, 59, 999)

  const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simbo', 'Zidisha Tembo', 'Zidisha Express']
  const lbKePrev = aggregateLogbookDirectorMtd(prev.year, prev.month, prevEnd, 'Kenya')
  const zdPrev = aggregateZidishaFamilyMtd({ products: zidishaProducts, excludeBranch: 'Advans Branch' }, prev.year, prev.month, prevEnd)
  const bdPrev = aggregateZidishaFamilyMtd({ products: ['Zidisha Boda'], excludeClientId: '3926' }, prev.year, prev.month, prevEnd)

  const portfolio = lbKe.portfolio
  const portfolioPrev = lbKePrev.portfolio
  const collections = lbKe.collectionsMtd + zd.totalCollected + bd.totalCollected
  const collectionsPrev = lbKePrev.collectionsMtd + zdPrev.totalCollected + bdPrev.totalCollected
  const expected = zd.totalExpected + bd.totalExpected
  const expectedPrev = zdPrev.totalExpected + bdPrev.totalExpected
  const collectionRate = expected > 0 ? (zd.totalCollected + bd.totalCollected) / expected * 100 : 0
  const collectionRatePrev = expectedPrev > 0 ? (zdPrev.totalCollected + bdPrev.totalCollected) / expectedPrev * 100 : 0

  return [
    { metric: 'Total Gross Loan Portfolio (KE Logbook)', current: portfolio, previous: portfolioPrev, unit: 'KES' },
    { metric: 'Total Collections (Consolidated KES)', current: collections, previous: collectionsPrev, unit: 'KES' },
    { metric: 'Collection Rate (Zidisha + Boda)', current: collectionRate, previous: collectionRatePrev, unit: '%' },
    { metric: 'Portfolio at Risk — Logbook Kenya', current: lbKe.parRate, previous: lbKePrev.parRate, unit: '%' },
    { metric: 'PAR >30 Days — Logbook Kenya', current: lbKe.par60Rate + lbKe.par90Rate + lbKe.par90PlusRate, previous: lbKePrev.par60Rate + lbKePrev.par90Rate + lbKePrev.par90PlusRate, unit: '%' },
  ].map((r) => ({
    ...r,
    variance: variancePct(r.current, r.previous),
    currentFmt: r.unit === '%' ? `${Number(r.current).toFixed(1)}%` : r.current,
    previousFmt: r.unit === '%' ? `${Number(r.previous).toFixed(1)}%` : r.previous,
  }))
}

function buildParHeatMap(lbKeBranches, zdBranches, bdBranches, { logbookGlobalPar = null, zidishaGlobalPar = null, bodaGlobalPar = null } = {}) {
  const names = new Set([
    ...lbKeBranches.map((b) => b.name),
    ...zdBranches.map((b) => b.name),
    ...bdBranches.map((b) => b.name),
  ])
  const lbMap = new Map(lbKeBranches.map((b) => [b.name, b]))
  const zdMap = new Map(zdBranches.map((b) => [b.name, b]))
  const bdMap = new Map(bdBranches.map((b) => [b.name, b]))

  const logbookParFor = (name) => {
    const b = lbMap.get(name)
    if (!b || !(Number(b.openLoans) > 0)) return null
    return b.parRate ?? null
  }

  const rows = Array.from(names)
    .map((name) => ({
      name,
      logbook: logbookParFor(name),
      zidisha: zdMap.get(name)?.parOver30 ?? null,
      boda: bdMap.get(name)?.parRate ?? bdMap.get(name)?.parOver30 ?? null,
    }))
    .filter((r) => r.logbook != null || r.zidisha != null || r.boda != null)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))

  const branchAvg = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v != null)
    return vals.length ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1)) : null
  }

  return {
    rows,
    averages: {
      logbook: logbookGlobalPar != null ? Number(logbookGlobalPar.toFixed(1)) : branchAvg('logbook'),
      zidisha: zidishaGlobalPar != null ? Number(zidishaGlobalPar.toFixed(1)) : branchAvg('zidisha'),
      boda: bodaGlobalPar != null ? Number(bodaGlobalPar.toFixed(1)) : branchAvg('boda'),
    },
  }
}

function buildDirectorReportSummary(asAtDate) {
  const year = asAtDate.getFullYear()
  const monthNum = asAtDate.getMonth() + 1
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const periodLabel = `${monthNames[monthNum - 1]} ${year}`
  const reportingDate = `${asAtDate.getDate()} ${monthNames[monthNum - 1]} ${year}`
  const prev = prevMonthYear(year, monthNum)
  const prevMonthName = monthNames[prev.month - 1]

  const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']
  const lbKe = aggregateLogbookDirectorMtd(year, monthNum, asAtDate, 'Kenya')
  const lbUg = aggregateLogbookDirectorMtd(year, monthNum, asAtDate, 'Uganda')
  const zd = aggregateZidishaFamilyMtd({ products: zidishaProducts, excludeBranch: 'Advans Branch' }, year, monthNum, asAtDate)
  const bd = aggregateZidishaFamilyMtd({ products: ['Zidisha Boda'], excludeClientId: '3926' }, year, monthNum, asAtDate)
  const advans = aggregateZidishaFamilyMtd({ includeBranch: 'Advans Branch' }, year, monthNum, asAtDate)

  const lbKeBranches = aggregateLogbookBranchesPerformance('Kenya', year, monthNum, asAtDate)
  const lbUgBranches = aggregateLogbookBranchesPerformance('Uganda', year, monthNum, asAtDate)
  const zdBranches = aggregateZidishaBranchesPerformance({ products: zidishaProducts, excludeBranch: 'Advans Branch' }, year, monthNum, asAtDate)
  const bdBranches = aggregateZidishaBranchesPerformance({ products: ['Zidisha Boda'], excludeClientId: '3926' }, year, monthNum, asAtDate)

  return {
    asAt: asAtDate.toISOString(),
    periodLabel,
    reportingDate,
    month: monthNum,
    year,
    monthName: monthNames[monthNum - 1],
    prevMonthName,
    executiveKpis: buildExecutiveKpis(asAtDate, lbKe, zd, bd),
    logbook: {
      kenya: { ...lbKe, branches: lbKeBranches.branches, totals: lbKeBranches.totals },
      uganda: { ...lbUg, branches: lbUgBranches.branches, totals: lbUgBranches.totals },
    },
    zidisha: { ...zd, branches: zdBranches.branches, totals: zdBranches.totals },
    advans,
    boda: { ...bd, branches: bdBranches.branches, totals: bdBranches.totals },
    heatMap: buildParHeatMap(lbKeBranches.branches, zdBranches.branches, bdBranches.branches, {
      logbookGlobalPar: lbKe.parRate,
      zidishaGlobalPar: zdBranches.totals?.par30Rate ?? zdBranches.totals?.parOver30,
      bodaGlobalPar: bdBranches.totals?.parRate,
    }),
  }
}

function buildDirectorCommentaryPrompt(summary) {
  return `You are preparing a Board & Management Performance Report for Phoenix Capital Limited.

Return EXACTLY this JSON matching the board report style:

{
  "intro": "Two sentences max — consolidated performance overview for ${summary.monthName} ${summary.year}.",
  "alertLine": "One sentence if PAR exceeds 8% threshold, else empty string",
  "keyObservations": {
    "logbook": ["bullet max 20 words", "bullet max 20 words"],
    "zidisha": ["bullet max 20 words", "bullet max 20 words"],
    "boda": ["bullet max 20 words", "bullet max 20 words"],
    "heatMap": ["bullet max 20 words"]
  },
  "directives": [
    { "action": "max 15 words", "owner": "role title", "deadline": "date or timeframe", "priority": "URGENT|HIGH|MEDIUM", "status": "Open" }
  ]
}

Rules:
- Max 3 bullets per keyObservations section, max 5 directives.
- Use real branch names and figures from data.
- Logbook Kenya=KES, Uganda=UGX; Zidisha/Boda=KES.
- Return ONLY JSON, no markdown.

=== DATA ===
${JSON.stringify(summary, null, 2)}`
}

function parseDirectorCommentaryJson(raw) {
  return parseAnthropicCommentaryJson(raw)
}

// Director Report — cross-product summary + Claude narrative (admin/superuser)
app.post('/api/reports/director', requireAuth, async (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Director report is available to administrators only' })
    }

    const asAtRaw = req.body?.asAt
    const asAtDate = asAtRaw ? new Date(`${String(asAtRaw).slice(0, 10)}T12:00:00`) : new Date()
    if (Number.isNaN(asAtDate.getTime())) {
      return res.status(400).json({ error: 'Invalid asAt date' })
    }

    const summary = buildDirectorReportSummary(asAtDate)

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      return res.status(503).json({
        error: 'AI report generation is not configured. Set ANTHROPIC_API_KEY in the server environment.',
      })
    }

    const model = String(process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001').trim()
    const prompt = buildDirectorCommentaryPrompt(summary)

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 120000,
      },
    )

    const raw = response.data?.content?.[0]?.text
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from AI service' })
    }

    const parsed = parseDirectorCommentaryJson(raw)
    if (!parsed?.intro && !parsed?.headline && !parsed?.keyObservations) {
      return res.status(502).json({ error: 'AI response was not in the expected format' })
    }

    res.json({
      summary,
      commentary: {
        intro: String(parsed.intro || parsed.headline || '').slice(0, 500),
        alertLine: String(parsed.alertLine || '').slice(0, 280),
        keyObservations: parsed.keyObservations || {},
        directives: Array.isArray(parsed.directives) ? parsed.directives.slice(0, 8) : [],
        headline: String(parsed.headline || parsed.intro || '').slice(0, 280),
        statusTable: Array.isArray(parsed.statusTable) ? parsed.statusTable.slice(0, 8) : [],
        products: parsed.products || {},
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    const msg =
      e.response?.data?.error?.message ||
      e.response?.data?.error ||
      e.message ||
      'Failed to generate director report'
    console.error('[Director Report] Error:', msg)
    res.status(500).json({ error: String(msg) })
  }
})

// Board Report — native Word (.docx) with full formatting
app.post('/api/reports/director/docx', requireAuth, async (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Board report export is available to administrators only' })
    }

    const summary = req.body?.summary
    const commentary = req.body?.commentary
    if (!summary || typeof summary !== 'object') {
      return res.status(400).json({ error: 'Report data is required. Generate the board report first.' })
    }

    const asAtRaw = req.body?.asAt || summary.asAt
    const asAtLabel = asAtRaw ? String(asAtRaw).slice(0, 10) : new Date().toISOString().slice(0, 10)
    const filename = `board-report-${asAtLabel}.docx`

    const { buildDirectorReportDocxBuffer } = await import('./lib/directorReportDocx.mjs')
    const fileBuffer = await buildDirectorReportDocxBuffer({
      summary,
      commentary: commentary || {},
      generatedAt: req.body?.generatedAt,
    })

    console.log(`[Director Report DOCX] Generated ${filename} (${fileBuffer.length} bytes)`)

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(fileBuffer)
  } catch (e) {
    const msg = e.message || 'Failed to export board report as Word document'
    console.error('[Director Report DOCX] Error:', msg)
    res.status(500).json({ error: String(msg) })
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

// SMS audit: log totals, invalid numbers, next-run estimates (admin/superuser)
app.get('/api/admin/sms/audit', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 7), 90)
    res.json(buildSmsAuditReport({ days }))
  } catch (e) {
    console.error('[SMS Audit API] Error:', e)
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
  try {
    dbRW.exec(`CREATE INDEX IF NOT EXISTS idx_boda_schedule_due ON boda_Schedule("Due Date");`)
  } catch {}
  try {
    dbRW.exec(`CREATE INDEX IF NOT EXISTS idx_boda_schedule_loan ON boda_Schedule("Loan Id");`)
  } catch {}
  try {
    dbRW.exec(
      `CREATE INDEX IF NOT EXISTS idx_boda_schedule_product_due ON boda_Schedule("Product Name", "Due Date");`,
    )
  } catch {}
}

/** Musoni Expected Matured On Date → SQLite date (DD/MM/YYYY or ISO). */
function zidishaExpectedMaturityExpr(alias = 'z') {
  const col = `${alias}."Expected Matured On Date"`
  return `(
    CASE
      WHEN TRIM(COALESCE(${col}, '')) LIKE '__/__/____'
        THEN date(
          substr(TRIM(${col}), 7, 4) || '-' ||
          substr(TRIM(${col}), 4, 2) || '-' ||
          substr(TRIM(${col}), 1, 2)
        )
      ELSE date(TRIM(${col}))
    END
  )`
}

/**
 * Client performance loan window.
 * Default: only loans whose Expected Matured On Date is still in the future.
 * includePastMaturity (All any %): also loans past that date but still owing.
 */
function zidishaActiveLoanForPerformanceWhere(alias = 'z', includePastMaturity = false) {
  const mat = zidishaExpectedMaturityExpr(alias)
  if (!includePastMaturity) {
    return `${mat} > date('now')`
  }
  return `(
    ${mat} > date('now')
    OR (
      ${mat} <= date('now')
      AND CAST(${alias}."Total Outstanding Derived" AS REAL) > 1
    )
  )`
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
        AND ${zidishaActiveLoanForPerformanceWhere('z', false)}
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

    // Fast path: precomputed table (in-term loans only). "All (any %)" needs past-maturity rows → live SQL.
    const tableName = product === 'boda' ? 'credit_scores_boda' : product === 'zidisha' ? 'credit_scores_zidisha' : 'credit_scores'
    const pre = minPrincipalPaid > 0 ? tryQueryCreditScoresTable(tableName, limit) : null
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
    AND ${zidishaActiveLoanForPerformanceWhere('z', minPrincipalPaid === 0)}
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

// Boda PAR aging (PAR / PAR7 / PAR14 / PAR21) — same methodology as /boda/dashboard
app.get('/api/boda/par-aging', requireAuth, (req, res) => {
  try {
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''
    const allowedBoda = getAllowedBodaBranches(req)
    const allowedNorm = allowedBoda.length
      ? new Set(allowedBoda.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
      : null

    if (branch && branch.toLowerCase() !== 'all' && allowedNorm && !allowedNorm.has(branch.toLowerCase())) {
      return res.status(403).json({ error: 'Branch not allowed for this user' })
    }

    const result = computeBodaParAging({ branch, allowedBranches: allowedNorm })
    return res.json(result)
  } catch (e) {
    console.error('[Boda PAR aging]', e)
    return res.status(500).json({ error: e.message })
  }
})

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

// Boda schedule MTD by branch + loan officer (joins zidisha_data for officer name)
app.get('/api/boda/schedule/mtd-by-branch-officers', requireAuth, (req, res) => {
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

    const where = [
      `s."Due Date" >= ?`,
      `s."Due Date" < ?`,
      `COALESCE(TRIM(s."Product Name"), '') COLLATE NOCASE = ?`,
      `CAST(strftime('%d', s."Due Date") AS INTEGER) <= ?`,
    ]
    const params = [monthStart, monthEnd, productName, cutoffDayRaw]

    if (branch && branch.toLowerCase() !== 'all') {
      where.push('s."Branch Name" COLLATE NOCASE = ?')
      params.push(branch.trim())
    } else if (allowedBoda.length > 0) {
      where.push(`s."Branch Name" COLLATE NOCASE IN (${allowedBoda.map(() => '?').join(', ')})`)
      params.push(...allowedBoda.map((b) => String(b || '').trim()))
    }

    const flatRows = db
      .prepare(
        `SELECT
           TRIM(s."Branch Name") AS branch,
           TRIM(COALESCE(z."Loan Officer Name", 'Unknown')) AS officer,
           COALESCE(CAST(REPLACE(s."Total Expected", ',', '') AS REAL), 0) AS expected,
           COALESCE(CAST(REPLACE(s."Total Outstanding", ',', '') AS REAL), 0) AS outstanding
         FROM boda_Schedule s
         LEFT JOIN zidisha_data z
           ON TRIM(s."Loan Id") = TRIM(z."Loan ID")
         WHERE ${where.join(' AND ')}`,
      )
      .all(...params)

    const result = aggregateMtdBranchOfficerRows(flatRows, { targetRate: 0.97 })
    res.json({ rows: result })
  } catch (e) {
    console.error('[Boda Schedule MTD By Branch Officers API] Error:', e)
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

/** Parse calendar date parts from Loandisk-style strings (DD/MM/YYYY, YYYY-MM-DD, with optional time). */
function parseLogbookCalendarDateParts(str) {
  if (!str) return null
  const s = String(str).trim().split(/\s+/)[0]
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    return { yyyy: parseInt(iso[1], 10), mm: parseInt(iso[2], 10), dd: parseInt(iso[3], 10) }
  }
  const parts = s.split(/[\/\-]/).map((p) => parseInt(p, 10))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  if (parts[0] > 31) {
    return { yyyy: parts[0], mm: parts[1], dd: parts[2] }
  }
  return { dd: parts[0], mm: parts[1], yyyy: parts[2] }
}

function logbookCalendarDateMatches(str, year, month, day) {
  const p = parseLogbookCalendarDateParts(str)
  return p && p.yyyy === year && p.mm === month && p.dd === day
}

function parseLoandiskScheduleField(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Due installment amount on a calendar day from schedule JSON fields when due_date alone is missing. */
function openLoanDueOnCalendarDay(loan, row, year, month, day) {
  const dueStr = loan?.due_date ?? row?.due_date
  if (logbookCalendarDateMatches(dueStr, year, month, day)) {
    return {
      dueAmount:
        Number(loan?.pending_due ?? row?.pending_due) ||
        Number(loan?.total_amount_due ?? row?.total_amount_due) ||
        0,
      dueDate: dueStr || null,
      matchedBy: 'due_date',
    }
  }

  const scheduleFields = ['amortization', 'loan_principal_schedule', 'loan_interest_schedule']
  let scheduleTotal = 0
  let scheduleDate = null
  for (const field of scheduleFields) {
    const entries = parseLoandiskScheduleField(loan?.[field] ?? row?.[field])
    for (const entry of entries) {
      const entryDate =
        entry?.date ??
        entry?.due_date ??
        entry?.dueDate ??
        entry?.collection_date ??
        entry?.repayment_date
      if (!logbookCalendarDateMatches(entryDate, year, month, day)) continue
      scheduleTotal +=
        Number(
          entry?.amount ??
            entry?.principal ??
            entry?.due ??
            entry?.total ??
            entry?.repayment_amount ??
            0,
        ) || 0
      scheduleDate = entryDate || scheduleDate
    }
  }
  if (scheduleTotal > 0) {
    return { dueAmount: scheduleTotal, dueDate: scheduleDate, matchedBy: 'schedule' }
  }

  return null
}

/** Open loans due on a calendar day (latest PAR snapshot) for Daily Branch Breakdown drill-down. */
app.get('/api/logbook/collection/daily-open-loans', (req, res) => {
  try {
    const month = parseInt(req.query.month, 10)
    const year = parseInt(req.query.year, 10)
    const day = parseInt(req.query.day, 10)
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'month (1-12) is required' })
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'valid year is required' })
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'day (1-31) is required' })
    }

    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null && String(req.query.country).trim()
    if (countryParam && effectiveBranches.length === 0) {
      return res.json({ snapshotTime: null, date: null, branches: [] })
    }
    const allowedSet = effectiveBranches.length > 0 ? new Set(effectiveBranches) : null

    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    if (!latestPar?.time) {
      return res.json({ snapshotTime: null, date: null, branches: [] })
    }
    const snapshotTime = latestPar.time
    const branchFilter = req.query.branch != null ? String(req.query.branch).trim() : ''

    const dateLabel = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`

    const collectionsByLoan = new Map()
    const collectionsByBranch = new Map()
    let collectionRows = db.prepare(`
      SELECT loan_id, branch, repayment_amount, repayment_collected_date
      FROM Logbook_collection
      WHERE repayment_collected_date IS NOT NULL AND TRIM(repayment_collected_date) <> ''
    `).all()
    if (allowedSet) {
      collectionRows = collectionRows.filter((r) => {
        const code = String(r.branch ?? '').trim()
        return code && allowedSet.has(code)
      })
    }
    for (const r of collectionRows) {
      const p = parseLogbookCalendarDateParts(r.repayment_collected_date)
      if (!p || p.dd !== day || p.mm !== month || p.yyyy !== year) continue
      const loanId = String(r.loan_id ?? '').trim()
      const branchCode = String(r.branch ?? '').trim()
      const amt = Number(r.repayment_amount) || 0
      if (loanId) collectionsByLoan.set(loanId, (collectionsByLoan.get(loanId) || 0) + amt)
      if (branchCode) collectionsByBranch.set(branchCode, (collectionsByBranch.get(branchCode) || 0) + amt)
    }

    const loNameByCode = new Map()
    try {
      for (const lo of dbRW.prepare('SELECT borrower_access_id, name FROM LOs').all()) {
        const id = String(lo.borrower_access_id || '').trim()
        if (id) loNameByCode.set(id, String(lo.name || id).trim() || id)
      }
    } catch (e) {
      console.error('daily-open-loans LOs lookup:', e.message)
    }

    const branchNameByCode = new Map()
    for (const b of dbRW.prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1').all()) {
      const code = String(b.code ?? '').trim()
      if (code) branchNameByCode.set(code, String(b.name || code).trim())
    }

    const parseOfficerIds = (loan, row) => {
      const raw = loan?.borrower_access_ids ?? row?.borrower_access_ids
      if (!raw) return []
      if (Array.isArray(raw)) return raw.map((id) => String(id).trim()).filter(Boolean)
      try {
        const parsed = JSON.parse(String(raw))
        if (Array.isArray(parsed)) return parsed.map((id) => String(id).trim()).filter(Boolean)
        if (parsed) return [String(parsed).trim()].filter(Boolean)
      } catch {
        const str = String(raw).trim()
        return str ? [str] : []
      }
      return []
    }

    const openRows = db
      .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`)
      .all(snapshotTime)

    const byBranch = new Map()
    let scanned = 0
    let matched = 0
    const sampleDueDates = []

    for (const row of openRows) {
      const branchCode = String(row.branch_code || '').trim()
      if (!branchCode) continue
      if (allowedSet && !allowedSet.has(branchCode)) continue
      if (branchFilter && branchCode !== branchFilter) continue

      scanned += 1
      const loan = parseLoandiskLoanRecord(row)
      const dueMatch = openLoanDueOnCalendarDay(loan, row, year, month, day)
      if (!dueMatch) {
        const sample = loan?.due_date ?? row?.due_date
        if (sample && sampleDueDates.length < 12) sampleDueDates.push(String(sample))
        continue
      }
      matched += 1

      const loanId = String(loan?.loan_id ?? row.loan_id ?? '').trim()
      const pendingDue = dueMatch.dueAmount
      const borrowerName =
        [
          loan?.borrower_firstname ?? row.borrower_firstname,
          loan?.borrower_lastname ?? row.borrower_lastname,
          loan?.borrower_business_name ?? row.borrower_business_name,
        ]
          .filter(Boolean)
          .join(' ')
          .trim() || '—'

      const officerIds = parseOfficerIds(loan, row)
      const officerNames = officerIds.map((id) => loNameByCode.get(id) || id)
      const collected = loanId ? collectionsByLoan.get(loanId) || 0 : 0

      if (!byBranch.has(branchCode)) {
        byBranch.set(branchCode, {
          code: branchCode,
          name: branchNameByCode.get(branchCode) || branchCode,
          openLoansExpected: 0,
          loans: [],
        })
      }
      const entry = byBranch.get(branchCode)
      entry.openLoansExpected += pendingDue
      entry.loans.push({
        loanId,
        borrowerName,
        dueAmount: pendingDue,
        collected,
        dueDate: dueMatch.dueDate || row.due_date || loan?.due_date || null,
        matchedBy: dueMatch.matchedBy,
        principalBalance: Number(loan?.principal_balance_amount ?? row.principal_balance_amount) || 0,
        officerIds,
        officerNames,
      })
    }

    const branches = Array.from(byBranch.values())
      .map((b) => ({
        code: b.code,
        name: b.name,
        openLoansExpected: b.openLoansExpected,
        collected:
          collectionsByBranch.get(b.code) ||
          b.loans.reduce((sum, loan) => sum + (Number(loan.collected) || 0), 0),
        loans: b.loans.sort((a, bb) => (bb.dueAmount || 0) - (a.dueAmount || 0)),
      }))
      .sort((a, b) => b.openLoansExpected - a.openLoansExpected)

    res.json({
      snapshotTime,
      date: dateLabel,
      month,
      year,
      day,
      branches,
      meta: {
        scanned,
        matched,
        sampleDueDates,
      },
    })
  } catch (e) {
    console.error('daily-open-loans error:', e)
    res.status(500).json({ error: e.message })
  }
})

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

    const loRows = dbRW.prepare('SELECT borrower_access_id, name FROM LOs WHERE borrower_access_id IS NOT NULL').all();
    const loNameMap = new Map();
    const accessIdToLoName = new Map();
    for (const loRow of loRows) {
      const normalizedName = normalizeName(loRow.name);
      const accessId = String(loRow.borrower_access_id).trim();
      if (!accessId) continue;
      accessIdToLoName.set(accessId, loRow.name);
      if (normalizedName) {
        loNameMap.set(normalizedName, {
          borrower_access_id: accessId,
          name: loRow.name,
        });
      }
    }

    const findLoForRoName = (roName) => {
      const norm = normalizeName(roName);
      if (!norm) return null;
      if (loNameMap.has(norm)) return loNameMap.get(norm);
      for (const [loNorm, lo] of loNameMap.entries()) {
        if (norm.includes(loNorm) || loNorm.includes(norm)) return lo;
      }
      return null;
    };

    try {
      let targetRows = []
      try {
        targetRows = dbRW
          .prepare('SELECT loan_officer_name FROM RO_Targets WHERE month = ? AND year = ?')
          .all(monthNum, yearNum)
      } catch (e) {
        try {
          targetRows = dbRW
            .prepare('SELECT loan_officer_name FROM RO_Target WHERE month = ? AND year = ?')
            .all(monthNum, yearNum)
        } catch (e2) {
          console.error('Error fetching RO targets:', e2.message)
        }
      }

      for (const targetRow of targetRows) {
        const loMatch = findLoForRoName(targetRow.loan_officer_name);
        if (loMatch) {
          const borrowerId = loMatch.borrower_access_id;
          if (borrowerId && !borrowerMap.has(borrowerId)) {
            borrowerMap.set(borrowerId, {
              borrower_access_id: borrowerId,
              total_repayment_amount: 0,
              transaction_count: 0,
            });
          }
          if (borrowerId) {
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
            transaction_count: 0,
          });
        }

        if (!borrowerNameMap.has(borrowerId)) {
          const loName = accessIdToLoName.get(borrowerId);
          if (loName) borrowerNameMap.set(borrowerId, loName);
        }
        
        const entry = borrowerMap.get(borrowerId);
        entry.total_repayment_amount += amount;
        entry.transaction_count += 1;
      }
    }
    
    // Convert to array and sort by total repayment amount (descending)
    let rows = Array.from(borrowerMap.values())
      .map((row) => ({
        ...row,
        name:
          borrowerNameMap.get(String(row.borrower_access_id)) ||
          accessIdToLoName.get(String(row.borrower_access_id)) ||
          null,
      }))
      .sort((a, b) => (b.total_repayment_amount || 0) - (a.total_repayment_amount || 0));

    // Join with RO_Targets to get target by loan officer (access id + name)
    const targetByLoanOfficerName = new Map()
    const targetByAccessId = new Map()
    const principalBalanceByAccessId = new Map()
    try {
      const targetRows = dbRW
        .prepare(
          'SELECT loan_officer_name, sum_of_target, sum_of_principal_balance FROM RO_Targets WHERE month = ? AND year = ?',
        )
        .all(monthNum, yearNum)

      for (const t of targetRows) {
        const key = normalizeName(t.loan_officer_name)
        const amount = Number(t.sum_of_target) || 0
        const principal = Number(t.sum_of_principal_balance) || 0
        if (key) targetByLoanOfficerName.set(key, amount)
        const loMatch = findLoForRoName(t.loan_officer_name)
        if (loMatch?.borrower_access_id) {
          targetByAccessId.set(loMatch.borrower_access_id, amount)
          if (principal > 0) principalBalanceByAccessId.set(loMatch.borrower_access_id, principal)
        }
      }
    } catch (e) {
      // Backward-compat (if someone created RO_Target instead of RO_Targets)
      try {
        const targetRows = dbRW
          .prepare(
            'SELECT loan_officer_name, sum_of_target, sum_of_principal_balance FROM RO_Target WHERE month = ? AND year = ?',
          )
          .all(monthNum, yearNum)

        for (const t of targetRows) {
          const key = normalizeName(t.loan_officer_name)
          const amount = Number(t.sum_of_target) || 0
          const principal = Number(t.sum_of_principal_balance) || 0
          if (key) targetByLoanOfficerName.set(key, amount)
          const loMatch = findLoForRoName(t.loan_officer_name)
          if (loMatch?.borrower_access_id) {
            targetByAccessId.set(loMatch.borrower_access_id, amount)
            if (principal > 0) principalBalanceByAccessId.set(loMatch.borrower_access_id, principal)
          }
        }
      } catch (e2) {
        console.error('Error fetching RO targets:', e2.message)
      }
    }

    rows = rows.map((row) => {
      const id = String(row.borrower_access_id || '').trim()
      const name = borrowerNameMap.get(id) || accessIdToLoName.get(id) || null
      const key = normalizeName(name)
      const target =
        (id && targetByAccessId.has(id) ? targetByAccessId.get(id) : null) ??
        (key ? targetByLoanOfficerName.get(key) : null) ??
        null
      return {
        ...row,
        name,
        target,
        sum_of_principal_balance: id ? principalBalanceByAccessId.get(id) || 0 : 0,
      }
    })

    // Attach Portfolio (Open Loans) from latest PAR snapshot, grouped by borrower_access_id
    // Portfolio definition matches PAR per Borrower Access ID "Open Loans" calculation:
    // sum of principal balance amounts across open loans for each borrower_access_id.
    try {
      const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
      const latestTime = latestPar?.time
      if (latestTime) {
        const openLoansRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(latestTime)
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
            loan = parseLoandiskLoanRecord(row)
            if (!loan) continue
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
          const openRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(latestTime)
          const missedRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`).all(latestTime)
          const addFromLoanData = (arr) => {
            for (const row of arr) {
              if (!effectiveSet.has(String(row.branch_code ?? '').trim())) continue
              let loan = parseLoandiskLoanRecord(row)
              if (!loan) continue
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

  const proc = spawnNodeScript('scripts/fetch_disbursments.mjs', { env })
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

/** Branches that must not appear on Zidisha target creation (bad/duplicate names in source data). */
function isExcludedZidishaTargetBranch(name) {
  const key = String(name || '').trim().toLowerCase()
  if (!key) return true
  if (key === 'advans branch') return true
  if (key === 'kitengala' || key === 'kitengala branch') return true
  return false
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
  const loginId = String(req.body?.username || '').trim()
  const ip = getClientIp(req)
  const reject = (status, error, userRow = null) => {
    res.status(status).json({ error })
    const mapped = userRow ? mapUserRow(userRow) : null
    logLoginFailed({
      loginId: loginId || 'unknown',
      user: mapped,
      reason: error,
      ip,
      statusCode: status,
    }).catch(() => {})
  }
  try {
    const { username, password, superuserOnly } = req.body || {}
    if (!username || !password) {
      return reject(400, 'Username or email and password are required')
    }
    const user = findUserByUsernameOrEmail(loginId)
    if (!user) {
      return reject(401, 'Invalid credentials')
    }
    const emailOk = !!Number(user.email_verified || 0)
    const phoneOk = !!Number(user.phone_verified || 0)
    if (!emailOk && !phoneOk) {
      return reject(
        403,
        'Account not activated. Use the link sent to your email (if provided) or sign in with the SMS you received.',
        user
      )
    }
    if (!user.active) {
      return reject(403, 'User is deactivated', user)
    }
    const isSuperuser = String(user.role || '').toLowerCase() === 'superuser'
    
    // If superuserOnly flag is set, only allow superuser login
    if (superuserOnly && !isSuperuser) {
      return reject(403, 'Access denied. Superuser credentials required.', user)
    }
    
    const maintenanceOn = isMaintenanceEnabled()
    // During maintenance, only superusers can login (unless it's a superuser-only login attempt)
    if (maintenanceOn && !isSuperuser) {
      return reject(503, 'System under maintenance', user)
    }
    const passwordHash = hashPassword(password)
    if (passwordHash !== user.password_hash) {
      return reject(401, 'Invalid credentials', user)
    }
    const token = signAuthToken(user)
    setAuthCookie(res, token)
    const mapped = mapUserRow(user)
    res.json({ user: mapped, mustChangePassword: !!Number(user.must_change_password || 0) })
    // Fire-and-forget Telegram login notify for monitored users
    logLogin(mapped).catch(() => {})
  } catch (e) {
    logError({
      source: 'auth/login',
      message: e.message || String(e),
      stack: e.stack,
    }).catch(() => {})
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
  const loggedOutUser = req.authUser || null
  clearAuthCookie(res)
  res.json({ ok: true })
  if (loggedOutUser) {
    logLogout(loggedOutUser).catch(() => {})
  }
})

app.post('/api/activity-log', requireAuth, async (req, res) => {
  try {
    const user = req.authUser
    const { type, page, title, action } = req.body || {}
    switch (type) {
      case 'login':
        await logLogin(user)
        break
      case 'logout':
        await logLogout(user)
        break
      case 'pageView':
        await logPageView(user, page || '', title || '')
        break
      case 'action':
        await logAction(user, action || '')
        break
      default:
        return res.status(400).json({ error: `Unknown log type: ${type}` })
    }
    return res.json({ ok: true })
  } catch (e) {
    logError({
      source: 'activity-log',
      message: e.message || String(e),
      user: req.authUser || null,
      stack: e.stack,
    }).catch(() => {})
    return res.status(500).json({ error: e.message })
  }
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

        const rows = dbRW.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(latestTime)
        const sums = new Map()
        for (const r of rows) {
          const code = String(r.branch_code ?? '').trim()
          if (!code || !byCode.has(code)) continue // respect scope
          const loan = parseLoandiskLoanRecord(r)
          if (!loan) continue
          const principal = parseParLoanPrincipal(loan)
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
        const rows = dbRW.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(latestTime)
        const sums = new Map()
        for (const r of rows) {
          const code = String(r.branch_code ?? '').trim()
          if (!code || !byCode.has(code)) continue
          const loan = parseLoandiskLoanRecord(r)
          if (!loan) continue
          const principal = parseParLoanPrincipal(loan)
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
      { path: '/data/payments', label: 'Data - Payments', category: 'Data' },
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

function mapSalesPersonTargetRow(row) {
  return {
    id: row.id,
    salesPerson: row.sales_person,
    country: row.country || 'Kenya',
    month: Number(row.month),
    year: Number(row.year),
    disbursementTarget: Number(row.disbursement_target) || 0,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Active sales-person roster for a country (seeded + optional extras from disbursements). */
app.get('/api/logbook/sales-persons', (req, res) => {
  try {
    const country = String(req.query.country || 'Kenya').trim() || 'Kenya'
    const allRoster = dbRW
      .prepare(
        `SELECT id, name, country, active FROM Logbook_Sales_Persons
         WHERE country = ?
         ORDER BY active DESC, name COLLATE NOCASE`,
      )
      .all(country)

    const roster = allRoster.filter((r) => !!r.active)
    const inactiveRoster = allRoster.filter((r) => !r.active)

    // Sales persons seen on loans but not on the official (active) dropdown list
    let fromLoans = []
    try {
      fromLoans = db
        .prepare(
          `SELECT DISTINCT TRIM(sales_person) AS name
           FROM Logbook_Disbursement
           WHERE TRIM(country) = ?
             AND sales_person IS NOT NULL AND TRIM(sales_person) <> ''`,
        )
        .all(country)
    } catch {
      fromLoans = []
    }

    const seen = new Set(allRoster.map((r) => String(r.name).trim().toLowerCase()).filter(Boolean))
    const extras = []
    for (const r of fromLoans) {
      const name = String(r.name || '').trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      // Not on official dropdown → inactive by default
      extras.push({ id: null, name, country, active: false, fromLoans: true })
    }
    extras.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    res.json({
      country,
      roster: roster.map((r) => ({ id: r.id, name: r.name, country: r.country, active: true, fromLoans: false })),
      inactive: [
        ...inactiveRoster.map((r) => ({
          id: r.id,
          name: r.name,
          country: r.country,
          active: false,
          fromLoans: false,
        })),
        ...extras,
      ],
      extras, // kept for older clients; same as loan-only inactive names
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/logbook/sales-persons', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const name = String(req.body?.name || '').trim()
    const country = String(req.body?.country || 'Kenya').trim() || 'Kenya'
    if (!name) return res.status(400).json({ error: 'name is required' })
    dbRW
      .prepare(
        `INSERT INTO Logbook_Sales_Persons (name, country, active) VALUES (?, ?, 1)
         ON CONFLICT(name, country) DO UPDATE SET active = 1, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(name, country)
    res.json({ ok: true, name, country })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/targets/logbook-sales-person', (req, res) => {
  try {
    const country = req.query.country != null ? String(req.query.country).trim() : ''
    const month = req.query.month != null ? Number(req.query.month) : null
    const year = req.query.year != null ? Number(req.query.year) : null

    let sql = 'SELECT * FROM Logbook_Sales_Person_Targets WHERE 1=1'
    const params = []
    if (country) {
      sql += ' AND country = ?'
      params.push(country)
    }
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      sql += ' AND month = ?'
      params.push(month)
    }
    if (Number.isInteger(year) && year > 2000) {
      sql += ' AND year = ?'
      params.push(year)
    }
    sql += ' ORDER BY year DESC, month DESC, sales_person COLLATE NOCASE'

    const rows = dbRW.prepare(sql).all(...params).map(mapSalesPersonTargetRow)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** Bulk upsert monthly targets for many sales people (one month/year). */
app.post('/api/targets/logbook-sales-person/bulk', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const monthVal = Number(req.body?.month)
    const yearVal = Number(req.body?.year)
    const country = String(req.body?.country || 'Kenya').trim() || 'Kenya'
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }
    if (!items.length) return res.status(400).json({ error: 'items array is required' })

    const upsert = dbRW.prepare(`
      INSERT INTO Logbook_Sales_Person_Targets
        (sales_person, country, month, year, disbursement_target, active, updated_at)
      VALUES
        (@sales_person, @country, @month, @year, @disbursement_target, @active, CURRENT_TIMESTAMP)
      ON CONFLICT(sales_person, country, month, year) DO UPDATE SET
        disbursement_target = excluded.disbursement_target,
        active = excluded.active,
        updated_at = CURRENT_TIMESTAMP
    `)

    const ensurePerson = dbRW.prepare(`
      INSERT INTO Logbook_Sales_Persons (name, country, active) VALUES (?, ?, ?)
      ON CONFLICT(name, country) DO UPDATE SET
        active = excluded.active,
        updated_at = CURRENT_TIMESTAMP
    `)

    const tx = dbRW.transaction((list) => {
      let saved = 0
      for (const it of list) {
        const name = String(it.salesPerson || it.sales_person || it.name || '').trim()
        if (!name) continue
        const isActive = !(it.active === false || it.active === 0)
        // Only keep official/active people on the active roster; inactive stay inactive
        ensurePerson.run(name, country, isActive ? 1 : 0)
        upsert.run({
          sales_person: name,
          country,
          month: monthVal,
          year: yearVal,
          disbursement_target: Number(it.disbursementTarget ?? it.disbursement_target) || 0,
          active: isActive ? 1 : 0,
        })
        saved += 1
      }
      return saved
    })

    const saved = tx(items)
    res.json({ ok: true, saved, month: monthVal, year: yearVal, country })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/targets/logbook-sales-person', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const salesPerson = String(req.body?.salesPerson || req.body?.sales_person || '').trim()
    const country = String(req.body?.country || 'Kenya').trim() || 'Kenya'
    const monthVal = Number(req.body?.month)
    const yearVal = Number(req.body?.year)
    const disbursementTarget = Number(req.body?.disbursementTarget ?? req.body?.disbursement_target) || 0
    const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1
    if (!salesPerson || !Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'salesPerson, month (1-12), and year are required' })
    }
    dbRW
      .prepare(
        `INSERT INTO Logbook_Sales_Person_Targets
          (sales_person, country, month, year, disbursement_target, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(sales_person, country, month, year) DO UPDATE SET
           disbursement_target = excluded.disbursement_target,
           active = excluded.active,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(salesPerson, country, monthVal, yearVal, disbursementTarget, active)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/targets/logbook-sales-person/:id', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = dbRW.prepare('SELECT * FROM Logbook_Sales_Person_Targets WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Target not found' })

    const salesPerson =
      req.body?.salesPerson != null
        ? String(req.body.salesPerson).trim()
        : existing.sales_person
    const country =
      req.body?.country != null ? String(req.body.country).trim() || 'Kenya' : existing.country
    const monthVal =
      req.body?.month != null ? Number(req.body.month) : Number(existing.month)
    const yearVal = req.body?.year != null ? Number(req.body.year) : Number(existing.year)
    const disbursementTarget =
      req.body?.disbursementTarget != null
        ? Number(req.body.disbursementTarget) || 0
        : Number(existing.disbursement_target) || 0
    const active =
      req.body?.active != null
        ? req.body.active === false || req.body.active === 0
          ? 0
          : 1
        : existing.active

    dbRW
      .prepare(
        `UPDATE Logbook_Sales_Person_Targets SET
           sales_person = ?, country = ?, month = ?, year = ?,
           disbursement_target = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(salesPerson, country, monthVal, yearVal, disbursementTarget, active, id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/targets/logbook-sales-person/:id', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const result = dbRW.prepare('DELETE FROM Logbook_Sales_Person_Targets WHERE id = ?').run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'Target not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * Actual vs target for sales people in a month (uses Logbook_Disbursement.sales_person).
 * Includes MTD target (pro‑rata by working days) and performance category.
 * GET /api/targets/logbook-sales-person/performance?country=Kenya&month=8&year=2026
 */
app.get('/api/targets/logbook-sales-person/performance', (req, res) => {
  try {
    const country = String(req.query.country || 'Kenya').trim() || 'Kenya'
    const monthVal = Number(req.query.month)
    const yearVal = Number(req.query.year)
    if (!Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12 || !Number.isInteger(yearVal)) {
      return res.status(400).json({ error: 'month (1-12) and year are required' })
    }
    const monthPad = String(monthVal).padStart(2, '0')
    const likeDmy = `%/${monthPad}/${yearVal}`
    const likeIso = `${yearVal}-${monthPad}-%`

    // Working days / holidays from branch targets (same calendar for the country month)
    let holidays = []
    let workingDaysTotal = 0
    try {
      const bt = dbRW
        .prepare(
          `SELECT working_days, holidays FROM Logbook_Targets
           WHERE month = ? AND year = ? AND active = 1
           ORDER BY id DESC LIMIT 1`,
        )
        .get(monthVal, yearVal)
      if (bt) {
        try {
          holidays = bt.holidays ? JSON.parse(bt.holidays) : []
        } catch {
          holidays = []
        }
        workingDaysTotal = Number(bt.working_days) || 0
      }
    } catch {
      /* ignore */
    }
    if (!workingDaysTotal) {
      workingDaysTotal = calculateWorkingDays(monthVal, yearVal, holidays)
    }

    const today = new Date()
    const isFuture =
      yearVal > today.getFullYear() ||
      (yearVal === today.getFullYear() && monthVal > today.getMonth() + 1)
    let workingDaysElapsed = 0
    if (!isFuture) {
      const lastDay =
        yearVal === today.getFullYear() && monthVal === today.getMonth() + 1
          ? today.getDate()
          : new Date(yearVal, monthVal, 0).getDate()
      const holidaySet = new Set(
        (Array.isArray(holidays) ? holidays : []).map((d) => new Date(d).toDateString()),
      )
      for (let day = 1; day <= lastDay; day++) {
        const date = new Date(yearVal, monthVal - 1, day)
        if (date.getDay() === 0) continue
        if (holidaySet.has(date.toDateString())) continue
        workingDaysElapsed += 1
      }
      if (workingDaysTotal > 0) workingDaysElapsed = Math.min(workingDaysElapsed, workingDaysTotal)
    }
    const mtdFraction =
      workingDaysTotal > 0 ? workingDaysElapsed / workingDaysTotal : 0

    // Official active roster + monthly targets
    const roster = dbRW
      .prepare(
        `SELECT name FROM Logbook_Sales_Persons WHERE country = ? AND active = 1`,
      )
      .all(country)
    const targets = dbRW
      .prepare(
        `SELECT sales_person, disbursement_target, active
         FROM Logbook_Sales_Person_Targets
         WHERE country = ? AND month = ? AND year = ?`,
      )
      .all(country, monthVal, yearVal)

    // Actuals + primary branch (highest amount) for the month
    const actuals = db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(sales_person), ''), 'Unknown') AS sales_person,
           TRIM(branch) AS branch,
           COUNT(*) AS loans,
           SUM(COALESCE(CAST(disbursed AS REAL), 0)) AS total_disbursed
         FROM Logbook_Disbursement
         WHERE TRIM(country) = ?
           AND (disbursed_date LIKE ? OR disbursed_date LIKE ?)
         GROUP BY COALESCE(NULLIF(TRIM(sales_person), ''), 'Unknown'), TRIM(branch)`,
      )
      .all(country, likeDmy, likeIso)

    // Fallback branch from any historical loan if no MTD activity
    const histBranches = db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(sales_person), ''), 'Unknown') AS sales_person,
           TRIM(branch) AS branch,
           COUNT(*) AS n
         FROM Logbook_Disbursement
         WHERE TRIM(country) = ?
           AND sales_person IS NOT NULL AND TRIM(sales_person) <> ''
         GROUP BY COALESCE(NULLIF(TRIM(sales_person), ''), 'Unknown'), TRIM(branch)`,
      )
      .all(country)

    const branchNameByCode = new Map()
    try {
      for (const b of dbRW.prepare(`SELECT code, name FROM Logbook_Branches`).all()) {
        branchNameByCode.set(String(b.code || '').trim(), String(b.name || '').trim())
      }
    } catch {
      /* ignore */
    }
    const resolveBranch = (code) => {
      const c = String(code || '').trim()
      if (!c) return '—'
      const n = branchNameByCode.get(c)
      return n ? n.replace(/\s*branch$/i, '').trim().toUpperCase() : c
    }

    const byName = new Map()
    const ensure = (name, opts = {}) => {
      const key = name.toLowerCase()
      if (!byName.has(key)) {
        byName.set(key, {
          salesPerson: name,
          monthlyTarget: 0,
          active: true,
          loans: 0,
          actual: 0,
          branchCode: null,
          branchAmount: -1,
        })
      }
      const row = byName.get(key)
      if (opts.monthlyTarget != null) row.monthlyTarget = opts.monthlyTarget
      if (opts.active != null) row.active = opts.active
      return row
    }

    for (const r of roster) {
      const name = String(r.name || '').trim()
      if (name) ensure(name, { active: true })
    }
    for (const t of targets) {
      const name = String(t.sales_person || '').trim()
      if (!name) continue
      ensure(name, {
        monthlyTarget: Number(t.disbursement_target) || 0,
        active: t.active !== 0,
      })
    }

    for (const a of actuals) {
      const name = String(a.sales_person || '').trim()
      if (!name) continue
      const row = ensure(name)
      const amt = Number(a.total_disbursed) || 0
      const loans = Number(a.loans) || 0
      row.actual += amt
      row.loans += loans
      if (amt > row.branchAmount) {
        row.branchAmount = amt
        row.branchCode = a.branch
      }
    }

    for (const h of histBranches) {
      const name = String(h.sales_person || '').trim()
      if (!name) continue
      const row = byName.get(name.toLowerCase())
      if (!row || row.branchCode) continue
      const n = Number(h.n) || 0
      if (n > (row._histN || 0)) {
        row._histN = n
        row.branchCode = h.branch
      }
    }

    const categorize = (pct, actual) => {
      if (!actual || actual <= 0 || pct == null || pct <= 0) return 'NON PERFORMER'
      if (pct >= 70) return 'PERFORMER'
      if (pct >= 40) return 'AVERAGE PERFORMER'
      return 'BELOW AVERAGE PERFORMER'
    }

    // Kenya page: only active roster (+ people with targets). Drop random loan-only names.
    const rows = [...byName.values()]
      .filter((r) => r.active || r.monthlyTarget > 0)
      .map((r) => {
        const mtdTarget = r.monthlyTarget * mtdFraction
        const achievementPct = mtdTarget > 0 ? (r.actual / mtdTarget) * 100 : r.actual > 0 ? null : 0
        const category = categorize(achievementPct, r.actual)
        return {
          salesPerson: r.salesPerson,
          branch: resolveBranch(r.branchCode),
          staff: 1,
          monthlyTarget: r.monthlyTarget,
          mtdTarget,
          actual: r.actual,
          loans: r.loans,
          achievementPct,
          category,
          active: r.active,
        }
      })
      .sort((a, b) => {
        const order = {
          PERFORMER: 0,
          'AVERAGE PERFORMER': 1,
          'BELOW AVERAGE PERFORMER': 2,
          'NON PERFORMER': 3,
        }
        const ca = order[a.category] ?? 9
        const cb = order[b.category] ?? 9
        if (ca !== cb) return ca - cb
        return (b.achievementPct || 0) - (a.achievementPct || 0)
      })

    const summary = rows.reduce(
      (acc, r) => {
        acc.staff += 1
        acc.monthlyTarget += r.monthlyTarget
        acc.mtdTarget += r.mtdTarget
        acc.actual += r.actual
        return acc
      },
      { staff: 0, monthlyTarget: 0, mtdTarget: 0, actual: 0 },
    )
    summary.achievementPct =
      summary.mtdTarget > 0 ? (summary.actual / summary.mtdTarget) * 100 : null

    res.json({
      country,
      month: monthVal,
      year: yearVal,
      workingDaysTotal,
      workingDaysElapsed,
      mtdFraction,
      rows,
      summary,
    })
  } catch (e) {
    console.error('[Sales Person Performance]', e)
    res.status(500).json({ error: e.message })
  }
})

// Zidisha branches for targets (all branches: from Zidisha_Targets + zidisha_data, no user filter)
app.get('/api/zidisha/branches/all', (req, res) => {
  try {
    const fromTargets = dbRW
      .prepare(
        "SELECT DISTINCT TRIM(branch) AS name FROM Zidisha_Targets WHERE branch IS NOT NULL AND TRIM(branch) <> ''",
      )
      .all()
    const fromData = db
      .prepare(
        `
      SELECT DISTINCT TRIM("Branch Name") AS name
      FROM zidisha_data
      WHERE "Branch Name" IS NOT NULL AND TRIM("Branch Name") <> '' AND LOWER(TRIM("Branch Name")) <> 'advans branch'
    `,
      )
      .all()
    const seen = new Set()
    const names = []
    for (const row of [...fromTargets, ...fromData]) {
      const name = String(row?.name || '').trim()
      if (!name || seen.has(name.toLowerCase()) || isExcludedZidishaTargetBranch(name)) continue
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

// --- Payment obligations (vendor / SaaS recurring bills) ---
const DEFAULT_PAYMENT_REMINDER_EMAIL = 'gregory@phoenixcapital.co.ke'

const mapPaymentObligationRow = (row) => ({
  id: row.id,
  name: row.name,
  dueDay: row.due_day == null ? null : Number(row.due_day),
  amountDisplay: row.amount_display || '',
  amountValue: row.amount_value == null ? null : Number(row.amount_value),
  currency: row.currency || '',
  notes: row.notes || '',
  reminderDaysBefore: Number(row.reminder_days_before) || 3,
  reminderEmail: row.reminder_email || DEFAULT_PAYMENT_REMINDER_EMAIL,
  active: !!row.active,
  lastRemindedPeriod: row.last_reminded_period || null,
  lastRemindedAt: row.last_reminded_at || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

function paymentDueDateForMonth(year, month, dueDay) {
  if (!Number.isInteger(dueDay) || dueDay < 1) return null
  const daysInMonth = new Date(year, month, 0).getDate()
  const day = Math.min(dueDay, daysInMonth)
  return { year, month, day }
}

function daysBetweenNairobiDates(a, b) {
  const utcA = Date.UTC(a.year, a.month - 1, a.day)
  const utcB = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((utcB - utcA) / 86400000)
}

function enrichPaymentObligation(row, todayParts = nairobiDateParts()) {
  const mapped = mapPaymentObligationRow(row)
  const dueDay = mapped.dueDay
  if (!dueDay) {
    return { ...mapped, nextDueDate: null, daysUntilDue: null, inReminderWindow: false }
  }
  let due = paymentDueDateForMonth(todayParts.year, todayParts.month, dueDay)
  let daysUntil = daysBetweenNairobiDates(todayParts, due)
  if (daysUntil < 0) {
    let y = todayParts.year
    let m = todayParts.month + 1
    if (m > 12) {
      m = 1
      y += 1
    }
    due = paymentDueDateForMonth(y, m, dueDay)
    daysUntil = daysBetweenNairobiDates(todayParts, due)
  }
  const nextDueDate = due
    ? `${due.year}-${String(due.month).padStart(2, '0')}-${String(due.day).padStart(2, '0')}`
    : null
  const reminderDays = mapped.reminderDaysBefore > 0 ? mapped.reminderDaysBefore : 3
  const inReminderWindow = daysUntil != null && daysUntil >= 0 && daysUntil <= reminderDays
  return { ...mapped, nextDueDate, daysUntilDue: daysUntil, inReminderWindow }
}

function formatPaymentAmountLabel(item) {
  if (item.amountDisplay) return item.amountDisplay
  if (item.amountValue != null && Number.isFinite(item.amountValue)) {
    const cur = item.currency ? `${item.currency} ` : ''
    return `${cur}${Number(item.amountValue).toLocaleString('en-US')}`
  }
  return '—'
}

async function sendPaymentObligationReminders({ force = false } = {}) {
  const enabled = String(process.env.PAYMENT_REMINDER_EMAIL_ENABLED ?? 'true').toLowerCase()
  if (!force && (enabled === 'false' || enabled === '0' || enabled === 'off')) {
    return { ok: false, skipped: true, reason: 'PAYMENT_REMINDER_EMAIL_ENABLED is off' }
  }

  const today = nairobiDateParts()
  const paidForPeriod = dbRW.prepare(
    `SELECT 1 AS ok FROM Payment_Obligation_Months
     WHERE obligation_id = ? AND year = ? AND month = ? AND paid = 1 LIMIT 1`,
  )
  const rows = dbRW
    .prepare(`SELECT * FROM Payment_Obligations WHERE active = 1 ORDER BY due_day IS NULL, due_day, name COLLATE NOCASE`)
    .all()
    .map((r) => enrichPaymentObligation(r, today))
    .filter((r) => {
      if (!r.nextDueDate) return true
      const [y, m] = r.nextDueDate.split('-').map(Number)
      return !paidForPeriod.get(r.id, y, m)
    })

  const dueSoon = rows.filter((r) => r.dueDay && r.inReminderWindow)
  if (!dueSoon.length) {
    return { ok: true, sent: 0, skipped: true, reason: 'No unpaid payments in reminder window', checked: rows.length }
  }

  const defaultTo =
    String(process.env.PAYMENT_REMINDER_EMAIL_TO || DEFAULT_PAYMENT_REMINDER_EMAIL).trim() ||
    DEFAULT_PAYMENT_REMINDER_EMAIL

  // Group by reminder email
  const byEmail = new Map()
  for (const item of dueSoon) {
    const to = String(item.reminderEmail || defaultTo).trim() || defaultTo
    const period = item.nextDueDate ? item.nextDueDate.slice(0, 7) : `${today.year}-${String(today.month).padStart(2, '0')}`
    if (!force && item.lastRemindedPeriod === period) continue
    if (!byEmail.has(to)) byEmail.set(to, [])
    byEmail.get(to).push({ ...item, period })
  }

  if (![...byEmail.values()].some((list) => list.length)) {
    return { ok: true, sent: 0, skipped: true, reason: 'Already reminded this period', dueSoon: dueSoon.length }
  }

  const markStmt = dbRW.prepare(`
    UPDATE Payment_Obligations
    SET last_reminded_period = @period, last_reminded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `)

  let emailsSent = 0
  const results = []
  for (const [to, items] of byEmail.entries()) {
    if (!items.length) continue
    const lines = items
      .sort((a, b) => (a.daysUntilDue ?? 99) - (b.daysUntilDue ?? 99))
      .map((item) => {
        const when =
          item.daysUntilDue === 0
            ? 'due TODAY'
            : item.daysUntilDue === 1
              ? 'due tomorrow'
              : `due in ${item.daysUntilDue} days`
        return `• ${item.name} — ${when} (${item.nextDueDate}) — ${formatPaymentAmountLabel(item)}`
      })
    const subject = `Payment reminder: ${items.length} bill(s) due soon`
    const text =
      `Hi Gregory,\n\n` +
      `The following recurring payments are approaching their deadline:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Please arrange payment before the due date.\n\n` +
      `— EXCO Payments tracker\n`
    const html = `
      <p>Hi Gregory,</p>
      <p>The following recurring payments are approaching their deadline:</p>
      <ul>
        ${items
          .sort((a, b) => (a.daysUntilDue ?? 99) - (b.daysUntilDue ?? 99))
          .map(
            (item) =>
              `<li><strong>${item.name}</strong> — ${
                item.daysUntilDue === 0
                  ? 'due <strong>TODAY</strong>'
                  : item.daysUntilDue === 1
                    ? 'due tomorrow'
                    : `due in ${item.daysUntilDue} days`
              } (${item.nextDueDate}) — ${formatPaymentAmountLabel(item)}</li>`,
          )
          .join('')}
      </ul>
      <p>Please arrange payment before the due date.</p>
      <p style="color:#666;font-size:12px">— EXCO Payments tracker</p>
    `
    const sendResult = await sendEmail({ to, subject, text, html })
    results.push({ to, count: items.length, ...sendResult })
    if (sendResult.ok || sendResult.skipped) {
      // Mark even when SMTP skipped (dev) so we don't spam logs every minute in tests with force=false
      if (sendResult.ok || force) {
        for (const item of items) markStmt.run({ id: item.id, period: item.period })
      } else if (sendResult.skipped) {
        for (const item of items) markStmt.run({ id: item.id, period: item.period })
      }
      emailsSent += 1
    }
  }

  return { ok: true, sent: emailsSent, results, dueSoon: dueSoon.length }
}

app.get('/api/payments', requireAuth, (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '') === '1'
    const today = nairobiDateParts()
    let monthVal = Number(req.query.month)
    let yearVal = Number(req.query.year)
    if (!Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12) monthVal = today.month
    if (!Number.isInteger(yearVal) || yearVal < 2000) yearVal = today.year

    const sql = includeInactive
      ? `SELECT * FROM Payment_Obligations ORDER BY due_day IS NULL, due_day, name COLLATE NOCASE`
      : `SELECT * FROM Payment_Obligations WHERE active = 1 ORDER BY due_day IS NULL, due_day, name COLLATE NOCASE`

    const paidRows = dbRW
      .prepare(
        `SELECT obligation_id, paid, paid_at, notes
         FROM Payment_Obligation_Months
         WHERE year = ? AND month = ?`,
      )
      .all(yearVal, monthVal)
    const paidById = new Map(paidRows.map((r) => [r.obligation_id, r]))

    const rows = dbRW.prepare(sql).all().map((r) => {
      const enriched = enrichPaymentObligation(r, today)
      const paidRow = paidById.get(r.id)
      return {
        ...enriched,
        paid: !!(paidRow && paidRow.paid),
        paidAt: paidRow?.paid_at || null,
        monthNotes: paidRow?.notes || '',
        trackingMonth: monthVal,
        trackingYear: yearVal,
      }
    })
    res.json({
      items: rows,
      month: monthVal,
      year: yearVal,
      reminderEmailDefault: process.env.PAYMENT_REMINDER_EMAIL_TO || DEFAULT_PAYMENT_REMINDER_EMAIL,
      asOf: `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/payments', requireAuth, (req, res) => {
  try {
    const body = req.body || {}
    const name = String(body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name is required' })
    let dueDay = body.dueDay == null || body.dueDay === '' ? null : Number(body.dueDay)
    if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      return res.status(400).json({ error: 'dueDay must be 1–31 or empty' })
    }
    const reminderDaysBefore = Number(body.reminderDaysBefore)
    const reminderEmail =
      String(body.reminderEmail || process.env.PAYMENT_REMINDER_EMAIL_TO || DEFAULT_PAYMENT_REMINDER_EMAIL).trim() ||
      DEFAULT_PAYMENT_REMINDER_EMAIL
    const result = dbRW
      .prepare(
        `INSERT INTO Payment_Obligations
          (name, due_day, amount_display, amount_value, currency, notes, reminder_days_before, reminder_email, active)
         VALUES
          (@name, @due_day, @amount_display, @amount_value, @currency, @notes, @reminder_days_before, @reminder_email, @active)`,
      )
      .run({
        name,
        due_day: dueDay,
        amount_display: String(body.amountDisplay || '').trim() || null,
        amount_value:
          body.amountValue === '' || body.amountValue == null ? null : Number(body.amountValue),
        currency: String(body.currency || '').trim() || null,
        notes: String(body.notes || '').trim() || null,
        reminder_days_before:
          Number.isInteger(reminderDaysBefore) && reminderDaysBefore >= 0 ? reminderDaysBefore : 3,
        reminder_email: reminderEmail,
        active: body.active === false || body.active === 0 ? 0 : 1,
      })
    const row = dbRW.prepare('SELECT * FROM Payment_Obligations WHERE id = ?').get(result.lastInsertRowid)
    res.json(enrichPaymentObligation(row))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/payments/:id', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = dbRW.prepare('SELECT * FROM Payment_Obligations WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Payment not found' })
    const body = req.body || {}
    const name = body.name != null ? String(body.name).trim() : existing.name
    if (!name) return res.status(400).json({ error: 'name is required' })
    let dueDay =
      body.dueDay === undefined
        ? existing.due_day
        : body.dueDay === '' || body.dueDay == null
          ? null
          : Number(body.dueDay)
    if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      return res.status(400).json({ error: 'dueDay must be 1–31 or empty' })
    }
    const reminderDaysBefore =
      body.reminderDaysBefore != null ? Number(body.reminderDaysBefore) : existing.reminder_days_before
    dbRW
      .prepare(
        `UPDATE Payment_Obligations SET
          name = @name,
          due_day = @due_day,
          amount_display = @amount_display,
          amount_value = @amount_value,
          currency = @currency,
          notes = @notes,
          reminder_days_before = @reminder_days_before,
          reminder_email = @reminder_email,
          active = @active,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({
        id,
        name,
        due_day: dueDay,
        amount_display:
          body.amountDisplay !== undefined
            ? String(body.amountDisplay || '').trim() || null
            : existing.amount_display,
        amount_value:
          body.amountValue !== undefined
            ? body.amountValue === '' || body.amountValue == null
              ? null
              : Number(body.amountValue)
            : existing.amount_value,
        currency:
          body.currency !== undefined ? String(body.currency || '').trim() || null : existing.currency,
        notes: body.notes !== undefined ? String(body.notes || '').trim() || null : existing.notes,
        reminder_days_before:
          Number.isInteger(reminderDaysBefore) && reminderDaysBefore >= 0
            ? reminderDaysBefore
            : existing.reminder_days_before,
        reminder_email:
          body.reminderEmail !== undefined
            ? String(body.reminderEmail || '').trim() || DEFAULT_PAYMENT_REMINDER_EMAIL
            : existing.reminder_email,
        active:
          body.active !== undefined
            ? body.active === false || body.active === 0
              ? 0
              : 1
            : existing.active,
      })
    const row = dbRW.prepare('SELECT * FROM Payment_Obligations WHERE id = ?').get(id)
    res.json(enrichPaymentObligation(row))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/payments/:id', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    dbRW.prepare('DELETE FROM Payment_Obligation_Months WHERE obligation_id = ?').run(id)
    const result = dbRW.prepare('DELETE FROM Payment_Obligations WHERE id = ?').run(id)
    if (result.changes === 0) return res.status(404).json({ error: 'Payment not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/payments/:id/month-status', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = dbRW.prepare('SELECT id FROM Payment_Obligations WHERE id = ?').get(id)
    if (!existing) return res.status(404).json({ error: 'Payment not found' })

    const today = nairobiDateParts()
    const body = req.body || {}
    let monthVal = Number(body.month)
    let yearVal = Number(body.year)
    if (!Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12) monthVal = today.month
    if (!Number.isInteger(yearVal) || yearVal < 2000) yearVal = today.year
    const paid = body.paid === true || body.paid === 1 || body.paid === '1'
    const notes = body.notes != null ? String(body.notes).trim() || null : null

    dbRW
      .prepare(
        `INSERT INTO Payment_Obligation_Months
          (obligation_id, year, month, paid, paid_at, notes, updated_at)
         VALUES
          (@obligation_id, @year, @month, @paid, @paid_at, @notes, CURRENT_TIMESTAMP)
         ON CONFLICT(obligation_id, year, month) DO UPDATE SET
           paid = excluded.paid,
           paid_at = excluded.paid_at,
           notes = COALESCE(excluded.notes, Payment_Obligation_Months.notes),
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run({
        obligation_id: id,
        year: yearVal,
        month: monthVal,
        paid: paid ? 1 : 0,
        paid_at: paid ? new Date().toISOString() : null,
        notes,
      })

    const row = dbRW
      .prepare(
        `SELECT paid, paid_at, notes FROM Payment_Obligation_Months
         WHERE obligation_id = ? AND year = ? AND month = ?`,
      )
      .get(id, yearVal, monthVal)

    res.json({
      ok: true,
      obligationId: id,
      year: yearVal,
      month: monthVal,
      paid: !!(row && row.paid),
      paidAt: row?.paid_at || null,
      notes: row?.notes || '',
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/payments/reminders/send', requireAuth, async (req, res) => {
  try {
    const force = !!(req.body && req.body.force)
    const result = await sendPaymentObligationReminders({ force })
    res.json(result)
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
    const rows = dbRW.prepare(`
      SELECT time, Past_Arrears_missed, Open_loans,
             par_30, par_60, par_90, par_90_plus
      FROM PAR ORDER BY time DESC
    `).all()
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
        SELECT snapshot_time, open_loans, past_missed, branches,
               par_30, par_60, par_90, par_90_plus
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

      const existing = bySnapshot.get(snapshot) || {
        time: snapshot,
        Past_Arrears_missed: 0,
        Open_loans: 0,
        par_30: 0,
        par_60: 0,
        par_90: 0,
        par_90_plus: 0,
      }
      existing.Past_Arrears_missed += missed
      existing.Open_loans += open
      existing.par_30 += Number(row.par_30) || 0
      existing.par_60 += Number(row.par_60) || 0
      existing.par_90 += Number(row.par_90) || 0
      existing.par_90_plus += Number(row.par_90_plus) || 0
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

/** Past_Missed_repayment table layout + column list (Loandisk fields flattened). */
app.get('/api/par/past-missed/schema', requireAuth, (req, res) => {
  try {
    const cols = dbRW.prepare(`PRAGMA table_info(Past_Missed_repayment)`).all()
    res.json({
      table: 'Past_Missed_repayment',
      description:
        'One row per past-missed/arrears/past-maturity loan per PAR snapshot. Loandisk fields stored in columns (no loan_data JSON blob).',
      snapshotKeys: ['id', 'branch_code', 'time'],
      loandiskColumns: LOANDISK_LOAN_DB_COLUMNS,
      agingField: 'days_past_due',
      delinquencyStatusFields: ['child_status_id', 'loan_status_id'],
      sqliteColumns: cols.map((c) => ({ name: c.name, type: c.type, pk: c.pk })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** Query past-missed loans as column rows (latest snapshot unless ?time=). */
app.get('/api/par/past-missed/loans', requireAuth, (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const branch = req.query.branch != null ? String(req.query.branch).trim() : ''
    const limitRaw = Number(req.query.limit ?? 100)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 5000)
    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    const snapshotTime = req.query.time != null ? String(req.query.time).trim() : latestPar?.time
    if (!snapshotTime) return res.json({ time: null, count: 0, rows: [] })

    const selectCols = ['id', 'branch_code', 'time', ...LOANDISK_LOAN_DB_COLUMNS].join(', ')
    const rows = branch
      ? db
          .prepare(
            `SELECT ${selectCols} FROM Past_Missed_repayment WHERE time = ? AND branch_code = ? LIMIT ?`,
          )
          .all(snapshotTime, branch, limit)
      : db.prepare(`SELECT ${selectCols} FROM Past_Missed_repayment WHERE time = ? LIMIT ?`).all(snapshotTime, limit)

    res.json({ time: snapshotTime, branch: branch || null, count: rows.length, rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

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
    const openLoansRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(snapshotTime)
    const pastMissedRows = db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`).all(snapshotTime)

    const { branches: branchParMap } = aggregateParFromSnapshotLoanRows(openLoansRows, pastMissedRows)

    const branchData = []

    // Build branch data from aggregated records
    for (const branch of activeBranches) {
      const branchCode = String(branch.code ?? '').trim()
      if (!branchCode) continue
      
      const agg = branchParMap[branchCode] || finalizeParTotals(createParTotals())

      branchData.push({
        code: branchCode,
        name: branch.name || branchCode,
        pastMissed: agg.pastMissed,
        openLoans: agg.openLoans,
        parRate: agg.parRate,
        par30: agg.par30,
        par60: agg.par60,
        par90: agg.par90,
        par90Plus: agg.par90Plus,
        par30Rate: agg.par30Rate,
        par60Rate: agg.par60Rate,
        par90Rate: agg.par90Rate,
        par90PlusRate: agg.par90PlusRate,
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

function nairobiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

/** Previous calendar month-end at 23:00 Africa/Nairobi (as UTC Date). */
function previousMonthEnd23Nairobi(now = new Date()) {
  const { year, month } = nairobiDateParts(now)
  let y = year
  let m = month - 1
  if (m < 1) {
    m = 12
    y -= 1
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  // 23:00 EAT = 20:00 UTC
  return {
    target: new Date(Date.UTC(y, m - 1, lastDay, 20, 0, 0, 0)),
    year: y,
    month: m,
    day: lastDay,
  }
}

function findClosestParSnapshotTime(targetDate, { preferOnOrBefore = true } = {}) {
  const targetMs = targetDate.getTime()
  if (!Number.isFinite(targetMs)) return null
  const rows = db.prepare('SELECT time FROM PAR').all()
  let best = null
  let bestScore = Infinity
  for (const row of rows) {
    const time = String(row.time || '').trim()
    if (!time) continue
    const ms = new Date(time).getTime()
    if (!Number.isFinite(ms)) continue
    const delta = ms - targetMs
    const abs = Math.abs(delta)
    let score = abs
    if (preferOnOrBefore) {
      // Prefer snapshots at/before target; small grace after target is still ok.
      if (delta > 3 * 60 * 60 * 1000) score = abs + 1e15
      else if (delta > 0) score = abs + 1e9
    }
    if (score < bestScore) {
      bestScore = score
      best = time
    }
  }
  return best
}

/** Closest PAR.time within ±maxAbsHours of target (absolute distance). */
function findClosestParSnapshotTimeNear(targetDate, { maxAbsHours = 6 } = {}) {
  const targetMs = targetDate.getTime()
  if (!Number.isFinite(targetMs)) return null
  const maxAbs = Math.max(0.5, Number(maxAbsHours) || 6) * 60 * 60 * 1000
  const rows = db.prepare('SELECT time FROM PAR').all()
  let best = null
  let bestAbs = Infinity
  for (const row of rows) {
    const time = String(row.time || '').trim()
    if (!time) continue
    const ms = new Date(time).getTime()
    if (!Number.isFinite(ms)) continue
    const abs = Math.abs(ms - targetMs)
    if (abs > maxAbs) continue
    if (abs < bestAbs) {
      bestAbs = abs
      best = time
    }
  }
  return best
}

/** Africa/Nairobi wall clock → UTC Date (EAT = UTC+3 year-round). */
function nairobiWallClockUtc(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 3, Number(minute) || 0, 0, 0))
}

function createRiskSplitTotals() {
  return { openLoans: 0, missed: 0, arrears: 0, pastMaturity: 0 }
}

function classifyPastMissedChildStatus(loan, row) {
  const raw = String(row?.child_status_id ?? loan?.child_status_id ?? '').trim()
  if (raw === '6') return 'pastMaturity'
  if (raw === '16') return 'arrears'
  if (raw === '5') return 'missed'
  // Fallback: treat unknown delinquency as missed repayment
  return 'missed'
}

function aggregateBranchRiskSplit(openLoansRows, pastMissedRows) {
  const byBranch = new Map()
  const ensure = (code) => {
    const key = String(code || '').trim()
    if (!byBranch.has(key)) byBranch.set(key, createRiskSplitTotals())
    return byBranch.get(key)
  }

  for (const row of openLoansRows || []) {
    try {
      const loan = parseLoandiskLoanRecord(row)
      if (!loan) continue
      const p = parseParLoanPrincipal(loan)
      if (p > 0) ensure(row.branch_code).openLoans += p
    } catch {
      continue
    }
  }

  for (const row of pastMissedRows || []) {
    try {
      const loan = parseLoandiskLoanRecord(row)
      if (!loan) continue
      const p = parseParLoanPrincipal(loan)
      if (p <= 0) continue
      const bucket = classifyPastMissedChildStatus(loan, row)
      ensure(row.branch_code)[bucket] += p
    } catch {
      continue
    }
  }

  return byBranch
}

function buildParBranchRowsForSnapshot(snapshotTime, { countryParam = '', effectiveBranches = [] } = {}) {
  let activeBranches
  if (countryParam) {
    activeBranches = dbRW
      .prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1 AND country = ?')
      .all(countryParam)
  } else {
    activeBranches = dbRW.prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1').all()
  }
  if (!activeBranches.length || !snapshotTime) return []

  const openLoansRows = db
    .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`)
    .all(snapshotTime)
  const pastMissedRows = db
    .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`)
    .all(snapshotTime)
  const riskByBranch = aggregateBranchRiskSplit(openLoansRows, pastMissedRows)

  const effectiveSet = effectiveBranches.length > 0 ? new Set(effectiveBranches) : null
  const branchData = []
  for (const branch of activeBranches) {
    const branchCode = String(branch.code ?? '').trim()
    if (!branchCode) continue
    if (effectiveSet && !effectiveSet.has(branchCode)) continue
    const agg = riskByBranch.get(branchCode) || createRiskSplitTotals()
    const atRisk = (agg.missed || 0) + (agg.arrears || 0) + (agg.pastMaturity || 0)
    branchData.push({
      code: branchCode,
      name: branch.name || branchCode,
      openLoans: Math.round(agg.openLoans || 0),
      missed: Math.round(agg.missed || 0),
      arrears: Math.round(agg.arrears || 0),
      pastMaturity: Math.round(agg.pastMaturity || 0),
      pastMissed: Math.round(atRisk),
    })
  }
  return branchData
}

/** Relationship officer (borrower_access_id) PAR rows for a single snapshot — same metrics as branch rows. */
function buildParOfficerRowsForSnapshot(
  snapshotTime,
  { countryParam = '', effectiveBranches = [], officerIds = null } = {},
) {
  if (!snapshotTime) return []

  let openLoansRows = db
    .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`)
    .all(snapshotTime)
  let pastMissedRows = db
    .prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`)
    .all(snapshotTime)

  let branchFilter = null
  if (effectiveBranches.length > 0) {
    branchFilter = new Set(effectiveBranches.map((c) => String(c).trim()).filter(Boolean))
  } else if (countryParam) {
    const codes = dbRW
      .prepare('SELECT code FROM Logbook_Branches WHERE active = 1 AND country = ?')
      .all(countryParam)
      .map((r) => String(r.code ?? '').trim())
      .filter(Boolean)
    branchFilter = new Set(codes)
  }
  if (branchFilter) {
    openLoansRows = openLoansRows.filter((r) => branchFilter.has(String(r.branch_code ?? '').trim()))
    pastMissedRows = pastMissedRows.filter((r) => branchFilter.has(String(r.branch_code ?? '').trim()))
  }

  const officerIdFilter =
    officerIds instanceof Set
      ? officerIds
      : Array.isArray(officerIds) && officerIds.length
        ? new Set(officerIds.map((id) => String(id).trim()).filter(Boolean))
        : null

  const loNameById = new Map()
  try {
    for (const row of dbRW.prepare('SELECT borrower_access_id, name FROM LOs').all()) {
      const id = String(row.borrower_access_id ?? '').trim()
      if (id) loNameById.set(id, String(row.name || '').trim() || id)
    }
  } catch {
    /* ignore */
  }

  const officerMap = new Map()
  const accumulate = (rows, kind) => {
    for (const row of rows) {
      try {
        const loan = parseLoandiskLoanRecord(row)
        if (!loan) continue
        const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
        if (!borrowerAccessIds.length) continue
        const principal = parseParLoanPrincipal(loan)
        if (principal === 0) continue
        for (const officerId of borrowerAccessIds) {
          const officerKey = String(officerId || '').trim()
          if (!officerKey) continue
          if (officerIdFilter && !officerIdFilter.has(officerKey)) continue
          if (!officerMap.has(officerKey)) {
            officerMap.set(officerKey, {
              officerId: officerKey,
              ...createParTotals(),
            })
          }
          const entry = officerMap.get(officerKey)
          if (kind === 'open') addParOpenLoan(entry, principal)
          else addParDelinquentLoan(entry, loan, row)
        }
      } catch {
        continue
      }
    }
  }
  accumulate(openLoansRows, 'open')
  accumulate(pastMissedRows, 'delinquent')

  return Array.from(officerMap.values()).map((entry) => {
    const agg = finalizeParTotals(entry)
    return {
      code: entry.officerId,
      name:
        DAILY_PAR_RO_NAME_BY_ID.get(entry.officerId) ||
        loNameById.get(entry.officerId) ||
        entry.officerId,
      openLoans: Math.round(agg.openLoans || 0),
      pastMissed: Math.round(agg.pastMissed || 0),
    }
  })
}

/** loan_id → branch_code for loans that were in Past_Missed at opening snapshot. */
function loadOpeningParLoanBranchMap(snapshotTime) {
  const map = new Map()
  if (!snapshotTime) return map
  const rows = db
    .prepare('SELECT branch_code, loan_id FROM Past_Missed_repayment WHERE time = ?')
    .all(snapshotTime)
  for (const r of rows) {
    const lid = String(r.loan_id ?? '').trim()
    const code = String(r.branch_code ?? '').trim()
    if (!lid || !code) continue
    map.set(lid, code)
  }
  return map
}

app.get('/api/par/branches/month-end-compare', (req, res) => {
  try {
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null ? String(req.query.country).trim() : ''

    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    if (!latestPar?.time) {
      return res.json({
        previous: null,
        current: null,
        performance: null,
        branches: [],
      })
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
    const nowParts = nairobiDateParts(new Date())
    const prevMeta = previousMonthEnd23Nairobi(new Date())
    const previousTime = findClosestParSnapshotTime(prevMeta.target, { preferOnOrBefore: true })
    const currentTime = latestPar.time

    const targetParPctRaw = req.query?.targetParPct != null ? Number(req.query.targetParPct) : NaN
    const targetParPct = Number.isFinite(targetParPctRaw) && targetParPctRaw > 0
      ? targetParPctRaw
      : Number(process.env.LOGBOOK_TARGET_PAR_PCT) > 0
        ? Number(process.env.LOGBOOK_TARGET_PAR_PCT)
        : 8

    const previousRows = previousTime
      ? buildParBranchRowsForSnapshot(previousTime, { countryParam, effectiveBranches })
      : []
    const currentRows = buildParBranchRowsForSnapshot(currentTime, { countryParam, effectiveBranches })

    const prevByCode = new Map(previousRows.map((b) => [b.code, b]))
    const currByCode = new Map(currentRows.map((b) => [b.code, b]))
    const codes = new Set([...prevByCode.keys(), ...currByCode.keys()])

    // Active month MTD window (Africa/Nairobi calendar month → local Date bounds)
    const monthStart = new Date(nowParts.year, nowParts.month - 1, 1)
    const monthEnd = new Date(nowParts.year, nowParts.month - 1, nowParts.day, 23, 59, 59, 999)

    let activeBranchesForResolver
    if (countryParam) {
      activeBranchesForResolver = listActiveLogbookBranchesForCountry(countryParam)
    } else {
      activeBranchesForResolver = db
        .prepare('SELECT code, name, country FROM Logbook_Branches WHERE active = 1')
        .all()
    }
    const resolver = buildLogbookBranchResolver(activeBranchesForResolver)

    const disbursedByBranch = new Map()
    const disbRows = db.prepare('SELECT branch, disbursed_date, disbursed FROM Logbook_Disbursement').all()
    for (const r of disbRows) {
      const code = resolver.resolve(r.branch)
      if (!codes.has(code)) continue
      const d = parseLogbookDirectorDMY(r.disbursed_date)
      if (!d || d < monthStart || d > monthEnd) continue
      disbursedByBranch.set(code, (disbursedByBranch.get(code) || 0) + (Number(r.disbursed) || 0))
    }

    // Collections from loans that were in Opening PAR (attribute to opening PAR branch)
    const openingParLoanBranch = loadOpeningParLoanBranchMap(previousTime)
    const collectedFromParByBranch = new Map()
    if (openingParLoanBranch.size) {
      const colRows = db
        .prepare(
          `SELECT loan_id, repayment_amount, principal_repayment_amount, repayment_collected_date
           FROM Logbook_collection
           WHERE repayment_collected_date IS NOT NULL AND TRIM(repayment_collected_date) <> ''`,
        )
        .all()
      for (const r of colRows) {
        const lid = String(r.loan_id ?? '').trim()
        if (!lid) continue
        const branchCode = openingParLoanBranch.get(lid)
        if (!branchCode || !codes.has(branchCode)) continue
        const d = parseLogbookDirectorDMY(r.repayment_collected_date)
        if (!d || d < monthStart || d > monthEnd) continue
        const principal = Number(r.principal_repayment_amount)
        const total = Number(r.repayment_amount)
        const amt = Number.isFinite(principal) && principal > 0
          ? principal
          : Number.isFinite(total)
            ? total
            : 0
        if (amt <= 0) continue
        collectedFromParByBranch.set(
          branchCode,
          (collectedFromParByBranch.get(branchCode) || 0) + amt,
        )
      }
    }

    const parRate = (openLoans, pastMissed) =>
      openLoans > 0 ? (pastMissed / openLoans) * 100 : 0

    const branches = Array.from(codes)
      .map((code) => {
        const prev = prevByCode.get(code) || null
        const curr = currByCode.get(code) || null
        const name = curr?.name || prev?.name || code

        const openingLoanbook = Number(prev?.openLoans) || 0
        const openingPar = Number(prev?.pastMissed) || 0
        const openingParPct = parRate(openingLoanbook, openingPar)

        const targetParAmt = Math.round(openingLoanbook * (targetParPct / 100))
        const requiredReduction = Math.max(0, Math.round(openingPar - targetParAmt))

        const actualCollectedFromPar = Math.round(collectedFromParByBranch.get(code) || 0)
        const disbursements = Math.round(disbursedByBranch.get(code) || 0)
        const netCashflow = actualCollectedFromPar - disbursements
        // Branch OPEX not stored in app DB yet
        const branchOpex = null
        const opexForCalc = 0
        const netCashPosition = netCashflow - opexForCalc

        const closingPar = Number(curr?.pastMissed) || 0
        const closingLoanbook = Number(curr?.openLoans) || 0
        const closingParPct = parRate(closingLoanbook, closingPar)
        const netParMovement = closingPar - openingPar

        return {
          code,
          name,
          opening: {
            loanbook: openingLoanbook,
            par: openingPar,
            parPct: Number(openingParPct.toFixed(2)),
          },
          target: {
            parPct: targetParPct,
            parAmt: targetParAmt,
            requiredReduction,
          },
          actual: {
            collectedFromPar: actualCollectedFromPar,
            disbursements,
            netCashflow,
            branchOpex,
            netCashPosition,
            closingPar,
            closingLoanbook,
            closingParPct: Number(closingParPct.toFixed(2)),
            netParMovement,
          },
          // Keep legacy shape for any older consumers
          previous: {
            openLoans: openingLoanbook,
            pastMissed: openingPar,
            missed: Number(prev?.missed) || 0,
            arrears: Number(prev?.arrears) || 0,
            pastMaturity: Number(prev?.pastMaturity) || 0,
          },
          current: {
            openLoans: closingLoanbook,
            pastMissed: closingPar,
            missed: Number(curr?.missed) || 0,
            arrears: Number(curr?.arrears) || 0,
            pastMaturity: Number(curr?.pastMaturity) || 0,
          },
          deltaAtRisk: netParMovement,
        }
      })
      .sort((a, b) => (Number(b.opening?.par) || 0) - (Number(a.opening?.par) || 0))

    const formatNairobiStamp = (iso) => {
      if (!iso) return null
      try {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Africa/Nairobi',
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      } catch {
        return String(iso)
      }
    }

    const monthLabel = `${monthNames[prevMeta.month - 1]} ${prevMeta.year}`
    const performanceMonthLabel = `${monthNames[nowParts.month - 1]} ${nowParts.year}`
    const previousMeta = {
      monthLabel,
      label: monthLabel,
      targetLabel: `${prevMeta.day} ${monthNames[prevMeta.month - 1]} ${prevMeta.year} · 23:00 EAT`,
    }

    res.json({
      previous: previousTime
        ? {
            time: previousTime,
            ...previousMeta,
            asOfLabel: formatNairobiStamp(previousTime),
          }
        : {
            time: null,
            ...previousMeta,
            asOfLabel: null,
          },
      current: {
        time: currentTime,
        label: 'Now',
        asOfLabel: formatNairobiStamp(currentTime),
      },
      performance: {
        monthLabel: performanceMonthLabel,
        year: nowParts.year,
        month: nowParts.month,
        targetParPct,
        opexAvailable: false,
      },
      branches,
    })
  } catch (e) {
    console.error('[PAR month-end compare] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

async function buildDailyParReportPayload({
  dateStr = '',
  countryParam = 'Kenya',
  effectiveBranches = [],
  sodHour: sodHourIn = 3,
  eodHour: eodHourIn = 20,
} = {}) {
    const dateMatch = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
    let year
    let month
    let day
    if (dateMatch) {
      year = Number(dateMatch[1])
      month = Number(dateMatch[2])
      day = Number(dateMatch[3])
    } else {
      const parts = nairobiDateParts(new Date())
      year = parts.year
      month = parts.month
      day = parts.day
    }

    const sodHour = Number.isFinite(Number(sodHourIn)) ? Number(sodHourIn) : 3
    const eodHour = Number.isFinite(Number(eodHourIn)) ? Number(eodHourIn) : 20

    const sodTarget = nairobiWallClockUtc(year, month, day, sodHour, 0)
    const eodTarget = nairobiWallClockUtc(year, month, day, eodHour, 0)

    // Yesterday calendar day
    const yest = new Date(Date.UTC(year, month - 1, day))
    yest.setUTCDate(yest.getUTCDate() - 1)
    const yY = yest.getUTCFullYear()
    const yM = yest.getUTCMonth() + 1
    const yD = yest.getUTCDate()
    const eodYestTarget = nairobiWallClockUtc(yY, yM, yD, eodHour, 0)

    const sodTime = findClosestParSnapshotTimeNear(sodTarget, { maxAbsHours: 5 })
    let eodTime = findClosestParSnapshotTimeNear(eodTarget, { maxAbsHours: 5 })
    // If report date is today and EOD not yet available, fall back to latest snapshot today (after SOD)
    if (!eodTime) {
      const latest = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
      if (latest?.time) {
        const latestMs = new Date(latest.time).getTime()
        const sodMs = sodTarget.getTime()
        const dayEndMs = nairobiWallClockUtc(year, month, day, 23, 59).getTime()
        if (latestMs >= sodMs && latestMs <= dayEndMs + 3 * 60 * 60 * 1000) {
          eodTime = latest.time
        }
      }
    }
    const eodYestTime = findClosestParSnapshotTimeNear(eodYestTarget, { maxAbsHours: 5 })

    const opts = { countryParam, effectiveBranches }
    const sodRows = sodTime ? buildParBranchRowsForSnapshot(sodTime, opts) : []
    const eodRows = eodTime ? buildParBranchRowsForSnapshot(eodTime, opts) : []
    const eodYestRows = eodYestTime ? buildParBranchRowsForSnapshot(eodYestTime, opts) : []

    const sodBy = new Map(sodRows.map((b) => [b.code, b]))
    const eodBy = new Map(eodRows.map((b) => [b.code, b]))
    const yestBy = new Map(eodYestRows.map((b) => [b.code, b]))
    const codes = new Set([...sodBy.keys(), ...eodBy.keys(), ...yestBy.keys()])

    const rate = (open, par) => (open > 0 ? (par / open) * 100 : 0)
    const shortName = (name) =>
      String(name || '')
        .replace(/\s+Branch$/i, '')
        .replace(/^Boda\s*-\s*/i, '')
        .trim()

    const branches = Array.from(codes)
      .map((code) => {
        const sod = sodBy.get(code)
        const eod = eodBy.get(code)
        const yest = yestBy.get(code)
        const name = shortName(eod?.name || sod?.name || yest?.name || code)

        const sodOpen = Number(sod?.openLoans) || 0
        const sodPar = Number(sod?.pastMissed) || 0
        const eodOpen = Number(eod?.openLoans) || 0
        const eodPar = Number(eod?.pastMissed) || 0
        const yestOpen = Number(yest?.openLoans) || 0
        const yestPar = Number(yest?.pastMissed) || 0

        const sodPct = rate(sodOpen, sodPar)
        const eodPct = rate(eodOpen, eodPar)
        const yestPct = rate(yestOpen, yestPar)
        const hasSod = !!sod && sodOpen > 0
        const hasEod = !!eod && eodOpen > 0
        const hasYest = !!yest && yestOpen > 0

        return {
          code,
          name,
          hasSod,
          hasEod,
          hasYest,
          eodYesterday: { openLoans: yestOpen, par: yestPar, parPct: Number(yestPct.toFixed(2)) },
          sod: { openLoans: sodOpen, par: sodPar, parPct: Number(sodPct.toFixed(2)) },
          eod: { openLoans: eodOpen, par: eodPar, parPct: Number(eodPct.toFixed(2)) },
          shiftSodToEod:
            hasSod && hasEod
              ? {
                  parAmt: eodPar - sodPar,
                  parPctPp: Number((eodPct - sodPct).toFixed(2)),
                }
              : null,
          vsYesterdayEod:
            hasYest && hasEod
              ? {
                  parAmt: eodPar - yestPar,
                  parPctPp: Number((eodPct - yestPct).toFixed(2)),
                }
              : null,
        }
      })
      .sort((a, b) => (Number(b.eod?.par) || 0) - (Number(a.eod?.par) || 0))

    const officerOpts = { ...opts, officerIds: DAILY_PAR_RO_IDS }
    const eodOfficerRows = eodTime ? buildParOfficerRowsForSnapshot(eodTime, officerOpts) : []
    const yestOfficerRows = eodYestTime ? buildParOfficerRowsForSnapshot(eodYestTime, officerOpts) : []
    const eodOfficerBy = new Map(eodOfficerRows.map((o) => [o.code, o]))
    const yestOfficerBy = new Map(yestOfficerRows.map((o) => [o.code, o]))

    // Fixed Relationship Officer roster for Daily PAR (for now)
    const officers = DAILY_PAR_RELATIONSHIP_OFFICERS.map((ro) => {
      const code = ro.borrower_access_id
      const eod = eodOfficerBy.get(code)
      const yest = yestOfficerBy.get(code)
      const name = DAILY_PAR_RO_NAME_BY_ID.get(code) || eod?.name || yest?.name || code

      const eodOpen = Number(eod?.openLoans) || 0
      const eodPar = Number(eod?.pastMissed) || 0
      const yestOpen = Number(yest?.openLoans) || 0
      const yestPar = Number(yest?.pastMissed) || 0

      const eodPct = rate(eodOpen, eodPar)
      const yestPct = rate(yestOpen, yestPar)
      const hasEod = !!eod && eodOpen > 0
      const hasYest = !!yest && yestOpen > 0

      return {
        code,
        name,
        hasEod,
        hasYest,
        eodYesterday: { openLoans: yestOpen, par: yestPar, parPct: Number(yestPct.toFixed(2)) },
        eod: { openLoans: eodOpen, par: eodPar, parPct: Number(eodPct.toFixed(2)) },
        vsYesterdayEod:
          hasYest && hasEod
            ? {
                parAmt: eodPar - yestPar,
                parPctPp: Number((eodPct - yestPct).toFixed(2)),
              }
            : null,
      }
    }).sort((a, b) => (Number(b.eod?.par) || 0) - (Number(a.eod?.par) || 0))

    const sum = (rows, keyPath) =>
      rows.reduce((acc, r) => {
        const [a, b] = keyPath.split('.')
        acc += Number(r[a]?.[b]) || 0
        return acc
      }, 0)

    const overallYestPar = sum(branches, 'eodYesterday.par')
    const overallYestOpen = sum(branches, 'eodYesterday.openLoans')
    const overallSodPar = sum(branches, 'sod.par')
    const overallSodOpen = sum(branches, 'sod.openLoans')
    const overallEodPar = sum(branches, 'eod.par')
    const overallEodOpen = sum(branches, 'eod.openLoans')

    const overall = {
      eodYesterday: {
        openLoans: overallYestOpen,
        par: overallYestPar,
        parPct: Number(rate(overallYestOpen, overallYestPar).toFixed(2)),
      },
      sod: {
        openLoans: overallSodOpen,
        par: overallSodPar,
        parPct: Number(rate(overallSodOpen, overallSodPar).toFixed(2)),
      },
      eod: {
        openLoans: overallEodOpen,
        par: overallEodPar,
        parPct: Number(rate(overallEodOpen, overallEodPar).toFixed(2)),
      },
      netChangeVsYesterday: overallYestPar - overallEodPar, // positive = recovered
      shiftSodToEod: overallEodPar - overallSodPar,
    }

    const fmtPct = (v) => `${(Number(v) || 0).toFixed(1)}%`
    const fmtAmt = (v) => formatDailyParCompact(v)

    // Heuristic narrative buckets (fallback if Claude unavailable) — day-over-day (yesterday EOD → today EOD)
    const used = new Set()
    const largestEod = [...branches]
      .filter((b) => b.hasEod)
      .sort((a, b) => (b.eod?.par || 0) - (a.eod?.par || 0))[0]

    const topPerformers = branches
      .filter(
        (b) =>
          b.hasYest &&
          b.hasEod &&
          ((b.vsYesterdayEod?.parPctPp || 0) <= -0.4 ||
            ((b.vsYesterdayEod?.parAmt || 0) < -100_000 && (b.vsYesterdayEod?.parPctPp || 0) < -0.2)),
      )
      .sort((a, b) => (a.vsYesterdayEod.parPctPp || 0) - (b.vsYesterdayEod.parPctPp || 0))
      .slice(0, 4)
      .map((b, idx) => {
        used.add(b.code)
        const pp = Math.abs(b.vsYesterdayEod?.parPctPp || 0).toFixed(1)
        const recoveredAmt = -(b.vsYesterdayEod?.parAmt || 0)
        let text = `${b.name}: improved ${pp}% vs yesterday's close`
        if (recoveredAmt > 100_000) text += ` (${fmtAmt(recoveredAmt)} risk reduced)`
        text += ` —`
        if (idx === 0) text += ` the clearest positive signal of the day`
        else text += ` encouraging day-over-day trajectory`
        text += `. Still closes at ${fmtPct(b.eod.parPct)} / ${fmtAmt(b.eod.par)}`
        if (largestEod && largestEod.code === b.code) {
          text += ` — remains the single largest PAR exposure in the portfolio`
        }
        text += '.'
        return { code: b.code, name: b.name, text }
      })

    const holdingSteady = branches
      .filter((b) => {
        if (used.has(b.code) || !b.hasEod || (b.eod.parPct || 0) < 0.05) return false
        if (!b.hasYest || !b.vsYesterdayEod) return false
        const vsY = Math.abs(b.vsYesterdayEod.parPctPp || 0)
        const vsAmt = Math.abs(b.vsYesterdayEod.parAmt || 0)
        return vsY <= 0.5 && vsAmt < 250_000
      })
      .slice(0, 4)
      .map((b) => {
        used.add(b.code)
        let text = `${b.name}: `
        if ((b.eod.parPct || 0) >= 80) {
          text += `at ${fmtPct(b.eod.parPct)} PAR this is a standing concern. Day-over-day stability here is not reassuring — this book needs a dedicated resolution plan, not monitoring.`
        } else if ((b.eod.parPct || 0) >= 20) {
          text += `flat vs yesterday — at ${fmtPct(b.eod.parPct)} / ${fmtAmt(b.eod.par)} this is a structurally elevated rate that has shown no meaningful trend in either direction.`
        } else {
          text += `holding near yesterday (${fmtPct(b.eod.parPct)}) with no material day-over-day move — quiet, not a problem, but not a recovery story either.`
        }
        return { code: b.code, name: b.name, text }
      })

    const watching = branches
      .filter((b) => {
        if (used.has(b.code) || !b.hasEod || !b.hasYest) return false
        return (b.vsYesterdayEod?.parPctPp || 0) >= 0.4 || (b.vsYesterdayEod?.parAmt || 0) > 100_000
      })
      .sort((a, b) => (b.vsYesterdayEod?.parPctPp || 0) - (a.vsYesterdayEod?.parPctPp || 0))
      .slice(0, 4)
      .map((b) => {
        used.add(b.code)
        let text = `${b.name}: up ${(b.vsYesterdayEod.parPctPp || 0).toFixed(1)}% vs yesterday's close`
        if ((b.vsYesterdayEod.parAmt || 0) > 0) {
          text += ` (+${fmtAmt(b.vsYesterdayEod.parAmt)})`
        }
        text += ` to ${fmtPct(b.eod.parPct)} / ${fmtAmt(b.eod.par)} — keep on the watchlist until the trend reverses.`
        return { code: b.code, name: b.name, text }
      })

    const cleanBranches = branches.filter((b) => b.hasEod && (b.eod.parPct || 0) < 0.05)
    const clean = cleanBranches.length
      ? cleanBranches.slice(0, 4).map((b) => {
          used.add(b.code)
          return {
            code: b.code,
            name: b.name,
            text: `${b.name}: stayed clean at ${fmtPct(b.eod.parPct)} — no residual stress showing at EOD.`,
          }
        })
      : [
          {
            code: '_none',
            name: '',
            text: `No zero-PAR branches at EOD. All tracked branches carry residual at-risk balances — focus on reducing high-PAR outliers${largestEod ? ` (led by ${largestEod.name})` : ''} rather than celebrating clean branches.`,
          },
        ]

    const netChangeVsYest = overall.netChangeVsYesterday
    const eodPctOverall = overall.eod.parPct
    const yestPctOverall = overall.eodYesterday.parPct
    const vsYestPpOverall =
      Number.isFinite(Number(eodPctOverall)) && Number.isFinite(Number(yestPctOverall))
        ? Number(eodPctOverall) - Number(yestPctOverall)
        : null
    const topDriver = topPerformers[0]
    const watchDriver = watching[0]
    let bottomLine = ''
    if (netChangeVsYest > 500_000) {
      bottomLine = `PAR improved by ${fmtAmt(netChangeVsYest)} vs yesterday's close`
      if (topDriver) bottomLine += `, driven largely by ${topDriver.name}`
      bottomLine += '.'
    } else if (netChangeVsYest < -500_000) {
      bottomLine = `PAR slipped by ${fmtAmt(Math.abs(netChangeVsYest))} vs yesterday (${fmtPct(yestPctOverall)} → ${fmtPct(eodPctOverall)}). Tighten collections on the watching list.`
    } else {
      bottomLine = `Mixed/flat day overall (${fmtPct(yestPctOverall)} → ${fmtPct(eodPctOverall)}). Dig into branches still elevating vs yesterday.`
    }
    if (vsYestPpOverall != null && vsYestPpOverall <= -0.4) {
      bottomLine += ` Portfolio-wide PAR fell ${Math.abs(vsYestPpOverall).toFixed(1)}% vs yesterday — a positive signal.`
    } else if (vsYestPpOverall != null && vsYestPpOverall >= 0.4) {
      bottomLine += ` Portfolio-wide PAR rose ${vsYestPpOverall.toFixed(1)}% vs yesterday — not a recovery day.`
    }
    if (largestEod && (largestEod.eod.parPct || 0) >= 10) {
      bottomLine += ` However, ${largestEod.name} at ${fmtPct(largestEod.eod.parPct)} / ${fmtAmt(largestEod.eod.par)} remains priority number one.`
    }
    if (watchDriver) {
      bottomLine += ` ${watchDriver.name}'s rising trend is the one to watch tomorrow.`
    } else if (topPerformers.length && watching.length === 0) {
      bottomLine += ' Momentum favours the improvers today.'
    }

    const formatNairobiStamp = (iso) => {
      if (!iso) return null
      try {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Africa/Nairobi',
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      } catch {
        return String(iso)
      }
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
    const dateLabel = `${day} ${monthNames[month - 1]} ${year}`

    const payloadBase = {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      dateLabel,
      country: countryParam || null,
      slots: {
        sod: {
          targetHour: sodHour,
          label: `SOD (~${String(sodHour).padStart(2, '0')}:00 EAT)`,
          time: sodTime,
          asOfLabel: formatNairobiStamp(sodTime),
        },
        eod: {
          targetHour: eodHour,
          label: `EOD (~${String(eodHour).padStart(2, '0')}:00 EAT)`,
          time: eodTime,
          asOfLabel: formatNairobiStamp(eodTime),
        },
        eodYesterday: {
          targetHour: eodHour,
          label: `EOD Yesterday (~${String(eodHour).padStart(2, '0')}:00 EAT)`,
          time: eodYestTime,
          asOfLabel: formatNairobiStamp(eodYestTime),
        },
      },
      overall,
      branches,
      officers,
      narrative: {
        topPerformers,
        holdingSteady,
        watching,
        clean,
        bottomLine,
      },
    }

    // Claude analysis (email-style EOD PAR commentary)
    let claudeAnalysis = null
    let claudeError = null
    try {
      claudeAnalysis = await generateDailyParClaudeAnalysis(payloadBase)
    } catch (e) {
      claudeError = e.message || 'Claude analysis unavailable'
      console.warn('[Daily PAR] Claude analysis skipped:', claudeError)
    }

    // Prefer Claude bullets in the narrative cards when present
    if (claudeAnalysis) {
      const toItems = (arr) =>
        (Array.isArray(arr) ? arr : [])
          .map((t) => String(t || '').trim())
          .filter(Boolean)
          .slice(0, 6)
          .map((text) => ({ text }))
      if (toItems(claudeAnalysis.topPerformers).length) {
        payloadBase.narrative.topPerformers = toItems(claudeAnalysis.topPerformers)
      }
      if (toItems(claudeAnalysis.holdingSteady).length) {
        payloadBase.narrative.holdingSteady = toItems(claudeAnalysis.holdingSteady)
      }
      if (toItems(claudeAnalysis.watching).length) {
        payloadBase.narrative.watching = toItems(claudeAnalysis.watching)
      }
      if (toItems(claudeAnalysis.clean).length) {
        payloadBase.narrative.clean = toItems(claudeAnalysis.clean)
      }
      if (claudeAnalysis.bottomLine) {
        payloadBase.narrative.bottomLine = String(claudeAnalysis.bottomLine).slice(0, 700)
      }
    }

    return {
      ...payloadBase,
      claudeAnalysis,
      claudeError,
    }
}

/**
 * Daily PAR report: Yesterday EOD (~20:00 EAT) vs Today EOD (~20:00 EAT) by branch + Claude analysis.
 * GET /api/reports/daily-par?date=YYYY-MM-DD&country=Kenya
 */
app.get('/api/reports/daily-par', requireAuth, async (req, res) => {
  try {
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null ? String(req.query.country).trim() : 'Kenya'
    const dateStr = req.query && req.query.date != null ? String(req.query.date).trim() : ''
    const sodHour = req.query?.sodHour != null && Number.isFinite(Number(req.query.sodHour))
      ? Number(req.query.sodHour)
      : 3
    const eodHour = req.query?.eodHour != null && Number.isFinite(Number(req.query.eodHour))
      ? Number(req.query.eodHour)
      : 20
    const payload = await buildDailyParReportPayload({
      dateStr,
      countryParam,
      effectiveBranches,
      sodHour,
      eodHour,
    })
    res.json(payload)
  } catch (e) {
    console.error('[Daily PAR report] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

/** Parse comma/semicolon email lists from env. */
function parseEmailList(raw) {
  return String(raw || '')
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'))
}

/**
 * Recipients for Daily PAR / Disbursement emails by country.
 * Kenya:
 *   DAILY_PAR_EMAIL_TO=a@x.com,b@y.com
 *   DAILY_PAR_EMAIL_CC=c@x.com
 *   DAILY_PAR_EMAIL_ROLES=admin,superuser   (optional)
 * Uganda:
 *   DAILY_PAR_EMAIL_TO_UGANDA=a@x.com,b@y.com
 *   DAILY_PAR_EMAIL_CC_UGANDA=c@x.com
 *   DAILY_PAR_EMAIL_ROLES_UGANDA=...       (optional)
 */
function getDailyParEmailRecipients(countryParam = 'Kenya') {
  const country = String(countryParam || 'Kenya').trim() || 'Kenya'
  const isUganda = country.toLowerCase() === 'uganda'

  const fromEnv = parseEmailList(
    isUganda ? process.env.DAILY_PAR_EMAIL_TO_UGANDA : process.env.DAILY_PAR_EMAIL_TO,
  )
  const cc = parseEmailList(
    isUganda ? process.env.DAILY_PAR_EMAIL_CC_UGANDA : process.env.DAILY_PAR_EMAIL_CC,
  )
  const roles = String(
    (isUganda ? process.env.DAILY_PAR_EMAIL_ROLES_UGANDA : process.env.DAILY_PAR_EMAIL_ROLES) || '',
  )
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const fromDb = []
  if (roles.length) {
    try {
      const placeholders = roles.map(() => '?').join(',')
      const rows = dbRW
        .prepare(
          `SELECT email FROM Users
           WHERE active = 1
             AND email IS NOT NULL AND trim(email) != ''
             AND lower(role) IN (${placeholders})`,
        )
        .all(...roles)
      for (const r of rows) {
        const e = String(r.email || '').trim().toLowerCase()
        if (e.includes('@')) fromDb.push(e)
      }
    } catch (e) {
      console.warn(`[Daily PAR email] role lookup failed (${country}):`, e.message)
    }
  }

  const to = [...new Set([...fromEnv, ...fromDb])]
  const ccFiltered = cc.filter((e) => !to.includes(e))
  return { to, cc: ccFiltered, country }
}

/** Countries to auto-email on the daily cron (Kenya always; Uganda when recipients configured or forced). */
function getDailyReportEmailCountries({ requireRecipients = true } = {}) {
  const countries = ['Kenya']
  const ugRecipients = getDailyParEmailRecipients('Uganda')
  if (!requireRecipients || ugRecipients.to.length > 0) {
    countries.push('Uganda')
  }
  return countries
}

async function sendDailyParReportEmailsForSchedule({ dateStr = '', force = false } = {}) {
  const countries = getDailyReportEmailCountries({ requireRecipients: !force })
  const results = []
  for (const country of countries) {
    try {
      const result = await sendDailyParReportEmail({ dateStr, countryParam: country, force })
      results.push(result)
    } catch (e) {
      results.push({ ok: false, country, error: e.message || String(e) })
      console.error(`[Daily PAR email] ${country} failed:`, e.message)
    }
  }
  return { ok: results.some((r) => r.ok), results }
}

async function sendDailyDisbursementReportEmailsForSchedule({ dateStr = '', force = false } = {}) {
  const countries = getDailyReportEmailCountries({ requireRecipients: !force })
  const results = []
  for (const country of countries) {
    try {
      const result = await sendDailyDisbursementReportEmail({ dateStr, countryParam: country, force })
      results.push(result)
    } catch (e) {
      results.push({ ok: false, country, error: e.message || String(e) })
      console.error(`[Daily Disbursement email] ${country} failed:`, e.message)
    }
  }
  return { ok: results.some((r) => r.ok), results }
}

function isDailyParEmailEnabled() {
  const flag = String(process.env.DAILY_PAR_EMAIL_ENABLED ?? 'true').toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(flag)) return false
  return true
}

/**
 * Build + email the Daily PAR HTML report (Mon–Sat 20:00 EAT cron, or manual trigger).
 */
async function sendDailyParReportEmail({ dateStr = '', countryParam = '', force = false } = {}) {
  if (!force && !isDailyParEmailEnabled()) {
    return { ok: false, skipped: true, reason: 'DAILY_PAR_EMAIL_ENABLED is off' }
  }

  const country = String(countryParam || process.env.DAILY_PAR_EMAIL_COUNTRY || 'Kenya').trim() || 'Kenya'
  const { to, cc } = getDailyParEmailRecipients(country)
  if (!to.length) {
    const hint =
      country.toLowerCase() === 'uganda'
        ? 'No recipients — set DAILY_PAR_EMAIL_TO_UGANDA (and optional DAILY_PAR_EMAIL_CC_UGANDA)'
        : 'No recipients — set DAILY_PAR_EMAIL_TO and/or DAILY_PAR_EMAIL_ROLES'
    return {
      ok: false,
      skipped: true,
      reason: hint,
      country,
    }
  }

  const payload = await buildDailyParReportPayload({
    dateStr,
    countryParam: country,
    effectiveBranches: [],
    sodHour: 3,
    eodHour: 20,
  })

  const html = renderDailyParReportHTML(payload)
  let pdfBuffer
  try {
    const { renderHtmlToPdfBuffer } = await import('./src/reports/htmlToPdf.js')
    pdfBuffer = await renderHtmlToPdfBuffer(html)
  } catch (err) {
    console.error('[Daily PAR email] PDF generation failed:', err)
    throw new Error(`Failed to generate Daily PAR PDF: ${err.message || err}`)
  }

  const dateLabel = payload.dateLabel || payload.date || ''
  const subject = `Daily PAR — ${dateLabel} (${country})`
  const text = buildDailyParPlainEmailBody(payload, country)
  const emailHtml = dailyParEmailBodyToHtml(text)

  const filename = `Daily-PAR-${country}-${payload.date || 'report'}.pdf`
  const result = await sendEmail({
    to: to.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    subject,
    text,
    html: emailHtml,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })

  return {
    ok: !!result.ok,
    skipped: !!result.skipped,
    to,
    cc,
    subject,
    date: payload.date,
    dateLabel,
    country,
    claudeError: payload.claudeError || null,
  }
}

/**
 * Manual trigger (admin/superuser): POST /api/reports/daily-par/send
 * Body/query: { date?, country? }
 */
app.post('/api/reports/daily-par/send', requireAuth, async (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin or superuser only' })
    }
    const dateStr =
      (req.body && req.body.date != null ? String(req.body.date).trim() : '') ||
      (req.query && req.query.date != null ? String(req.query.date).trim() : '')
    const countryParam =
      (req.body && req.body.country != null ? String(req.body.country).trim() : '') ||
      (req.query && req.query.country != null ? String(req.query.country).trim() : '')

    const result = await sendDailyParReportEmail({ dateStr, countryParam, force: true })
    if (result.skipped && !result.ok) {
      return res.status(400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('[Daily PAR email] send failed:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── Daily Logbook Disbursements (Mon–Sat 20:00 EAT) ─────────────────────────

function isDailyDisbursementEmailEnabled() {
  const flag = String(
    process.env.DAILY_DISB_EMAIL_ENABLED ?? process.env.DAILY_PAR_EMAIL_ENABLED ?? 'true',
  ).toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(flag)) return false
  return true
}

function buildDailyDisbursementReportPayload({
  dateStr = '',
  countryParam = 'Kenya',
  effectiveBranches = [],
} = {}) {
  const dateMatch = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  let year
  let month
  let day
  if (dateMatch) {
    year = Number(dateMatch[1])
    month = Number(dateMatch[2])
    day = Number(dateMatch[3])
  } else {
    const parts = nairobiDateParts(new Date())
    year = parts.year
    month = parts.month
    day = parts.day
  }

  const country = String(countryParam || 'Kenya').trim() || 'Kenya'
  const currency = country === 'Uganda' ? 'UGX' : 'KES'
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const dateLabel = `${day} ${monthNames[month - 1]} ${year}`
  const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const yestDt = new Date(year, month - 1, day)
  yestDt.setDate(yestDt.getDate() - 1)
  const yY = yestDt.getFullYear()
  const yM = yestDt.getMonth() + 1
  const yD = yestDt.getDate()

  let countryBranches = listActiveLogbookBranchesForCountry(country)
  if (Array.isArray(effectiveBranches) && effectiveBranches.length > 0) {
    const allowed = new Set(effectiveBranches.map((b) => String(b || '').trim().toLowerCase()))
    countryBranches = countryBranches.filter((b) => {
      const code = String(b.code || '').trim().toLowerCase()
      const name = String(b.name || '').trim().toLowerCase()
      return allowed.has(code) || allowed.has(name)
    })
  }

  const resolver = buildLogbookBranchResolver(countryBranches)
  const byCode = new Map()
  for (const b of countryBranches) {
    const code = String(b.code || '').trim()
    if (!code) continue
    byCode.set(code, {
      code,
      name: String(b.name || code).replace(/\s+Branch$/i, '').trim() || code,
      today: 0,
      todayCount: 0,
      yesterday: 0,
      mtd: 0,
      target: 0,
    })
  }

  const sameDay = (d, y, m, dd) =>
    d && d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === dd

  const monthStart = new Date(year, month - 1, 1)
  const reportEnd = new Date(year, month - 1, day, 23, 59, 59, 999)

  const disbRows = db.prepare('SELECT branch, disbursed_date, disbursed FROM Logbook_Disbursement').all()
  for (const r of disbRows) {
    const code = resolver.resolve(r.branch)
    if (!byCode.has(code)) continue
    const d = parseLogbookDirectorDMY(r.disbursed_date)
    if (!d) continue
    const amt = Number(r.disbursed) || 0
    const row = byCode.get(code)
    if (sameDay(d, year, month, day)) {
      row.today += amt
      row.todayCount += 1
    }
    if (sameDay(d, yY, yM, yD)) {
      row.yesterday += amt
    }
    if (d >= monthStart && d <= reportEnd) {
      row.mtd += amt
    }
  }

  const countryIdSet = new Set()
  for (const b of countryBranches) {
    if (b.code) countryIdSet.add(String(b.code).trim().toLowerCase())
    if (b.name) countryIdSet.add(String(b.name).trim().toLowerCase())
  }

  const targetRows = db
    .prepare(
      'SELECT branch, disbursement_target FROM Logbook_Targets WHERE month = ? AND year = ? AND active = 1',
    )
    .all(month, year)
  for (const t of targetRows) {
    const raw = String(t.branch || '').trim()
    const code = resolver.resolve(raw)
    if (!byCode.has(code) && !countryIdSet.has(raw.toLowerCase())) continue
    const row = byCode.get(code) || byCode.get(resolver.resolve(raw))
    if (!row) continue
    row.target += Number(t.disbursement_target) || 0
  }

  const branches = Array.from(byCode.values())
    .map((b) => {
      const achPct = b.target > 0 ? Number(((b.mtd / b.target) * 100).toFixed(1)) : null
      return {
        ...b,
        today: Math.round(b.today),
        yesterday: Math.round(b.yesterday),
        mtd: Math.round(b.mtd),
        target: Math.round(b.target),
        vsYesterday: Math.round(b.today - b.yesterday),
        achPct,
      }
    })
    .filter((b) => b.today > 0 || b.yesterday > 0 || b.mtd > 0 || b.target > 0)
    .sort((a, b) => b.today - a.today || b.mtd - a.mtd)

  const overall = branches.reduce(
    (acc, b) => {
      acc.today += b.today
      acc.todayCount += b.todayCount
      acc.yesterday += b.yesterday
      acc.mtd += b.mtd
      acc.target += b.target
      return acc
    },
    { today: 0, todayCount: 0, yesterday: 0, mtd: 0, target: 0 },
  )
  overall.achPct = overall.target > 0 ? Number(((overall.mtd / overall.target) * 100).toFixed(1)) : null
  overall.vsYesterday = overall.today - overall.yesterday

  return {
    date: dateIso,
    dateLabel,
    country,
    currency,
    year,
    month,
    day,
    overall,
    branches,
  }
}

function buildDailyDisbursementPlainEmailBody(payload, country = 'Kenya') {
  const overall = payload?.overall || {}
  const dateLabel = payload?.dateLabel || payload?.date || ''
  const today = Number(overall.today) || 0
  const count = Number(overall.todayCount) || 0
  const mtd = Number(overall.mtd) || 0
  const target = Number(overall.target) || 0
  const ach = Number(overall.achPct)
  const vsYest = Number(overall.vsYesterday) || 0

  let overview = `Today disbursed ${formatDailyParCompact(today)} across ${count} loan${count === 1 ? '' : 's'}`
  if (vsYest > 0) overview += ` — up ${formatDailyParCompact(vsYest)} vs yesterday.`
  else if (vsYest < 0) overview += ` — down ${formatDailyParCompact(Math.abs(vsYest))} vs yesterday.`
  else overview += ' — flat vs yesterday.'

  let targetLine = ''
  if (target > 0 && Number.isFinite(ach)) {
    targetLine = `MTD ${formatDailyParCompact(mtd)} is ${ach.toFixed(1)}% of the ${formatDailyParCompact(target)} monthly target.`
  } else {
    targetLine = `MTD disbursed: ${formatDailyParCompact(mtd)}.`
  }

  const top = [...(payload?.branches || [])].filter((b) => (b.today || 0) > 0).slice(0, 3)
  let leaders = ''
  if (top.length) {
    leaders = top
      .map((b) => `${b.name} ${formatDailyParCompact(b.today)}`)
      .join('; ')
  }

  const lines = [
    'Hi team,',
    '',
    `Please find today's Logbook disbursement report attached (${dateLabel}).`,
    '',
    `Overview: ${overview}`,
    '',
    targetLine,
  ]
  if (leaders) {
    lines.push('', `Top branches today: ${leaders}.`)
  }
  lines.push(
    '',
    'Full branch breakdown (today, yesterday, MTD vs target) is in the attached PDF.',
    '',
    'Regards,',
    `Phoenix Capital — ${country} Operations`,
  )
  return lines.join('\n')
}

async function sendDailyDisbursementReportEmail({ dateStr = '', countryParam = '', force = false } = {}) {
  if (!force && !isDailyDisbursementEmailEnabled()) {
    return { ok: false, skipped: true, reason: 'DAILY_DISB_EMAIL_ENABLED is off' }
  }

  const country = String(countryParam || process.env.DAILY_PAR_EMAIL_COUNTRY || 'Kenya').trim() || 'Kenya'
  const { to, cc } = getDailyParEmailRecipients(country)
  if (!to.length) {
    const hint =
      country.toLowerCase() === 'uganda'
        ? 'No recipients — set DAILY_PAR_EMAIL_TO_UGANDA (and optional DAILY_PAR_EMAIL_CC_UGANDA)'
        : 'No recipients — set DAILY_PAR_EMAIL_TO and/or DAILY_PAR_EMAIL_ROLES'
    return {
      ok: false,
      skipped: true,
      reason: hint,
      country,
    }
  }

  const payload = buildDailyDisbursementReportPayload({
    dateStr,
    countryParam: country,
    effectiveBranches: [],
  })

  const html = renderDailyDisbursementReportHTML(payload)
  let pdfBuffer
  try {
    const { renderHtmlToPdfBuffer } = await import('./src/reports/htmlToPdf.js')
    pdfBuffer = await renderHtmlToPdfBuffer(html)
  } catch (err) {
    console.error('[Daily Disbursement email] PDF generation failed:', err)
    throw new Error(`Failed to generate Daily Disbursement PDF: ${err.message || err}`)
  }

  const dateLabel = payload.dateLabel || payload.date || ''
  const subject = `Daily Disbursements — ${dateLabel} (${country})`
  const text = buildDailyDisbursementPlainEmailBody(payload, country)
  const emailHtml = dailyParEmailBodyToHtml(text)
  const filename = `Daily-Disbursements-${country}-${payload.date || 'report'}.pdf`

  const result = await sendEmail({
    to: to.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    subject,
    text,
    html: emailHtml,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })

  return {
    ok: !!result.ok,
    skipped: !!result.skipped,
    to,
    cc,
    subject,
    date: payload.date,
    dateLabel,
    country,
  }
}

app.get('/api/reports/daily-disbursements', requireAuth, async (req, res) => {
  try {
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null ? String(req.query.country).trim() : 'Kenya'
    const dateStr = req.query && req.query.date != null ? String(req.query.date).trim() : ''
    const payload = buildDailyDisbursementReportPayload({
      dateStr,
      countryParam,
      effectiveBranches,
    })
    res.json(payload)
  } catch (e) {
    console.error('[Daily Disbursement report] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/reports/daily-disbursements/send', requireAuth, async (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin or superuser only' })
    }
    const dateStr =
      (req.body && req.body.date != null ? String(req.body.date).trim() : '') ||
      (req.query && req.query.date != null ? String(req.query.date).trim() : '')
    const countryParam =
      (req.body && req.body.country != null ? String(req.body.country).trim() : '') ||
      (req.query && req.query.country != null ? String(req.query.country).trim() : '')

    const result = await sendDailyDisbursementReportEmail({ dateStr, countryParam, force: true })
    if (result.skipped && !result.ok) {
      return res.status(400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('[Daily Disbursement email] send failed:', e)
    res.status(500).json({ error: e.message })
  }
})

function formatDailyParCompact(v) {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

function escapeDailyParEmailHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDailyParPct(v, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

/** Plain-language email body (PDF carries the full report). */
function buildDailyParPlainEmailBody(payload, country = 'Kenya') {
  const overall = payload?.overall || {}
  const branches = Array.isArray(payload?.branches) ? payload.branches : []
  const narrative = payload?.narrative || {}

  const eodPct = Number(overall.eod?.parPct)
  const eodAmt = Number(overall.eod?.par) || 0
  const yestPct = Number(overall.eodYesterday?.parPct)
  const yestAmt = Number(overall.eodYesterday?.par) || 0

  const vsYestPp =
    Number.isFinite(eodPct) && Number.isFinite(yestPct) ? eodPct - yestPct : null

  let overview = `Portfolio PAR closed at ${formatDailyParPct(eodPct)} (${formatDailyParCompact(eodAmt)})`
  if (vsYestPp != null && Number.isFinite(yestPct)) {
    const dir = vsYestPp > 0.02 ? 'up' : vsYestPp < -0.02 ? 'down' : 'flat'
    if (dir === 'flat') {
      overview += ` — essentially flat vs yesterday's ${formatDailyParPct(yestPct)} (${formatDailyParCompact(yestAmt)}).`
    } else {
      overview += ` — ${dir} ${Math.abs(vsYestPp).toFixed(2)}% vs yesterday's ${formatDailyParPct(yestPct)} (${formatDailyParCompact(yestAmt)}).`
    }
  } else {
    overview += '.'
  }

  // Day-over-day drivers (PAR amount up vs yesterday)
  const overnightDrivers = branches
    .filter((b) => b.hasEod && b.hasYest && (b.vsYesterdayEod?.parAmt || 0) > 100_000)
    .sort((a, b) => (b.vsYesterdayEod?.parAmt || 0) - (a.vsYesterdayEod?.parAmt || 0))
    .slice(0, 3)
  if (overnightDrivers.length && vsYestPp != null && vsYestPp > 0.05) {
    const bits = overnightDrivers.map(
      (b) => `${b.name} (+${formatDailyParCompact(b.vsYesterdayEod.parAmt)})`,
    )
    overview += ` Primary drivers: ${bits.join(', ')}.`
  } else if (overnightDrivers.length === 0 && vsYestPp != null && vsYestPp < -0.05) {
    const improvers = branches
      .filter((b) => b.hasEod && b.hasYest && (b.vsYesterdayEod?.parAmt || 0) < -100_000)
      .sort((a, b) => (a.vsYesterdayEod?.parAmt || 0) - (b.vsYesterdayEod?.parAmt || 0))
      .slice(0, 3)
    if (improvers.length) {
      const bits = improvers.map(
        (b) => `${b.name} (${formatDailyParCompact(b.vsYesterdayEod.parAmt)})`,
      )
      overview += ` Led by ${bits.join(', ')}.`
    }
  }

  const priorityBranch = [...branches]
    .filter((b) => b.hasEod)
    .sort((a, b) => (b.eod?.par || 0) - (a.eod?.par || 0))[0]
  let priority = ''
  if (priorityBranch && (priorityBranch.eod?.par || 0) > 0) {
    priority = `${priorityBranch.name} remains the largest single exposure at ${formatDailyParPct(priorityBranch.eod.parPct)} / ${formatDailyParCompact(priorityBranch.eod.par)}.`
  }

  const watchRaw =
    (Array.isArray(narrative.watching) && narrative.watching[0]?.text) ||
    (Array.isArray(narrative.watching) && narrative.watching[0]?.name) ||
    ''
  let watch = String(watchRaw || '').trim()
  if (!watch) {
    const rising = branches
      .filter(
        (b) =>
          b.hasEod &&
          b.hasYest &&
          (b.vsYesterdayEod?.parPctPp || 0) >= 0.3 &&
          (b.vsYesterdayEod?.parAmt || 0) > 50_000,
      )
      .sort((a, b) => (b.vsYesterdayEod?.parPctPp || 0) - (a.vsYesterdayEod?.parPctPp || 0))[0]
    if (rising) {
      watch = `${rising.name} posted rising PAR vs yesterday (+${(rising.vsYesterdayEod.parPctPp || 0).toFixed(2)}%, ${formatDailyParCompact(rising.vsYesterdayEod.parAmt)}). Watch for a further uptick tomorrow.`
    }
  }

  const lines = [
    'Hi team,',
    '',
    "Please find today's PAR report attached.",
    '',
    `Overview: ${overview}`,
  ]
  if (priority) {
    lines.push('', `Priority: ${priority}`)
  }
  if (watch) {
    lines.push('', `Watch: ${watch}`)
  }
  lines.push(
    '',
    'The full branch breakdown, trend analysis, and commentary are in the attached PDF.',
    '',
    'Regards,',
    `Phoenix Capital — ${country} Operations`,
  )
  return lines.join('\n')
}

function dailyParEmailBodyToHtml(textBody) {
  const paras = String(textBody || '')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const htmlParas = paras
    .map((p) => {
      const withBreaks = escapeDailyParEmailHtml(p).replace(/\n/g, '<br>')
      return `<p style="margin:0 0 14px;line-height:1.55">${withBreaks}</p>`
    })
    .join('\n')
  return `<!DOCTYPE html>
<html><body style="font-family:Georgia,'Times New Roman',serif;color:#1a202c;font-size:15px;max-width:640px">
${htmlParas}
</body></html>`
}

function buildDailyParClaudePrompt(payload) {
  const overall = payload?.overall || {}
  const netChangeVsYest = Number(overall.netChangeVsYesterday) || 0
  const netChangeLabel =
    netChangeVsYest >= 0
      ? `${formatDailyParCompact(netChangeVsYest)} improvement vs yesterday`
      : `${formatDailyParCompact(Math.abs(netChangeVsYest))} increase vs yesterday`
  const vsYestPp =
    overall.eod?.parPct != null && overall.eodYesterday?.parPct != null
      ? Number((Number(overall.eod.parPct) - Number(overall.eodYesterday.parPct)).toFixed(1))
      : null

  const branchSummary = (Array.isArray(payload?.branches) ? payload.branches : []).slice(0, 25).map((b) => ({
    branch: b.name,
    eodYesterdayPct: b.eodYesterday?.parPct,
    eodYesterdayAmt: b.eodYesterday?.par,
    eodPct: b.eod?.parPct,
    eodAmt: b.eod?.par,
    vsYesterdayPp: b.vsYesterdayEod?.parPctPp,
    vsYesterdayAmt: b.vsYesterdayEod?.parAmt,
  }))

  return `You are the credit-ops analyst writing Phoenix Capital's Daily PAR report cards for Logbook ${payload.country || 'Kenya'} on ${payload.dateLabel}.

Your job is INTERPRETATION, not a scoreboard. The branch table already shows the numbers — your cards must explain what the moves mean, why they matter, and what to do next.

Compare YESTERDAY EOD → TODAY EOD only (day-over-day). Do NOT discuss morning/SOD/intraday open.

Match this commentary style EXACTLY (tone, length, judgment):

TOP PERFORMERS TODAY:
- TOWN: improved 2.5% vs yesterday's close — encouraging trajectory, though at 23.6% / 13.0M it remains the single largest PAR exposure in the portfolio.
- Utawala: posted the biggest day-over-day improvement at −3.0%, with 751K net PAR reduction vs yesterday. The clearest positive signal of the day.
- Kitengela & Kilimani: both ended below yesterday's levels — solid recovery vs prior close.

HOLDING STEADY:
- Thika: is flat with no movement in amount — at 30.0% this is a structurally elevated rate that has shown no meaningful trend in either direction.
- Mombasa Road: at 100.0% PAR is a standing concern. Day-over-day stability here is not reassuring — this book needs a dedicated resolution plan, not monitoring.

WATCHING:
- Kiambu: PAR rose vs yesterday's close (+1.4%, +499.9K). A second consecutive uptick tomorrow would warrant escalation.

CLEAN:
- No zero-PAR branches at EOD. All branches carry residual at-risk balances — focus on reducing high-PAR outliers rather than celebrating clean branches. (If some branches are ~0%, name them and note they stayed clean.)

BOTTOM LINE:
Good day overall — 1.2M PAR improvement vs yesterday's close, driven largely by TOWN and Utawala. The portfolio-wide PAR rate fell 1.1% vs yesterday, which is a positive signal. However, TOWN at 23.6% / 13.0M remains priority number one, and Kiambu's rising trend is the one to watch tomorrow.

Return EXACTLY this JSON (no markdown):
{
  "greeting": "Hi Sir,",
  "headline": "EOD PAR REPORT — ${payload.dateLabel}",
  "overallLines": [
    "EOD Yesterday: X.X% | XM",
    "EOD Today: X.X% | XM",
    "Net change vs yesterday: …"
  ],
  "topPerformers": ["Branch: interpretive sentence…", "Branch: …"],
  "holdingSteady": ["Branch: interpretive sentence…"],
  "watching": ["Branch: interpretive sentence…"],
  "clean": ["interpretive sentence about clean / residual-PAR branches…"],
  "bottomLine": "2–4 sentences: call the day, name drivers, #1 priority, and tomorrow's watch item",
  "emailBody": "Full plain-text email for Sir using the interpretive bullets (not bare % arrows)"
}

Hard rules:
- Every bullet MUST start with "BranchName: " then genuine commentary. Never stop at "X% → Y%".
- Weave in 1–2 key figures only where they support the judgment (% moves, net change vs yesterday, closing % / amount).
- Rank Top Performers by improvement vs yesterday EOD; flag rising PAR vs yesterday for Watching; treat flat high-PAR as Holding Steady (not good news).
- Name the largest residual exposure and any structural problems (e.g. ~100% PAR books).
- Max 4 bullets per list (3 is fine). Skip empty sections with [].
- Use ONLY figures from DATA. Format amounts as 49M / 2.9M / 751K.
- Do not invent branches. Net change today = ${netChangeLabel}${vsYestPp != null ? `; overall vs yesterday = ${vsYestPp >= 0 ? '+' : ''}${vsYestPp}%` : ''}.
- Return ONLY JSON.

=== DATA ===
${JSON.stringify(
    {
      dateLabel: payload.dateLabel,
      country: payload.country,
      slots: {
        eod: payload.slots?.eod,
        eodYesterday: payload.slots?.eodYesterday,
      },
      overall: {
        eodYesterday: overall.eodYesterday,
        eod: overall.eod,
        netChangeVsYesterday: overall.netChangeVsYesterday,
      },
      branches: branchSummary,
    },
    null,
    2,
  )}
`
}

async function generateDailyParClaudeAnalysis(payload) {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }
  const model = String(process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001').trim()
  const prompt = buildDailyParClaudePrompt(payload)
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: 2200,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 90000,
    },
  )
  const raw = response.data?.content?.[0]?.text
  if (!raw) throw new Error('Empty Claude response')
  const parsed = parseAnthropicCommentaryJson(raw)
  const clipBullet = (s, n = 420) => String(s).slice(0, n)
  return {
    greeting: String(parsed.greeting || 'Hi Sir,').slice(0, 80),
    headline: String(parsed.headline || `EOD PAR REPORT — ${payload.dateLabel}`).slice(0, 160),
    overallLines: Array.isArray(parsed.overallLines)
      ? parsed.overallLines.map((s) => String(s).slice(0, 160)).slice(0, 6)
      : [],
    topPerformers: Array.isArray(parsed.topPerformers)
      ? parsed.topPerformers.map((s) => clipBullet(s)).slice(0, 5)
      : [],
    holdingSteady: Array.isArray(parsed.holdingSteady)
      ? parsed.holdingSteady.map((s) => clipBullet(s)).slice(0, 5)
      : [],
    watching: Array.isArray(parsed.watching)
      ? parsed.watching.map((s) => clipBullet(s)).slice(0, 5)
      : [],
    clean: Array.isArray(parsed.clean)
      ? parsed.clean.map((s) => clipBullet(s, 360)).slice(0, 6)
      : [],
    bottomLine: String(parsed.bottomLine || '').slice(0, 700),
    emailBody: String(parsed.emailBody || '').slice(0, 5000),
  }
}

// ─── Weekly PAR (Sun 03:00 → Sat 20:00 EAT) ─────────────────────────────────

function formatParNairobiStamp(iso) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return String(iso)
  }
}

function addCalendarDaysYmd(year, month, day, delta) {
  const dt = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  dt.setUTCDate(dt.getUTCDate() + Number(delta) || 0)
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  }
}

function nairobiWeekdaySun0(year, month, day) {
  const utc = nairobiWallClockUtc(year, month, day, 12, 0)
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
  }).format(utc)
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[wd] ?? 0
}

/** Week = Sunday–Saturday (Africa/Nairobi). `dateStr` may be any day in the week. */
function resolveWeeklyParBounds(dateStr = '') {
  const dateMatch = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  let year
  let month
  let day
  if (dateMatch) {
    year = Number(dateMatch[1])
    month = Number(dateMatch[2])
    day = Number(dateMatch[3])
  } else {
    const parts = nairobiDateParts(new Date())
    year = parts.year
    month = parts.month
    day = parts.day
  }
  const wd = nairobiWeekdaySun0(year, month, day)
  const sun = addCalendarDaysYmd(year, month, day, -wd)
  const sat = addCalendarDaysYmd(sun.year, sun.month, sun.day, 6)
  const priorSat = addCalendarDaysYmd(sun.year, sun.month, sun.day, -1)
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const fmtShort = (p) => `${p.day} ${monthNames[p.month - 1]}`
  const weekLabel = `${fmtShort(sun)} – ${fmtShort(sat)} ${sat.year}`
  const weekEndIso = `${sat.year}-${String(sat.month).padStart(2, '0')}-${String(sat.day).padStart(2, '0')}`
  const weekStartIso = `${sun.year}-${String(sun.month).padStart(2, '0')}-${String(sun.day).padStart(2, '0')}`
  return { sun, sat, priorSat, weekLabel, weekStartIso, weekEndIso }
}

async function buildWeeklyParReportPayload({
  dateStr = '',
  countryParam = 'Kenya',
  effectiveBranches = [],
  sowHour: sowHourIn = 3,
  eowHour: eowHourIn = 20,
} = {}) {
  const { sun, sat, priorSat, weekLabel, weekStartIso, weekEndIso } = resolveWeeklyParBounds(dateStr)
  const sowHour = Number.isFinite(Number(sowHourIn)) ? Number(sowHourIn) : 3
  const eowHour = Number.isFinite(Number(eowHourIn)) ? Number(eowHourIn) : 20

  const sowTarget = nairobiWallClockUtc(sun.year, sun.month, sun.day, sowHour, 0)
  const eowTarget = nairobiWallClockUtc(sat.year, sat.month, sat.day, eowHour, 0)
  const priorEowTarget = nairobiWallClockUtc(priorSat.year, priorSat.month, priorSat.day, eowHour, 0)

  const sowTime = findClosestParSnapshotTimeNear(sowTarget, { maxAbsHours: 8 })
  let eowTime = findClosestParSnapshotTimeNear(eowTarget, { maxAbsHours: 8 })
  if (!eowTime) {
    const latest = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    if (latest?.time) {
      const latestMs = new Date(latest.time).getTime()
      const sowMs = sowTarget.getTime()
      const weekEndMs = nairobiWallClockUtc(sat.year, sat.month, sat.day, 23, 59).getTime()
      if (latestMs >= sowMs && latestMs <= weekEndMs + 3 * 60 * 60 * 1000) {
        eowTime = latest.time
      }
    }
  }
  const priorEowTime = findClosestParSnapshotTimeNear(priorEowTarget, { maxAbsHours: 8 })

  const opts = { countryParam, effectiveBranches }
  const sowRows = sowTime ? buildParBranchRowsForSnapshot(sowTime, opts) : []
  const eowRows = eowTime ? buildParBranchRowsForSnapshot(eowTime, opts) : []
  const priorRows = priorEowTime ? buildParBranchRowsForSnapshot(priorEowTime, opts) : []

  const sowBy = new Map(sowRows.map((b) => [b.code, b]))
  const eowBy = new Map(eowRows.map((b) => [b.code, b]))
  const priorBy = new Map(priorRows.map((b) => [b.code, b]))
  const codes = new Set([...sowBy.keys(), ...eowBy.keys(), ...priorBy.keys()])

  const rate = (open, par) => (open > 0 ? (par / open) * 100 : 0)
  const shortName = (name) =>
    String(name || '')
      .replace(/\s+Branch$/i, '')
      .replace(/^Boda\s*-\s*/i, '')
      .trim()

  // Weekly thresholds (risk-reduced = SOW − EOW), calibrated from history:
  // reductions-only p25 ≈ 800K / 2.0%; median ≈ 1.6M / 3.3%.
  const MATERIAL_AMT = 750_000
  const MATERIAL_PP = 1.5
  const MATERIAL_SHARE = 0.03
  const HUGE_AMT = 2_500_000
  const HUGE_PP = 4.0
  const HEALTHY_PCT = 8

  const isMaterial = (riskAmt, riskPp, sowPar) => {
    const absAmt = Math.abs(Number(riskAmt) || 0)
    const absPp = Math.abs(Number(riskPp) || 0)
    const book = Math.max(0, Number(sowPar) || 0)
    if (absPp >= MATERIAL_PP) return true
    if (absAmt < MATERIAL_AMT) return false
    if (book <= 0) return absAmt >= MATERIAL_AMT
    return absAmt / book >= MATERIAL_SHARE
  }

  const branches = Array.from(codes)
    .map((code) => {
      const sow = sowBy.get(code)
      const eow = eowBy.get(code)
      const prior = priorBy.get(code)
      const name = shortName(eow?.name || sow?.name || prior?.name || code)

      const sowOpen = Number(sow?.openLoans) || 0
      const sowPar = Number(sow?.pastMissed) || 0
      const eowOpen = Number(eow?.openLoans) || 0
      const eowPar = Number(eow?.pastMissed) || 0
      const priorOpen = Number(prior?.openLoans) || 0
      const priorPar = Number(prior?.pastMissed) || 0

      const sowPct = rate(sowOpen, sowPar)
      const eowPct = rate(eowOpen, eowPar)
      const priorPct = rate(priorOpen, priorPar)
      const hasSow = !!sow && sowOpen > 0
      const hasEow = !!eow && eowOpen > 0
      const hasPrior = !!prior && priorOpen > 0

      const shiftWeek =
        hasSow && hasEow
          ? {
              parAmt: eowPar - sowPar,
              parPctPp: Number((eowPct - sowPct).toFixed(2)),
            }
          : null

      const riskReducedAmt = shiftWeek ? -(shiftWeek.parAmt || 0) : 0
      const riskReducedPp = shiftWeek ? -(shiftWeek.parPctPp || 0) : 0
      let classification = 'other'
      if (hasEow && eowPct < HEALTHY_PCT) classification = 'healthy'
      if (shiftWeek) {
        const material = isMaterial(riskReducedAmt, riskReducedPp, sowPar)
        if (!material) {
          classification = eowPct >= HEALTHY_PCT ? 'noAction' : 'healthy'
        } else if (riskReducedAmt < 0 || riskReducedPp < 0) {
          classification = 'anomaly'
        } else if (riskReducedAmt >= HUGE_AMT || riskReducedPp >= HUGE_PP) {
          classification = 'huge'
        } else {
          classification = 'reduced'
        }
      }

      return {
        code,
        name,
        hasSow,
        hasEow,
        hasPrior,
        classification,
        sow: { openLoans: sowOpen, par: sowPar, parPct: Number(sowPct.toFixed(2)) },
        eow: { openLoans: eowOpen, par: eowPar, parPct: Number(eowPct.toFixed(2)) },
        priorEow: { openLoans: priorOpen, par: priorPar, parPct: Number(priorPct.toFixed(2)) },
        shiftWeek,
        vsPriorWeek:
          hasPrior && hasEow
            ? {
                parAmt: eowPar - priorPar,
                parPctPp: Number((eowPct - priorPct).toFixed(2)),
              }
            : null,
      }
    })
    .sort((a, b) => (Number(b.eow?.par) || 0) - (Number(a.eow?.par) || 0))

  const sum = (rows, keyPath) =>
    rows.reduce((acc, r) => {
      const [a, b] = keyPath.split('.')
      acc += Number(r[a]?.[b]) || 0
      return acc
    }, 0)

  const overallSowPar = sum(branches, 'sow.par')
  const overallSowOpen = sum(branches, 'sow.openLoans')
  const overallEowPar = sum(branches, 'eow.par')
  const overallEowOpen = sum(branches, 'eow.openLoans')
  const overallPriorPar = sum(branches, 'priorEow.par')
  const overallPriorOpen = sum(branches, 'priorEow.openLoans')

  const overall = {
    sow: {
      openLoans: overallSowOpen,
      par: overallSowPar,
      parPct: Number(rate(overallSowOpen, overallSowPar).toFixed(2)),
    },
    eow: {
      openLoans: overallEowOpen,
      par: overallEowPar,
      parPct: Number(rate(overallEowOpen, overallEowPar).toFixed(2)),
    },
    priorEow: {
      openLoans: overallPriorOpen,
      par: overallPriorPar,
      parPct: Number(rate(overallPriorOpen, overallPriorPar).toFixed(2)),
    },
    shiftWeek: overallEowPar - overallSowPar,
    netChangeVsPriorWeek: overallPriorPar - overallEowPar,
  }

  const fmtPct = (v) => `${(Number(v) || 0).toFixed(1)}%`
  const fmtAmt = (v) => formatDailyParCompact(v)

  const reduced = []
  const noAction = []
  const healthy = []
  const anomaly = []
  const largestEow = [...branches].filter((b) => b.hasEow).sort((a, b) => (b.eow?.par || 0) - (a.eow?.par || 0))[0]

  for (const b of branches) {
    if (!b.hasSow || !b.hasEow) continue
    const riskAmt = -(b.shiftWeek?.parAmt || 0)
    const riskPp = -(b.shiftWeek?.parPctPp || 0)
    if (b.classification === 'huge' || b.classification === 'reduced') {
      const size =
        b.classification === 'huge' ? 'huge reduction' : riskAmt >= 750_000 ? 'solid reduction' : 'reduction'
      reduced.push({
        code: b.code,
        name: b.name,
        text: `${b.name}: ${size} this week — PAR down ${fmtAmt(riskAmt)} (${riskPp >= 0 ? '+' : ''}${riskPp.toFixed(1)}%), closing at ${fmtPct(b.eow.parPct)} / ${fmtAmt(b.eow.par)}.`,
      })
    } else if (b.classification === 'noAction') {
      noAction.push({
        code: b.code,
        name: b.name,
        text: `${b.name}: no meaningful risk reduction this week — still ${fmtPct(b.eow.parPct)} / ${fmtAmt(b.eow.par)}. Flat weeks at ≥8% are a collections miss.`,
      })
    } else if (b.classification === 'anomaly') {
      anomaly.push({
        code: b.code,
        name: b.name,
        text: `${b.name}: PAR rose ${fmtAmt(Math.abs(riskAmt))} (${Math.abs(riskPp).toFixed(1)}%) from Sunday open to Saturday close — investigate (should not grow from new dues mid-week).`,
      })
    } else if (b.classification === 'healthy') {
      healthy.push({
        code: b.code,
        name: b.name,
        text: `${b.name}: ends the week healthy at ${fmtPct(b.eow.parPct)} / ${fmtAmt(b.eow.par)} (under 8%).`,
      })
    }
  }

  reduced.sort((a, b) => {
    const ba = branches.find((x) => x.code === a.code)
    const bb = branches.find((x) => x.code === b.code)
    return -(bb?.shiftWeek?.parAmt || 0) - -(ba?.shiftWeek?.parAmt || 0)
  })

  const riskWeek = -(overall.shiftWeek || 0)
  const riskWeekPp =
    Number.isFinite(overall.sow?.parPct) && Number.isFinite(overall.eow?.parPct)
      ? overall.sow.parPct - overall.eow.parPct
      : 0
  let bottomLine = ''
  if (riskWeek >= 1_500_000) {
    bottomLine = `Excellent week — ${fmtAmt(riskWeek)} risk reduced (${riskWeekPp >= 0 ? '+' : ''}${riskWeekPp.toFixed(1)}% vs Sunday open).`
  } else if (riskWeek >= 300_000) {
    bottomLine = `PAR improved by ${fmtAmt(riskWeek)} over the week (${fmtPct(overall.sow.parPct)} → ${fmtPct(overall.eow.parPct)}).`
  } else if (riskWeek <= -300_000) {
    bottomLine = `PAR slipped by ${fmtAmt(Math.abs(riskWeek))} vs Sunday open (${fmtPct(overall.sow.parPct)} → ${fmtPct(overall.eow.parPct)}). Escalate no-action and anomaly branches.`
  } else {
    bottomLine = `Mixed/flat week overall (${fmtPct(overall.sow.parPct)} → ${fmtPct(overall.eow.parPct)}). Branches that stayed ≥8% without reducing risk need follow-up.`
  }
  if (largestEow && (largestEow.eow.parPct || 0) >= 10) {
    bottomLine += ` ${largestEow.name} at ${fmtPct(largestEow.eow.parPct)} / ${fmtAmt(largestEow.eow.par)} remains priority number one.`
  }
  if (noAction[0]) bottomLine += ` ${noAction[0].name} leads the no-action list.`
  if (anomaly[0]) bottomLine += ` ${anomaly[0].name} is the anomaly to investigate.`

  const payloadBase = {
    date: weekEndIso,
    weekStart: weekStartIso,
    weekEnd: weekEndIso,
    weekLabel,
    dateLabel: weekLabel,
    country: countryParam || null,
    slots: {
      sow: {
        targetHour: sowHour,
        label: `Start of week (Sun ~${String(sowHour).padStart(2, '0')}:00 EAT)`,
        time: sowTime,
        asOfLabel: formatParNairobiStamp(sowTime),
      },
      eow: {
        targetHour: eowHour,
        label: `End of week (Sat ~${String(eowHour).padStart(2, '0')}:00 EAT)`,
        time: eowTime,
        asOfLabel: formatParNairobiStamp(eowTime),
      },
      priorEow: {
        targetHour: eowHour,
        label: `Prior week end (Sat ~${String(eowHour).padStart(2, '0')}:00 EAT)`,
        time: priorEowTime,
        asOfLabel: formatParNairobiStamp(priorEowTime),
      },
    },
    overall,
    branches,
    narrative: {
      reduced: reduced.slice(0, 4),
      noAction: noAction.slice(0, 4),
      anomaly: anomaly.slice(0, 4),
      healthy: healthy.slice(0, 4),
      // aliases for template / Claude compatibility
      topPerformers: reduced.slice(0, 4),
      holdingSteady: noAction.slice(0, 4),
      watching: anomaly.slice(0, 4),
      clean: healthy.slice(0, 4),
      bottomLine,
    },
  }

  let claudeAnalysis = null
  let claudeError = null
  try {
    claudeAnalysis = await generateWeeklyParClaudeAnalysis(payloadBase)
  } catch (e) {
    claudeError = e.message || 'Claude analysis unavailable'
    console.warn('[Weekly PAR] Claude analysis skipped:', claudeError)
  }

  if (claudeAnalysis) {
    const toItems = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map((t) => String(t || '').trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((text) => ({ text }))
    if (toItems(claudeAnalysis.reduced).length) {
      payloadBase.narrative.reduced = toItems(claudeAnalysis.reduced)
      payloadBase.narrative.topPerformers = payloadBase.narrative.reduced
    }
    if (toItems(claudeAnalysis.noAction).length) {
      payloadBase.narrative.noAction = toItems(claudeAnalysis.noAction)
      payloadBase.narrative.holdingSteady = payloadBase.narrative.noAction
    }
    if (toItems(claudeAnalysis.anomaly).length) {
      payloadBase.narrative.anomaly = toItems(claudeAnalysis.anomaly)
      payloadBase.narrative.watching = payloadBase.narrative.anomaly
    }
    if (toItems(claudeAnalysis.healthy).length) {
      payloadBase.narrative.healthy = toItems(claudeAnalysis.healthy)
      payloadBase.narrative.clean = payloadBase.narrative.healthy
    }
    if (claudeAnalysis.bottomLine) {
      payloadBase.narrative.bottomLine = String(claudeAnalysis.bottomLine).slice(0, 700)
    }
  }

  return {
    ...payloadBase,
    claudeAnalysis,
    claudeError,
  }
}

function buildWeeklyParClaudePrompt(payload) {
  const overall = payload?.overall || {}
  const riskWeek = -(Number(overall.shiftWeek) || 0)
  const riskLabel =
    riskWeek >= 0
      ? `${formatDailyParCompact(riskWeek)} risk reduced vs Sunday open`
      : `${formatDailyParCompact(Math.abs(riskWeek))} increase vs Sunday open`
  const branchSummary = (Array.isArray(payload?.branches) ? payload.branches : []).slice(0, 25).map((b) => ({
    branch: b.name,
    classification: b.classification,
    sowPct: b.sow?.parPct,
    sowAmt: b.sow?.par,
    eowPct: b.eow?.parPct,
    eowAmt: b.eow?.par,
    riskReducedAmt: b.shiftWeek ? -(b.shiftWeek.parAmt || 0) : null,
    riskReducedPp: b.shiftWeek ? -(b.shiftWeek.parPctPp || 0) : null,
  }))

  return `You are the credit-ops analyst writing Phoenix Capital's Weekly PAR report for Logbook ${payload.country || 'Kenya'} for week ${payload.weekLabel}.

Week = Sunday 03:00 EAT (start) → Saturday 20:00 EAT (end). Reducing PAR is good. Flat ≥8% = no action (bad). Intraday/week rise is an anomaly.

Return EXACTLY this JSON (no markdown):
{
  "reduced": ["Branch: …"],
  "noAction": ["Branch: …"],
  "anomaly": ["Branch: …"],
  "healthy": ["Branch: …"],
  "bottomLine": "2–4 sentences"
}

Hard rules:
- Bullets start with "BranchName: ".
- PAR < 8% = healthy. Flat ≥8% = noAction. Rising SOW→EOW = anomaly. Meaningful drop = reduced.
- Use ONLY DATA. Amounts like 1.2M / 750K. Max 4 bullets per list.
- Week result = ${riskLabel}.

=== DATA ===
${JSON.stringify(
    {
      weekLabel: payload.weekLabel,
      country: payload.country,
      overall,
      branches: branchSummary,
    },
    null,
    2,
  )}`
}

async function generateWeeklyParClaudeAnalysis(payload) {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }
  const model = String(process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001').trim()
  const prompt = buildWeeklyParClaudePrompt(payload)
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 90000,
    },
  )
  const raw = response.data?.content?.[0]?.text
  if (!raw) throw new Error('Empty Claude response')
  const parsed = parseAnthropicCommentaryJson(raw)
  const clipBullet = (s, n = 420) => String(s).slice(0, n)
  return {
    reduced: Array.isArray(parsed.reduced) ? parsed.reduced.map((s) => clipBullet(s)).slice(0, 5) : [],
    noAction: Array.isArray(parsed.noAction) ? parsed.noAction.map((s) => clipBullet(s)).slice(0, 5) : [],
    anomaly: Array.isArray(parsed.anomaly) ? parsed.anomaly.map((s) => clipBullet(s)).slice(0, 5) : [],
    healthy: Array.isArray(parsed.healthy) ? parsed.healthy.map((s) => clipBullet(s, 360)).slice(0, 6) : [],
    bottomLine: String(parsed.bottomLine || '').slice(0, 700),
  }
}

function isWeeklyParEmailEnabled() {
  const flag = String(process.env.WEEKLY_PAR_EMAIL_ENABLED ?? process.env.DAILY_PAR_EMAIL_ENABLED ?? 'true').toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(flag)) return false
  return true
}

function buildWeeklyParPlainEmailBody(payload, country = 'Kenya') {
  const overall = payload?.overall || {}
  const narrative = payload?.narrative || {}
  const weekLabel = payload?.weekLabel || payload?.dateLabel || ''
  const sowPct = Number(overall.sow?.parPct)
  const eowPct = Number(overall.eow?.parPct)
  const sowAmt = Number(overall.sow?.par) || 0
  const eowAmt = Number(overall.eow?.par) || 0
  const riskAmt = -(Number(overall.shiftWeek) || 0)
  const riskPp =
    Number.isFinite(sowPct) && Number.isFinite(eowPct) ? Number((sowPct - eowPct).toFixed(2)) : null

  let overview = `Portfolio PAR closed the week at ${formatDailyParPct(eowPct)} (${formatDailyParCompact(eowAmt)})`
  if (Number.isFinite(sowPct) && riskPp != null) {
    const dir = riskPp > 0.05 ? 'down' : riskPp < -0.05 ? 'up' : 'flat'
    if (dir === 'flat') {
      overview += ` — essentially flat vs Sunday open ${formatDailyParPct(sowPct)} (${formatDailyParCompact(sowAmt)}).`
    } else if (dir === 'down') {
      overview += ` — down ${Math.abs(riskPp).toFixed(2)}% vs Sunday open ${formatDailyParPct(sowPct)} (${formatDailyParCompact(sowAmt)}), with ${formatDailyParCompact(riskAmt)} risk reduced.`
    } else {
      overview += ` — up ${Math.abs(riskPp).toFixed(2)}% vs Sunday open ${formatDailyParPct(sowPct)} (${formatDailyParCompact(sowAmt)}).`
    }
  } else {
    overview += '.'
  }

  const priorityBranch = [...(payload?.branches || [])]
    .filter((b) => b.hasEow)
    .sort((a, b) => (b.eow?.par || 0) - (a.eow?.par || 0))[0]
  let priority = ''
  if (priorityBranch) {
    priority = `${priorityBranch.name} remains the largest single exposure at ${formatDailyParPct(priorityBranch.eow.parPct)} / ${formatDailyParCompact(priorityBranch.eow.par)}.`
  }

  const watch = narrative.noAction?.[0]?.text || narrative.anomaly?.[0]?.text || ''

  const lines = [
    'Hi team,',
    '',
    `Please find this week's PAR report attached (${weekLabel}).`,
    '',
    `Overview: ${overview}`,
  ]
  if (priority) lines.push('', `Priority: ${priority}`)
  if (watch) lines.push('', `Watch: ${watch}`)
  lines.push(
    '',
    'The full branch breakdown and commentary are in the attached PDF.',
    '',
    'Regards,',
    `Phoenix Capital — ${country} Operations`,
  )
  return lines.join('\n')
}

async function sendWeeklyParReportEmail({ dateStr = '', countryParam = '', force = false } = {}) {
  if (!force && !isWeeklyParEmailEnabled()) {
    return { ok: false, skipped: true, reason: 'WEEKLY_PAR_EMAIL_ENABLED is off' }
  }

  const country = String(countryParam || process.env.DAILY_PAR_EMAIL_COUNTRY || 'Kenya').trim() || 'Kenya'
  const { to, cc } = getDailyParEmailRecipients(country)
  if (!to.length) {
    const hint =
      country.toLowerCase() === 'uganda'
        ? 'No recipients — set DAILY_PAR_EMAIL_TO_UGANDA (and optional DAILY_PAR_EMAIL_CC_UGANDA)'
        : 'No recipients — set DAILY_PAR_EMAIL_TO and/or DAILY_PAR_EMAIL_ROLES'
    return {
      ok: false,
      skipped: true,
      reason: hint,
      country,
    }
  }

  const payload = await buildWeeklyParReportPayload({
    dateStr,
    countryParam: country,
    effectiveBranches: [],
    sowHour: 3,
    eowHour: 20,
  })

  const html = renderWeeklyParReportHTML(payload)
  let pdfBuffer
  try {
    const { renderHtmlToPdfBuffer } = await import('./src/reports/htmlToPdf.js')
    pdfBuffer = await renderHtmlToPdfBuffer(html)
  } catch (err) {
    console.error('[Weekly PAR email] PDF generation failed:', err)
    throw new Error(`Failed to generate Weekly PAR PDF: ${err.message || err}`)
  }

  const weekLabel = payload.weekLabel || payload.dateLabel || ''
  const subject = `Weekly PAR — ${weekLabel} (${country})`
  const text = buildWeeklyParPlainEmailBody(payload, country)
  const emailHtml = dailyParEmailBodyToHtml(text)
  const filename = `Weekly-PAR-${country}-${payload.weekEnd || payload.date || 'report'}.pdf`

  const result = await sendEmail({
    to: to.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    subject,
    text,
    html: emailHtml,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })

  return {
    ok: !!result.ok,
    skipped: !!result.skipped,
    to,
    cc,
    subject,
    weekStart: payload.weekStart,
    weekEnd: payload.weekEnd,
    weekLabel,
    country,
    claudeError: payload.claudeError || null,
  }
}

async function sendWeeklyParReportEmailsForSchedule({ dateStr = '', force = false } = {}) {
  const countries = getDailyReportEmailCountries({ requireRecipients: !force })
  const results = []
  for (const country of countries) {
    try {
      const result = await sendWeeklyParReportEmail({ dateStr, countryParam: country, force })
      results.push(result)
    } catch (e) {
      results.push({ ok: false, country, error: e.message || String(e) })
      console.error(`[Weekly PAR email] ${country} failed:`, e.message)
    }
  }
  return { ok: results.some((r) => r.ok), results }
}

app.get('/api/reports/weekly-par', requireAuth, async (req, res) => {
  try {
    const effectiveBranches = getEffectiveLogbookBranches(req)
    const countryParam = req.query && req.query.country != null ? String(req.query.country).trim() : 'Kenya'
    const dateStr =
      (req.query && req.query.date != null ? String(req.query.date).trim() : '') ||
      (req.query && req.query.weekEnd != null ? String(req.query.weekEnd).trim() : '')
    const payload = await buildWeeklyParReportPayload({
      dateStr,
      countryParam,
      effectiveBranches,
      sowHour: 3,
      eowHour: 20,
    })
    res.json(payload)
  } catch (e) {
    console.error('[Weekly PAR] failed:', e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/reports/weekly-par/send', requireAuth, async (req, res) => {
  try {
    const role = String(req.authUser?.role || '').toLowerCase()
    if (role !== 'superuser' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin or superuser only' })
    }
    const dateStr =
      (req.body && req.body.date != null ? String(req.body.date).trim() : '') ||
      (req.query && req.query.date != null ? String(req.query.date).trim() : '')
    const countryParam =
      (req.body && req.body.country != null ? String(req.body.country).trim() : '') ||
      (req.query && req.query.country != null ? String(req.query.country).trim() : '')

    const result = await sendWeeklyParReportEmail({ dateStr, countryParam, force: true })
    if (result.skipped && !result.ok) {
      return res.status(400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('[Weekly PAR email] send failed:', e)
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
      ? db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ? AND branch_code = ?`).all(latestTime, branch)
      : db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Open_loans WHERE time = ?`).all(latestTime)
    let pastMissedRows = branch
      ? db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ? AND branch_code = ?`).all(latestTime, branch)
      : db.prepare(`SELECT ${LOANDISK_LOAN_SELECT_SQL} FROM Past_Missed_repayment WHERE time = ?`).all(latestTime)

    if (countryParam && effectiveBranches.length > 0) {
      const effectiveSet = new Set(effectiveBranches)
      openLoansRows = openLoansRows.filter((r) => effectiveSet.has(r.branch_code))
      pastMissedRows = pastMissedRows.filter((r) => effectiveSet.has(r.branch_code))
    }

    const officerMap = new Map()

    const accumulateLoan = (rows, kind) => {
      for (const row of rows) {
        try {
          let loan
          try {
            loan = parseLoandiskLoanRecord(row)
            if (!loan) continue
          } catch {
            continue
          }
          
          const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
          if (!borrowerAccessIds.length) continue

          const principal = parseParLoanPrincipal(loan)
          if (principal === 0) continue

          borrowerAccessIds.forEach((officerId) => {
            const officerKey = String(officerId).trim()
            if (!officerKey) return

            if (!officerMap.has(officerKey)) {
              officerMap.set(officerKey, {
                officerId: officerKey,
                ...createParTotals(),
                branches: new Set(),
              })
            }

            const entry = officerMap.get(officerKey)
            if (kind === 'open') addParOpenLoan(entry, principal)
            else addParDelinquentLoan(entry, loan, row)
            entry.branches.add(row.branch_code)
          })
        } catch {
          continue
        }
      }
    }

    accumulateLoan(openLoansRows, 'open')
    accumulateLoan(pastMissedRows, 'delinquent')

    const officerData = Array.from(officerMap.values()).map((entry) => {
      const agg = finalizeParTotals(entry)
      return {
        officerId: entry.officerId,
        openLoans: agg.openLoans,
        pastMissed: agg.pastMissed,
        parRate: agg.parRate,
        par30: agg.par30,
        par60: agg.par60,
        par90: agg.par90,
        par90Plus: agg.par90Plus,
        par30Rate: agg.par30Rate,
        par60Rate: agg.par60Rate,
        par90Rate: agg.par90Rate,
        par90PlusRate: agg.par90PlusRate,
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
          allPastMissedLoans.push({ branch_code: branchCode, loan })
        }

        // Fetch open loans for this branch
        const openLoans = await fetchLoanPrincipalSum(branchCode, '1')
        totalOpenLoans += openLoans.sum
        totalFetchedOpenLoans += openLoans.fetched

        // Store all open loan records with branch_code
        for (const loan of openLoans.loans || []) {
          allOpenLoans.push({ branch_code: branchCode, loan })
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
    const parAgg = aggregateParFromSnapshotLoanRows(
      allOpenLoans.map((r) => snapshotRowFromLoan(r.branch_code, r.loan)),
      allPastMissedLoans.map((r) => snapshotRowFromLoan(r.branch_code, r.loan)),
    )
    dbRW
      .prepare(
        `INSERT INTO PAR (time, Past_Arrears_missed, Open_loans, par_30, par_60, par_90, par_90_plus)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        totalPastMissed,
        totalOpenLoans,
        parAgg.global.par30,
        parAgg.global.par60,
        parAgg.global.par90,
        parAgg.global.par90Plus,
      )
    
    // Save branch-level loan data to tables
    // Clear old records for this timestamp (in case of re-runs)
    dbRW.prepare('DELETE FROM Open_loans WHERE time = ?').run(ts)
    dbRW.prepare('DELETE FROM Past_Missed_repayment WHERE time = ?').run(ts)
    
    // Insert all loan records (flattened columns only)
    for (const loanRecord of allOpenLoans) {
      insertLoandiskLoanRow(dbRW, 'Open_loans', {
        branch_code: loanRecord.branch_code,
        time: ts,
        loan: loanRecord.loan,
      })
    }

    for (const loanRecord of allPastMissedLoans) {
      insertLoandiskLoanRow(dbRW, 'Past_Missed_repayment', {
        branch_code: loanRecord.branch_code,
        time: ts,
        loan: loanRecord.loan,
      })
    }
    
    // After saving loan-level data, also aggregate and persist per Borrower Access ID (officer) for history
    try {
      const officerMap = new Map()

      const accumulateLoanForHistory = (records, kind) => {
        for (const rec of records) {
          try {
            const loan = rec.loan && typeof rec.loan === 'object' ? rec.loan : parseLoandiskLoanRecord(rec)
            if (!loan) continue

            const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
            if (!borrowerAccessIds.length) continue

            const principal = parseParLoanPrincipal(loan)
            if (principal === 0) continue

            borrowerAccessIds.forEach((officerId) => {
              const officerKey = String(officerId || '').trim()
              if (!officerKey) return

              if (!officerMap.has(officerKey)) {
                officerMap.set(officerKey, {
                  officerId: officerKey,
                  ...createParTotals(),
                  branches: new Set(),
                })
              }

              const entry = officerMap.get(officerKey)
              if (kind === 'open') addParOpenLoan(entry, principal)
              else addParDelinquentLoan(entry, loan, snapshotRowFromLoan(rec.branch_code, loan))
              entry.branches.add(rec.branch_code)
            })
          } catch {
            continue
          }
        }
      }

      accumulateLoanForHistory(allOpenLoans, 'open')
      accumulateLoanForHistory(allPastMissedLoans, 'delinquent')

      const snapshotDate = String(ts).slice(0, 10) // YYYY-MM-DD from ISO string
      const insertHist = dbRW.prepare(`
        INSERT INTO PAR_Borrower_Access_History (
          snapshot_time,
          snapshot_date,
          officer_id,
          open_loans,
          past_missed,
          par_rate,
          par_30,
          par_60,
          par_90,
          par_90_plus,
          branches
        ) VALUES (
          @snapshot_time,
          @snapshot_date,
          @officer_id,
          @open_loans,
          @past_missed,
          @par_rate,
          @par_30,
          @par_60,
          @par_90,
          @par_90_plus,
          @branches
        )
        ON CONFLICT(officer_id, snapshot_date) DO UPDATE SET
          snapshot_time = excluded.snapshot_time,
          open_loans = excluded.open_loans,
          past_missed = excluded.past_missed,
          par_rate = excluded.par_rate,
          par_30 = excluded.par_30,
          par_60 = excluded.par_60,
          par_90 = excluded.par_90,
          par_90_plus = excluded.par_90_plus,
          branches = excluded.branches,
          created_at = CURRENT_TIMESTAMP
      `)

      for (const entry of officerMap.values()) {
        const agg = finalizeParTotals(entry)
        insertHist.run({
          snapshot_time: ts,
          snapshot_date: snapshotDate,
          officer_id: entry.officerId,
          open_loans: agg.openLoans,
          past_missed: agg.pastMissed,
          par_rate: agg.parRate,
          par_30: agg.par30,
          par_60: agg.par60,
          par_90: agg.par90,
          par_90_plus: agg.par90Plus,
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

function getAnthropicApiKey() {
  return String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim()
}

function parseAnthropicCommentaryJson(raw) {
  let text = String(raw || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()
  return JSON.parse(text)
}

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
    res.json({
      maintenance: isMaintenanceEnabled(),
      maintenanceMessage: getMaintenanceDisplayMessage(),
    })
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
const normalizeSalesPersonName = (value) =>
  String(value || '')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const normalizeSalesBranch = (value) =>
  normalizeSalesPersonName(value)
    .replace(/\b(zidisha|bodacash|boda cash|logbook|branch|head quarters|kilimani)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const salesNameTokens = (value) =>
  normalizeSalesPersonName(value)
    .split(' ')
    .filter((token) => token.length > 1)

const salesTokenDistance = (left, right) => {
  if (left === right) return 0
  if (!left || !right) return Math.max(left.length, right.length)
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

const salesTokenMatches = (left, right) =>
  left === right ||
  (left.length >= 5 && right.length >= 5 && salesTokenDistance(left, right) <= 1)

const matchSalesEmployee = (sourceName, sourceBranch, employees) => {
  const sourceTokens = salesNameTokens(sourceName)
  if (!sourceTokens.length) return null
  const sourceBranchKey = normalizeSalesBranch(sourceBranch)
  let best = null

  for (const employee of employees) {
    const employeeTokens = employee._nameTokens
    const used = new Set()
    let matched = 0
    for (const sourceToken of sourceTokens) {
      const matchIndex = employeeTokens.findIndex(
        (employeeToken, index) => !used.has(index) && salesTokenMatches(sourceToken, employeeToken),
      )
      if (matchIndex >= 0) {
        used.add(matchIndex)
        matched += 1
      }
    }

    const branchMatch =
      sourceBranchKey &&
      employee._branchKey &&
      (sourceBranchKey === employee._branchKey ||
        sourceBranchKey.includes(employee._branchKey) ||
        employee._branchKey.includes(sourceBranchKey))
    const sufficientNameMatch =
      matched >= 2 ||
      (matched === 1 && sourceTokens.length === 1 && branchMatch) ||
      (matched === 1 && sourceTokens.length === 2 && branchMatch)
    if (!sufficientNameMatch) continue

    const score = matched / sourceTokens.length + (branchMatch ? 0.35 : 0)
    if (!best || score > best.score) best = { employee, score }
  }

  return best?.employee || null
}

app.get('/api/hr/sales-force', (req, res) => {
  try {
    const now = new Date()
    const month = Number.parseInt(req.query.month, 10) || now.getMonth() + 1
    const year = Number.parseInt(req.query.year, 10) || now.getFullYear()
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'A valid month and year are required' })
    }

    const employees = db
      .prepare(`
        SELECT
          id, employee_id, employee_number, full_name, first_name, middle_name,
          last_name, job_title, department, region
        FROM wingubox_employees
        WHERE active IN ('1', 1)
          AND (
            LOWER(COALESCE(department, '')) LIKE '%sale%'
            OR LOWER(COALESCE(job_title, '')) LIKE '%sale%'
            OR LOWER(COALESCE(department, '')) = 'collection department logbook'
          )
        ORDER BY full_name COLLATE NOCASE
      `)
      .all()
      .map((employee) => ({
        ...employee,
        _nameTokens: salesNameTokens(employee.full_name),
        _branchKey: normalizeSalesBranch(employee.region),
        products: {
          logbook: { loans: 0, amount: 0 },
          boda: { loans: 0, amount: 0 },
          zidisha: { loans: 0, amount: 0 },
          advans: { loans: 0, amount: 0 },
        },
        productBreakdown: {},
        matchedSalesNames: [],
      }))

    const monthText = String(month).padStart(2, '0')
    const period = `${year}-${monthText}`
    const salesRows = [
      ...db
        .prepare(`
          SELECT
            COALESCE(NULLIF(TRIM(sales_person), ''), NULLIF(TRIM(loan_officer), '')) AS person,
            TRIM(COALESCE(branch, '')) AS branch,
            'logbook' AS family,
            TRIM(COALESCE(product, 'Logbook')) AS product,
            COUNT(*) AS loans,
            COALESCE(SUM(CAST(disbursed AS REAL)), 0) AS amount
          FROM Logbook_Disbursement
          WHERE substr(disbursed_date, 4, 2) = ?
            AND substr(disbursed_date, 7, 4) = ?
            AND COALESCE(NULLIF(TRIM(sales_person), ''), NULLIF(TRIM(loan_officer), '')) IS NOT NULL
          GROUP BY person, branch, product
        `)
        .all(monthText, String(year)),
      ...db
        .prepare(`
          SELECT
            TRIM(COALESCE([Loan Officer Name], '')) AS person,
            TRIM(COALESCE([Branch Name], '')) AS branch,
            CASE
              WHEN LOWER(TRIM(COALESCE([Product Name], ''))) = 'zidisha boda' THEN 'boda'
              WHEN LOWER(TRIM(COALESCE([Product Name], ''))) LIKE '%advans%'
                OR LOWER(TRIM(COALESCE([Branch Name], ''))) = 'advans branch'
              THEN 'advans'
              ELSE 'zidisha'
            END AS family,
            TRIM(COALESCE([Product Name], 'Zidisha')) AS product,
            COUNT(*) AS loans,
            COALESCE(SUM(CAST([Principal Amount] AS REAL)), 0) AS amount
          FROM zidisha_data
          WHERE substr([Disbursed On Date], 1, 7) = ?
            AND TRIM(COALESCE([Loan Officer Name], '')) <> ''
            AND (
              LOWER(TRIM(COALESCE([Product Name], ''))) LIKE 'zidisha%'
              OR LOWER(TRIM(COALESCE([Product Name], ''))) LIKE '%advans%'
              OR LOWER(TRIM(COALESCE([Branch Name], ''))) = 'advans branch'
            )
          GROUP BY person, branch, family, product
        `)
        .all(period),
    ]

    const unmatched = []
    let matchedLoans = 0
    let totalLoans = 0
    for (const row of salesRows) {
      const loans = Number(row.loans) || 0
      const amount = Number(row.amount) || 0
      totalLoans += loans
      const employee = matchSalesEmployee(row.person, row.branch, employees)
      if (!employee) {
        unmatched.push({
          name: row.person,
          branch: row.branch,
          family: row.family,
          product: row.product,
          loans,
          amount,
        })
        continue
      }

      matchedLoans += loans
      employee.products[row.family].loans += loans
      employee.products[row.family].amount += amount
      employee.productBreakdown[row.product] = employee.productBreakdown[row.product] || { loans: 0, amount: 0 }
      employee.productBreakdown[row.product].loans += loans
      employee.productBreakdown[row.product].amount += amount
      if (!employee.matchedSalesNames.includes(row.person)) employee.matchedSalesNames.push(row.person)
    }

    const cleanEmployees = employees
      .map(({ _nameTokens, _branchKey, ...employee }) => {
        const total = Object.values(employee.products).reduce(
          (sum, product) => ({ loans: sum.loans + product.loans, amount: sum.amount + product.amount }),
          { loans: 0, amount: 0 },
        )
        return { ...employee, total }
      })
      .sort((left, right) => right.total.amount - left.total.amount || left.full_name.localeCompare(right.full_name))

    const totals = cleanEmployees.reduce(
      (result, employee) => {
        for (const family of ['logbook', 'boda', 'zidisha', 'advans']) {
          result[family].loans += employee.products[family].loans
          result[family].amount += employee.products[family].amount
          if (employee.products[family].loans > 0) result[family].staff += 1
        }
        result.loans += employee.total.loans
        result.amount += employee.total.amount
        if (employee.total.loans > 0) result.staffWithSales += 1
        return result
      },
      {
        logbook: { loans: 0, amount: 0, staff: 0 },
        boda: { loans: 0, amount: 0, staff: 0 },
        zidisha: { loans: 0, amount: 0, staff: 0 },
        advans: { loans: 0, amount: 0, staff: 0 },
        loans: 0,
        amount: 0,
        staffWithSales: 0,
      },
    )

    const classifyTargetFamily = (branchName) => {
      const branch = String(branchName || '')
        .trim()
        .toLowerCase()
      if (branch.startsWith('boda')) return 'boda'
      if (branch.includes('advans')) return 'advans'
      return 'zidisha'
    }

    const branchKey = (name) =>
      String(name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

    const ensureBranch = (map, name) => {
      const key = branchKey(name)
      if (!key) return null
      if (!map.has(key)) {
        map.set(key, {
          branch: String(name || '').trim() || 'Unassigned',
          actual: 0,
          target: 0,
        })
      }
      return map.get(key)
    }

    const familyBranches = {
      boda: new Map(),
      zidisha: new Map(),
      advans: new Map(),
      logbook: new Map(),
    }

    const logbookActualRows = db
      .prepare(`
        SELECT
          COALESCE(NULLIF(TRIM(b.name), ''), NULLIF(TRIM(d.branch), ''), 'Unassigned') AS branch,
          COALESCE(SUM(CAST(d.disbursed AS REAL)), 0) AS amount
        FROM Logbook_Disbursement d
        LEFT JOIN Logbook_Branches b
          ON TRIM(CAST(b.code AS TEXT)) = TRIM(CAST(d.branch AS TEXT))
        WHERE substr(d.disbursed_date, 4, 2) = ?
          AND substr(d.disbursed_date, 7, 4) = ?
        GROUP BY 1
      `)
      .all(monthText, String(year))

    for (const row of logbookActualRows) {
      const entry = ensureBranch(familyBranches.logbook, row.branch || 'Unassigned')
      if (entry) entry.actual += Number(row.amount) || 0
    }

    const zidishaActualBranchRows = db
      .prepare(`
        SELECT
          CASE
            WHEN LOWER(TRIM(COALESCE([Product Name], ''))) = 'zidisha boda' THEN 'boda'
            WHEN LOWER(TRIM(COALESCE([Product Name], ''))) LIKE '%advans%'
              OR LOWER(TRIM(COALESCE([Branch Name], ''))) = 'advans branch'
            THEN 'advans'
            ELSE 'zidisha'
          END AS family,
          TRIM(COALESCE([Branch Name], 'Unassigned')) AS branch,
          COALESCE(SUM(CAST([Principal Amount] AS REAL)), 0) AS amount
        FROM zidisha_data
        WHERE substr([Disbursed On Date], 1, 7) = ?
          AND (
            LOWER(TRIM(COALESCE([Product Name], ''))) LIKE 'zidisha%'
            OR LOWER(TRIM(COALESCE([Product Name], ''))) LIKE '%advans%'
            OR LOWER(TRIM(COALESCE([Branch Name], ''))) = 'advans branch'
          )
        GROUP BY family, branch
      `)
      .all(period)

    for (const row of zidishaActualBranchRows) {
      const map = familyBranches[row.family]
      if (!map) continue
      const entry = ensureBranch(map, row.branch || 'Unassigned')
      if (entry) entry.actual += Number(row.amount) || 0
    }

    const logbookTargetRows = db
      .prepare(`
        SELECT branch, disbursement_target
        FROM Logbook_Targets
        WHERE month = ? AND year = ? AND active = 1
      `)
      .all(month, year)

    for (const row of logbookTargetRows) {
      const entry = ensureBranch(familyBranches.logbook, row.branch || 'Unassigned')
      if (entry) entry.target += Number(row.disbursement_target) || 0
    }

    const zidishaTargetRows = db
      .prepare(`
        SELECT branch, disbursement_target
        FROM Zidisha_Targets
        WHERE month = ? AND year = ? AND active = 1
      `)
      .all(month, year)

    for (const row of zidishaTargetRows) {
      const family = classifyTargetFamily(row.branch)
      const entry = ensureBranch(familyBranches[family], row.branch || 'Unassigned')
      if (entry) entry.target += Number(row.disbursement_target) || 0
    }

    const buildRate = (family) => {
      const branches = Array.from(familyBranches[family].values())
        .filter((row) => row.actual > 0 || row.target > 0)
        .map((row) => {
          const actual = Math.round(row.actual)
          const target = Math.round(row.target)
          return {
            branch: row.branch,
            actual,
            target,
            rate: target > 0 ? (actual / target) * 100 : 0,
            hasTarget: target > 0,
          }
        })
        .sort((a, b) => b.actual - a.actual || a.branch.localeCompare(b.branch))

      const actual = branches.reduce((sum, row) => sum + row.actual, 0)
      const target = branches.reduce((sum, row) => sum + row.target, 0)
      return {
        actual,
        target,
        rate: target > 0 ? (actual / target) * 100 : 0,
        hasTarget: target > 0,
        branches,
      }
    }

    const rates = {
      boda: buildRate('boda'),
      zidisha: buildRate('zidisha'),
      advans: buildRate('advans'),
      logbook: buildRate('logbook'),
    }

    res.json({
      month,
      year,
      employees: cleanEmployees,
      totals,
      rates,
      matching: {
        matchedLoans,
        totalLoans,
        matchRate: totalLoans ? (matchedLoans / totalLoans) * 100 : 0,
        unmatched,
      },
    })
  } catch (e) {
    console.error('[HR Sales Force API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/hr/collections-par', (req, res) => {
  try {
    const now = new Date()
    const month = Number.parseInt(req.query.month, 10) || now.getMonth() + 1
    const year = Number.parseInt(req.query.year, 10) || now.getFullYear()
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'A valid month and year are required' })
    }

    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
    const daysInMonth = new Date(year, month, 0).getDate()
    const cutoffDay = Math.min(
      Number.parseInt(req.query.cutoffDay, 10) || (isCurrentMonth ? now.getDate() : daysInMonth),
      daysInMonth,
    )

    const employees = db
      .prepare(`
        SELECT
          id, employee_id, employee_number, full_name, first_name, middle_name,
          last_name, job_title, department, region
        FROM wingubox_employees
        WHERE active IN ('1', 1)
          AND (
            LOWER(COALESCE(department, '')) LIKE '%collect%'
            OR LOWER(COALESCE(job_title, '')) LIKE '%collect%'
            OR LOWER(COALESCE(job_title, '')) LIKE '%relationship officer%'
            OR LOWER(COALESCE(department, '')) LIKE '%bodacash collection%'
          )
        ORDER BY full_name COLLATE NOCASE
      `)
      .all()
      .map((employee) => ({
        ...employee,
        _nameTokens: salesNameTokens(employee.full_name),
        _branchKey: normalizeSalesBranch(employee.region),
        products: {
          logbook: { loans: 0, amount: 0, expected: 0 },
          boda: { loans: 0, amount: 0, expected: 0 },
          zidisha: { loans: 0, amount: 0, expected: 0 },
          advans: { loans: 0, amount: 0, expected: 0 },
        },
        matchedOfficerNames: [],
      }))

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
    const maturity = zidishaExpectedMaturityExpr('z')

    const collectionRows = []

    // Logbook cash collections by RO (borrower_access_ids → LOs name)
    const loById = new Map(
      db
        .prepare(`SELECT borrower_access_id, name FROM LOs WHERE borrower_access_id IS NOT NULL`)
        .all()
        .map((row) => [String(row.borrower_access_id).trim(), String(row.name || '').trim()]),
    )
    const branchNameByCode = new Map(
      db
        .prepare(`SELECT code, name FROM Logbook_Branches`)
        .all()
        .map((row) => [String(row.code || '').trim(), String(row.name || '').trim()]),
    )

    const logbookCollectionRows = db
      .prepare(`
        SELECT
          repayment_amount,
          repayment_collected_date,
          borrower_access_ids,
          branch
        FROM Logbook_collection
        WHERE repayment_collected_date IS NOT NULL
          AND TRIM(repayment_collected_date) <> ''
          AND borrower_access_ids IS NOT NULL
          AND TRIM(borrower_access_ids) <> ''
      `)
      .all()

    const logbookAgg = new Map()
    for (const row of logbookCollectionRows) {
      const dateStr = String(row.repayment_collected_date || '').trim()
      const parts = dateStr.split('/')
      if (parts.length < 3) continue
      const rowMonth = Number.parseInt(parts[1], 10)
      const rowYear = Number.parseInt(parts[2], 10)
      if (rowMonth !== month || rowYear !== year) continue

      let borrowerIds = []
      try {
        const parsed = JSON.parse(row.borrower_access_ids)
        if (Array.isArray(parsed)) borrowerIds = parsed.map((id) => String(id).trim()).filter(Boolean)
        else if (parsed) borrowerIds = [String(parsed).trim()].filter(Boolean)
      } catch {
        const strId = String(row.borrower_access_ids || '').trim()
        if (strId) borrowerIds = [strId]
      }

      const amount = Number(row.repayment_amount) || 0
      const branchCode = String(row.branch || '').trim()
      const branch = branchNameByCode.get(branchCode) || branchCode || 'Unassigned'

      for (const borrowerId of borrowerIds) {
        const person = loById.get(borrowerId)
        if (!person) continue
        const key = `${person}||${branch}`
        if (!logbookAgg.has(key)) {
          logbookAgg.set(key, { person, branch, family: 'logbook', loans: 0, amount: 0, expected: 0 })
        }
        const entry = logbookAgg.get(key)
        entry.loans += 1
        entry.amount += amount
      }
    }
    collectionRows.push(...logbookAgg.values())

    // Zidisha / Advans maturity-month collected by officer
    const zidishaFlat = db
      .prepare(
        `SELECT
           TRIM(z."Branch Name") AS branch,
           TRIM(COALESCE(z."Loan Officer Name", 'Unknown')) AS officer,
           CASE
             WHEN LOWER(TRIM(COALESCE(z."Product Name", ''))) LIKE '%advans%'
               OR LOWER(TRIM(COALESCE(z."Branch Name", ''))) = 'advans branch'
             THEN 'advans'
             ELSE 'zidisha'
           END AS family,
           COALESCE(CAST(z."Total Expected Repayment Derived" AS REAL), 0) AS expected,
           COALESCE(CAST(z."Total Repayment Derived" AS REAL), 0) AS collected
         FROM zidisha_data z
         WHERE ${maturity} >= date(?)
           AND ${maturity} < date(?)
           AND CAST(strftime('%d', ${maturity}) AS INTEGER) <= ?
           AND (
             LOWER(TRIM(COALESCE(z."Product Name", ''))) LIKE 'zidisha%'
             OR LOWER(TRIM(COALESCE(z."Product Name", ''))) LIKE '%advans%'
             OR LOWER(TRIM(COALESCE(z."Branch Name", ''))) = 'advans branch'
           )
           AND LOWER(TRIM(COALESCE(z."Product Name", ''))) <> 'zidisha boda'`,
      )
      .all(monthStart, monthEnd, cutoffDay)

    const zidishaAgg = new Map()
    for (const row of zidishaFlat) {
      const person = String(row.officer || '').trim()
      const branch = String(row.branch || '').trim() || 'Unassigned'
      const family = row.family === 'advans' ? 'advans' : 'zidisha'
      if (!person || person.toLowerCase() === 'unknown') continue
      const key = `${family}||${person}||${branch}`
      if (!zidishaAgg.has(key)) {
        zidishaAgg.set(key, { person, branch, family, loans: 0, amount: 0, expected: 0 })
      }
      const entry = zidishaAgg.get(key)
      entry.loans += 1
      entry.amount += Number(row.collected) || 0
      entry.expected += Number(row.expected) || 0
    }
    collectionRows.push(...zidishaAgg.values())

    // Boda schedule due-month collected by officer
    const bodaFlat = db
      .prepare(
        `SELECT
           TRIM(s."Branch Name") AS branch,
           TRIM(COALESCE(z."Loan Officer Name", 'Unknown')) AS officer,
           COALESCE(CAST(REPLACE(s."Total Expected", ',', '') AS REAL), 0) AS expected,
           COALESCE(CAST(REPLACE(s."Total Outstanding", ',', '') AS REAL), 0) AS outstanding
         FROM boda_Schedule s
         LEFT JOIN zidisha_data z
           ON TRIM(s."Loan Id") = TRIM(z."Loan ID")
         WHERE s."Due Date" >= ?
           AND s."Due Date" < ?
           AND COALESCE(TRIM(s."Product Name"), '') COLLATE NOCASE = 'Zidisha Boda'
           AND CAST(strftime('%d', s."Due Date") AS INTEGER) <= ?`,
      )
      .all(monthStart, monthEnd, cutoffDay)

    const bodaAgg = new Map()
    for (const row of bodaFlat) {
      const person = String(row.officer || '').trim()
      const branch = String(row.branch || '').trim() || 'Unassigned'
      if (!person || person.toLowerCase() === 'unknown') continue
      const expected = Number(row.expected) || 0
      const collected = Math.max(0, expected - (Number(row.outstanding) || 0))
      const key = `${person}||${branch}`
      if (!bodaAgg.has(key)) {
        bodaAgg.set(key, { person, branch, family: 'boda', loans: 0, amount: 0, expected: 0 })
      }
      const entry = bodaAgg.get(key)
      entry.loans += 1
      entry.amount += collected
      entry.expected += expected
    }
    collectionRows.push(...bodaAgg.values())

    // Logbook RO targets as expected/target by officer name
    try {
      const roTargets = db
        .prepare(`SELECT loan_officer_name, sum_of_target FROM RO_Targets WHERE month = ? AND year = ?`)
        .all(month, year)
      for (const row of roTargets) {
        const person = String(row.loan_officer_name || '').trim()
        if (!person) continue
        const target = Number(row.sum_of_target) || 0
        if (target <= 0) continue
        const employee = matchSalesEmployee(person, '', employees)
        if (employee) employee.products.logbook.expected += target
      }
    } catch (e) {
      console.error('[HR Collections PAR] RO_Targets:', e.message)
    }

    const unmatched = []
    let matchedRows = 0
    let totalRows = 0
    for (const row of collectionRows) {
      const loans = Number(row.loans) || 0
      const amount = Number(row.amount) || 0
      const expected = Number(row.expected) || 0
      totalRows += loans
      const employee = matchSalesEmployee(row.person, row.branch, employees)
      if (!employee) {
        unmatched.push({
          name: row.person,
          branch: row.branch,
          family: row.family,
          loans,
          amount,
          expected,
        })
        continue
      }
      matchedRows += loans
      employee.products[row.family].loans += loans
      employee.products[row.family].amount += amount
      employee.products[row.family].expected += expected
      if (!employee.matchedOfficerNames.includes(row.person)) {
        employee.matchedOfficerNames.push(row.person)
      }
    }

    const cleanEmployees = employees
      .map(({ _nameTokens, _branchKey, ...employee }) => {
        const total = Object.values(employee.products).reduce(
          (sum, product) => ({
            loans: sum.loans + product.loans,
            amount: sum.amount + product.amount,
            expected: sum.expected + product.expected,
          }),
          { loans: 0, amount: 0, expected: 0 },
        )
        return { ...employee, total }
      })
      .sort((left, right) => right.total.amount - left.total.amount || left.full_name.localeCompare(right.full_name))

    const totals = cleanEmployees.reduce(
      (result, employee) => {
        for (const family of ['logbook', 'boda', 'zidisha', 'advans']) {
          result[family].loans += employee.products[family].loans
          result[family].amount += employee.products[family].amount
          result[family].expected += employee.products[family].expected
          if (employee.products[family].loans > 0 || employee.products[family].amount > 0) {
            result[family].staff += 1
          }
        }
        result.loans += employee.total.loans
        result.amount += employee.total.amount
        result.expected += employee.total.expected
        if (employee.total.loans > 0 || employee.total.amount > 0) result.staffWithCollections += 1
        return result
      },
      {
        logbook: { loans: 0, amount: 0, expected: 0, staff: 0 },
        boda: { loans: 0, amount: 0, expected: 0, staff: 0 },
        zidisha: { loans: 0, amount: 0, expected: 0, staff: 0 },
        advans: { loans: 0, amount: 0, expected: 0, staff: 0 },
        loans: 0,
        amount: 0,
        expected: 0,
        staffWithCollections: 0,
      },
    )

    const classifyTargetFamily = (branchName) => {
      const branch = String(branchName || '')
        .trim()
        .toLowerCase()
      if (branch.startsWith('boda')) return 'boda'
      if (branch.includes('advans')) return 'advans'
      return 'zidisha'
    }

    const branchKey = (name) =>
      String(name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

    const ensureBranch = (map, name) => {
      const key = branchKey(name)
      if (!key) return null
      if (!map.has(key)) {
        map.set(key, {
          branch: String(name || '').trim() || 'Unassigned',
          actual: 0,
          target: 0,
          expected: 0,
        })
      }
      return map.get(key)
    }

    const familyBranches = {
      boda: new Map(),
      zidisha: new Map(),
      advans: new Map(),
      logbook: new Map(),
    }

    for (const row of collectionRows) {
      const map = familyBranches[row.family]
      if (!map) continue
      const entry = ensureBranch(map, row.branch || 'Unassigned')
      if (!entry) continue
      entry.actual += Number(row.amount) || 0
      entry.expected += Number(row.expected) || 0
    }

    for (const row of db
      .prepare(`
        SELECT branch, collection_target
        FROM Logbook_Targets
        WHERE month = ? AND year = ? AND active = 1
      `)
      .all(month, year)) {
      const entry = ensureBranch(familyBranches.logbook, row.branch || 'Unassigned')
      if (entry) entry.target += Number(row.collection_target) || 0
    }

    for (const row of db
      .prepare(`
        SELECT branch, collection_target
        FROM Zidisha_Targets
        WHERE month = ? AND year = ? AND active = 1
      `)
      .all(month, year)) {
      const family = classifyTargetFamily(row.branch)
      const entry = ensureBranch(familyBranches[family], row.branch || 'Unassigned')
      if (entry) entry.target += Number(row.collection_target) || 0
    }

    // When explicit collection targets are blank, fall back to schedule expected.
    for (const family of Object.keys(familyBranches)) {
      for (const entry of familyBranches[family].values()) {
        if (entry.target <= 0 && entry.expected > 0) entry.target = entry.expected
      }
    }

    // Logbook RO portfolio targets as product-level target if branch targets empty
    if (
      Array.from(familyBranches.logbook.values()).every((row) => row.target <= 0) &&
      totals.logbook.expected > 0
    ) {
      const entry = ensureBranch(familyBranches.logbook, 'RO Targets')
      if (entry) entry.target = totals.logbook.expected
    }

    const buildRate = (family) => {
      const branches = Array.from(familyBranches[family].values())
        .filter((row) => row.actual > 0 || row.target > 0)
        .map((row) => {
          const actual = Math.round(row.actual)
          const target = Math.round(row.target)
          return {
            branch: row.branch,
            actual,
            target,
            rate: target > 0 ? (actual / target) * 100 : 0,
            hasTarget: target > 0,
          }
        })
        .sort((a, b) => b.actual - a.actual || a.branch.localeCompare(b.branch))

      const actual = branches.reduce((sum, row) => sum + row.actual, 0)
      const target = branches.reduce((sum, row) => sum + row.target, 0)
      return {
        actual,
        target,
        rate: target > 0 ? (actual / target) * 100 : 0,
        hasTarget: target > 0,
        branches,
      }
    }

    const rates = {
      boda: buildRate('boda'),
      zidisha: buildRate('zidisha'),
      advans: buildRate('advans'),
      logbook: buildRate('logbook'),
    }

    res.json({
      month,
      year,
      cutoffDay,
      employees: cleanEmployees,
      totals,
      rates,
      matching: {
        matchedLoans: matchedRows,
        totalLoans: totalRows,
        matchRate: totalRows ? (matchedRows / totalRows) * 100 : 0,
        unmatched,
      },
    })
  } catch (e) {
    console.error('[HR Collections PAR API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

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
    const { enabled, message } = req.body || {}
    if (typeof message === 'string') {
      const trimmed = message.trim().slice(0, 500)
      if (trimmed) {
        setSetting(MAINTENANCE_MESSAGE_KEY, trimmed)
      }
    }
    if (typeof enabled === 'boolean') {
      setSetting('maintenance_mode', enabled ? '1' : '0')
    }
    res.json({
      maintenance: isMaintenanceEnabled(),
      maintenanceMessage: getMaintenanceDisplayMessage(),
    })
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

// Daily PAR email: Monday–Saturday 20:00 Africa/Nairobi (Kenya + Uganda when recipients set)
cron.schedule(
  '0 20 * * 1-6',
  async () => {
    console.log(`[CRON] Running Daily PAR email job at ${new Date().toISOString()}`)
    try {
      const result = await sendDailyParReportEmailsForSchedule({})
      console.log('[CRON] Daily PAR email result:', result)
    } catch (e) {
      console.error('[CRON] Daily PAR email failed:', e.message)
    }
  },
  {
    scheduled: true,
    timezone: 'Africa/Nairobi',
  },
)

// Daily Disbursements email: Monday–Saturday 20:05 Africa/Nairobi (Kenya + Uganda when recipients set)
cron.schedule(
  '5 20 * * 1-6',
  async () => {
    console.log(`[CRON] Running Daily Disbursement email job at ${new Date().toISOString()}`)
    try {
      const result = await sendDailyDisbursementReportEmailsForSchedule({})
      console.log('[CRON] Daily Disbursement email result:', result)
    } catch (e) {
      console.error('[CRON] Daily Disbursement email failed:', e.message)
    }
  },
  {
    scheduled: true,
    timezone: 'Africa/Nairobi',
  },
)

// Weekly PAR email: Saturday 20:15 Africa/Nairobi (after Daily PAR at 20:00)
cron.schedule(
  '15 20 * * 6',
  async () => {
    console.log(`[CRON] Running Weekly PAR email job at ${new Date().toISOString()}`)
    try {
      const result = await sendWeeklyParReportEmailsForSchedule({})
      console.log('[CRON] Weekly PAR email result:', result)
    } catch (e) {
      console.error('[CRON] Weekly PAR email failed:', e.message)
    }
  },
  {
    scheduled: true,
    timezone: 'Africa/Nairobi',
  },
)

// Payment obligations reminder: daily 08:00 Africa/Nairobi → gregory@phoenixcapital.co.ke (before due dates)
cron.schedule(
  '0 8 * * *',
  async () => {
    console.log(`[CRON] Running payment obligation reminders at ${new Date().toISOString()}`)
    try {
      const result = await sendPaymentObligationReminders({})
      console.log('[CRON] Payment reminder result:', result)
    } catch (e) {
      console.error('[CRON] Payment reminder failed:', e.message)
    }
  },
  {
    scheduled: true,
    timezone: 'Africa/Nairobi',
  },
)

// Daily: drop extra 30-min loan snapshots (keep last 2 days in full, then SOD/EOD forever)
cron.schedule(
  '15 1 * * *',
  () => {
    console.log(`[CRON] Running PAR snapshot prune at ${new Date().toISOString()}`)
    // --online: small deletes + pauses so the live site is not locked for long
    const proc = spawnNodeScript('scripts/sqlite_storage.mjs', {
      args: ['--prune', '--apply', '--online'],
      env: {
        ...process.env,
        KEEP_FULL_DAYS: '2',
        KEEP_DAILY_DAYS: '0',
        PRUNE_BATCH_SIZE: '3',
        PRUNE_SLEEP_MS: '1500',
      },
    })
    proc.stdout.on('data', (chunk) => console.log(`[PAR-PRUNE-OUT] ${chunk.toString().trimEnd()}`))
    proc.stderr.on('data', (chunk) => console.error(`[PAR-PRUNE-ERR] ${chunk.toString().trimEnd()}`))
    proc.on('close', (code) => console.log(`[CRON] PAR snapshot prune completed with code ${code}`))
    proc.on('error', (err) => console.error('[CRON] PAR snapshot prune failed to start:', err.message))
  },
  {
    scheduled: true,
    timezone: 'Africa/Nairobi',
  },
)

// Every 10 minutes: run ingestion without borrowers (fast refresh)
cron.schedule('*/10 * * * *', () => {
  console.log(`[CRON] Running scheduled data refresh (no borrowers) at ${new Date().toISOString()}`)
  const env = {
    ...process.env,
    SKIP_BORROWERS: '1',
    // Musoni export #20 currently 500s; keep last snapshot and do not retry every 10 min
    SKIP_BODA_REPAYMENTS: '1',
  }
  const proc = spawnNodeScript('scripts/fetch_disbursments.mjs', { env })
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
  const proc = spawnNodeScript('scripts/fetch_disbursments.mjs', { env })
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
  const proc = spawnNodeScript('scripts/fetch_gpsiot_clients.mjs')
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
  const proc = spawnNodeScript('scripts/fetch_wingubox_employees.mjs', { cwd: __dirname })
  proc.stdout.on('data', (chunk) => {
    console.log(`[WINGUBOX-CRON-OUT] ${chunk.toString().trimEnd()}`)
  })
  proc.stderr.on('data', (chunk) => {
    console.error(`[WINGUBOX-CRON-ERR] ${chunk.toString().trimEnd()}`)
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
  try {
    startTelegramBot(dbRW)
  } catch (e) {
    console.warn('[TelegramBot] failed to start:', e.message)
    logError({ source: 'telegramBot/start', message: e.message || String(e) }).catch(() => {})
  }
})

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  logError({
    source: 'uncaughtException',
    message: err?.message || String(err),
    stack: err?.stack,
  }).catch(() => {})
})

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  console.error('[unhandledRejection]', reason)
  logError({
    source: 'unhandledRejection',
    message,
    stack,
  }).catch(() => {})
})
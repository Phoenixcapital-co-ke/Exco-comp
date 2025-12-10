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

const app = express()
const PORT = process.env.PORT || 3001
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isProduction = process.env.NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-me-in-production'
const JWT_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 24)
const AUTH_COOKIE_NAME = 'pcdash_auth'
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  maxAge: JWT_TTL_HOURS * 60 * 60 * 1000,
  path: '/'
}

const events = new EventEmitter()
const db = new Database('data/app.db', { readonly: true });
// Separate write-enabled handle for inserts/updates
const dbRW = new Database('data/app.db');
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

const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/logout'])

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
// Ensure Logbook_Branches table exists
dbRW.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Branches (
    code TEXT PRIMARY KEY,
    name TEXT,
    active INTEGER DEFAULT 1
  );
`);

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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

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

const hashPassword = (plainText) =>
  crypto.createHash('sha256').update(String(plainText ?? '')).digest('hex')

try {
  const userCount = dbRW.prepare('SELECT COUNT(*) as c FROM Users').get().c
  if (userCount === 0) {
    dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, role, active, password_hash)
         VALUES (@username, @full_name, @email, @role, 1, @password_hash)`
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

app.use(cookieParser())
app.use(express.json())
app.use(compression())
app.use(attachAuthFromToken)
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next()
  }
  const path = req.path?.toLowerCase?.() || ''
  if (PUBLIC_API_PATHS.has(path)) {
    return next()
  }
  return requireAuth(req, res, next)
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
app.get('/api/zidisha/data', (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const pageSizeRaw = parseInt(req.query.pageSize, 10)
    const pageSize = Math.min(Math.max(pageSizeRaw || 2000, 100), 10000)
    const offset = (page - 1) * pageSize

    const totalRow = db.prepare('SELECT COUNT(*) as count FROM zidisha_data').get()
    const total = totalRow?.count || 0
    const rows = db.prepare('SELECT * FROM zidisha_data ORDER BY rowid DESC LIMIT ? OFFSET ?').all(pageSize, offset)

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

app.get('/api/logbook/disbursements', (req, res) => {
  const rows = db.prepare('SELECT * FROM Logbook_Disbursement').all();
  res.json(rows);
});

app.get('/api/logbook/collections', (req, res) => {
  const rows = db.prepare('SELECT * FROM Logbook_collection').all();
  res.json(rows);
});

app.get('/api/logbook/borrowers', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM Logbook_borrowers').all()
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
    const rows = dbRW.prepare('SELECT code, name, active FROM Logbook_Branches ORDER BY name COLLATE NOCASE').all()
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
  role: user.role,
  active: !!user.active,
  createdAt: user.created_at,
  updatedAt: user.updated_at
  }
  // For custom role users, include their allowed pages
  if (String(user.role || '').toLowerCase() === 'custom') {
    const pages = dbRW
      .prepare('SELECT page_path FROM User_Pages WHERE user_id = ? ORDER BY page_path')
      .all(user.id)
      .map(row => row.page_path)
    base.allowedPages = pages
  }
  return base
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

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    const user = dbRW
      .prepare('SELECT * FROM Users WHERE username = ? LIMIT 1')
      .get(String(username).trim())
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (!user.active) {
      return res.status(403).json({ error: 'User is deactivated' })
    }
    const passwordHash = hashPassword(password)
    if (passwordHash !== user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = signAuthToken(user)
    setAuthCookie(res, token)
    res.json({ user: mapUserRow(user) })
  } catch (e) {
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

app.get('/api/users', (req, res) => {
  try {
    const rows = dbRW
      .prepare('SELECT id, username, full_name, email, role, active, created_at, updated_at FROM Users ORDER BY username COLLATE NOCASE')
      .all()
      .map(mapUserRow)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/users', (req, res) => {
  try {
    const { username, fullName, email, role = 'user', password, active = 1, allowedPages = [] } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    const roleStr = String(role || 'user').trim().toLowerCase()
    
    // Insert user
    const result = dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, role, active, password_hash)
         VALUES (@username, @full_name, @email, @role, @active, @password_hash)`
      )
      .run({
        username: String(username).trim(),
        full_name: fullName ? String(fullName).trim() : '',
        email: email ? String(email).trim() : '',
        role: roleStr,
        active: active ? 1 : 0,
        password_hash: hashPassword(password)
      })
    
    const userId = result.lastInsertRowid
    
    // If custom role, save page permissions
    if (roleStr === 'custom' && Array.isArray(allowedPages)) {
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
    
    res.json({ ok: true })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' })
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

    const { fullName, email, role, active, password, allowedPages } = req.body || {}
    const fields = []
    const params = { id }

    if (typeof fullName !== 'undefined') {
      fields.push('full_name = @full_name')
      params.full_name = String(fullName ?? '').trim()
    }
    if (typeof email !== 'undefined') {
      fields.push('email = @email')
      params.email = String(email ?? '').trim()
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
      params.password_hash = hashPassword(password)
    }

    if (!fields.length && typeof allowedPages === 'undefined') {
      return res.status(400).json({ error: 'No updates provided' })
    }

    if (fields.length > 0) {
    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE Users SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
    }
    
    // Handle page permissions for custom role
    const roleStr = String(role !== undefined ? role : existing.role || 'user').trim().toLowerCase()
    if (roleStr === 'custom' && typeof allowedPages !== 'undefined') {
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
    } else if (roleStr !== 'custom') {
      // If role changed from custom to something else, remove page permissions
      dbRW.prepare('DELETE FROM User_Pages WHERE user_id = ?').run(id)
    }
    
    res.json({ ok: true })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' })
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
      { path: '/zidisha/par', label: 'Zidisha - PAR', category: 'Zidisha' },
      { path: '/zidisha/productivity', label: 'Zidisha - Productivity', category: 'Zidisha' },
      { path: '/zidisha/demographics', label: 'Zidisha - Demographics', category: 'Zidisha' },
      // Advans pages
      { path: '/advans/dashboard', label: 'Advans - Dashboard', category: 'Advans' },
      { path: '/advans/disbursement', label: 'Advans - Disbursement', category: 'Advans' },
      { path: '/advans/collection', label: 'Advans - Collection', category: 'Advans' },
      { path: '/advans/par', label: 'Advans - PAR', category: 'Advans' },
      { path: '/advans/productivity', label: 'Advans - Productivity', category: 'Advans' },
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
    const rows = dbRW
      .prepare('SELECT * FROM Logbook_Targets ORDER BY year DESC, month DESC, branch COLLATE NOCASE')
      .all()
      .map(mapTargetRow)
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

app.post('/api/logbook/branches', (req, res) => {
  try {
    const { code, name, active = 1 } = req.body || {}
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' })
    dbRW.prepare(`
      INSERT INTO Logbook_Branches (code, name, active)
      VALUES (@code, @name, @active)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, active=excluded.active
    `).run({ code: String(code).trim(), name: String(name).trim(), active: active ? 1 : 0 })
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
    const rows = dbRW.prepare('SELECT time, Past_Arrears_missed, Open_loans FROM PAR ORDER BY time DESC').all()
    res.json(rows)
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

app.get('/api/par/branches', async (req, res) => {
  try {
    // Get all active branches with names
    const activeBranches = dbRW.prepare('SELECT code, name FROM Logbook_Branches WHERE active = 1').all()
    
    if (activeBranches.length === 0) {
      return res.status(400).json({ error: 'No active branches found' })
    }

    // Get the latest timestamp from PAR table
    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    
    if (!latestPar || !latestPar.time) {
      return res.json([]) // No data available yet
    }

    const latestTime = latestPar.time

    // Return cached if same snapshot time
    if (parBranchesCache.time === latestPar.time && parBranchesCache.data) {
      return res.json(parBranchesCache.data)
    }

    // Read all loan records from saved tables
    const openLoansRows = db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
    const pastMissedRows = db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ?').all(latestTime)

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
    
    parBranchesCache = { time: latestPar.time, data: branchData }
    res.json(branchData)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/par/borrower-access', async (req, res) => {
  try {
    // Get the latest snapshot time
    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    if (!latestPar || !latestPar.time) {
      return res.json([])
    }
    const latestTime = latestPar.time

    // Return cached if same snapshot time
    if (parBorrowerAccessCache.time === latestPar.time && parBorrowerAccessCache.data) {
      return res.json(parBorrowerAccessCache.data)
    }

    // Load saved loan records for the snapshot
    const openLoansRows = db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
    const pastMissedRows = db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ?').all(latestTime)

    const officerMap = new Map()

    const accumulateLoan = (rows, key) => {
      for (const row of rows) {
        try {
          const loan = JSON.parse(row.loan_data)
          const borrowerAccessIds = Array.isArray(loan.borrower_access_ids) ? loan.borrower_access_ids : []
          if (!borrowerAccessIds.length) continue

          const rawPrincipal =
            loan.principal_balance_amount ??
            loan.PrincipalBalanceAmount ??
            loan['principal_balance_amount'] ??
            loan['Principal Balance Amount'] ??
            loan['Principal Balance'] ??
            0
          const principal = Number(String(rawPrincipal).replace(/[^\d.-]/g, '')) || 0

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
          console.error('Error parsing loan record for borrower access aggregation:', e.message)
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
        branches: Array.from(entry.branches)
      }
    })

    officerData.sort((a, b) => b.parRate - a.parRate)

    parBorrowerAccessCache = { time: latestPar.time, data: officerData }
    res.json(officerData)
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`)
  if (isProduction) {
    console.log(`Production mode: Serving app at http://localhost:${PORT}`)
  } else {
    console.log(`Development mode: API at http://localhost:${PORT}`)
    console.log(`Frontend dev server should run separately on port 5173`)
  }
})
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

    // Build WHERE clause
    const whereConditions = []
    const params = []

    // Enforce Zidisha branch restrictions if configured (similar to Logbook)
    const authRole = String(req.authUser?.role || '').toLowerCase()
    const allowedZidisha = getAllowedZidishaBranches(req)
    if (authRole === 'custom' && allowedZidisha.length === 0) {
      // Custom users with Zidisha pages must have explicit branches configured (validated on user save)
      return res.status(403).json({ error: 'No Zidisha branch access configured for this user' })
    }

    if (allowedZidisha.length > 0) {
      const allowedNorm = new Set(
        allowedZidisha.map((b) => String(b || '').trim()).filter(Boolean)
      )
      if (branch) {
        const bNorm = String(branch || '').trim()
        if (!allowedNorm.has(bNorm)) {
          return res.status(403).json({ error: 'Branch not allowed for this user' })
        }
      } else {
        // Use COLLATE NOCASE for case-insensitive matching (can use index)
        const placeholders = allowedZidisha.map(() => '?').join(', ')
        whereConditions.push(`"Branch Name" COLLATE NOCASE IN (${placeholders})`)
        params.push(...allowedZidisha.map((b) => String(b || '').trim()))
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

    // Filter by month/year if provided (for Expected Matured On Date)
    if (month && year && month >= 1 && month <= 12) {
      // Parse dates in format YYYY-MM-DD or DD/MM/YYYY
      // We'll match dates that start with YYYY-MM or contain the month/year
      const monthStr = String(month).padStart(2, '0')
      const yearStr = String(year)
      
      // Match ISO format (YYYY-MM-DD) or DD/MM/YYYY format
      // For ISO: year-month pattern
      // For DD/MM/YYYY: /month/year pattern (with leading zero)
      whereConditions.push(`(
        ("Expected Matured On Date" LIKE ?) OR 
        ("Expected Matured On Date" LIKE ?) OR
        (substr("Expected Matured On Date", 7, 4) = ? AND substr("Expected Matured On Date", 4, 2) = ?)
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

    res.json(normalized)
  } catch (e) {
    console.error('[Boda Daily Loans API] Error:', e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/logbook/disbursements', (req, res) => {
  const allowed = getAllowedLogbookBranches(req)
  let rows
  if (allowed.length > 0) {
    const placeholders = allowed.map(() => '?').join(', ')
    rows = db.prepare(`SELECT * FROM Logbook_Disbursement WHERE branch IN (${placeholders})`).all(...allowed)
  } else {
    rows = db.prepare('SELECT * FROM Logbook_Disbursement').all()
  }
  res.json(rows)
});

app.get('/api/logbook/collections', (req, res) => {
  const allowed = getAllowedLogbookBranches(req)
  let rows
  if (allowed.length > 0) {
    const placeholders = allowed.map(() => '?').join(', ')
    rows = db.prepare(`SELECT * FROM Logbook_collection WHERE branch IN (${placeholders})`).all(...allowed)
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

    const allowedBranches = getAllowedLogbookBranches(req)
    const hasBranchRestrictions = allowedBranches.length > 0
    const allowedSet = hasBranchRestrictions ? new Set(allowedBranches) : null

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
        const openLoansRows = db.prepare('SELECT loan_data FROM Open_loans WHERE time = ?').all(latestTime)
        const portfolioMap = new Map()

        for (const row of openLoansRows) {
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

          if (principal === 0) continue

          for (const officerId of borrowerAccessIds) {
            const key = String(officerId || '').trim()
            if (!key) continue
            portfolioMap.set(key, (Number(portfolioMap.get(key)) || 0) + principal)
          }
        }

        rows = rows.map((r) => ({
          ...r,
          portfolio: portfolioMap.get(String(r.borrower_access_id || '').trim()) ?? 0,
        }))
      } else {
        rows = rows.map((r) => ({ ...r, portfolio: 0 }))
      }
    } catch (e) {
      console.error('Error attaching portfolio from Open_loans:', e.message)
      rows = rows.map((r) => ({ ...r, portfolio: 0 }))
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

    const allowedBranches = getAllowedLogbookBranches(req)
    const hasBranchRestrictions = allowedBranches.length > 0
    const allowedSet = hasBranchRestrictions ? new Set(allowedBranches) : null

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
      SELECT loan_id, disbursed_date, branch, disbursed, borrower_no, loan_officer
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

    // Map loan_officer name (normalized) -> borrower_access_id
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

      const officerName = String(r.loan_officer || '').trim()
      const accessId = officerName ? nameToAccessId.get(normalizeName(officerName)) : null
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
    const allowed = getAllowedLogbookBranches(req)
    let rows = db.prepare('SELECT * FROM Logbook_borrowers').all()

    if (allowed.length > 0) {
      const allowedSet = new Set(allowed)
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
    const allowed = getAllowedLogbookBranches(req)
    let rows = dbRW.prepare('SELECT code, name, active FROM Logbook_Branches ORDER BY name COLLATE NOCASE').all()

    if (allowed.length > 0) {
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
    role: user.role,
    active: !!user.active,
    emailVerified: !!user.email_verified,
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

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password, superuserOnly } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' })
    }
    const loginId = String(username).trim()
    const loginIdLower = loginId.toLowerCase()
    const user = dbRW
      .prepare('SELECT * FROM Users WHERE username = ? OR lower(email) = ? LIMIT 1')
      .get(loginId, loginIdLower)
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Account not confirmed. Please check your email to confirm your account.' })
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
    res.json({ user: mapUserRow(user) })
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

    // Confirm account and activate it
    dbRW.prepare(`UPDATE Users SET email_verified = 1, active = 1, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      hashPassword(password),
      row.user_id
    )
    dbRW.prepare(`UPDATE Email_Verifications SET used_at = ? WHERE id = ?`).run(nowIso(), row.id)

    res.json({ ok: true })
  } catch (e) {
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: e.message })
    }
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {}
    const emailNorm = normalizeEmail(email)
    if (!emailNorm) return res.status(400).json({ error: 'Email is required' })

    const user = dbRW.prepare('SELECT * FROM Users WHERE lower(email) = ? LIMIT 1').get(emailNorm)
    if (!user) return res.status(404).json({ error: 'Email not found' })
    if (!user.active) return res.status(403).json({ error: 'User is deactivated' })
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Account not confirmed. Please confirm your account first.' })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = hashToken(code)
    const expiresAt = addMinutesIso(15)
    dbRW.prepare(`INSERT INTO Password_Reset_Codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)`).run(
      user.id,
      codeHash,
      expiresAt
    )

    const subject = 'Password reset code'
    const text = `Your Phoenix Capital Dashboard password reset code is: ${code}\n\nThis code expires in 15 minutes.`
    const html = `<p>Your Phoenix Capital Dashboard password reset code is:</p><p style="font-size:20px;font-weight:bold;letter-spacing:2px">${code}</p><p>This code expires in 15 minutes.</p>`
    const sendResult = await sendEmail({ to: user.email, subject, text, html })

    res.json({ ok: true, emailSent: !!sendResult.ok })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {}
    const emailNorm = normalizeEmail(email)
    if (!emailNorm || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and newPassword are required' })
    }
    const user = dbRW.prepare('SELECT * FROM Users WHERE lower(email) = ? LIMIT 1').get(emailNorm)
    if (!user) return res.status(404).json({ error: 'Email not found' })
    if (!user.active) return res.status(403).json({ error: 'User is deactivated' })
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Account not confirmed. Please confirm your account first.' })
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

    dbRW.prepare(`UPDATE Users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      hashPassword(newPassword),
      user.id
    )
    dbRW.prepare(`UPDATE Password_Reset_Codes SET used_at = ? WHERE id = ?`).run(nowIso(), latest.id)
    res.json({ ok: true })
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
      .prepare('SELECT id, username, full_name, email, role, active, email_verified, created_at, updated_at FROM Users ORDER BY username COLLATE NOCASE')
      .all()
      .map(mapUserRow)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/users', (req, res) => {
  try {
    const {
      username,
      fullName,
      email,
      role = 'logbook',
      password,
      active = 1,
      allowedPages = [],
      allowedZidishaBranches = [],
      allowedLogbookBranches = []
    } = req.body || {}
    if (!username) return res.status(400).json({ error: 'Username is required' })
    const emailNorm = normalizeEmail(email)
    if (!emailNorm) return res.status(400).json({ error: 'Email is required' })
    const roleStr = String(role || 'user').trim().toLowerCase()
    const tempPassword = password ? String(password) : crypto.randomBytes(24).toString('hex')
    
    // Insert user
    const result = dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, role, active, password_hash)
         VALUES (@username, @full_name, @email, @role, @active, @password_hash)`
      )
      .run({
        username: String(username).trim(),
        full_name: fullName ? String(fullName).trim() : '',
        email: emailNorm,
        role: roleStr,
        // New users are inactive until they confirm their email + set password
        active: 0,
        password_hash: hashPassword(tempPassword)
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
    
    // Create confirmation token and send email
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = addMinutesIso(60 * 24) // 24 hours
    dbRW
      .prepare(`INSERT INTO Email_Verifications (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
      .run(userId, tokenHash, expiresAt)

    const confirmUrl = `${getAppBaseUrl()}/auth/confirm?token=${encodeURIComponent(token)}`
    const subject = 'Confirm your account'
    const text =
      `Your Phoenix Capital Dashboard account was created.\n\n` +
      `Please confirm your account and set your password using this link:\n${confirmUrl}\n\n` +
      `This link expires in 24 hours.`
    const html =
      `<p>Your Phoenix Capital Dashboard account was created.</p>` +
      `<p>Please confirm your account and set your password:</p>` +
      `<p><a href="${confirmUrl}">Confirm account</a></p>` +
      `<p>This link expires in 24 hours.</p>`

    sendEmail({ to: emailNorm, subject, text, html })
      .then((r) => res.json({ ok: true, emailSent: !!r.ok }))
      .catch((err) => {
        console.error('Failed to send confirmation email:', err)
        // User is created; surface email failure to admin
        res.json({ ok: true, emailSent: false })
      })
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const msg = String(e.message || '')
      if (msg.includes('Users.username')) {
        return res.status(409).json({ error: 'Username already exists' })
      }
      if (msg.includes('idx_users_email_unique') || msg.includes('Users.email')) {
        return res.status(409).json({ error: 'Email already exists' })
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

    const { fullName, email, role, active, password, allowedPages, allowedZidishaBranches, allowedLogbookBranches } = req.body || {}
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

    if (
      !fields.length &&
      typeof allowedPages === 'undefined' &&
      typeof allowedZidishaBranches === 'undefined' &&
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
    const allowedBranches = getAllowedLogbookBranches(req)

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

    // Return cached if same snapshot time (filtered per user)
    if (parBranchesCache.time === latestPar.time && parBranchesCache.data) {
      const allowedSet = allowedBranches.length > 0 ? new Set(allowedBranches) : null
      const data = !allowedSet
        ? parBranchesCache.data
        : parBranchesCache.data.filter((b) => {
            const code = String(b.code ?? '').trim()
            return code && allowedSet.has(code)
          })
      return res.json(data)
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

    const allowedSet = allowedBranches.length > 0 ? new Set(allowedBranches) : null
    const data = !allowedSet
      ? branchData
      : branchData.filter((b) => {
          const code = String(b.code ?? '').trim()
          return code && allowedSet.has(code)
        })

    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/par/borrower-access', async (req, res) => {
  try {
    const allowedBranches = getAllowedLogbookBranches(req)
    const { branch } = req.query // Optional branch filter

    // Get the latest snapshot time
    const latestPar = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()
    if (!latestPar || !latestPar.time) {
      return res.json([])
    }
    const latestTime = latestPar.time

    // Load saved loan records for the snapshot
    const openLoansRows = branch 
      ? db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ? AND branch_code = ?').all(latestTime, branch)
      : db.prepare('SELECT branch_code, loan_data FROM Open_loans WHERE time = ?').all(latestTime)
    const pastMissedRows = branch
      ? db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ? AND branch_code = ?').all(latestTime, branch)
      : db.prepare('SELECT branch_code, loan_data FROM Past_Missed_repayment WHERE time = ?').all(latestTime)

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

    // Only cache if no branch filter (to avoid cache complexity)
    if (!branch && parBorrowerAccessCache.time !== latestPar.time) {
      parBorrowerAccessCache = { time: latestPar.time, data: officerData }
    }

    const allowedSet = allowedBranches.length > 0 ? new Set(allowedBranches) : null
    const data = !allowedSet
      ? officerData
      : officerData.filter((entry) => {
          if (!Array.isArray(entry.branches) || entry.branches.length === 0) return false
          return entry.branches.some((code) => {
            const c = String(code ?? '').trim()
            return c && allowedSet.has(c)
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
    
    // Count unique owner_name from oversea_devices table (if exists)
    try {
      const result = db.prepare("SELECT COUNT(DISTINCT owner_name) as count FROM oversea_devices WHERE owner_name IS NOT NULL AND owner_name != ''").get()
      uniqueOwners = Number(result?.count || 0)
    } catch (e) {
      console.warn('[Kajea Stats] oversea_devices table not found or error:', e.message)
    }
    
    // Sum both to get total clients
    const clientCount = whiteLabelClientCount + uniqueOwners
    
    // Count devices from both oversea_devices and Whitelabel_devices (if exist)
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM oversea_devices').get()
      overseaDeviceCount = Number(result?.count || 0)
    } catch (e) {
      console.warn('[Kajea Stats] oversea_devices table not found for device count:', e.message)
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
      const overseaTypes = db.prepare("SELECT DISTINCT type FROM oversea_devices WHERE type IS NOT NULL AND type != ''").all()
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
    
    // Build client growth series based on activate_time from oversea_devices
    try {
      const rows = db.prepare("SELECT activate_time FROM oversea_devices WHERE activate_time IS NOT NULL AND activate_time != ''").all()
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
        FROM oversea_devices
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
      console.warn('[Kajea Clients] Error aggregating oversea_devices:', e.message)
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
    
    // Get unique owners from oversea_devices table
    try {
      const overseaOwners = db.prepare("SELECT DISTINCT owner_name FROM oversea_devices WHERE owner_name IS NOT NULL AND owner_name != '' ORDER BY owner_name").all()
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
      console.warn('[Kajea Clients] oversea_devices table not found or error:', e.message)
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

// Every 30 minutes: fetch Oversea devices
cron.schedule('*/30 * * * *', () => {
  console.log(`[CRON] Running scheduled Oversea devices fetch at ${new Date().toISOString()}`)
  const proc = spawn('node', ['scripts/fetch_oversea_devices.mjs'], { cwd: process.cwd(), shell: true })
  proc.stdout.on('data', (chunk) => {
    console.log(`[OVERSEA-CRON-OUT] ${chunk.toString().trimEnd()}`)
  })
  proc.stderr.on('data', (chunk) => {
    console.error(`[OVERSEA-CRON-ERR] ${chunk.toString().trimEnd()}`)
  })
  proc.on('close', (code) => {
    console.log(`[CRON] Oversea devices fetch completed with code ${code}`)
    events.emit('kajea_data_updated')
  })
  proc.on('error', (err) => {
    console.error('[CRON] Oversea devices fetch failed to start:', err.message)
  })
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`)
  if (isProduction) {
    console.log(`Production mode: Serving app at http://localhost:${PORT}`)
  } else {
    console.log(`Development mode: API at http://localhost:${PORT}`)
    console.log(`Frontend dev server should run separately on port 5173`)
  }
})
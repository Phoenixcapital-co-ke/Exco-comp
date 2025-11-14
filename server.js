import express from 'express'
import cors from 'cors'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import Database from 'better-sqlite3'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const app = express()
const PORT = process.env.PORT || 3001
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isProduction = process.env.NODE_ENV === 'production'

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

const LOANDISK_BASE_URL = 'https://api-main.loandisk.com/7125'
const LOANDISK_AUTH = 'Basic DgPRFGb7VPYrnz7K68b4KqHNkYZkvswVqFGaU7xD'
const LOANDISK_PAGE_SIZE = 20

// Get current time in Nairobi timezone (EAT, UTC+3)
function getNairobiTime() {
  const now = new Date()
  // Convert to Nairobi time (UTC+3)
  const nairobiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000))
  return nairobiTime.toISOString()
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

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': LOANDISK_AUTH,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      throw new Error(`Upstream error ${resp.status}`)
    }

    const json = await resp.json()
    if (json && json.error) {
      const err = typeof json.error === 'string' ? json.error : JSON.stringify(json.error)
      throw new Error(err)
    }

    const response = json?.response || {}
    const rawResults = Array.isArray(response.Results) ? response.Results : []
    const results = Array.isArray(rawResults[0]) ? rawResults.flat() : rawResults
    if (typeof response.TotalResults === 'number') totalResults = response.TotalResults

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

// SSE endpoint for dashboard clients to receive live update notifications
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const onDataUpdated = () => res.write('data: data_updated\n\n')
  events.on('data_updated', onDataUpdated)
  req.on('close', () => {
    events.off('data_updated', onDataUpdated)
  })
})

// Zidisha data endpoint
app.get('/api/zidisha/data', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM zidisha_data').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

app.get('/api/ingest', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.flushHeaders && res.flushHeaders()

  const proc = spawn('npm run ingest:disbursements', [], { cwd: process.cwd(), shell: true })
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

// Body parser for JSON after SSE route
app.use(express.json())

// Branches CRUD (Logbook only)
app.get('/api/logbook/branches', (req, res) => {
  try {
    const rows = dbRW.prepare('SELECT code, name, active FROM Logbook_Branches ORDER BY name COLLATE NOCASE').all()
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const mapUserRow = (user) => ({
  id: user.id,
  username: user.username,
  fullName: user.full_name,
  email: user.email,
  role: user.role,
  active: !!user.active,
  createdAt: user.created_at,
  updatedAt: user.updated_at
})

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
    res.json({ user: mapUserRow(user) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
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
    const { username, fullName, email, role = 'user', password, active = 1 } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    dbRW
      .prepare(
        `INSERT INTO Users (username, full_name, email, role, active, password_hash)
         VALUES (@username, @full_name, @email, @role, @active, @password_hash)`
      )
      .run({
        username: String(username).trim(),
        full_name: fullName ? String(fullName).trim() : '',
        email: email ? String(email).trim() : '',
        role: role ? String(role).trim() : 'user',
        active: active ? 1 : 0,
        password_hash: hashPassword(password)
      })
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

    const { fullName, email, role, active, password } = req.body || {}
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

    if (!fields.length) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    const sql = `UPDATE Users SET ${fields.join(', ')} WHERE id = @id`
    dbRW.prepare(sql).run(params)
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
    const result = dbRW.prepare('DELETE FROM Users WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
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

    res.json(officerData)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// SSE endpoint for PAR snapshot progress
app.get('/api/par/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const onProgress = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  events.on('par_snapshot_progress', onProgress)
  req.on('close', () => {
    events.off('par_snapshot_progress', onProgress)
  })
})

app.post('/api/par/snapshot', async (req, res) => {
  try {
    // Get all active branches
    const activeBranches = dbRW.prepare('SELECT code FROM Logbook_Branches WHERE active = 1').all()
    
    if (activeBranches.length === 0) {
      return res.status(400).json({ error: 'No active branches found' })
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
        console.error(`Error fetching data for branch ${branchCode}:`, e.message)
        // Emit progress: branch failed
        events.emit('par_snapshot_progress', {
          current: i + 1,
          total: totalBranches,
          branch: branchCode,
          status: 'failed',
          error: e.message
        })
        // Continue with other branches even if one fails
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
    
    // Emit progress: completed
    events.emit('par_snapshot_progress', {
      current: totalBranches,
      total: totalBranches,
      branch: null,
      status: 'completed'
    })
    
    res.json({
      time: ts,
      past_arrears_missed: totalPastMissed,
      open_loans: totalOpenLoans,
      branchesProcessed: totalBranches,
      stats: {
        pastMissed: { sum: totalPastMissed, fetched: totalFetchedPastMissed },
        openLoans: { sum: totalOpenLoans, fetched: totalFetchedOpenLoans },
        branchStats
      }
    })
  } catch (e) {
    events.emit('par_snapshot_progress', {
      status: 'error',
      error: e.message
    })
    res.status(500).json({ error: e.message })
  }
})

// Serve static files in production (React build) - MUST be after all API routes
if (isProduction) {
  const distPath = join(__dirname, 'dist')
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    console.log('Serving static files from:', distPath)
    
    // Serve index.html for all non-API routes (SPA routing)
    app.get('*', (req, res) => {
      // Skip API routes (shouldn't reach here for /api/* but just in case)
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' })
      }
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
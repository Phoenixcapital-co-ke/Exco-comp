// Fetch disbursement_report from Loandisk and persist into SQLite (table: disbursments)
// Usage: node scripts/fetch_disbursments.mjs
// Behaviour can be controlled with environment flags:
//   SKIP_DISBURSEMENTS=1     -> skip disbursement ingestion
//   SKIP_COLLECTIONS=1       -> skip collections ingestion
//   SKIP_BORROWERS=1         -> skip borrowers ingestion
//   SKIP_ZIDISHA=1           -> skip Zidisha ingestion
//   SKIP_ZIDISHA_DAILY=1     -> skip Zidisha Daily Expected vs Repayed ingestion
//   SKIP_BODA_REPAYMENTS=1   -> skip boda_repayments ingestion

import Database from 'better-sqlite3'
import fetch from 'node-fetch'
import * as fs from 'fs'
const PAPAPARSE = (() => { try { return require('papaparse') } catch { return null } })()

const LOANDISK_URL = 'https://api-main.loandisk.com/7125/55886/disbursement_report'
const AUTH = 'Basic hM2PPcacbMJPKsE4mAM3hbYNqbY5vSJtjrKYHRad'
const TABLE = 'Logbook_Disbursement'
const COLLECTIONS_BASE = 'https://api-main.loandisk.com/7125'
const COLLECTIONS_TABLE = 'Logbook_collection'
const DEFAULT_COLLECTION_START_DATE = '01/01/2024'
function buildCollectionsUrl(branchCode){
  return `${COLLECTIONS_BASE}/${branchCode}/advanced_search_repayments`
}
const BORROWERS_TABLE = 'Logbook_borrowers'
function buildBorrowersUrl(branchCode){
  return `${COLLECTIONS_BASE}/${branchCode}/advanced_search_borrowers`
}

// Control flags from environment
const SKIP_DISBURSEMENTS = process.env.SKIP_DISBURSEMENTS === '1'
const SKIP_COLLECTIONS = process.env.SKIP_COLLECTIONS === '1'
const SKIP_BORROWERS = process.env.SKIP_BORROWERS === '1'
const SKIP_ZIDISHA = process.env.SKIP_ZIDISHA === '1'
const SKIP_ZIDISHA_DAILY = process.env.SKIP_ZIDISHA_DAILY === '1'
const SKIP_BODA_REPAYMENTS = process.env.SKIP_BODA_REPAYMENTS === '1'

// Base payload (pagination handled by from/count) - branches_select will be set after loading branches from DB
const basePayload = {
  from: 1,
  count: 1000,
  start_date: '01/01/2024',
  end_date: getTodayDMY(),
  do_not_include_restructured_loans: 1,
  do_not_include_not_released_loans: 1,
  branches_select: '',
}

async function fetchDisbursments(payload) {
  const res = await fetch(LOANDISK_URL, {
    method: 'POST',
    headers: {
      'Authorization': AUTH,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`Failed to parse JSON. HTTP ${res.status}. Body: ${text}`)
  }

  // Expected Postman-like shape: { response: { Results: [ ... ] } }
  const results = json?.response?.Results || []
  if (!Array.isArray(results)) {
    throw new Error(`Unexpected response shape: ${text}`)
  }
  return { meta: json?.response, results }
}

async function fetchAll() {
  let page = basePayload.from // Loandisk 'from' behaves like page index (1-based)
  const all = []
  let total = null
  while (true) {
    const payload = { ...basePayload, from: page, end_date: getTodayDMY() }
    const { meta, results } = await fetchDisbursments(payload)
    if (total == null && meta?.TotalResults != null) total = Number(meta.TotalResults)
    if (!results.length) break
    all.push(...results)
    page += 1
    if (total != null && all.length >= total) break
  }
  return { total, results: all }
}

function toNumber(numLike) {
  if (numLike == null || numLike === '') return 0
  if (typeof numLike === 'number') return numLike
  // strip commas and spaces, then parse
  const cleaned = String(numLike).replace(/[,\s]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

const COLUMN_MAP = [
  // column, sourceKey, type ('TEXT'|'REAL')
  ['loan_id', 'Loan Id', 'TEXT'],
  ['loan_number', 'Loan#', 'TEXT'],
  ['name', 'Name', 'TEXT'],
  ['first_name', 'First Name', 'TEXT'],
  ['last_name', 'Last Name', 'TEXT'],
  ['branch', 'Branch', 'TEXT'],
  ['product', 'Product', 'TEXT'],
  ['loan_officer', 'LoanOfficer', 'TEXT'],
  ['status', 'Status', 'TEXT'],
  ['disbursed_date', 'Disbursed Date', 'TEXT'],
  ['released', 'Released', 'TEXT'],
  ['maturity', 'Maturity', 'TEXT'],
  ['next_due', 'NextDue', 'TEXT'],
  ['next_installment_amount', 'Next Installment Amount', 'REAL'],
  ['next_installment_date', 'Next Installment Date', 'TEXT'],
  ['duration', 'Duration', 'TEXT'],
  ['bank_account_released', 'Bank Account (Released)', 'TEXT'],
  ['borrower_no', 'Borrower#', 'TEXT'],
  ['national_id', 'National ID', 'TEXT'],
  ['sales_agent', 'Sales Agent', 'TEXT'],
  ['team_leader', 'Team Leader/ RO', 'TEXT'],
  ['sales_person', 'Sales Person', 'TEXT'],
  ['principal', 'Principal', 'REAL'],
  ['principal_after_deduct', 'Principal After Deduct', 'REAL'],
  ['interest', 'Interest', 'REAL'],
  ['interest_rate', 'Interest Rate', 'TEXT'],
  ['outstanding', 'Outstanding', 'REAL'],
  ['balance', 'Balance', 'REAL'],
  ['total_due', 'Total Due', 'REAL'],
  ['paid', 'Paid', 'REAL'],
  ['past_due', 'PastDue', 'REAL'],
  ['due_fees', 'DueFees', 'REAL'],
  ['fees_balance', 'Fees Balance', 'REAL'],
  ['fees_paid', 'Fees Paid', 'REAL'],
  ['interest_balance', 'Interest Balance', 'REAL'],
  ['interest_paid', 'Interest Paid', 'REAL'],
  ['penalty', 'Penalty', 'REAL'],
  ['penalty_balance', 'Penalty Balance', 'REAL'],
  ['penalty_paid', 'Penalty Paid', 'REAL'],
  ['principal_balance', 'Principal Balance', 'REAL'],
  ['principal_paid', 'Principal Paid', 'REAL'],
  ['days_past', 'DaysPast', 'TEXT'],
  ['days_past_maturity', 'Days Past Maturity', 'TEXT'],
  ['days_to_maturity', 'Days To Maturity', 'TEXT'],
  // newly requested demographic fields
  ['business', 'Business', 'TEXT'],
  ['age', 'Age', 'TEXT'],
  ['gender', 'Gender', 'TEXT'],
  ['city', 'City', 'TEXT'],
  ['country', 'Country', 'TEXT'],
  ['address', 'Address', 'TEXT'],
  ['mobile', 'Mobile', 'TEXT'],
  ['email', 'Email', 'TEXT'],
]

function initDb() {
  const db = new Database('data/app.db')
  db.pragma('journal_mode = WAL')
  // Base table (will be extended with columns as needed)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id TEXT,
      disbursed_date TEXT,
      branch TEXT,
      disbursed REAL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(loan_id, disbursed_date)
    );
  `)
  // Ensure all required columns exist
  const existing = db.prepare(`PRAGMA table_info(${TABLE});`).all().map(c => c.name)
  for (const [col, , type] of COLUMN_MAP) {
    if (!existing.includes(col)) {
      db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} ${type};`)
    }
  }
  return db
}

function getActiveBranches(db) {
  const branchRows = db.prepare(`SELECT code, name FROM Logbook_Branches WHERE active = 1`).all()
  const list = branchRows.map((r) => ({
    code: String(r.code).trim(),
    name: (r.name || String(r.code)).trim(),
  })).filter(b => b.code)
  if (!list.length) {
    throw new Error('No active branches found in Logbook_Branches (active=1). Please populate/activate branches.')
  }
  return list
}

function migrateDropRawIfPresent(db) {
  const cols = db.prepare(`PRAGMA table_info(${TABLE});`).all()
  const hasRaw = cols.some(c => c.name === 'raw')
  if (!hasRaw) return
  const existingCols = cols.map(c => c.name).filter(n => n !== 'raw')
  const colList = existingCols.join(',')
  const createSql = `CREATE TABLE ${TABLE}_new AS SELECT ${colList} FROM ${TABLE} WHERE 1=1`;
  // Recreate table without raw, preserving data and schema for existing columns
  db.exec('BEGIN')
  db.exec(createSql)
  db.exec(`DROP TABLE ${TABLE}`)
  // Recreate with desired schema (without raw)
  db.exec(`
    CREATE TABLE ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id TEXT,
      disbursed_date TEXT,
      branch TEXT,
      disbursed REAL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(loan_id, disbursed_date)
    );
  `)
  // Ensure all mapped columns exist
  const existing = db.prepare(`PRAGMA table_info(${TABLE});`).all().map(c => c.name)
  for (const [col, , type] of COLUMN_MAP) {
    if (!existing.includes(col)) db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${col} ${type};`)
  }
  // Copy back data into new table
  const destCols = db.prepare(`PRAGMA table_info(${TABLE});`).all().map(c => c.name)
  const copyCols = existingCols.filter(c => destCols.includes(c)).join(',')
  db.exec(`INSERT INTO ${TABLE} (${copyCols}) SELECT ${copyCols} FROM ${TABLE}_new`)
  db.exec(`DROP TABLE ${TABLE}_new`)
  db.exec('COMMIT')
}

function parseDMY(str) {
  if (!str) return null
  const m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3])
  return new Date(yyyy, mm - 1, dd)
}

function getLatestDisbursedDate(db) {
  const rows = db.prepare(`SELECT DISTINCT disbursed_date FROM ${TABLE} WHERE disbursed_date IS NOT NULL AND disbursed_date<>''`).all()
  if (!rows.length) return null
  let latest = null
  for (const r of rows) {
    const d = parseDMY(r.disbursed_date)
    if (!d) continue
    if (!latest || d > latest) latest = d
  }
  if (!latest) return null
  const dd = String(latest.getDate()).padStart(2,'0')
  const mm = String(latest.getMonth()+1).padStart(2,'0')
  const yyyy = latest.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function getTodayDMY() {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2,'0')
  const mm = String(now.getMonth()+1).padStart(2,'0')
  const yyyy = now.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function getLatestCollectionDate(db) {
  const row = db.prepare(`
    SELECT repayment_collected_date as date
    FROM ${COLLECTIONS_TABLE}
    WHERE repayment_collected_date IS NOT NULL
      AND TRIM(repayment_collected_date) <> ''
    ORDER BY substr(repayment_collected_date,7,4) || substr(repayment_collected_date,4,2) || substr(repayment_collected_date,1,2) DESC
    LIMIT 1
  `).get()
  return row?.date ? String(row.date) : null
}

// === Collections helpers ===
function initCollectionsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${COLLECTIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repayment_id INTEGER UNIQUE,
      branch TEXT,
      loan_id INTEGER,
      repayment_amount REAL,
      loan_repayment_method_id INTEGER,
      repayment_collected_date TEXT,
      collector_id INTEGER,
      repayment_backdate INTEGER,
      repayment_backdated_date TEXT,
      repayment_adjust_remaining_schedule INTEGER,
      repayment_adjust_remaining_schedule_pro_rata INTEGER,
      repayment_manual_composition INTEGER,
      principal_repayment_amount REAL,
      interest_repayment_amount REAL,
      fees_repayment_amount REAL,
      penalty_repayment_amount REAL,
      loandisk_system_date TEXT,
      borrower_access_ids TEXT,
      repayment_description TEXT,
      dea_cash_bank_account INTEGER,
      custom_field_23214 TEXT,
      custom_fields TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  // Ensure all columns exist on legacy tables (migration)
  const cols = db.prepare(`PRAGMA table_info(${COLLECTIONS_TABLE});`).all().map(c => c.name)
  const requiredCols = [
    'branch', 'repayment_backdate', 'repayment_backdated_date',
    'repayment_adjust_remaining_schedule', 'repayment_adjust_remaining_schedule_pro_rata',
    'repayment_manual_composition', 'borrower_access_ids', 'custom_field_23214', 'custom_fields'
  ]
  for (const col of requiredCols) {
    if (!cols.includes(col)) {
      const colType = col === 'repayment_backdate' || col === 'repayment_adjust_remaining_schedule' || 
                      col === 'repayment_adjust_remaining_schedule_pro_rata' || col === 'repayment_manual_composition'
        ? 'INTEGER' : 'TEXT'
      db.exec(`ALTER TABLE ${COLLECTIONS_TABLE} ADD COLUMN ${col} ${colType};`)
    }
  }
  // Ensure a UNIQUE index on repayment_id for legacy schemas where it wasn't unique
  // First, drop exact duplicates keeping the lowest id per repayment_id
  db.exec(`
    DELETE FROM ${COLLECTIONS_TABLE}
    WHERE id NOT IN (
      SELECT MIN(id) FROM ${COLLECTIONS_TABLE} GROUP BY repayment_id
    );
  `)
  // Then create the unique index if it doesn't exist
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${COLLECTIONS_TABLE}_repayment_id ON ${COLLECTIONS_TABLE}(repayment_id);`)
}

// === Borrowers helpers ===
function initBorrowersTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${BORROWERS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      borrower_id INTEGER,
      branch TEXT,
      borrower_country TEXT,
      borrower_firstname TEXT,
      borrower_lastname TEXT,
      borrower_business_name TEXT,
      borrower_unique_number TEXT,
      borrower_gender TEXT,
      borrower_dob TEXT,
      borrower_address TEXT,
      borrower_city TEXT,
      borrower_province TEXT,
      borrower_zipcode TEXT,
      borrower_landline TEXT,
      borrower_mobile TEXT,
      borrower_email TEXT,
      national_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(borrower_id, branch)
    );
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${BORROWERS_TABLE}_uniq ON ${BORROWERS_TABLE}(borrower_id, branch);`)
}

async function fetchBorrowersOnce(branchCode, payload) {
  const res = await fetch(buildBorrowersUrl(branchCode), {
    method: 'POST',
    headers: {
      'Authorization': AUTH,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch(e) {
    throw new Error(`Borrowers parse error. HTTP ${res.status}. Body: ${text}`)
  }
  const raw = Array.isArray(json?.response?.Results) ? json.response.Results : []
  const results = Array.isArray(raw[0]) ? raw.flat() : raw
  return { meta: json?.response, results }
}

async function fetchAllBorrowers(db) {
  initBorrowersTable(db)
  // Clear existing borrowers table as requested
  db.exec(`DELETE FROM ${BORROWERS_TABLE}`)
  const count = 1000
  const payloadBase = {
    from: 1,
    count,
    borrower_type: 'Noloans||Notactive||8||1||18||10||5||16||6||2||3||55222||55219||55220||55224||55223||55225||55226||55221||248404||490046||9||17',
  }
  const insert = db.prepare(`
    INSERT INTO ${BORROWERS_TABLE} (
      borrower_id, branch, borrower_country, borrower_firstname, borrower_lastname,
      borrower_business_name, borrower_unique_number, borrower_gender, borrower_dob,
      borrower_address, borrower_city, borrower_province, borrower_zipcode, borrower_landline,
      borrower_mobile, borrower_email, national_id
    ) VALUES (
      @borrower_id, @branch, @borrower_country, @borrower_firstname, @borrower_lastname,
      @borrower_business_name, @borrower_unique_number, @borrower_gender, @borrower_dob,
      @borrower_address, @borrower_city, @borrower_province, @borrower_zipcode, @borrower_landline,
      @borrower_mobile, @borrower_email, @national_id
    )
    ON CONFLICT(borrower_id, branch) DO UPDATE SET
      borrower_country=excluded.borrower_country,
      borrower_firstname=excluded.borrower_firstname,
      borrower_lastname=excluded.borrower_lastname,
      borrower_business_name=excluded.borrower_business_name,
      borrower_unique_number=excluded.borrower_unique_number,
      borrower_gender=excluded.borrower_gender,
      borrower_dob=excluded.borrower_dob,
      borrower_address=excluded.borrower_address,
      borrower_city=excluded.borrower_city,
      borrower_province=excluded.borrower_province,
      borrower_zipcode=excluded.borrower_zipcode,
      borrower_landline=excluded.borrower_landline,
      borrower_mobile=excluded.borrower_mobile,
      borrower_email=excluded.borrower_email,
      national_id=excluded.national_id
  `)
  const branchList = getActiveBranches(db)

  console.info(
    `[Borrowers] Active branches to fetch: ${branchList
      .map(b => `${b.code}${b.name ? ` (${b.name})` : ''}`)
      .join(', ')}`
  )

  for (const { code: branchCode, name: branchName } of branchList) {
    console.info(`[Borrowers] Fetching borrowers for branch ${branchCode} (${branchName})`)
    let page = 1
    let total = null
    let branchInserted = 0
    while (true) {
      const payload = { ...payloadBase, from: page }
      const { meta, results } = await fetchBorrowersOnce(branchCode, payload)
      if (total == null && meta?.TotalResults != null) total = Number(meta.TotalResults)
      if (!results.length) break
      const mapped = results.map(r => ({
        borrower_id: r.borrower_id ?? null,
        branch: String(branchCode),
        borrower_country: r.borrower_country ?? null,
        borrower_firstname: r.borrower_firstname ?? null,
        borrower_lastname: r.borrower_lastname ?? null,
        borrower_business_name: r.borrower_business_name ?? null,
        borrower_unique_number: r.borrower_unique_number ?? null,
        borrower_gender: r.borrower_gender ?? null,
        borrower_dob: r.borrower_dob ?? null,
        borrower_address: r.borrower_address ?? null,
        borrower_city: r.borrower_city ?? null,
        borrower_province: r.borrower_province ?? null,
        borrower_zipcode: r.borrower_zipcode ?? null,
        borrower_landline: r.borrower_landline ?? null,
        borrower_mobile: r.borrower_mobile ?? null,
        borrower_email: r.borrower_email ?? null,
        national_id: r.custom_field_23167 ?? null,
      }))
      db.transaction((rows) => {
        for (const row of rows) insert.run(row)
      })(mapped)
      branchInserted += mapped.length
      page += 1
      if (total != null && branchInserted >= total) break
    }
    console.info(
      `[Borrowers] Branch ${branchCode} (${branchName}) saved ${branchInserted}${
        total != null ? ` / ${total}` : ''
      } records`
    )
  }
}

async function fetchCollectionsOnce(branchCode, payload) {
  const res = await fetch(buildCollectionsUrl(branchCode), {
    method: 'POST',
    headers: {
      'Authorization': AUTH,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch(e) {
    throw new Error(`Collections parse error. HTTP ${res.status}. Body: ${text}`)
  }
  const raw = Array.isArray(json?.response?.Results) ? json.response.Results : []
  const results = Array.isArray(raw[0]) ? raw.flat() : raw
  return { meta: json?.response, results }
}

async function fetchAllCollections() {
  const all = []
  let grandTotal = 0
  const count = 100
  // helper to parse loandisk_system_date: "DD/MM/YYYY HH:MMam|pm"
  const parseLoandiskDate = (s) => {
    if (!s) return null
    const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)$/i)
    if (!m) return null
    let [ , dd, mm, yyyy, hh, mi, ap ] = m
    dd = parseInt(dd,10); mm = parseInt(mm,10); yyyy = parseInt(yyyy,10)
    hh = parseInt(hh,10); mi = parseInt(mi,10)
    if (/pm/i.test(ap) && hh < 12) hh += 12
    if (/am/i.test(ap) && hh === 12) hh = 0
    return new Date(yyyy, mm-1, dd, hh, mi)
  }
  const getBranchIncrementalStart = (db, branchCode) => {
    const rows = db.prepare(`SELECT loandisk_system_date, repayment_collected_date FROM ${COLLECTIONS_TABLE} WHERE branch = ? AND loandisk_system_date IS NOT NULL AND loandisk_system_date <> ''`).all(branchCode)
    if (!rows.length) return '01/01/2024'
    let best = null, bestRepay = '01/01/2024'
    for (const r of rows) {
      const d = parseLoandiskDate(r.loandisk_system_date)
      if (!d) continue
      if (!best || d > best) { best = d; bestRepay = String(r.repayment_collected_date || '01/01/2024') }
    }
    return bestRepay || '01/01/2024'
  }

}

async function fetchAllCollectionsWithDb(db) {
  const all = []
  let grandTotal = 0
  const count = 1000
  const today = getTodayDMY()
  const latestDate = getLatestCollectionDate(db)
  let startDate = latestDate || DEFAULT_COLLECTION_START_DATE
  if (latestDate) {
    db.prepare(`DELETE FROM ${COLLECTIONS_TABLE} WHERE repayment_collected_date = ?`).run(latestDate)
  }
  console.info(`[Collections] Fetching records from ${startDate} to ${today}`)

  const branchList = getActiveBranches(db).map(b => b.code)
  for (const branchCode of branchList) {
    console.info(`[Collections] Fetching repayments for branch ${branchCode} (from ${startDate} to ${today})`)
    let branchInserted = 0
    let page = 1
    let total = null
    while (true) {
      const payload = {
        from: page,
        count,
        repayment_search_from_date: startDate,
        repayment_search_to_date: today,
      }
      const { meta, results } = await fetchCollectionsOnce(branchCode, payload)
      if (total == null && meta?.TotalResults != null) total = Number(meta.TotalResults)
      if (!results.length) break
      for (const r of results) r._branch_code = branchCode
      all.push(...results)
      branchInserted += results.length
      page += 1
      if (total != null && branchInserted >= total) break
    }
    console.info(`[Collections] Branch ${branchCode} fetched ${branchInserted}${total != null ? ` / ${total}` : ''} records`)
    if (total != null) grandTotal += total
  }
  return { total: grandTotal || null, results: all }
}

function upsertCollection(db, r) {
  const rid = Number(r?.repayment_id ?? 0) || 0
  if (!rid) return
  const stmt = db.prepare(`
    INSERT INTO ${COLLECTIONS_TABLE} (
      repayment_id, branch, loan_id, repayment_amount, loan_repayment_method_id, repayment_collected_date,
      collector_id, repayment_backdate, repayment_backdated_date, repayment_adjust_remaining_schedule,
      repayment_adjust_remaining_schedule_pro_rata, repayment_manual_composition,
      principal_repayment_amount, interest_repayment_amount, fees_repayment_amount,
      penalty_repayment_amount, loandisk_system_date, borrower_access_ids,
      repayment_description, dea_cash_bank_account, custom_field_23214, custom_fields
    ) VALUES (
      @repayment_id, @branch, @loan_id, @repayment_amount, @loan_repayment_method_id, @repayment_collected_date,
      @collector_id, @repayment_backdate, @repayment_backdated_date, @repayment_adjust_remaining_schedule,
      @repayment_adjust_remaining_schedule_pro_rata, @repayment_manual_composition,
      @principal_repayment_amount, @interest_repayment_amount, @fees_repayment_amount,
      @penalty_repayment_amount, @loandisk_system_date, @borrower_access_ids,
      @repayment_description, @dea_cash_bank_account, @custom_field_23214, @custom_fields
    )
    ON CONFLICT(repayment_id) DO UPDATE SET
      branch=excluded.branch,
      loan_id=excluded.loan_id,
      repayment_amount=excluded.repayment_amount,
      loan_repayment_method_id=excluded.loan_repayment_method_id,
      repayment_collected_date=excluded.repayment_collected_date,
      collector_id=excluded.collector_id,
      repayment_backdate=excluded.repayment_backdate,
      repayment_backdated_date=excluded.repayment_backdated_date,
      repayment_adjust_remaining_schedule=excluded.repayment_adjust_remaining_schedule,
      repayment_adjust_remaining_schedule_pro_rata=excluded.repayment_adjust_remaining_schedule_pro_rata,
      repayment_manual_composition=excluded.repayment_manual_composition,
      principal_repayment_amount=excluded.principal_repayment_amount,
      interest_repayment_amount=excluded.interest_repayment_amount,
      fees_repayment_amount=excluded.fees_repayment_amount,
      penalty_repayment_amount=excluded.penalty_repayment_amount,
      loandisk_system_date=excluded.loandisk_system_date,
      borrower_access_ids=excluded.borrower_access_ids,
      repayment_description=excluded.repayment_description,
      dea_cash_bank_account=excluded.dea_cash_bank_account,
      custom_field_23214=excluded.custom_field_23214,
      custom_fields=excluded.custom_fields
  `)
  // Helper to stringify arrays/objects for JSON storage
  const toJsonString = (val) => {
    if (val == null) return null
    if (Array.isArray(val) || typeof val === 'object') {
      try {
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }
    return String(val)
  }
  const row = {
    repayment_id: rid,
    branch: String(r?._branch_code || ''),
    loan_id: Number(r?.loan_id ?? 0) || 0,
    repayment_amount: toNumber(r?.repayment_amount),
    loan_repayment_method_id: Number(r?.loan_repayment_method_id ?? 0) || 0,
    repayment_collected_date: String(r?.repayment_collected_date || ''),
    collector_id: Number(r?.collector_id ?? 0) || 0,
    repayment_backdate: Number(r?.repayment_backdate ?? 0) || 0,
    repayment_backdated_date: r?.repayment_backdated_date ? String(r.repayment_backdated_date) : null,
    repayment_adjust_remaining_schedule: Number(r?.repayment_adjust_remaining_schedule ?? 0) || 0,
    repayment_adjust_remaining_schedule_pro_rata: Number(r?.repayment_adjust_remaining_schedule_pro_rata ?? 0) || 0,
    repayment_manual_composition: Number(r?.repayment_manual_composition ?? 0) || 0,
    principal_repayment_amount: toNumber(r?.principal_repayment_amount),
    interest_repayment_amount: toNumber(r?.interest_repayment_amount),
    fees_repayment_amount: toNumber(r?.fees_repayment_amount),
    penalty_repayment_amount: toNumber(r?.penalty_repayment_amount),
    loandisk_system_date: String(r?.loandisk_system_date || ''),
    borrower_access_ids: toJsonString(r?.borrower_access_ids),
    repayment_description: String(r?.repayment_description || ''),
    dea_cash_bank_account: Number(r?.dea_cash_bank_account ?? 0) || 0,
    custom_field_23214: r?.custom_field_23214 ? String(r.custom_field_23214) : null,
    custom_fields: toJsonString(r?.custom_fields),
  }
  stmt.run(row)
}

function upsert(db, row) {
  // Build dynamic insert/upsert with known columns
  const cols = ['loan_id','disbursed_date','branch','disbursed']
  const extra = COLUMN_MAP.map(([c]) => c)
  for (const c of extra) if (!cols.includes(c)) cols.push(c)
  const placeholders = cols.map(c => `@${c}`).join(',')
  const updates = cols.filter(c => c !== 'loan_id' && c !== 'disbursed_date').map(c => `${c}=excluded.${c}`).join(',')
  const sql = `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(loan_id, disbursed_date) DO UPDATE SET ${updates}`
  const stmt = db.prepare(sql)
  stmt.run(row)
}

function mapResult(r) {
  const base = {
    loan_id: String(r['Loan Id'] ?? ''),
    disbursed_date: String(r['Disbursed Date'] ?? ''),
    branch: String(r['Branch'] ?? ''),
    disbursed: toNumber(r['Disbursed']),
  }
  for (const [col, src, type] of COLUMN_MAP) {
    if (type === 'REAL') base[col] = toNumber(r[src])
    else base[col] = r[src] == null ? '' : String(r[src])
  }
  return base
}

// === Zidisha setup ===
const ZIDISHA_URL = 'https://api.live.irl.musoniservices.com/v1/dataexports/10/download'
const ZIDISHA_TABLE = 'zidisha_data'

// Zidisha Daily Expected vs Repayed (Musoni export id 22)
const ZIDISHA_DAILY_URL = 'https://api.live.irl.musoniservices.com/v1/dataexports/22/download'
const ZIDISHA_DAILY_TABLE = 'Zidisha_Daily'

// Boda repayments (Musoni export id 20) - saved into boda_repayments
const BODA_REPAY_URL = 'https://api.live.irl.musoniservices.com/v1/dataexports/20/download?fileFormat=csv'
const BODA_REPAY_TABLE = 'boda_repayments'
const BODA_REPAY_COLUMNS = [
  'Client Id',
  'Loan Id',
  'Product Name',
  'Submitted On Date',
  'Total Repaid',
  'Transaction Amount',
]

// Match these headers exactly to the successful Postman request.
// NOTE: Accept is application/json, not text/csv or */*.
const ZIDISHA_HEADERS = {
  'x-Fineract-Platform-TenantId': 'phoenix',
  'Authorization': 'Basic Z3JlZzpOeWFtYW8xMDM3MEA=',
  'Content-Type': 'application/json',
  'x-api-key': 'EESNWPfIBcyytEPESeNdazuj2qqdKLatO8T3Yhf0',
  'User-Agent': 'DAP/1.0',
  'Accept': 'application/json',
}
// Only persist the original core financial fields from the Zidisha export.
// We intentionally skip Business Profile fields to avoid issues with occasional
// malformed / structurally different rows in the source export.
const ZIDISHA_COLUMNS = [
  'Branch Name',
  'Client Id',
  'Client Name',
  'Date Of Birth',
  'Disbursed On Date',
  'Expected Matured On Date',
  'Gender',
  'Loan ID',
  'Loan Officer Name',
  'Matured On Date',
  'Penalties Overdue Derived',
  'Principal Amount',
  'Principal Outstanding Derived',
  'Principal Overdue Derived',
  'Product Name',
  'Total Charges Due At Disbursement Derived',
  'Total Expected Repayment Derived',
  'Total Outstanding Derived',
  'Total Repayment Derived',
]

function initBodaRepaymentsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${BODA_REPAY_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      "Client Id" TEXT,
      "Loan Id" TEXT,
      "Product Name" TEXT,
      "Submitted On Date" TEXT,
      "Total Repaid" REAL,
      "Transaction Amount" REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  const cols = db.prepare(`PRAGMA table_info(${BODA_REPAY_TABLE});`).all().map(c => c.name)
  for (const col of ["Client Id","Loan Id","Product Name","Submitted On Date","Total Repaid","Transaction Amount"]) {
    if (!cols.includes(col)) {
      const type = (col === 'Total Repaid' || col === 'Transaction Amount') ? 'REAL' : 'TEXT'
      db.exec(`ALTER TABLE ${BODA_REPAY_TABLE} ADD COLUMN "${col}" ${type};`)
    }
  }
}
function initZidishaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ZIDISHA_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      "Branch Name" TEXT,
      "Client Id" TEXT,
      "Client Name" TEXT,
      "Date Of Birth" TEXT,
      "Disbursed On Date" TEXT,
      "Expected Matured On Date" TEXT,
      "Gender" TEXT,
      "Loan ID" TEXT,
      "Loan Officer Name" TEXT,
      "Matured On Date" TEXT,
      "Penalties Overdue Derived" TEXT,
      "Principal Amount" REAL,
      "Principal Outstanding Derived" REAL,
      "Principal Overdue Derived" REAL,
      "Product Name" TEXT,
      "Total Charges Due At Disbursement Derived" REAL,
      "Total Expected Repayment Derived" REAL,
      "Total Outstanding Derived" REAL,
      "Total Repayment Derived" REAL,
      "Business Profile - Business Name" TEXT,
      "Business Profile - Business Type" TEXT,
      "Business Profile - Business Category" TEXT,
      created_at TEXT DEFAULT (datetime('now'))
      -- NO UNIQUE CONSTRAINT
    );
  `)
  const cols = db.prepare(`PRAGMA table_info(${ZIDISHA_TABLE});`).all().map(c => c.name)
  if (!cols.includes('Date Of Birth')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Date Of Birth" TEXT;`)
  }
  if (!cols.includes('Gender')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Gender" TEXT;`)
  }
  if (!cols.includes('Principal Outstanding Derived')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Principal Outstanding Derived" REAL;`)
  }
  if (!cols.includes('Principal Overdue Derived')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Principal Overdue Derived" REAL;`)
  }
  if (!cols.includes('Total Charges Due At Disbursement Derived')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Total Charges Due At Disbursement Derived" REAL;`)
  }
  if (!cols.includes('Business Profile - Business Category')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Business Profile - Business Category" TEXT;`)
  }
  if (!cols.includes('Business Profile - Business Name')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Business Profile - Business Name" TEXT;`)
  }
  if (!cols.includes('Business Profile - Business Type')) {
    db.exec(`ALTER TABLE ${ZIDISHA_TABLE} ADD COLUMN "Business Profile - Business Type" TEXT;`)
  }
}
// Remove any UNIQUE constraint from an existing table: if schema has it, recreate table.
function migrateZidishaDropUniqueIfPresent(db) {
  const info = db.prepare(`PRAGMA table_info(${ZIDISHA_TABLE});`).all()
  const createStmt = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(ZIDISHA_TABLE)
  if (createStmt && createStmt.sql && /UNIQUE\s*\(.+\)/i.test(createStmt.sql)) {
    // migrate to new table without unique constraint
    const cols = info.map(c => `"${c.name}"`).join(',')
    db.exec('BEGIN')
    db.exec(`CREATE TABLE ${ZIDISHA_TABLE}_new AS SELECT ${cols} FROM ${ZIDISHA_TABLE}`)
    db.exec(`DROP TABLE ${ZIDISHA_TABLE}`)
    initZidishaTable(db)
    db.exec(`INSERT INTO ${ZIDISHA_TABLE} (${cols}) SELECT ${cols} FROM ${ZIDISHA_TABLE}_new`)
    db.exec(`DROP TABLE ${ZIDISHA_TABLE}_new`)
    db.exec('COMMIT')
  }
}

// Initialize Zidisha Daily Expected vs Repayed table dynamically based on CSV columns
function initZidishaDailyTable(db, columns) {
  if (!columns || columns.length === 0) {
    console.warn('No columns provided for Zidisha Daily table initialization')
    return
  }
  
  // Ensure "Branch Name" is in the columns list if it exists in the response
  const allColumns = [...columns]
  if (!allColumns.includes('Branch Name') && columns.some(col => col && col.toLowerCase().includes('branch'))) {
    // Try to find branch column with different casing
    const branchCol = columns.find(col => col && col.toLowerCase().includes('branch'))
    if (branchCol && branchCol !== 'Branch Name') {
      // Use the found branch column name as-is
      console.log(`Using branch column: "${branchCol}"`)
    }
  }
  
  // Check if table exists
  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(ZIDISHA_DAILY_TABLE)
  
  if (!tableExists) {
    // Create table with all columns from CSV
    const columnDefs = allColumns.map(col => {
      // Determine type based on column name (common numeric fields)
      // "Branch Name" should be TEXT
      const numericFields = ['Amount', 'Expected', 'Repayed', 'Repayment', 'Outstanding', 'Overdue', 'Principal', 'Total', 'Charges']
      const isNumeric = numericFields.some(field => col.includes(field))
      const type = isNumeric ? 'REAL' : 'TEXT'
      return `"${col}" ${type}`
    }).join(', ')
    
    const sql = `
      CREATE TABLE IF NOT EXISTS "${ZIDISHA_DAILY_TABLE}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${columnDefs},
        created_at TEXT DEFAULT (datetime('now'))
      )
    `
    db.exec(sql)
    console.log(`Created table ${ZIDISHA_DAILY_TABLE} with ${allColumns.length} columns`)
  } else {
    // Table exists - check for missing columns and add them
    const existingCols = db.prepare(`PRAGMA table_info("${ZIDISHA_DAILY_TABLE}")`).all().map(c => c.name)
    for (const col of allColumns) {
      if (!existingCols.includes(col) && col !== 'id' && col !== 'created_at') {
        const numericFields = ['Amount', 'Expected', 'Repayed', 'Repayment', 'Outstanding', 'Overdue', 'Principal', 'Total', 'Charges']
        const isNumeric = numericFields.some(field => col.includes(field))
        const type = isNumeric ? 'REAL' : 'TEXT'
        try {
          db.exec(`ALTER TABLE "${ZIDISHA_DAILY_TABLE}" ADD COLUMN "${col}" ${type}`)
          console.log(`Added column "${col}" to ${ZIDISHA_DAILY_TABLE}`)
        } catch (e) {
          console.warn(`Could not add column "${col}": ${e.message}`)
        }
      }
    }
    // Explicitly ensure "Branch Name" exists if it's in the response
    if (allColumns.includes('Branch Name') && !existingCols.includes('Branch Name')) {
      try {
        db.exec(`ALTER TABLE "${ZIDISHA_DAILY_TABLE}" ADD COLUMN "Branch Name" TEXT`)
        console.log(`Added column "Branch Name" to ${ZIDISHA_DAILY_TABLE}`)
      } catch (e) {
        console.warn(`Could not add column "Branch Name": ${e.message}`)
      }
    }
  }
}

async function fetchZidishaCsv() {
  const res = await fetch(ZIDISHA_URL, { method: 'GET', headers: ZIDISHA_HEADERS })
  if (!res.ok) throw new Error(`Zidisha API fetch failed: ${res.status}`)
  const csv = await res.text()
  if (PAPAPARSE) {
    const { data } = PAPAPARSE.parse(csv, { header: true, skipEmptyLines: true })
    return data
  }
  // Fallback parser that supports quoted fields and newlines within values
  const rows = []
  let field = ''
  let row = []
  let insideQuotes = false
  let i = 0
  while (i < csv.length) {
    const ch = csv[i]
    if (ch === '"') {
      if (insideQuotes && csv[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      insideQuotes = !insideQuotes
      i += 1
      continue
    }
    if (!insideQuotes && ch === ';') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (!insideQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.length && row.some(cell => cell !== '' || rows.length === 0)) rows.push(row)
      row = []
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim())
  if (headers.length < 2) throw new Error('Could not parse Zidisha CSV headers')
  return rows.slice(1).filter(r => r.length).map((vals) => {
    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? ''
    })
    return obj
  })
}

async function fetchBodaRepaymentsCsv() {
  const res = await fetch(BODA_REPAY_URL, { method: 'GET', headers: ZIDISHA_HEADERS })
  if (!res.ok) throw new Error(`Boda repayments API fetch failed: ${res.status}`)
  const csv = await res.text()
  if (PAPAPARSE) {
    const { data } = PAPAPARSE.parse(csv, { header: true, skipEmptyLines: true })
    return data
  }
  // Fallback CSV parser (same as Zidisha) – handles quoted fields and newlines
  const rows = []
  let field = ''
  let row = []
  let insideQuotes = false
  let i = 0
  while (i < csv.length) {
    const ch = csv[i]
    if (ch === '"') {
      if (insideQuotes && csv[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      insideQuotes = !insideQuotes
      i += 1
      continue
    }
    if (!insideQuotes && ch === ';') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (!insideQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.length && row.some(cell => cell !== '' || rows.length === 0)) rows.push(row)
      row = []
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim())
  if (headers.length < 2) throw new Error('Could not parse boda_repayments CSV headers')
  return rows.slice(1).filter(r => r.length).map((vals) => {
    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? ''
    })
    return obj
  })
}
function insertZidisha(db, row) {
  const cols = ZIDISHA_COLUMNS
  const toParam = (name) => ('@' + name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_'))
  const keyFor = (name) => (name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_'))
  const placeholders = cols.map(c => toParam(c)).join(',')
  const sql = `INSERT INTO ${ZIDISHA_TABLE} (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${placeholders})`
  const stmt = db.prepare(sql)
  const cleanRow = {}
  for(const c of cols) {
    let v = row[c]
    if (v == null) v = ''
    if (["Principal Amount","Principal Outstanding Derived","Principal Overdue Derived","Total Charges Due At Disbursement Derived","Total Expected Repayment Derived","Total Outstanding Derived","Total Repayment Derived"].includes(c)) {
      cleanRow[keyFor(c)] = Number((v+'').replace(/,/g,'')) || 0
    } else {
      cleanRow[keyFor(c)] = v
    }
  }
  try { stmt.run(cleanRow) } catch (e) { /* skip invalid row */ }
}

function insertBodaRepayment(db, row) {
  const stmt = db.prepare(`
    INSERT INTO ${BODA_REPAY_TABLE} (
      "Client Id",
      "Loan Id",
      "Product Name",
      "Submitted On Date",
      "Total Repaid",
      "Transaction Amount"
    ) VALUES (@client_id, @loan_id, @product_name, @submitted_on_date, @total_repaid, @transaction_amount)
  `)

  const clean = {
    client_id: row['Client Id'] ?? '',
    loan_id: row['Loan Id'] ?? '',
    product_name: row['Product Name'] ?? '',
    submitted_on_date: row['Submitted On Date'] ?? '',
    total_repaid: Number((row['Total Repaid'] || '').toString().replace(/,/g,'')) || 0,
    transaction_amount: Number((row['Transaction Amount'] || '').toString().replace(/,/g,'')) || 0,
  }

  try {
    stmt.run(clean)
  } catch (e) {
    console.error('Failed to insert boda_repayments row:', e.message)
  }
}

async function fetchZidishaDailyCsv() {
  const res = await fetch(ZIDISHA_DAILY_URL, { method: 'GET', headers: ZIDISHA_HEADERS })
  if (!res.ok) throw new Error(`Zidisha Daily API fetch failed: ${res.status}`)
  const csv = await res.text()
  if (PAPAPARSE) {
    const { data } = PAPAPARSE.parse(csv, { header: true, skipEmptyLines: true })
    // Extract columns from first row if available
    const columns = data.length > 0 ? Object.keys(data[0]) : []
    return { data, columns }
  }
  // Fallback parser that supports quoted fields and newlines within values
  const rows = []
  let field = ''
  let row = []
  let insideQuotes = false
  let i = 0
  while (i < csv.length) {
    const ch = csv[i]
    if (ch === '"') {
      if (insideQuotes && csv[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      insideQuotes = !insideQuotes
      i += 1
      continue
    }
    if (!insideQuotes && ch === ';') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (!insideQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.length && row.some(cell => cell !== '' || rows.length === 0)) rows.push(row)
      row = []
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  if (!rows.length) return { data: [], columns: [] }
  const headers = rows[0].map(h => h.trim())
  if (headers.length < 2) throw new Error('Could not parse Zidisha Daily CSV headers')
  const data = rows.slice(1).filter(r => r.length).map((vals) => {
    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? ''
    })
    return obj
  })
  return { data, columns: headers }
}

function insertZidishaDaily(db, row, columns) {
  if (!columns || columns.length === 0) return
  
  const toParam = (name) => ('@' + name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_'))
  const keyFor = (name) => (name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_'))
  const placeholders = columns.map(c => toParam(c)).join(',')
  const sql = `INSERT INTO "${ZIDISHA_DAILY_TABLE}" (${columns.map(c=>`"${c}"`).join(',')}) VALUES (${placeholders})`
  const stmt = db.prepare(sql)
  const cleanRow = {}
  
  // Common numeric field patterns
  const numericFields = ['Amount', 'Expected', 'Repayed', 'Repayment', 'Outstanding', 'Overdue', 'Principal', 'Total', 'Charges']
  
  for (const c of columns) {
    let v = row[c]
    if (v == null) v = ''
    const isNumeric = numericFields.some(field => c.includes(field))
    if (isNumeric) {
      cleanRow[keyFor(c)] = Number((v+'').replace(/,/g,'')) || 0
    } else {
      cleanRow[keyFor(c)] = v
    }
  }
  try { stmt.run(cleanRow) } catch (e) { /* skip invalid row */ }
}

(async () => {
  try {
    const db = initDb()
    migrateDropRawIfPresent(db)

    // Load active branches once and apply to disbursement payload
    const activeBranches = getActiveBranches(db)
    basePayload.branches_select = activeBranches.map(b => b.code).join('||')

    // === Disbursements ingestion ===
    if (!SKIP_DISBURSEMENTS) {
      const latest = getLatestDisbursedDate(db)
      if (latest) {
        // delete existing rows of the latest date to allow clean re-fetch of that day
        db.prepare(`DELETE FROM ${TABLE} WHERE disbursed_date = ?`).run(latest)
        // use latest as new start_date for incremental fetch
        basePayload.start_date = latest
      }

      const { total, results } = await fetchAll()
      const tx = db.transaction((rows) => {
        for (const r of rows) upsert(db, mapResult(r))
      })
      tx(results)
      console.log(`Saved ${results.length} rows into ${TABLE} (of total ${total ?? 'unknown'})`)
    } else {
      console.log('Skipping disbursements ingestion due to SKIP_DISBURSEMENTS=1')
    }

    // === Collections ingestion ===
    if (!SKIP_COLLECTIONS) {
      initCollectionsTable(db)
      const { total: collTotal, results: collResults } = await fetchAllCollectionsWithDb(db)
      const tx2 = db.transaction((rows) => {
        for (const r of rows) upsertCollection(db, r)
      })
      tx2(collResults)
      const collCount = db.prepare(`SELECT COUNT(*) as c FROM ${COLLECTIONS_TABLE}`).get().c
      console.log(`Saved ${collResults.length} rows into ${COLLECTIONS_TABLE} (of total ${collTotal ?? 'unknown'}). Table now has ${collCount} rows.`)
    } else {
      console.log('Skipping collections ingestion due to SKIP_COLLECTIONS=1')
    }

    // === Borrowers ingestion ===
    if (!SKIP_BORROWERS) {
      await fetchAllBorrowers(db)
      const borrowersCount = db.prepare(`SELECT COUNT(*) as c FROM ${BORROWERS_TABLE}`).get().c
      console.log(`Borrowers table ${BORROWERS_TABLE} now has ${borrowersCount} rows across branches.`)
    } else {
      console.log('Skipping borrowers ingestion due to SKIP_BORROWERS=1')
    }

    // === Zidisha ingestion ===
    if (!SKIP_ZIDISHA) {
      const dbZ = initDb()
      initZidishaTable(dbZ)
      migrateZidishaDropUniqueIfPresent(dbZ)
      // Truncate the table before new insert
      dbZ.exec(`DELETE FROM ${ZIDISHA_TABLE}`)
      const zidishaRows = await fetchZidishaCsv()
      const txZ = dbZ.transaction((rows) => {
        for (const r of rows) insertZidisha(dbZ, r)
      })
      txZ(zidishaRows)
      const zidishaCount = dbZ.prepare(`SELECT COUNT(*) as c FROM ${ZIDISHA_TABLE}`).get().c
      console.log(`Saved ${zidishaRows.length} rows into ${ZIDISHA_TABLE}. Table now has ${zidishaCount} rows.`)
    } else {
      console.log('Skipping Zidisha ingestion due to SKIP_ZIDISHA=1')
    }

    // === Boda repayments ingestion (Musoni export id 20) ===
    if (!SKIP_BODA_REPAYMENTS) {
      const dbB = initDb()
      initBodaRepaymentsTable(dbB)
      // Truncate table before fresh insert
      dbB.exec(`DELETE FROM ${BODA_REPAY_TABLE}`)
      const bodaRows = await fetchBodaRepaymentsCsv()
      const txB = dbB.transaction((rows) => {
        for (const r of rows) insertBodaRepayment(dbB, r)
      })
      txB(bodaRows)
      const bodaCount = dbB.prepare(`SELECT COUNT(*) as c FROM ${BODA_REPAY_TABLE}`).get().c
      console.log(`Saved ${bodaRows.length} rows into ${BODA_REPAY_TABLE}. Table now has ${bodaCount} rows.`)
    } else {
      console.log('Skipping boda_repayments ingestion due to SKIP_BODA_REPAYMENTS=1')
    }

    // === Zidisha Daily Expected vs Repayed ingestion (Musoni export id 22) ===
    if (!SKIP_ZIDISHA_DAILY) {
      const dbZD = initDb()
      // Fetch data first to get columns
      const { data: zidishaDailyRows, columns } = await fetchZidishaDailyCsv()
      if (columns.length > 0) {
        // Initialize table with columns from CSV
        initZidishaDailyTable(dbZD, columns)
        // Truncate table before fresh insert
        dbZD.exec(`DELETE FROM "${ZIDISHA_DAILY_TABLE}"`)

        // Backend filter: keep only "Zidisha Boda" rows based on Product Name
        const zidishaBodaRows = zidishaDailyRows.filter((row) => {
          const product = (row['Product Name'] || row.product_name || '').toString().trim().toLowerCase()
          const clientId = (row['Client Id'] || row.client_id || '').toString().trim()
          if (clientId === '3926') return false
          return product === 'zidisha boda'
        })

        const txZD = dbZD.transaction((rows) => {
          for (const r of rows) insertZidishaDaily(dbZD, r, columns)
        })
        txZD(zidishaBodaRows)
        const zidishaDailyCount = dbZD.prepare(`SELECT COUNT(*) as c FROM "${ZIDISHA_DAILY_TABLE}"`).get().c
        console.log(`Saved ${zidishaBodaRows.length} Zidisha Boda rows into ${ZIDISHA_DAILY_TABLE}. Table now has ${zidishaDailyCount} rows.`)
      } else {
        console.log('No columns found in Zidisha Daily export, skipping ingestion')
      }
    } else {
      console.log('Skipping Zidisha Daily ingestion due to SKIP_ZIDISHA_DAILY=1')
    }

    db.close()
  } catch (err) {
    console.error('Ingestion failed:', err.message)
    process.exitCode = 1
  }
})()



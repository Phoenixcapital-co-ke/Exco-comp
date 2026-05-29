/**
 * Recompute PAR aging (par_30..par_90_plus) from stored Open_loans + Past_Missed_repayment for a snapshot time.
 * Usage: node scripts/recompute_par_aging.mjs [snapshot_time]
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  LOANDISK_LOAN_ROW_SELECT,
  parseLoandiskLoanRecord,
} from '../lib/loandiskLoanSchema.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'app.db')
const selectSql = LOANDISK_LOAN_ROW_SELECT.join(', ')

// Inline aggregation (mirrors server.js)
function parseParLoanPrincipal(loan) {
  const raw =
    loan?.principal_balance_amount ??
    loan?.PrincipalBalanceAmount ??
    loan?.['principal_balance_amount'] ??
    0
  return typeof raw === 'number'
    ? raw
    : Number(String(raw).replace(/[^\d.-]/g, '')) || 0
}

function parseParLoanDaysPastDue(loan, row) {
  for (const c of [row?.days_past_due, loan?.days_past_due]) {
    if (c == null || c === '') continue
    const n = Number(String(c).replace(/[^\d.-]/g, ''))
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n))
  }
  return null
}

function parAgingBucketFromDays(days) {
  if (days == null || days < 1) return null
  if (days <= 30) return 30
  if (days <= 60) return 60
  if (days <= 90) return 90
  return '90plus'
}

function createParTotals() {
  return { openLoans: 0, pastMissed: 0, par30: 0, par60: 0, par90: 0, par90Plus: 0 }
}

function addParDelinquent(totals, loan, row) {
  const p = parseParLoanPrincipal(loan)
  if (p <= 0) return
  totals.pastMissed += p
  const bucket = parAgingBucketFromDays(parseParLoanDaysPastDue(loan, row))
  if (bucket === 30) totals.par30 += p
  else if (bucket === 60) totals.par60 += p
  else if (bucket === 90) totals.par90 += p
  else if (bucket === '90plus') totals.par90Plus += p
}

const db = new Database(dbPath)
const timeArg = process.argv[2]
const loanSnapshotTime = db.prepare('SELECT time FROM Open_loans ORDER BY time DESC LIMIT 1').get()?.time
const latestParTime = db.prepare('SELECT time FROM PAR ORDER BY time DESC LIMIT 1').get()?.time
const snapshotTime = timeArg || loanSnapshotTime || latestParTime

if (!snapshotTime) {
  console.error('No loan/PAR snapshot time found')
  process.exit(1)
}

const openRows = db.prepare(`SELECT ${selectSql} FROM Open_loans WHERE time = ?`).all(snapshotTime)
const missedRows = db
  .prepare(`SELECT ${selectSql} FROM Past_Missed_repayment WHERE time = ?`)
  .all(snapshotTime)

const totals = createParTotals()
for (const row of openRows) {
  const loan = parseLoandiskLoanRecord(row)
  if (!loan) continue
  totals.openLoans += parseParLoanPrincipal(loan)
}
for (const row of missedRows) {
  const loan = parseLoandiskLoanRecord(row)
  if (!loan) continue
  addParDelinquent(totals, loan, row)
}

const denom = totals.openLoans || 0
const pct = (n) => (denom > 0 ? ((n / denom) * 100).toFixed(2) : '0.00')

const patchPar = db.prepare(
  `UPDATE PAR SET Past_Arrears_missed = ?, Open_loans = ?, par_30 = ?, par_60 = ?, par_90 = ?, par_90_plus = ? WHERE time = ?`,
)
const values = [
  totals.pastMissed,
  totals.openLoans,
  totals.par30,
  totals.par60,
  totals.par90,
  totals.par90Plus,
]
const timesToPatch = new Set([snapshotTime])
if (latestParTime) timesToPatch.add(latestParTime)

for (const t of timesToPatch) {
  const r = patchPar.run(...values, t)
  if (r.changes) console.log(`Updated PAR row @ ${t}`)
  else console.log(`No PAR row for ${t} (loan data @ ${snapshotTime})`)
}

console.log(`Computed from Open_loans + Past_Missed_repayment @ ${snapshotTime}`)
console.log(`  Open loans principal: ${totals.openLoans.toLocaleString()}`)
console.log(`  Total PAR: ${pct(totals.pastMissed)}% (${totals.pastMissed.toLocaleString()})`)
console.log(`  PAR 30 (1-30d):   ${pct(totals.par30)}%`)
console.log(`  PAR 60 (31-60d):  ${pct(totals.par60)}%`)
console.log(`  PAR 90 (61-90d):  ${pct(totals.par90)}%`)
console.log(`  PAR 90+ (91+d):   ${pct(totals.par90Plus)}%`)
console.log(`  Missed rows: ${missedRows.length}, with days_past_due in bucket: check DB`)

db.close()

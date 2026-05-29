/**
 * Repopulate Open_loans flattened columns from Loandisk API.
 * (loan_data JSON was removed before Open_loans was backfilled — JSON backfill is not possible.)
 *
 * Usage:
 *   node scripts/refetch_open_loans_columns.mjs --latest     # recommended: refresh latest snapshot
 *   node scripts/refetch_open_loans_columns.mjs --prune-only # delete hollow rows (no API)
 *   node scripts/refetch_open_loans_columns.mjs --all        # all empty snapshot times (very slow)
 *
 * Note: API returns current loan book, not historical point-in-time state for old snapshots.
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { fetchLoandiskLoans } from '../lib/loandiskFetch.mjs'
import {
  ensureLoandiskLoanTableColumns,
  insertLoandiskLoanRow,
  loandiskLoanTableColumnSet,
} from '../lib/loandiskLoanSchema.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'app.db')
const args = new Set(process.argv.slice(2))
const latestOnly = args.has('--latest') || (!args.has('--all') && !args.has('--prune-only'))
const pruneOnly = args.has('--prune-only')
const allTimes = args.has('--all')
const delayMs = Number(process.env.LOANDISK_BRANCH_DELAY_MS || 1000)

const db = new Database(dbPath)
const table = 'Open_loans'
const loanStatusId = '1'

ensureLoandiskLoanTableColumns(db, table)
const cols = loandiskLoanTableColumnSet(db, table)
if (cols.has('loan_data')) {
  console.warn('loan_data column still present — run scripts/backfill_loandisk_loan_columns.mjs Open_loans first if JSON exists.')
}

const emptyCount = db
  .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE loan_id IS NULL OR loan_id = ''`)
  .get().n
console.log(`Hollow rows (no loan_id): ${emptyCount}`)

if (pruneOnly) {
  const r = db.prepare(`DELETE FROM "${table}" WHERE loan_id IS NULL OR loan_id = ''`).run()
  console.log(`Pruned ${r.changes} hollow rows`)
  db.close()
  process.exit(0)
}

let times = db
  .prepare(
    `SELECT DISTINCT time FROM "${table}" WHERE loan_id IS NULL OR loan_id = '' ORDER BY time`,
  )
  .all()
  .map((r) => r.time)

if (!allTimes && latestOnly) {
  const latest = db.prepare(`SELECT time FROM "${table}" ORDER BY time DESC LIMIT 1`).get()
  times = latest?.time ? [latest.time] : []
}

console.log(`Refetching ${times.length} snapshot time(s) from Loandisk (open loans, status ${loanStatusId})…`)

const pairsStmt = db.prepare(
  `SELECT DISTINCT branch_code FROM "${table}" WHERE time = ? AND (loan_id IS NULL OR loan_id = '')`,
)
const deleteStmt = db.prepare(`DELETE FROM "${table}" WHERE time = ? AND branch_code = ?`)
let totalInserted = 0
let totalDeleted = 0

for (let ti = 0; ti < times.length; ti++) {
  const time = times[ti]
  const branches = pairsStmt.all(time).map((r) => String(r.branch_code || '').trim()).filter(Boolean)
  console.log(`[${ti + 1}/${times.length}] ${time} — ${branches.length} branch(es)`)

  for (const branchCode of branches) {
    try {
      const { loans } = await fetchLoandiskLoans(branchCode, loanStatusId)
      const del = deleteStmt.run(time, branchCode)
      totalDeleted += del.changes
      const tx = db.transaction((items) => {
        for (const loan of items) {
          insertLoandiskLoanRow(db, table, { branch_code: branchCode, time, loan })
        }
      })
      tx(loans)
      totalInserted += loans.length
      process.stdout.write(`  ${branchCode}: ${loans.length} loans\n`)
    } catch (e) {
      console.error(`  ${branchCode}: FAILED — ${e.message}`)
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }
}

console.log(`Done. Deleted ${totalDeleted} hollow rows, inserted ${totalInserted} loans with columns.`)
db.close()

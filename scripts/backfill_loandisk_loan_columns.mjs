/**
 * Backfill flattened Loandisk columns on Open_loans / Past_Missed_repayment from loan_data JSON.
 * Usage: node scripts/backfill_loandisk_loan_columns.mjs [Past_Missed_repayment|Open_loans|both]
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  ensureLoandiskLoanTableColumns,
  loandiskLoanTableColumnSet,
  loandiskLoanToColumnMap,
  LOANDISK_LOAN_DB_COLUMNS,
} from '../lib/loandiskLoanSchema.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'app.db')

const tableArg = (process.argv[2] || 'both').toLowerCase()
const tables =
  tableArg === 'open_loans'
    ? ['Open_loans']
    : tableArg === 'past_missed_repayment'
      ? ['Past_Missed_repayment']
      : ['Past_Missed_repayment', 'Open_loans']

const db = new Database(dbPath)
const setParts = LOANDISK_LOAN_DB_COLUMNS.map((c) => `"${c}" = @${c}`).join(', ')

for (const table of tables) {
  const cols = ensureLoandiskLoanTableColumns(db, table)
  const missing = LOANDISK_LOAN_DB_COLUMNS.filter((c) => !cols.has(c))
  if (missing.length) {
    throw new Error(`${table} is missing columns after migration: ${missing.join(', ')}`)
  }
  const tableCols = loandiskLoanTableColumnSet(db, table)
  if (!tableCols.has('loan_data')) {
    console.log(
      `${table}: loan_data column absent — use scripts/refetch_open_loans_columns.mjs for Open_loans (API refetch).`,
    )
    continue
  }
  const rows = db.prepare(`SELECT id, loan_data FROM "${table}" WHERE loan_data IS NOT NULL AND loan_data != ''`).all()
  if (!rows.length) {
    console.log(`${table}: no loan_data rows to backfill`)
    continue
  }
  const update = db.prepare(`UPDATE "${table}" SET ${setParts} WHERE id = @id`)
  let updated = 0
  const tx = db.transaction((batch) => {
    for (const row of batch) {
      try {
        const loan = JSON.parse(row.loan_data)
        const flat = loandiskLoanToColumnMap(loan)
        update.run({ id: row.id, ...flat })
        updated += 1
      } catch {
        // skip bad JSON
      }
    }
  })
  const chunk = 500
  for (let i = 0; i < rows.length; i += chunk) {
    tx(rows.slice(i, i + chunk))
  }
  console.log(`${table}: backfilled ${updated} / ${rows.length} rows`)
}

db.close()

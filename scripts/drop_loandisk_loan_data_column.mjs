/**
 * Drop loan_data JSON blob from Open_loans / Past_Missed_repayment (columns hold all mapped fields).
 * Usage: node scripts/drop_loandisk_loan_data_column.mjs [Past_Missed_repayment|Open_loans|both]
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { dropLoandiskLoanDataColumn } from '../lib/loandiskLoanSchema.mjs'

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
for (const table of tables) {
  const dropped = dropLoandiskLoanDataColumn(db, table)
  console.log(`${table}: loan_data column ${dropped ? 'removed' : 'already absent'}`)
}
db.exec('VACUUM')
db.close()
console.log('VACUUM complete')

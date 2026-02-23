#!/usr/bin/env node
/**
 * Query boda_repayments table to inspect data and "Submitted On Date" format.
 * Run: node scripts/query_boda_repayments.mjs
 */
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'app.db')
const db = new Database(dbPath, { readonly: true })

console.log('=== boda_repayments table ===\n')

const count = db.prepare('SELECT COUNT(*) as c FROM boda_repayments').get()
console.log('Total rows:', count.c)

if (count.c === 0) {
  console.log('Table is empty.')
  db.close()
  process.exit(0)
}

const sample = db.prepare(`
  SELECT "Submitted On Date" as submitted, "Client Id" as clientId, "Loan Id" as loanId, "Transaction Amount" as amount
  FROM boda_repayments
  LIMIT 20
`).all()

console.log('\nSample rows (Submitted On Date, Client Id, Loan Id, Transaction Amount):')
sample.forEach((r, i) => {
  console.log(`  ${i + 1}. submitted="${r.submitted}" clientId=${r.clientId} loanId=${r.loanId} amount=${r.amount}`)
})

const distinctDates = db.prepare(`
  SELECT "Submitted On Date" as d, COUNT(*) as cnt
  FROM boda_repayments
  GROUP BY "Submitted On Date"
  ORDER BY d DESC
  LIMIT 10
`).all()

console.log('\nRecent distinct "Submitted On Date" values (top 10):')
distinctDates.forEach((r, i) => {
  console.log(`  ${i + 1}. "${r.d}" -> ${r.cnt} rows`)
})

db.close()
console.log('\nDone.')

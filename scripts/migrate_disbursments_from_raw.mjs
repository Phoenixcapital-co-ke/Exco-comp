// One-time migration: expand existing disbursments table and backfill columns from raw JSON
// Usage: node scripts/migrate_disbursments_from_raw.mjs

import Database from 'better-sqlite3'

const COLUMN_MAP = [
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
  ['city', 'City', 'TEXT'],
  ['country', 'Country', 'TEXT'],
  ['address', 'Address', 'TEXT'],
  ['mobile', 'Mobile', 'TEXT'],
  ['email', 'Email', 'TEXT'],
]

function toNumber(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return val
  const cleaned = String(val).replace(/[\s,]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

const db = new Database('data/app.db')
db.pragma('journal_mode = WAL')

// Ensure base columns exist (legacy DBs may have source_id/amount instead)
const existing = db.prepare(`PRAGMA table_info(disbursments);`).all().map(c => c.name)
const ensureCol = (name, type) => { if (!existing.includes(name)) db.exec(`ALTER TABLE disbursments ADD COLUMN ${name} ${type};`) }
ensureCol('loan_id','TEXT')
ensureCol('disbursed','REAL')
// Ensure mapped columns exist
for (const [col, , type] of COLUMN_MAP) ensureCol(col, type)

const rows = db.prepare(`SELECT id, raw FROM disbursments WHERE raw IS NOT NULL AND raw <> ''`).all()
const updCols = ['loan_id','disbursed_date','branch','disbursed', ...COLUMN_MAP.map(([c])=>c)]
// Deduplicate column list
const cols = Array.from(new Set(updCols))
const setClause = cols.map(c => `${c}=@${c}`).join(',')
const updateStmt = db.prepare(`UPDATE disbursments SET ${setClause} WHERE id=@id`)

const tx = db.transaction((batch) => {
  for (const r of batch) {
    let obj
    try { obj = JSON.parse(r.raw) } catch { obj = null }
    if (!obj) continue
    const rec = {
      id: r.id,
      loan_id: String(obj['Loan Id'] ?? ''),
      disbursed_date: String(obj['Disbursed Date'] ?? ''),
      branch: String(obj['Branch'] ?? ''),
      disbursed: toNumber(obj['Disbursed']),
    }
    for (const [col, src, type] of COLUMN_MAP) {
      if (type === 'REAL') rec[col] = toNumber(obj[src])
      else rec[col] = obj[src] == null ? '' : String(obj[src])
    }
    updateStmt.run(rec)
  }
})

tx(rows)
console.log(`Backfilled ${rows.length} rows into structured columns from raw JSON`)
db.close()



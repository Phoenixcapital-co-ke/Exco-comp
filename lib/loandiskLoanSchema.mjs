/**
 * Loandisk advanced_search_loans row → SQLite columns for Open_loans / Past_Missed_repayment.
 * Scalar fields become columns; arrays/objects are JSON-stringified.
 */

/** Top-level keys from Loandisk loan JSON (Past_Missed_repayment / Open_loans). */
export const LOANDISK_LOAN_DB_COLUMNS = [
  'loan_id',
  'loan_product_id',
  'borrower_id',
  'loan_application_id',
  'loan_disbursed_by_id',
  'loan_principal_amount',
  'loan_interest_amount',
  'loan_released_date',
  'loan_interest_method',
  'loan_interest_type',
  'loan_interest_period',
  'loan_interest',
  'loan_duration_period',
  'loan_duration',
  'loan_payment_scheme_id',
  'loan_num_of_repayments',
  'loan_restructure_principal_amount',
  'loan_decimal_places',
  'loan_interest_start_date',
  'loan_fees_pro_rata',
  'loan_do_not_adjust_remaining_pro_rata',
  'loan_first_repayment_pro_rata',
  'loan_first_repayment_date',
  'first_repayment_amount',
  'last_repayment_amount',
  'loan_override_maturity_date',
  'override_each_repayment_amount',
  'loan_interest_each_repayment_pro_rata',
  'loan_interest_schedule',
  'loan_principal_schedule',
  'loan_balloon_repayment_amount',
  'loan_move_first_repayment_date_days',
  'automatic_payments',
  'payment_posting_period',
  'automated_payments_dea_cash_bank_account',
  'after_maturity_extend_loan',
  'after_maturity_percentage_or_fixed',
  'after_maturity_calculate_interest_on',
  'after_maturity_loan_interest',
  'after_maturity_recurring_period_num',
  'after_maturity_recurring_period_payment_scheme_id',
  'after_maturity_num_of_repayments',
  'after_maturity_include_fees',
  'after_maturity_past_maturity_status',
  'after_maturity_apply_to_date',
  'total_amount_due',
  'past_due',
  'amortization',
  'pending_due',
  'pending_due_principal',
  'pending_due_interest',
  'pending_due_fees',
  'pending_due_penalty',
  'days_past_due',
  'principal_balance_amount',
  'interest_balance_amount',
  'fees_balance_amount',
  'penalty_balance_amount',
  'restructured_loan_history',
  'balance_amount',
  'due_date',
  'total_paid',
  'child_status_id',
  'loan_status_id',
  'loan_manual_penalty_amount',
  'loan_override_sys_gen_penalty',
  'dea_cash_bank_account',
  'loan_title',
  'loan_description',
  'custom_fields',
  'borrower_country',
  'borrower_firstname',
  'borrower_lastname',
  'borrower_business_name',
  'borrower_unique_number',
  'borrower_gender',
  'borrower_title',
  'borrower_mobile',
  'borrower_email',
  'borrower_dob',
  'borrower_address',
  'borrower_city',
  'borrower_province',
  'borrower_zipcode',
  'borrower_landline',
  'borrower_working_status',
  'borrower_credit_score',
  'borrowers_photo',
  'borrower_description',
  'borrowers',
  'borrower_access_ids',
  'borrower_photo',
  'custom_field_23167',
  'custom_field_23348',
]

/** SELECT list for snapshot loan queries (no loan_data). */
export const LOANDISK_LOAN_ROW_SELECT = ['branch_code', ...LOANDISK_LOAN_DB_COLUMNS]

const LOANDISK_JSON_COLUMNS = new Set([
  'borrower_access_ids',
  'custom_fields',
  'restructured_loan_history',
  'borrowers',
])

function quoteSqlIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

const insertStmtCache = new Map()

/** Column names already on a snapshot table. */
export function loandiskLoanTableColumnSet(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${quoteSqlIdent(tableName)})`).all()
  return new Set(rows.map((r) => r.name))
}

/** Add missing Loandisk columns to an existing snapshot table (idempotent). */
export function ensureLoandiskLoanTableColumns(db, tableName) {
  const existing = loandiskLoanTableColumnSet(db, tableName)
  let added = false
  for (const col of LOANDISK_LOAN_DB_COLUMNS) {
    if (existing.has(col)) continue
    db.prepare(
      `ALTER TABLE ${quoteSqlIdent(tableName)} ADD COLUMN ${quoteSqlIdent(col)} TEXT`,
    ).run()
    existing.add(col)
    added = true
  }
  if (added) insertStmtCache.delete(tableName)
  const safeIdx = String(tableName).replace(/[^A-Za-z0-9_]/g, '_')
  try {
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_${safeIdx}_time_branch ON ${quoteSqlIdent(tableName)}(time, branch_code)`,
    ).run()
  } catch {}
  if (existing.has('loan_id')) {
    try {
      db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_${safeIdx}_loan_id ON ${quoteSqlIdent(tableName)}(loan_id)`,
      ).run()
    } catch {}
  }
  return existing
}

/** Map Loandisk loan object to flat column values. */
export function loandiskLoanToColumnMap(loan) {
  const out = {}
  if (!loan || typeof loan !== 'object') return out
  for (const col of LOANDISK_LOAN_DB_COLUMNS) {
    if (!(col in loan)) {
      out[col] = null
      continue
    }
    const v = loan[col]
    if (v == null) out[col] = null
    else if (typeof v === 'object') out[col] = JSON.stringify(v)
    else out[col] = String(v)
  }
  return out
}

/** Flat snapshot row for PAR aggregation (column values only). */
export function snapshotRowFromLoan(branch_code, loan) {
  return { branch_code, ...loandiskLoanToColumnMap(loan) }
}

/** Insert one loan row (flattened columns only; no loan_data). */
export function insertLoandiskLoanRow(db, tableName, { branch_code, time, loan }) {
  ensureLoandiskLoanTableColumns(db, tableName)
  const cacheKey = tableName
  if (!insertStmtCache.has(cacheKey)) {
    const cols = ['branch_code', 'time', ...LOANDISK_LOAN_DB_COLUMNS]
    insertStmtCache.set(
      cacheKey,
      db.prepare(
        `INSERT INTO ${quoteSqlIdent(tableName)} (${cols.map((c) => quoteSqlIdent(c)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ),
    )
  }
  const loanObj = typeof loan === 'string' ? JSON.parse(loan) : loan
  const flat = loandiskLoanToColumnMap(loanObj)
  const values = [branch_code, time, ...LOANDISK_LOAN_DB_COLUMNS.map((c) => flat[c] ?? null)]
  insertStmtCache.get(cacheKey).run(...values)
}

function buildLoanFromColumns(row) {
  const loan = {}
  let hasAny = false
  for (const col of LOANDISK_LOAN_DB_COLUMNS) {
    const raw = row[col]
    if (raw == null || raw === '') continue
    hasAny = true
    if (LOANDISK_JSON_COLUMNS.has(col)) {
      try {
        loan[col] = JSON.parse(raw)
      } catch {
        loan[col] = raw
      }
    } else {
      loan[col] = raw
    }
  }
  return hasAny ? loan : null
}

/** SELECT column list that exists on a table (includes loan_data when present). */
export function buildLoandiskLoanSelectSql(db, tableName) {
  ensureLoandiskLoanTableColumns(db, tableName)
  const existing = loandiskLoanTableColumnSet(db, tableName)
  const cols = ['branch_code', ...LOANDISK_LOAN_DB_COLUMNS.filter((c) => existing.has(c))]
  if (existing.has('loan_data')) cols.push('loan_data')
  return cols.map((c) => quoteSqlIdent(c)).join(', ')
}

/** Backfill flattened columns from loan_data JSON (optional snapshot time filter). */
export function backfillLoandiskLoanTableFromJson(db, tableName, { time } = {}) {
  const existing = loandiskLoanTableColumnSet(db, tableName)
  if (!existing.has('loan_data')) return 0
  ensureLoandiskLoanTableColumns(db, tableName)
  const setParts = LOANDISK_LOAN_DB_COLUMNS.map((c) => `${quoteSqlIdent(c)} = @${c}`).join(', ')
  const rows = time
    ? db
        .prepare(
          `SELECT id, loan_data FROM ${quoteSqlIdent(tableName)} WHERE loan_data IS NOT NULL AND loan_data != '' AND time = ?`,
        )
        .all(time)
    : db
        .prepare(
          `SELECT id, loan_data FROM ${quoteSqlIdent(tableName)} WHERE loan_data IS NOT NULL AND loan_data != ''`,
        )
        .all()
  if (!rows.length) return 0
  const update = db.prepare(`UPDATE ${quoteSqlIdent(tableName)} SET ${setParts} WHERE id = @id`)
  let updated = 0
  const tx = db.transaction((batch) => {
    for (const row of batch) {
      try {
        const loan = JSON.parse(row.loan_data)
        update.run({ id: row.id, ...loandiskLoanToColumnMap(loan) })
        updated += 1
      } catch {
        // skip bad JSON
      }
    }
  })
  const chunk = 500
  for (let i = 0; i < rows.length; i += chunk) tx(rows.slice(i, i + chunk))
  return updated
}

/** Parse stored row from flattened columns; legacy loan_data JSON only if columns empty. */
export function parseLoandiskLoanRecord(row) {
  if (!row) return null
  const fromCols = buildLoanFromColumns(row)
  if (fromCols) {
    if (fromCols.days_past_due == null && row.loan_data) {
      try {
        const fromJson = JSON.parse(row.loan_data)
        if (fromJson?.days_past_due != null) fromCols.days_past_due = fromJson.days_past_due
      } catch {
        // ignore
      }
    }
    return fromCols
  }
  if (row.loan_data) {
    try {
      return JSON.parse(row.loan_data)
    } catch {
      return null
    }
  }
  return null
}

/** Remove redundant loan_data blob column (reclaims disk space). */
export function dropLoandiskLoanDataColumn(db, tableName) {
  const existing = loandiskLoanTableColumnSet(db, tableName)
  if (!existing.has('loan_data')) return false
  try {
    db.prepare(`ALTER TABLE ${quoteSqlIdent(tableName)} DROP COLUMN loan_data`).run()
  } catch {
    const keep = ['id', 'branch_code', 'time', ...LOANDISK_LOAN_DB_COLUMNS].filter((c) => existing.has(c))
    const tmp = `${tableName}__no_loan_data`
    const colList = keep.map((c) => quoteSqlIdent(c)).join(', ')
    db.exec('BEGIN')
    try {
      db.prepare(
        `CREATE TABLE ${quoteSqlIdent(tmp)} AS SELECT ${colList} FROM ${quoteSqlIdent(tableName)}`,
      ).run()
      db.prepare(`DROP TABLE ${quoteSqlIdent(tableName)}`).run()
      db.prepare(`ALTER TABLE ${quoteSqlIdent(tmp)} RENAME TO ${quoteSqlIdent(tableName)}`).run()
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  insertStmtCache.delete(tableName)
  return true
}

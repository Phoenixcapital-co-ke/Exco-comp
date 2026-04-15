import Database from 'better-sqlite3'

const ym = process.argv[2] || ''
if (!/^\d{4}-\d{2}$/.test(ym)) {
  console.error('Usage: node scripts/query_zidisha_collected_ym.mjs YYYY-MM')
  process.exit(1)
}

const [year, month] = ym.split('-')
const db = new Database('data/app.db', { readonly: true })

const products = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']
const inClause = products.map(() => '?').join(', ')

const maturedMonthWhere = `(
  ("Expected Matured On Date" LIKE ?) OR
  ("Expected Matured On Date" LIKE ?) OR
  (substr("Expected Matured On Date", 7, 4) = ? AND substr("Expected Matured On Date", 4, 2) = ?)
)`

const sql = `
  SELECT
    TRIM("Branch Name") AS branch,
    SUM(CAST("Total Repayment Derived" AS REAL)) AS collected
  FROM zidisha_data
  WHERE TRIM("Branch Name") IS NOT NULL
    AND TRIM("Branch Name") != ''
    AND LOWER(TRIM("Product Name")) IN (${inClause})
    AND ${maturedMonthWhere}
    AND "Total Repayment Derived" IS NOT NULL
  GROUP BY TRIM("Branch Name")
  ORDER BY collected DESC
`

const params = [
  ...products.map((p) => p.toLowerCase()),
  `${year}-${month}-%`,
  `%/${month}/${year}%`,
  year,
  month
]

const rows = db.prepare(sql).all(...params).map((r) => ({
  branch: String(r.branch || '').trim(),
  collected: Number(r.collected || 0)
}))

const total = rows.reduce((s, r) => s + (Number(r.collected) || 0), 0)

console.log(
  JSON.stringify(
    {
      month: ym,
      total,
      rows
    },
    null,
    2
  )
)


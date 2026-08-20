/**
 * August disbursements: find sales_person name variants (case/spacing duplicates).
 * Run from project root: node scripts/list_sales_person_duplicates_aug.cjs
 * Optional: node scripts/list_sales_person_duplicates_aug.cjs 2026 8
 */
const Database = require('better-sqlite3')

const year = Number(process.argv[2] || 2026)
const month = Number(process.argv[3] || 8)
const monthPad = String(month).padStart(2, '0')

const db = new Database('data/app.db', { readonly: true })

function normalizeName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const rows = db
  .prepare(
    `
    SELECT
      loan_id,
      TRIM(name) AS client_name,
      COALESCE(NULLIF(TRIM(country), ''), 'Unknown') AS country,
      TRIM(sales_person) AS sales_person,
      disbursed_date,
      COALESCE(CAST(disbursed AS REAL), 0) AS disbursed,
      TRIM(product) AS product,
      TRIM(branch) AS branch
    FROM Logbook_Disbursement
    WHERE disbursed_date LIKE '%/${monthPad}/${year}'
       OR disbursed_date LIKE '${year}-${monthPad}-%'
    ORDER BY country, sales_person, disbursed_date
  `,
  )
  .all()

const byKey = new Map()
for (const r of rows) {
  const raw = r.sales_person || ''
  const key = normalizeName(raw) || '(blank)'
  if (!byKey.has(key)) byKey.set(key, { variants: new Map(), loans: [] })
  const g = byKey.get(key)
  const variant = raw || '(blank)'
  g.variants.set(variant, (g.variants.get(variant) || 0) + 1)
  g.loans.push(r)
}

const duplicates = []
for (const [key, g] of byKey) {
  if (g.variants.size > 1) {
    duplicates.push({ key, variants: g.variants, loans: g.loans })
  }
}

console.log(`\n=== August ${year} disbursements ===`)
console.log(`Total loans: ${rows.length}`)
console.log(`Distinct sales_person (raw): ${new Set(rows.map((r) => r.sales_person || '')).size}`)
console.log(`Distinct sales_person (normalized): ${byKey.size}`)
console.log(`Groups with multiple spellings: ${duplicates.length}\n`)

if (duplicates.length === 0) {
  console.log('No case/spacing duplicates found.')
} else {
  console.log('--- CLEAN ON LOANDISK: merge these to ONE spelling per person ---\n')
  for (const d of duplicates.sort((a, b) => b.loans.length - a.loans.length)) {
    const suggested =
      [...d.variants.keys()]
        .filter((v) => v !== '(blank)')
        .sort((a, b) => {
          const score = (s) => {
            if (/^[A-Z\s]+$/.test(s)) return 0
            if (/^[A-Z]/.test(s) && !/^[A-Z\s]+$/.test(s)) return 2
            return 1
          }
          return score(b) - score(a) || b.length - a.length
        })[0] || d.key

    console.log(`Normalized: "${d.key}"`)
    console.log(`  Suggested canonical name: "${suggested}"`)
    for (const [variant, count] of [...d.variants.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    "${variant}" → ${count} loan(s)`)
    }
    console.log('  Loans to check in Loandisk:')
    for (const l of d.loans) {
      console.log(
        `    loan_id=${l.loan_id} | ${l.country} | "${l.sales_person}" | ${l.disbursed_date} | ${l.disbursed} | ${l.client_name}`,
      )
    }
    console.log('')
  }
}

// Full distinct list for Uganda August (for Loandisk cleanup sheet)
console.log('\n--- All Uganda August sales_person (raw) ---')
const uganda = rows.filter((r) => r.country === 'Uganda')
const ugVariants = new Map()
for (const r of uganda) {
  const v = r.sales_person || '(blank)'
  ugVariants.set(v, (ugVariants.get(v) || 0) + 1)
}
console.table(
  [...ugVariants.entries()]
    .map(([sales_person, loans]) => ({ sales_person, loans }))
    .sort((a, b) => b.loans - a.loans),
)

console.log('\n--- All Kenya August sales_person (raw) ---')
const kenya = rows.filter((r) => r.country === 'Kenya')
const keVariants = new Map()
for (const r of kenya) {
  const v = r.sales_person || '(blank)'
  keVariants.set(v, (keVariants.get(v) || 0) + 1)
}
console.table(
  [...keVariants.entries()]
    .map(([sales_person, loans]) => ({ sales_person, loans }))
    .sort((a, b) => b.loans - a.loans),
)

db.close()

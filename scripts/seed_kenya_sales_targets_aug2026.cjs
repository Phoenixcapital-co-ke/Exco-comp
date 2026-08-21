/**
 * Load Kenya Sales Person monthly targets from headcount sheet.
 * Default: August 2026. Names use Loandisk-cleaned spellings.
 *
 * Usage (from C:\Apps\exco):
 *   node scripts/seed_kenya_sales_targets_aug2026.cjs
 *   node scripts/seed_kenya_sales_targets_aug2026.cjs 2026 8
 */
const Database = require('better-sqlite3')

const year = Number(process.argv[2] || 2026)
const month = Number(process.argv[3] || 8)
const country = 'Kenya'

// Headcount TARGET MONTHLY → canonical Sales Person spelling
const TARGETS = [
  { name: 'MOUREEN NYONGESA', target: 1000000 },
  { name: 'VICTOR KEDOGO', target: 3000000 },
  { name: 'Mary Muthoni', target: 1000000 },
  { name: 'linet Nyanya', target: 3000000 },
  { name: 'TECKLA OWINO', target: 1000000 },
  { name: 'EDWARD MAGERO', target: 3000000 },
  { name: 'LAVYNE ANYANGO', target: 1000000 },
  { name: 'MAGDALINE AMOLO', target: 3000000 },
  { name: 'JARED OMAE', target: 3000000 },
  { name: 'Samson Namale', target: 3000000 },
  { name: 'NORAH ANGOTE', target: 3000000 },
  { name: 'anne nekesa', target: 3000000 },
  { name: 'SILAS WANJALA', target: 3000000 },
  { name: 'Allan Kimutai', target: 3000000 },
  { name: 'Susan Kasoo', target: 2000000 },
  { name: 'AMINA MUMBUA', target: 1000000 },
  { name: 'Richard Litunya', target: 3000000 },
  { name: 'Linet Kibuga', target: 2000000 },
  { name: 'LUCY AKINYI', target: 1000000 },
  { name: 'MARTIN KURUI', target: 3000000 },
  { name: 'VIOLET MORAA', target: 3000000 },
  { name: 'LEONIDA GESARE', target: 3000000 },
  { name: 'KELLY ONYANGO', target: 1500000 },
  { name: 'Vincent Odede', target: 3000000 },
  { name: 'Judy Wangu', target: 3000000 },
  { name: 'QUINTER ATIENO', target: 1000000 },
  { name: 'Dennis Ndegwa', target: 2000000 },
  { name: 'Eric Antony Munene', target: 2000000 },
  { name: 'Paul Wanjala', target: 2000000 },
  { name: 'Pius Muroki', target: 1000000 },
  { name: 'Daniel Omondi', target: 2000000 },
  { name: 'BRENDA KAWIRA', target: 3000000 },
  { name: 'Vivian Kirui', target: 2000000 },
  { name: 'Stephen Muthui', target: 3000000 },
  { name: 'Kenneth Ndiba', target: 2000000 },
]

const db = new Database('data/app.db')
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Sales_Person_Targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sales_person TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Kenya',
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    disbursement_target REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sales_person, country, month, year)
  );
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS Logbook_Sales_Persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Kenya',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, country)
  );
`)

const upsertPerson = db.prepare(`
  INSERT INTO Logbook_Sales_Persons (name, country, active)
  VALUES (?, ?, 1)
  ON CONFLICT(name, country) DO UPDATE SET
    active = 1,
    updated_at = CURRENT_TIMESTAMP
`)

const upsertTarget = db.prepare(`
  INSERT INTO Logbook_Sales_Person_Targets
    (sales_person, country, month, year, disbursement_target, active, updated_at)
  VALUES
    (@sales_person, @country, @month, @year, @disbursement_target, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(sales_person, country, month, year) DO UPDATE SET
    disbursement_target = excluded.disbursement_target,
    active = 1,
    updated_at = CURRENT_TIMESTAMP
`)

const tx = db.transaction((rows) => {
  db.prepare(
    `UPDATE Logbook_Sales_Persons SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE country = ?`,
  ).run(country)

  let total = 0
  for (const r of rows) {
    upsertPerson.run(r.name, country)
    upsertTarget.run({
      sales_person: r.name,
      country,
      month,
      year,
      disbursement_target: r.target,
    })
    total += r.target
  }
  return total
})

const total = tx(TARGETS)
console.log(`Saved ${TARGETS.length} Kenya sales-person targets for ${month}/${year}`)
console.log(`Total monthly target: ${total.toLocaleString('en-KE')}`)
if (TARGETS.length !== 35 || total !== 79500000) {
  console.warn('WARNING: expected 35 staff and 79,500,000 total — check the list')
}
console.table(TARGETS.map((t) => ({ sales_person: t.name, target: t.target })))

db.close()

import Database from 'better-sqlite3'
import { existsSync } from 'fs'

const dbPath = process.argv[2] || 'data/app.db'
if (!existsSync(dbPath)) {
  console.error('DB not found:', dbPath)
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

function tableExists(name) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)
}

function section(title) {
  console.log('\n' + '='.repeat(60))
  console.log(title)
  console.log('='.repeat(60))
}

function normalizeLenient(phone) {
  let p = String(phone || '').trim()
  if (!p) return ''
  p = p.replace(/\s+/g, '').replace(/^\+/, '')
  if (p.startsWith('254') && p.length >= 12) return p
  if (p.startsWith('0') && p.length >= 10) return `254${p.slice(1)}`
  if (/^7\d{8}$/.test(p)) return `254${p}`
  return p
}

function isValidKenya254(p) {
  return /^2547\d{8}$/.test(String(p || ''))
}

for (const table of ['TopUp_SMS_Log', 'Collection_Arrears_SMS_Log']) {
  section(table)
  if (!tableExists(table)) {
    console.log('(table missing)')
    continue
  }

  const byDay = db
    .prepare(
      `SELECT send_date, slot, status, COUNT(*) AS n
       FROM ${table}
       GROUP BY send_date, slot, status
       ORDER BY send_date DESC, slot, status
       LIMIT 50`,
    )
    .all()
  console.log('By send_date / slot / status (recent):')
  for (const r of byDay) console.log(`  ${r.send_date} ${r.slot} ${r.status}: ${r.n}`)

  const dailySent = db
    .prepare(
      `SELECT send_date, COUNT(*) AS sent
       FROM ${table} WHERE status = 'sent'
       GROUP BY send_date ORDER BY send_date DESC LIMIT 21`,
    )
    .all()
  console.log('\nDaily sent:')
  for (const r of dailySent) console.log(`  ${r.send_date}: ${r.sent}`)

  const last7 = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM ${table}
       WHERE send_date >= date('now', '-7 days')
       GROUP BY status ORDER BY n DESC`,
    )
    .all()
  console.log('\nLast 7 days by status:', last7)

  const badPhones = db
    .prepare(
      `SELECT phone, status, COUNT(*) AS n FROM ${table}
       WHERE send_date >= date('now', '-14 days') AND status = 'sent'
       GROUP BY phone, status`,
    )
    .all()
  let invalidSent = 0
  let lenientWouldPass = 0
  const samples = []
  for (const r of badPhones) {
    const norm = normalizeLenient(r.phone)
    const strict = isValidKenya254(norm)
    if (!strict) {
      invalidSent += r.n
      if (samples.length < 10) samples.push({ phone: r.phone, norm, n: r.n })
    } else if (norm !== r.phone) {
      lenientWouldPass += r.n
    }
  }
  console.log(`\nSent (14d) with invalid 2547xxxxxxxx after normalize: ${invalidSent}`)
  if (samples.length) console.log('  samples:', samples)

  const skipped = db
    .prepare(
      `SELECT response, COUNT(*) AS n FROM ${table}
       WHERE send_date >= date('now', '-14 days') AND status = 'skipped'
       GROUP BY response ORDER BY n DESC LIMIT 10`,
    )
    .all()
  if (skipped.length) console.log('\nSkipped reasons (14d):', skipped)

  const dupSameDay = db
    .prepare(
      `SELECT send_date, client_id, COUNT(*) AS n FROM ${table}
       WHERE status = 'sent' AND send_date >= date('now', '-14 days')
       GROUP BY send_date, client_id HAVING n > 1
       ORDER BY n DESC LIMIT 10`,
    )
    .all()
  if (dupSameDay.length) console.log('\nDuplicate client same day (should not happen):', dupSameDay)
}

section('Top-up recipient pool (credit_scores)')
for (const t of ['credit_scores_boda', 'credit_scores_zidisha']) {
  if (!tableExists(t)) {
    console.log(`${t}: missing`)
    continue
  }
  const gs = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE band IN ('Gold','Silver')`).get().n
  const noPhone = db
    .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE band IN ('Gold','Silver') AND (phone IS NULL OR TRIM(phone)='')`)
    .get().n
  const invalid = db.prepare(`SELECT phone FROM ${t} WHERE band IN ('Gold','Silver')`).all()
  let bad = 0
  for (const r of invalid) {
    if (!isValidKenya254(normalizeLenient(r.phone))) bad++
  }
  console.log(`${t}: Gold/Silver=${gs}, no_phone=${noPhone}, invalid_after_lenient_norm=${bad}`)
}

section('Arrears eligible (schedule query, no send)')
if (tableExists('boda_Schedule')) {
  const minDaysProducts = ['advans emergency loan', 'salary advans', 'unsecured loans']
  const ph = minDaysProducts.map(() => '?').join(', ')
  const todayKey = new Date().toISOString().slice(0, 10)
  try {
    const rows = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT TRIM("Client Id") AS cid
           FROM boda_Schedule
           WHERE date("Due Date") < date(?)
             AND (
               LOWER(COALESCE(TRIM("Product Name"), '')) NOT IN (${ph})
               OR date("Due Date") < date(?, '-15 day')
             )
           GROUP BY TRIM("Client Id"), TRIM("Client Name"), TRIM("Phone Number")
           HAVING SUM(COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0)) > 0
         )`,
      )
      .get(todayKey, ...minDaysProducts, todayKey)
    console.log('Eligible arrears clients today:', rows.n)
    const byProduct = db
      .prepare(
        `SELECT LOWER(TRIM("Product Name")) AS product, COUNT(DISTINCT TRIM("Client Id")) AS clients
         FROM boda_Schedule
         WHERE date("Due Date") < date(?)
           AND (
             LOWER(COALESCE(TRIM("Product Name"), '')) NOT IN (${ph})
             OR date("Due Date") < date(?, '-15 day')
           )
         GROUP BY LOWER(TRIM("Product Name"))
         ORDER BY clients DESC LIMIT 15`,
      )
      .all(todayKey, ...minDaysProducts, todayKey)
    console.log('By product (distinct clients overdue):')
    for (const r of byProduct) console.log(`  ${r.product || '(blank)'}: ${r.clients}`)
  } catch (e) {
    console.log('Query error:', e.message)
  }
}

db.close()

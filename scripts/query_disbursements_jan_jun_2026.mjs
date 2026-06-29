#!/usr/bin/env node
/**
 * Monthly disbursements Jan–Jun 2026 for Logbook Kenya, Zidisha, and Boda
 * (matches dashboard chart logic).
 *
 * Usage: node scripts/query_disbursements_jan_jun_2026.mjs
 */
import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, '..', 'data', 'app.db')
const db = new Database(dbPath, { readonly: true })

const ZIDISHA_PRODUCTS = [
  'Zidisha Kifaru',
  'Zidisha Nyati',
  'Zidisha Simba',
  'Zidisha Tembo',
  'Zidisha Express',
]

function parseZidishaMonthYear(dateStr) {
  const s = String(dateStr || '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-/)
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) }
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmy) return { year: Number(dmy[3]), month: Number(dmy[2]) }
  if (s.length >= 10 && s[4] === '/' && s[7] === '/') {
    return { year: Number(s.slice(6, 10)), month: Number(s.slice(3, 5)) }
  }
  return null
}

function parseLogbookDMY(dateStr) {
  const parts = String(dateStr || '').trim().split('/')
  if (parts.length !== 3) return null
  const dd = Number(parts[0])
  const mm = Number(parts[1])
  const yyyy = Number(parts[2])
  if (!dd || !mm || !yyyy) return null
  return { year: yyyy, month: mm }
}

const year = 2026
const monthFrom = 1
const monthTo = 6
const monthLabels = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const kenyaBranches = new Set(
  db
    .prepare(`SELECT code FROM Logbook_Branches WHERE country = 'Kenya' AND active = 1`)
    .all()
    .map((r) => String(r.code).trim()),
)

const totals = {
  logbook_kenya: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0])),
  zidisha: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0])),
  boda: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0])),
}

for (const r of db.prepare('SELECT branch, disbursed_date, disbursed FROM Logbook_Disbursement').all()) {
  const code = String(r.branch || '').trim()
  if (!kenyaBranches.has(code)) continue
  const d = parseLogbookDMY(r.disbursed_date)
  if (!d || d.year !== year || d.month < monthFrom || d.month > monthTo) continue
  totals.logbook_kenya[d.month] += Number(r.disbursed) || 0
}

const zidishaRows = db.prepare('SELECT * FROM zidisha_data').all()
for (const r of zidishaRows) {
  const product = String(r['Product Name'] || r.product_name || '').trim()
  const branch = String(r['Branch Name'] || r.branch_name || '').trim()
  const clientId = String(r['Client Id'] || r.client_id || '').trim()
  const d = parseZidishaMonthYear(r['Disbursed On Date'] || r.disbursed_on_date)
  if (!d || d.year !== year || d.month < monthFrom || d.month > monthTo) continue
  const amt = Number(r['Principal Amount'] || r.principal_amount) || 0

  if (product === 'Zidisha Boda' && clientId !== '3926') {
    totals.boda[d.month] += amt
  } else if (
    ZIDISHA_PRODUCTS.includes(product) &&
    branch.toLowerCase() !== 'advans branch'
  ) {
    totals.zidisha[d.month] += amt
  }
}

console.log('\nDisbursements by product — Jan to Jun 2026 (KES)\n')
console.log('Month\tLogbook Kenya\tZidisha\tBoda\tCombined')
let gLb = 0
let gZd = 0
let gBd = 0
for (let m = monthFrom; m <= monthTo; m++) {
  const lb = totals.logbook_kenya[m]
  const zd = totals.zidisha[m]
  const bd = totals.boda[m]
  gLb += lb
  gZd += zd
  gBd += bd
  console.log(
    `${monthLabels[m]}\t${lb.toLocaleString('en-KE')}\t${zd.toLocaleString('en-KE')}\t${bd.toLocaleString('en-KE')}\t${(lb + zd + bd).toLocaleString('en-KE')}`,
  )
}
console.log(
  `TOTAL\t${gLb.toLocaleString('en-KE')}\t${gZd.toLocaleString('en-KE')}\t${gBd.toLocaleString('en-KE')}\t${(gLb + gZd + gBd).toLocaleString('en-KE')}`,
)
console.log('\nSources: Logbook_Disbursement (Kenya branches) | zidisha_data (core products) | zidisha_data (Zidisha Boda)\n')

db.close()

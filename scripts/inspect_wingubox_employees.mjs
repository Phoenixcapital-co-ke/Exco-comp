import Database from 'better-sqlite3'

const db = new Database('data/app.db', { readonly: true })

const cols = db.prepare(`PRAGMA table_info('wingubox_employees')`).all()
const colNames = cols.map((c) => c.name)

const get1 = (sql, params = []) => db.prepare(sql).get(...params)

const out = {
  columns: colNames,
  total: get1('SELECT COUNT(*) AS c FROM wingubox_employees')?.c ?? 0,
  active1: get1(`SELECT COUNT(*) AS c FROM wingubox_employees WHERE active='1' OR active=1`)?.c ?? 0,
}

if (colNames.includes('seen_in_last_sync')) {
  out.seen1 = get1(`SELECT COUNT(*) AS c FROM wingubox_employees WHERE seen_in_last_sync=1`)?.c ?? 0
  out.seen0 = get1(`SELECT COUNT(*) AS c FROM wingubox_employees WHERE seen_in_last_sync=0`)?.c ?? 0
}
if (colNames.includes('last_seen_at')) {
  out.lastSeenMin = get1(`SELECT MIN(last_seen_at) AS v FROM wingubox_employees WHERE last_seen_at IS NOT NULL`)?.v ?? null
  out.lastSeenMax = get1(`SELECT MAX(last_seen_at) AS v FROM wingubox_employees WHERE last_seen_at IS NOT NULL`)?.v ?? null
}

// Look for duplicate-like indicators
out.nullEmployeeId = get1(`SELECT COUNT(*) AS c FROM wingubox_employees WHERE employee_id IS NULL OR TRIM(employee_id)=''`)?.c ?? 0

console.log(JSON.stringify(out, null, 2))


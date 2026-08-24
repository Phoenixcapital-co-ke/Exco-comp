/**
 * Inspect / reclaim SQLite space (PAR loan snapshots are the usual bulk).
 *
 *   node scripts/sqlite_storage.mjs
 *   node scripts/sqlite_storage.mjs --prune
 *   node scripts/sqlite_storage.mjs --prune --apply
 *   node scripts/sqlite_storage.mjs --vacuum
 *
 * Stop PM2 before --vacuum (needs exclusive lock). --apply deletes rows; VACUUM is separate.
 *
 * Keeps:
 *   - last KEEP_FULL_DAYS of every 30-min snapshot (default 7)
 *   - then through KEEP_DAILY_DAYS, only ~03:00 and ~20:00 EAT snapshots (default 90)
 *   - PAR aggregate rows are never deleted
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'app.db')

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const PRUNE = args.has('--prune')
const VACUUM = args.has('--vacuum')
const CHECKPOINT = args.has('--checkpoint') || VACUUM || (PRUNE && APPLY)

const KEEP_FULL_DAYS = Number(process.env.KEEP_FULL_DAYS || 7)
const KEEP_DAILY_DAYS = Number(process.env.KEEP_DAILY_DAYS || 90)

function fmtBytes(n) {
  const x = Number(n) || 0
  if (x >= 1e12) return `${(x / 1e12).toFixed(2)} TB`
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)} GB`
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)} MB`
  if (x >= 1e3) return `${(x / 1e3).toFixed(0)} KB`
  return `${x} B`
}

function fileSize(p) {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

function nairobiHour(date) {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit',
    hour12: false,
  }).format(date)
  return Number(h)
}

function nairobiDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function distToHour(hour, target) {
  return Math.min(Math.abs(hour - target), 24 - Math.abs(hour - target))
}

function report(db) {
  console.log('DB file:', dbPath)
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix
    const s = fileSize(p)
    if (s || suffix === '') console.log(`  ${path.basename(p)}: ${fmtBytes(s)}`)
  }

  try {
    const rows = db
      .prepare(
        `SELECT name, SUM(pgsize) AS bytes, SUM(ncell) AS cells
         FROM dbstat
         GROUP BY name
         ORDER BY bytes DESC
         LIMIT 25`,
      )
      .all()
    console.log('\nTop tables/indexes (dbstat):')
    for (const r of rows) {
      console.log(`  ${fmtBytes(r.bytes).padStart(10)}  ${r.name}  (~${Number(r.cells || 0).toLocaleString()} cells)`)
    }
  } catch {
    console.log('\n(dbstat unavailable — using row counts)')
  }

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name)

  console.log('\nRow counts:')
  for (const name of tables) {
    try {
      const c = db.prepare(`SELECT COUNT(*) AS c FROM "${name.replaceAll('"', '""')}"`).get().c
      if (c > 0) console.log(`  ${String(c).padStart(12)}  ${name}`)
    } catch {
      /* skip */
    }
  }

  const hasOpen = tables.includes('Open_loans')
  if (hasOpen) {
    const snaps = db.prepare(`SELECT COUNT(DISTINCT time) AS c FROM Open_loans`).get().c
    const minMax = db.prepare(`SELECT MIN(time) AS mn, MAX(time) AS mx FROM Open_loans`).get()
    console.log(`\nOpen_loans snapshots: ${snaps}  from ${minMax.mn}  to ${minMax.mx}`)
  }

  const loanDataOpen = db.prepare(`PRAGMA table_info(Open_loans)`).all().some((c) => c.name === 'loan_data')
  const loanDataPast = db.prepare(`PRAGMA table_info(Past_Missed_repayment)`).all().some((c) => c.name === 'loan_data')
  if (loanDataOpen || loanDataPast) {
    console.log(
      '\nWARNING: loan_data JSON column still present. After flattened columns are populated, run:',
    )
    console.log('  pm2 stop exco')
    console.log('  node scripts/drop_loandisk_loan_data_column.mjs')
    console.log('  pm2 start exco')
  }
}

function timesToDelete(db) {
  const rows = db.prepare(`SELECT DISTINCT time FROM Open_loans`).all()
  const now = Date.now()
  const fullMs = KEEP_FULL_DAYS * 864e5
  const dailyMs = KEEP_DAILY_DAYS * 864e5

  const parsed = []
  for (const r of rows) {
    const time = String(r.time || '').trim()
    const ms = new Date(time).getTime()
    if (!time || !Number.isFinite(ms)) continue
    parsed.push({ time, ms, age: now - ms, hour: nairobiHour(new Date(ms)), day: nairobiDateKey(new Date(ms)) })
  }

  const keep = new Set()
  const byDay = new Map()

  for (const p of parsed) {
    if (p.age <= fullMs) {
      keep.add(p.time)
      continue
    }
    if (p.age > dailyMs) continue
    if (!byDay.has(p.day)) byDay.set(p.day, [])
    byDay.get(p.day).push(p)
  }

  for (const list of byDay.values()) {
    let best3 = null
    let best20 = null
    for (const p of list) {
      if (!best3 || distToHour(p.hour, 3) < distToHour(best3.hour, 3)) best3 = p
      if (!best20 || distToHour(p.hour, 20) < distToHour(best20.hour, 20)) best20 = p
    }
    if (best3) keep.add(best3.time)
    if (best20) keep.add(best20.time)
  }

  return parsed.filter((p) => !keep.has(p.time)).map((p) => p.time)
}

function prune(db, times) {
  console.log(
    `\nPrune plan: drop ${times.length} snapshot times from Open_loans + Past_Missed_repayment`,
  )
  console.log(`  keep all snapshots < ${KEEP_FULL_DAYS}d, then SOD/EOD only through ${KEEP_DAILY_DAYS}d`)
  if (!times.length) {
    console.log('  nothing to delete')
    return
  }
  if (!APPLY) {
    console.log('  dry-run (pass --apply to delete)')
    console.log('  sample times:', times.slice(0, 8).join(', '))
    return
  }

  const delOpen = db.prepare(`DELETE FROM Open_loans WHERE time = ?`)
  const delPast = db.prepare(`DELETE FROM Past_Missed_repayment WHERE time = ?`)
  const tx = db.transaction((list) => {
    let n = 0
    for (const t of list) {
      n += delOpen.run(t).changes
      n += delPast.run(t).changes
    }
    return n
  })
  const deleted = tx(times)
  console.log(`  deleted ${deleted.toLocaleString()} rows`)
}

if (!fs.existsSync(dbPath)) {
  console.error('Missing', dbPath)
  process.exit(1)
}

const db = new Database(dbPath)
try {
  report(db)
  if (PRUNE) prune(db, timesToDelete(db))
  if (CHECKPOINT) {
    const r = db.pragma('wal_checkpoint(TRUNCATE)')
    console.log('\nWAL checkpoint:', r)
  }
  if (VACUUM) {
    console.log('\nVACUUM (this can take a long time and needs the app stopped)...')
    db.exec('VACUUM')
    console.log('VACUUM done. File now', fmtBytes(fileSize(dbPath)))
  }
} finally {
  db.close()
}

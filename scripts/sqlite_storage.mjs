
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

const KEEP_FULL_DAYS = Number(process.env.KEEP_FULL_DAYS || 2)
// 0 or negative = keep SOD (~03:00) + EOD (~20:00) forever after the full window
const KEEP_DAILY_DAYS = Number(process.env.KEEP_DAILY_DAYS ?? 0)

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

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name)

  const par = tables.includes('PAR')
    ? db.prepare(`SELECT COUNT(*) AS c, MIN(time) AS mn, MAX(time) AS mx FROM PAR`).get()
    : null
  if (par) {
    console.log(`\nPAR snapshots (small totals table): ${par.c}  from ${par.mn}  to ${par.mx}`)
    console.log(`  (~${par.c} half-hour captures. Loan rows live in Open_loans / Past_Missed_repayment.)`)
  }

  for (const name of ['Open_loans', 'Past_Missed_repayment']) {
    if (!tables.includes(name)) continue
    const row = db.prepare(`SELECT MAX(id) AS mx, MIN(id) AS mn FROM "${name}"`).get()
    const approx = (Number(row.mx) || 0) - (Number(row.mn) || 0) + (row.mx ? 1 : 0)
    console.log(`${name}: id ${row.mn} → ${row.mx}  (~${approx.toLocaleString()} rows if ids are dense)`)
  }

  if (args.has('--sizes')) {
    console.log('\nScanning dbstat (slow on a huge file)...')
    try {
      const rows = db
        .prepare(
          `SELECT name, SUM(pgsize) AS bytes, SUM(ncell) AS cells
           FROM dbstat
           GROUP BY name
           ORDER BY bytes DESC
           LIMIT 15`,
        )
        .all()
      console.log('Top tables/indexes (dbstat):')
      for (const r of rows) {
        console.log(`  ${fmtBytes(r.bytes).padStart(10)}  ${r.name}`)
      }
    } catch (e) {
      console.log('dbstat failed:', e.message)
    }
  } else {
    console.log('\nSkip full table scan (pass --sizes only if you can wait).')
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
  // PAR is tiny (one row per snapshot). Do not DISTINCT-scan Open_loans.
  const rows = db.prepare(`SELECT time FROM PAR`).all()
  const now = Date.now()
  const fullMs = KEEP_FULL_DAYS * 864e5
  const dailyCap = KEEP_DAILY_DAYS > 0
  const dailyMs = dailyCap ? KEEP_DAILY_DAYS * 864e5 : Infinity

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
    if (dailyCap && p.age > dailyMs) continue
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
  console.log(
    `  keep all snapshots < ${KEEP_FULL_DAYS}d, then SOD/EOD only` +
      (KEEP_DAILY_DAYS > 0 ? ` through ${KEEP_DAILY_DAYS}d` : ' (no age cap)'),
  )
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

const needWrite = PRUNE || VACUUM || CHECKPOINT
const db = new Database(dbPath, { readonly: !needWrite, fileMustExist: true })
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

/**
 * Inspect / reclaim SQLite space (PAR loan snapshots are the usual bulk).
 *
 *   node scripts/sqlite_storage.mjs
 *   node scripts/sqlite_storage.mjs --prune
 *   node scripts/sqlite_storage.mjs --prune --apply --online   # app can stay UP (slow, gentle)
 *   node scripts/sqlite_storage.mjs --prune --apply            # FAST rebuild — stop app first
 *   node scripts/sqlite_storage.mjs --vacuum                   # stop app first; needs free disk
 *
 * Keeps:
 *   - last KEEP_FULL_DAYS of every 30-min snapshot (default 2)
 *   - older: only ~03:00 and ~20:00 EAT (KEEP_DAILY_DAYS=0 = forever)
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { setTimeout as sleep } from 'timers/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'app.db')

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const PRUNE = args.has('--prune')
const ONLINE = args.has('--online')
const VACUUM = args.has('--vacuum')
const CHECKPOINT = args.has('--checkpoint') || VACUUM || (PRUNE && APPLY && !ONLINE)

const KEEP_FULL_DAYS = Number(process.env.KEEP_FULL_DAYS || 2)
// 0 or negative = keep SOD (~03:00) + EOD (~20:00) forever after the full window
const KEEP_DAILY_DAYS = Number(process.env.KEEP_DAILY_DAYS ?? 0)
const BATCH_SIZE = Math.max(1, Number(process.env.PRUNE_BATCH_SIZE || 1) || 1)
const SLEEP_MS = Math.max(0, Number(process.env.PRUNE_SLEEP_MS || 2000) || 0)

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

function timesToKeep(parsed) {
  const fullMs = KEEP_FULL_DAYS * 864e5
  const dailyCap = KEEP_DAILY_DAYS > 0
  const dailyMs = dailyCap ? KEEP_DAILY_DAYS * 864e5 : Infinity
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
  return keep
}

function parseParTimes(db) {
  const rows = db.prepare(`SELECT time FROM PAR`).all()
  const now = Date.now()
  const parsed = []
  for (const r of rows) {
    const time = String(r.time || '').trim()
    const ms = new Date(time).getTime()
    if (!time || !Number.isFinite(ms)) continue
    parsed.push({ time, ms, age: now - ms, hour: nairobiHour(new Date(ms)), day: nairobiDateKey(new Date(ms)) })
  }
  return parsed
}

function timesToDelete(db) {
  const parsed = parseParTimes(db)
  const keep = timesToKeep(parsed)
  return parsed.filter((p) => !keep.has(p.time)).map((p) => p.time)
}

function rebuildTableKeepTimes(db, tableName, keepTimes) {
  console.log(`  rebuilding ${tableName} (copy keep rows, drop the rest)...`)
  db.exec(`DROP TABLE IF EXISTS "${tableName}__keep"`)
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS keep_par_times (time TEXT PRIMARY KEY)`)
  db.exec(`DELETE FROM keep_par_times`)
  const ins = db.prepare(`INSERT OR IGNORE INTO keep_par_times (time) VALUES (?)`)
  const fill = db.transaction((list) => {
    for (const t of list) ins.run(t)
  })
  fill([...keepTimes])

  db.exec(
    `CREATE TABLE "${tableName}__keep" AS
     SELECT * FROM "${tableName}"
     WHERE time IN (SELECT time FROM keep_par_times)`,
  )
  db.exec(`DROP TABLE "${tableName}"`)
  db.exec(`ALTER TABLE "${tableName}__keep" RENAME TO "${tableName}"`)
  db.exec(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_time" ON "${tableName}"(time)`)
  const left = db.prepare(`SELECT COUNT(*) AS c FROM "${tableName}"`).get().c
  console.log(`  ${tableName}: ${Number(left).toLocaleString()} rows kept`)
}

async function pruneOnline(db, times) {
  const delOpen = db.prepare(`DELETE FROM Open_loans WHERE time = ?`)
  const delPast = db.prepare(`DELETE FROM Past_Missed_repayment WHERE time = ?`)
  const delBatch = db.transaction((batch) => {
    let n = 0
    for (const t of batch) {
      n += delOpen.run(t).changes
      n += delPast.run(t).changes
    }
    return n
  })

  let deleted = 0
  const started = Date.now()
  for (let i = 0; i < times.length; i += BATCH_SIZE) {
    const batch = times.slice(i, i + BATCH_SIZE)
    let changes = 0
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        changes = delBatch(batch)
        break
      } catch (e) {
        if (!/busy|locked/i.test(String(e.message || e)) || attempt === 7) throw e
        await sleep(500 * (attempt + 1))
      }
    }
    deleted += changes
    const done = Math.min(i + BATCH_SIZE, times.length)
    if (done === times.length || done % 25 === 0 || done <= BATCH_SIZE) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      console.log(`  online: ${done}/${times.length} snapshots · ${deleted.toLocaleString()} rows · ${mins} min`)
    }
    if (SLEEP_MS > 0 && done < times.length) await sleep(SLEEP_MS)
  }
  console.log(`  online prune done: ${deleted.toLocaleString()} rows removed`)
  console.log('  Note: app.db file size will not shrink until you VACUUM (stop app for that).')
}

async function prune(db, times) {
  const parsed = parseParTimes(db)
  const keep = timesToKeep(parsed)
  console.log(
    `\nPrune plan: drop ${times.length} snapshot times from Open_loans + Past_Missed_repayment`,
  )
  console.log(
    `  keep all snapshots < ${KEEP_FULL_DAYS}d, then SOD/EOD only` +
      (KEEP_DAILY_DAYS > 0 ? ` through ${KEEP_DAILY_DAYS}d` : ' (no age cap)'),
  )
  console.log(`  keep ${keep.size} snapshot times`)
  if (!times.length) {
    console.log('  nothing to delete')
    return
  }
  if (!APPLY) {
    console.log('  dry-run (pass --apply to delete)')
    if (ONLINE) {
      console.log(`  mode: --online (batch=${BATCH_SIZE}, sleep=${SLEEP_MS}ms) — app can stay up`)
      const estMin = Math.ceil((times.length / BATCH_SIZE) * (SLEEP_MS + 500) / 60000)
      console.log(`  rough runtime: ~${estMin}–${estMin * 3} minutes (depends on row size / disk)`)
    } else {
      console.log('  mode: rebuild (FAST) — stop the app first (pm2 stop exco)')
    }
    console.log('  sample times:', times.slice(0, 8).join(', '))
    return
  }

  db.pragma('busy_timeout = 30000')

  if (ONLINE) {
    console.log(`  ONLINE mode: app can stay up (batch=${BATCH_SIZE}, sleep=${SLEEP_MS}ms)`)
    console.log('  Pages may feel slower while this runs; do not run VACUUM until finished.')
    await pruneOnline(db, times)
    return
  }

  console.log('  REBUILD mode: stop the website first (pm2 stop exco) or this will 502 users.')
  rebuildTableKeepTimes(db, 'Open_loans', keep)
  rebuildTableKeepTimes(db, 'Past_Missed_repayment', keep)
  console.log('  rebuild done')
}

if (!fs.existsSync(dbPath)) {
  console.error('Missing', dbPath)
  process.exit(1)
}

const needWrite = PRUNE || VACUUM || CHECKPOINT
const db = new Database(dbPath, { readonly: !needWrite, fileMustExist: true })
try {
  report(db)
  if (PRUNE) await prune(db, timesToDelete(db))
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

/**
 * Weekly PAR reduction sizes using the report's week definition
 * (target Sun 03:00 → Sat 20:00 EAT), allowing nearby snapshots when
 * exact Sunday/Saturday slots are missing (common in this DB).
 */
import Database from 'better-sqlite3'
import { writeFileSync } from 'fs'

const db = new Database('data/app.db', { readonly: true })

function nairobiParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (t) => parts.find((p) => p.type === t)?.value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function nairobiWallClockUtc(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0))
}

function addDays(y, m, d, delta) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() }
}

function dayKey(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function weekdaySun0(y, m, d) {
  const utc = nairobiWallClockUtc(y, m, d, 12, 0)
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
  }).format(utc)
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0
}

const parTimes = db
  .prepare('SELECT time FROM PAR ORDER BY time ASC')
  .all()
  .map((r) => String(r.time).trim())
  .filter(Boolean)
  .map((t) => ({ t, ms: new Date(t).getTime(), n: nairobiParts(new Date(t)) }))
  .filter((x) => Number.isFinite(x.ms))

function closest(targetMs, maxAbsHours) {
  const maxAbs = maxAbsHours * 3600 * 1000
  let best = null
  let bestAbs = Infinity
  for (const row of parTimes) {
    const abs = Math.abs(row.ms - targetMs)
    if (abs > maxAbs) continue
    if (abs < bestAbs) {
      bestAbs = abs
      best = row
    }
  }
  return best
}

const kenyaBranches = new Set(
  db
    .prepare("SELECT code FROM Logbook_Branches WHERE active = 1 AND country = 'Kenya'")
    .all()
    .map((r) => String(r.code)),
)
const branchNameStmt = db.prepare(
  'SELECT name FROM Logbook_Branches WHERE code = ? AND active = 1 LIMIT 1',
)

function branchPar(snapshotTime) {
  const rows = db
    .prepare(
      `SELECT branch_code, SUM(COALESCE(principal_balance_amount, 0)) AS par
       FROM Past_Missed_repayment WHERE time = ? GROUP BY branch_code`,
    )
    .all(snapshotTime)
  const openRows = db
    .prepare(
      `SELECT branch_code,
              SUM(COALESCE(loan_principal_amount, principal_balance_amount, 0)) AS open_amt
       FROM Open_loans WHERE time = ? GROUP BY branch_code`,
    )
    .all(snapshotTime)
  const openBy = new Map(openRows.map((r) => [String(r.branch_code), Number(r.open_amt) || 0]))
  const out = new Map()
  for (const r of rows) {
    const code = String(r.branch_code || '').trim()
    if (!code || (kenyaBranches.size && !kenyaBranches.has(code))) continue
    const par = Number(r.par) || 0
    const open = openBy.get(code) || 0
    out.set(code, {
      code,
      name: branchNameStmt.get(code)?.name || code,
      par,
      open,
      pct: open > 0 ? (par / open) * 100 : 0,
    })
  }
  return out
}

// Enumerate Saturday week-ends that exist near data range
const first = parTimes[0].n
const last = parTimes[parTimes.length - 1].n
let cursor = { year: first.year, month: first.month, day: first.day }
const endMs = nairobiWallClockUtc(last.year, last.month, last.day, 23, 0).getTime()
const saturdays = []
while (nairobiWallClockUtc(cursor.year, cursor.month, cursor.day, 12, 0).getTime() <= endMs) {
  if (weekdaySun0(cursor.year, cursor.month, cursor.day) === 6) {
    saturdays.push({ ...cursor })
  }
  cursor = addDays(cursor.year, cursor.month, cursor.day, 1)
}

const moves = []
const weekSummaries = []

for (const sat of saturdays) {
  const sun = addDays(sat.year, sat.month, sat.day, -6)
  const sowTarget = nairobiWallClockUtc(sun.year, sun.month, sun.day, 3, 0).getTime()
  const eowTarget = nairobiWallClockUtc(sat.year, sat.month, sat.day, 20, 0).getTime()

  // Widen search: no Sunday snapshots in DB — Mon morning often becomes week start
  const sow = closest(sowTarget, 36)
  const eow = closest(eowTarget, 36)
  if (!sow || !eow) continue
  if (sow.t === eow.t) continue
  if (eow.ms - sow.ms < 4 * 24 * 3600 * 1000) continue

  const sowMap = branchPar(sow.t)
  const eowMap = branchPar(eow.t)
  const codes = new Set([...sowMap.keys(), ...eowMap.keys()])
  let weekReduced = 0
  let pairs = 0
  for (const code of codes) {
    const s = sowMap.get(code)
    const e = eowMap.get(code)
    if (!s || !e) continue
    if ((s.open || 0) < 50_000 && (e.open || 0) < 50_000) continue
    const reducedAmt = s.par - e.par
    const reducedPp = s.pct - e.pct
    const share = s.par > 0 ? reducedAmt / s.par : null
    moves.push({
      weekStart: dayKey(sun),
      weekEnd: dayKey(sat),
      code,
      name: String(e.name || s.name || code)
        .replace(/\s+Branch$/i, '')
        .replace(/^Boda\s*-\s*/i, ''),
      sowPar: s.par,
      eowPar: e.par,
      sowPct: s.pct,
      eowPct: e.pct,
      reducedAmt,
      reducedPp,
      share,
      sowSnap: sow.t,
      eowSnap: eow.t,
      sowHour: sow.n.hour,
      eowHour: eow.n.hour,
      sowDow: new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(
        new Date(sow.t),
      ),
      eowDow: new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(
        new Date(eow.t),
      ),
    })
    weekReduced += reducedAmt
    pairs += 1
  }
  if (pairs) {
    weekSummaries.push({
      weekStart: dayKey(sun),
      weekEnd: dayKey(sat),
      branches: pairs,
      portfolioReduced: weekReduced,
      sow: sow.t,
      eow: eow.t,
      sowHour: sow.n.hour,
      eowHour: eow.n.hour,
      sowDow: new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(
        new Date(sow.t),
      ),
      eowDow: new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(
        new Date(eow.t),
      ),
    })
  }
}

function pctile(sorted, p) {
  if (!sorted.length) return null
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (1 - (i - lo)) + sorted[hi] * (i - lo)
}

function summarize(values) {
  const sorted = [...values].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!sorted.length) return null
  return {
    n: sorted.length,
    min: sorted[0],
    p10: pctile(sorted, 0.1),
    p25: pctile(sorted, 0.25),
    p50: pctile(sorted, 0.5),
    p75: pctile(sorted, 0.75),
    p90: pctile(sorted, 0.9),
    p95: pctile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  }
}

function coverage(amtFloor, ppFloor, shareFloor = 0.02) {
  let materialGood = 0
  let noise = 0
  let materialBad = 0
  for (const m of moves) {
    const absAmt = Math.abs(m.reducedAmt)
    const absPp = Math.abs(m.reducedPp)
    const shareOk = m.sowPar > 0 && absAmt / m.sowPar >= shareFloor
    const material = absPp >= ppFloor || (absAmt >= amtFloor && shareOk)
    if (!material) noise++
    else if (m.reducedAmt > 0) materialGood++
    else materialBad++
  }
  const n = moves.length || 1
  return {
    materialGood,
    materialBad,
    noise,
    pctNoise: Number((noise / n).toFixed(3)),
    pctGood: Number((materialGood / n).toFixed(3)),
    pctBad: Number((materialBad / n).toFixed(3)),
  }
}

const reducedOnly = moves.filter((m) => m.reducedAmt > 0)
const shares = reducedOnly.map((m) => m.share).filter((s) => s != null && Number.isFinite(s) && s > 0)

const histAmt = [
  ['rose ≥750K', moves.filter((m) => m.reducedAmt <= -750_000).length],
  ['rose 300–750K', moves.filter((m) => m.reducedAmt > -750_000 && m.reducedAmt <= -300_000).length],
  ['flat |<300K|', moves.filter((m) => Math.abs(m.reducedAmt) < 300_000).length],
  ['small 300–750K', moves.filter((m) => m.reducedAmt >= 300_000 && m.reducedAmt < 750_000).length],
  ['large 750K–1.5M', moves.filter((m) => m.reducedAmt >= 750_000 && m.reducedAmt < 1_500_000).length],
  ['huge 1.5–3M', moves.filter((m) => m.reducedAmt >= 1_500_000 && m.reducedAmt < 3_000_000).length],
  ['mega ≥3M', moves.filter((m) => m.reducedAmt >= 3_000_000).length],
].map(([label, count]) => ({ label, count }))

const histPp = [
  ['rose ≥1%', moves.filter((m) => m.reducedPp <= -1).length],
  ['flat |<0.5%|', moves.filter((m) => Math.abs(m.reducedPp) < 0.5).length],
  ['small 0.5–1%', moves.filter((m) => m.reducedPp >= 0.5 && m.reducedPp < 1).length],
  ['medium 1–2%', moves.filter((m) => m.reducedPp >= 1 && m.reducedPp < 2).length],
  ['large 2–4%', moves.filter((m) => m.reducedPp >= 2 && m.reducedPp < 4).length],
  ['huge ≥4%', moves.filter((m) => m.reducedPp >= 4).length],
].map(([label, count]) => ({ label, count }))

const candidates = [
  { amt: 300_000, pp: 0.5, share: 0.02 },
  { amt: 500_000, pp: 0.8, share: 0.02 },
  { amt: 500_000, pp: 1.0, share: 0.03 },
  { amt: 750_000, pp: 1.0, share: 0.02 },
  { amt: 750_000, pp: 1.5, share: 0.03 },
  { amt: 1_000_000, pp: 1.5, share: 0.025 },
  { amt: 1_000_000, pp: 2.0, share: 0.03 },
].map((c) => ({ ...c, ...coverage(c.amt, c.pp, c.share) }))

const a = summarize(reducedOnly.map((m) => m.reducedAmt))
const p = summarize(reducedOnly.map((m) => m.reducedPp))
const s = summarize(shares)

let suggested = null
if (a && p) {
  // Prefer ~p25 as noise floor, round to clean numbers
  const materialAmt = Math.max(500_000, Math.round((a.p25 || 500_000) / 50_000) * 50_000)
  const materialPp = Math.max(0.8, Math.round((p.p25 || 0.8) * 10) / 10)
  const materialShare = Math.max(0.02, Math.min(0.05, Math.round(((s?.p25 || 0.02) * 100)) / 100))
  suggested = {
    materialAmt,
    materialPp,
    materialShare,
    strongAmt: Math.round((a.p75 || 1_500_000) / 50_000) * 50_000,
    strongPp: Math.round((p.p75 || 2) * 10) / 10,
    coverage: coverage(materialAmt, materialPp, materialShare),
    note: 'Green only if rate ≥ materialPp OR (amount ≥ materialAmt AND share of SOW PAR ≥ materialShare). Else yellow noise. PAR% < 8% stays green on the closing-% value.',
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  weeks: weekSummaries.length,
  weekRange: weekSummaries.length
    ? { from: weekSummaries[0].weekStart, to: weekSummaries[weekSummaries.length - 1].weekEnd }
    : null,
  branchWeekMoves: moves.length,
  note: 'No Sunday PAR snapshots in DB; week-start uses closest to Sun 03:00 within 36h (often Mon morning). Week-end closest to Sat 20:00 within 36h (often Fri evening).',
  amtStatsAll: summarize(moves.map((m) => m.reducedAmt)),
  amtStatsReductionsOnly: a,
  ppStatsReductionsOnly: p,
  shareStatsReductionsOnly: s,
  histAmt,
  histPp,
  candidates,
  suggested,
  weekSummaries,
  topReductions: [...moves].sort((x, y) => y.reducedAmt - x.reducedAmt).slice(0, 12),
}

writeFileSync('data/par-weekly-reduction-stats.json', JSON.stringify(result, null, 2))
console.log(
  JSON.stringify(
    {
      weeks: result.weeks,
      weekRange: result.weekRange,
      branchWeekMoves: result.branchWeekMoves,
      note: result.note,
      amtStatsReductionsOnly: result.amtStatsReductionsOnly,
      ppStatsReductionsOnly: result.ppStatsReductionsOnly,
      shareStatsReductionsOnly: result.shareStatsReductionsOnly,
      histAmt: result.histAmt,
      histPp: result.histPp,
      candidates: result.candidates,
      suggested: result.suggested,
      sampleWeeks: result.weekSummaries.slice(-8).map((w) => ({
        week: `${w.weekStart}→${w.weekEnd}`,
        snaps: `${w.sowDow} ${w.sowHour}:00 → ${w.eowDow} ${w.eowHour}:00`,
        reducedM: Number((w.portfolioReduced / 1e6).toFixed(2)),
        branches: w.branches,
      })),
      topReductions: result.topReductions.slice(0, 8).map((m) => ({
        week: m.weekStart,
        name: m.name,
        amt: Math.round(m.reducedAmt),
        pp: Number(m.reducedPp.toFixed(2)),
        share: m.share != null ? `${(m.share * 100).toFixed(1)}%` : null,
      })),
    },
    null,
    2,
  ),
)

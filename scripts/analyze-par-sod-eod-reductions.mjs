/**
 * Analyze SOD (~03:00 EAT) → EOD (~20:00 EAT) PAR reductions by branch
 * to recommend thresholds for "flat / small / large" risk reduction.
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

function dayKey(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

const parTimes = db
  .prepare('SELECT time FROM PAR ORDER BY time ASC')
  .all()
  .map((r) => String(r.time).trim())
  .filter(Boolean)
  .map((t) => ({ t, ms: new Date(t).getTime(), n: nairobiParts(new Date(t)) }))
  .filter((x) => Number.isFinite(x.ms))

const byDay = new Map()
for (const row of parTimes) {
  const k = dayKey(row.n)
  if (!byDay.has(k)) byDay.set(k, [])
  byDay.get(k).push(row)
}

function closest(list, targetMs, maxAbsHours = 5) {
  const maxAbs = maxAbsHours * 3600 * 1000
  let best = null
  let bestAbs = Infinity
  for (const row of list) {
    const abs = Math.abs(row.ms - targetMs)
    if (abs > maxAbs) continue
    if (abs < bestAbs) {
      bestAbs = abs
      best = row
    }
  }
  return best
}

const branchNameStmt = db.prepare(
  'SELECT name FROM Logbook_Branches WHERE code = ? AND active = 1 LIMIT 1',
)
const kenyaBranches = new Set(
  db
    .prepare("SELECT code FROM Logbook_Branches WHERE active = 1 AND country = 'Kenya'")
    .all()
    .map((r) => String(r.code)),
)

function branchPar(snapshotTime) {
  // Match report spirit: at-risk principal from Past_Missed_repayment
  const rows = db
    .prepare(
      `SELECT branch_code,
              SUM(COALESCE(principal_balance_amount, 0)) AS par,
              COUNT(*) AS n
       FROM Past_Missed_repayment
       WHERE time = ?
       GROUP BY branch_code`,
    )
    .all(snapshotTime)
  const openRows = db
    .prepare(
      `SELECT branch_code,
              SUM(COALESCE(loan_principal_amount, principal_balance_amount, 0)) AS open_amt
       FROM Open_loans
       WHERE time = ?
       GROUP BY branch_code`,
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

const moves = []
const daySummaries = []
const sortedDays = Array.from(byDay.keys()).sort()

for (const d of sortedDays) {
  const list = byDay.get(d)
  const morning = list
    .filter((r) => r.n.hour <= 10)
    .sort((a, b) => a.ms - b.ms)[0]
  const evening = list
    .filter((r) => r.n.hour >= 15)
    .sort((a, b) => b.ms - a.ms)[0]
  if (!morning || !evening) continue
  if (morning.t === evening.t) continue
  if (evening.ms - morning.ms < 4 * 3600 * 1000) continue

  const sod = morning
  const eod = evening
  const sodMap = branchPar(sod.t)
  const eodMap = branchPar(eod.t)
  const codes = new Set([...sodMap.keys(), ...eodMap.keys()])
  let dayReduced = 0
  let dayPairs = 0
  for (const code of codes) {
    const s = sodMap.get(code)
    const e = eodMap.get(code)
    if (!s || !e) continue
    if ((s.open || 0) < 50_000 && (e.open || 0) < 50_000) continue
    const reducedAmt = s.par - e.par // positive = good
    const reducedPp = s.pct - e.pct
    moves.push({
      date: d,
      code,
      name: String(e.name || s.name || code)
        .replace(/\s+Branch$/i, '')
        .replace(/^Boda\s*-\s*/i, ''),
      sodPar: s.par,
      eodPar: e.par,
      sodPct: s.pct,
      eodPct: e.pct,
      reducedAmt,
      reducedPp,
      sodOpen: s.open,
      eodOpen: e.open,
      sodSnap: sod.t,
      eodSnap: eod.t,
      sodHour: sod.n.hour,
      eodHour: eod.n.hour,
    })
    dayReduced += reducedAmt
    dayPairs += 1
  }
  if (dayPairs) {
    daySummaries.push({
      date: d,
      branches: dayPairs,
      portfolioReduced: dayReduced,
      sod: sod.t,
      eod: eod.t,
      sodHour: sod.n.hour,
      eodHour: eod.n.hour,
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

const reduced = moves.map((m) => m.reducedAmt)
const reducedOnly = moves.filter((m) => m.reducedAmt > 0).map((m) => m.reducedAmt)
const increased = moves.filter((m) => m.reducedAmt < 0).map((m) => -m.reducedAmt)
const flatish = moves.filter((m) => Math.abs(m.reducedAmt) < 50_000)
const ppAll = moves.map((m) => m.reducedPp)
const ppDown = moves.filter((m) => m.reducedPp > 0).map((m) => m.reducedPp)

function bucketAmt(v) {
  if (v <= -100_000) return 'rose_100k+'
  if (v < -10_000) return 'rose_10-100k'
  if (v < 10_000) return 'flat_|<10k|'
  if (v < 100_000) return 'small_10-100k'
  if (v < 300_000) return 'medium_100-300k'
  if (v < 750_000) return 'large_300-750k'
  return 'huge_750k+'
}

function bucketPp(v) {
  if (v <= -0.5) return 'rose_0.5%+'
  if (v < -0.1) return 'rose_0.1-0.5%'
  if (v < 0.1) return 'flat_|<0.1%|'
  if (v < 0.5) return 'small_0.1-0.5%'
  if (v < 1.5) return 'medium_0.5-1.5%'
  if (v < 3) return 'large_1.5-3%'
  return 'huge_3%+'
}

const amtBuckets = {}
const ppBuckets = {}
for (const m of moves) {
  const a = bucketAmt(m.reducedAmt)
  const p = bucketPp(m.reducedPp)
  amtBuckets[a] = (amtBuckets[a] || 0) + 1
  ppBuckets[p] = (ppBuckets[p] || 0) + 1
}

const above8 = moves.filter((m) => m.eodPct >= 8 || m.sodPct >= 8)
const above8Flat = above8.filter((m) => Math.abs(m.reducedAmt) < 100_000 && Math.abs(m.reducedPp) < 0.3)
const above8Reduced = above8.filter((m) => m.reducedAmt >= 100_000 || m.reducedPp >= 0.3)
const below8 = moves.filter((m) => m.eodPct < 8)

const topReductions = [...moves].sort((a, b) => b.reducedAmt - a.reducedAmt).slice(0, 15)
const topRises = [...moves].sort((a, b) => a.reducedAmt - b.reducedAmt).slice(0, 10)

const histAmt = [
  { label: 'Rose ≥100K', count: amtBuckets['rose_100k+'] || 0 },
  { label: 'Rose 10–100K', count: amtBuckets['rose_10-100k'] || 0 },
  { label: 'Flat |<10K|', count: amtBuckets['flat_|<10k|'] || 0 },
  { label: 'Small 10–100K', count: amtBuckets['small_10-100k'] || 0 },
  { label: 'Medium 100–300K', count: amtBuckets['medium_100-300k'] || 0 },
  { label: 'Large 300–750K', count: amtBuckets['large_300-750k'] || 0 },
  { label: 'Huge ≥750K', count: amtBuckets['huge_750k+'] || 0 },
]

const histPp = [
  { label: 'Rose ≥0.5%', count: ppBuckets['rose_0.5%+'] || 0 },
  { label: 'Rose 0.1–0.5%', count: ppBuckets['rose_0.1-0.5%'] || 0 },
  { label: 'Flat |<0.1%|', count: ppBuckets['flat_|<0.1%|'] || 0 },
  { label: 'Small 0.1–0.5%', count: ppBuckets['small_0.1-0.5%'] || 0 },
  { label: 'Medium 0.5–1.5%', count: ppBuckets['medium_0.5-1.5%'] || 0 },
  { label: 'Large 1.5–3%', count: ppBuckets['large_1.5-3%'] || 0 },
  { label: 'Huge ≥3%', count: ppBuckets['huge_3%+'] || 0 },
]

const result = {
  generatedAt: new Date().toISOString(),
  daysWithSodEod: daySummaries.length,
  dayRange: daySummaries.length
    ? { from: daySummaries[0].date, to: daySummaries[daySummaries.length - 1].date }
    : null,
  branchDayMoves: moves.length,
  amtStatsAll: summarize(reduced),
  amtStatsReductionsOnly: summarize(reducedOnly),
  amtStatsIncreasesOnly: summarize(increased),
  ppStatsAll: summarize(ppAll),
  ppStatsReductionsOnly: summarize(ppDown),
  share: {
    rose100k: (amtBuckets['rose_100k+'] || 0) / moves.length,
    flat10k: (amtBuckets['flat_|<10k|'] || 0) / moves.length,
    small: (amtBuckets['small_10-100k'] || 0) / moves.length,
    medium: (amtBuckets['medium_100-300k'] || 0) / moves.length,
    large: (amtBuckets['large_300-750k'] || 0) / moves.length,
    huge: (amtBuckets['huge_750k+'] || 0) / moves.length,
    absFlat50k: flatish.length / moves.length,
  },
  histAmt,
  histPp,
  above8: {
    n: above8.length,
    flat100kOr03pp: above8Flat.length,
    reduced100kOr03pp: above8Reduced.length,
  },
  below8: { n: below8.length },
  daySummaries,
  topReductions,
  topRises,
  // Candidate thresholds from percentiles of positive reductions
  suggested: null,
}

if (result.amtStatsReductionsOnly && result.ppStatsReductionsOnly) {
  const a = result.amtStatsReductionsOnly
  const p = result.ppStatsReductionsOnly
  result.suggested = {
    flatNoiseAmt: Math.round(a.p25 / 1000) * 1000, // below this ≈ noise / no action
    smallAmt: Math.round(a.p50 / 1000) * 1000,
    largeAmt: Math.round(a.p75 / 1000) * 1000,
    hugeAmt: Math.round(a.p90 / 1000) * 1000,
    flatNoisePp: Number(p.p25.toFixed(2)),
    smallPp: Number(p.p50.toFixed(2)),
    largePp: Number(p.p75.toFixed(2)),
    hugePp: Number(p.p90.toFixed(2)),
    note: 'Based on percentiles of branch-days where PAR amount fell (SOD−EOD > 0). Flat/no-action = below ~p25 of reductions OR abs move below that noise floor while EOD PAR ≥ 8%.',
  }
}

writeFileSync('data/par-sod-eod-reduction-stats.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify({
  daysWithSodEod: result.daysWithSodEod,
  dayRange: result.dayRange,
  branchDayMoves: result.branchDayMoves,
  amtStatsAll: result.amtStatsAll,
  amtStatsReductionsOnly: result.amtStatsReductionsOnly,
  ppStatsReductionsOnly: result.ppStatsReductionsOnly,
  share: result.share,
  histAmt: result.histAmt,
  histPp: result.histPp,
  above8: result.above8,
  suggested: result.suggested,
  sampleDays: result.daySummaries.slice(-8),
  topReductions: result.topReductions.slice(0, 8).map((m) => ({
    date: m.date,
    name: m.name,
    reducedAmt: Math.round(m.reducedAmt),
    reducedPp: Number(m.reducedPp.toFixed(2)),
    sodPct: Number(m.sodPct.toFixed(2)),
    eodPct: Number(m.eodPct.toFixed(2)),
  })),
}, null, 2))

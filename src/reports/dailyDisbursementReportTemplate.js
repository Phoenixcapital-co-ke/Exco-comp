import phoenixLogo from './phoenixLogoDataUri.js'

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatCompact(v) {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${Math.round(abs)}`
}

function formatSignedCompact(v) {
  const n = Number(v) || 0
  if (n > 0) return `+${formatCompact(n)}`
  return formatCompact(n)
}

function formatPct(v, digits = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

function valuePill(tone, content) {
  const t = tone || 'neutral'
  return `<span class="val val-${t}">${content}</span>`
}

/**
 * @param {object} payload — response from GET /api/reports/daily-disbursements
 */
export function renderDailyDisbursementReportHTML(payload) {
  const dateLabel = escapeHtml(payload?.dateLabel || payload?.date || '')
  const country = escapeHtml(payload?.country || 'Kenya')
  const currency = escapeHtml(payload?.currency || 'KES')
  const overall = payload?.overall || {}
  const branches = Array.isArray(payload?.branches) ? payload.branches : []

  const todayAmt = Number(overall.today) || 0
  const todayCount = Number(overall.todayCount) || 0
  const yesterdayAmt = Number(overall.yesterday) || 0
  const mtdAmt = Number(overall.mtd) || 0
  const targetAmt = Number(overall.target) || 0
  const achPct = Number(overall.achPct)
  const vsYest = todayAmt - yesterdayAmt

  const achTone = !Number.isFinite(achPct) || targetAmt <= 0 ? 'neutral' : achPct >= 100 ? 'good' : achPct >= 80 ? 'warn' : 'bad'
  const vsYestTone = vsYest > 0 ? 'good' : vsYest < 0 ? 'bad' : 'neutral'

  const branchRows = branches
    .map((b) => {
      const today = Number(b.today) || 0
      const yesterday = Number(b.yesterday) || 0
      const delta = Number(b.vsYesterday) || today - yesterday
      const mtd = Number(b.mtd) || 0
      const target = Number(b.target) || 0
      const ach = Number(b.achPct)
      const deltaTone = delta > 0 ? 'good' : delta < 0 ? 'bad' : 'neutral'
      const rowAchTone =
        !Number.isFinite(ach) || target <= 0 ? 'neutral' : ach >= 100 ? 'good' : ach >= 80 ? 'warn' : 'bad'
      return `<tr>
        <td class="branch">${escapeHtml(b.name || b.code || '')}</td>
        <td class="num">${formatCompact(today)}</td>
        <td class="num">${formatCompact(yesterday)}</td>
        <td class="num">${valuePill(deltaTone, formatSignedCompact(delta))}</td>
        <td class="num">${formatCompact(mtd)}</td>
        <td class="num">${target > 0 ? formatCompact(target) : '—'}</td>
        <td class="num">${target > 0 ? valuePill(rowAchTone, formatPct(ach)) : '—'}</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Disbursements — ${dateLabel}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --green: #22863a;
      --green-light: #e6ffed;
      --red: #cb2431;
      --red-light: #ffeef0;
      --warn: #b7791f;
      --warn-light: #fffbeb;
      --blue: #2b6cb0;
      --ink: #1a202c;
      --muted: #718096;
      --border: #e2e8f0;
      --bg: #f7f8fa;
      --white: #ffffff;
      --accent: #e8561e;
    }
    @page { size: A4 portrait; margin: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--ink);
      font-size: 13px;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 794px;
      min-height: 1123px;
      margin: 0 auto;
      background: var(--white);
      padding: 32px 36px 36px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 3px solid var(--accent);
      margin-bottom: 22px;
    }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .header-logo { height: 60px; width: auto; display: block; flex-shrink: 0; }
    .report-label {
      font-size: 10px; font-weight: 700; letter-spacing: .12em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 4px;
    }
    .report-title {
      font-size: 24px; font-weight: 800; color: var(--ink);
      letter-spacing: -0.02em; line-height: 1.1;
    }
    .report-subtitle { font-size: 11px; color: var(--muted); margin-top: 4px; }
    .header-right { text-align: right; font-size: 11px; color: var(--muted); line-height: 1.7; }
    .header-right strong { color: var(--ink); font-weight: 600; }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 22px;
    }
    .kpi-card {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: #cbd5e0;
    }
    .kpi-card.positive::before { background: var(--green); }
    .kpi-card.negative::before { background: var(--red); }
    .kpi-card.warn::before { background: var(--warn); }
    .kpi-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .1em; color: var(--muted); margin-bottom: 6px;
    }
    .kpi-value {
      font-size: 24px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; color: var(--ink);
    }
    .kpi-card.positive .kpi-value { color: var(--green); }
    .kpi-card.negative .kpi-value { color: var(--red); }
    .kpi-card.warn .kpi-value { color: var(--warn); }
    .kpi-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

    .section-title {
      font-size: 10px; font-weight: 700; letter-spacing: .12em;
      text-transform: uppercase; color: var(--accent);
      margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
    }
    .section-title::after {
      content: ''; flex: 1; height: 1px; background: var(--border);
    }

    .table-wrap {
      margin-bottom: 22px;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead tr { background: #1a202c; color: #fff; }
    thead th {
      padding: 10px 10px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    thead th.num { text-align: right; }
    tbody td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    tbody tr:nth-child(even) { background: #fafbfc; }
    tbody tr:last-child td { border-bottom: none; }
    td.branch { font-weight: 600; color: var(--ink); }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    tfoot td {
      padding: 10px;
      font-weight: 700;
      background: #edf2f7;
      border-top: 2px solid var(--border);
    }

    .val {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-weight: 600;
      font-size: 10px;
    }
    .val-good { background: var(--green-light); color: var(--green); }
    .val-bad { background: var(--red-light); color: var(--red); }
    .val-warn { background: var(--warn-light); color: var(--warn); }
    .val-neutral { background: #edf2f7; color: var(--muted); }

    .footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      font-size: 10px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <img class="header-logo" src="${phoenixLogo}" alt="Phoenix Capital" />
        <div>
          <div class="report-label">Logbook Operations</div>
          <div class="report-title">Daily Disbursements</div>
          <div class="report-subtitle">Today · vs yesterday · MTD vs target by branch</div>
        </div>
      </div>
      <div class="header-right">
        <div><strong>${dateLabel}</strong></div>
        <div>${country} · ${currency}</div>
        <div>Auto-send Mon–Sat 20:00 EAT</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card ${vsYestTone === 'good' ? 'positive' : vsYestTone === 'bad' ? 'negative' : ''}">
        <div class="kpi-label">Today Disbursed</div>
        <div class="kpi-value">${formatCompact(todayAmt)}</div>
        <div class="kpi-sub">${todayCount} loan${todayCount === 1 ? '' : 's'} · vs yday ${valuePill(vsYestTone, formatSignedCompact(vsYest))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Yesterday</div>
        <div class="kpi-value">${formatCompact(yesterdayAmt)}</div>
        <div class="kpi-sub">Prior calendar day</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">MTD Disbursed</div>
        <div class="kpi-value">${formatCompact(mtdAmt)}</div>
        <div class="kpi-sub">Month to report date</div>
      </div>
      <div class="kpi-card ${achTone === 'good' ? 'positive' : achTone === 'bad' ? 'negative' : achTone === 'warn' ? 'warn' : ''}">
        <div class="kpi-label">% of Target</div>
        <div class="kpi-value">${targetAmt > 0 ? formatPct(achPct) : '—'}</div>
        <div class="kpi-sub">${targetAmt > 0 ? `Target ${formatCompact(targetAmt)}` : 'No active targets'}</div>
      </div>
    </div>

    <div class="section-title">Branch breakdown</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Branch</th>
            <th class="num">Today</th>
            <th class="num">Yesterday</th>
            <th class="num">Δ vs Yday</th>
            <th class="num">MTD</th>
            <th class="num">Target</th>
            <th class="num">Ach %</th>
          </tr>
        </thead>
        <tbody>
          ${branchRows || `<tr><td colspan="7" style="text-align:center;color:#718096;padding:24px">No disbursement data for this date.</td></tr>`}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td class="num">${formatCompact(todayAmt)}</td>
            <td class="num">${formatCompact(yesterdayAmt)}</td>
            <td class="num">${valuePill(vsYestTone, formatSignedCompact(vsYest))}</td>
            <td class="num">${formatCompact(mtdAmt)}</td>
            <td class="num">${targetAmt > 0 ? formatCompact(targetAmt) : '—'}</td>
            <td class="num">${targetAmt > 0 ? valuePill(achTone, formatPct(achPct)) : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="footer">
      <div>Phoenix Capital — Logbook ${country}</div>
      <div>Green = up / on target · Red = down / behind · Amber = 80–99% of target</div>
    </div>
  </div>
</body>
</html>`
}

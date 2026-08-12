import phoenixLogo from './phoenixLogoDataUri.js'

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatPct(v, digits = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
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

function formatSignedPp(v) {
  const n = Number(v) || 0
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

/**
 * Material day-over-day move (risk-reduced signed: + = PAR fell vs yesterday EOD).
 * Green only if the drop clears noise AND is meaningful vs that branch's yesterday PAR book,
 * or the PAR rate itself moves ≥0.3%.
 */
const MATERIAL_AMT = 100_000
const MATERIAL_PP = 0.3
const MATERIAL_SHARE = 0.02 // ≥2% of yesterday EOD PAR amount
const HEALTHY_PAR_PCT = 8

function isMaterialRiskMove(riskAmt, riskPp, basePar) {
  const amt = Number(riskAmt) || 0
  const pp = Number(riskPp) || 0
  const book = Math.max(0, Number(basePar) || 0)
  const absAmt = Math.abs(amt)
  const absPp = Math.abs(pp)
  if (absPp >= MATERIAL_PP) return true
  if (absAmt < MATERIAL_AMT) return false
  if (book <= 0) return absAmt >= MATERIAL_AMT
  return absAmt / book >= MATERIAL_SHARE
}

/** Change-cell tone: good | warn | bad | '' */
function changeCellTone(riskAmt, riskPp, basePar) {
  if (riskAmt == null || riskPp == null) return ''
  if (!isMaterialRiskMove(riskAmt, riskPp, basePar)) return 'warn'
  if (riskAmt > 0 || riskPp > 0) return 'good'
  if (riskAmt < 0 || riskPp < 0) return 'bad'
  return 'warn'
}

function eodParCellTone(parPct) {
  const n = Number(parPct)
  if (!Number.isFinite(n)) return ''
  return n < HEALTHY_PAR_PCT ? 'good' : ''
}

function valuePill(tone, content) {
  const t = tone || 'neutral'
  return `<span class="val val-${t}">${content}</span>`
}

function narrItems(list) {
  const items = Array.isArray(list) ? list : []
  if (!items.length) return '<div class="narr-item"><span class="narr-bullet"></span><div><span class="change">None flagged.</span></div></div>'
  return items
    .map((item) => {
      const text = String(item?.text || item?.name || item || '').trim()
      if (!text) return ''
      // Prefer "Branch: rest" split
      const m = text.match(/^([^:]+):\s*(.*)$/)
      if (m) {
        return `<div class="narr-item">
          <span class="narr-bullet"></span>
          <div><span class="branch">${escapeHtml(m[1].trim())}</span> <span class="change">${escapeHtml(m[2].trim())}</span></div>
        </div>`
      }
      return `<div class="narr-item">
        <span class="narr-bullet"></span>
        <div><span class="change">${escapeHtml(text)}</span></div>
      </div>`
    })
    .filter(Boolean)
    .join('')
}

/**
 * @param {object} payload — response from GET /api/reports/daily-par
 */
export function renderDailyParReportHTML(payload) {
  const dateLabel = escapeHtml(payload?.dateLabel || payload?.date || '')
  const country = escapeHtml(payload?.country || 'Kenya')
  const overall = payload?.overall || {}
  const slots = payload?.slots || {}
  const branches = Array.isArray(payload?.branches) ? payload.branches : []
  const narrative = payload?.narrative || {}
  const claude = payload?.claudeAnalysis || null
  const claudeError = payload?.claudeError || null

  const eodVsYestPp =
    Number.isFinite(Number(overall.eod?.parPct)) && Number.isFinite(Number(overall.eodYesterday?.parPct))
      ? Number(overall.eod.parPct) - Number(overall.eodYesterday.parPct)
      : null
  // Display as risk reduced: Yesterday EOD − Today EOD (positive when PAR fell).
  const totalShift = Number(overall.netChangeVsYesterday) || 0
  const totalShiftPp =
    Number.isFinite(Number(overall.eodYesterday?.parPct)) && Number.isFinite(Number(overall.eod?.parPct))
      ? Number(overall.eodYesterday.parPct) - Number(overall.eod.parPct)
      : 0

  const bottomLineRaw = narrative.bottomLine || claude?.bottomLine || '—'
  // Emphasize amounts / branch names lightly for the dark banner
  const bottomLineHtml = escapeHtml(bottomLineRaw)
    .replace(/(\d+(?:\.\d+)?M|\d+(?:\.\d+)?K)/g, '<em>$1</em>')
    .replace(/\b(priority number one|PAR slipped|Mixed\/flat day)\b/gi, '<em>$1</em>')

  const topItems = narrative.topPerformers || []
  const holdItems = narrative.holdingSteady || []
  const watchItems = narrative.watching || []
  const cleanItems = narrative.clean || []

  const rowsHtml = branches
    .map((b) => {
      const vs = b.vsYesterdayEod
      const riskReducedAmt = vs ? -(Number(vs.parAmt) || 0) : null
      const riskReducedPct = vs ? -(Number(vs.parPctPp) || 0) : null
      const yestPar = Number(b.eodYesterday?.par) || 0
      const changeTone = changeCellTone(riskReducedAmt, riskReducedPct, yestPar)
      const eodPctTone = eodParCellTone(b.eod?.parPct)
      return `<tr>
        <td><span class="branch-name">${escapeHtml(b.name)}</span></td>
        <td>${b.hasYest === false ? '—' : formatPct(b.eodYesterday?.parPct)}</td>
        <td class="amt">${b.hasYest === false ? '—' : formatCompact(b.eodYesterday?.par)}</td>
        <td>${valuePill(eodPctTone || 'neutral', `<strong>${formatPct(b.eod?.parPct)}</strong>`)}</td>
        <td class="amt">${formatCompact(b.eod?.par)}</td>
        <td>${
          riskReducedAmt != null
            ? valuePill(changeTone, formatSignedCompact(riskReducedAmt))
            : '—'
        }</td>
        <td>${
          riskReducedPct != null
            ? valuePill(changeTone, formatSignedPp(riskReducedPct))
            : '—'
        }</td>
      </tr>`
    })
    .join('')

  const eodHour = String(slots.eod?.targetHour ?? 20).padStart(2, '0')

  const eodKpiClass =
    eodVsYestPp != null && eodVsYestPp < 0
      ? 'positive'
      : eodVsYestPp != null && eodVsYestPp > 0
        ? 'negative'
        : 'neutral-mid'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily PAR Report — ${dateLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --red: #e53e3e;
    --red-light: #fff5f5;
    --red-mid: #feb2b2;
    --green: #276749;
    --green-light: #f0fff4;
    --green-mid: #9ae6b4;
    --amber: #b7791f;
    --amber-light: #fffbeb;
    --amber-mid: #fbd38d;
    --blue: #2b6cb0;
    --blue-light: #ebf8ff;
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

  .header-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .header-logo {
    height: 60px;
    width: auto;
    display: block;
    flex-shrink: 0;
  }

  .report-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .report-title {
    font-size: 26px;
    font-weight: 800;
    color: var(--ink);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .report-subtitle {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }
  .header-right {
    text-align: right;
    font-size: 11px;
    color: var(--muted);
    line-height: 1.7;
  }
  .header-right strong { color: var(--ink); font-weight: 600; }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
  }
  .kpi-card.neutral::before  { background: #cbd5e0; }
  .kpi-card.neutral-mid::before { background: #718096; }
  .kpi-card.positive::before { background: var(--green); }
  .kpi-card.negative::before { background: var(--red); }

  .kpi-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .kpi-value {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .kpi-card.neutral .kpi-value,
  .kpi-card.neutral-mid .kpi-value { color: var(--ink); }
  .kpi-card.positive .kpi-value { color: var(--green); }
  .kpi-card.negative .kpi-value { color: var(--red); }

  .kpi-sub {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }
  .kpi-sub strong { color: var(--ink); font-weight: 600; }

  .kpi-delta {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 600;
    margin-top: 6px;
    padding: 2px 6px;
    border-radius: 20px;
  }
  .kpi-delta.down { background: var(--red-light); color: var(--red); }
  .kpi-delta.up   { background: var(--green-light); color: var(--green); }

  .section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .section-ai-badge {
    font-size: 9px;
    font-weight: 600;
    background: var(--accent);
    color: #fff;
    padding: 2px 7px;
    border-radius: 20px;
    letter-spacing: .06em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .claude-warn {
    margin-bottom: 12px;
    font-size: 11px;
    color: #b7791f;
    background: #fffbeb;
    border: 1px solid #fbd38d;
    border-radius: 8px;
    padding: 8px 10px;
  }

  .table-wrap {
    margin-bottom: 22px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }

  thead tr { background: #1a202c; color: #fff; }

  thead th {
    padding: 8px 10px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    text-align: right;
    white-space: nowrap;
  }
  thead th:first-child { text-align: left; }

  .col-group-header {
    background: #2d3748;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: #a0aec0;
    padding: 4px 10px;
    text-align: center;
    border-bottom: none;
  }
  .col-group-header.first { text-align: left; }

  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:last-child { border-bottom: none; }
  tbody tr.total-row,
  tfoot tr.total-row {
    background: #edf2f7;
    font-weight: 700;
    border-top: 2px solid #cbd5e0;
  }

  td {
    padding: 9px 10px;
    text-align: right;
    vertical-align: middle;
  }
  td:first-child { text-align: left; font-weight: 600; }

  .branch-name { font-weight: 600; color: var(--ink); }
  .amt { font-size: 11px; color: var(--muted); }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }
  .pill.up   { background: var(--green-light); color: var(--green); }
  .pill.down { background: var(--red-light); color: var(--red); }
  .pill.flat { background: var(--amber-light); color: var(--amber); }

  .val {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .val-neutral { background: transparent; color: inherit; font-weight: inherit; padding: 0; }
  .val-good { background: var(--green-light); color: var(--green); }
  .val-warn { background: var(--amber-light); color: var(--amber); }
  .val-bad  { background: var(--red-light); color: var(--red); }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: -14px;
    margin-bottom: 20px;
    font-size: 10px;
    color: var(--muted);
  }
  .legend span { display: flex; align-items: center; gap: 4px; }
  .swatch {
    width: 10px; height: 10px;
    border-radius: 2px;
    display: inline-block;
  }

  .narrative-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 22px;
  }

  .narr-card {
    border-radius: 10px;
    border: 1px solid var(--border);
    padding: 14px 16px;
  }
  .narr-card.green  { border-color: var(--green-mid); background: var(--green-light); }
  .narr-card.amber  { border-color: var(--amber-mid); background: var(--amber-light); }
  .narr-card.blue   { border-color: #90cdf4; background: var(--blue-light); }
  .narr-card.grey   { border-color: #cbd5e0; background: #f7fafc; }

  .narr-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .narr-icon {
    width: 22px; height: 22px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px;
    color: #fff;
    flex-shrink: 0;
  }
  .narr-card.green .narr-icon  { background: var(--green); }
  .narr-card.amber .narr-icon  { background: var(--amber); }
  .narr-card.blue  .narr-icon  { background: var(--blue); }
  .narr-card.grey  .narr-icon  { background: #718096; }

  .narr-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .1em;
  }
  .narr-card.green .narr-title { color: var(--green); }
  .narr-card.amber .narr-title { color: var(--amber); }
  .narr-card.blue  .narr-title { color: var(--blue); }
  .narr-card.grey  .narr-title { color: #4a5568; }

  .narr-item {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 1.4;
    align-items: flex-start;
  }
  .narr-item:last-child { margin-bottom: 0; }
  .narr-bullet {
    width: 5px; height: 5px;
    border-radius: 50%;
    margin-top: 5px;
    flex-shrink: 0;
  }
  .narr-card.green .narr-bullet { background: var(--green); }
  .narr-card.amber .narr-bullet { background: var(--amber); }
  .narr-card.blue  .narr-bullet { background: var(--blue); }
  .narr-card.grey  .narr-bullet { background: #718096; }

  .narr-item .branch { font-weight: 700; color: var(--ink); }
  .narr-item .change { color: var(--muted); font-size: 11px; }

  .bottom-line {
    background: #1a202c;
    color: #fff;
    border-radius: 10px;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
  }
  .bl-icon { font-size: 22px; flex-shrink: 0; }
  .bl-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: #a0aec0;
    margin-bottom: 3px;
  }
  .bl-text {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: #fff;
  }
  .bl-text em {
    font-style: normal;
    color: #fbd38d;
  }

  .footer {
    font-size: 10px;
    color: #a0aec0;
    text-align: center;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }

  @media print {
    body { background: white; }
    .page { margin: 0; box-shadow: none; width: 100%; min-height: auto; padding: 16px 18px; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-left">
      <img src="${phoenixLogo}" alt="Phoenix Capital" class="header-logo" />
      <div>
        <div class="report-label">EOD PAR Report</div>
        <div class="report-title">Daily PAR — ${dateLabel}</div>
        <div class="report-subtitle">${country} · Yesterday EOD → Today EOD (~${escapeHtml(eodHour)}:00 EAT)</div>
      </div>
    </div>
    <div class="header-right">
      <div><strong>Yesterday EOD:</strong> ${escapeHtml(slots.eodYesterday?.asOfLabel || '—')} EAT</div>
      <div><strong>Today EOD:</strong> ${escapeHtml(slots.eod?.asOfLabel || '—')} EAT</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card neutral">
      <div class="kpi-label">EOD Yesterday</div>
      <div class="kpi-value">${formatPct(overall.eodYesterday?.parPct)}</div>
      <div class="kpi-sub"><strong>${formatCompact(overall.eodYesterday?.par)}</strong> at risk</div>
    </div>
    <div class="kpi-card ${eodKpiClass}">
      <div class="kpi-label">EOD Today</div>
      <div class="kpi-value">${formatPct(overall.eod?.parPct)}</div>
      <div class="kpi-sub"><strong>${formatCompact(overall.eod?.par)}</strong> at risk</div>
      ${
        eodVsYestPp != null
          ? `<div class="kpi-delta ${eodVsYestPp <= 0 ? 'up' : 'down'}">${eodVsYestPp <= 0 ? '▲' : '▼'} ${formatSignedPp(-eodVsYestPp)} vs yesterday</div>`
          : ''
      }
    </div>
    <div class="kpi-card ${totalShift > 0 ? 'positive' : totalShift < 0 ? 'negative' : 'neutral-mid'}">
      <div class="kpi-label">Risk Reduced</div>
      <div class="kpi-value">${formatSignedCompact(totalShift)}</div>
      <div class="kpi-sub">${formatSignedPp(totalShiftPp)} vs yesterday EOD</div>
    </div>
  </div>

  ${
    claudeError && !claude
      ? `<div class="claude-warn">Claude analysis unavailable: ${escapeHtml(claudeError)}. Showing rule-based narrative below.</div>`
      : ''
  }

  <div class="section-title">Branch Movement</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-group-header first" style="width:22%">Branch</th>
          <th class="col-group-header" colspan="2">EOD Yesterday</th>
          <th class="col-group-header" colspan="2">EOD Today</th>
          <th class="col-group-header" colspan="2">vs Yesterday</th>
        </tr>
        <tr>
          <th style="text-align:left">Branch</th>
          <th>%</th>
          <th>Amount</th>
          <th>%</th>
          <th>Amount</th>
          <th>Amount</th>
          <th>%</th>
        </tr>
      </thead>
      <tbody>
        ${
          rowsHtml ||
          '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px">No branch PAR snapshots found for this date.</td></tr>'
        }
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td>OVERALL</td>
          <td>${formatPct(overall.eodYesterday?.parPct)}</td>
          <td class="amt">${formatCompact(overall.eodYesterday?.par)}</td>
          <td>${valuePill(eodParCellTone(overall.eod?.parPct) || 'neutral', formatPct(overall.eod?.parPct))}</td>
          <td class="amt">${formatCompact(overall.eod?.par)}</td>
          <td>${valuePill(changeCellTone(totalShift, totalShiftPp, overall.eodYesterday?.par), formatSignedCompact(totalShift))}</td>
          <td>${valuePill(changeCellTone(totalShift, totalShiftPp, overall.eodYesterday?.par), formatSignedPp(totalShiftPp))}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="legend">
    <span><span class="swatch" style="background:#f0fff4;border:1px solid var(--green-mid)"></span> EOD % &lt; 8% · or material reduction (≥100K and ≥2% of yesterday PAR, or ≥0.3%)</span>
    <span><span class="swatch" style="background:#fffbeb;border:1px solid var(--amber-mid)"></span> Noise / non-material change</span>
    <span><span class="swatch" style="background:#fff5f5;border:1px solid var(--red-mid)"></span> Material rise</span>
  </div>

  <div class="section-title">
    <span>Claude Analysis</span>
    <span class="section-ai-badge">AI</span>
  </div>
  <div class="narrative-grid">
    <div class="narr-card green">
      <div class="narr-header">
        <div class="narr-icon">✓</div>
        <div class="narr-title">Top Performers Today</div>
      </div>
      ${narrItems(topItems)}
    </div>
    <div class="narr-card grey">
      <div class="narr-header">
        <div class="narr-icon">→</div>
        <div class="narr-title">Holding Steady</div>
      </div>
      ${narrItems(holdItems)}
    </div>
    <div class="narr-card amber">
      <div class="narr-header">
        <div class="narr-icon">⚠</div>
        <div class="narr-title">Watching</div>
      </div>
      ${narrItems(watchItems)}
    </div>
    <div class="narr-card blue">
      <div class="narr-header">
        <div class="narr-icon">✦</div>
        <div class="narr-title">Clean</div>
      </div>
      ${
        cleanItems.length
          ? narrItems(cleanItems)
          : '<div class="narr-item"><span class="narr-bullet"></span><div><span class="change">No zero-PAR branches at EOD.</span></div></div>'
      }
    </div>
  </div>

  <div class="bottom-line">
    <div class="bl-icon">📊</div>
    <div>
      <div class="bl-label">Bottom Line · Claude Analysis</div>
      <div class="bl-text">${bottomLineHtml}</div>
    </div>
  </div>

  <div class="footer">
    Closest PAR snapshots to ~${escapeHtml(eodHour)}:00 Africa/Nairobi (yesterday vs today) · Single-page A4 portrait
  </div>

</div>
</body>
</html>`
}

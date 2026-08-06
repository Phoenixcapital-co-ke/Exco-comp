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
 * Material week move (risk-reduced signed: + = PAR fell).
 * Calibrated from Kenya branch-weeks (Sun/Mon open → Fri/Sat close):
 * reductions-only p25 ≈ 800K / 2.0%; median ≈ 1.6M / 3.3%.
 * Green only for material moves; noise stays yellow.
 */
const MATERIAL_AMT = 750_000
const MATERIAL_PP = 1.5
const MATERIAL_SHARE = 0.03 // ≥3% of SOW PAR amount
const HEALTHY_PAR_PCT = 8

function isMaterialRiskMove(riskAmt, riskPp, sowPar) {
  const amt = Number(riskAmt) || 0
  const pp = Number(riskPp) || 0
  const book = Math.max(0, Number(sowPar) || 0)
  const absAmt = Math.abs(amt)
  const absPp = Math.abs(pp)
  if (absPp >= MATERIAL_PP) return true
  if (absAmt < MATERIAL_AMT) return false
  if (book <= 0) return absAmt >= MATERIAL_AMT
  return absAmt / book >= MATERIAL_SHARE
}

function changeCellTone(riskAmt, riskPp, sowPar) {
  if (riskAmt == null || riskPp == null) return ''
  if (!isMaterialRiskMove(riskAmt, riskPp, sowPar)) return 'warn'
  if (riskAmt > 0 || riskPp > 0) return 'good'
  if (riskAmt < 0 || riskPp < 0) return 'bad'
  return 'warn'
}

function eowParCellTone(parPct) {
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
  if (!items.length) {
    return '<div class="narr-item"><span class="narr-bullet"></span><div><span class="change">None flagged.</span></div></div>'
  }
  return items
    .map((item) => {
      const text = String(item?.text || item?.name || item || '').trim()
      if (!text) return ''
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
 * @param {object} payload — response from GET /api/reports/weekly-par
 */
export function renderWeeklyParReportHTML(payload) {
  const weekLabel = escapeHtml(payload?.weekLabel || payload?.dateLabel || '')
  const country = escapeHtml(payload?.country || 'Kenya')
  const overall = payload?.overall || {}
  const slots = payload?.slots || {}
  const branches = Array.isArray(payload?.branches) ? payload.branches : []
  const narrative = payload?.narrative || {}
  const claude = payload?.claudeAnalysis || null
  const claudeError = payload?.claudeError || null

  // Risk-reduced signed: start − end (positive when PAR fell)
  const riskReducedAmt = -(Number(overall.shiftWeek) || 0)
  const riskReducedPp =
    Number.isFinite(Number(overall.sow?.parPct)) && Number.isFinite(Number(overall.eow?.parPct))
      ? Number(overall.sow.parPct) - Number(overall.eow.parPct)
      : 0

  const eowKpiClass =
    riskReducedPp > 0.15 ? 'positive' : riskReducedPp < -0.15 ? 'negative' : 'neutral-mid'

  const bottomLineRaw = narrative.bottomLine || claude?.bottomLine || '—'
  const bottomLineHtml = escapeHtml(bottomLineRaw)
    .replace(/(\d+(?:\.\d+)?M|\d+(?:\.\d+)?K)/g, '<em>$1</em>')
    .replace(/\b(priority number one|PAR slipped|Mixed\/flat week|excellent week)\b/gi, '<em>$1</em>')

  const reducedItems = narrative.reduced || narrative.topPerformers || []
  const noActionItems = narrative.noAction || narrative.holdingSteady || []
  const healthyItems = narrative.healthy || narrative.clean || []
  const anomalyItems = narrative.anomaly || narrative.watching || []

  const rowsHtml = branches
    .map((b) => {
      const shift = b.shiftWeek
      const riskAmt = shift ? -(Number(shift.parAmt) || 0) : null
      const riskPp = shift ? -(Number(shift.parPctPp) || 0) : null
      const sowPar = Number(b.sow?.par) || 0
      const changeTone = changeCellTone(riskAmt, riskPp, sowPar)
      const eowPctTone = eowParCellTone(b.eow?.parPct)
      return `<tr>
        <td><span class="branch-name">${escapeHtml(b.name)}</span></td>
        <td>${b.hasSow === false ? '—' : formatPct(b.sow?.parPct)}</td>
        <td class="amt">${b.hasSow === false ? '—' : formatCompact(b.sow?.par)}</td>
        <td>${
          b.hasEow === false
            ? '—'
            : valuePill(eowPctTone || 'neutral', `<strong>${formatPct(b.eow?.parPct)}</strong>`)
        }</td>
        <td class="amt">${b.hasEow === false ? '—' : formatCompact(b.eow?.par)}</td>
        <td>${riskAmt != null ? valuePill(changeTone, formatSignedCompact(riskAmt)) : '—'}</td>
        <td>${riskPp != null ? valuePill(changeTone, formatSignedPp(riskPp)) : '—'}</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Weekly PAR Report — ${weekLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --red: #e53e3e; --red-light: #fff5f5; --red-mid: #feb2b2;
    --green: #276749; --green-light: #f0fff4; --green-mid: #9ae6b4;
    --amber: #b7791f; --amber-light: #fffbeb; --amber-mid: #fbd38d;
    --blue: #2b6cb0; --blue-light: #ebf8ff;
    --ink: #1a202c; --muted: #718096; --border: #e2e8f0; --bg: #f7f8fa;
    --white: #ffffff; --accent: #e8561e;
  }
  @page { size: A4 portrait; margin: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg); color: var(--ink); font-size: 13px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    width: 794px; min-height: 1123px; margin: 0 auto; background: var(--white);
    padding: 32px 36px 36px;
  }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 20px; border-bottom: 3px solid var(--accent); margin-bottom: 22px;
  }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .header-logo { height: 60px; width: auto; display: block; flex-shrink: 0; }
  .report-label {
    font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 4px;
  }
  .report-title {
    font-size: 26px; font-weight: 800; color: var(--ink); letter-spacing: -0.02em; line-height: 1.1;
  }
  .report-subtitle { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .header-right { text-align: right; font-size: 11px; color: var(--muted); line-height: 1.7; }
  .header-right strong { color: var(--ink); font-weight: 600; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 22px; }
  .kpi-card {
    background: var(--white); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px; position: relative; overflow: hidden;
  }
  .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .kpi-card.neutral::before { background: #cbd5e0; }
  .kpi-card.neutral-mid::before { background: #718096; }
  .kpi-card.positive::before { background: var(--green); }
  .kpi-card.negative::before { background: var(--red); }
  .kpi-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em;
    color: var(--muted); margin-bottom: 6px;
  }
  .kpi-value { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
  .kpi-card.neutral .kpi-value, .kpi-card.neutral-mid .kpi-value { color: var(--ink); }
  .kpi-card.positive .kpi-value { color: var(--green); }
  .kpi-card.negative .kpi-value { color: var(--red); }
  .kpi-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .kpi-sub strong { color: var(--ink); font-weight: 600; }
  .kpi-delta {
    display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600;
    margin-top: 6px; padding: 2px 6px; border-radius: 20px;
  }
  .kpi-delta.down { background: var(--red-light); color: var(--red); }
  .kpi-delta.up { background: var(--green-light); color: var(--green); }
  .section-title {
    font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;
  }
  .section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .section-ai-badge {
    font-size: 9px; font-weight: 600; background: var(--accent); color: #fff;
    padding: 2px 7px; border-radius: 20px; letter-spacing: .06em; text-transform: uppercase; flex-shrink: 0;
  }
  .claude-warn {
    margin-bottom: 12px; font-size: 11px; color: #b7791f; background: #fffbeb;
    border: 1px solid #fbd38d; border-radius: 8px; padding: 8px 10px;
  }
  .table-wrap { margin-bottom: 18px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: #1a202c; color: #fff; }
  thead th {
    padding: 8px 10px; font-size: 9px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; text-align: right; white-space: nowrap;
  }
  thead th:first-child { text-align: left; }
  .col-group-header {
    background: #2d3748; font-size: 8px; text-transform: uppercase; letter-spacing: .1em;
    color: #a0aec0; padding: 4px 10px; text-align: center; border-bottom: none;
  }
  .col-group-header.first { text-align: left; }
  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:last-child { border-bottom: none; }
  tfoot tr.total-row {
    background: #edf2f7; font-weight: 700; border-top: 2px solid #cbd5e0;
  }
  td {
    padding: 7px 10px; text-align: right; vertical-align: middle; color: var(--ink);
  }
  td:first-child { text-align: left; }
  td.amt { font-variant-numeric: tabular-nums; }
  .branch-name { font-weight: 600; }
  .pill {
    display: inline-block; padding: 2px 7px; border-radius: 20px; font-size: 10px; font-weight: 700;
  }
  .pill.up { background: var(--green-light); color: var(--green); }
  .pill.down { background: var(--red-light); color: var(--red); }
  .pill.flat { background: var(--amber-light); color: var(--amber); }
  .val {
    display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px;
    font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .val-neutral { background: transparent; color: inherit; font-weight: inherit; padding: 0; }
  .val-good { background: var(--green-light); color: var(--green); }
  .val-warn { background: var(--amber-light); color: var(--amber); }
  .val-bad  { background: var(--red-light); color: var(--red); }
  .row-improved { background: transparent; }
  .row-worsened { background: transparent; }
  .row-watch { background: transparent; }
  .row-neutral { background: #fff; }
  .legend {
    display: flex; flex-wrap: wrap; gap: 12px; font-size: 10px; color: var(--muted);
    margin-bottom: 18px;
  }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .narrative-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;
  }
  .narr-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .narr-card.green { border-color: var(--green-mid); background: var(--green-light); }
  .narr-card.red { border-color: var(--red-mid); background: var(--red-light); }
  .narr-card.amber { border-color: var(--amber-mid); background: var(--amber-light); }
  .narr-card.blue { border-color: #90cdf4; background: var(--blue-light); }
  .narr-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .narr-icon {
    width: 22px; height: 22px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .narr-card.green .narr-icon { background: var(--green); }
  .narr-card.red .narr-icon { background: var(--red); }
  .narr-card.amber .narr-icon { background: var(--amber); }
  .narr-card.blue .narr-icon { background: var(--blue); }
  .narr-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .narr-card.green .narr-title { color: var(--green); }
  .narr-card.red .narr-title { color: var(--red); }
  .narr-card.amber .narr-title { color: var(--amber); }
  .narr-card.blue .narr-title { color: var(--blue); }
  .narr-item { display: flex; gap: 8px; margin-bottom: 6px; font-size: 11px; line-height: 1.4; }
  .narr-item:last-child { margin-bottom: 0; }
  .narr-bullet { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
  .narr-card.green .narr-bullet { background: var(--green); }
  .narr-card.red .narr-bullet { background: var(--red); }
  .narr-card.amber .narr-bullet { background: var(--amber); }
  .narr-card.blue .narr-bullet { background: var(--blue); }
  .narr-item .branch { font-weight: 700; color: var(--ink); }
  .narr-item .change { color: var(--muted); font-size: 11px; }
  .bottom-line {
    display: flex; gap: 12px; background: #1a202c; color: #fff; border-radius: 10px;
    padding: 14px 16px; margin-bottom: 16px;
  }
  .bl-icon { font-size: 18px; line-height: 1; }
  .bl-label {
    font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: #a0aec0; margin-bottom: 4px;
  }
  .bl-text { font-size: 12px; line-height: 1.55; }
  .bl-text em { color: #fbd38d; font-style: normal; font-weight: 600; }
  .footer { font-size: 10px; color: var(--muted); text-align: center; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <img src="${phoenixLogo}" alt="Phoenix Capital" class="header-logo" />
      <div>
        <div class="report-label">Weekly PAR Report</div>
        <div class="report-title">Weekly PAR — ${weekLabel}</div>
        <div class="report-subtitle">${country} · Start = Sun 03:00 EAT · End = Sat 20:00 EAT</div>
      </div>
    </div>
    <div class="header-right">
      <div><strong>Week start:</strong> ${escapeHtml(slots.sow?.asOfLabel || '—')} EAT</div>
      <div><strong>Week end:</strong> ${escapeHtml(slots.eow?.asOfLabel || '—')} EAT</div>
      <div><strong>Prior week end:</strong> ${escapeHtml(slots.priorEow?.asOfLabel || '—')} EAT</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card neutral">
      <div class="kpi-label">Start of Week (Sun)</div>
      <div class="kpi-value">${formatPct(overall.sow?.parPct)}</div>
      <div class="kpi-sub"><strong>${formatCompact(overall.sow?.par)}</strong> at risk</div>
    </div>
    <div class="kpi-card ${eowKpiClass}">
      <div class="kpi-label">End of Week (Sat)</div>
      <div class="kpi-value">${formatPct(overall.eow?.parPct)}</div>
      <div class="kpi-sub"><strong>${formatCompact(overall.eow?.par)}</strong> at risk</div>
      <div class="kpi-delta ${riskReducedPp >= 0 ? 'up' : 'down'}">${riskReducedPp >= 0 ? '▲' : '▼'} ${formatSignedPp(riskReducedPp)} vs start</div>
    </div>
    <div class="kpi-card ${riskReducedAmt >= 0 ? 'positive' : 'negative'}">
      <div class="kpi-label">Risk Reduced This Week</div>
      <div class="kpi-value">${formatSignedCompact(riskReducedAmt)}</div>
      <div class="kpi-sub">${riskReducedAmt >= 0 ? 'PAR down vs Sunday open' : 'PAR up vs Sunday open — escalate'}</div>
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
          <th class="col-group-header first" style="width:18%">Branch</th>
          <th class="col-group-header" colspan="2">Start of Week</th>
          <th class="col-group-header" colspan="2">End of Week</th>
          <th class="col-group-header" colspan="2">EOW − SOW (risk ↓ +)</th>
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
          '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px">No branch PAR snapshots found for this week.</td></tr>'
        }
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td>OVERALL</td>
          <td>${formatPct(overall.sow?.parPct)}</td>
          <td class="amt">${formatCompact(overall.sow?.par)}</td>
          <td>${valuePill(eowParCellTone(overall.eow?.parPct) || 'neutral', formatPct(overall.eow?.parPct))}</td>
          <td class="amt">${formatCompact(overall.eow?.par)}</td>
          <td>${valuePill(changeCellTone(riskReducedAmt, riskReducedPp, overall.sow?.par), formatSignedCompact(riskReducedAmt))}</td>
          <td>${valuePill(changeCellTone(riskReducedAmt, riskReducedPp, overall.sow?.par), formatSignedPp(riskReducedPp))}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="legend">
    <span><span class="swatch" style="background:#f0fff4;border:1px solid var(--green-mid)"></span> EOW % &lt; 8% · or material reduction (≥750K and ≥3% of SOW PAR, or ≥1.5%)</span>
    <span><span class="swatch" style="background:#fffbeb;border:1px solid var(--amber-mid)"></span> Noise / non-material change</span>
    <span><span class="swatch" style="background:#fff5f5;border:1px solid var(--red-mid)"></span> Material rise</span>
  </div>

  <div class="section-title">
    <span>Weekly Commentary</span>
    <span class="section-ai-badge">AI</span>
  </div>
  <div class="narrative-grid">
    <div class="narr-card green">
      <div class="narr-header">
        <div class="narr-icon">✓</div>
        <div class="narr-title">Reduced This Week</div>
      </div>
      ${narrItems(reducedItems)}
    </div>
    <div class="narr-card red">
      <div class="narr-header">
        <div class="narr-icon">!</div>
        <div class="narr-title">No Action (≥8% flat)</div>
      </div>
      ${narrItems(noActionItems)}
    </div>
    <div class="narr-card amber">
      <div class="narr-header">
        <div class="narr-icon">⚠</div>
        <div class="narr-title">Anomaly (rose)</div>
      </div>
      ${narrItems(anomalyItems)}
    </div>
    <div class="narr-card blue">
      <div class="narr-header">
        <div class="narr-icon">✦</div>
        <div class="narr-title">Healthy (&lt;8%)</div>
      </div>
      ${narrItems(healthyItems)}
    </div>
  </div>

  <div class="bottom-line">
    <div class="bl-icon">📊</div>
    <div>
      <div class="bl-label">Bottom Line · Weekly</div>
      <div class="bl-text">${bottomLineHtml}</div>
    </div>
  </div>

  <div class="footer">
    Sun 03:00 → Sat 20:00 Africa/Nairobi · Positive change = risk reduced · Single-page A4 portrait
  </div>
</div>
</body>
</html>`
}

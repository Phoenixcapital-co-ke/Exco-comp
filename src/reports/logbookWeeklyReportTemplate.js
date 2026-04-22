import { formatKES } from '../utils/format.js'

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatPct(v, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.00%'
  return `${n.toFixed(digits)}%`
}

function formatShortMillions(v) {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

function deltaMeta(curr, prev) {
  const c = Number(curr) || 0
  const p = Number(prev) || 0
  const diff = c - p
  const pct = p !== 0 ? (diff / p) * 100 : c !== 0 ? 100 : 0
  return { diff, pct }
}

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return { week: weekNo, year: d.getUTCFullYear() }
}

function dmyLong(date) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

function ragFromComposite(score) {
  const s = Number(score) || 0
  if (s >= 70) return { label: 'GREEN', cls: 'badge-green' }
  if (s >= 45) return { label: 'AMBER', cls: 'badge-amber' }
  return { label: 'RED', cls: 'badge-red' }
}

function parDotColor(parRate, threshold = 12) {
  const p = Number(parRate) || 0
  if (p <= threshold) return 'var(--green)'
  if (p <= threshold + 5) return '#BF8F00'
  return 'var(--red)'
}

function progressFillClass(pct) {
  const p = Number(pct) || 0
  if (p >= 70) return 'fill-green'
  if (p >= 35) return 'fill-amber'
  return 'fill-red'
}

export function renderLogbookWeeklyPerformanceReportHTML(payload) {
  const asAt = payload?.asAt ? new Date(payload.asAt) : new Date()
  const { week, year } = isoWeekLabel(asAt)

  const branchesCount = Number(payload?.branchesCount) || 0
  const branchesLabel = payload?.branchesLabel != null ? String(payload.branchesLabel) : String(branchesCount)
  const statusText = payload?.statusText || 'Action Required'
  const statusColor = payload?.statusColor || 'var(--red)'

  const kpi = payload?.kpis || {}
  const prevKpi = payload?.prevKpis || {}

  const salesDelta = deltaMeta(kpi.salesMtd, prevKpi.salesMtd)
  const colDelta = deltaMeta(kpi.collectionsMtd, prevKpi.collectionsMtd)
  const portDelta = deltaMeta(kpi.portfolio, prevKpi.portfolio)
  const parDeltaPp = (Number(kpi.avgParRate) || 0) - (Number(prevKpi.avgParRate) || 0)

  const branchRows = Array.isArray(payload?.branchOverviewRows) ? payload.branchOverviewRows : []
  const parWoWRows = Array.isArray(payload?.parWoWRows) ? payload.parWoWRows : []
  const portfolioMoveRows = Array.isArray(payload?.portfolioMovementRows) ? payload.portfolioMovementRows : []
  const scorecardRows = Array.isArray(payload?.scorecardRows) ? payload.scorecardRows : []

  const totals = payload?.totals || {}

  const badgeStatus = statusText
  const missingDataItems = Array.isArray(payload?.missingDataItems)
    ? payload.missingDataItems
    : [
        'Loan count per branch (active, new, closed)',
        'Loan officer / agent-level breakdown',
        'PAR aging buckets: 1–30, 31–60, 61–90, 90+ days',
        'Write-offs & provisioning / coverage ratio',
        'Average loan size & average tenor (months)',
        'Disbursement count vs repayment count',
        'YTD cumulative sales & collections columns',
        'Client count: active, new, churned per branch',
        'Kampala FX rate (UGX/KES) used for translation',
        'Cost of funds % & Net Interest Margin estimate',
      ]

  const parThreshold = Number(payload?.parThreshold ?? 12)
  const branchesInBreach = Number(payload?.branchesInBreach ?? 0)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Phoenix Capital – Weekly Performance Report</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --navy: #1F3864;
    --navy-mid: #2E75B6;
    --navy-light: #BDD7EE;
    --orange: #E97132;
    --red: #C00000;
    --red-light: #FFDDD5;
    --amber: #7F6000;
    --amber-light: #FFF2CC;
    --green: #375623;
    --green-light: #E2EFDA;
    --grey: #F5F5F5;
    --border: #D6D6D6;
    --text: #1a1a1a;
    --text-muted: #5a5a5a;
    --page-bg: #FAFAF8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'DM Sans', sans-serif;
    font-size: 10pt;
    color: var(--text);
    background: var(--page-bg);
    line-height: 1.5;
  }

  /* ── PAGE LAYOUT ── */
  .page {
    width: 297mm;
    min-height: 210mm;
    background: white;
    margin: 0 auto 8mm;
    padding: 14mm 16mm 12mm;
    position: relative;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  @media print {
    body { background: white; }
    /* Print on A4 portrait but preserve original landscape-designed layout.
       We scale the entire page down to fit within portrait width (210mm). */
    .page {
      margin: 0;
      box-shadow: none;
      page-break-after: always;
      width: 297mm;
      min-height: 210mm;
      overflow: hidden;
      transform: scale(0.7071);
      transform-origin: top left;
    }
    .page:last-child { page-break-after: avoid; }
    @page { size: A4 portrait; margin: 0; }
  }

  /* ── HEADER ── */
  .report-header {
    display: flex;
    align-items: stretch;
    margin-bottom: 10mm;
    border-bottom: 3px solid var(--navy);
    padding-bottom: 6mm;
  }
  .logo-block {
    background: var(--navy);
    color: white;
    padding: 8px 16px;
    margin-right: 20px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 120px;
    clip-path: polygon(0 0, 100% 0, 92% 100%, 0 100%);
    padding-right: 24px;
  }
  .logo-block .org { font-family: 'Playfair Display', serif; font-size: 13pt; font-weight: 800; letter-spacing: -0.5px; }
  .logo-block .sub { font-size: 7pt; letter-spacing: 2px; text-transform: uppercase; opacity: 0.8; margin-top: 2px; }
  .header-info { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .report-title { font-family: 'Playfair Display', serif; font-size: 17pt; font-weight: 700; color: var(--navy); line-height: 1.2; }
  .report-meta { display: flex; gap: 20px; margin-top: 5px; flex-wrap: wrap; }
  .meta-chip {
    font-size: 7.5pt; font-weight: 500; color: var(--text-muted);
    border: 1px solid var(--border); border-radius: 3px; padding: 2px 8px;
    font-family: 'DM Mono', monospace;
  }
  .meta-chip span { color: var(--navy); font-weight: 600; }
  .header-kpis { display: flex; gap: 12px; align-items: center; }
  .hkpi {
    text-align: center; padding: 6px 12px;
    border-left: 2px solid var(--border);
  }
  .hkpi:first-child { border-left: none; }
  .hkpi .val { font-size: 12pt; font-weight: 600; color: var(--navy); font-family: 'DM Mono', monospace; }
  .hkpi .lbl { font-size: 6.5pt; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
  .hkpi .delta { font-size: 7pt; font-weight: 500; }
  .delta-down { color: var(--red); }
  .delta-up { color: var(--green); }
  .delta-warn { color: var(--amber); }

  /* ── SECTION TITLES ── */
  .section-title {
    font-family: 'DM Sans', sans-serif;
    font-size: 7pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 2px;
    color: var(--navy);
    border-left: 3px solid var(--orange);
    padding-left: 7px;
    margin: 8mm 0 4mm;
  }

  /* ── TABLES ── */
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  thead tr { background: var(--navy); color: white; }
  thead th {
    padding: 5px 7px; text-align: left; font-weight: 500;
    font-size: 7.5pt; letter-spacing: 0.3px;
  }
  thead th.num { text-align: right; }
  tbody tr:nth-child(even) { background: #F8F9FC; }
  tbody tr:hover { background: var(--navy-light); }
  tbody td { padding: 4px 7px; border-bottom: 0.5px solid var(--border); vertical-align: middle; }
  tbody td.num { text-align: right; font-family: 'DM Mono', monospace; font-size: 8pt; }
  tbody td.branch { font-weight: 500; }
  tfoot tr { background: #E8EEF7; font-weight: 600; }
  tfoot td { padding: 5px 7px; border-top: 2px solid var(--navy); font-family: 'DM Mono', monospace; font-size: 8pt; }
  tfoot td.num { text-align: right; }

  /* ── STATUS BADGES ── */
  .badge {
    display: inline-block; border-radius: 2px;
    padding: 1px 6px; font-size: 7pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
  }
  .badge-red { background: var(--red-light); color: var(--red); }
  .badge-amber { background: var(--amber-light); color: var(--amber); }
  .badge-green { background: var(--green-light); color: var(--green); }
  .badge-blue { background: var(--navy-light); color: var(--navy); }
  .badge-crit { background: var(--red); color: white; }
  .badge-high { background: var(--orange); color: white; }
  .badge-med { background: #888; color: white; }
  .badge-low { background: #bbb; color: white; }

  /* ── PROGRESS BAR ── */
  .progress-wrap { display: flex; align-items: center; gap: 6px; }
  .progress-bar { flex: 1; height: 5px; background: var(--grey); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 2px; }
  .progress-fill.fill-green { background: #375623; }
  .progress-fill.fill-amber { background: #BF8F00; }
  .progress-fill.fill-red { background: var(--red); }
  .progress-label { font-family: 'DM Mono', monospace; font-size: 7.5pt; font-weight: 500; min-width: 36px; text-align: right; }

  /* ── PAR INDICATOR ── */
  .par-cell { display: flex; align-items: center; gap: 4px; }
  .par-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

  /* ── 2-COL LAYOUT ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-bottom: 6mm; }
  .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6mm; margin-bottom: 6mm; }

  /* ── KPI CARDS ── */
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5mm; margin-bottom: 7mm; }
  .kpi-card {
    border: 1px solid var(--border);
    border-top: 3px solid var(--navy);
    padding: 7px 10px 8px;
    background: white;
  }
  .kpi-card.warn { border-top-color: var(--orange); }
  .kpi-card.danger { border-top-color: var(--red); }
  .kpi-card.good { border-top-color: #375623; }
  .kpi-card .kpi-label { font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 4px; }
  .kpi-card .kpi-value { font-size: 14pt; font-weight: 600; color: var(--navy); font-family: 'DM Mono', monospace; line-height: 1; }
  .kpi-card .kpi-delta { font-size: 7.5pt; margin-top: 4px; }
  .kpi-card .kpi-note { font-size: 6.5pt; color: var(--text-muted); margin-top: 3px; line-height: 1.4; }

  /* ── RECOMMENDATIONS ── */
  .rec-item {
    display: grid;
    grid-template-columns: 22px 1fr 90px 60px 100px 80px;
    gap: 0 8px;
    align-items: start;
    padding: 5px 7px;
    border-bottom: 0.5px solid var(--border);
    font-size: 8.5pt;
  }
  .rec-item:nth-child(even) { background: #F8F9FC; }
  .rec-item .rec-num { font-family: 'DM Mono', monospace; color: var(--text-muted); font-size: 8pt; padding-top: 1px; }
  .rec-item .rec-text { line-height: 1.45; }
  .rec-item .rec-cat { font-size: 7.5pt; color: var(--text-muted); padding-top: 1px; }
  .rec-item .rec-owner { font-size: 7.5pt; color: var(--text-muted); padding-top: 1px; }
  .rec-item .rec-due { font-family: 'DM Mono', monospace; font-size: 7.5pt; color: var(--text-muted); padding-top: 1px; }
  .rec-header {
    display: grid;
    grid-template-columns: 22px 1fr 90px 60px 100px 80px;
    gap: 0 8px;
    padding: 5px 7px;
    background: var(--navy);
    color: white;
    font-size: 7.5pt;
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  /* ── MISSING DATA ALERT ── */
  .alert-box {
    border: 1px solid var(--orange);
    border-left: 4px solid var(--orange);
    background: #FEF6EE;
    padding: 7px 10px;
    margin-bottom: 5mm;
    font-size: 8pt;
  }
  .alert-box strong { color: var(--orange); display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .missing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px 12px; }
  .missing-item { display: flex; align-items: flex-start; gap: 5px; font-size: 7.5pt; color: var(--text-muted); line-height: 1.4; }
  .missing-item::before { content: "○"; color: var(--orange); font-size: 8pt; flex-shrink: 0; margin-top: 0px; }

  /* ── BRANCH SCORECARD ── */
  .scorecard-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 0.5px solid var(--border); }
  .sc-branch { width: 90px; font-weight: 500; font-size: 8.5pt; }
  .sc-bar-wrap { flex: 1; }
  .sc-score { font-family: 'DM Mono', monospace; font-size: 8pt; width: 36px; text-align: right; font-weight: 600; }
  .sc-rag { width: 50px; text-align: center; }

  /* ── FOOTER ── */
  .page-footer {
    position: absolute; bottom: 8mm; left: 16mm; right: 16mm;
    border-top: 1px solid var(--border);
    padding-top: 4px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 6.5pt; color: var(--text-muted);
  }
  .page-footer .confidential { font-weight: 600; color: var(--navy); letter-spacing: 1px; text-transform: uppercase; }

  /* ── NARRATIVE SUMMARY BOX ── */
  .summary-box {
    background: #F0F4FA;
    border-left: 4px solid var(--navy-mid);
    padding: 8px 12px;
    margin-bottom: 6mm;
    font-size: 8.5pt;
    line-height: 1.6;
  }
  .summary-box .sum-title { font-weight: 600; color: var(--navy); font-size: 8.5pt; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.8px; font-size: 7.5pt; }

  /* ── BRANCH TAGS ── */
  .critical-tag { font-size: 6.5pt; background: var(--red); color: white; padding: 0 4px; border-radius: 2px; margin-left: 4px; vertical-align: middle; }
  .watch-tag { font-size: 6.5pt; background: var(--orange); color: white; padding: 0 4px; border-radius: 2px; margin-left: 4px; vertical-align: middle; }
  .good-tag { font-size: 6.5pt; background: #375623; color: white; padding: 0 4px; border-radius: 2px; margin-left: 4px; vertical-align: middle; }

  .divider { border: none; border-top: 1px solid var(--border); margin: 6mm 0; }

  .inline-note { font-size: 7pt; color: var(--text-muted); font-style: italic; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE 1 – EXECUTIVE SUMMARY & BRANCH OVERVIEW
═══════════════════════════════════════════════════════════════ -->
<div class="page">

  <header class="report-header">
    <div class="logo-block">
      <div class="org">Phoenix<br>Capital</div>
      <div class="sub">Limited</div>
    </div>
    <div class="header-info">
      <div class="report-title">Logbook Product – Weekly Performance Report</div>
      <div class="report-meta">
        <div class="meta-chip">Period: <span>As at ${escapeHtml(dmyLong(asAt))}</span></div>
        <div class="meta-chip">Week: <span>W${escapeHtml(String(week))} / ${escapeHtml(String(year))}</span></div>
        <div class="meta-chip">Branches: <span>${escapeHtml(branchesLabel)}</span></div>
        <div class="meta-chip">Status: <span style="color:${escapeHtml(statusColor)}">${escapeHtml(badgeStatus)}</span></div>
      </div>
    </div>
    <div class="header-kpis">
      <div class="hkpi">
        <div class="val">${escapeHtml(formatShortMillions(kpi.salesMtd))}</div>
        <div class="lbl">Sales (KES)</div>
        <div class="delta ${salesDelta.diff < 0 ? 'delta-down' : 'delta-up'}">${salesDelta.diff < 0 ? '▼' : '▲'} ${escapeHtml(Math.abs(salesDelta.pct).toFixed(1))}%</div>
      </div>
      <div class="hkpi">
        <div class="val">${escapeHtml(formatShortMillions(kpi.collectionsMtd))}</div>
        <div class="lbl">Collections (KES)</div>
        <div class="delta ${colDelta.diff < 0 ? 'delta-down' : 'delta-up'}">${colDelta.diff < 0 ? '▼' : '▲'} ${escapeHtml(Math.abs(colDelta.pct).toFixed(1))}%</div>
      </div>
      <div class="hkpi">
        <div class="val">${escapeHtml(formatShortMillions(kpi.portfolio))}</div>
        <div class="lbl">Portfolio (KES)</div>
        <div class="delta ${portDelta.diff < 0 ? 'delta-down' : 'delta-up'}">${portDelta.diff < 0 ? '▼' : '▲'} ${escapeHtml(Math.abs(portDelta.pct).toFixed(1))}%</div>
      </div>
      <div class="hkpi">
        <div class="val">${escapeHtml(formatPct(kpi.avgParRate, 1))}</div>
        <div class="lbl">Avg PAR</div>
        <div class="delta delta-warn">⚠ ${parDeltaPp >= 0 ? '+' : ''}${escapeHtml(parDeltaPp.toFixed(1))}pp</div>
      </div>
    </div>
  </header>

  <div class="summary-box">
    <div class="sum-title">Executive Summary</div>
    ${escapeHtml(payload?.executiveSummary || 'This report is generated from live system data. Review branch sales, collections, portfolio and PAR performance below.')}
  </div>

  <div class="kpi-grid">
    <div class="kpi-card ${String(payload?.kpiCardClasses?.sales || 'danger')}">
      <div class="kpi-label">Total Sales</div>
      <div class="kpi-value">${escapeHtml(formatKES(kpi.salesMtd))}</div>
      <div class="kpi-delta ${salesDelta.diff < 0 ? 'delta-down' : 'delta-up'}">${salesDelta.diff < 0 ? '▼' : '▲'} KES ${escapeHtml(formatKES(Math.abs(salesDelta.diff)).replace('Ksh ', '').replace('KES ', ''))} (${salesDelta.pct < 0 ? '−' : ''}${escapeHtml(Math.abs(salesDelta.pct).toFixed(1))}%)</div>
      <div class="kpi-note">${escapeHtml(formatPct(totals?.salesTargetAchPct, 1))} of KES ${escapeHtml(formatKES(totals?.salesTargetTotal || 0))} target.</div>
    </div>
    <div class="kpi-card ${String(payload?.kpiCardClasses?.collections || 'danger')}">
      <div class="kpi-label">Total Collections</div>
      <div class="kpi-value">${escapeHtml(formatKES(kpi.collectionsMtd))}</div>
      <div class="kpi-delta ${colDelta.diff < 0 ? 'delta-down' : 'delta-up'}">${colDelta.diff < 0 ? '▼' : '▲'} KES ${escapeHtml(formatKES(Math.abs(colDelta.diff)).replace('Ksh ', '').replace('KES ', ''))} (${colDelta.pct < 0 ? '−' : ''}${escapeHtml(Math.abs(colDelta.pct).toFixed(1))}%)</div>
      <div class="kpi-note">${escapeHtml(formatPct(totals?.collectionsTargetAchPct, 1))} of KES ${escapeHtml(formatKES(totals?.collectionsTargetTotal || 0))} target.</div>
    </div>
    <div class="kpi-card ${String(payload?.kpiCardClasses?.portfolio || 'warn')}">
      <div class="kpi-label">Portfolio Size</div>
      <div class="kpi-value">${escapeHtml(formatKES(kpi.portfolio))}</div>
      <div class="kpi-delta ${portDelta.diff < 0 ? 'delta-down' : 'delta-up'}">${portDelta.diff < 0 ? '▼' : '▲'} KES ${escapeHtml(formatKES(Math.abs(portDelta.diff)).replace('Ksh ', '').replace('KES ', ''))} (${portDelta.pct < 0 ? '−' : ''}${escapeHtml(Math.abs(portDelta.pct).toFixed(1))}%)</div>
      <div class="kpi-note">Portfolio from PAR snapshot.</div>
    </div>
    <div class="kpi-card ${String(payload?.kpiCardClasses?.par || 'danger')}">
      <div class="kpi-label">Average PAR</div>
      <div class="kpi-value">${escapeHtml(formatPct(kpi.avgParRate, 2))}</div>
      <div class="kpi-delta delta-warn">▲ ${parDeltaPp >= 0 ? '+' : ''}${escapeHtml(parDeltaPp.toFixed(2))}pp from ${escapeHtml(formatPct(prevKpi.avgParRate, 2))}</div>
      <div class="kpi-note">PAR balance: KES ${escapeHtml(formatKES(kpi.parBalance || 0))}. Limit: ${escapeHtml(formatPct(parThreshold, 2))}. Breach: ${escapeHtml(String(branchesInBreach))}/${escapeHtml(String(branchesCount))}.</div>
    </div>
  </div>

  <div class="section-title">Branch Performance Overview</div>
  <table>
    <thead>
      <tr>
        <th>Branch</th>
        <th class="num">Sales (KES)</th>
        <th>Sales vs Target</th>
        <th class="num">Collections (KES)</th>
        <th class="num">Collection Rate</th>
        <th class="num">Portfolio (KES)</th>
        <th>PAR %</th>
        <th>PAR Status</th>
        <th>Branch RAG</th>
      </tr>
    </thead>
    <tbody>
      ${branchRows.map((r) => {
        const salesPct = Number(r.salesTargetAchPct) || 0
        const colPct = Number(r.collectionsTargetAchPct) || 0
        const parPct = Number(r.parRate) || 0
        const parStatus = parPct > parThreshold ? { cls: 'badge-red', text: 'Breach' } : { cls: 'badge-green', text: 'Within' }
        const rag = ragFromComposite(r.compositeScore)
        const tag = r.tag === 'CRIT' ? '<span class="critical-tag">CRIT</span>' : r.tag === 'WATCH' ? '<span class="watch-tag">WATCH</span>' : r.tag === 'BEST' ? '<span class="good-tag">BEST</span>' : ''
        return `
      <tr>
        <td class="branch">${escapeHtml(r.branch)} ${tag}</td>
        <td class="num">${escapeHtml(formatKES(r.salesMtd))}</td>
        <td>
          <div class="progress-wrap">
            <div class="progress-bar"><div class="progress-fill ${progressFillClass(salesPct)}" style="width:${Math.max(0, Math.min(100, salesPct)).toFixed(1)}%"></div></div>
            <div class="progress-label">${escapeHtml(salesPct.toFixed(1))}%</div>
          </div>
        </td>
        <td class="num">${escapeHtml(formatKES(r.collectionsMtd))}</td>
        <td class="num">${escapeHtml(colPct.toFixed(1))}%</td>
        <td class="num">${escapeHtml(formatKES(r.portfolio))}</td>
        <td><div class="par-cell"><div class="par-dot" style="background:${escapeHtml(parDotColor(parPct, parThreshold))}"></div> ${escapeHtml(parPct.toFixed(2))}%</div></td>
        <td><span class="badge ${parStatus.cls}">${escapeHtml(parStatus.text)}</span></td>
        <td><span class="badge ${rag.cls}">${escapeHtml(rag.label)}</span></td>
      </tr>`
      }).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td class="branch">TOTAL</td>
        <td class="num">${escapeHtml(formatKES(totals.salesMtdTotal || 0))}</td>
        <td style="font-size:8pt;font-style:italic;color:var(--text-muted)">${escapeHtml(formatPct(totals.salesTargetAchPct, 1))} of target</td>
        <td class="num">${escapeHtml(formatKES(totals.collectionsMtdTotal || 0))}</td>
        <td class="num">${escapeHtml((Number(totals.collectionsTargetAchPct) || 0).toFixed(2))}%</td>
        <td class="num">${escapeHtml(formatKES(totals.portfolioTotal || 0))}</td>
        <td colspan="2" style="font-family:'DM Mono',monospace;font-size:8pt;">Avg PAR: ${escapeHtml((Number(kpi.avgParRate) || 0).toFixed(2))}% &nbsp;|&nbsp; PAR Bal: ${escapeHtml(formatKES(kpi.parBalance || 0))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="two-col" style="margin-top:5mm">
    <div>
      <div class="section-title" style="margin-top:0">PAR Analysis – Week over Week</div>
      <table>
        <thead>
          <tr>
            <th>Branch</th>
            <th class="num">Prev PAR%</th>
            <th class="num">Curr PAR%</th>
            <th class="num">Change (pp)</th>
            <th class="num">PAR Balance (KES)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${parWoWRows.map((r) => {
            const ch = (Number(r.currParRate) || 0) - (Number(r.prevParRate) || 0)
            const chColor = ch > 0.01 ? 'var(--red)' : ch < -0.01 ? 'var(--green)' : 'inherit'
            return `<tr>
              <td class="branch">${escapeHtml(r.branch)}</td>
              <td class="num">${escapeHtml((Number(r.prevParRate) || 0).toFixed(2))}%</td>
              <td class="num">${escapeHtml((Number(r.currParRate) || 0).toFixed(2))}%</td>
              <td class="num" style="color:${escapeHtml(chColor)}">${escapeHtml((ch >= 0 ? '+' : '') + ch.toFixed(2))}</td>
              <td class="num">${escapeHtml(formatKES(r.parBalance || 0))}</td>
              <td>${escapeHtml(r.statusBadgeHtml || '')}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>

    <div>
      <div class="section-title" style="margin-top:0">Portfolio Movement – Branch Detail</div>
      <table>
        <thead>
          <tr>
            <th>Branch</th>
            <th class="num">Prev (KES)</th>
            <th class="num">Current (KES)</th>
            <th class="num">Growth</th>
            <th class="num">Share %</th>
          </tr>
        </thead>
        <tbody>
          ${portfolioMoveRows.map((r) => {
            const growth = (Number(r.current) || 0) - (Number(r.prev) || 0)
            const growthColor = growth >= 0 ? 'var(--green)' : 'var(--red)'
            return `<tr>
              <td class="branch">${escapeHtml(r.branch)}</td>
              <td class="num">${escapeHtml(formatKES(r.prev || 0))}</td>
              <td class="num">${escapeHtml(formatKES(r.current || 0))}</td>
              <td class="num" style="color:${escapeHtml(growthColor)}">${escapeHtml((growth >= 0 ? '+' : '−') + formatKES(Math.abs(growth)).replace('Ksh ', '').replace('KES ', ''))}</td>
              <td class="num">${escapeHtml((Number(r.sharePct) || 0).toFixed(2))}%</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <div class="page-footer">
    <span class="confidential">Confidential</span>
    <span>Phoenix Capital Limited &nbsp;|&nbsp; Logbook Product – Weekly Report &nbsp;|&nbsp; ${escapeHtml(dmyLong(asAt))}</span>
    <span>Page 1 of 3</span>
  </div>
</div>


<!-- ═══════════════════════════════════════════════════════════════
     PAGE 2 – PAR DETAIL + PORTFOLIO + MISSING DATA
═══════════════════════════════════════════════════════════════ -->
<div class="page">

  <div class="two-col">
    <div>
      <div class="section-title" style="margin-top:0">Branch Composite Scorecard</div>
      <div class="scorecard-row" style="font-size:7pt;color:var(--text-muted);border-bottom:1.5px solid var(--navy);padding-bottom:3px">
        <div style="width:90px;font-weight:600">Branch</div>
        <div style="flex:1;font-weight:600">Score (Sales 25 | Collections 25 | PAR 25 | Portfolio 25)</div>
        <div style="width:36px;text-align:right;font-weight:600">/100</div>
        <div style="width:50px;text-align:center;font-weight:600">RAG</div>
      </div>
      ${scorecardRows.map((r) => {
        const rag = ragFromComposite(r.score)
        const width = Math.max(0, Math.min(100, Number(r.score) || 0))
        const fill = width >= 70 ? 'fill-green' : width >= 45 ? 'fill-amber' : 'fill-red'
        return `<div class="scorecard-row">
          <div class="sc-branch">${escapeHtml(r.branch)}</div>
          <div class="sc-bar-wrap"><div class="progress-bar"><div class="progress-fill ${fill}" style="width:${escapeHtml(String(width))}%"></div></div></div>
          <div class="sc-score">${escapeHtml(String(Math.round(width)))}</div>
          <div class="sc-rag"><span class="badge ${rag.cls}">${escapeHtml(rag.label)}</span></div>
        </div>`
      }).join('')}
    </div>
    <div>
      <div class="section-title" style="margin-top:0">Data Gaps</div>
      <div class="alert-box" style="margin:0">
        <strong>⚠ Data Gaps – Fields Missing From Current Report (Add to Future Submissions)</strong>
        <div class="missing-grid">
          ${missingDataItems.map((x) => `<div class="missing-item">${escapeHtml(x)}</div>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="page-footer">
    <span class="confidential">Confidential</span>
    <span>Phoenix Capital Limited &nbsp;|&nbsp; Logbook Product – Weekly Report &nbsp;|&nbsp; ${escapeHtml(dmyLong(asAt))}</span>
    <span>Page 2 of 3</span>
  </div>
</div>


<!-- ═══════════════════════════════════════════════════════════════
     PAGE 3 – FULL RECOMMENDATIONS ACTION PLAN
═══════════════════════════════════════════════════════════════ -->
<div class="page">

  <div class="rec-header">
    <div>#</div>
    <div>Recommendation</div>
    <div>Category</div>
    <div>Priority</div>
    <div>Owner</div>
    <div>Target</div>
  </div>

  ${payload?.recommendationsHtml || ''}

  <div class="page-footer">
    <span class="confidential">Confidential</span>
    <span>Phoenix Capital Limited &nbsp;|&nbsp; Logbook Product – Weekly Report &nbsp;|&nbsp; ${escapeHtml(dmyLong(asAt))}</span>
    <span>Page 3 of 3</span>
  </div>
</div>

</body>
</html>`
}


import { formatCurrency } from '../utils/format.js'

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmt(value, currency = 'KES') {
  return formatCurrency(Number(value) || 0, currency)
}

function fmtKpi(row) {
  if (row.unit === '%') return `${Number(row.current).toFixed(1)}%`
  return fmt(row.current, row.unit || 'KES')
}

function fmtKpiPrev(row) {
  if (row.unit === '%') return `${Number(row.previous).toFixed(1)}%`
  return fmt(row.previous, row.unit || 'KES')
}

function fmtVar(v) {
  const n = Number(v) || 0
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function parClass(v) {
  const n = Number(v) || 0
  if (n <= 6) return 'par-green'
  if (n <= 8) return 'par-amber'
  return 'par-red'
}

function parCell(v) {
  if (v == null || v === '') return '<td class="num">—</td>'
  return `<td class="num ${parClass(v)}">${Number(v).toFixed(1)}%</td>`
}

function obsList(items) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return ''
  return `<div class="obs"><div class="obs-title">Key Observations</div><ul>${list.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>`
}

function pctCell(v) {
  if (v == null || v === '') return '<td class="num">—</td>'
  return `<td class="num">${Number(v).toFixed(1)}%</td>`
}

function branchPerfTable({
  branches,
  totals,
  currency,
  currLabel,
  prevLabel,
  showCollectionRate = false,
  logbookParColumns = false,
  productColumnMode = null,
}) {
  const parColLabel =
    productColumnMode === 'zidisha' ? 'PAR 30' : productColumnMode === 'boda' ? 'PAR' : logbookParColumns ? 'PAR 30' : 'PAR&gt;30%'
  const lastColLabel = logbookParColumns ? 'Total PAR' : 'Vs Target'
  const slimProduct = productColumnMode === 'zidisha' || productColumnMode === 'boda'
  const parVal = (b) => {
    if (productColumnMode === 'zidisha') return b.par30Rate
    if (productColumnMode === 'boda') return b.parRate
    return logbookParColumns ? b.par30Rate : b.parOver30 ?? b.parRate
  }
  const lastVal = (b) => (logbookParColumns ? b.parRate : null)
  const parTotalVal = (t) => {
    if (productColumnMode === 'zidisha') return t.par30Rate
    if (productColumnMode === 'boda') return t.parRate
    return logbookParColumns ? t.par30Rate : t.parOver30 ?? t.parRate
  }
  const lastTotalVal = (t) => (logbookParColumns ? t.parRate : null)

  const collRateCol = showCollectionRate
    ? (b) => pctCell(b.collectionRate)
    : () => ''
  const collRateHead = showCollectionRate ? '<th class="num">Collection<br>Rate</th>' : ''
  const collRateTotal = showCollectionRate ? pctCell(totals?.collectionRate) : ''
  const nplHead = slimProduct ? '' : '<th class="num">NPL%</th>'
  const lastHead = slimProduct ? '' : `<th class="num">${lastColLabel}</th>`

  const body = (branches || [])
    .map(
      (b) => `<tr>
        <td>${escapeHtml(b.name)}</td>
        <td class="num">${fmt(b.disbursedMtd, currency)}</td>
        <td class="num">${fmt(b.disbursedPrev, currency)}</td>
        <td class="num">${fmt(b.collectedMtd, currency)}</td>
        ${collRateCol(b)}
        ${parCell(parVal(b))}
        ${slimProduct ? '' : parCell(b.nplRate)}
        ${
          slimProduct
            ? ''
            : logbookParColumns
              ? parCell(lastVal(b))
              : `<td class="num">${b.vsTarget != null ? `${b.vsTarget > 0 ? '+' : ''}${Number(b.vsTarget).toFixed(1)}%` : '—'}</td>`
        }
      </tr>`,
    )
    .join('')
  const t = totals || {}
  const totalRow = `<tr class="total-row">
    <td><strong>${escapeHtml(t.name || 'TOTAL / AVG')}</strong></td>
    <td class="num"><strong>${fmt(t.disbursedMtd, currency)}</strong></td>
    <td class="num"><strong>${fmt(t.disbursedPrev, currency)}</strong></td>
    <td class="num"><strong>${fmt(t.collectedMtd, currency)}</strong></td>
    ${collRateTotal}
    ${parCell(parTotalVal(t))}
    ${slimProduct ? '' : parCell(t.nplRate)}
    ${slimProduct ? '' : logbookParColumns ? parCell(lastTotalVal(t)) : '<td class="num">—</td>'}
  </tr>`
  return `<table class="board-table">
    <thead>
      <tr>
        <th>Branch</th>
        <th class="num">Disbursed<br>${escapeHtml(currLabel)}</th>
        <th class="num">Disbursed<br>${escapeHtml(prevLabel)}</th>
        <th class="num">Collected</th>
        ${collRateHead}
        <th class="num">${parColLabel}</th>
        ${nplHead}
        ${lastHead}
      </tr>
    </thead>
    <tbody>${body}${totalRow}</tbody>
  </table>`
}

function heatMapTable(heatMap) {
  const rows = (heatMap?.rows || [])
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        ${parCell(r.logbook)}
        ${parCell(r.zidisha)}
        ${parCell(r.boda)}
      </tr>`,
    )
    .join('')
  const avg = heatMap?.averages || {}
  return `<table class="board-table heat">
    <thead>
      <tr>
        <th>Branch</th>
        <th class="num">Logbook PAR</th>
        <th class="num">Zidisha Stress*</th>
        <th class="num">Boda PAR</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td><strong>AVERAGE</strong></td>
        ${parCell(avg.logbook)}
        ${parCell(avg.zidisha)}
        ${parCell(avg.boda)}
      </tr>
    </tbody>
  </table>
  <p class="footnote">Logbook PAR from PAR snapshot (past missed ÷ open loans). * Zidisha stress derived from collection shortfall (100% − collection rate). Boda PAR uses principal outstanding with any overdue.</p>
  <p class="legend">Green ≤ 6% &nbsp;|&nbsp; Amber 6.1–8.0% &nbsp;|&nbsp; Red &gt; 8.0% (institutional threshold)</p>`
}

function directivesTable(directives) {
  const rows = (directives || []).map(
    (d, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(d.action)}</td>
      <td>${escapeHtml(d.owner)}</td>
      <td>${escapeHtml(d.deadline)}</td>
      <td><span class="priority priority-${String(d.priority || 'MEDIUM').toLowerCase()}">${escapeHtml(d.priority || 'MEDIUM')}</span></td>
      <td>${escapeHtml(d.status || 'Open')}</td>
    </tr>`,
  )
  if (!rows.length) return ''
  return `<table class="board-table">
    <thead>
      <tr><th>#</th><th>Action Directive</th><th>Owner</th><th>Deadline</th><th>Priority</th><th>Status</th></tr>
    </thead>
    <tbody>${rows.join('')}</tbody>
  </table>`
}

export function renderDirectorReportHTML({ summary, commentary, generatedAt }) {
  const s = summary || {}
  const c = commentary || {}
  const genLabel = (generatedAt ? new Date(generatedAt) : new Date()).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const currLabel = `${s.monthName || 'Current'} (${s.currencyNote || 'MTD'})`
  const prevLabel = s.prevMonthName || 'Prior Month'

  const kpis = (s.executiveKpis || [])
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.metric)}</td>
        <td class="num">${fmtKpi(r)}</td>
        <td class="num">${fmtKpiPrev(r)}</td>
        <td class="num var">${fmtVar(r.variance)}</td>
      </tr>`,
    )
    .join('')

  const lbKe = s.logbook?.kenya || {}
  const lbUg = s.logbook?.uganda || {}
  const zd = s.zidisha || {}
  const bd = s.boda || {}

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Board Report — ${escapeHtml(s.periodLabel || '')}</title>
  <style>
    :root { --navy:#1a2d4f; --orange:#E04B2A; --border:#cbd5e1; --muted:#64748b; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',Arial,sans-serif; color:#0f172a; font-size:10pt; line-height:1.4; padding:24px 28px; }
    .cover { text-align:center; border-bottom:4px solid var(--navy); padding-bottom:16px; margin-bottom:20px; }
    .cover h1 { font-size:16pt; letter-spacing:1px; color:var(--navy); font-weight:800; }
    .cover .co { font-size:12pt; font-weight:600; margin:6px 0; }
    .cover .meta { font-size:9pt; color:var(--muted); margin-top:8px; }
    .section { margin:22px 0 16px; page-break-inside:avoid; }
    .section h2 { font-size:11pt; color:var(--navy); font-weight:800; border-bottom:2px solid var(--orange); padding-bottom:4px; margin-bottom:8px; }
    .section p.lead { font-size:9.5pt; color:#334155; margin-bottom:10px; }
    .alert { background:#fef2f2; border-left:4px solid #dc2626; padding:8px 12px; font-size:9pt; color:#991b1b; margin:10px 0; }
    .board-table { width:100%; border-collapse:collapse; font-size:9pt; margin:8px 0 12px; }
    .board-table th, .board-table td { border:1px solid var(--border); padding:5px 8px; vertical-align:middle; }
    .board-table th { background:var(--navy); color:#fff; font-size:7.5pt; text-transform:uppercase; letter-spacing:.3px; }
    .board-table td.num, .board-table th.num { text-align:right; }
    .board-table tr.total-row { background:#f1f5f9; }
    .par-green { background:#dcfce7; color:#166534; font-weight:600; }
    .par-amber { background:#fef3c7; color:#92400e; font-weight:600; }
    .par-red { background:#fee2e2; color:#991b1b; font-weight:700; }
    .var { font-weight:600; }
    .obs { background:#f8fafc; border:1px solid var(--border); padding:8px 12px; margin-top:8px; font-size:9pt; }
    .obs-title { font-weight:700; color:var(--navy); font-size:8pt; text-transform:uppercase; margin-bottom:4px; }
    .obs ul { padding-left:16px; }
    .obs li { margin-bottom:3px; }
    .footnote, .legend { font-size:8pt; color:var(--muted); margin-top:4px; }
    .legend { font-weight:600; }
    .priority { font-size:7.5pt; font-weight:700; padding:2px 6px; border-radius:3px; }
    .priority-urgent { background:#fee2e2; color:#991b1b; }
    .priority-high { background:#ffedd5; color:#9a3412; }
    .priority-medium { background:#e0e7ff; color:#3730a3; }
    .footer { margin-top:20px; text-align:center; font-size:7.5pt; color:var(--muted); border-top:1px solid var(--border); padding-top:8px; }
    .na-block { background:#f8fafc; border:1px dashed var(--border); padding:12px; font-size:9pt; color:var(--muted); text-align:center; }
    @media print { body { padding:12px 16px; } .section { page-break-inside:avoid; } }
  </style>
</head>
<body>
  <div class="cover">
    <h1>BOARD &amp; MANAGEMENT PERFORMANCE REPORT</h1>
    <div class="co">Phoenix Capital Limited</div>
    <div class="meta">Period: ${escapeHtml(s.periodLabel || '')} &nbsp;|&nbsp; Reporting Date: ${escapeHtml(s.reportingDate || '')}</div>
    <div class="meta">Prepared by: Executive Director &amp; Chief Financial Officer &nbsp;|&nbsp; Generated ${escapeHtml(genLabel)}</div>
  </div>

  <div class="section">
    <h2>1. Executive Summary</h2>
    <p class="lead">${escapeHtml(c.intro || c.headline || 'Consolidated operational and financial performance for the reporting period.')}</p>
    <table class="board-table">
      <thead><tr><th>Key Metric</th><th class="num">${escapeHtml(s.monthName || 'Current')}</th><th class="num">${escapeHtml(s.prevMonthName || 'Prior')}</th><th class="num">Variance</th></tr></thead>
      <tbody>${kpis}</tbody>
    </table>
    ${c.alertLine ? `<div class="alert">${escapeHtml(c.alertLine)}</div>` : ''}
  </div>

  <div class="section">
    <h2>2. Logbook Loans — Kenya Branch Performance</h2>
    <p class="lead">Branch-level performance for Logbook Kenya (${escapeHtml(s.monthName || '')} MTD vs ${escapeHtml(s.prevMonthName || '')} full month).</p>
    ${branchPerfTable({ branches: lbKe.branches, totals: lbKe.totals, currency: 'KES', currLabel: `${s.monthName} MTD`, prevLabel: `${s.prevMonthName} (full)`, logbookParColumns: true })}
    ${obsList(c.keyObservations?.logbook)}
  </div>

  ${
    (lbUg.branches || []).length
      ? `<div class="section">
    <h2>2b. Logbook Loans — Uganda Branch Performance</h2>
    <p class="lead">Uganda operations (UGX). Do not combine with Kenya KES figures.</p>
    ${branchPerfTable({ branches: lbUg.branches, totals: lbUg.totals, currency: 'UGX', currLabel: `${s.monthName} MTD`, prevLabel: `${s.prevMonthName} (full)`, logbookParColumns: true })}
  </div>`
      : ''
  }

  <div class="section">
    <h2>3. Zidisha (Biashara Loans) — Branch Performance</h2>
    <p class="lead">SME and micro-enterprise loan performance by branch (KES).</p>
    ${branchPerfTable({ branches: zd.branches, totals: zd.totals, currency: 'KES', currLabel: `${s.monthName} MTD`, prevLabel: `${s.prevMonthName} (full)`, showCollectionRate: true, productColumnMode: 'zidisha' })}
    ${obsList(c.keyObservations?.zidisha)}
  </div>

  <div class="section">
    <h2>4. Bodaboda Financing — Branch Performance</h2>
    <p class="lead">Boda product branch performance (KES).</p>
    ${branchPerfTable({ branches: bd.branches, totals: bd.totals, currency: 'KES', currLabel: `${s.monthName} MTD`, prevLabel: `${s.prevMonthName} (full)`, showCollectionRate: true, productColumnMode: 'boda' })}
    ${obsList(c.keyObservations?.boda)}
  </div>

  <div class="section">
    <h2>5. Portfolio at Risk — Consolidated Heat Map</h2>
    <p class="lead">Delinquency concentration across branches and products.</p>
    ${heatMapTable(s.heatMap)}
    ${obsList(c.keyObservations?.heatMap)}
  </div>

  <div class="section">
    <h2>6. Financial Performance Report (CFO)</h2>
    <div class="na-block">Income statement, CGU analysis, and treasury sections require management accounts.<br/>Integrate from finance system or upload manually for full board pack.</div>
  </div>

  <div class="section">
    <h2>12. Executive Director's Commentary &amp; Directives</h2>
    <p class="lead">Action directives following review of ${escapeHtml(s.periodLabel || '')} performance data.</p>
    ${directivesTable(c.directives)}
  </div>

  <div class="footer">Phoenix Capital Limited &nbsp;|&nbsp; Board &amp; Management Report — ${escapeHtml(s.periodLabel || '')} &nbsp;|&nbsp; Confidential — Board &amp; Executive Management Use Only</div>
</body>
</html>`
}

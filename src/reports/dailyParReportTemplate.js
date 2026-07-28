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
  return `${sign}${n.toFixed(1)} pp`
}

function shiftClass(amt) {
  const n = Number(amt) || 0
  if (n < -1000) return 'good'
  if (n > 1000) return 'bad'
  return 'flat'
}

function bulletLine(item) {
  const text = item?.text || item?.name || ''
  return `<li>${escapeHtml(text)}</li>`
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

  const recovered = Number(overall.netChangeVsYesterday) || 0
  const recoveredLabel =
    recovered >= 0
      ? `${formatCompact(recovered)} recovered`
      : `${formatCompact(Math.abs(recovered))} increase`

  const topHtml = (narrative.topPerformers || []).map(bulletLine).join('')
  const holdHtml = (narrative.holdingSteady || []).map(bulletLine).join('')
  const watchHtml = (narrative.watching || []).map(bulletLine).join('')
  const cleanHtml = (narrative.clean || []).map(bulletLine).join('')

  const rowsHtml = branches
    .map((b) => {
      const shift = b.shiftSodToEod
      const vsY = b.vsYesterdayEod
      const cls = shift ? shiftClass(shift.parAmt) : 'flat'
      const recoveredCls = vsY ? shiftClass(-(vsY.parAmt || 0)) : 'flat'
      return `<tr>
        <td class="branch">${escapeHtml(b.name)}</td>
        <td class="num">${formatPct(b.eodYesterday?.parPct)}</td>
        <td class="num muted">${formatCompact(b.eodYesterday?.par)}</td>
        <td class="num">${b.hasSod === false ? '—' : formatPct(b.sod?.parPct)}</td>
        <td class="num muted">${b.hasSod === false ? '—' : formatCompact(b.sod?.par)}</td>
        <td class="num">${formatPct(b.eod?.parPct)}</td>
        <td class="num muted">${formatCompact(b.eod?.par)}</td>
        <td class="num ${cls}">${shift ? formatSignedCompact(shift.parAmt) : '—'}</td>
        <td class="num ${cls}">${shift ? formatSignedPp(shift.parPctPp) : '—'}</td>
        <td class="num ${recoveredCls}">${vsY ? formatSignedCompact(-(vsY.parAmt || 0)) : '—'}</td>
      </tr>`
    })
    .join('')

  const totalShift = Number(overall.shiftSodToEod) || 0
  const totalVsYestRecovered = recovered

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Daily PAR Report — ${dateLabel}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    :root {
      --ink: #1a1a1a;
      --muted: #6b7280;
      --line: #e5e7eb;
      --bg: #f8fafc;
      --brand: #E04B2A;
      --green: #047857;
      --red: #b91c1c;
      --sky: #0c4a6e;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      color: var(--ink);
      background: #fff;
      font-size: 10.5px;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 900px;
      max-width: 900px;
      margin: 0 auto;
      padding: 0 8px 6px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      border-bottom: 2px solid var(--brand);
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .header h1 { margin: 0; font-size: 16px; letter-spacing: -0.02em; }
    .header .sub { color: var(--muted); font-size: 9.5px; margin-top: 2px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #fff7ed;
      color: var(--brand);
      font-weight: 700;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }
    /* Always one row of 4 KPI cards — never wrap for PDF/print */
    .kpis {
      display: grid !important;
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      gap: 8px;
      margin-bottom: 10px;
      width: 100%;
    }
    .kpi {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      min-width: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .kpi .label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); white-space: nowrap; }
    .kpi .pct { font-size: 18px; font-weight: 800; margin-top: 2px; line-height: 1.1; white-space: nowrap; }
    .kpi .amt { font-size: 10px; color: var(--muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi.highlight { border-color: #fed7aa; background: #fff7ed; }
    .kpi.good .pct { color: var(--green); }
    .kpi.bad .pct { color: var(--red); }
    h2 {
      font-size: 10px;
      margin: 8px 0 5px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--sky);
    }
    .narrative {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      grid-template-rows: auto auto;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 8px;
      background: #fff;
      min-width: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .card h3 {
      margin: 0 0 4px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .card ul { margin: 0; padding-left: 14px; }
    .card li { margin-bottom: 2px; font-size: 9px; }
    .card p { margin: 0; font-size: 9px; }
    .bottom {
      margin: 6px 0 4px;
      padding: 6px 10px;
      border-left: 3px solid var(--brand);
      background: #fff7ed;
      border-radius: 0 6px 6px 0;
      font-size: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
      table-layout: fixed;
    }
    thead th {
      background: #0f172a;
      color: #fff;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 7.5px;
      padding: 4px 3px;
      text-align: right;
      white-space: nowrap;
    }
    thead th.branch, tbody td.branch, tfoot td.branch { text-align: left; width: 12%; }
    thead th.group-sod { background: #334155; }
    thead th.group-eod { background: #0c4a6e; }
    tbody td {
      padding: 3px 3px;
      border-bottom: 1px solid var(--line);
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tbody td.branch { font-weight: 600; }
    tbody td.muted { color: var(--muted); font-weight: 500; }
    tbody tr:nth-child(even) { background: #fafafa; }
    tfoot td {
      padding: 4px 3px;
      font-weight: 800;
      border-top: 2px solid #0f172a;
      background: #f1f5f9;
      text-align: right;
      font-size: 9px;
    }
    .good { color: var(--green) !important; font-weight: 700; }
    .bad { color: var(--red) !important; font-weight: 700; }
    .flat { color: var(--muted); }
    .meta {
      margin-top: 4px;
      font-size: 8px;
      color: var(--muted);
    }
    @media print {
      html, body { width: 100%; }
      .page {
        width: 100% !important;
        max-width: none !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .kpis {
        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      }
      .narrative {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .page, .kpis, .kpi, table, .narrative, .bottom {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <div class="badge">EOD PAR Report</div>
        <h1>Daily PAR — ${dateLabel}</h1>
        <div class="sub">${country} · SOD ≈ ${escapeHtml(String(slots.sod?.targetHour ?? 3).padStart(2, '0'))}:00 EAT · EOD ≈ ${escapeHtml(String(slots.eod?.targetHour ?? 20).padStart(2, '0'))}:00 EAT</div>
      </div>
      <div class="sub" style="text-align:right">
        <div>SOD snapshot: ${escapeHtml(slots.sod?.asOfLabel || '—')} EAT</div>
        <div>EOD snapshot: ${escapeHtml(slots.eod?.asOfLabel || '—')} EAT</div>
        <div>Yest. EOD: ${escapeHtml(slots.eodYesterday?.asOfLabel || '—')} EAT</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi">
        <div class="label">EOD Yesterday</div>
        <div class="pct">${formatPct(overall.eodYesterday?.parPct)}</div>
        <div class="amt">${formatCompact(overall.eodYesterday?.par)} at risk</div>
      </div>
      <div class="kpi">
        <div class="label">SOD Today</div>
        <div class="pct">${formatPct(overall.sod?.parPct)}</div>
        <div class="amt">${formatCompact(overall.sod?.par)} at risk</div>
      </div>
      <div class="kpi">
        <div class="label">EOD Today</div>
        <div class="pct">${formatPct(overall.eod?.parPct)}</div>
        <div class="amt">${formatCompact(overall.eod?.par)} at risk</div>
      </div>
      <div class="kpi highlight ${recovered >= 0 ? 'good' : 'bad'}">
        <div class="label">Net vs Yesterday</div>
        <div class="pct">${recovered >= 0 ? '↓' : '↑'} ${formatCompact(Math.abs(recovered))}</div>
        <div class="amt">${recoveredLabel}</div>
      </div>
    </div>

    <h2>Branch movement</h2>
    <table>
      <thead>
        <tr>
          <th class="branch" rowspan="2">Branch</th>
          <th colspan="2">EOD Yesterday</th>
          <th class="group-sod" colspan="2">SOD Today</th>
          <th class="group-eod" colspan="2">EOD Today</th>
          <th colspan="2">SOD → EOD</th>
          <th rowspan="2">Recovered vs Yest.</th>
        </tr>
        <tr>
          <th>%</th><th>Amt</th>
          <th class="group-sod">%</th><th class="group-sod">Amt</th>
          <th class="group-eod">%</th><th class="group-eod">Amt</th>
          <th>Δ Amt</th><th>Δ pp</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="10" style="text-align:center;color:#9ca3af;padding:12px">No branch PAR snapshots found for this date.</td></tr>'}
      </tbody>
      <tfoot>
        <tr>
          <td class="branch">OVERALL</td>
          <td class="num">${formatPct(overall.eodYesterday?.parPct)}</td>
          <td class="num">${formatCompact(overall.eodYesterday?.par)}</td>
          <td class="num">${formatPct(overall.sod?.parPct)}</td>
          <td class="num">${formatCompact(overall.sod?.par)}</td>
          <td class="num">${formatPct(overall.eod?.parPct)}</td>
          <td class="num">${formatCompact(overall.eod?.par)}</td>
          <td class="num ${shiftClass(totalShift)}">${formatSignedCompact(totalShift)}</td>
          <td class="num ${shiftClass(totalShift)}">${formatSignedPp(
            (Number(overall.eod?.parPct) || 0) - (Number(overall.sod?.parPct) || 0),
          )}</td>
          <td class="num ${recovered >= 0 ? 'good' : 'bad'}">${formatSignedCompact(totalVsYestRecovered)}</td>
        </tr>
      </tfoot>
    </table>

    <h2>Narrative</h2>
    <div class="narrative">
      <div class="card">
        <h3>Top performers today</h3>
        ${topHtml ? `<ul>${topHtml}</ul>` : '<p class="flat">No clear improvers on SOD→EOD or vs yesterday&apos;s close.</p>'}
      </div>
      <div class="card">
        <h3>Holding steady</h3>
        ${holdHtml ? `<ul>${holdHtml}</ul>` : '<p class="flat">No branches holding flat vs yesterday.</p>'}
      </div>
      <div class="card">
        <h3>Watching</h3>
        ${watchHtml ? `<ul>${watchHtml}</ul>` : '<p class="flat">No material upticks vs yesterday or through the day.</p>'}
      </div>
      <div class="card">
        <h3>Clean</h3>
        ${cleanHtml ? `<ul>${cleanHtml}</ul>` : '<p class="flat">No zero-PAR branches at EOD.</p>'}
      </div>
    </div>

    <div class="bottom">
      <strong>Bottom line:</strong> ${escapeHtml(narrative.bottomLine || '—')}
    </div>

    <div class="meta">
      Closest PAR snapshots to ${escapeHtml(String(slots.sod?.targetHour ?? 3).padStart(2, '0'))}:00 and ${escapeHtml(String(slots.eod?.targetHour ?? 20).padStart(2, '0'))}:00 Africa/Nairobi · Single-page A4 portrait PDF
    </div>
  </div>
</body>
</html>`
}

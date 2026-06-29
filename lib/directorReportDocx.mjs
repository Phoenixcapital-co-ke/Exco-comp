import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'

const currencyFormatterCache = new Map()

function formatCurrency(value, currency = 'KES') {
  const ccy = String(currency || 'KES').toUpperCase()
  if (!currencyFormatterCache.has(ccy)) {
    currencyFormatterCache.set(
      ccy,
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: ccy,
        maximumFractionDigits: 0,
      }),
    )
  }
  return currencyFormatterCache.get(ccy).format(Number(value) || 0)
}

const NAVY = '1A2D4F'
const ORANGE = 'E04B2A'
const BORDER = 'CBD5E1'
const MUTED = '64748B'
const BODY = '0F172A'
const FONT = 'Segoe UI'

const PT = (pt) => pt * 2

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
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function parStyle(v) {
  const n = Number(v) || 0
  if (v == null || v === '') return { shading: null, color: BODY }
  if (n <= 6) return { shading: 'DCFCE7', color: '166534' }
  if (n <= 8) return { shading: 'FEF3C7', color: '92400E' }
  return { shading: 'FEE2E2', color: '991B1B' }
}

function priorityStyle(priority) {
  const p = String(priority || 'MEDIUM').toUpperCase()
  if (p === 'URGENT') return { shading: 'FEE2E2', color: '991B1B' }
  if (p === 'HIGH') return { shading: 'FFEDD5', color: '9A3412' }
  return { shading: 'E0E7FF', color: '3730A3' }
}

const cellBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
}

function textRun(text, opts = {}) {
  return new TextRun({
    text: String(text ?? ''),
    font: FONT,
    size: opts.size ?? PT(9),
    bold: opts.bold ?? false,
    color: opts.color ?? BODY,
    italics: opts.italics ?? false,
  })
}

function paragraph(children, opts = {}) {
  const runs = Array.isArray(children)
    ? children
    : [typeof children === 'string' ? textRun(children, opts) : children]
  return new Paragraph({
    alignment: opts.alignment,
    spacing: opts.spacing ?? { after: 120 },
    border: opts.border,
    shading: opts.shading,
    children: runs,
  })
}

function sectionHeading(text) {
  return paragraph([textRun(text, { bold: true, size: PT(11), color: NAVY })], {
    spacing: { before: 320, after: 100 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 8, color: ORANGE, space: 4 },
    },
  })
}

function lead(text) {
  return paragraph(text, { size: PT(9.5), color: '334155', spacing: { after: 160 } })
}

function asText(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value.label != null) return String(value.label)
  return ''
}

function cellText(value) {
  const fromAsText = asText(value)
  if (fromAsText) return fromAsText
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function isTextRun(content) {
  return content instanceof TextRun || content?.constructor?.name === 'TextRun'
}

function makeCell(content, opts = {}) {
  let runs
  if (Array.isArray(content)) {
    runs = content
  } else if (isTextRun(content)) {
    runs = [content]
  } else {
    runs = [textRun(cellText(content), opts)]
  }
  return new TableCell({
    borders: cellBorder,
    shading: opts.shading
      ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    width: opts.width,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        children: runs,
      }),
    ],
  })
}

function headerCell(label, align = AlignmentType.LEFT) {
  const text = cellText(label)
  return new TableCell({
    borders: cellBorder,
    shading: { fill: NAVY, type: ShadingType.CLEAR, color: 'auto' },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: align,
        children: [
          new TextRun({
            text,
            font: FONT,
            bold: true,
            size: PT(7.5),
            color: 'FFFFFF',
          }),
        ],
      }),
    ],
  })
}

function numCell(text, opts = {}) {
  return makeCell(text, { ...opts, align: AlignmentType.RIGHT })
}

function parNumCell(v) {
  if (v == null || v === '') return numCell('—')
  const ps = parStyle(v)
  return numCell(`${Number(v).toFixed(1)}%`, {
    shading: ps.shading,
    color: ps.color,
    bold: Number(v) > 8,
  })
}

function pctNumCell(v) {
  if (v == null || v === '') return numCell('—')
  return numCell(`${Number(v).toFixed(1)}%`)
}

function dataCell(value, opts = {}) {
  if (value && typeof value === 'object' && value._cell) return value._cell
  return makeCell(cellText(value), opts)
}

function dataTable(headers, rows, colWidthsPct) {
  const totalPct = colWidthsPct.reduce((a, b) => a + b, 0)
  const headerRow = new TableRow({
    children: headers.map((h, i) =>
      headerCell(h, h?.align ?? (i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT)),
    ),
  })
  const bodyRows = rows.map((row) =>
    new TableRow({
      children: row.map((cell, i) => {
        const align = headers[i]?.align ?? (i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT)
        return dataCell(cell, {
          align,
          bold: row._bold,
          shading: row._shading,
        })
      }),
    }),
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: colWidthsPct.map((w) => Math.round((w / totalPct) * 9000)),
    rows: [headerRow, ...bodyRows],
  })
}

function obsBlock(items) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return []
  return [
    new Paragraph({
      spacing: { before: 120, after: 80 },
      shading: { fill: 'F8FAFC', type: ShadingType.CLEAR, color: 'auto' },
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
        left: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
        right: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
      },
      indent: { left: 120, right: 120 },
      children: [textRun('KEY OBSERVATIONS', { bold: true, size: PT(8), color: NAVY })],
    }),
    ...list.map(
      (item) =>
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360, right: 120 },
          children: [textRun(`• ${item}`, { size: PT(9) })],
        }),
    ),
  ]
}

function branchPerfTable({ branches, totals, currency, currLabel, prevLabel, showCollectionRate }) {
  const headers = [
    { label: 'Branch' },
    { label: `Disbursed ${currLabel}` },
    { label: `Disbursed ${prevLabel}` },
    { label: 'Collected' },
  ]
  if (showCollectionRate) headers.push({ label: 'Collection Rate' })
  headers.push({ label: 'PAR>30%' }, { label: 'NPL%' }, { label: 'Vs Target' })

  const widths = showCollectionRate
    ? [16, 14, 14, 14, 10, 10, 8, 8]
    : [18, 15, 15, 15, 12, 10, 10]

  const body = (branches || []).map((b) => {
    const row = [
      b.name,
      fmt(b.disbursedMtd, currency),
      fmt(b.disbursedPrev, currency),
      fmt(b.collectedMtd, currency),
    ]
    if (showCollectionRate) row.push(`${Number(b.collectionRate ?? 0).toFixed(1)}%`)
    row.push(
      { _cell: parNumCell(b.parOver30 ?? b.parRate) },
      { _cell: parNumCell(b.nplRate) },
      b.vsTarget != null ? `${b.vsTarget > 0 ? '+' : ''}${Number(b.vsTarget).toFixed(1)}%` : '—',
    )
    return row
  })

  const t = totals || {}
  const totalRow = [
    t.name || 'TOTAL / AVG',
    fmt(t.disbursedMtd, currency),
    fmt(t.disbursedPrev, currency),
    fmt(t.collectedMtd, currency),
  ]
  if (showCollectionRate) totalRow.push(`${Number(t.collectionRate ?? 0).toFixed(1)}%`)
  totalRow.push(
    { _cell: parNumCell(t.parOver30 ?? t.parRate) },
    { _cell: parNumCell(t.nplRate) },
    '—',
  )
  totalRow._bold = true
  totalRow._shading = 'F1F5F9'
  body.push(totalRow)

  return dataTable(headers, body, widths)
}

function heatMapTable(heatMap) {
  const rows = (heatMap?.rows || []).map((r) => [
    r.name,
    { _cell: parNumCell(r.logbook) },
    { _cell: parNumCell(r.zidisha) },
    { _cell: parNumCell(r.boda) },
  ])
  const avg = heatMap?.averages || {}
  const avgRow = [
    'AVERAGE',
    { _cell: parNumCell(avg.logbook) },
    { _cell: parNumCell(avg.zidisha) },
    { _cell: parNumCell(avg.boda) },
  ]
  avgRow._bold = true
  avgRow._shading = 'F1F5F9'
  rows.push(avgRow)
  return dataTable(
    [
      { label: 'Branch' },
      { label: 'Logbook PAR>30%' },
      { label: 'Zidisha Stress*' },
      { label: 'Boda Stress*' },
    ],
    rows,
    [28, 24, 24, 24],
  )
}

function directivesTable(directives) {
  const rows = (directives || []).map((d, i) => {
    const ps = priorityStyle(d.priority)
    return [
      String(i + 1),
      d.action || '',
      d.owner || '',
      d.deadline || '',
      {
        _cell: makeCell(d.priority || 'MEDIUM', {
          shading: ps.shading,
          color: ps.color,
          bold: true,
          align: AlignmentType.CENTER,
        }),
      },
      d.status || 'Open',
    ]
  })
  if (!rows.length) return null
  return dataTable(
    [
      { label: '#', align: AlignmentType.CENTER },
      { label: 'Action Directive' },
      { label: 'Owner' },
      { label: 'Deadline' },
      { label: 'Priority', align: AlignmentType.CENTER },
      { label: 'Status' },
    ],
    rows,
    [5, 35, 15, 15, 12, 18],
  )
}

export async function buildDirectorReportDocx({ summary, commentary, generatedAt }) {
  const s = summary || {}
  const c = commentary || {}
  const genLabel = (generatedAt ? new Date(generatedAt) : new Date()).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const lbKe = s.logbook?.kenya || {}
  const lbUg = s.logbook?.uganda || {}
  const zd = s.zidisha || {}
  const bd = s.boda || {}

  const kpiRows = (s.executiveKpis || []).map((r) => [
    r.metric,
    fmtKpi(r),
    fmtKpiPrev(r),
    fmtVar(r.variance),
  ])

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 16, color: NAVY, space: 8 },
      },
      children: [
        textRun('BOARD & MANAGEMENT PERFORMANCE REPORT', {
          bold: true,
          size: PT(16),
          color: NAVY,
        }),
      ],
    }),
    paragraph('Phoenix Capital Limited', {
      alignment: AlignmentType.CENTER,
      bold: true,
      size: PT(12),
      spacing: { after: 80 },
    }),
    paragraph(`Period: ${s.periodLabel || ''}  |  Reporting Date: ${s.reportingDate || ''}`, {
      alignment: AlignmentType.CENTER,
      color: MUTED,
      size: PT(9),
      spacing: { after: 60 },
    }),
    paragraph(
      `Prepared by: Executive Director & Chief Financial Officer  |  Generated ${genLabel}`,
      {
        alignment: AlignmentType.CENTER,
        color: MUTED,
        size: PT(9),
        spacing: { after: 240 },
      },
    ),

    sectionHeading('1. Executive Summary'),
    lead(
      c.intro ||
        c.headline ||
        'Consolidated operational and financial performance for the reporting period.',
    ),
    dataTable(
      [
        { label: 'Key Metric' },
        { label: s.monthName || 'Current' },
        { label: s.prevMonthName || 'Prior' },
        { label: 'Variance' },
      ],
      kpiRows,
      [40, 20, 20, 20],
    ),
  ]

  if (c.alertLine) {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 160 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 16, color: 'DC2626', space: 8 },
        },
        shading: { fill: 'FEF2F2', type: ShadingType.CLEAR, color: 'auto' },
        indent: { left: 160 },
        children: [textRun(c.alertLine, { size: PT(9), color: '991B1B' })],
      }),
    )
  }

  children.push(
    sectionHeading('2. Logbook Loans — Kenya Branch Performance'),
    lead(
      `Branch-level performance for Logbook Kenya (${s.monthName || ''} MTD vs ${s.prevMonthName || ''} full month).`,
    ),
    branchPerfTable({
      branches: lbKe.branches,
      totals: lbKe.totals,
      currency: 'KES',
      currLabel: `${s.monthName} MTD`,
      prevLabel: `${s.prevMonthName} (full)`,
    }),
    ...obsBlock(c.keyObservations?.logbook),
  )

  if ((lbUg.branches || []).length) {
    children.push(
      sectionHeading('2b. Logbook Loans — Uganda Branch Performance'),
      lead('Uganda operations (UGX). Do not combine with Kenya KES figures.'),
      branchPerfTable({
        branches: lbUg.branches,
        totals: lbUg.totals,
        currency: 'UGX',
        currLabel: `${s.monthName} MTD`,
        prevLabel: `${s.prevMonthName} (full)`,
      }),
    )
  }

  children.push(
    sectionHeading('3. Zidisha (Biashara Loans) — Branch Performance'),
    lead('SME and micro-enterprise loan performance by branch (KES).'),
    branchPerfTable({
      branches: zd.branches,
      totals: zd.totals,
      currency: 'KES',
      currLabel: `${s.monthName} MTD`,
      prevLabel: `${s.prevMonthName} (full)`,
      showCollectionRate: true,
    }),
    ...obsBlock(c.keyObservations?.zidisha),

    sectionHeading('4. Bodaboda Financing — Branch Performance'),
    lead('Boda product branch performance (KES).'),
    branchPerfTable({
      branches: bd.branches,
      totals: bd.totals,
      currency: 'KES',
      currLabel: `${s.monthName} MTD`,
      prevLabel: `${s.prevMonthName} (full)`,
      showCollectionRate: true,
    }),
    ...obsBlock(c.keyObservations?.boda),

    sectionHeading('5. Portfolio at Risk — Consolidated Heat Map'),
    lead('Delinquency concentration across branches and products.'),
    heatMapTable(s.heatMap),
    paragraph('* Zidisha/Boda stress derived from collection shortfall (100% − collection rate).', {
      size: PT(8),
      color: MUTED,
      spacing: { after: 60 },
    }),
    paragraph('Green ≤ 6%  |  Amber 6.1–8.0%  |  Red > 8.0% (institutional threshold)', {
      size: PT(8),
      color: MUTED,
      bold: true,
      spacing: { after: 160 },
    }),
    ...obsBlock(c.keyObservations?.heatMap),

    sectionHeading('6. Financial Performance Report (CFO)'),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      shading: { fill: 'F8FAFC', type: ShadingType.CLEAR, color: 'auto' },
      border: {
        top: { style: BorderStyle.DASHED, size: 1, color: BORDER },
        bottom: { style: BorderStyle.DASHED, size: 1, color: BORDER },
        left: { style: BorderStyle.DASHED, size: 1, color: BORDER },
        right: { style: BorderStyle.DASHED, size: 1, color: BORDER },
      },
      children: [
        textRun(
          'Income statement, CGU analysis, and treasury sections require management accounts.\nIntegrate from finance system or upload manually for full board pack.',
          { size: PT(9), color: MUTED },
        ),
      ],
    }),

    sectionHeading("12. Executive Director's Commentary & Directives"),
    lead(`Action directives following review of ${s.periodLabel || ''} performance data.`),
  )

  const dirTable = directivesTable(c.directives)
  if (dirTable) children.push(dirTable)

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 80 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
      },
      children: [
        textRun(
          `Phoenix Capital Limited  |  Board & Management Report — ${s.periodLabel || ''}  |  Confidential — Board & Executive Management Use Only`,
          { size: PT(7.5), color: MUTED },
        ),
      ],
    }),
  )

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: PT(10), color: BODY },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children,
      },
    ],
  })

  return doc
}

/** Node / server — returns Buffer */
export async function buildDirectorReportDocxBuffer(payload) {
  const doc = await buildDirectorReportDocx(payload)
  return Packer.toBuffer(doc)
}

/** Browser — returns Blob */
export async function buildDirectorReportDocxBlob(payload) {
  const doc = await buildDirectorReportDocx(payload)
  return Packer.toBlob(doc)
}

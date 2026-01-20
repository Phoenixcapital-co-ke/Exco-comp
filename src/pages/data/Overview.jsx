import React, { useEffect, useRef, useState, useMemo } from 'react'
import { API_URLS } from '../../utils/api.js'
import { useLastRefresh } from '../../hooks/useLastRefresh.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { formatKES } from '../../utils/format.js'

function DataOverview() {
  const [logs, setLogs] = useState([
    'Ready for ingestion...'
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [maintenanceError, setMaintenanceError] = useState(null)
  const [showDataManagement, setShowDataManagement] = useState(false)
  // Zidisha Report State
  const [zidishaReport, setZidishaReport] = useState([])
  const [zidishaReportLoading, setZidishaReportLoading] = useState(false)
  const [zidishaReportError, setZidishaReportError] = useState(null)
  const [showZidishaReport, setShowZidishaReport] = useState(false)
  const [showZidishaDownloadMenu, setShowZidishaDownloadMenu] = useState(false)
  
  // Zidisha Branchwise Report State
  const [zidishaBranchwiseReport, setZidishaBranchwiseReport] = useState([])
  const [zidishaBranchwiseReportLoading, setZidishaBranchwiseReportLoading] = useState(false)
  const [zidishaBranchwiseReportError, setZidishaBranchwiseReportError] = useState(null)
  const [showZidishaBranchwiseReport, setShowZidishaBranchwiseReport] = useState(false)
  const [showZidishaBranchwiseDownloadMenu, setShowZidishaBranchwiseDownloadMenu] = useState(false)
  
  // Advans Report State
  const [advansReport, setAdvansReport] = useState([])
  const [advansReportLoading, setAdvansReportLoading] = useState(false)
  const [advansReportError, setAdvansReportError] = useState(null)
  const [showAdvansReport, setShowAdvansReport] = useState(false)
  const [showAdvansDownloadMenu, setShowAdvansDownloadMenu] = useState(false)
  
  // Boda Report State
  const [bodaReport, setBodaReport] = useState([])
  const [bodaReportLoading, setBodaReportLoading] = useState(false)
  const [bodaReportError, setBodaReportError] = useState(null)
  const [showBodaReport, setShowBodaReport] = useState(false)
  const [showBodaDownloadMenu, setShowBodaDownloadMenu] = useState(false)
  const [fromMonth, setFromMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [toMonth, setToMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [zidishaBranchwiseFromMonth, setZidishaBranchwiseFromMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [zidishaBranchwiseToMonth, setZidishaBranchwiseToMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [advansFromMonth, setAdvansFromMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [advansToMonth, setAdvansToMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [bodaFromMonth, setBodaFromMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [bodaToMonth, setBodaToMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const esRef = useRef()
  const {
    formattedLastRefresh,
    error: lastRefreshError,
    refresh: reloadLastRefresh
  } = useLastRefresh()
  const { user } = useAuth()

  const handleRefresh = () => {
    setLogs(['Ready for ingestion...', 'Starting data refresh...'])
    setLoading(true)
    setError(null)
    setShowSuccess(false)
    // Close previous EventSource if any
    if (esRef.current) esRef.current.close()
    // NOTE: Using GET /api/ingest
    const es = new EventSource(API_URLS.ingest, { withCredentials: true })
    esRef.current = es
    es.onmessage = (e) => {
      if (!e.data) return
      setLogs(l => [...l, ...e.data.split('\n').filter(Boolean)])
      if (e.data.startsWith('<completed')) {
        setLoading(false)
        setShowSuccess(true)
        reloadLastRefresh()
        es.close()
      }
    }
    es.onerror = (err) => {
      setLoading(false)
      setError('Connection lost.')
      es.close()
    }
  }

  const fetchMaintenance = async () => {
    try {
      const res = await fetch(API_URLS.system.status, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch status')
      const data = await res.json()
      setMaintenance(Boolean(data.maintenance))
    } catch (e) {
      setMaintenanceError('Unable to load maintenance status')
    }
  }

  useEffect(() => {
    fetchMaintenance()
  }, [])

  // Generate Zidisha Report
  const generateZidishaReport = async () => {
    try {
      setZidishaReportLoading(true)
      setZidishaReportError(null)
      setZidishaReport([])
      
      const res = await fetch(API_URLS.reports.generate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'zidisha',
          fromMonth,
          toMonth
        })
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to generate report')
      }
      
      const result = await res.json()
      setZidishaReport(result.data || [])
    } catch (e) {
      setZidishaReportError(e.message)
    } finally {
      setZidishaReportLoading(false)
    }
  }

  // Generate Zidisha Branchwise Report
  const generateZidishaBranchwiseReport = async () => {
    try {
      setZidishaBranchwiseReportLoading(true)
      setZidishaBranchwiseReportError(null)
      setZidishaBranchwiseReport([])
      
      const res = await fetch(API_URLS.reports.generate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'zidisha-branchwise',
          fromMonth: zidishaBranchwiseFromMonth,
          toMonth: zidishaBranchwiseToMonth
        })
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to generate report')
      }
      
      const result = await res.json()
      setZidishaBranchwiseReport(result.data || [])
    } catch (e) {
      setZidishaBranchwiseReportError(e.message)
    } finally {
      setZidishaBranchwiseReportLoading(false)
    }
  }

  // Generate Advans Report
  const generateAdvansReport = async () => {
    try {
      setAdvansReportLoading(true)
      setAdvansReportError(null)
      setAdvansReport([])
      
      const res = await fetch(API_URLS.reports.generate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'advans',
          fromMonth: advansFromMonth,
          toMonth: advansToMonth
        })
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to generate report')
      }
      
      const result = await res.json()
      setAdvansReport(result.data || [])
    } catch (e) {
      setAdvansReportError(e.message)
    } finally {
      setAdvansReportLoading(false)
    }
  }

  // Generate Boda Report
  const generateBodaReport = async () => {
    try {
      setBodaReportLoading(true)
      setBodaReportError(null)
      setBodaReport([])
      
      const res = await fetch(API_URLS.reports.generate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'boda',
          fromMonth: bodaFromMonth,
          toMonth: bodaToMonth
        })
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to generate report')
      }
      
      const result = await res.json()
      setBodaReport(result.data || [])
    } catch (e) {
      setBodaReportError(e.message)
    } finally {
      setBodaReportLoading(false)
    }
  }


  // Generic download functions
  const downloadXLSXGeneric = (report, reportName, fromMonthFilter, toMonthFilter, labelHeader = 'Month', labelKey = 'month') => {
    import('xlsx').then((XLSX) => {
      const safeName = String(reportName || 'report').toLowerCase().replace(/\s+/g, '-')
      const ws = XLSX.utils.json_to_sheet(
        report.map(row => ({
          [labelHeader]: row?.[labelKey] ?? '',
          'Total Collected': row.totalCollected,
          'Total Expected Repayment': row.totalExpectedRepayment,
          'Total Disbursed': row.totalDisbursed
        }))
      )
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `${reportName} Report`)
      XLSX.writeFile(wb, `${safeName}-report-${fromMonthFilter}-to-${toMonthFilter}.xlsx`)
    })
  }

  const downloadHTMLGeneric = (report, reportName, fromMonthFilter, toMonthFilter, labelHeader = 'Month', labelKey = 'month') => {
    const safeName = String(reportName || 'report').toLowerCase().replace(/\s+/g, '-')
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${reportName} Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            table { border-collapse: collapse; width: 100%; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .text-right { text-align: right; }
          </style>
        </head>
        <body>
          <h1>${reportName} Report</h1>
          <p>Period: ${fromMonthFilter} to ${toMonthFilter}</p>
          <table>
            <thead>
              <tr>
                <th>${labelHeader}</th>
                <th class="text-right">Total Collected</th>
                <th class="text-right">Total Expected Repayment</th>
                <th class="text-right">Total Disbursed</th>
              </tr>
            </thead>
            <tbody>
              ${report.map(row => `
                <tr>
                  <td>${row?.[labelKey] ?? ''}</td>
                  <td class="text-right">${formatKES(row.totalCollected)}</td>
                  <td class="text-right">${formatKES(row.totalExpectedRepayment)}</td>
                  <td class="text-right">${formatKES(row.totalDisbursed)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}-report-${fromMonthFilter}-to-${toMonthFilter}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Generic PDF download function
  const downloadPDFGeneric = async (report, reportName, fromMonthFilter, toMonthFilter, labelHeader = 'Month', labelKey = 'month') => {
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const safeName = String(reportName || 'report').toLowerCase().replace(/\s+/g, '-')
      const barChartSVG = generateBarChartSVG(report, 800, 400, labelKey)
      const lineChartSVG = generateLineChartSVG(report, 800, 400, labelKey)
      
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>${reportName} Report</title>
            <style>
              * { box-sizing: border-box; }
              body { font-family: Arial, sans-serif; margin: 20px; color: #333; background: white; }
              h1 { color: #333; margin-bottom: 10px; font-size: 24px; }
              h2 { color: #333; margin-top: 30px; margin-bottom: 15px; font-size: 18px; }
              .period { color: #666; margin-bottom: 30px; font-size: 14px; }
              .chart-container { margin: 30px 0; page-break-inside: avoid; width: 100%; overflow: visible; }
              .chart-container svg { display: block; width: 100%; height: auto; }
              table { border-collapse: collapse; width: 100%; margin-top: 20px; page-break-inside: avoid; }
              th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
              th { background-color: #f2f2f2; font-weight: bold; }
              tr:nth-child(even) { background-color: #f9f9f9; }
              .text-right { text-align: right; }
              .summary { margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px; }
              .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
            </style>
          </head>
          <body>
            <h1>${reportName} Report</h1>
            <p class="period">Period: ${fromMonthFilter} to ${toMonthFilter}</p>
            <div class="summary">
              <h2 style="margin-top: 0;">Summary</h2>
              <div class="summary-row">
                <span><strong>Total Collected:</strong></span>
                <span>${formatKES(report.reduce((sum, r) => sum + r.totalCollected, 0))}</span>
              </div>
              <div class="summary-row">
                <span><strong>Total Expected Repayment:</strong></span>
                <span>${formatKES(report.reduce((sum, r) => sum + r.totalExpectedRepayment, 0))}</span>
              </div>
              <div class="summary-row">
                <span><strong>Total Disbursed:</strong></span>
                <span>${formatKES(report.reduce((sum, r) => sum + r.totalDisbursed, 0))}</span>
              </div>
            </div>
            ${barChartSVG ? `<div class="chart-container">${barChartSVG}</div>` : ''}
            ${lineChartSVG ? `<div class="chart-container">${lineChartSVG}</div>` : ''}
            <h2>Detailed Data</h2>
            <table>
              <thead>
                <tr>
                  <th>${labelHeader}</th>
                  <th class="text-right">Total Collected</th>
                  <th class="text-right">Total Expected Repayment</th>
                  <th class="text-right">Total Disbursed</th>
                </tr>
              </thead>
              <tbody>
                ${report.map(row => `
                  <tr>
                    <td>${row?.[labelKey] ?? ''}</td>
                    <td class="text-right">${formatKES(row.totalCollected)}</td>
                    <td class="text-right">${formatKES(row.totalExpectedRepayment)}</td>
                    <td class="text-right">${formatKES(row.totalDisbursed)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </body>
        </html>
      `
      
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.top = '0'
      iframe.style.left = '0'
      iframe.style.width = '1200px'
      iframe.style.height = '1600px'
      iframe.style.border = 'none'
      iframe.style.zIndex = '9999'
      document.body.appendChild(iframe)
      
      iframe.contentDocument.open()
      iframe.contentDocument.write(html)
      iframe.contentDocument.close()
      
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const element = iframe.contentDocument.body
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `${safeName}-report-${fromMonthFilter}-to-${toMonthFilter}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 1200, windowHeight: element.scrollHeight },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }
      
      await html2pdf().set(opt).from(element).save()
      document.body.removeChild(iframe)
    } catch (error) {
      console.error('PDF generation error:', error)
      const safeName = String(reportName || 'report').toLowerCase().replace(/\s+/g, '-')
      const barChartSVG = generateBarChartSVG(report, 800, 400, labelKey)
      const lineChartSVG = generateLineChartSVG(report, 800, 400, labelKey)
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${reportName} Report</title>
          </head>
          <body>
            <h1>${reportName} Report</h1>
            <p>Period: ${fromMonthFilter} to ${toMonthFilter}</p>
            ${barChartSVG ? `<div>${barChartSVG}</div>` : ''}
            ${lineChartSVG ? `<div>${lineChartSVG}</div>` : ''}
            <table>
              <thead>
                <tr>
                  <th>${labelHeader}</th>
                  <th>Total Collected</th>
                  <th>Total Expected Repayment</th>
                  <th>Total Disbursed</th>
                </tr>
              </thead>
              <tbody>
                ${report.map(row => `
                  <tr>
                    <td>${row?.[labelKey] ?? ''}</td>
                    <td>${formatKES(row.totalCollected)}</td>
                    <td>${formatKES(row.totalExpectedRepayment)}</td>
                    <td>${formatKES(row.totalDisbursed)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </body>
        </html>
      `
      const printWindow = window.open('', '_blank')
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.onload = () => setTimeout(() => printWindow.print(), 500)
    }
  }

  // Zidisha download functions
  const downloadXLSX = () => downloadXLSXGeneric(zidishaReport, 'Zidisha', fromMonth, toMonth)
  const downloadHTML = () => downloadHTMLGeneric(zidishaReport, 'Zidisha', fromMonth, toMonth)
  const downloadPDF = () => downloadPDFGeneric(zidishaReport, 'Zidisha', fromMonth, toMonth)

  // Advans download functions
  const downloadAdvansXLSX = () => downloadXLSXGeneric(advansReport, 'Advans', advansFromMonth, advansToMonth)
  const downloadAdvansHTML = () => downloadHTMLGeneric(advansReport, 'Advans', advansFromMonth, advansToMonth)
  const downloadAdvansPDF = () => downloadPDFGeneric(advansReport, 'Advans', advansFromMonth, advansToMonth)

  // Boda download functions
  const downloadBodaXLSX = () => downloadXLSXGeneric(bodaReport, 'Boda', bodaFromMonth, bodaToMonth)
  const downloadBodaHTML = () => downloadHTMLGeneric(bodaReport, 'Boda', bodaFromMonth, bodaToMonth)
  const downloadBodaPDF = () => downloadPDFGeneric(bodaReport, 'Boda', bodaFromMonth, bodaToMonth)

  // Zidisha Branchwise download functions
  const downloadZidishaBranchwiseXLSX = () =>
    downloadXLSXGeneric(zidishaBranchwiseReport, 'Zidisha Branchwise', zidishaBranchwiseFromMonth, zidishaBranchwiseToMonth, 'Branch', 'branch')
  const downloadZidishaBranchwiseHTML = () =>
    downloadHTMLGeneric(zidishaBranchwiseReport, 'Zidisha Branchwise', zidishaBranchwiseFromMonth, zidishaBranchwiseToMonth, 'Branch', 'branch')
  const downloadZidishaBranchwisePDF = () =>
    downloadPDFGeneric(zidishaBranchwiseReport, 'Zidisha Branchwise', zidishaBranchwiseFromMonth, zidishaBranchwiseToMonth, 'Branch', 'branch')

  // Generate SVG chart for PDF
  const generateBarChartSVG = (data, width = 800, height = 400, labelKey = 'month') => {
    if (!data || data.length === 0) return ''
    
    const maxValue = Math.max(
      ...data.map(d => Math.max(d.totalCollected, d.totalExpectedRepayment, d.totalDisbursed))
    )
    if (maxValue === 0) return ''
    
    const padding = 80
    const chartWidth = width - padding * 2
    const chartHeight = height - padding * 2
    const groupWidth = Math.min(chartWidth / data.length, 120)
    const barWidth = (groupWidth - 10) / 3
    const spacing = 5
    
    const bars = []
    data.forEach((row, idx) => {
      const groupX = padding + (idx * groupWidth) + (groupWidth / 2) - (barWidth * 1.5 + spacing)
      const collectedHeight = Math.max((row.totalCollected / maxValue) * chartHeight, 1)
      const expectedHeight = Math.max((row.totalExpectedRepayment / maxValue) * chartHeight, 1)
      const disbursedHeight = Math.max((row.totalDisbursed / maxValue) * chartHeight, 1)
      const baseY = padding + chartHeight
      
      const label = String(row?.[labelKey] ?? '')
      bars.push(`
        <rect x="${groupX}" y="${baseY - collectedHeight}" width="${barWidth}" height="${collectedHeight}" fill="#10b981" />
        <rect x="${groupX + barWidth + spacing}" y="${baseY - expectedHeight}" width="${barWidth}" height="${expectedHeight}" fill="#f59e0b" />
        <rect x="${groupX + (barWidth + spacing) * 2}" y="${baseY - disbursedHeight}" width="${barWidth}" height="${disbursedHeight}" fill="#3b82f6" />
        <text x="${groupX + barWidth * 1.5 + spacing}" y="${baseY + 15}" text-anchor="middle" font-size="9" fill="#333">${label}</text>
      `)
    })
    
    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="white"/>
        <text x="${width / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold" fill="#333">Monthly Performance Overview</text>
        ${bars.join('')}
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${padding + chartHeight}" stroke="#333" stroke-width="2"/>
        <line x1="${padding}" y1="${padding + chartHeight}" x2="${width - padding}" y2="${padding + chartHeight}" stroke="#333" stroke-width="2"/>
        <text x="15" y="${padding + chartHeight / 2}" text-anchor="middle" font-size="12" fill="#666" transform="rotate(-90 15 ${padding + chartHeight / 2})">Amount (KES)</text>
        <g transform="translate(${padding - 10}, ${padding})">
          ${Array.from({ length: 5 }, (_, i) => {
            const value = maxValue * (1 - i / 4)
            const y = (i / 4) * chartHeight
            return `<text x="0" y="${y + 5}" font-size="10" fill="#666" text-anchor="end">${(value / 1000000).toFixed(1)}M</text>`
          }).join('')}
        </g>
        <g transform="translate(${width - padding + 20}, ${padding + chartHeight - 20})">
          <rect x="0" y="0" width="15" height="15" fill="#10b981"/>
          <text x="20" y="12" font-size="12" fill="#333">Collected</text>
          <rect x="0" y="25" width="15" height="15" fill="#f59e0b"/>
          <text x="20" y="37" font-size="12" fill="#333">Expected</text>
          <rect x="0" y="50" width="15" height="15" fill="#3b82f6"/>
          <text x="20" y="62" font-size="12" fill="#333">Disbursed</text>
        </g>
      </svg>
    `
  }

  const generateLineChartSVG = (data, width = 800, height = 400, labelKey = 'month') => {
    if (!data || data.length === 0) return ''
    
    const maxValue = Math.max(
      ...data.map(d => Math.max(d.totalCollected, d.totalExpectedRepayment, d.totalDisbursed))
    )
    const padding = 60
    const chartWidth = width - padding * 2
    const chartHeight = height - padding * 2
    
    const points = {
      collected: [],
      expected: [],
      disbursed: []
    }
    
    data.forEach((row, idx) => {
      const x = padding + (idx / (data.length - 1 || 1)) * chartWidth
      points.collected.push(`${x},${padding + chartHeight - (row.totalCollected / maxValue) * chartHeight}`)
      points.expected.push(`${x},${padding + chartHeight - (row.totalExpectedRepayment / maxValue) * chartHeight}`)
      points.disbursed.push(`${x},${padding + chartHeight - (row.totalDisbursed / maxValue) * chartHeight}`)
    })
    
    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="white"/>
        <text x="${width / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold" fill="#333">Trend Analysis</text>
        <polyline points="${points.collected.join(' ')}" fill="none" stroke="#10b981" stroke-width="3"/>
        <polyline points="${points.expected.join(' ')}" fill="none" stroke="#f59e0b" stroke-width="3"/>
        <polyline points="${points.disbursed.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="3"/>
        ${data.map((row, idx) => {
          const x = padding + (idx / (data.length - 1 || 1)) * chartWidth
          const label = String(row?.[labelKey] ?? '')
          return `<circle cx="${x}" cy="${padding + chartHeight - (row.totalCollected / maxValue) * chartHeight}" r="4" fill="#10b981"/>
                  <circle cx="${x}" cy="${padding + chartHeight - (row.totalExpectedRepayment / maxValue) * chartHeight}" r="4" fill="#f59e0b"/>
                  <circle cx="${x}" cy="${padding + chartHeight - (row.totalDisbursed / maxValue) * chartHeight}" r="4" fill="#3b82f6"/>
                  <text x="${x}" y="${padding + chartHeight + 20}" text-anchor="middle" font-size="10" fill="#333">${label}</text>`
        }).join('')}
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${padding + chartHeight}" stroke="#333" stroke-width="2"/>
        <line x1="${padding}" y1="${padding + chartHeight}" x2="${width - padding}" y2="${padding + chartHeight}" stroke="#333" stroke-width="2"/>
        <g transform="translate(${width - padding + 20}, ${padding + chartHeight - 20})">
          <line x1="0" y1="0" x2="15" y2="0" stroke="#10b981" stroke-width="3"/>
          <text x="20" y="5" font-size="12" fill="#333">Collected</text>
          <line x1="0" y1="15" x2="15" y2="15" stroke="#f59e0b" stroke-width="3"/>
          <text x="20" y="20" font-size="12" fill="#333">Expected</text>
          <line x1="0" y1="30" x2="15" y2="30" stroke="#3b82f6" stroke-width="3"/>
          <text x="20" y="35" font-size="12" fill="#333">Disbursed</text>
        </g>
      </svg>
    `
  }

  const handleMaintenanceToggle = async (enabled) => {
    setMaintenanceLoading(true)
    setMaintenanceError(null)
    try {
      const res = await fetch(API_URLS.system.maintenance, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to update maintenance mode')
      }
      const data = await res.json()
      setMaintenance(Boolean(data.maintenance))
    } catch (e) {
      setMaintenanceError(e.message)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4 w-80 text-center">
            <div className="w-14 h-14 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            <div>
              <p className="text-lg font-semibold text-gray-900">Refreshing data…</p>
              <p className="text-sm text-gray-500 mt-1">
                Please wait while we pull the latest disbursements, collections, and borrowers.
              </p>
            </div>
          </div>
        </div>
      )}

      {showSuccess && !loading && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-2xl">
              ✓
            </div>
            <p className="text-lg font-semibold text-gray-900">Refresh complete</p>
            <p className="text-sm text-gray-600">
              All datasets were refreshed successfully. You can review the logs below.
            </p>
            <button
              onClick={() => setShowSuccess(false)}
              className="w-full px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Data Management Button - Fixed in corner */}
      <button
        onClick={() => setShowDataManagement(true)}
        className="fixed bottom-6 right-6 z-20 bg-primary-600 text-white px-4 py-3 rounded-lg shadow-lg hover:bg-primary-700 transition font-semibold text-sm flex items-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Data Management
      </button>

      {/* Data Management Modal */}
      {showDataManagement && (
        <div 
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDataManagement(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Data Management</h2>
              <button
                onClick={() => setShowDataManagement(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {user?.role?.toLowerCase() === 'superuser' && (
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="text-sm">
                      <div className="font-semibold text-gray-800">Maintenance mode</div>
                      <div className="text-gray-600">{maintenance ? 'On' : 'Off'}</div>
                    </div>
                    <button
                      onClick={() => handleMaintenanceToggle(!maintenance)}
                      disabled={maintenanceLoading}
                      className={`px-4 py-2 rounded-lg font-semibold text-sm border transition ${
                        maintenance
                          ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                          : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200'
                      } disabled:opacity-60`}
                    >
                      {maintenanceLoading ? 'Updating...' : maintenance ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                  {maintenanceError && (
                    <div className="mt-3 text-sm text-red-600">{maintenanceError}</div>
                  )}
                </div>
              )}
              <button 
                onClick={handleRefresh} 
                disabled={loading} 
                className="bg-primary-600 text-white font-semibold px-6 py-2 rounded shadow hover:bg-primary-700 disabled:opacity-70"
              >
                {loading ? 'Refreshing...' : 'Refresh All Data'}
              </button>
              <div className="mt-3 text-sm text-gray-600">
                Last refresh:{' '}
                {formattedLastRefresh || 'Not recorded yet'}
              </div>
              {lastRefreshError && (
                <div className="mt-1 text-xs text-red-500">{lastRefreshError}</div>
              )}
              <div className="mt-8 mb-2 font-semibold">Logs:</div>
              <div className="h-52 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-3 text-sm font-mono">
                {logs.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
              {error && <div className="text-red-600 mt-3">{error}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Zidisha Report Modal */}
      {showZidishaReport && (
        <div 
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowZidishaReport(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Zidisha Report</h2>
              <button
                onClick={() => setShowZidishaReport(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {/* Filters */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From (Month/Year)</label>
                  <input
                    type="month"
                    value={fromMonth}
                    onChange={(e) => setFromMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To (Month/Year)</label>
                  <input
                    type="month"
                    value={toMonth}
                    onChange={(e) => setToMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={generateZidishaReport}
                  disabled={zidishaReportLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {zidishaReportLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                      Generating report...
                    </>
                  ) : (
                    'Generate Report'
                  )}
                </button>

                {zidishaReport.length > 0 && !zidishaReportLoading && (
                  <div className="relative">
                    <button
                      onClick={() => setShowZidishaDownloadMenu((v) => !v)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                    >
                      Download
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showZidishaDownloadMenu && (
                      <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                        <button
                          onClick={() => {
                            setShowZidishaDownloadMenu(false)
                            downloadXLSX()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download XLSX
                        </button>
                        <button
                          onClick={() => {
                            setShowZidishaDownloadMenu(false)
                            downloadHTML()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download HTML
                        </button>
                        <button
                          onClick={() => {
                            setShowZidishaDownloadMenu(false)
                            downloadPDF()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Report Table */}
              {zidishaReportLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Processing report...</p>
                </div>
              ) : zidishaReportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {zidishaReportError}
                </div>
              ) : zidishaReport.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click "Generate Report" to view data for the selected period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Month
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Total Collected
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Total Expected Repayment
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Total Disbursed
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {zidishaReport.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {row.month}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {formatKES(row.totalCollected)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {formatKES(row.totalExpectedRepayment)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {formatKES(row.totalDisbursed)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Zidisha Branchwise Report Modal */}
      {showZidishaBranchwiseReport && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowZidishaBranchwiseReport(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Zidisha Branchwise Report</h2>
              <button
                onClick={() => setShowZidishaBranchwiseReport(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From (Month/Year)</label>
                  <input
                    type="month"
                    value={zidishaBranchwiseFromMonth}
                    onChange={(e) => setZidishaBranchwiseFromMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To (Month/Year)</label>
                  <input
                    type="month"
                    value={zidishaBranchwiseToMonth}
                    onChange={(e) => setZidishaBranchwiseToMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={generateZidishaBranchwiseReport}
                  disabled={zidishaBranchwiseReportLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {zidishaBranchwiseReportLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                      Generating report...
                    </>
                  ) : (
                    'Generate Report'
                  )}
                </button>

                {zidishaBranchwiseReport.length > 0 && !zidishaBranchwiseReportLoading && (
                  <div className="relative">
                    <button
                      onClick={() => setShowZidishaBranchwiseDownloadMenu((v) => !v)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                    >
                      Download
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showZidishaBranchwiseDownloadMenu && (
                      <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                        <button
                          onClick={() => {
                            setShowZidishaBranchwiseDownloadMenu(false)
                            downloadZidishaBranchwiseXLSX()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download XLSX
                        </button>
                        <button
                          onClick={() => {
                            setShowZidishaBranchwiseDownloadMenu(false)
                            downloadZidishaBranchwiseHTML()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download HTML
                        </button>
                        <button
                          onClick={() => {
                            setShowZidishaBranchwiseDownloadMenu(false)
                            downloadZidishaBranchwisePDF()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {zidishaBranchwiseReportLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Processing report...</p>
                </div>
              ) : zidishaBranchwiseReportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {zidishaBranchwiseReportError}
                </div>
              ) : zidishaBranchwiseReport.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click "Generate Report" to view data for the selected period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Branch</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Collected</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Expected Repayment</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Disbursed</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {zidishaBranchwiseReport.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.branch}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalCollected)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalExpectedRepayment)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalDisbursed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Advans Report Modal */}
      {showAdvansReport && (
        <div 
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAdvansReport(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Advans Report</h2>
              <button
                onClick={() => setShowAdvansReport(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From (Month/Year)</label>
                  <input
                    type="month"
                    value={advansFromMonth}
                    onChange={(e) => setAdvansFromMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To (Month/Year)</label>
                  <input
                    type="month"
                    value={advansToMonth}
                    onChange={(e) => setAdvansToMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={generateAdvansReport}
                  disabled={advansReportLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {advansReportLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                      Generating report...
                    </>
                  ) : (
                    'Generate Report'
                  )}
                </button>

                {advansReport.length > 0 && !advansReportLoading && (
                  <div className="relative">
                    <button
                      onClick={() => setShowAdvansDownloadMenu((v) => !v)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                    >
                      Download
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showAdvansDownloadMenu && (
                      <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                        <button
                          onClick={() => {
                            setShowAdvansDownloadMenu(false)
                            downloadAdvansXLSX()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download XLSX
                        </button>
                        <button
                          onClick={() => {
                            setShowAdvansDownloadMenu(false)
                            downloadAdvansHTML()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download HTML
                        </button>
                        <button
                          onClick={() => {
                            setShowAdvansDownloadMenu(false)
                            downloadAdvansPDF()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {advansReportLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Processing report...</p>
                </div>
              ) : advansReportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {advansReportError}
                </div>
              ) : advansReport.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click "Generate Report" to view data for the selected period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Month</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Collected</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Expected Repayment</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Disbursed</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {advansReport.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.month}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalCollected)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalExpectedRepayment)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalDisbursed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Boda Report Modal */}
      {showBodaReport && (
        <div 
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowBodaReport(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Boda Report</h2>
              <button
                onClick={() => setShowBodaReport(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From (Month/Year)</label>
                  <input
                    type="month"
                    value={bodaFromMonth}
                    onChange={(e) => setBodaFromMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To (Month/Year)</label>
                  <input
                    type="month"
                    value={bodaToMonth}
                    onChange={(e) => setBodaToMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={generateBodaReport}
                  disabled={bodaReportLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {bodaReportLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                      Generating report...
                    </>
                  ) : (
                    'Generate Report'
                  )}
                </button>

                {bodaReport.length > 0 && !bodaReportLoading && (
                  <div className="relative">
                    <button
                      onClick={() => setShowBodaDownloadMenu((v) => !v)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                    >
                      Download
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showBodaDownloadMenu && (
                      <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                        <button
                          onClick={() => {
                            setShowBodaDownloadMenu(false)
                            downloadBodaXLSX()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download XLSX
                        </button>
                        <button
                          onClick={() => {
                            setShowBodaDownloadMenu(false)
                            downloadBodaHTML()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download HTML
                        </button>
                        <button
                          onClick={() => {
                            setShowBodaDownloadMenu(false)
                            downloadBodaPDF()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {bodaReportLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Processing report...</p>
                </div>
              ) : bodaReportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {bodaReportError}
                </div>
              ) : bodaReport.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click "Generate Report" to view data for the selected period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Month</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Collected</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Expected Repayment</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Disbursed</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {bodaReport.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.month}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalCollected)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalExpectedRepayment)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.totalDisbursed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reports Section - Main Content */}
      <div className="space-y-6">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-2">View and manage your reports here.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Zidisha Report Card */}
          <button
            onClick={() => setShowZidishaReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Zidisha</h2>
                <p className="text-sm text-gray-500">Monthly collection, expected repayment, and disbursement report</p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Advans Report Card */}
          <button
            onClick={() => setShowAdvansReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Advans</h2>
                <p className="text-sm text-gray-500">Monthly collection, expected repayment, and disbursement report</p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Boda Report Card */}
          <button
            onClick={() => setShowBodaReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Boda</h2>
                <p className="text-sm text-gray-500">Monthly collection, expected repayment, and disbursement report</p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Zidisha Branchwise Report Card */}
          <button
            onClick={() => setShowZidishaBranchwiseReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Zidisha Branchwise</h2>
                <p className="text-sm text-gray-500">Branch totals for collected, expected repayment, and disbursed</p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </>
  )
}

export default DataOverview

import React, { useEffect, useRef, useState, useMemo } from 'react'
import { API_URLS } from '../../utils/api.js'
import { useLastRefresh } from '../../hooks/useLastRefresh.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { formatKES } from '../../utils/format.js'
import { renderLogbookWeeklyPerformanceReportHTML } from '../../reports/logbookWeeklyReportTemplate.js'
import { renderDirectorReportHTML } from '../../reports/directorReportTemplate.js'
import { renderDailyParReportHTML } from '../../reports/dailyParReportTemplate.js'
import { DEFAULT_MAINTENANCE_MESSAGE } from '../../components/MaintenanceDownScreen.jsx'

function DataOverview() {
  const [logs, setLogs] = useState([
    'Ready for ingestion...'
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState(DEFAULT_MAINTENANCE_MESSAGE)
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
  
  // Logbook Weekly Performance Report State
  const [logbookWeeklyAsAt, setLogbookWeeklyAsAt] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [logbookWeeklyReportHtml, setLogbookWeeklyReportHtml] = useState('')
  const [logbookWeeklyLoading, setLogbookWeeklyLoading] = useState(false)
  const [logbookWeeklyError, setLogbookWeeklyError] = useState(null)
  const [showLogbookWeeklyReport, setShowLogbookWeeklyReport] = useState(false)
  const [showLogbookWeeklyDownloadMenu, setShowLogbookWeeklyDownloadMenu] = useState(false)

  // Daily PAR Report State
  const [dailyParDate, setDailyParDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [dailyParCountry, setDailyParCountry] = useState('Kenya')
  const [dailyParReportHtml, setDailyParReportHtml] = useState('')
  const [dailyParLoading, setDailyParLoading] = useState(false)
  const [dailyParError, setDailyParError] = useState(null)
  const [showDailyParReport, setShowDailyParReport] = useState(false)
  const [showDailyParDownloadMenu, setShowDailyParDownloadMenu] = useState(false)
  const [dailyParEmailSending, setDailyParEmailSending] = useState(false)
  const [dailyParEmailStatus, setDailyParEmailStatus] = useState(null)

  // Boda Top Up Qualifiers Report State
  const [bodaTopupRows, setBodaTopupRows] = useState([])
  const [bodaTopupLoading, setBodaTopupLoading] = useState(false)
  const [bodaTopupError, setBodaTopupError] = useState(null)
  const [showBodaTopupReport, setShowBodaTopupReport] = useState(false)
  const [showBodaTopupDownloadMenu, setShowBodaTopupDownloadMenu] = useState(false)

  // Director Report State
  const [directorAsAt, setDirectorAsAt] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [directorReportHtml, setDirectorReportHtml] = useState('')
  const [directorReportPayload, setDirectorReportPayload] = useState(null)
  const [directorLoading, setDirectorLoading] = useState(false)
  const [directorError, setDirectorError] = useState(null)
  const [showDirectorReport, setShowDirectorReport] = useState(false)
  const [showDirectorDownloadMenu, setShowDirectorDownloadMenu] = useState(false)

  // Consolidated repayments by month (all products)
  const [repaymentsFromMonth, setRepaymentsFromMonth] = useState('2024-06')
  const [repaymentsToMonth, setRepaymentsToMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [repaymentsReport, setRepaymentsReport] = useState([])
  const [repaymentsMeta, setRepaymentsMeta] = useState(null)
  const [repaymentsPortfolio, setRepaymentsPortfolio] = useState(null)
  const [repaymentsLoading, setRepaymentsLoading] = useState(false)
  const [repaymentsError, setRepaymentsError] = useState(null)
  const [showRepaymentsReport, setShowRepaymentsReport] = useState(false)
  const [showRepaymentsDownloadMenu, setShowRepaymentsDownloadMenu] = useState(false)

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
      if (data.maintenanceMessage) {
        setMaintenanceMessage(String(data.maintenanceMessage))
      }
    } catch (e) {
      setMaintenanceError('Unable to load maintenance status')
    }
  }

  const postMaintenance = async ({ enabled, message }) => {
    setMaintenanceLoading(true)
    setMaintenanceError(null)
    try {
      const body = {}
      if (typeof enabled === 'boolean') body.enabled = enabled
      if (typeof message === 'string') body.message = message
      const res = await fetch(API_URLS.system.maintenance, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error || 'Failed to update maintenance mode')
      }
      const data = await res.json()
      setMaintenance(Boolean(data.maintenance))
      if (data.maintenanceMessage) {
        setMaintenanceMessage(String(data.maintenanceMessage))
      }
    } catch (e) {
      setMaintenanceError(e.message)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  const handleMaintenanceToggle = async (enabled) => {
    await postMaintenance({ enabled, message: maintenanceMessage })
  }

  const handleMaintenanceMessageSave = async () => {
    await postMaintenance({ message: maintenanceMessage })
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

  const generateRepaymentsReport = async () => {
    try {
      setRepaymentsLoading(true)
      setRepaymentsError(null)
      setRepaymentsReport([])
      setRepaymentsMeta(null)
      setRepaymentsPortfolio(null)

      const res = await fetch(API_URLS.reports.repaymentsByMonth, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fromMonth: repaymentsFromMonth,
          toMonth: repaymentsToMonth,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to generate repayments report')
      }

      const result = await res.json()
      setRepaymentsReport(result.data || [])
      setRepaymentsMeta(result.meta || null)
      setRepaymentsPortfolio(result.portfolio || null)
    } catch (e) {
      setRepaymentsError(e.message)
    } finally {
      setRepaymentsLoading(false)
    }
  }

  const repaymentsTotals = useMemo(() => {
    return (repaymentsReport || []).reduce(
      (acc, row) => ({
        logbook: acc.logbook + (Number(row.logbook) || 0),
        zidisha: acc.zidisha + (Number(row.zidisha) || 0),
        zidishaTarget: acc.zidishaTarget + (Number(row.zidishaTarget) || 0),
        zidishaOtc: acc.zidishaOtc + (Number(row.zidishaOtc) || 0),
        boda: acc.boda + (Number(row.boda) || 0),
        bodaTarget: acc.bodaTarget + (Number(row.bodaTarget) || 0),
        bodaOtc: acc.bodaOtc + (Number(row.bodaOtc) || 0),
        advans: acc.advans + (Number(row.advans) || 0),
        advansTarget: acc.advansTarget + (Number(row.advansTarget) || 0),
        advansOtc: acc.advansOtc + (Number(row.advansOtc) || 0),
        total: acc.total + (Number(row.total) || 0),
        totalOtc: acc.totalOtc + (Number(row.totalOtc) || 0),
      }),
      {
        logbook: 0,
        zidisha: 0,
        zidishaTarget: 0,
        zidishaOtc: 0,
        boda: 0,
        bodaTarget: 0,
        bodaOtc: 0,
        advans: 0,
        advansTarget: 0,
        advansOtc: 0,
        total: 0,
        totalOtc: 0,
      },
    )
  }, [repaymentsReport])

  const parseDMY = (str) => {
    const m = String(str || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!m) return null
    const dd = Number(m[1])
    const mm = Number(m[2])
    const yyyy = Number(m[3])
    const d = new Date(yyyy, mm - 1, dd)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const toEndOfDayIso = (date) => {
    const d = new Date(date)
    d.setHours(23, 59, 59, 999)
    return d.toISOString()
  }

  const addDays = (date, days) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d
  }

  const defaultRecommendationsHtml = useMemo(() => {
    // This is intentionally kept as raw HTML to preserve the exact template design.
    return `
  <!-- CRITICAL -->
  <div style="background:#FFF0EE;padding:3px 7px;border-bottom:0.5px solid var(--border);font-size:7pt;font-weight:600;color:var(--red);letter-spacing:1px;text-transform:uppercase">Critical Priority — Immediate Action This Week</div>

  <div class="rec-item">
    <div class="rec-num">01</div>
    <div class="rec-text"><strong>Implement daily PAR aging buckets report</strong> (1–30, 31–60, 61–90, 90+ days). Current single PAR% masks severity distribution and prevents targeted recovery.</div>
    <div class="rec-cat">Reporting</div>
    <div><span class="badge badge-crit">Critical</span></div>
    <div class="rec-owner">Head of Collections</div>
    <div class="rec-due">Immediate</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">02</div>
    <div class="rec-text"><strong>Branch emergency audit</strong> — investigate any branch where PAR doubled week-over-week, indicating accounts migrating into arrears. Identify accounts, escalate and initiate recovery.</div>
    <div class="rec-cat">Collections</div>
    <div><span class="badge badge-crit">Critical</span></div>
    <div class="rec-owner">Branch Mgr</div>
    <div class="rec-due">This week</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">03</div>
    <div class="rec-text"><strong>Assign dedicated recovery officers</strong> to top delinquent accounts for branches with the highest PAR balance. Current aging delinquency is not being resolved fast enough.</div>
    <div class="rec-cat">Collections</div>
    <div><span class="badge badge-crit">Critical</span></div>
    <div class="rec-owner">Head of Collections</div>
    <div class="rec-due">This week</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">04</div>
    <div class="rec-text"><strong>Sales emergency response</strong> — for branches far below target, review agent roster, pipeline, and market strategy. This is a structural failure, not a single bad week.</div>
    <div class="rec-cat">Sales</div>
    <div><span class="badge badge-crit">Critical</span></div>
    <div class="rec-owner">Head of Sales</div>
    <div class="rec-due">This week</div>
  </div>

  <!-- HIGH -->
  <div style="background:#FEF3EC;padding:3px 7px;border-bottom:0.5px solid var(--border);font-size:7pt;font-weight:600;color:var(--orange);letter-spacing:1px;text-transform:uppercase">High Priority — Complete Within 2 Weeks</div>

  <div class="rec-item">
    <div class="rec-num">05</div>
    <div class="rec-text"><strong>Pause new disbursements</strong> for any new market/branch until collection rate stabilises. Conduct first-cycle monitoring review.</div>
    <div class="rec-cat">Risk</div>
    <div><span class="badge badge-high">High</span></div>
    <div class="rec-owner">Country Mgr</div>
    <div class="rec-due">This week</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">06</div>
    <div class="rec-text"><strong>Daily client follow-up register</strong> — implement mandatory demand letters within 3 days of missed payment; remove reliance on client promises-to-pay.</div>
    <div class="rec-cat">Collections</div>
    <div><span class="badge badge-high">High</span></div>
    <div class="rec-owner">Branch Mgr</div>
    <div class="rec-due">Next 2 weeks</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">07</div>
    <div class="rec-text"><strong>Standardise demand letter protocol</strong> company-wide: issue within 3 days of missed payment (not on promise-to-pay). Enforce with branch oversight.</div>
    <div class="rec-cat">Collections</div>
    <div><span class="badge badge-high">High</span></div>
    <div class="rec-owner">Head of Collections</div>
    <div class="rec-due">Next 2 weeks</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">08</div>
    <div class="rec-text"><strong>Add loan officer-level performance breakdown</strong> to weekly report. Branch aggregates mask individual accountability.</div>
    <div class="rec-cat">Reporting</div>
    <div><span class="badge badge-high">High</span></div>
    <div class="rec-owner">MIS / Reporting</div>
    <div class="rec-due">Next 2 weeks</div>
  </div>

  <!-- MEDIUM -->
  <div style="background:#F5F5F5;padding:3px 7px;border-bottom:0.5px solid var(--border);font-size:7pt;font-weight:600;color:#555;letter-spacing:1px;text-transform:uppercase">Medium Priority — Complete Within 30 Days</div>

  <div class="rec-item">
    <div class="rec-num">09</div>
    <div class="rec-text"><strong>Document and share best practices</strong> from top branches on collection discipline and PAR management.</div>
    <div class="rec-cat">Knowledge Mgmt</div>
    <div><span class="badge badge-med">Medium</span></div>
    <div class="rec-owner">Branch Managers</div>
    <div class="rec-due">Next month</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">10</div>
    <div class="rec-text"><strong>Introduce PAR aging buckets & provision coverage tracking</strong> in weekly reporting.</div>
    <div class="rec-cat">Reporting</div>
    <div><span class="badge badge-med">Medium</span></div>
    <div class="rec-owner">Finance / MIS</div>
    <div class="rec-due">Next month</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">11</div>
    <div class="rec-text"><strong>Launch top-up loan campaigns</strong> for clients with clean repayment history to grow quality book.</div>
    <div class="rec-cat">Sales</div>
    <div><span class="badge badge-med">Medium</span></div>
    <div class="rec-owner">Branch Mgr</div>
    <div class="rec-due">Next month</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">12</div>
    <div class="rec-text"><strong>Weekly pipeline review</strong> — investigate whether portfolio decline is from low disbursement or collections pressure.</div>
    <div class="rec-cat">Operations</div>
    <div><span class="badge badge-med">Medium</span></div>
    <div class="rec-owner">Regional Mgr</div>
    <div class="rec-due">Next month</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">13</div>
    <div class="rec-text"><strong>Add YTD cumulative columns</strong> to weekly report alongside week-over-week.</div>
    <div class="rec-cat">Reporting</div>
    <div><span class="badge badge-med">Medium</span></div>
    <div class="rec-owner">MIS / Reporting</div>
    <div class="rec-due">Next month</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">14</div>
    <div class="rec-text"><strong>Segment portfolio</strong> into Growth / Stable / Shrinking buckets and assign recovery vs sales priorities.</div>
    <div class="rec-cat">Strategy</div>
    <div><span class="badge badge-med">Medium</span></div>
    <div class="rec-owner">CEO / Credit Comm.</div>
    <div class="rec-due">Next month</div>
  </div>

  <!-- LOW -->
  <div style="background:#F5F5F5;padding:3px 7px;border-bottom:0.5px solid var(--border);font-size:7pt;font-weight:600;color:#777;letter-spacing:1px;text-transform:uppercase">Low Priority — Next Quarter</div>

  <div class="rec-item">
    <div class="rec-num">15</div>
    <div class="rec-text"><strong>Add client-level metrics</strong>: active clients, new clients, churned clients per branch per week.</div>
    <div class="rec-cat">Reporting</div>
    <div><span class="badge badge-low">Low</span></div>
    <div class="rec-owner">MIS / Reporting</div>
    <div class="rec-due">Next quarter</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">16</div>
    <div class="rec-text"><strong>Develop FX translation policy</strong> for cross-border portfolio reporting; disclose KES/UGX rate used each week.</div>
    <div class="rec-cat">Finance</div>
    <div><span class="badge badge-low">Low</span></div>
    <div class="rec-owner">CFO</div>
    <div class="rec-due">Next quarter</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">17</div>
    <div class="rec-text"><strong>Evaluate cost of funds vs. portfolio yield</strong> to compute Net Interest Margin per branch.</div>
    <div class="rec-cat">Finance</div>
    <div><span class="badge badge-low">Low</span></div>
    <div class="rec-owner">CFO</div>
    <div class="rec-due">Next quarter</div>
  </div>
  <div class="rec-item">
    <div class="rec-num">18</div>
    <div class="rec-text"><strong>Implement write-off and provisioning policy</strong>; track provision coverage ratio weekly.</div>
    <div class="rec-cat">Credit Risk</div>
    <div><span class="badge badge-low">Low</span></div>
    <div class="rec-owner">Head of Credit</div>
    <div class="rec-due">Next quarter</div>
  </div>
    `
  }, [])

  const generateLogbookWeeklyReport = async () => {
    try {
      setLogbookWeeklyLoading(true)
      setLogbookWeeklyError(null)
      setLogbookWeeklyReportHtml('')

      const asAt = new Date(`${logbookWeeklyAsAt}T00:00:00`)
      if (Number.isNaN(asAt.getTime())) throw new Error('Invalid "As at" date')
      const prevAsAt = addDays(asAt, -7)

      const month = asAt.getMonth() + 1
      const year = asAt.getFullYear()
      const monthStart = new Date(year, month - 1, 1)

      const [branchesRes, disbRes, colRes, targetsRes, parHistoryRes] = await Promise.all([
        fetch(API_URLS.logbook.branches, { credentials: 'include' }),
        fetch(API_URLS.logbook.disbursements, { credentials: 'include' }),
        fetch(API_URLS.logbook.collections, { credentials: 'include' }),
        fetch(API_URLS.targets.logbook.list, { credentials: 'include' }),
        fetch(API_URLS.par.history, { credentials: 'include' }),
      ])

      if (!branchesRes.ok) throw new Error('Failed to load Logbook branches')
      if (!disbRes.ok) throw new Error('Failed to load Logbook disbursements')
      if (!colRes.ok) throw new Error('Failed to load Logbook collections')
      if (!targetsRes.ok) throw new Error('Failed to load Logbook targets')
      if (!parHistoryRes.ok) throw new Error('Failed to load PAR history')

      const logbookBranches = await branchesRes.json()
      const disbRows = await disbRes.json()
      const colRows = await colRes.json()
      const targetsAll = await targetsRes.json()
      const parHistory = await parHistoryRes.json()

      const codeToName = new Map()
      const nameToCode = new Map()
      for (const b of Array.isArray(logbookBranches) ? logbookBranches : []) {
        const code = String(b.code || '').trim()
        const name = String(b.name || '').trim()
        if (code) {
          codeToName.set(code.toLowerCase(), name || code)
          if (name) nameToCode.set(name.toLowerCase(), code)
        }
      }
      const toBranchCode = (v) => {
        const s = String(v || '').trim()
        if (!s) return ''
        const asCode = s.toLowerCase()
        if (codeToName.has(asCode)) return s
        const viaName = nameToCode.get(asCode)
        return viaName ? viaName : s
      }
      const toBranchName = (codeOrName) => {
        const s = String(codeOrName || '').trim()
        if (!s) return ''
        const asCode = s.toLowerCase()
        if (codeToName.has(asCode)) return codeToName.get(asCode)
        return s
      }

      const targets = (Array.isArray(targetsAll) ? targetsAll : [])
        .filter((t) => Number(t.month) === month && Number(t.year) === year && Number(t.active ?? 1) === 1)

      const targetsByBranch = new Map()
      for (const t of targets) {
        const raw = String(t.branch || '').trim()
        const code = toBranchCode(raw)
        if (!code) continue
        targetsByBranch.set(code.toLowerCase(), {
          disbursementTarget: Number(t.disbursement_target) || 0,
          collectionTarget: Number(t.collection_target) || 0,
        })
      }

      const inRange = (d, start, end) => d && d >= start && d <= end

      const sumByBranch = (rows, dateField, amountField, start, end) => {
        const by = new Map()
        for (const r of rows || []) {
          const branch = String(r.branch || r.Branch || r['Branch'] || '').trim()
          if (!branch) continue
          const dt = parseDMY(r[dateField] || r[dateField?.toLowerCase?.()] || r[dateField] || r[dateField])
          const date = dt || parseDMY(r[dateField])
          if (!date) continue
          if (!inRange(date, start, end)) continue
          const amt = Number(r[amountField] ?? r[amountField?.toLowerCase?.()] ?? r[amountField]) || 0
          by.set(branch, (by.get(branch) || 0) + amt)
        }
        return by
      }

      const disbMtdByBranch = new Map()
      for (const r of disbRows || []) {
        const branchCode = toBranchCode(r.branch)
        if (!branchCode) continue
        const d = parseDMY(r.disbursed_date)
        if (!d) continue
        if (!inRange(d, monthStart, asAt)) continue
        const amt = Number(r.disbursed) || 0
        disbMtdByBranch.set(branchCode, (disbMtdByBranch.get(branchCode) || 0) + amt)
      }

      const disbPrevMtdByBranch = new Map()
      for (const r of disbRows || []) {
        const branchCode = toBranchCode(r.branch)
        if (!branchCode) continue
        const d = parseDMY(r.disbursed_date)
        if (!d) continue
        if (!inRange(d, monthStart, prevAsAt)) continue
        const amt = Number(r.disbursed) || 0
        disbPrevMtdByBranch.set(branchCode, (disbPrevMtdByBranch.get(branchCode) || 0) + amt)
      }

      const colMtdByBranch = new Map()
      for (const r of colRows || []) {
        const branchCode = toBranchCode(r.branch)
        if (!branchCode) continue
        const d = parseDMY(r.repayment_collected_date)
        if (!d) continue
        if (!inRange(d, monthStart, asAt)) continue
        const amt = Number(r.repayment_amount) || 0
        colMtdByBranch.set(branchCode, (colMtdByBranch.get(branchCode) || 0) + amt)
      }

      const colPrevMtdByBranch = new Map()
      for (const r of colRows || []) {
        const branchCode = toBranchCode(r.branch)
        if (!branchCode) continue
        const d = parseDMY(r.repayment_collected_date)
        if (!d) continue
        if (!inRange(d, monthStart, prevAsAt)) continue
        const amt = Number(r.repayment_amount) || 0
        colPrevMtdByBranch.set(branchCode, (colPrevMtdByBranch.get(branchCode) || 0) + amt)
      }

      const historyRows = Array.isArray(parHistory) ? parHistory : []
      const pickSnapshotTime = (endDate) => {
        const endIso = toEndOfDayIso(endDate)
        const candidates = historyRows
          .map((r) => String(r.time || '').trim())
          .filter(Boolean)
          .filter((t) => t <= endIso)
          .sort((a, b) => b.localeCompare(a))
        return candidates[0] || (historyRows[0]?.time ? String(historyRows[0].time) : '')
      }

      const currParTime = pickSnapshotTime(asAt)
      const prevParTime = pickSnapshotTime(prevAsAt)

      const [currParBranchesRes, prevParBranchesRes] = await Promise.all([
        fetch(`${API_URLS.par.branches}?time=${encodeURIComponent(currParTime)}`, { credentials: 'include' }),
        fetch(`${API_URLS.par.branches}?time=${encodeURIComponent(prevParTime)}`, { credentials: 'include' }),
      ])
      if (!currParBranchesRes.ok) throw new Error('Failed to load PAR by branch (current)')
      if (!prevParBranchesRes.ok) throw new Error('Failed to load PAR by branch (previous)')
      const currParBranches = await currParBranchesRes.json()
      const prevParBranches = await prevParBranchesRes.json()

      const currParByCode = new Map()
      const prevParByCode = new Map()
      for (const r of currParBranches || []) currParByCode.set(String(r.code || '').trim().toLowerCase(), r)
      for (const r of prevParBranches || []) prevParByCode.set(String(r.code || '').trim().toLowerCase(), r)

      const allBranchCodes = new Set([
        ...Array.from(disbMtdByBranch.keys()),
        ...Array.from(colMtdByBranch.keys()),
        ...Array.from(currParByCode.values()).map((r) => String(r.code || '').trim()).filter(Boolean),
        ...Array.from(targetsByBranch.keys()),
      ].map((x) => toBranchCode(x)).filter(Boolean))

      const branchOverviewRows = Array.from(allBranchCodes)
        .map((branchCodeRaw) => {
          const branchCode = toBranchCode(branchCodeRaw)
          if (!branchCode) return null
          const branchName = toBranchName(branchCode)
          const t = targetsByBranch.get(branchCode.toLowerCase()) || { disbursementTarget: 0, collectionTarget: 0 }
          const salesMtd = Number(disbMtdByBranch.get(branchCode) || 0)
          const collectionsMtd = Number(colMtdByBranch.get(branchCode) || 0)
          const salesTargetAchPct = t.disbursementTarget > 0 ? (salesMtd / t.disbursementTarget) * 100 : 0
          const collectionsTargetAchPct = t.collectionTarget > 0 ? (collectionsMtd / t.collectionTarget) * 100 : 0

          const parRow = currParByCode.get(branchCode.toLowerCase())
          const portfolio = Number(parRow?.openLoans || 0)
          const parBalance = Number(parRow?.pastMissed || 0)
          const parRate = Number(parRow?.parRate || 0)

          const scoreSales = Math.max(0, Math.min(25, (salesTargetAchPct / 100) * 25))
          const scoreCollections = Math.max(0, Math.min(25, (collectionsTargetAchPct / 100) * 25))
          const scorePar = Math.max(0, Math.min(25, (1 - Math.min(1, parRate / 12)) * 25))
          const scorePortfolio = 25 // neutral for now (no target)
          const compositeScore = scoreSales + scoreCollections + scorePar + scorePortfolio

          let tag = ''
          if (parRate > 25) tag = 'CRIT'
          else if (parRate > 12) tag = 'WATCH'
          else if (salesTargetAchPct >= 70 && collectionsTargetAchPct >= 70) tag = 'BEST'

          return {
            branchCode,
            branch: branchName,
            salesMtd,
            salesTargetAchPct,
            collectionsMtd,
            collectionsTargetAchPct,
            portfolio,
            parRate,
            parBalance,
            compositeScore,
            tag,
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b.parRate || 0) - (a.parRate || 0))

      const salesMtdTotal = branchOverviewRows.reduce((s, r) => s + (Number(r.salesMtd) || 0), 0)
      const collectionsMtdTotal = branchOverviewRows.reduce((s, r) => s + (Number(r.collectionsMtd) || 0), 0)
      const salesTargetTotal = targets.reduce((s, t) => s + (Number(t.disbursement_target) || 0), 0)
      const collectionsTargetTotal = targets.reduce((s, t) => s + (Number(t.collection_target) || 0), 0)
      const salesTargetAchPct = salesTargetTotal > 0 ? (salesMtdTotal / salesTargetTotal) * 100 : 0
      const collectionsTargetAchPct = collectionsTargetTotal > 0 ? (collectionsMtdTotal / collectionsTargetTotal) * 100 : 0

      const portfolioTotal = branchOverviewRows.reduce((s, r) => s + (Number(r.portfolio) || 0), 0)
      const parBalanceTotal = branchOverviewRows.reduce((s, r) => s + (Number(r.parBalance) || 0), 0)
      const avgParRate = portfolioTotal > 0 ? (parBalanceTotal / portfolioTotal) * 100 : 0

      const prevSalesMtdTotal = Array.from(disbPrevMtdByBranch.values()).reduce((s, v) => s + (Number(v) || 0), 0)
      const prevCollectionsMtdTotal = Array.from(colPrevMtdByBranch.values()).reduce((s, v) => s + (Number(v) || 0), 0)

      const prevPortfolioRows = Array.isArray(prevParBranches) ? prevParBranches : []
      const portfolioPrevTotal = prevPortfolioRows.reduce((s, r) => s + (Number(r.openLoans) || 0), 0)
      const parPrevTotal = prevPortfolioRows.reduce((s, r) => s + (Number(r.pastMissed) || 0), 0)
      const prevAvgParRate = portfolioPrevTotal > 0 ? (parPrevTotal / portfolioPrevTotal) * 100 : 0

      const branchesCount = branchOverviewRows.length
      const branchesInBreach = branchOverviewRows.filter((r) => (Number(r.parRate) || 0) > 12).length
      const statusText = branchesInBreach > 0 ? 'Action Required' : 'On Track'
      const statusColor = branchesInBreach > 0 ? 'var(--red)' : 'var(--green)'

      const parWoWRows = branchOverviewRows
        .map((r) => {
          const prevRow = prevParByCode.get(String(r.branchCode).toLowerCase())
          const prevParRate = Number(prevRow?.parRate || 0)
          const currParRate = Number(r.parRate || 0)
          const balance = Number(r.parBalance || 0)
          const critical = currParRate >= 25
          const badge = critical
            ? '<span class="badge badge-crit">Critical</span>'
            : currParRate > 12
              ? '<span class="badge badge-red">Breach</span>'
              : '<span class="badge badge-green">Within</span>'
          return {
            branch: r.branch,
            prevParRate,
            currParRate,
            parBalance: balance,
            statusBadgeHtml: badge,
          }
        })
        .sort((a, b) => (b.currParRate || 0) - (a.currParRate || 0))

      const portfolioMovementRows = branchOverviewRows
        .map((r) => {
          const prevRow = prevParByCode.get(String(r.branchCode).toLowerCase())
          const prev = Number(prevRow?.openLoans || 0)
          const current = Number(r.portfolio || 0)
          const sharePct = portfolioTotal > 0 ? (current / portfolioTotal) * 100 : 0
          return { branch: r.branch, prev, current, sharePct }
        })
        .sort((a, b) => (b.current || 0) - (a.current || 0))

      const scorecardRows = branchOverviewRows
        .map((r) => ({ branch: r.branch, score: r.compositeScore }))
        .sort((a, b) => (b.score || 0) - (a.score || 0))

      const html = renderLogbookWeeklyPerformanceReportHTML({
        asAt: asAt.toISOString(),
        branchesCount,
        branchesLabel: `${branchesCount} (scoped)`,
        statusText,
        statusColor,
        parThreshold: 12,
        branchesInBreach,
        kpis: {
          salesMtd: salesMtdTotal,
          collectionsMtd: collectionsMtdTotal,
          portfolio: portfolioTotal,
          avgParRate,
          parBalance: parBalanceTotal,
        },
        prevKpis: {
          salesMtd: prevSalesMtdTotal,
          collectionsMtd: prevCollectionsMtdTotal,
          portfolio: portfolioPrevTotal,
          avgParRate: prevAvgParRate,
        },
        totals: {
          salesMtdTotal,
          collectionsMtdTotal,
          salesTargetTotal,
          collectionsTargetTotal,
          salesTargetAchPct,
          collectionsTargetAchPct,
          portfolioTotal,
          portfolioPrevTotal,
        },
        branchOverviewRows,
        parWoWRows,
        portfolioMovementRows,
        scorecardRows,
        recommendationsHtml: defaultRecommendationsHtml,
        recommendationCounts: { critical: 4, high: 4, mediumLow: 10 },
      })

      setLogbookWeeklyReportHtml(html)
    } catch (e) {
      setLogbookWeeklyError(e.message || 'Failed to generate report')
    } finally {
      setLogbookWeeklyLoading(false)
    }
  }

  const generateDirectorReport = async () => {
    try {
      setDirectorLoading(true)
      setDirectorError(null)
      setDirectorReportHtml('')
      setDirectorReportPayload(null)

      const res = await fetch(API_URLS.reports.director, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asAt: directorAsAt }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed to generate report (${res.status})`)

      const html = renderDirectorReportHTML({
        summary: data.summary,
        commentary: data.commentary,
        generatedAt: data.generatedAt,
      })
      setDirectorReportHtml(html)
      setDirectorReportPayload({
        summary: data.summary,
        commentary: data.commentary,
        generatedAt: data.generatedAt,
      })
    } catch (e) {
      setDirectorError(e.message || 'Failed to generate director report')
    } finally {
      setDirectorLoading(false)
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

  const downloadRepaymentsXLSX = () => {
    import('xlsx').then((XLSX) => {
      const wb = XLSX.utils.book_new()
      const monthly = repaymentsReport.map((row) => ({
        Month: row.month,
        Logbook: row.logbook,
        Zidisha: row.zidisha,
        'Zidisha Collection Target': row.zidishaTarget,
        'Zidisha OTC': row.zidishaOtc,
        Boda: row.boda,
        'Boda Collection Target': row.bodaTarget,
        'Boda OTC': row.bodaOtc,
        Advans: row.advans,
        'Advans Collection Target': row.advansTarget,
        'Advans OTC': row.advansOtc,
        Total: row.total,
        'Total OTC': row.totalOtc,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly), 'Repayments')
      if (repaymentsPortfolio) {
        const portfolioSheet = XLSX.utils.json_to_sheet([
          {
            AsOf: repaymentsPortfolio.asOf || '',
            Logbook: repaymentsPortfolio.logbook,
            Zidisha: repaymentsPortfolio.zidisha,
            Boda: repaymentsPortfolio.boda,
            Advans: repaymentsPortfolio.advans,
            Total: repaymentsPortfolio.total,
          },
        ])
        XLSX.utils.book_append_sheet(wb, portfolioSheet, 'Portfolio Totals')

        const byBranch = repaymentsPortfolio.byBranch || {}
        const appendBranchSheet = (name, rows) => {
          const data = (rows || []).map((r) => ({
            Branch: r.branch,
            Portfolio: r.portfolio,
          }))
          if (!data.length) data.push({ Branch: '—', Portfolio: 0 })
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name)
        }
        appendBranchSheet('Logbook Branches', byBranch.logbook)
        appendBranchSheet('Zidisha Branches', byBranch.zidisha)
        appendBranchSheet('Boda Branches', byBranch.boda)
        appendBranchSheet('Advans Branches', byBranch.advans)
      }
      XLSX.writeFile(wb, `repayments-by-month-${repaymentsFromMonth}-to-${repaymentsToMonth}.xlsx`)
    })
  }

  // Zidisha Branchwise download functions
  const downloadZidishaBranchwiseXLSX = () =>
    downloadXLSXGeneric(zidishaBranchwiseReport, 'Zidisha Branchwise', zidishaBranchwiseFromMonth, zidishaBranchwiseToMonth, 'Branch', 'branch')
  const downloadZidishaBranchwiseHTML = () =>
    downloadHTMLGeneric(zidishaBranchwiseReport, 'Zidisha Branchwise', zidishaBranchwiseFromMonth, zidishaBranchwiseToMonth, 'Branch', 'branch')
  const downloadZidishaBranchwisePDF = () =>
    downloadPDFGeneric(zidishaBranchwiseReport, 'Zidisha Branchwise', zidishaBranchwiseFromMonth, zidishaBranchwiseToMonth, 'Branch', 'branch')

  const downloadLogbookWeeklyHTML = () => {
    const safeName = 'logbook-product-weekly-performance-report'
    const blob = new Blob([logbookWeeklyReportHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}-${logbookWeeklyAsAt}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const generateBodaTopupQualifiers = async () => {
    try {
      setBodaTopupLoading(true)
      setBodaTopupError(null)
      setBodaTopupRows([])

      const res = await fetch(`${API_URLS.reports.bodaTopupQualifiers}?minPercentPaid=70`, { credentials: 'include' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to load report')
      }
      const body = await res.json()
      setBodaTopupRows(Array.isArray(body?.data) ? body.data : [])
    } catch (e) {
      setBodaTopupError(e.message)
    } finally {
      setBodaTopupLoading(false)
    }
  }

  const downloadBodaTopupXLSX = () => {
    import('xlsx').then((XLSX) => {
      const safeName = 'boda-top-up-qualifiers'
      const ws = XLSX.utils.json_to_sheet(
        (bodaTopupRows || []).map((r) => ({
          'Client Name': r.clientName,
          'Principal Amount': r.principalAmount,
          'Principal Outstanding': r.principalOutstanding,
          '% Principal Paid': Number(r.percentPrincipalPaid || 0),
          'Expected Matured On Date': r.expectedMaturedOnDate,
          'Branch Name': r.branchName,
          'Client Id': r.clientId,
        }))
      )
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Boda Top Up Qualifiers')
      XLSX.writeFile(wb, `${safeName}.xlsx`)
    })
  }

  const downloadBodaTopupHTML = () => {
    const safeName = 'boda-top-up-qualifiers'
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Boda Top Up Qualifiers</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { margin: 0 0 12px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; }
            th { background: #f2f2f2; text-align: left; }
            td.num, th.num { text-align: right; }
          </style>
        </head>
        <body>
          <h1>Boda Top Up Qualifiers</h1>
          <table>
            <thead>
              <tr>
                <th>Client Name</th>
                <th class="num">Principal Amount</th>
                <th class="num">Principal Outstanding</th>
                <th class="num">% Principal Paid</th>
                <th>Expected Matured On Date</th>
              </tr>
            </thead>
            <tbody>
              ${(bodaTopupRows || []).map((r) => `
                <tr>
                  <td>${r.clientName || ''}</td>
                  <td class="num">${formatKES(r.principalAmount)}</td>
                  <td class="num">${formatKES(r.principalOutstanding)}</td>
                  <td class="num">${Number(r.percentPrincipalPaid || 0).toFixed(2)}%</td>
                  <td>${r.expectedMaturedOnDate || ''}</td>
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
    a.download = `${safeName}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadBodaTopupPDF = async () => {
    const printWindow = window.open('', '_blank')
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Boda Top Up Qualifiers</title>
        </head>
        <body>
          <h1>Boda Top Up Qualifiers</h1>
          <p>Source: zidisha_data (Product = Zidisha Boda)</p>
          <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%">
            <thead>
              <tr>
                <th align="left">Client Name</th>
                <th align="right">Principal Amount</th>
                <th align="right">Principal Outstanding</th>
                <th align="right">% Principal Paid</th>
                <th align="left">Expected Matured On Date</th>
              </tr>
            </thead>
            <tbody>
              ${(bodaTopupRows || []).map((r) => `
                <tr>
                  <td>${r.clientName || ''}</td>
                  <td align="right">${formatKES(r.principalAmount)}</td>
                  <td align="right">${formatKES(r.principalOutstanding)}</td>
                  <td align="right">${Number(r.percentPrincipalPaid || 0).toFixed(2)}%</td>
                  <td>${r.expectedMaturedOnDate || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `
    if (printWindow) {
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.onload = () => setTimeout(() => printWindow.print(), 400)
      return
    }
    // Popup blocked: fall back to HTML download
    downloadBodaTopupHTML()
  }

  const downloadLogbookWeeklyPDF = async () => {
    // Prefer native print-to-PDF for pixel-perfect CSS (html2canvas often renders "skeletal" output).
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.open()
      printWindow.document.write(logbookWeeklyReportHtml)
      printWindow.document.close()
      printWindow.onload = () => setTimeout(() => printWindow.print(), 500)
      return
    }

    // Fallback: html2pdf if popups are blocked
    const html2pdf = (await import('html2pdf.js')).default
    const safeName = 'logbook-product-weekly-performance-report'

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.top = '0'
    iframe.style.left = '0'
    iframe.style.width = '1400px'
    iframe.style.height = '900px'
    iframe.style.border = 'none'
    iframe.style.zIndex = '9999'
    document.body.appendChild(iframe)

    iframe.contentDocument.open()
    iframe.contentDocument.write(logbookWeeklyReportHtml)
    iframe.contentDocument.close()

    await new Promise((resolve) => setTimeout(resolve, 1200))

    const element = iframe.contentDocument.body
    const opt = {
      margin: [0, 0, 0, 0],
      filename: `${safeName}-${logbookWeeklyAsAt}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 1400,
        windowHeight: element.scrollHeight,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }

    await html2pdf().set(opt).from(element).save()
    document.body.removeChild(iframe)
  }

  const generateDailyParReport = async () => {
    try {
      setDailyParLoading(true)
      setDailyParError(null)
      setDailyParReportHtml('')
      setDailyParEmailStatus(null)
      const params = new URLSearchParams()
      if (dailyParDate) params.set('date', dailyParDate)
      if (dailyParCountry) params.set('country', dailyParCountry)
      const url = `${API_URLS.reports.dailyPar}?${params.toString()}`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Failed to load daily PAR (${res.status})`)
      }
      const data = await res.json()
      setDailyParReportHtml(renderDailyParReportHTML(data))
    } catch (e) {
      console.error('Daily PAR report error:', e)
      setDailyParError(e.message || 'Failed to generate daily PAR report')
    } finally {
      setDailyParLoading(false)
    }
  }

  const sendDailyParEmail = async () => {
    try {
      setDailyParEmailSending(true)
      setDailyParEmailStatus(null)
      const res = await fetch(API_URLS.reports.dailyParSend, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dailyParDate, country: dailyParCountry }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || data.reason || `Send failed (${res.status})`)
      }
      if (data.skipped) {
        setDailyParEmailStatus({
          ok: false,
          message: data.reason || 'Email skipped (check SMTP / recipients)',
        })
      } else {
        setDailyParEmailStatus({
          ok: true,
          message: `Sent to ${(data.to || []).join(', ') || 'recipients'}${data.cc?.length ? ` (cc: ${data.cc.join(', ')})` : ''}`,
        })
      }
    } catch (e) {
      setDailyParEmailStatus({ ok: false, message: e.message || 'Failed to send email' })
    } finally {
      setDailyParEmailSending(false)
    }
  }

  const downloadDailyParHTML = () => {
    const safeName = 'daily-par-report'
    const blob = new Blob([dailyParReportHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}-${dailyParDate}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadDailyParPDF = async () => {
    // Capture at design page width (794px ≈ A4 @ 96dpi), then scale to one A4 portrait page.
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')
      const safeName = 'daily-par-report'
      const PAGE_W = 794

      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.left = '-10000px'
      iframe.style.top = '0'
      iframe.style.width = `${PAGE_W}px`
      iframe.style.height = '1200px'
      iframe.style.border = 'none'
      iframe.style.opacity = '0'
      iframe.style.pointerEvents = 'none'
      document.body.appendChild(iframe)

      iframe.contentDocument.open()
      iframe.contentDocument.write(dailyParReportHtml)
      iframe.contentDocument.close()
      // Allow Inter @import + layout paint before capture
      await new Promise((resolve) => setTimeout(resolve, 800))

      const element = iframe.contentDocument.querySelector('.page') || iframe.contentDocument.body
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: PAGE_W,
        width: PAGE_W,
        scrollX: 0,
        scrollY: 0,
      })

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const marginX = 6
      const marginTop = 4
      const maxW = pageW - marginX * 2
      const maxH = pageH - marginTop - 4
      const imgW = canvas.width
      const imgH = canvas.height
      const pxToMm = 0.264583
      const scale = Math.min(maxW / (imgW * pxToMm), maxH / (imgH * pxToMm))
      const renderW = imgW * pxToMm * scale
      const renderH = imgH * pxToMm * scale
      const x = (pageW - renderW) / 2
      const y = marginTop // pin to top — no vertical centering
      const imgData = canvas.toDataURL('image/jpeg', 0.98)
      pdf.addImage(imgData, 'JPEG', x, y, renderW, renderH)
      pdf.save(`${safeName}-${dailyParDate}.pdf`)
      document.body.removeChild(iframe)
      return
    } catch (err) {
      console.error('Daily PAR PDF failed, falling back to print:', err)
    }

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.open()
      printWindow.document.write(dailyParReportHtml)
      printWindow.document.close()
      printWindow.onload = () => setTimeout(() => printWindow.print(), 400)
    }
  }

  const downloadDirectorHTML = () => {
    const safeName = 'board-report'
    const blob = new Blob([directorReportHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}-${directorAsAt}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadDirectorDOCX = async () => {
    const safeName = 'board-report'
    if (!directorReportPayload?.summary) {
      setDirectorError('Generate the board report before downloading Word.')
      return
    }
    try {
      const { buildDirectorReportDocxBlob } = await import('../../../lib/directorReportDocx.mjs')
      const blob = await buildDirectorReportDocxBlob({
        summary: directorReportPayload.summary,
        commentary: directorReportPayload.commentary,
        generatedAt: directorReportPayload.generatedAt,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeName}-${directorAsAt}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDirectorError(e.message || 'Failed to download Word document')
    }
  }

  const downloadDirectorPDF = async () => {
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.open()
      printWindow.document.write(directorReportHtml)
      printWindow.document.close()
      printWindow.onload = () => setTimeout(() => printWindow.print(), 500)
      return
    }

    const html2pdf = (await import('html2pdf.js')).default
    const safeName = 'board-report'
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.top = '0'
    iframe.style.left = '0'
    iframe.style.width = '1400px'
    iframe.style.height = '900px'
    iframe.style.border = 'none'
    iframe.style.zIndex = '9999'
    document.body.appendChild(iframe)

    iframe.contentDocument.open()
    iframe.contentDocument.write(directorReportHtml)
    iframe.contentDocument.close()

    await new Promise((resolve) => setTimeout(resolve, 1200))

    const element = iframe.contentDocument.body
    const opt = {
      margin: [8, 8, 8, 8],
      filename: `${safeName}-${directorAsAt}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 1400,
        windowHeight: element.scrollHeight,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }

    await html2pdf().set(opt).from(element).save()
    document.body.removeChild(iframe)
  }

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
                <div className="mb-6 pb-6 border-b border-gray-200 space-y-4">
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
                  <div>
                    <label htmlFor="maintenance-message" className="block text-sm font-semibold text-gray-800 mb-1">
                      Error message shown to users
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      When maintenance is on, all non-superusers see a blank white screen with this message only.
                    </p>
                    <textarea
                      id="maintenance-message"
                      rows={3}
                      maxLength={500}
                      value={maintenanceMessage}
                      onChange={(e) => setMaintenanceMessage(e.target.value)}
                      placeholder={DEFAULT_MAINTENANCE_MESSAGE}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-xs text-gray-400">{maintenanceMessage.length}/500</span>
                      <button
                        type="button"
                        onClick={handleMaintenanceMessageSave}
                        disabled={maintenanceLoading || !maintenanceMessage.trim()}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                      >
                        Save message
                      </button>
                    </div>
                  </div>
                  {maintenanceError && (
                    <div className="text-sm text-red-600">{maintenanceError}</div>
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

      {/* Logbook Weekly Performance Report Modal */}
      {showLogbookWeeklyReport && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowLogbookWeeklyReport(false)
              setShowLogbookWeeklyDownloadMenu(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Logbook Product – Weekly Performance Report</h2>
              <button
                onClick={() => {
                  setShowLogbookWeeklyReport(false)
                  setShowLogbookWeeklyDownloadMenu(false)
                }}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">As at (Date)</label>
                  <input
                    type="date"
                    value={logbookWeeklyAsAt}
                    onChange={(e) => setLogbookWeeklyAsAt(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    onClick={generateLogbookWeeklyReport}
                    disabled={logbookWeeklyLoading}
                    className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {logbookWeeklyLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                        Generating report...
                      </>
                    ) : (
                      'Generate Report'
                    )}
                  </button>

                  {logbookWeeklyReportHtml && !logbookWeeklyLoading && (
                    <div className="relative">
                      <button
                        onClick={() => setShowLogbookWeeklyDownloadMenu((v) => !v)}
                        className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                      >
                        Download
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showLogbookWeeklyDownloadMenu && (
                        <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                          <button
                            onClick={() => {
                              setShowLogbookWeeklyDownloadMenu(false)
                              downloadLogbookWeeklyHTML()
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Download HTML
                          </button>
                          <button
                            onClick={() => {
                              setShowLogbookWeeklyDownloadMenu(false)
                              downloadLogbookWeeklyPDF()
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
              </div>

              {logbookWeeklyLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Generating report preview...</p>
                </div>
              ) : logbookWeeklyError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {logbookWeeklyError}
                </div>
              ) : !logbookWeeklyReportHtml ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click "Generate Report" to build the weekly report for the selected date.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <iframe
                    title="Logbook Weekly Report Preview"
                    style={{ width: '100%', height: '75vh', border: 0 }}
                    srcDoc={logbookWeeklyReportHtml}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Daily PAR Report Modal */}
      {showDailyParReport && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDailyParReport(false)
              setShowDailyParDownloadMenu(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Daily PAR Report (SOD → EOD)</h2>
              <button
                onClick={() => {
                  setShowDailyParReport(false)
                  setShowDailyParDownloadMenu(false)
                }}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Report date</label>
                  <input
                    type="date"
                    value={dailyParDate}
                    onChange={(e) => setDailyParDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                  <select
                    value={dailyParCountry}
                    onChange={(e) => setDailyParCountry(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                  >
                    <option value="Kenya">Kenya</option>
                    <option value="Uganda">Uganda</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    onClick={generateDailyParReport}
                    disabled={dailyParLoading}
                    className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {dailyParLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      'Generate Report'
                    )}
                  </button>

                  {['admin', 'superuser'].includes(String(user?.role || '').toLowerCase()) && (
                    <button
                      onClick={sendDailyParEmail}
                      disabled={dailyParEmailSending || dailyParLoading}
                      className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      title="Email the report now (uses DAILY_PAR_EMAIL_TO / roles). Also auto-sends Mon–Sat 20:00 EAT."
                    >
                      {dailyParEmailSending ? 'Sending…' : 'Send Email Now'}
                    </button>
                  )}

                  {dailyParReportHtml && !dailyParLoading && (
                    <div className="relative">
                      <button
                        onClick={() => setShowDailyParDownloadMenu((v) => !v)}
                        className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                      >
                        Download
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showDailyParDownloadMenu && (
                        <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                          <button
                            onClick={() => {
                              setShowDailyParDownloadMenu(false)
                              downloadDailyParHTML()
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Download HTML
                          </button>
                          <button
                            onClick={() => {
                              setShowDailyParDownloadMenu(false)
                              downloadDailyParPDF()
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
              </div>

              <p className="text-xs text-gray-500 mb-4">
                Uses closest PAR snapshots to <strong>03:00 EAT</strong> (start of day) and <strong>20:00 EAT</strong> (end of day),
                plus yesterday&apos;s EOD for net recovery. Auto-emailed <strong>Mon–Sat at 20:00 EAT</strong> when SMTP + recipients are configured.
              </p>

              {dailyParEmailStatus && (
                <div
                  className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                    dailyParEmailStatus.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {dailyParEmailStatus.message}
                </div>
              )}

              {dailyParLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Building daily PAR table + Claude analysis...</p>
                </div>
              ) : dailyParError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {dailyParError}
                </div>
              ) : !dailyParReportHtml ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click &quot;Generate Report&quot; to build the daily SOD / EOD PAR report.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <iframe
                    title="Daily PAR Report Preview"
                    style={{ width: '100%', height: '75vh', border: 0 }}
                    srcDoc={dailyParReportHtml}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Director Report Modal */}
      {showDirectorReport && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDirectorReport(false)
              setShowDirectorDownloadMenu(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Board Report</h2>
              <button
                onClick={() => {
                  setShowDirectorReport(false)
                  setShowDirectorDownloadMenu(false)
                }}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">As at (Date)</label>
                  <input
                    type="date"
                    value={directorAsAt}
                    onChange={(e) => setDirectorAsAt(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    onClick={generateDirectorReport}
                    disabled={directorLoading}
                    className="px-4 py-2 rounded-lg bg-[#E04B2A] text-white text-sm font-semibold hover:bg-[#c94324] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {directorLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                        Generating with Claude…
                      </>
                    ) : (
                      'Generate Board Report'
                    )}
                  </button>

                  {directorReportHtml && !directorLoading && (
                    <div className="relative">
                      <button
                        onClick={() => setShowDirectorDownloadMenu((v) => !v)}
                        className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                      >
                        Download
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showDirectorDownloadMenu && (
                        <div className="absolute mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                          <button
                            onClick={() => {
                              setShowDirectorDownloadMenu(false)
                              downloadDirectorDOCX()
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Download Word (.docx)
                          </button>
                          <button
                            onClick={() => {
                              setShowDirectorDownloadMenu(false)
                              downloadDirectorHTML()
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Download HTML
                          </button>
                          <button
                            onClick={() => {
                              setShowDirectorDownloadMenu(false)
                              downloadDirectorPDF()
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
              </div>

              {directorLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                  <p className="mt-4 text-sm text-gray-500">
                    Aggregating Logbook, Zidisha, Boda &amp; Advans data and generating AI commentary…
                  </p>
                  <p className="mt-1 text-xs text-gray-400">This may take 30–60 seconds</p>
                </div>
              ) : directorError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {directorError}
                </div>
              ) : !directorReportHtml ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">
                    Click &quot;Generate Board Report&quot; to build a cross-product board pack with Claude AI commentary.
                  </p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <iframe
                    title="Board Report Preview"
                    style={{ width: '100%', height: '75vh', border: 0 }}
                    srcDoc={directorReportHtml}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Boda Top Up Qualifiers Modal */}
      {showBodaTopupReport && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowBodaTopupReport(false)
              setShowBodaTopupDownloadMenu(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900">Boda Top Up Qualifiers</h2>
              <button
                onClick={() => {
                  setShowBodaTopupReport(false)
                  setShowBodaTopupDownloadMenu(false)
                }}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={generateBodaTopupQualifiers}
                  disabled={bodaTopupLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {bodaTopupLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Generate Report'
                  )}
                </button>

                {bodaTopupRows.length > 0 && !bodaTopupLoading && (
                  <div className="relative">
                    <button
                      onClick={() => setShowBodaTopupDownloadMenu((v) => !v)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                    >
                      Download
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showBodaTopupDownloadMenu && (
                      <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                        <button
                          onClick={() => {
                            setShowBodaTopupDownloadMenu(false)
                            downloadBodaTopupXLSX()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download XLSX
                        </button>
                        <button
                          onClick={() => {
                            setShowBodaTopupDownloadMenu(false)
                            downloadBodaTopupHTML()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download HTML
                        </button>
                        <button
                          onClick={() => {
                            setShowBodaTopupDownloadMenu(false)
                            downloadBodaTopupPDF()
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

              {bodaTopupLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-sm text-gray-500">Loading data...</p>
                </div>
              ) : bodaTopupError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error: {bodaTopupError}
                </div>
              ) : bodaTopupRows.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click "Generate Report" to load Boda top up qualifiers.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Client Name</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Principal Amount</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Principal Outstanding</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">% Principal Paid</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Expected Matured On Date</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {bodaTopupRows.map((r, idx) => (
                        <tr key={`${r.clientId || r.clientName || ''}-${idx}`} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r.clientName || 'Unknown'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(r.principalAmount)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(r.principalOutstanding)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{Number(r.percentPrincipalPaid || 0).toFixed(2)}%</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{r.expectedMaturedOnDate || ''}</td>
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

      {/* Consolidated Repayments Report Modal */}
      {showRepaymentsReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Repayments by Month (All Products)</h2>
                <p className="text-sm text-gray-500 mt-0.5">Logbook, Zidisha, Boda &amp; Advans — amounts per month</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRepaymentsReport(false)}
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
                    value={repaymentsFromMonth}
                    onChange={(e) => setRepaymentsFromMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To (Month/Year)</label>
                  <input
                    type="month"
                    value={repaymentsToMonth}
                    onChange={(e) => setRepaymentsToMonth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={generateRepaymentsReport}
                  disabled={repaymentsLoading}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {repaymentsLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                      Generating report...
                    </>
                  ) : (
                    'Generate Report'
                  )}
                </button>
                {repaymentsReport.length > 0 && !repaymentsLoading && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowRepaymentsDownloadMenu((v) => !v)}
                      className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition flex items-center gap-2"
                    >
                      Download
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showRepaymentsDownloadMenu && (
                      <div className="absolute mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                        <button
                          type="button"
                          onClick={() => {
                            setShowRepaymentsDownloadMenu(false)
                            downloadRepaymentsXLSX()
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Download XLSX
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {repaymentsMeta?.notes && (
                <p className="mb-4 text-xs text-gray-500 leading-relaxed">
                  Product columns are Collection Total Collected. Collection Target is the schedule Total Expected due
                  that month. OTC columns are actual cash from boda_repayments (Zidisha/Advans OTC from Jun 2025; Boda
                  OTC from Dec 2025). Portfolio is outstanding as of today (not monthly).
                </p>
              )}

              {repaymentsPortfolio && !repaymentsLoading && (
                <div className="mb-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Portfolio as of today</h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {[
                        { label: 'Logbook', value: repaymentsPortfolio.logbook },
                        { label: 'Zidisha', value: repaymentsPortfolio.zidisha },
                        { label: 'Boda', value: repaymentsPortfolio.boda },
                        { label: 'Advans', value: repaymentsPortfolio.advans },
                        { label: 'Total', value: repaymentsPortfolio.total },
                      ].map((card) => (
                        <div key={card.label} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{card.label}</p>
                          <p className="mt-1 text-lg font-bold text-gray-900">{formatKES(card.value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Portfolio by branch</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {[
                        { title: 'Logbook', rows: repaymentsPortfolio.byBranch?.logbook, total: repaymentsPortfolio.logbook },
                        { title: 'Zidisha', rows: repaymentsPortfolio.byBranch?.zidisha, total: repaymentsPortfolio.zidisha },
                        { title: 'Boda', rows: repaymentsPortfolio.byBranch?.boda, total: repaymentsPortfolio.boda },
                        { title: 'Advans', rows: repaymentsPortfolio.byBranch?.advans, total: repaymentsPortfolio.advans },
                      ].map((section) => (
                        <div key={section.title} className="rounded-lg border border-gray-200 overflow-hidden">
                          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-gray-900">{section.title}</h4>
                            <span className="text-xs font-medium text-gray-500">{formatKES(section.total)}</span>
                          </div>
                          <div className="max-h-64 overflow-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-white sticky top-0">
                                <tr className="border-b border-gray-100">
                                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Branch</th>
                                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Portfolio</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {(section.rows || []).map((row) => (
                                  <tr key={`${section.title}-${row.branch}`} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 text-gray-900">{row.branch}</td>
                                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatKES(row.portfolio)}</td>
                                  </tr>
                                ))}
                                {!(section.rows || []).length && (
                                  <tr>
                                    <td colSpan={2} className="px-4 py-6 text-center text-gray-400">No portfolio for this product</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {repaymentsLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                  <p className="mt-4 text-sm text-gray-500">Processing report...</p>
                </div>
              ) : repaymentsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Error generating report: {repaymentsError}
                </div>
              ) : repaymentsReport.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">Click &quot;Generate Report&quot; to view repayments for the selected period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Month</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Logbook</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Zidisha</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Zidisha Target</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Zidisha OTC</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Boda</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Boda Target</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Boda OTC</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Advans</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Advans Target</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Advans OTC</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total OTC</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {repaymentsReport.map((row) => (
                        <tr key={row.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{row.month}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.logbook)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.zidisha)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-700">{formatKES(row.zidishaTarget)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">{formatKES(row.zidishaOtc)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.boda)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-700">{formatKES(row.bodaTarget)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">{formatKES(row.bodaOtc)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatKES(row.advans)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-700">{formatKES(row.advansTarget)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">{formatKES(row.advansOtc)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-right text-gray-900">{formatKES(row.total)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-right text-gray-700">{formatKES(row.totalOtc)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                      <tr>
                        <td className="px-4 py-3 text-sm font-bold text-gray-900">TOTAL</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-900">{formatKES(repaymentsTotals.logbook)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-900">{formatKES(repaymentsTotals.zidisha)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-blue-700">{formatKES(repaymentsTotals.zidishaTarget)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-700">{formatKES(repaymentsTotals.zidishaOtc)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-900">{formatKES(repaymentsTotals.boda)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-blue-700">{formatKES(repaymentsTotals.bodaTarget)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-700">{formatKES(repaymentsTotals.bodaOtc)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-900">{formatKES(repaymentsTotals.advans)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-blue-700">{formatKES(repaymentsTotals.advansTarget)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-700">{formatKES(repaymentsTotals.advansOtc)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-900">{formatKES(repaymentsTotals.total)}</td>
                        <td className="px-4 py-3 text-sm font-bold text-right text-gray-700">{formatKES(repaymentsTotals.totalOtc)}</td>
                      </tr>
                    </tfoot>
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
          {/* Director Report Card */}
          <button
            onClick={() => setShowDirectorReport(true)}
            className="bg-white rounded-lg border-2 border-[#E04B2A]/30 shadow-sm hover:shadow-md transition p-6 text-left md:col-span-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Board Report</h2>
                <p className="text-sm text-gray-500">
                  Board &amp; Management Performance Report — branch tables, PAR heat map, KPIs &amp; directives (matches board pack format)
                </p>
              </div>
              <svg className="w-6 h-6 text-[#E04B2A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Consolidated Repayments Report Card */}
          <button
            type="button"
            onClick={() => setShowRepaymentsReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left md:col-span-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Repayments by Month</h2>
                <p className="text-sm text-gray-500">
                  Consolidated repayments for Logbook, Zidisha, Boda &amp; Advans — amounts per month (from Jun 2024, adjustable)
                </p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

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

          {/* Logbook Weekly Performance Report Card */}
          <button
            onClick={() => setShowLogbookWeeklyReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Logbook Product – Weekly</h2>
                <p className="text-sm text-gray-500">Weekly performance report (sales, collections, portfolio & PAR) in the Phoenix template</p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Daily PAR Report Card */}
          <button
            onClick={() => setShowDailyParReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Daily PAR Report</h2>
                <p className="text-sm text-gray-500">SOD (~3am) vs EOD (~8pm) by branch — shift, recovery vs yesterday, PDF download</p>
              </div>
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Boda Top Up Qualifiers Report Card */}
          <button
            onClick={() => setShowBodaTopupReport(true)}
            className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition p-6 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Boda Top Up Qualifiers</h2>
                <p className="text-sm text-gray-500">Clients (Zidisha Boda) with principal paid % and maturity date</p>
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

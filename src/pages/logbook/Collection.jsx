import React, { useState, useEffect, useMemo, useRef } from 'react'
import { TrendingUp, Clock, CheckCircle, AlertCircle, DollarSign, Users, ChevronDown, ChevronRight, ChevronLeft, User, FileText, Search, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts'
import LogbookDataProcessor from '../../utils/LogbookDataProcessor.js'
import { useLogbookCurrency } from '../../context/LogbookCurrencyContext.jsx'
import { API_URLS } from '../../utils/api.js'

function parseBorrowerAccessIds(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map((id) => String(id).trim()).filter(Boolean)
    }
    if (parsed) return [String(parsed).trim()].filter(Boolean)
  } catch {
    const str = String(raw).trim()
    if (str) return [str]
  }
  return []
}

// Default selected day for a period: today (current month), month-end (past month), 1 (future month)
function defaultDayForPeriod(month, year) {
  const now = new Date()
  const nowYear = now.getFullYear()
  const nowMonth = now.getMonth() + 1
  if (year === nowYear && month === nowMonth) return now.getDate()
  if (year < nowYear || (year === nowYear && month < nowMonth)) return new Date(year, month, 0).getDate()
  return 1
}

function LogbookCollection({ country }) {
  const { formatMoney, sourceCurrency } = useLogbookCurrency()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const nowInit = new Date()
  const [selectedMonth, setSelectedMonth] = useState(nowInit.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(nowInit.getFullYear())
  const [selectedDay, setSelectedDay] = useState(nowInit.getDate())
  const [targets, setTargets] = useState([])
  const [officerPerfData, setOfficerPerfData] = useState([])
  const [parOfficerData, setParOfficerData] = useState([])
  const [loanOfficers, setLoanOfficers] = useState([])
  const [roTargets, setROTargets] = useState([])
  const [expandedMonthlyBranch, setExpandedMonthlyBranch] = useState(null)
  const [expandedDailyBranch, setExpandedDailyBranch] = useState(null)
  const [dailyOpenLoansBranches, setDailyOpenLoansBranches] = useState([])
  const [dailyOpenLoansMeta, setDailyOpenLoansMeta] = useState({
    snapshotTime: null,
    date: null,
    scanned: 0,
    matched: 0,
  })
  const [dailyOpenLoansLoading, setDailyOpenLoansLoading] = useState(false)
  // Identifies the day the open-loans list belongs to, so late responses for another day are dropped
  const dailyOpenLoansKeyRef = useRef('')
  // Clients Paid card: client names for the selected day's repayments (loan id -> client info)
  const [dayClientMap, setDayClientMap] = useState({})
  const [dayClientServerPayments, setDayClientServerPayments] = useState(null)
  const [dayClientsLoading, setDayClientsLoading] = useState(false)
  const [dayClientsError, setDayClientsError] = useState(null)
  const [clientSearch, setClientSearch] = useState('')
  const [clientBranchFilter, setClientBranchFilter] = useState('')
  const clientsCardRef = useRef(null)
  // The Clients Paid list scrolls inside its own box (~20 rows); start at row 1 whenever the list changes
  const clientsScrollRef = useRef(null)
  useEffect(() => {
    if (clientsScrollRef.current) clientsScrollRef.current.scrollTop = 0
  }, [selectedYear, selectedMonth, selectedDay, clientBranchFilter, clientSearch])

  useEffect(() => {
    const loadData = async () => {
      try {
        const processor = new LogbookDataProcessor(country)
        await processor.loadRepaymentsData()
        
        const collectionAnalytics = processor.getCollectionAnalytics()
        setData({ ...collectionAnalytics, processor })
        setLoading(false)
      } catch (err) {
        setError(err.message)
        setLoading(false)
      }
    }

    loadData()
  }, [country])

  useEffect(() => {
    const loadTargets = async () => {
      try {
        const base = API_URLS.targets.logbook.list
        const url = country ? `${base}?country=${encodeURIComponent(country)}` : base
        const res = await fetch(url, { credentials: 'include' })
        if (res.ok) {
          const t = await res.json()
          setTargets(Array.isArray(t) ? t : [])
        }
      } catch (e) {
        console.error('Failed to load logbook targets', e)
      }
    }
    loadTargets()
  }, [country])

  useEffect(() => {
    if (loading) return
    const loadOfficerData = async () => {
      try {
        const basePerf = API_URLS.logbook.collectorPerformance(selectedMonth, selectedYear)
        const perfUrl = country ? `${basePerf}&country=${encodeURIComponent(country)}` : basePerf
        const parBase = API_URLS.par.borrowerAccess
        const parUrl = country ? `${parBase}?country=${encodeURIComponent(country)}` : parBase
        const [perfRes, parRes, loRes, roRes] = await Promise.all([
          fetch(perfUrl, { credentials: 'include' }),
          fetch(parUrl, { credentials: 'include' }),
          fetch(API_URLS.loanOfficers.list, { credentials: 'include' }),
          fetch(API_URLS.targets.ro.list, { credentials: 'include' }),
        ])
        if (perfRes.ok) {
          const perf = await perfRes.json()
          setOfficerPerfData(Array.isArray(perf) ? perf : [])
        } else {
          setOfficerPerfData([])
        }
        if (parRes.ok) {
          const par = await parRes.json()
          setParOfficerData(Array.isArray(par) ? par : [])
        } else {
          setParOfficerData([])
        }
        if (loRes.ok) {
          const lo = await loRes.json()
          setLoanOfficers(Array.isArray(lo) ? lo : [])
        } else {
          setLoanOfficers([])
        }
        if (roRes.ok) {
          const ro = await roRes.json()
          setROTargets(Array.isArray(ro) ? ro : [])
        } else {
          setROTargets([])
        }
      } catch (e) {
        console.error('Failed to load officer collection breakdown', e)
        setOfficerPerfData([])
        setParOfficerData([])
        setLoanOfficers([])
        setROTargets([])
      }
    }
    loadOfficerData()
  }, [loading, selectedMonth, selectedYear, country])

  useEffect(() => {
    setExpandedMonthlyBranch(null)
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    setExpandedDailyBranch(null)
  }, [selectedMonth, selectedYear, selectedDay])

  useEffect(() => {
    if (loading) return
    dailyOpenLoansKeyRef.current = `${country || ''}|${selectedYear}-${selectedMonth}-${selectedDay}`
    const controller = new AbortController()
    // Drop the previous day's list right away so it never shows under the new day
    setDailyOpenLoansBranches([])
    setDailyOpenLoansMeta({ snapshotTime: null, date: null, scanned: 0, matched: 0 })
    setDailyOpenLoansLoading(true)
    const loadDailyOpenLoans = async () => {
      try {
        const base = API_URLS.logbook.dailyOpenLoans(selectedMonth, selectedYear, selectedDay)
        const url = country ? `${base}&country=${encodeURIComponent(country)}` : base
        const res = await fetch(url, { credentials: 'include', signal: controller.signal })
        if (controller.signal.aborted) return
        if (!res.ok) {
          setDailyOpenLoansBranches([])
          setDailyOpenLoansMeta({ snapshotTime: null, date: null, scanned: 0, matched: 0 })
          return
        }
        const data = await res.json()
        if (controller.signal.aborted) return
        setDailyOpenLoansBranches(Array.isArray(data.branches) ? data.branches : [])
        setDailyOpenLoansMeta({
          snapshotTime: data.snapshotTime || null,
          date: data.date || null,
          scanned: Number(data.meta?.scanned) || 0,
          matched: Number(data.meta?.matched) || 0,
        })
      } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) return
        console.error('Failed to load daily open loans', e)
        setDailyOpenLoansBranches([])
        setDailyOpenLoansMeta({ snapshotTime: null, date: null, scanned: 0, matched: 0 })
      } finally {
        if (!controller.signal.aborted) setDailyOpenLoansLoading(false)
      }
    }
    // Debounce so quick day-stepping only fetches the day the user lands on
    const timer = setTimeout(loadDailyOpenLoans, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [loading, selectedMonth, selectedYear, selectedDay, country])

  // Clients Paid: fetch client names for the selected day (local DB on the server, no Loandisk API calls)
  useEffect(() => {
    if (loading) return
    const controller = new AbortController()
    setDayClientMap({})
    setDayClientServerPayments(null)
    setDayClientsError(null)
    setDayClientsLoading(true)
    const loadDayClients = async () => {
      try {
        const base = API_URLS.logbook.dailyClients(selectedMonth, selectedYear, selectedDay)
        const url = country ? `${base}&country=${encodeURIComponent(country)}` : base
        const res = await fetch(url, { credentials: 'include', signal: controller.signal })
        if (controller.signal.aborted) return
        if (!res.ok) throw new Error(`server returned ${res.status}`)
        const payload = await res.json()
        if (controller.signal.aborted) return
        setDayClientMap(payload && payload.clients && typeof payload.clients === 'object' ? payload.clients : {})
        const serverPayments = Number(payload?.payments)
        setDayClientServerPayments(Number.isFinite(serverPayments) ? serverPayments : null)
      } catch (e) {
        if (e?.name === 'AbortError' || controller.signal.aborted) return
        console.error('Failed to load clients paid', e)
        setDayClientsError(e?.message || 'unknown error')
      } finally {
        if (!controller.signal.aborted) setDayClientsLoading(false)
      }
    }
    // Debounce so quick day-stepping only fetches the day the user lands on
    const timer = setTimeout(loadDayClients, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [loading, selectedMonth, selectedYear, selectedDay, country])

  const mergeDailyOpenLoansBranch = (branchPayload) => {
    if (!branchPayload?.code) return
    setDailyOpenLoansBranches((prev) => {
      const code = String(branchPayload.code).trim()
      const next = [...prev]
      const idx = next.findIndex((b) => String(b.code).trim() === code)
      if (idx >= 0) next[idx] = { ...next[idx], ...branchPayload }
      else next.push(branchPayload)
      return next
    })
  }

  const loadDailyOpenLoansForBranch = async (branchCode) => {
    const code = String(branchCode || '').trim()
    if (!code) return
    const requestKey = dailyOpenLoansKeyRef.current
    try {
      const base = API_URLS.logbook.dailyOpenLoans(selectedMonth, selectedYear, selectedDay, code)
      const url = country ? `${base}&country=${encodeURIComponent(country)}` : base
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      // The day changed while this was loading: don't merge another day's loans
      if (dailyOpenLoansKeyRef.current !== requestKey) return
      const branch = (data.branches || []).find((b) => String(b.code).trim() === code)
      if (branch) mergeDailyOpenLoansBranch(branch)
      if (data.meta) {
        setDailyOpenLoansMeta((prev) => ({
          ...prev,
          scanned: Number(data.meta.scanned) || prev.scanned,
          matched: Number(data.meta.matched) || prev.matched,
        }))
      }
    } catch (e) {
      console.error('Failed to load branch open loans', e)
    }
  }

  const handleToggleDailyBranch = async (row) => {
    const rowKey = String(row.branchCode || row.name)
    if (expandedDailyBranch === rowKey) {
      setExpandedDailyBranch(null)
      return
    }
    setExpandedDailyBranch(rowKey)
    const code = String(row.branchCode || '').trim()
    if (code) {
      const existing = dailyOpenLoansBranches.find((b) => String(b.code).trim() === code)
      const existingLoans = Array.isArray(existing?.loans) ? existing.loans : []
      if (!existingLoans.length) {
        const requestKey = dailyOpenLoansKeyRef.current
        setDailyOpenLoansLoading(true)
        await loadDailyOpenLoansForBranch(code)
        // Leave the flag alone if a newer day's fetch now owns it
        if (dailyOpenLoansKeyRef.current === requestKey) setDailyOpenLoansLoading(false)
      }
    }
  }

  // Change month/year and the shared day together (one render, one open-loans fetch).
  // Without an explicit day: today for the current month, month-end for past months.
  const changePeriod = (month, year, day) => {
    setSelectedMonth(month)
    setSelectedYear(year)
    setSelectedDay(day ?? defaultDayForPeriod(month, year))
  }

  // Listen to global month/year changes from header
  useEffect(() => {
    const onGlobalChange = (e) => {
      if (!e || !e.detail) return
      const month = typeof e.detail.month === 'number' ? e.detail.month : selectedMonth
      const year = typeof e.detail.year === 'number' ? e.detail.year : selectedYear
      if (month === selectedMonth && year === selectedYear) return
      changePeriod(month, year)
    }
    window.addEventListener('global_month_year_changed', onGlobalChange)
    return () => window.removeEventListener('global_month_year_changed', onGlobalChange)
  }, [selectedMonth, selectedYear])

  // Repayments grouped by collection month (key: year * 100 + month), built once per data load.
  // The month-scoped calculations below loop over one month instead of every repayment.
  const repaymentsByMonth = useMemo(() => {
    const proc = data?.processor
    const map = new Map()
    if (!proc || !Array.isArray(proc.repaymentsData)) return map
    for (const r of proc.repaymentsData) {
      const d = proc.parseDMY(r.repayment_collected_date)
      if (!d || Number.isNaN(d.getTime())) continue
      const key = d.getFullYear() * 100 + (d.getMonth() + 1)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return map
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading collection data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-red-600">Error loading data: {error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">No data available</div>
      </div>
    )
  }

  // Prepare chart data
  const monthLabel = (() => {
    const d = new Date(Number(selectedYear), Number(selectedMonth) - 1, 1)
    return d.toLocaleString('en-US', { month: 'long' })
  })()

  const isPastMonth = (() => {
    const now = new Date()
    const ny = now.getFullYear()
    const nm = now.getMonth() + 1
    return selectedYear < ny || (selectedYear === ny && selectedMonth < nm)
  })()
  const daysInSelectedMonth = new Date(selectedYear, selectedMonth, 0).getDate()
  // Repayment rows collected in a given month (see repaymentsByMonth)
  const rowsForMonth = (y, m) => repaymentsByMonth.get(Number(y) * 100 + Number(m)) || []

  // Current-month principal and interest collected (DB fields)
  const selectedMonthPrincipal = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let sum = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) {
        sum += Number(r.principal_repayment_amount) || 0
      }
    }
    return sum
  })()
  const selectedMonthInterest = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let sum = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) {
        sum += Number(r.interest_repayment_amount) || 0
      }
    }
    return sum
  })()

  // Selected-month total collected
  const totalCollectedSelectedMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let sum = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) {
        sum += Number(r.repayment_amount) || 0
      }
    }
    return sum
  })()

  // Selected-month total collection target (EoM target)
  const totalCollectionTargetSelectedMonth = (() => {
    if (!Array.isArray(targets) || !targets.length) return 0
    const y = selectedYear
    const m = selectedMonth
    const targetsForMonth = targets.filter(
      (t) => t.active && Number(t.year) === y && Number(t.month) === m
    )
    if (!targetsForMonth.length) return 0
    return targetsForMonth.reduce(
      (sum, t) => sum + (Number(t.collectionTarget) || 0),
      0
    )
  })()

  // Percentage of target collected for the selected month
  const collectedVsTargetPctStr = (() => {
    const target = totalCollectionTargetSelectedMonth
    if (target > 0) {
      const pct = (totalCollectedSelectedMonth / target) * 100
      return `${pct.toFixed(1)}%`
    }
    return '—'
  })()

  // Weekly and daily collection cards
  function getWeekRange(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diffToMonday = (day === 0 ? -6 : 1) - day
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return [monday, sunday]
  }
  const today = new Date()
  const [thisMon, thisSun] = getWeekRange(today)
  const todayY = today.getFullYear(), todayM = today.getMonth() + 1, todayD = today.getDate()

  const collectionsThisWeek = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    let sum = 0
    // The week can span two months
    const monRows = rowsForMonth(thisMon.getFullYear(), thisMon.getMonth() + 1)
    const weekSpansMonths =
      thisMon.getFullYear() !== thisSun.getFullYear() || thisMon.getMonth() !== thisSun.getMonth()
    const weekRows = weekSpansMonths
      ? [...monRows, ...rowsForMonth(thisSun.getFullYear(), thisSun.getMonth() + 1)]
      : monRows
    for (const r of weekRows) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
      if (d >= thisMon && d <= thisSun) sum += Number(r.repayment_amount) || 0
    }
    return sum
  })()

  const collectionsToday = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    let sum = 0
    for (const r of rowsForMonth(todayY, todayM)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === todayY && Number(mm) === todayM && Number(dd) === todayD) {
        sum += Number(r.repayment_amount) || 0
      }
    }
    return sum
  })()

  const numLoansCollectedThisMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const set = new Set()
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) {
        if (r.loan_id) set.add(String(r.loan_id))
      }
    }
    return set.size
  })()

  const avgCollectionsPerDayThisMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    const day = isPastMonth ? daysInSelectedMonth : new Date().getDate()
    let count = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) count += 1
    }
    return day > 0 ? (count / day) : 0
  })()

  // Selected-month totals for alternate (past-month) card row
  const selectedMonthRepaymentCount = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let count = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) count += 1
    }
    return count
  })()
  const numLoansSelectedMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    const set = new Set()
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m && r.loan_id) set.add(String(r.loan_id))
    }
    return set.size
  })()
  const avgCollectedAmtPerDaySelected = daysInSelectedMonth > 0 ? (totalCollectedSelectedMonth / daysInSelectedMonth) : 0
  const avgCollectedAmtPerWeekSelected = (() => {
    const weeks = daysInSelectedMonth / 7
    return weeks > 0 ? (totalCollectedSelectedMonth / weeks) : 0
  })()
  // Previous month y/m
  const prevYM = (() => {
    const m = selectedMonth
    const y = selectedYear
    return m === 1 ? { py: y - 1, pm: 12 } : { py: y, pm: m - 1 }
  })()
  // Previous-month principal and interest totals
  const prevMonthPrincipal = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const { py, pm } = prevYM
    let sum = 0
    for (const r of rowsForMonth(py, pm)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === py && Number(mm) === pm) {
        sum += Number(r.principal_repayment_amount) || 0
      }
    }
    return sum
  })()
  const prevMonthInterest = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const { py, pm } = prevYM
    let sum = 0
    for (const r of rowsForMonth(py, pm)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === py && Number(mm) === pm) {
        sum += Number(r.interest_repayment_amount) || 0
      }
    }
    return sum
  })()
  const pctStr = (cur, prev) => {
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    }
    return '+0.0%'
  }
  const principalChangePct = pctStr(selectedMonthPrincipal, prevMonthPrincipal)
  const interestChangePct = pctStr(selectedMonthInterest, prevMonthInterest)

  const changeColor = (s) => (s.startsWith('-') ? 'text-red-700' : 'text-green-700')
  const repaymentComposition = [
    { name: 'Principal', value: data.totalPrincipal, color: '#3b82f6' },
    { name: 'Interest', value: data.totalInterest, color: '#10b981' },
    { name: 'Fees', value: data.totalFees, color: '#f59e0b' },
    { name: 'Penalty', value: data.totalPenalty, color: '#ef4444' }
  ]

  const collectorData = Object.entries(data.collectorStats)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10)
    .map(([collector, stats]) => ({
      name: `Collector ${collector}`,
      amount: stats.amount,
      count: stats.count
    }))

  // Group collections by date for trend analysis - current month only using DB fields
  const trendData = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return []
    const y = selectedYear
    const m = selectedMonth
    const daysInMonth = new Date(y, m, 0).getDate()
    const sumByDay = Array(daysInMonth + 1).fill(0)

    // actual collections by day
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) {
        const day = Number(dd)
        if (day >= 1 && day <= daysInMonth) sumByDay[day] += Number(r.repayment_amount) || 0
      }
    }

    // build daily target using targets and working days (Sundays off, branch holidays respected)
    const targetByDay = Array(daysInMonth + 1).fill(0)
    const targetsForMonth = targets.filter(
      (t) => t.active && Number(t.year) === y && Number(t.month) === m
    )
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m - 1, day)
      if (date.getDay() === 0) continue // Sunday non-working
      for (const t of targetsForMonth) {
        const workingDays = Number(t.workingDays) || 0
        if (!workingDays) continue
        const holidaySet = new Set(
          (Array.isArray(t.holidays) ? t.holidays : []).map((d) => new Date(d).toDateString())
        )
        if (holidaySet.has(date.toDateString())) continue
        targetByDay[day] += (Number(t.collectionTarget) || 0) / workingDays
      }
    }

    const rows = []
    for (let day = 1; day <= daysInMonth; day++) {
      rows.push({ date: String(day), amount: sumByDay[day], target: targetByDay[day] })
    }
    return rows
  })()

  const branchCollectionTables = (() => {
    const proc = data.processor
    if (!proc || !Array.isArray(proc.repaymentsData)) {
      return {
        monthly: [],
        mtd: [],
        daily: [],
        cutoffDay: 0,
        selectedDay: 1,
        asOfDay: 0,
        isFutureDay: false,
        hasTargets: false,
        totals: null,
      }
    }

    const y = selectedYear
    const m = selectedMonth
    const daysInMonth = new Date(y, m, 0).getDate()
    const day = Math.min(Math.max(1, selectedDay), daysInMonth)
    const now = new Date()
    const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1
    const isFutureMonth = y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)
    const cutoffDay = isFutureMonth ? 0 : isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth
    // MTD is a snapshot "as of" the selected day, but never runs past today
    const asOfDay = Math.min(day, cutoffDay)
    const isFutureDay = day > cutoffDay

    const normalizeBranch = (value) =>
      String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*branch\s*$/i, '')
        .toLowerCase()

    const branchCodeByKey = new Map()
    if (Array.isArray(proc.branchesData)) {
      for (const branchRow of proc.branchesData) {
        const code = String(branchRow.code ?? '').trim()
        if (!code) continue
        const displayName = proc.getBranchName ? proc.getBranchName(code) : code
        branchCodeByKey.set(normalizeBranch(displayName), code)
        branchCodeByKey.set(normalizeBranch(branchRow.name), code)
        branchCodeByKey.set(normalizeBranch(code), code)
      }
    }

    const targetMap = new Map()
    targets
      .filter((target) =>
        Number(target.active) !== 0 &&
        Number(target.year) === y &&
        Number(target.month) === m
      )
      .forEach((target) => {
        const key = normalizeBranch(target.branch)
        if (!key) return
        const rawBranch = String(target.branch || '').trim()
        targetMap.set(key, {
          name: rawBranch.replace(/\s*branch\s*$/i, '').trim(),
          branchCode: branchCodeByKey.get(key) || (/^\d+$/.test(rawBranch) ? rawBranch : ''),
          target: Number(target.collectionTarget) || 0,
          workingDays: Number(target.workingDays) || 0,
          holidays: Array.isArray(target.holidays) ? target.holidays : [],
        })
      })

    const officerIdToBranches = new Map()
    for (const entry of parOfficerData) {
      const id = String(entry.officerId ?? '').trim()
      if (!id) continue
      officerIdToBranches.set(id, Array.isArray(entry.branches) ? entry.branches : [])
    }

    const officerPerfById = new Map()
    for (const row of officerPerfData) {
      const id = String(row.borrower_access_id ?? '').trim()
      if (!id) continue
      officerPerfById.set(id, row)
    }

    const loanOfficerNameByCode = new Map()
    for (const officer of loanOfficers) {
      const code = String(officer.borrowerAccessId ?? '').trim()
      if (!code) continue
      loanOfficerNameByCode.set(code, String(officer.name || code).trim() || code)
    }

    const normalizeOfficerName = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

    const matchLoAccessIdForRoName = (roName) => {
      const roNorm = normalizeOfficerName(roName)
      if (!roNorm) return ''
      const nameTokens = (v) =>
        normalizeOfficerName(v)
          .replace(/['']/g, '')
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 1)
      const tokensMatch = (a, b) => {
        const ta = nameTokens(a)
        const tb = nameTokens(b)
        if (!ta.length || !tb.length) return false
        const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
        return shorter.every((t) => longer.includes(t))
      }
      for (const lo of loanOfficers) {
        const id = String(lo.borrowerAccessId ?? '').trim()
        if (!id) continue
        const loNorm = normalizeOfficerName(lo.name)
        if (loNorm === roNorm || roNorm.includes(loNorm) || loNorm.includes(roNorm)) return id
      }
      for (const lo of loanOfficers) {
        const id = String(lo.borrowerAccessId ?? '').trim()
        if (!id) continue
        const loNorm = normalizeOfficerName(lo.name)
        if (tokensMatch(roNorm, loNorm)) return id
      }
      return ''
    }

    const roTargetByAccessId = new Map()
    const roPrincipalByAccessId = new Map()
    for (const target of roTargets) {
      if (Number(target.month) !== m || Number(target.year) !== y) continue
      const accessId = matchLoAccessIdForRoName(target.loanOfficerName)
      if (!accessId) continue
      roTargetByAccessId.set(accessId, Number(target.sumOfTarget) || 0)
      const principal = Number(target.sumOfPrincipalBalance) || 0
      if (principal > 0) roPrincipalByAccessId.set(accessId, principal)
    }

    const getParPortfolioForOfficer = (officerId, branchCodeForFilter) => {
      const entry = parOfficerData.find((e) => String(e.officerId ?? '').trim() === officerId)
      if (!entry) return 0
      if (branchCodeForFilter) {
        const branches = Array.isArray(entry.branches) ? entry.branches : []
        if (branches.length && !branches.includes(branchCodeForFilter)) return 0
      }
      return Number(entry.openLoans) || 0
    }

    const actualMap = new Map()
    const officerCollectedByBranchKey = new Map()
    const ensureActual = (key, name, branchCode) => {
      if (!actualMap.has(key)) {
        actualMap.set(key, {
          name,
          branchCode: branchCode || '',
          monthCollected: 0,
          // Amount collected on each day of the month (index = day of month)
          byDay: Array(daysInMonth + 1).fill(0),
        })
      } else if (branchCode && !actualMap.get(key).branchCode) {
        actualMap.get(key).branchCode = branchCode
      }
      return actualMap.get(key)
    }

    for (const repayment of rowsForMonth(y, m)) {
      const date = proc.parseDMY(repayment.repayment_collected_date)
      if (!date || date.getFullYear() !== y || date.getMonth() + 1 !== m) continue
      const code = String(repayment.branch || repayment.Branch || '').trim()
      if (!code) continue
      const name = proc.getBranchName ? proc.getBranchName(code) : String(code)
      const key = normalizeBranch(name)
      if (!key) continue
      const row = ensureActual(key, name, code)
      const amount = Number(repayment.repayment_amount) || 0
      row.monthCollected += amount
      row.byDay[date.getDate()] += amount

      const borrowerIds = parseBorrowerAccessIds(repayment.borrower_access_ids)
      if (borrowerIds.length) {
        if (!officerCollectedByBranchKey.has(key)) {
          officerCollectedByBranchKey.set(key, new Map())
        }
        const officerMap = officerCollectedByBranchKey.get(key)
        for (const officerId of borrowerIds) {
          const branches = officerIdToBranches.get(officerId) || []
          if (!branches.includes(code)) continue
          officerMap.set(officerId, (officerMap.get(officerId) || 0) + amount)
        }
      }
    }

    const targetForDay = (targetInfo, targetDay) => {
      if (!targetInfo || targetInfo.target <= 0) return 0
      const date = new Date(y, m - 1, targetDay)
      if (date.getDay() === 0) return 0
      const holidaySet = new Set(
        targetInfo.holidays.map((holiday) => new Date(holiday).toDateString())
      )
      if (holidaySet.has(date.toDateString())) return 0
      const workingDays = targetInfo.workingDays || daysInMonth
      return workingDays > 0 ? targetInfo.target / workingDays : 0
    }

    // [startDay, endDay] window helpers shared by the Day and MTD columns
    const sumDays = (values, startDay, endDay) => {
      let total = 0
      for (let d = Math.max(1, startDay); d <= Math.min(endDay, daysInMonth); d++) total += values?.[d] || 0
      return total
    }
    const expectedForRange = (targetInfo, startDay, endDay) => {
      let expected = 0
      for (let d = Math.max(1, startDay); d <= Math.min(endDay, daysInMonth); d++) {
        expected += targetForDay(targetInfo, d)
      }
      return expected
    }

    const buildOfficersForBranch = (branchKey, branchCode, branchCollectionExpected) => {
      const officerIds = new Set()
      if (branchCode) {
        for (const [officerId, branches] of officerIdToBranches.entries()) {
          if (branches.includes(branchCode)) officerIds.add(officerId)
        }
      }
      const collectedMap = officerCollectedByBranchKey.get(branchKey)
      if (collectedMap) {
        for (const officerId of collectedMap.keys()) officerIds.add(officerId)
      }

      let list = Array.from(officerIds)
        .map((officerId) => {
          const perf = officerPerfById.get(officerId)
          const collected = collectedMap?.get(officerId) || 0
          const expected =
            Number(perf?.target) ||
            roTargetByAccessId.get(officerId) ||
            0
          const name = loanOfficerNameByCode.get(officerId) || perf?.name || officerId
          return {
            id: officerId,
            name,
            expected,
            collected,
            principalBalance:
              Number(perf?.sum_of_principal_balance) ||
              roPrincipalByAccessId.get(officerId) ||
              getParPortfolioForOfficer(officerId, branchCode) ||
              0,
            rate: expected > 0 ? (collected / expected) * 100 : null,
          }
        })
        .filter((officer) => officer.expected > 0 || officer.collected > 0)

      const branchExpected = Number(branchCollectionExpected) || 0
      const needsAllocation = branchExpected > 0 && list.some((o) => !o.expected)
      if (needsAllocation) {
        const weights = list.map(
          (o) => o.principalBalance || getParPortfolioForOfficer(o.id, branchCode) || 0,
        )
        const totalWeight = weights.reduce((sum, w) => sum + w, 0)
        if (totalWeight > 0) {
          list = list.map((o, index) => {
            const allocated = branchExpected * (weights[index] / totalWeight)
            const expected = o.expected || allocated
            return {
              ...o,
              expected,
              rate: expected > 0 ? (o.collected / expected) * 100 : null,
            }
          })
        }
      }

      return list.sort((a, b) => b.collected - a.collected)
    }

    const keys = new Set([...targetMap.keys(), ...actualMap.keys()])
    const rows = Array.from(keys, (key) => {
      const targetInfo = targetMap.get(key)
      const actual = actualMap.get(key)
      const name = actual?.name || targetInfo?.name || key
      const branchCode =
        branchCodeByKey.get(key) || actual?.branchCode || targetInfo?.branchCode || ''
      const expected = targetInfo?.target || 0
      const collected = actual?.monthCollected || 0
      const mtdExpected = expectedForRange(targetInfo, 1, asOfDay)
      const mtdCollected = sumDays(actual?.byDay, 1, asOfDay)
      const dailyExpected = targetForDay(targetInfo, day)
      const dailyCollected = sumDays(actual?.byDay, day, day)
      return {
        name,
        branchCode,
        expected,
        collected,
        rate: expected > 0 ? (collected / expected) * 100 : null,
        mtdExpected,
        mtdCollected,
        mtdGap: Math.max(0, mtdExpected - mtdCollected),
        mtdRate: mtdExpected > 0 ? (mtdCollected / mtdExpected) * 100 : null,
        dailyExpected,
        dailyCollected,
        dailyRate: dailyExpected > 0 ? (dailyCollected / dailyExpected) * 100 : null,
        // MTD through today: a sort key that doesn't change while stepping through days
        mtdToDateCollected: sumDays(actual?.byDay, 1, cutoffDay),
        officers: buildOfficersForBranch(key, branchCode, expected),
      }
    })

    // Totals: rates only count branches that have an expected amount, so untargeted
    // branches don't inflate them; Gap is the sum of the Gap column.
    const totalFor = (expectedKey, collectedKey) => {
      let expected = 0
      let collected = 0
      let collectedWithTarget = 0
      for (const row of rows) {
        expected += row[expectedKey]
        collected += row[collectedKey]
        if (row[expectedKey] > 0) collectedWithTarget += row[collectedKey]
      }
      return { expected, collected, rate: expected > 0 ? (collectedWithTarget / expected) * 100 : null }
    }
    const totals = {
      daily: totalFor('dailyExpected', 'dailyCollected'),
      mtd: {
        ...totalFor('mtdExpected', 'mtdCollected'),
        gap: rows.reduce((sum, row) => sum + row.mtdGap, 0),
      },
    }

    return {
      monthly: [...rows].sort((a, b) => b.collected - a.collected),
      mtd: [...rows].sort((a, b) => b.mtdToDateCollected - a.mtdToDateCollected),
      daily: [...rows]
        .filter((row) => row.dailyExpected > 0 || row.dailyCollected > 0)
        .sort((a, b) => b.dailyCollected - a.dailyCollected),
      cutoffDay,
      selectedDay: day,
      asOfDay,
      isFutureDay,
      hasTargets: targetMap.size > 0,
      totals,
    }
  })()

  // MTD Collection vs Target by Branch (bar chart): same rows and as-of day as the table
  const branchMTDData = branchCollectionTables.mtd
    .filter((row) => row.mtdCollected > 0 || row.mtdExpected > 0)
    .map((row) => ({
      name: row.name,
      actual: row.mtdCollected,
      target: row.mtdExpected,
      percent: row.mtdRate ?? 0,
    }))

  // Clients Paid list: the same repayment rows the branch table counts for the selected day,
  // joined to the client names fetched for that day (dayClientMap, keyed by loan id).
  const dayClientsList = (() => {
    const proc = data.processor
    const day = branchCollectionTables.selectedDay
    const all = []
    if (proc) {
      for (const r of rowsForMonth(selectedYear, selectedMonth)) {
        const date = proc.parseDMY(r.repayment_collected_date)
        if (!date || date.getFullYear() !== selectedYear || date.getMonth() + 1 !== selectedMonth || date.getDate() !== day) continue
        const branchCode = String(r.branch || r.Branch || '').trim()
        if (!branchCode) continue
        const loanId = String(r.loan_id ?? '').trim()
        const info = dayClientMap[loanId] || null
        all.push({
          repaymentId: r.repayment_id,
          loanId,
          branchCode,
          branchName: proc.getBranchName ? proc.getBranchName(branchCode) : branchCode,
          amount: Number(r.repayment_amount) || 0,
          clientName: info?.clientName || null,
          phone: info?.phone || null,
          loanNumber: info?.loanNumber || null,
          officer: info?.officer || null,
          // Set when the client was found through the loan this one was restructured into
          restructuredInto: info?.restructuredInto || null,
        })
      }
    }

    const branchOptions = Array.from(new Map(all.map((r) => [r.branchCode, r.branchName])).entries()).sort((a, b) =>
      String(a[1]).localeCompare(String(b[1])),
    )
    const query = clientSearch.trim().toLowerCase()
    const filtered = all
      .filter((r) => !clientBranchFilter || r.branchCode === clientBranchFilter)
      .filter(
        (r) =>
          !query ||
          [r.clientName, r.phone, r.loanNumber, r.loanId, r.officer, r.restructuredInto].some(
            (value) => value && String(value).toLowerCase().includes(query),
          ),
      )
      .sort((a, b) => b.amount - a.amount)

    // A client with several loans counts once (same phone, else same name); unknown clients by loan
    const clientKey = (r) => {
      const digits = String(r.phone || '').replace(/\D/g, '')
      if (digits) return `p:${digits}`
      if (r.clientName) return `n:${r.clientName.toLowerCase()}`
      return `l:${r.loanId}`
    }
    const totals = {
      payments: filtered.length,
      clients: new Set(filtered.map(clientKey)).size,
      amount: filtered.reduce((sum, r) => sum + r.amount, 0),
    }
    // The server sees payments synced after this page loaded; the page lists what it loaded
    const newerOnServer =
      dayClientServerPayments != null && dayClientServerPayments > all.length ? dayClientServerPayments - all.length : 0

    return { all, filtered, branchOptions, totals, newerOnServer }
  })()

  // Branch name click in the Daily & MTD table: filter the Clients Paid list and scroll to it
  const showClientsForBranch = (branchCode) => {
    setClientBranchFilter(String(branchCode || ''))
    setClientSearch('')
    window.requestAnimationFrame(() => {
      clientsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  // Excel download of the Clients Paid list as currently filtered
  const downloadDayClientsExcel = () => {
    const { filtered, totals } = dayClientsList
    if (!filtered.length) return
    const day = branchCollectionTables.selectedDay
    const dd = String(day).padStart(2, '0')
    const mm = String(selectedMonth).padStart(2, '0')
    const amountHeader = `Amount (${sourceCurrency || 'KES'})`
    const sheetRows = filtered.map((r, index) => ({
      '#': index + 1,
      Date: `${dd}/${mm}/${selectedYear}`,
      Client: r.clientName || 'Unknown client',
      Phone: r.phone || '',
      'Loan #': r.loanNumber || r.loanId,
      Branch: r.branchName,
      'Loan officer': r.officer || '',
      [amountHeader]: r.amount,
      'Loan ID': r.loanId,
      'Repayment ID': r.repaymentId ?? '',
      Note: r.restructuredInto ? `Restructured into loan ${r.restructuredInto}` : '',
    }))
    sheetRows.push({ Client: `TOTAL (${totals.payments} payments, ${totals.clients} clients)`, [amountHeader]: totals.amount })
    const sheet = XLSX.utils.json_to_sheet(sheetRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Clients Paid')
    const branchSuffix = clientBranchFilter
      ? `-${String(data.processor?.getBranchName?.(clientBranchFilter) || clientBranchFilter)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`
      : ''
    XLSX.writeFile(workbook, `logbook-clients-paid-${selectedYear}-${mm}-${dd}${branchSuffix}.xlsx`)
  }

  const normalizeBranchKey = (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*branch\s*$/i, '')
      .toLowerCase()

  const dailyOpenLoansByCode = (() => {
    const map = new Map()
    for (const branch of dailyOpenLoansBranches) {
      const code = String(branch.code ?? '').trim()
      if (code) map.set(code, branch.loans || [])
    }
    return map
  })()

  const getDailyLoansForRow = (row) => {
    const code = String(row.branchCode || '').trim()
    if (code && dailyOpenLoansByCode.has(code)) {
      return dailyOpenLoansByCode.get(code) || []
    }
    const normName = normalizeBranchKey(row.name)
    for (const branch of dailyOpenLoansBranches) {
      if (normalizeBranchKey(branch.name) === normName) {
        return branch.loans || []
      }
    }
    return []
  }

  const dailyBranchRowsMerged = (() => {
    const map = new Map()
    for (const row of branchCollectionTables.daily) {
      if (row.branchCode) map.set(row.branchCode, row)
    }
    for (const branch of dailyOpenLoansBranches) {
      const code = String(branch.code ?? '').trim()
      if (!code || map.has(code)) continue
      const name = String(branch.name || code).replace(/\s*branch\s*$/i, '').trim()
      map.set(code, {
        name,
        branchCode: code,
        dailyExpected: 0,
        dailyCollected: Number(branch.collected) || 0,
        dailyRate: null,
      })
    }
    return Array.from(map.values())
  })()

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

  // Selected-month breakdown totals
  const selectedMonthFees = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let sum = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) sum += Number(r.fees_repayment_amount) || 0
    }
    return sum
  })()
  const selectedMonthPenalty = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let sum = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) sum += Number(r.penalty_repayment_amount) || 0
    }
    return sum
  })()
  const selectedMonthTransactions = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let count = 0
    for (const r of rowsForMonth(y, m)) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === y && Number(mm) === m) count += 1
    }
    return count
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Logbook Collection</h1>
          <p className="text-gray-600 mt-2">Monitor loan collections and payment status with real data</p>
        </div>
        <div className="flex items-end space-x-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Month</label>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedMonth} onChange={e => changePeriod(Number(e.target.value), selectedYear)}>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString('en-US', { month: 'long' })}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Year</label>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedYear} onChange={e => changePeriod(selectedMonth, Number(e.target.value))}>
              {[selectedYear-1, selectedYear, selectedYear+1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{`Total ${monthLabel} Collected`}</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalCollectedSelectedMonth)}</p>
              <p className="text-sm mt-1 text-green-600">{collectedVsTargetPctStr}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <CheckCircle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Principal Collected</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(selectedMonthPrincipal)}</p>
              <p className={`text-sm mt-1 ${changeColor(principalChangePct)}`}>{principalChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Interest Collected</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(selectedMonthInterest)}</p>
              <p className={`text-sm mt-1 ${changeColor(interestChangePct)}`}>{interestChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Collectors</p>
              <p className="text-2xl font-bold text-gray-900">{Object.keys(data.collectorStats).length}</p>
            </div>
            <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
              <Users size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Additional Summary Cards Row */}
      {isPastMonth ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Average Collections per Week (Selected Month)</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(avgCollectedAmtPerWeekSelected)}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-50 text-green-600">
                <DollarSign size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Average Collections per Day (Selected Month)</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(avgCollectedAmtPerDaySelected)}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-50 text-green-600">
                <CheckCircle size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Number of Loans (Selected Month)</p>
                <p className="text-2xl font-bold text-gray-900">{numLoansSelectedMonth}</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                <Users size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Collections / Day (Selected Month)</p>
                <p className="text-2xl font-bold text-gray-900">{(selectedMonthRepaymentCount / daysInSelectedMonth).toFixed(2)}</p>
              </div>
              <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600">
                <Clock size={24} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Collections This Week</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(collectionsThisWeek)}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-50 text-green-600">
                <DollarSign size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Collections Today</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(collectionsToday)}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-50 text-green-600">
                <CheckCircle size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Number of Loans (This Month)</p>
                <p className="text-2xl font-bold text-gray-900">{numLoansCollectedThisMonth}</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                <Users size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Collections / Day (This Month)</p>
                <p className="text-2xl font-bold text-gray-900">{avgCollectionsPerDayThisMonth.toFixed(2)}</p>
              </div>
              <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600">
                <Clock size={24} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Expected vs Collected by Branch (Selected Month)
            </h3>
            <p className="text-xs text-gray-500">
              Branch expected uses each branch’s monthly collection target. Officer expected uses RO Targets for the selected month, or a share of the branch target by portfolio when RO targets are missing.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-gray-600 w-8" />
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Expected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Collected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {branchCollectionTables.monthly.map((row) => (
                  <React.Fragment key={row.name}>
                    <tr
                      className={`transition-colors ${
                        expandedMonthlyBranch === row.name ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-2 py-2">
                        {row.officers.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMonthlyBranch(
                                expandedMonthlyBranch === row.name ? null : row.name,
                              )
                            }
                            className="p-1 rounded hover:bg-indigo-100 text-gray-500 hover:text-indigo-600"
                            aria-label={expandedMonthlyBranch === row.name ? 'Collapse' : 'Expand'}
                          >
                            {expandedMonthlyBranch === row.name ? (
                              <ChevronDown size={18} />
                            ) : (
                              <ChevronRight size={18} />
                            )}
                          </button>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{row.name}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(row.expected)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(row.collected)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${
                        row.rate == null ? 'text-gray-500' : row.rate >= 100 ? 'text-green-600' : 'text-orange-600'
                      }`}>
                        {row.rate == null ? '—' : `${row.rate.toFixed(1)}%`}
                      </td>
                    </tr>

                    {expandedMonthlyBranch === row.name && row.officers.length > 0 && (
                      <tr className="bg-indigo-50/40">
                        <td colSpan={5} className="px-4 pb-4 pt-2">
                          <div className="bg-white rounded-lg border border-indigo-200 overflow-hidden shadow-sm">
                            <div className="px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-indigo-100">
                              <h4 className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
                                <User size={15} />
                                Loan Officers — {row.name}
                              </h4>
                            </div>
                            <table className="min-w-full divide-y divide-gray-100 text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-2 text-left font-medium text-gray-600">Loan Officer</th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">Expected</th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">Collected</th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">Rate</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {row.officers.map((officer) => (
                                  <tr key={officer.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 text-gray-900">{officer.name}</td>
                                    <td className="px-4 py-2 text-right">
                                      {officer.expected > 0 ? formatMoney(officer.expected) : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-right">{formatMoney(officer.collected)}</td>
                                    <td className={`px-4 py-2 text-right font-medium ${
                                      officer.rate == null
                                        ? 'text-gray-500'
                                        : officer.rate >= 100
                                          ? 'text-green-600'
                                          : 'text-orange-600'
                                    }`}>
                                      {officer.rate == null ? '—' : `${officer.rate.toFixed(1)}%`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {!branchCollectionTables.monthly.length && (
                  <tr>
                    <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                      No branch data for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Daily Branch Breakdown</h3>
              <p className="text-xs text-gray-500">
                Daily expected uses the branch target divided by working days. Expand a branch to see open loans due on the selected day (latest PAR snapshot).
              </p>
              {dailyOpenLoansMeta.snapshotTime && (
                <p className="text-xs text-gray-400 mt-1">
                  Open loans from PAR snapshot {dailyOpenLoansMeta.snapshotTime}
                  {dailyOpenLoansMeta.date ? ` · due ${dailyOpenLoansMeta.date}` : ''}
                  {dailyOpenLoansMeta.scanned > 0
                    ? ` · ${dailyOpenLoansMeta.matched} due of ${dailyOpenLoansMeta.scanned} open`
                    : ''}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Day
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm"
                value={branchCollectionTables.selectedDay}
                onChange={(event) => setSelectedDay(Number(event.target.value))}
              >
                {Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-gray-600 w-8" />
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Expected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Collected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {dailyBranchRowsMerged
                  .filter((row) => {
                    const loans = getDailyLoansForRow(row)
                    return row.dailyExpected > 0 || row.dailyCollected > 0 || loans.length > 0
                  })
                  .map((row) => {
                    const loans = getDailyLoansForRow(row)
                    const rowKey = String(row.branchCode || row.name)
                    const isExpanded = expandedDailyBranch === rowKey
                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          className={`transition-colors ${
                            isExpanded ? 'bg-indigo-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => handleToggleDailyBranch(row)}
                              className="p-1 rounded hover:bg-indigo-100 text-gray-500 hover:text-indigo-600"
                              aria-label={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {isExpanded ? (
                                <ChevronDown size={18} />
                              ) : (
                                <ChevronRight size={18} />
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {row.name}
                            {loans.length > 0 && (
                              <span className="ml-2 text-xs text-gray-500">({loans.length} loans)</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{formatMoney(row.dailyExpected)}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(row.dailyCollected)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${
                            row.dailyRate == null ? 'text-gray-500' : row.dailyRate >= 100 ? 'text-green-600' : 'text-orange-600'
                          }`}>
                            {row.dailyRate == null ? '—' : `${row.dailyRate.toFixed(1)}%`}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-indigo-50/40">
                            <td colSpan={5} className="px-4 pb-4 pt-2">
                              <div className="bg-white rounded-lg border border-indigo-200 overflow-hidden shadow-sm">
                                <div className="px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-indigo-100">
                                  <h4 className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
                                    <FileText size={15} />
                                    Open Loans Due — {row.name}
                                    {dailyOpenLoansLoading ? (
                                      <span className="text-xs font-normal text-indigo-600">Loading…</span>
                                    ) : null}
                                  </h4>
                                </div>
                                {loans.length ? (
                                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-2 text-left font-medium text-gray-600">Loan #</th>
                                        <th className="px-4 py-2 text-left font-medium text-gray-600">Borrower</th>
                                        <th className="px-4 py-2 text-left font-medium text-gray-600">Loan Officer</th>
                                        <th className="px-4 py-2 text-right font-medium text-gray-600">Due Amount</th>
                                        <th className="px-4 py-2 text-right font-medium text-gray-600">Collected</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {loans.map((loan) => (
                                        <tr key={loan.loanId || `${loan.borrowerName}-${loan.dueAmount}`} className="hover:bg-gray-50">
                                          <td className="px-4 py-2 text-gray-900 font-medium">{loan.loanId || '—'}</td>
                                          <td className="px-4 py-2 text-gray-700">{loan.borrowerName || '—'}</td>
                                          <td className="px-4 py-2 text-gray-600">
                                            {(loan.officerNames || []).join(', ') || '—'}
                                          </td>
                                          <td className="px-4 py-2 text-right">{formatMoney(loan.dueAmount || 0)}</td>
                                          <td className="px-4 py-2 text-right">{formatMoney(loan.collected || 0)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="px-4 py-6 text-sm text-gray-500 text-center">
                                    {dailyOpenLoansLoading
                                      ? 'Loading open loans…'
                                      : `No open loans with due date ${dailyOpenLoansMeta.date || 'on this day'} in the latest PAR snapshot.`}
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                {!dailyBranchRowsMerged.filter((row) => {
                  const loans = getDailyLoansForRow(row)
                  return row.dailyExpected > 0 || row.dailyCollected > 0 || loans.length > 0
                }).length && !dailyOpenLoansLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                      No branch data for the selected day.
                    </td>
                  </tr>
                )}
                {dailyOpenLoansLoading && (
                  <tr>
                    <td className="px-3 py-4 text-center text-gray-500" colSpan={5}>
                      Loading open loans…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Repayment Composition */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Repayment Composition</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={repaymentComposition}
                cx="50%"
                cy="95%"
                startAngle={180}
                endAngle={0}
                innerRadius={100}
                outerRadius={160}
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                fill="#8884d8"
                dataKey="value"
              >
                {repaymentComposition.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatMoney(value), 'Amount']} />
            </PieChart>
          </ResponsiveContainer>

          {/* Collection By Branch (Selected Month) with Targets */}
          <div className="mt-8">
          <h4 className="text-md font-semibold mb-3 text-gray-900">Collection By Branch (Selected Month)</h4>
            {(() => {
              const proc = data.processor
              if (!proc || !proc.repaymentsData) return null
              const y = selectedYear
              const m = selectedMonth
              const normalizeName = (name) => String(name || '').replace(/\s*branch$/i, '').trim()
              const targetMap = new Map()
              targets
                .filter(t => t.active && Number(t.month) === m && Number(t.year) === y)
                .forEach(t => targetMap.set(normalizeName(t.branch), Number(t.collectionTarget) || 0))

              const agg = {}
              for (const r of rowsForMonth(y, m)) {
                const s = r.repayment_collected_date || ''
                const [dd, mm, yyyy] = String(s).split('/')
                const code = r.branch || r.Branch
                if (!code || !yyyy || !mm || !dd) continue
                if (Number(yyyy) === y && Number(mm) === m) {
                  const keyName = normalizeName(proc.getBranchName ? proc.getBranchName(code) : code)
                  agg[keyName] = (agg[keyName] || 0) + (Number(r.repayment_amount) || 0)
                }
              }
              const rows = Object.entries(agg).map(([name, amount]) => {
                const target = targetMap.get(name) || 0
                const pct = target > 0 ? (amount / target) * 100 : 0
                return { name, amount, target, pct }
              }).sort((a,b) => b.amount - a.amount)

              if (!rows.length) return <div className="text-sm text-gray-600">No data for selected period.</div>

              return (
                <div className="space-y-3">
                  {rows.map(row => {
                    const pct = row.pct
                    const width = Math.min(100, Math.max(0, pct))
                    return (
                      <div key={row.name}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium text-gray-800">{row.name}</span>
                          <span className="text-gray-500">
                            {formatMoney(row.amount)} {row.target > 0 ? ` / ${formatMoney(row.target)}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 h-3 bg-gray-200 rounded-full relative">
                            <div
                              className="absolute top-0 left-0 h-3 bg-green-500 rounded-full"
                              style={{ width: `${width}%` }}
                            ></div>
                          </div>
                          <span className="w-16 text-xs text-gray-600 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>

        {/* Collection Trend */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Collection Trend</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'target') return [formatMoney(value), 'Daily Target']
                  return [formatMoney(value), 'Collected']
                }}
              />
              <Area type="monotone" dataKey="amount" stroke="#10b981" fill="#10b981" fillOpacity={0.25} name="Collected" />
              <Area type="monotone" dataKey="target" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.18} name="Daily Target" />
            </AreaChart>
          </ResponsiveContainer>
          {branchMTDData.length > 0 && (
            <div className="mt-6">
              <h4 className="text-md font-semibold text-gray-900 mb-3">
                MTD Collection vs Target by Branch
                {branchCollectionTables.asOfDay > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {`(1–${branchCollectionTables.asOfDay} ${new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('en-GB', { month: 'short' })})`}
                  </span>
                )}
              </h4>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={branchMTDData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(value, name, entry) => {
                      const key = entry?.dataKey
                      if (key === 'percent') return [`${value.toFixed(1)}%`, 'MTD % of Target']
                      if (key === 'target') return [formatMoney(value), 'MTD Target']
                      return [formatMoney(value), 'MTD Collected']
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="actual" name="MTD Collected" fill="#3b82f6" />
                  <Bar yAxisId="left" dataKey="target" name="MTD Target" fill="#f59e0b" />
                  <Bar yAxisId="right" dataKey="percent" name="% of Target" fill="#10b981" />
                </BarChart>
          </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Collection Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Fees Collected</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(selectedMonthFees)}</p>
              <p className="text-sm text-gray-600 mt-1">
                {totalCollectedSelectedMonth > 0 ? ((selectedMonthFees / totalCollectedSelectedMonth) * 100).toFixed(1) : '0.0'}% of total
              </p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Penalty Collected</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(selectedMonthPenalty)}</p>
              <p className="text-sm text-gray-600 mt-1">
                {totalCollectedSelectedMonth > 0 ? ((selectedMonthPenalty / totalCollectedSelectedMonth) * 100).toFixed(1) : '0.0'}% of total
              </p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-red-600">
              <AlertCircle size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Transactions</p>
              <p className="text-2xl font-bold text-gray-900">{selectedMonthTransactions}</p>
              <p className="text-sm text-gray-600 mt-1">Repayment records (selected month)</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600">
              <Clock size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Branch collection: selected day + MTD as of the selected day */}
      {(() => {
        const {
          mtd: rows,
          totals,
          selectedDay: day,
          cutoffDay: maxDay,
          asOfDay,
          isFutureDay,
          hasTargets,
        } = branchCollectionTables
        const selectedDate = new Date(selectedYear, selectedMonth - 1, day)
        const todayStart = new Date(todayY, todayM - 1, todayD)
        const yesterday = new Date(todayY, todayM - 1, todayD - 1)
        const nextDate = new Date(selectedYear, selectedMonth - 1, day + 1)
        // From a future day, "previous" goes back to today
        const prevDate =
          selectedDate > todayStart ? todayStart : new Date(selectedYear, selectedMonth - 1, day - 1)
        const isSameDate = (a, b) =>
          a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
        const goToDate = (date) => changePeriod(date.getMonth() + 1, date.getFullYear(), date.getDate())
        const isTodaySelected = isSameDate(selectedDate, todayStart)
        const isYesterdaySelected = isSameDate(selectedDate, yesterday)
        const isSundaySelected = selectedDate.getDay() === 0
        const dayLabel = selectedDate.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
        const monthShort = new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('en-GB', { month: 'short' })
        const monthLong = new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric',
        })
        const rateClass = (rate) =>
          rate == null ? 'text-gray-500' : rate >= 100 ? 'text-green-600' : 'text-orange-600'
        const rateText = (rate) => (rate == null ? '—' : `${rate.toFixed(1)}%`)
        // A working day with nothing collected stands out in red
        const dayCollectedClass = (amount) =>
          !isFutureDay && !isSundaySelected && !(amount > 0) ? 'text-red-600' : 'text-gray-900'
        const quickButtonClass = (active) =>
          `px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors ${
            active
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`
        const arrowButtonClass =
          'p-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed'

        return (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Daily &amp; MTD Collection by Branch</h3>
                <p className="text-xs text-gray-500">
                  Day columns show collections on {dayLabel}
                  {asOfDay > 0
                    ? `; MTD columns run from 1 to ${asOfDay} ${monthShort}.`
                    : '; no MTD collections yet for this month.'}{' '}
                  Expected uses each branch’s collection target ÷ working days (Sundays and holidays excluded).
                </p>
                {!hasTargets && (
                  <p className="text-xs text-amber-700 mt-1">
                    No collection targets are set for {monthLong}, so Expected, Gap and Rate show 0 / —.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-500 mr-1">{country || 'All countries'}</span>
                <button
                  type="button"
                  className={arrowButtonClass}
                  onClick={() => goToDate(prevDate)}
                  aria-label="Previous day"
                >
                  <ChevronLeft size={16} />
                </button>
                <select
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                  value={day}
                  onChange={(event) => setSelectedDay(Number(event.target.value))}
                  disabled={maxDay < 1}
                  aria-label="Collection day"
                >
                  {Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1).map((d) => (
                    <option key={d} value={d} disabled={d > maxDay}>
                      {new Date(selectedYear, selectedMonth - 1, d).toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                      })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={arrowButtonClass}
                  onClick={() => goToDate(nextDate)}
                  disabled={nextDate > todayStart}
                  aria-label="Next day"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  className={quickButtonClass(isTodaySelected)}
                  aria-pressed={isTodaySelected}
                  onClick={() => goToDate(todayStart)}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={quickButtonClass(isYesterdaySelected)}
                  aria-pressed={isYesterdaySelected}
                  onClick={() => goToDate(yesterday)}
                >
                  Yesterday
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      rowSpan={2}
                      scope="col"
                      className="px-3 py-2 text-left align-bottom font-medium text-gray-600 sticky left-0 z-10 bg-gray-50"
                    >
                      Branch
                    </th>
                    <th
                      colSpan={3}
                      scope="colgroup"
                      className="px-3 pt-2 pb-1 text-center text-xs font-semibold text-indigo-700 bg-indigo-50 border-l border-gray-200"
                    >
                      {dayLabel}
                      {isFutureDay ? ' · upcoming' : ''}
                    </th>
                    <th
                      colSpan={4}
                      scope="colgroup"
                      className="px-3 pt-2 pb-1 text-center text-xs font-semibold text-gray-700 border-l border-gray-200"
                    >
                      {asOfDay > 0 ? `Month to date · 1–${asOfDay} ${monthShort}` : 'Month to date'}
                    </th>
                  </tr>
                  <tr>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600 bg-indigo-50 border-l border-gray-200">Expected</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600 bg-indigo-50">Collected</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600 bg-indigo-50">Rate</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600 border-l border-gray-200">Expected MTD</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Collected MTD</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Gap</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {rows.map((row) => (
                    <tr key={row.name} className="hover:bg-gray-50">
                      <th scope="row" className="px-3 py-2 text-left font-medium text-gray-900 sticky left-0 z-10 bg-white">
                        <button
                          type="button"
                          onClick={() => showClientsForBranch(row.branchCode)}
                          className="text-left hover:text-indigo-700 hover:underline focus:outline-none focus-visible:underline"
                          title={`Show clients who paid at ${row.name} on this day`}
                        >
                          {row.name}
                        </button>
                      </th>
                      <td className="px-3 py-2 text-right border-l border-gray-100">{formatMoney(row.dailyExpected)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${dayCollectedClass(row.dailyCollected)}`}>
                        {isFutureDay ? '—' : formatMoney(row.dailyCollected)}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${isFutureDay ? 'text-gray-500' : rateClass(row.dailyRate)}`}>
                        {isFutureDay ? '—' : rateText(row.dailyRate)}
                      </td>
                      <td className="px-3 py-2 text-right border-l border-gray-100">{formatMoney(row.mtdExpected)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(row.mtdCollected)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(row.mtdGap)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${rateClass(row.mtdRate)}`}>{rateText(row.mtdRate)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td className="px-3 py-6 text-center text-gray-500" colSpan={8}>
                        No branch data for the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
                {rows.length > 0 && totals && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-semibold text-gray-900">
                      <th scope="row" className="px-3 py-2 text-left sticky left-0 z-10 bg-gray-50">TOTAL</th>
                      <td className="px-3 py-2 text-right border-l border-gray-200">{formatMoney(totals.daily.expected)}</td>
                      <td className="px-3 py-2 text-right">{isFutureDay ? '—' : formatMoney(totals.daily.collected)}</td>
                      <td className={`px-3 py-2 text-right ${isFutureDay ? 'text-gray-500' : rateClass(totals.daily.rate)}`}>
                        {isFutureDay ? '—' : rateText(totals.daily.rate)}
                      </td>
                      <td className="px-3 py-2 text-right border-l border-gray-200">{formatMoney(totals.mtd.expected)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(totals.mtd.collected)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(totals.mtd.gap)}</td>
                      <td className={`px-3 py-2 text-right ${rateClass(totals.mtd.rate)}`}>{rateText(totals.mtd.rate)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      })()}

      {/* Clients Paid: Loandisk repayments collected on the selected day, with client names */}
      {(() => {
        const { all, filtered, branchOptions, totals, newerOnServer } = dayClientsList
        const day = branchCollectionTables.selectedDay
        const dayLabel = new Date(selectedYear, selectedMonth - 1, day).toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
        const activeBranchName = clientBranchFilter
          ? data.processor?.getBranchName?.(clientBranchFilter) || clientBranchFilter
          : null
        const filterIsListed = branchOptions.some(([code]) => code === clientBranchFilter)
        const emptyMessage = all.length
          ? activeBranchName && !filterIsListed
            ? `No payments at ${activeBranchName} on this day.`
            : 'No payments match the search.'
          : branchCollectionTables.isFutureDay
            ? 'This day is still to come.'
            : 'No payments on this day.'

        return (
          <div ref={clientsCardRef} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 scroll-mt-4">
            <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Clients Paid — {dayLabel}</h3>
                <p className="text-xs text-gray-500">
                  Loandisk repayments collected on this day{activeBranchName ? ` at ${activeBranchName}` : ''}. Change the
                  day with the picker on the branch table above; click a branch name there to list its clients.
                </p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                    {totals.payments} {totals.payments === 1 ? 'payment' : 'payments'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                    {totals.clients} {totals.clients === 1 ? 'client' : 'clients'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold">
                    {formatMoney(totals.amount)}
                  </span>
                  {dayClientsLoading && <span className="px-2 py-0.5 text-gray-500">Loading client names…</span>}
                </div>
                {newerOnServer > 0 && (
                  <p className="text-xs text-amber-700 mt-2">
                    {newerOnServer} newer {newerOnServer === 1 ? 'payment was' : 'payments were'} synced for this day
                    since the page loaded. Reload the page to include {newerOnServer === 1 ? 'it' : 'them'}.
                  </p>
                )}
                {dayClientsError && (
                  <p className="text-xs text-red-600 mt-2">
                    Client names couldn’t be loaded ({dayClientsError}). Payments are still listed.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="search"
                    value={clientSearch}
                    onChange={(event) => setClientSearch(event.target.value)}
                    placeholder="Search client, phone, loan #"
                    aria-label="Search clients"
                    className="border border-gray-300 rounded pl-7 pr-2 py-1 text-sm w-56"
                  />
                </div>
                <select
                  value={clientBranchFilter}
                  onChange={(event) => setClientBranchFilter(event.target.value)}
                  aria-label="Filter clients by branch"
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">All branches</option>
                  {branchOptions.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                  {clientBranchFilter && !filterIsListed && <option value={clientBranchFilter}>{activeBranchName}</option>}
                </select>
                {clientBranchFilter && (
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:underline"
                    onClick={() => setClientBranchFilter('')}
                  >
                    Clear filter
                  </button>
                )}
                <button
                  type="button"
                  onClick={downloadDayClientsExcel}
                  disabled={!filtered.length}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                  Excel
                </button>
              </div>
            </div>
            {/* Scroll box: header 36px + 20 rows × 37px + TOTAL ≈ 51rem; capped at 90% of the screen height */}
            <div
              ref={clientsScrollRef}
              className="rounded-lg border border-gray-200 overflow-auto max-h-[min(51rem,90vh)] overscroll-contain [scrollbar-gutter:stable]"
              style={{ scrollbarWidth: 'thin' }}
            >
              <table className="min-w-full divide-y divide-gray-200 text-sm whitespace-nowrap">
                <thead className="bg-gray-50 sticky top-0 z-20 shadow-[0_1px_0_0_rgb(229,231,235)]">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600 w-10">#</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 z-10 bg-gray-50">Client</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Phone</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Loan #</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Loan officer</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map((r, index) => (
                    <tr key={r.repaymentId ?? `${r.loanId}-${index}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-right text-gray-400">{index + 1}</td>
                      <th scope="row" className="px-3 py-2 text-left font-medium sticky left-0 z-10 bg-white">
                        {r.clientName ? (
                          <>
                            <span className="text-gray-900">{r.clientName}</span>
                            {r.restructuredInto && (
                              <span
                                className="block text-xs font-normal text-gray-400"
                                title="This loan was restructured; the client was found through the new loan"
                              >
                                restructured → loan {r.restructuredInto}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400 italic font-normal">
                            {dayClientsLoading ? 'Loading…' : 'Unknown client'}
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-2 text-gray-700">
                        {r.phone ? (
                          <a href={`tel:${r.phone}`} className="text-indigo-700 hover:underline">
                            {r.phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{r.loanNumber || r.loanId || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.branchName}</td>
                      <td className="px-3 py-2 text-gray-700">{r.officer || '—'}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${r.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {formatMoney(r.amount)}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                        {emptyMessage}
                      </td>
                    </tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200 sticky bottom-0 z-20 shadow-[0_-1px_0_0_rgb(229,231,235)]">
                    <tr className="font-semibold text-gray-900">
                      <td className="px-3 py-2" />
                      <th scope="row" className="px-3 py-2 text-left sticky left-0 z-10 bg-gray-50">TOTAL</th>
                      <td colSpan={4} className="px-3 py-2 text-gray-500 font-normal">
                        {totals.payments} {totals.payments === 1 ? 'payment' : 'payments'} · {totals.clients}{' '}
                        {totals.clients === 1 ? 'client' : 'clients'}
                      </td>
                      <td className="px-3 py-2 text-right">{formatMoney(totals.amount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default LogbookCollection

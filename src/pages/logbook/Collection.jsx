import React, { useState, useEffect } from 'react'
import { TrendingUp, Clock, CheckCircle, AlertCircle, DollarSign, Users, ChevronDown, ChevronRight, User, FileText } from 'lucide-react'
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

function LogbookCollection({ country }) {
  const { formatMoney } = useLogbookCurrency()
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
    const loadDailyOpenLoans = async () => {
      setDailyOpenLoansLoading(true)
      try {
        const base = API_URLS.logbook.dailyOpenLoans(selectedMonth, selectedYear, selectedDay)
        const url = country ? `${base}&country=${encodeURIComponent(country)}` : base
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) {
          setDailyOpenLoansBranches([])
          setDailyOpenLoansMeta({ snapshotTime: null, date: null, scanned: 0, matched: 0 })
          return
        }
        const data = await res.json()
        setDailyOpenLoansBranches(Array.isArray(data.branches) ? data.branches : [])
        setDailyOpenLoansMeta({
          snapshotTime: data.snapshotTime || null,
          date: data.date || null,
          scanned: Number(data.meta?.scanned) || 0,
          matched: Number(data.meta?.matched) || 0,
        })
      } catch (e) {
        console.error('Failed to load daily open loans', e)
        setDailyOpenLoansBranches([])
        setDailyOpenLoansMeta({ snapshotTime: null, date: null, scanned: 0, matched: 0 })
      } finally {
        setDailyOpenLoansLoading(false)
      }
    }
    loadDailyOpenLoans()
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
    try {
      const base = API_URLS.logbook.dailyOpenLoans(selectedMonth, selectedYear, selectedDay, code)
      const url = country ? `${base}&country=${encodeURIComponent(country)}` : base
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
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
        setDailyOpenLoansLoading(true)
        await loadDailyOpenLoansForBranch(code)
        setDailyOpenLoansLoading(false)
      }
    }
  }

  // Listen to global month/year changes from header
  useEffect(() => {
    const onGlobalChange = (e) => {
      if (!e || !e.detail) return
      const { month, year } = e.detail
      if (typeof month === 'number') setSelectedMonth(month)
      if (typeof year === 'number') setSelectedYear(year)
    }
    window.addEventListener('global_month_year_changed', onGlobalChange)
    return () => window.removeEventListener('global_month_year_changed', onGlobalChange)
  }, [])

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

  // Current-month principal and interest collected (DB fields)
  const selectedMonthPrincipal = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return 0
    const y = selectedYear
    const m = selectedMonth
    let sum = 0
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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

  // MTD Collection vs Target by Branch (for bar chart)
  const branchMTDData = (() => {
    const proc = data.processor
    if (!proc || !proc.repaymentsData) return []
    const y = selectedYear
    const m = selectedMonth
    const normalizeName = (name) => String(name || '').replace(/\s*branch$/i, '').trim()

    // Build target map
    const targetMap = new Map()
    targets
      .filter((t) => t.active && Number(t.year) === y && Number(t.month) === m)
      .forEach((t) => {
        const key = normalizeName(t.branch)
        targetMap.set(key, {
          collectionTarget: Number(t.collectionTarget) || 0,
          workingDays: Number(t.workingDays) || 0,
          holidays: Array.isArray(t.holidays) ? t.holidays : [],
        })
      })

    // Determine elapsed working days up to today (or full month if past month)
    const workingDaysElapsed = (month, year, totalWorkingDays, holidays = []) => {
      const today = new Date()
      const isFuture =
        year > today.getFullYear() ||
        (year === today.getFullYear() && month > today.getMonth() + 1)
      if (isFuture) return 0
      const cutoffDay =
        year === today.getFullYear() && month === today.getMonth() + 1
          ? today.getDate()
          : new Date(year, month, 0).getDate()
      const holidaySet = new Set((Array.isArray(holidays) ? holidays : []).map((d) => new Date(d).toDateString()))
      let count = 0
      for (let day = 1; day <= cutoffDay; day++) {
        const dt = new Date(year, month - 1, day)
        if (dt.getDay() === 0) continue // Sundays non-working
        if (holidaySet.has(dt.toDateString())) continue
        count++
      }
      if (totalWorkingDays && totalWorkingDays > 0) {
        return Math.min(count, totalWorkingDays)
      }
      return count
    }

    // Aggregate actual collections up to cutoff day
    const cutoffDay =
      (() => {
        const today = new Date()
        if (today.getFullYear() === y && today.getMonth() + 1 === m) return today.getDate()
        return new Date(y, m, 0).getDate()
      })()

    const agg = new Map()
    for (const r of proc.repaymentsData) {
      const s = r.repayment_collected_date || ''
      const [dd, mm, yyyy] = String(s).split('/')
      if (!yyyy || !mm || !dd) continue
      const yy = Number(yyyy)
      const mmNum = Number(mm)
      const ddNum = Number(dd)
      if (yy !== y || mmNum !== m || ddNum > cutoffDay) continue
      const code = r.branch || r.Branch
      if (!code) continue
      const name = normalizeName(proc.getBranchName ? proc.getBranchName(code) : code)
      agg.set(name, (agg.get(name) || 0) + (Number(r.repayment_amount) || 0))
    }

    // Combine targets and actuals
    const names = new Set([...agg.keys(), ...targetMap.keys()])
    const rows = []
    for (const name of names) {
      const targetInfo = targetMap.get(name) || { collectionTarget: 0, workingDays: 0, holidays: [] }
      const elapsed = workingDaysElapsed(m, y, targetInfo.workingDays, targetInfo.holidays)
      const targetMTD =
        targetInfo.workingDays > 0 ? (targetInfo.collectionTarget / targetInfo.workingDays) * elapsed : 0
      const actual = agg.get(name) || 0
      const pct = targetMTD > 0 ? (actual / targetMTD) * 100 : 0
      rows.push({ name, actual, target: targetMTD, percent: pct })
    }
    return rows.sort((a, b) => b.actual - a.actual)
  })()

  const branchCollectionTables = (() => {
    const proc = data.processor
    if (!proc || !Array.isArray(proc.repaymentsData)) {
      return { monthly: [], mtd: [], daily: [], cutoffDay: 0, selectedDay: 1 }
    }

    const y = selectedYear
    const m = selectedMonth
    const daysInMonth = new Date(y, m, 0).getDate()
    const day = Math.min(Math.max(1, selectedDay), daysInMonth)
    const now = new Date()
    const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1
    const isFutureMonth = y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)
    const cutoffDay = isFutureMonth ? 0 : isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth

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
      for (const lo of loanOfficers) {
        const id = String(lo.borrowerAccessId ?? '').trim()
        if (!id) continue
        const loNorm = normalizeOfficerName(lo.name)
        if (loNorm === roNorm || roNorm.includes(loNorm) || loNorm.includes(roNorm)) return id
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
          mtdCollected: 0,
          dailyCollected: 0,
        })
      } else if (branchCode && !actualMap.get(key).branchCode) {
        actualMap.get(key).branchCode = branchCode
      }
      return actualMap.get(key)
    }

    for (const repayment of proc.repaymentsData) {
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
      if (date.getDate() <= cutoffDay) row.mtdCollected += amount
      if (date.getDate() === day) row.dailyCollected += amount

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

    const mtdTarget = (targetInfo) => {
      let expected = 0
      for (let currentDay = 1; currentDay <= cutoffDay; currentDay++) {
        expected += targetForDay(targetInfo, currentDay)
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
      const mtdExpected = mtdTarget(targetInfo)
      const mtdCollected = actual?.mtdCollected || 0
      const dailyExpected = targetForDay(targetInfo, day)
      const dailyCollected = actual?.dailyCollected || 0
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
        officers: buildOfficersForBranch(key, branchCode, expected),
      }
    })

    return {
      monthly: [...rows].sort((a, b) => b.collected - a.collected),
      mtd: [...rows].sort((a, b) => b.mtdCollected - a.mtdCollected),
      daily: [...rows]
        .filter((row) => row.dailyExpected > 0 || row.dailyCollected > 0)
        .sort((a, b) => b.dailyCollected - a.dailyCollected),
      cutoffDay,
      selectedDay: day,
    }
  })()

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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
    for (const r of proc.repaymentsData) {
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
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString('en-US', { month: 'long' })}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Year</label>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
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

      {/* Branch collection breakdowns */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col gap-1 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">MTD Collection by Branch</h3>
            <p className="text-xs text-gray-500">
              Collected through day {branchCollectionTables.cutoffDay}; Expected MTD uses each branch’s MTD collection target.
            </p>
          </div>
          <span className="text-xs font-medium text-gray-500">{country || 'All countries'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Expected MTD</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Collected MTD</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Gap</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {branchCollectionTables.mtd.map((row) => (
                <tr key={row.name} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{row.name}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.mtdExpected)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.mtdCollected)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.mtdGap)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${
                    row.mtdRate == null ? 'text-gray-500' : row.mtdRate >= 100 ? 'text-green-600' : 'text-orange-600'
                  }`}>
                    {row.mtdRate == null ? '—' : `${row.mtdRate.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
              {!branchCollectionTables.mtd.length && (
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
              for (const r of proc.repaymentsData) {
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
              <h4 className="text-md font-semibold text-gray-900 mb-3">MTD Collection vs Target by Branch</h4>
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

      {/* Recent Collections */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Recent Collections</h3>
            <p className="text-xs text-gray-500 mt-1">Latest repayment activity</p>
          </div>
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
            {data.recentCollections?.length || 0} records
          </span>
        </div>

        {!data.recentCollections?.length ? (
          <p className="text-sm text-gray-500 text-center py-8">No recent collections found.</p>
        ) : (
          <div
            className="rounded-lg border border-gray-200 overflow-hidden max-h-[min(28rem,60vh)] overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]"
            style={{ scrollbarWidth: 'thin' }}
          >
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(229,231,235)]">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Loan ID</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Principal</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Interest</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fees</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Collector</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {data.recentCollections.map((repayment, index) => (
                  <tr key={repayment.repayment_id || repayment.loan_id || index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                      #{repayment.loan_id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900">
                      {formatMoney(repayment.repayment_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {formatMoney(repayment.principal_repayment_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {formatMoney(repayment.interest_repayment_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {formatMoney(repayment.fees_repayment_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {repayment.repayment_collected_date}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {repayment.collector_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default LogbookCollection

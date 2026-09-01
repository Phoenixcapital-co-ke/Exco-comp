import React, { useEffect, useMemo, useState } from 'react'
import { DollarSign, Calendar, TrendingUp, Users, Loader2, Target, Building2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts'
import { formatKES } from '../../utils/format.js'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { API_URLS } from '../../utils/api.js'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']
const MONTH_NAMES = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function BodaDisbursement() {
  const now = new Date()
  const nowYear = now.getFullYear()
  const nowMonth = now.getMonth() + 1

  const [rows, setRows] = useState([])
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedYear, setSelectedYear] = useState(nowYear)
  const [selectedMonth, setSelectedMonth] = useState(nowMonth)
  const [selectedDay, setSelectedDay] = useState(null)
  const [expandedBranch, setExpandedBranch] = useState(null)

  const cleanBranchName = (name = '') => {
    const trimmed = String(name || '').trim()
    const noSuffix = trimmed.replace(/\s*branch\s*$/i, '').trim()
    return noSuffix || trimmed
  }

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        // Use backend filtering for faster data loading
        const boda = await fetchAllZidishaRows({
          signal: controller.signal,
          product: 'Zidisha Boda',
          excludeClientIds: ['3926']
        })
        setRows(boda)
        setLoading(false)
      } catch (e) {
        if (e.name === 'AbortError') return
        setError(e.message)
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const loadTargets = async () => {
      try {
        const res = await fetch(API_URLS.targets.zidisha.list, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setTargets(Array.isArray(data) ? data : [])
        }
      } catch (e) {
        console.error('Failed to load Zidisha targets', e)
      }
    }
    loadTargets()
  }, [])

  // Derive available years and months from disbursement dates
  const dateMeta = useMemo(() => {
    const yearToMonths = new Map()
    for (const row of rows) {
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      if (!yearToMonths.has(y)) yearToMonths.set(y, new Set())
      yearToMonths.get(y).add(m)
    }
    const years = Array.from(yearToMonths.keys()).sort((a, b) => a - b)
    return { years, yearToMonths }
  }, [rows])

  const availableYears = useMemo(() => {
    const years = new Set(dateMeta.years)
    years.add(nowYear)
    return Array.from(years).sort((a, b) => a - b)
  }, [dateMeta, nowYear])

  const availableMonths = useMemo(() => {
    if (!selectedYear) return []
    const fromData = dateMeta.yearToMonths.has(selectedYear)
      ? Array.from(dateMeta.yearToMonths.get(selectedYear))
      : []
    const months = new Set(fromData)
    if (selectedYear === nowYear) {
      for (let m = 1; m <= nowMonth; m++) months.add(m)
    }
    return Array.from(months).sort((a, b) => a - b)
  }, [selectedYear, dateMeta, nowYear, nowMonth])

  // Keep year/month valid when data loads or user changes year
  useEffect(() => {
    if (!availableYears.length) return
    if (!selectedYear || !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears.includes(nowYear) ? nowYear : availableYears[availableYears.length - 1])
    }
  }, [availableYears, selectedYear, nowYear])

  useEffect(() => {
    if (!selectedYear) return
    if (!availableMonths.length) return
    let month = selectedMonth
    if (!month || !availableMonths.includes(month)) {
      if (selectedYear === nowYear && availableMonths.includes(nowMonth)) {
        month = nowMonth
      } else {
        month = availableMonths[availableMonths.length - 1]
      }
      setSelectedMonth(month)
    }
    const todayDay = now.getDate()
    const daysInMonth = new Date(selectedYear, month, 0).getDate()
    // Default or clamp day within month
    setSelectedDay((prev) => {
      const base = prev == null ? todayDay : prev
      return Math.min(base, daysInMonth)
    })
  }, [selectedYear, availableMonths, selectedMonth, nowYear, nowMonth, now])

  const monthRows = useMemo(() => {
    if (!selectedYear || !selectedMonth) return []
    return rows.filter((r) => {
      const ds = r['Disbursed On Date'] || r.disbursed_on_date
      if (!ds) return false
      const d = new Date(ds)
      if (isNaN(d.getTime())) return false
      return d.getFullYear() === selectedYear && d.getMonth() + 1 === selectedMonth
    })
  }, [rows, selectedYear, selectedMonth])

  const firstBodaDisbursementByClient = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const clientId = String(r['Client Id'] || r.client_id || '').trim()
      const ds = r['Disbursed On Date'] || r.disbursed_on_date
      if (!clientId || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const existing = map.get(clientId)
      if (!existing || d < existing) map.set(clientId, d)
    }
    return map
  }, [rows])

  const isNewBodaLoan = (row) => {
    const clientId = String(row['Client Id'] || row.client_id || '').trim()
    const ds = row['Disbursed On Date'] || row.disbursed_on_date
    if (!clientId || !ds) return false
    const d = new Date(ds)
    if (isNaN(d.getTime())) return false
    const first = firstBodaDisbursementByClient.get(clientId)
    if (!first) return false
    return (
      d.getFullYear() === first.getFullYear() &&
      d.getMonth() === first.getMonth() &&
      d.getDate() === first.getDate()
    )
  }

  const branchSummaryTable = useMemo(() => {
    const map = new Map()
    for (const r of monthRows) {
      const branchName = cleanBranchName((r['Branch Name'] || r.branch_name || 'Unknown').trim() || 'Unknown')
      const principal = Number(r['Principal Amount'] || r.principal_amount || 0) || 0
      const isNew = isNewBodaLoan(r)

      if (!map.has(branchName)) {
        map.set(branchName, {
          branch: branchName,
          totalAmount: 0,
          totalCount: 0,
          newAmount: 0,
          newCount: 0,
          repeatAmount: 0,
          repeatCount: 0,
          officers: new Map(),
        })
      }

      const entry = map.get(branchName)
      entry.totalAmount += principal
      entry.totalCount += 1
      if (isNew) {
        entry.newAmount += principal
        entry.newCount += 1
      } else {
        entry.repeatAmount += principal
        entry.repeatCount += 1
      }

      const officerName = (r['Loan Officer Name'] || r.loan_officer_name || 'Unknown').trim() || 'Unknown'
      if (!entry.officers.has(officerName)) {
        entry.officers.set(officerName, {
          officer: officerName,
          totalAmount: 0,
          totalCount: 0,
          newAmount: 0,
          newCount: 0,
          repeatAmount: 0,
          repeatCount: 0,
        })
      }
      const officerEntry = entry.officers.get(officerName)
      officerEntry.totalAmount += principal
      officerEntry.totalCount += 1
      if (isNew) {
        officerEntry.newAmount += principal
        officerEntry.newCount += 1
      } else {
        officerEntry.repeatAmount += principal
        officerEntry.repeatCount += 1
      }
    }
    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        officers: Array.from(entry.officers.values()).sort((a, b) => b.totalAmount - a.totalAmount),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
  }, [monthRows, firstBodaDisbursementByClient])

  const metrics = useMemo(() => {
    if (!rows.length) {
      return {
        weekTotal: 0,
        weekChangePct: 0,
        monthTotal: 0,
        monthChangePct: 0,
        loansTotal: 0,
        loansChangePct: 0,
        avgLoan: 0,
        avgLoanChangePct: 0,
        todayTotal: 0,
        todayChangePct: 0,
      }
    }

    const todayYear = now.getFullYear()
    const todayMonth = now.getMonth() + 1
    const todayDay = now.getDate()

    // Month context: follow selected filters if present, otherwise fall back to "now"
    const baseYear = selectedYear || todayYear
    const baseMonth = selectedMonth || todayMonth

    // Day boundaries
    const startOfToday = new Date(todayYear, todayMonth - 1, todayDay)
    const startOfTomorrow = new Date(todayYear, todayMonth - 1, todayDay + 1)
    const startOfYesterday = new Date(todayYear, todayMonth - 1, todayDay - 1)

    // Week boundaries (Monday–Sunday)
    const startOfThisWeek = new Date(startOfToday)
    const dayOfWeek = startOfThisWeek.getDay() // 0 (Sun) - 6 (Sat)
    const diffToMonday = (dayOfWeek + 6) % 7
    startOfThisWeek.setDate(startOfThisWeek.getDate() - diffToMonday)
    const startOfPrevWeek = new Date(startOfThisWeek)
    startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7)
    const endOfThisWeek = new Date(startOfThisWeek)
    endOfThisWeek.setDate(endOfThisWeek.getDate() + 7)
    const endOfPrevWeek = new Date(startOfThisWeek)

    // Month boundaries (for base month vs previous month, based on selected filters)
    const prevMonth =
      baseMonth === 1 ? 12 : baseMonth - 1
    const prevMonthYear =
      baseMonth === 1 ? baseYear - 1 : baseYear

    let weekTotal = 0
    let prevWeekTotal = 0
    let monthTotal = 0
    let prevMonthTotal = 0
    let loansTotal = 0
    let prevMonthLoans = 0
    let todayTotal = 0
    let yesterdayTotal = 0

    const tsStartOfToday = startOfToday.getTime()
    const tsStartOfTomorrow = startOfTomorrow.getTime()
    const tsStartOfYesterday = startOfYesterday.getTime()
    const tsStartOfThisWeek = startOfThisWeek.getTime()
    const tsEndOfThisWeek = endOfThisWeek.getTime()
    const tsStartOfPrevWeek = startOfPrevWeek.getTime()
    const tsEndOfPrevWeek = endOfPrevWeek.getTime()

    for (const row of rows) {
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      const t = d.getTime()

      // Weekly totals
      if (t >= tsStartOfThisWeek && t < tsEndOfThisWeek) {
        weekTotal += amt
      } else if (t >= tsStartOfPrevWeek && t < tsEndOfPrevWeek) {
        prevWeekTotal += amt
      }

      // Monthly totals and loan counts (respect selected year/month)
      if (y === baseYear && m === baseMonth) {
        monthTotal += amt
        loansTotal += 1
      } else if (y === prevMonthYear && m === prevMonth) {
        prevMonthTotal += amt
        prevMonthLoans += 1
      }

      // Daily totals
      if (t >= tsStartOfToday && t < tsStartOfTomorrow) {
        todayTotal += amt
      } else if (t >= tsStartOfYesterday && t < tsStartOfToday) {
        yesterdayTotal += amt
        }
      }

    const avgLoan = loansTotal > 0 ? monthTotal / loansTotal : 0
    const avgPrevLoan = prevMonthLoans > 0 ? prevMonthTotal / prevMonthLoans : 0

    const pctChange = (current, previous) => {
      if (!previous || !Number.isFinite(previous)) return 0
      return ((current - previous) / previous) * 100
    }

    return {
      weekTotal,
      weekChangePct: pctChange(weekTotal, prevWeekTotal),
      monthTotal,
      monthChangePct: pctChange(monthTotal, prevMonthTotal),
      loansTotal,
      loansChangePct: pctChange(loansTotal, prevMonthLoans),
      avgLoan,
      avgLoanChangePct: pctChange(avgLoan, avgPrevLoan),
      todayTotal,
      todayChangePct: pctChange(todayTotal, yesterdayTotal),
    }
  }, [rows, now])

  // Branch disbursement totals for selected month
  const branchMetrics = useMemo(() => {
    if (!rows.length || !selectedYear || !selectedMonth) return []
    
    const branchMap = new Map()
    
    for (const row of rows) {
      const branchName = (row['Branch Name'] || row.branch_name || 'Unknown').trim()
      if (!branchName || branchName === 'Unknown') continue
      
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      
      // Filter by selected month
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() !== selectedYear || d.getMonth() + 1 !== selectedMonth) continue
      
      if (!branchMap.has(branchName)) {
        branchMap.set(branchName, 0)
      }
      branchMap.set(branchName, branchMap.get(branchName) + amt)
    }
    
    // Convert to array and sort by amount descending
    return Array.from(branchMap.entries())
      .map(([branch, total]) => ({ branch, total }))
      .sort((a, b) => b.total - a.total)
  }, [rows, selectedYear, selectedMonth])

  // Targets for selected month/year (Zidisha_Targets - used for Boda as well)
  const selectedTargets = useMemo(() => {
    return targets.filter(
      (t) => Number(t.month) === selectedMonth && Number(t.year) === selectedYear && t.active
    )
  }, [targets, selectedMonth, selectedYear])

  const targetMap = useMemo(() => {
    const map = new Map()
    selectedTargets.forEach((t) => {
      const key = cleanBranchName(t.branch || '')
      if (key) map.set(key, { ...t, branch: key })
    })
    return map
  }, [selectedTargets])

  // Branches that have "Zidisha Boda" product (appear in rows)
  const bodaBranches = useMemo(() => {
    const set = new Set()
    for (const row of rows) {
      const branchName = cleanBranchName((row['Branch Name'] || row.branch_name || '').trim())
      if (branchName && branchName !== 'Unknown') set.add(branchName)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [rows])

  // Disbursement vs Target by Branch (selected month) – only branches that have Zidisha Boda product
  const disbursementVsTargetByBranch = useMemo(() => {
    if (!selectedYear || !selectedMonth || !bodaBranches.length) return []
    const branchActual = new Map()
    for (const row of rows) {
      const branchName = cleanBranchName((row['Branch Name'] || row.branch_name || 'Unknown').trim() || 'Unknown')
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() !== selectedYear || d.getMonth() + 1 !== selectedMonth) continue
      branchActual.set(branchName, (branchActual.get(branchName) || 0) + amt)
    }
    const results = []
    for (const branch of bodaBranches) {
      const actual = branchActual.get(branch) || 0
      const targetRow = targetMap.get(branch)
      const target = targetRow ? Number(targetRow.disbursementTarget) || 0 : 0
      const percentage = target > 0 ? (actual / target) * 100 : 0
      results.push({ branch, actual, target, percentage })
    }
    return results.sort((a, b) => Math.max(b.actual, b.target) - Math.max(a.actual, a.target))
  }, [rows, selectedYear, selectedMonth, bodaBranches, targetMap])

  const branchTargetTableRows = useMemo(() => {
    if (!selectedYear || !selectedMonth) return []

    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate()
    const countSundaysInMonth = (year, month) => {
      // month is 1-12
      let sundays = 0
      for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) {
        const dow = new Date(year, month - 1, d).getDay() // 0 = Sunday
        if (dow === 0) sundays += 1
      }
      return sundays
    }

    const workingDays = Math.max(1, daysInMonth - countSundaysInMonth(selectedYear, selectedMonth))

    const today = new Date()
    const isCurrentMonth = selectedYear === today.getFullYear() && selectedMonth === today.getMonth() + 1
    const mtdCalendarDays = isCurrentMonth ? Math.min(today.getDate(), daysInMonth) : daysInMonth
    const countWorkingDaysUpTo = (year, month, dayInclusive) => {
      const daysIn = new Date(year, month, 0).getDate()
      const end = Math.min(Math.max(Number(dayInclusive) || 0, 0), daysIn)
      let work = 0
      for (let d = 1; d <= end; d++) {
        const dow = new Date(year, month - 1, d).getDay()
        if (dow !== 0) work += 1
      }
      return work
    }
    const mtdWorkingDays = isCurrentMonth ? countWorkingDaysUpTo(selectedYear, selectedMonth, mtdCalendarDays) : workingDays

    const branchMonthActual = new Map()
    const branchMtdActual = new Map()
    for (const row of rows) {
      const branchName = cleanBranchName((row['Branch Name'] || row.branch_name || '').trim())
      if (!branchName) continue
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() !== selectedYear || d.getMonth() + 1 !== selectedMonth) continue

      branchMonthActual.set(branchName, (branchMonthActual.get(branchName) || 0) + amt)
      if (d.getDate() <= mtdCalendarDays) {
        branchMtdActual.set(branchName, (branchMtdActual.get(branchName) || 0) + amt)
      }
    }

    const out = []
    for (const branch of bodaBranches) {
      const targetRow = targetMap.get(branch)
      const eomTarget = targetRow ? Number(targetRow.disbursementTarget) || 0 : 0
      const disbursement = branchMonthActual.get(branch) || 0
      const eomPct = eomTarget > 0 ? (disbursement / eomTarget) * 100 : 0
      const dailyTarget = eomTarget > 0 ? eomTarget / workingDays : 0
      const mtdTarget = dailyTarget * mtdWorkingDays
      const mtdActual = branchMtdActual.get(branch) || 0
      const mtdPct = mtdTarget > 0 ? (mtdActual / mtdTarget) * 100 : 0

      out.push({
        branch,
        eomTarget,
        disbursement,
        eomPct,
        mtdTarget,
        mtdPct,
      })
    }

    return out.sort((a, b) => b.disbursement - a.disbursement)
  }, [rows, selectedYear, selectedMonth, bodaBranches, targetMap])

  const dailyTrend = useMemo(() => {
    if (!selectedYear || !selectedMonth) return []

    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate()
    const map = new Array(daysInMonth + 1).fill(0)
    for (const row of rows) {
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() === selectedYear && d.getMonth() + 1 === selectedMonth) {
        const day = d.getDate()
        map[day] += amt
      }
    }
    return Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      amount: map[i + 1] || 0,
    }))
  }, [rows, selectedMonth, selectedYear])

  const officerPerformance = useMemo(() => {
    const perf = new Map()
    for (const row of rows) {
      const officer = (row['Loan Officer Name'] || row.loan_officer_name || 'Unknown').trim() || 'Unknown'
      const amt = Number(row['Principal Amount']) || 0
      if (!amt) continue
      if (!perf.has(officer)) perf.set(officer, { name: officer, amount: 0, count: 0 })
      const current = perf.get(officer)
      current.amount += amt
      current.count += 1
    }
    return Array.from(perf.values()).sort((a, b) => b.amount - a.amount).slice(0, 8)
  }, [rows])

  const topLoans = useMemo(() => {
    return rows
      .map((row, index) => ({
        id: index,
        client: row['Client Name'] || row.client_name || 'Unknown',
        amount: Number(row['Principal Amount']) || 0,
        date: row['Disbursed On Date'] || row.disbursed_on_date || '',
        product: row['Product Name'] || row.product_name || 'Unknown',
        officer: row['Loan Officer Name'] || row.loan_officer_name || 'Unknown',
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
  }, [rows])

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  const formatChange = (value) => {
    if (!Number.isFinite(value)) return '0.0%'
    const fixed = value.toFixed(1)
    if (value > 0) return `+${fixed}%`
    if (value < 0) return `${fixed}%`
    return '0.0%'
  }

  const monthLabel =
    selectedYear && selectedMonth
      ? new Date(selectedYear, selectedMonth - 1, 1).toLocaleString('en-US', { month: 'long' })
      : ''

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Boda Disbursement</h1>
          <p className="text-gray-600 mt-2">Track and manage Boda loan disbursements with real data</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-4 lg:ml-auto">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Year</p>
            <select
              value={selectedYear || ''}
              onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            >
              {availableYears.length === 0 && <option value="">No data</option>}
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Month</p>
            <select
              value={selectedMonth || ''}
              onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block w-40 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
            >
              {(!availableMonths || availableMonths.length === 0) && <option value="">No months</option>}
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {MONTH_NAMES[m]} ({m})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        {loading ? (
          Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded animate-pulse mb-3 w-32"></div>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 w-28"></div>
                </div>
                <div className="p-3 rounded-lg bg-gray-100">
                  <div className="w-6 h-6 bg-gray-200 rounded animate-pulse"></div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Disbursed This Week</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(metrics.weekTotal)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatChange(metrics.weekChangePct)}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 text-green-600">
                  <DollarSign size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Total {MONTH_NAMES[selectedMonth] || ''} Disbursed
                  </p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(metrics.monthTotal)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatChange(metrics.monthChangePct)}</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                  <Calendar size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Loans</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{metrics.loansTotal.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatChange(metrics.loansChangePct)}</p>
                </div>
                <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
                  <TrendingUp size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Average Loan</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(metrics.avgLoan)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatChange(metrics.avgLoanChangePct)}</p>
                </div>
                <div className="p-3 rounded-lg bg-rose-50 text-rose-600">
                  <Users size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Disbursed Today</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(metrics.todayTotal)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatChange(metrics.todayChangePct)}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 text-green-600">
                  <DollarSign size={24} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Branch Disbursement Cards — continuous marquee */}
      {!loading && branchMetrics.length > 0 && selectedYear && selectedMonth && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Branch Disbursements ({selectedMonth && selectedYear ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}` : '—'})
          </h3>
          <div className="overflow-hidden">
            <div
              className="branch-marquee-track flex w-max gap-4"
              style={{ animationDuration: `${Math.max(24, branchMetrics.length * 5)}s` }}
            >
              {[...branchMetrics, ...branchMetrics].map(({ branch, total }, i) => (
                <div
                  key={`${branch}-${i}`}
                  className="w-64 flex-shrink-0 rounded-lg border border-gray-200 p-4 bg-gradient-to-br from-white to-gray-50"
                >
                  <div className="text-sm text-gray-600">{branch}</div>
                  <div className="text-xl font-semibold text-gray-900 mt-1">{formatKES(total)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="h-4 bg-gray-200 rounded animate-pulse mb-4 w-56"></div>
              <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
                <Loader2 className="animate-spin text-gray-400" size={24} />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="h-4 bg-gray-200 rounded animate-pulse mb-4 w-48"></div>
              <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
                <Loader2 className="animate-spin text-gray-400" size={24} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Branch Targets ({selectedMonth && selectedYear ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}` : '—'})
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-600">Branch</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600">EOM Target</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600">Disbursement</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600">EOM %</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600">MTD Target</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600">MTD %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {branchTargetTableRows.map((r) => (
                      <tr key={r.branch} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900">{r.branch}</td>
                        <td className="px-4 py-2 text-right text-gray-900">{formatKES(r.eomTarget)}</td>
                        <td className="px-4 py-2 text-right text-gray-900">{formatKES(r.disbursement)}</td>
                        <td className="px-4 py-2 text-right text-gray-900">{Number(r.eomPct || 0).toFixed(1)}%</td>
                        <td className="px-4 py-2 text-right text-gray-900">{formatKES(r.mtdTarget)}</td>
                        <td className="px-4 py-2 text-right text-gray-900">{Number(r.mtdPct || 0).toFixed(1)}%</td>
                      </tr>
                    ))}
                    {!branchTargetTableRows.length && (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                          No branch target data for this month.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Daily Disbursements ({selectedMonth && selectedYear ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}` : '—'})
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(1)}K`} />
                  <Tooltip formatter={(v) => formatKES(v)} />
                  <Area type="monotone" dataKey="amount" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Disbursed" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* Disbursement vs Target | Daily Branch Breakdown | Loan Officer Performance – same row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Disbursement vs Target by Branch (selected month) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="text-orange-600" size={20} />
            <h3 className="text-lg font-semibold text-gray-900">
              Disbursement vs Target by Branch ({selectedYear && selectedMonth ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}` : '—'})
            </h3>
          </div>
          {!loading && selectedYear && selectedMonth && disbursementVsTargetByBranch.length > 0 ? (
            <ResponsiveContainer width="100%" height={360}>
              <BarChart
                data={disbursementVsTargetByBranch.map((item) => ({
                  branch: item.branch.length > 14 ? item.branch.substring(0, 14) + '…' : item.branch,
                  fullBranch: item.branch,
                  actual: item.actual,
                  target: item.target > 0 ? item.target : 0,
                  percentage: item.percentage,
                }))}
                margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="branch"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'actual') return [formatKES(value), 'Actual Disbursement']
                    if (name === 'target') return [formatKES(value), 'Target']
                    return [value, name]
                  }}
                  labelFormatter={(_, payload) => {
                    const p = Array.isArray(payload) ? payload[0] : payload
                    return p?.payload?.fullBranch ?? _
                  }}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '8px 12px',
                  }}
                />
                <Legend />
                <Bar dataKey="actual" name="Actual Disbursement" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="target" name="Target" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[360px] flex items-center justify-center text-gray-500 text-sm">
              {!selectedYear || !selectedMonth ? 'Select year and month.' : 'No Boda branch data for this month.'}
            </div>
          )}
        </div>

        {/* Daily Branch Breakdown */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Branch Breakdown</h3>
          {selectedYear && selectedMonth ? (
            (() => {
              const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
              const fallbackDay = Math.min(new Date().getDate(), daysIn)
              const day = Math.min(selectedDay || fallbackDay, daysIn)
              const agg = new Map()
              for (const r of monthRows) {
                const ds = r['Disbursed On Date'] || r.disbursed_on_date
                if (!ds) continue
                const d = new Date(ds)
                if (isNaN(d.getTime())) continue
                if (d.getDate() !== day) continue
                const b = (r['Branch Name'] || r.branch_name || 'Unknown').trim() || 'Unknown'
                const amt = Number(r['Principal Amount']) || 0
                if (!agg.has(b)) agg.set(b, 0)
                agg.set(b, agg.get(b) + amt)
              }
              const rowsTbl = Array.from(agg.entries())
                .map(([branch, amount]) => ({ branch, amount }))
                .sort((a, b) => b.amount - a.amount)
              return (
                <>
                  <div className="flex items-center space-x-2 mb-3">
                    <label className="text-xs text-gray-600">Day</label>
                    <select
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                      value={day}
                      onChange={(e) => setSelectedDay(Number(e.target.value))}
                    >
                      {Array.from({ length: daysIn }, (_, i) => i + 1).map((dv) => (
                        <option key={dv} value={dv}>
                          {dv}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600">Branch</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600">Total Disbursement</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {rowsTbl.map((r) => (
                          <tr key={r.branch} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">{r.branch}</td>
                            <td className="px-4 py-2 text-right text-gray-900">{formatKES(r.amount)}</td>
                          </tr>
                        ))}
                        {!rowsTbl.length && (
                          <tr>
                            <td className="px-4 py-6 text-center text-gray-500" colSpan={2}>
                              No disbursements for selected day.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            })()
          ) : (
            <div className="h-64 flex items-center text-gray-500 text-sm">Select a year and month to view breakdown.</div>
          )}
        </div>

        {/* Loan Officer Performance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Loan Officer Performance ({selectedYear ?? '—'})
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={officerPerformance} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
              <YAxis type="category" dataKey="name" />
              <Tooltip formatter={(v, name) => (name === 'amount' ? formatKES(v) : `${v} loans`)} />
              <Legend />
              <Bar dataKey="amount" name="Disbursed" fill="#6366f1" radius={[0, 6, 6, 0]} />
              <Bar dataKey="count" name="Loans" fill="#f59e0b" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Branch Summary Table */}
      {!loading && selectedYear && selectedMonth && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-5 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-gray-200">
            <h3 className="text-xl font-bold text-gray-900">
              Branch Summary ({monthLabel} {selectedYear})
            </h3>
            <p className="text-sm text-gray-600 mt-1">Click on a branch to view loan officer details</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-300">
                  <th
                    rowSpan={2}
                    className="px-3 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider align-bottom border-r border-gray-300 whitespace-normal break-words w-40"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-indigo-600" />
                      <span>Branch</span>
                    </div>
                  </th>
                  <th
                    colSpan={3}
                    className="px-3 py-3 text-center align-middle text-xs font-bold text-gray-700 uppercase tracking-wider bg-green-50 border-r border-gray-300"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span>New (First Boda Loan)</span>
                    </div>
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-3 text-center align-middle text-xs font-bold text-gray-700 uppercase tracking-wider bg-amber-50"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Repeat</span>
                    </div>
                  </th>
                  <th
                    colSpan={4}
                    className="px-3 py-3 text-center align-middle text-xs font-bold text-gray-700 uppercase tracking-wider bg-blue-50 border-l border-gray-300"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <TrendingUp size={14} className="text-blue-600" />
                      <span>Total</span>
                    </div>
                  </th>
                </tr>
                <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-300">
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-green-50 border-r border-gray-300">
                    Amount
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-green-50 border-r border-gray-300">
                    Loans
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-green-50 border-r border-gray-300">
                    New Target
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-amber-50 border-r border-gray-300">
                    Amount
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-amber-50">
                    Loans
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-l border-gray-300">
                    Amount
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-r border-gray-300">
                    Loans
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-r border-gray-300">
                    Target
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-r border-gray-300">
                    %
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {branchSummaryTable.map((row, idx) => {
                  const targetInfo = targetMap.get(row.branch)
                  const targetAmount = targetInfo ? Number(targetInfo.disbursementTarget) || 0 : 0
                  const percentage = targetAmount > 0 ? (row.totalAmount / targetAmount) * 100 : 0
                  return (
                    <React.Fragment key={row.branch}>
                      <tr
                        className={`transition-all duration-200 ${expandedBranch === row.branch ? 'bg-indigo-50' : 'hover:bg-gray-50'} ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                      >
                        <td className="px-3 py-3 whitespace-normal break-words">
                          <button
                            type="button"
                            onClick={() => setExpandedBranch(expandedBranch === row.branch ? null : row.branch)}
                            className="inline-flex items-center gap-2 text-left font-semibold text-gray-900 hover:text-indigo-600 focus:outline-none transition-colors group"
                          >
                            <div
                              className={`transition-transform duration-200 ${expandedBranch === row.branch ? 'rotate-90' : ''}`}
                            >
                              {expandedBranch === row.branch ? (
                                <ChevronDown size={18} className="text-indigo-600" />
                              ) : (
                                <ChevronRight size={18} className="text-gray-400 group-hover:text-indigo-600" />
                              )}
                            </div>
                            <span className="font-semibold">{row.branch}</span>
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-green-700 text-right">
                          {formatKES(row.newAmount)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-green-600 text-right">
                          {row.newCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-gray-700 text-right">
                          {targetInfo?.newClientsAmountPerMonth ? (
                            formatKES(targetInfo.newClientsAmountPerMonth)
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-amber-700 text-right">
                          {formatKES(row.repeatAmount)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-amber-600 text-right">
                          {row.repeatCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-gray-900 text-right">
                          {formatKES(row.totalAmount)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-gray-700 text-right">
                          {row.totalCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 text-right">
                          {targetAmount > 0 ? formatKES(targetAmount) : <span className="text-gray-400">-</span>}
                        </td>
                        <td
                          className={`px-3 py-3 whitespace-nowrap text-sm font-semibold text-right ${percentage >= 100 ? 'text-green-700' : percentage >= 80 ? 'text-yellow-700' : 'text-red-700'}`}
                        >
                          {targetAmount > 0 ? `${percentage.toFixed(1)}%` : <span className="text-gray-400">-</span>}
                        </td>
                      </tr>
                      {expandedBranch === row.branch && (
                        <tr className="bg-indigo-50/50">
                          <td colSpan={10} className="px-6 pb-6 pt-4">
                            <div className="bg-white rounded-lg shadow-md border-2 border-indigo-200 overflow-hidden">
                              <div className="px-4 py-3 bg-gradient-to-r from-indigo-100 to-blue-100 border-b border-indigo-200">
                                <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                                  <Building2 size={16} />
                                  Loan Officers - {row.branch}
                                </h4>
                              </div>
                              {row.officers.length ? (
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-5 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300">
                                          Loan Officer
                                        </th>
                                        <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-blue-50">
                                          Total Amount
                                        </th>
                                        <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-blue-50">
                                          Total Loans
                                        </th>
                                        <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-green-50">
                                          New Amount
                                        </th>
                                        <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-green-50">
                                          New Loans
                                        </th>
                                        <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-amber-50">
                                          Repeat Amount
                                        </th>
                                        <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider bg-amber-50">
                                          Repeat Loans
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-100">
                                      {row.officers.map((officer, oIdx) => (
                                        <tr
                                          key={officer.officer}
                                          className={`hover:bg-indigo-50/50 transition-colors ${oIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                        >
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 border-r border-gray-200">
                                            {officer.officer}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-bold text-gray-900 text-right border-r border-gray-200 bg-blue-50/30">
                                            {formatKES(officer.totalAmount)}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-semibold text-gray-700 text-right border-r border-gray-200 bg-blue-50/30">
                                            {officer.totalCount.toLocaleString()}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-bold text-green-700 text-right border-r border-gray-200 bg-green-50/30">
                                            {formatKES(officer.newAmount)}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-semibold text-green-600 text-right border-r border-gray-200 bg-green-50/30">
                                            {officer.newCount.toLocaleString()}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-bold text-amber-700 text-right border-r border-gray-200 bg-amber-50/30">
                                            {formatKES(officer.repeatAmount)}
                                          </td>
                                          <td className="px-5 py-3 whitespace-nowrap text-sm font-semibold text-amber-600 text-right bg-amber-50/30">
                                            {officer.repeatCount.toLocaleString()}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="px-5 py-8 text-center">
                                  <p className="text-sm text-gray-500">No loan officer data available for this branch.</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {!branchSummaryTable.length && (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                          <Building2 size={24} className="text-gray-400" />
                        </div>
                        <p className="text-gray-500 text-sm font-medium">No branch summary available for the selected period.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Loans Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Top Disbursements</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Client
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Loan Officer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Disbursed On
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {topLoans.map((loan) => (
                <tr key={loan.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{loan.client}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatKES(loan.amount)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{loan.product}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{loan.officer}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{loan.date}</td>
                </tr>
              ))}
              {!topLoans.length && (
                <tr>
                  <td className="px-6 py-6 text-center text-gray-500" colSpan={5}>
                    No disbursement records available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default BodaDisbursement


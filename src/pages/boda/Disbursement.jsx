import React, { useEffect, useMemo, useState } from 'react'
import { DollarSign, Calendar, TrendingUp, Users, Loader2 } from 'lucide-react'
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

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']
const MONTH_NAMES = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function BodaDisbursement() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedYear, setSelectedYear] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)

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

  const now = new Date()

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

  const availableYears = dateMeta.years

  const availableMonths = useMemo(() => {
    if (!selectedYear || !dateMeta.yearToMonths.has(selectedYear)) return []
    return Array.from(dateMeta.yearToMonths.get(selectedYear)).sort((a, b) => a - b)
  }, [selectedYear, dateMeta])

  // Initialize / keep selected year & month aligned with data
  useEffect(() => {
    if (!rows.length) return

    // Use the latest disbursement date as default year/month
    let latest = null
    for (const row of rows) {
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (!latest || d > latest) latest = d
    }
    if (!latest) return

    const y = latest.getFullYear()
    const m = latest.getMonth() + 1

    setSelectedYear((prev) => prev ?? y)
    setSelectedMonth((prev) => prev ?? m)
    // Default day to "today" within that month (clamped to month length)
    const today = new Date()
    const todayDay = today.getDate()
    const daysInMonth = new Date(y, m, 0).getDate()
    setSelectedDay((prev) => prev ?? Math.min(todayDay, daysInMonth))
  }, [rows])

  // When year changes, ensure month is valid for that year
  useEffect(() => {
    if (!selectedYear) return
    if (!availableMonths.length) return
    let month = selectedMonth
    if (!month || !availableMonths.includes(month)) {
      month = availableMonths[availableMonths.length - 1]
      setSelectedMonth(month)
    }
    const today = new Date()
    const todayDay = today.getDate()
    const daysInMonth = new Date(selectedYear, month, 0).getDate()
    // Default or clamp day within month
    setSelectedDay((prev) => {
      const base = prev == null ? todayDay : prev
      return Math.min(base, daysInMonth)
    })
  }, [selectedYear, availableMonths, selectedMonth])

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

    // Month boundaries (current vs previous month)
    const prevMonthYear = todayMonth === 1 ? todayYear - 1 : todayYear
    const prevMonth = todayMonth === 1 ? 12 : todayMonth - 1

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

      // Monthly totals and loan counts
      if (y === todayYear && m === todayMonth) {
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

  const monthlyTrend = useMemo(() => {
    // Base the 12-month window around the selected year/month, falling back to "now"
    const baseYear = selectedYear || now.getFullYear()
    const baseMonth = selectedMonth || now.getMonth() + 1

    const points = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(baseYear, baseMonth - 1 - i, 1)
      points.push({ y: d.getFullYear(), m: d.getMonth() + 1 })
    }
    const map = new Map(points.map(({ y, m }) => [`${y}-${m}`, 0]))
    for (const row of rows) {
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`
      if (map.has(key)) map.set(key, map.get(key) + amt)
    }
    return points.map(({ y, m }) => ({
      month: `${MONTH_NAMES[m]} ${String(y).slice(-2)}`,
      amount: map.get(`${y}-${m}`) || 0,
    }))
  }, [rows, now, selectedYear, selectedMonth])

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
                    Total {MONTH_NAMES[now.getMonth() + 1] || ''} Disbursed
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

      {/* Branch Disbursement Cards */}
      {!loading && branchMetrics.length > 0 && selectedYear && selectedMonth && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Branch Disbursements ({selectedMonth && selectedYear ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}` : '—'})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branchMetrics.map(({ branch, total }) => (
              <div key={branch} className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-600 mb-1">{branch}</p>
                <p className="text-xl font-bold text-gray-900">{formatKES(total)}</p>
              </div>
            ))}
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
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Disbursement Trend (Last 12 Months)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(v) => formatKES(v)} />
                  <Area type="monotone" dataKey="amount" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name="Disbursed" />
                </AreaChart>
              </ResponsiveContainer>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <div className="h-24 flex items-center text-gray-500">Select a year and month to view breakdown.</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Loan Officer Performance ({selectedYear || '—'})
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


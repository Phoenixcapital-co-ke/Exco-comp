import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  DollarSign,
  TrendingUp,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  PieChart as PieChartIcon,
  ShieldAlert,
  Target,
  Clock,
  Activity
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart as RBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  LineChart,
  Line
} from 'recharts'
import { formatKES } from '../../utils/format.js'
import { API_URLS } from '../../utils/api.js'
import { normalizeZidishaResponse } from '../../utils/normalizeZidishaResponse.js'

function ZidishaDashboard() {
  const PAGE_SIZE = 3000
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState(null)

  const filterRows = (data) =>
    data.filter((r) => (r['Branch Name'] || r.branch_name || '').trim().toLowerCase() !== 'advans branch')

  const loadPage = async (targetPage = 1) => {
    if (targetPage === 1) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
      })
      const res = await fetch(`${API_URLS.zidisha.data}?${params.toString()}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load data (${res.status})`)
      const payload = await res.json()
      const pageRows = normalizeZidishaResponse(payload)
      const filtered = filterRows(pageRows)

      setRows((prev) => (targetPage === 1 ? filtered : [...prev, ...filtered]))
      setMeta(payload.meta || null)
      setPage(targetPage)
    } catch (e) {
      setError(e.message)
    } finally {
      if (targetPage === 1) {
        setLoading(false)
      } else {
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    loadPage(1)
  }, [])

  const canLoadMore = meta && rows.length < (meta.total || rows.length)
  const handleLoadMore = () => {
    if (meta) {
      loadPage(page + 1)
    }
  }
  // Compute Active Loans: Expected Matured On Date is today or in the future
  const today = new Date()
  const isActive = (row) => {
    const s = row['Expected Matured On Date'] || row.expected_matured_on_date || ''
    if (!s) return false
    const d = new Date(s)
    if (isNaN(d.getTime())) return false
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const tt = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return dt >= tt
  }
  const activeLoans = useMemo(() => rows.filter(isActive).length, [rows])

  // Active borrowers
  const activeBorrowers = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      const id = r['Client Id'] || r.client_id
      if (id) set.add(id)
    }
    return set.size
  }, [rows])

  const totals = useMemo(() => {
    let totalPrincipal = 0
    let totalCollected = 0
    let totalExpected = 0
    let totalOutstanding = 0
    for (const r of rows) {
      totalPrincipal += Number(r['Principal Amount']) || 0
      totalCollected += Number(r['Total Repayment Derived']) || 0
      totalExpected += Number(r['Total Expected Repayment Derived']) || 0
      totalOutstanding += Number(r['Total Outstanding Derived']) || 0
    }
    const repaymentRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0
    return { totalPrincipal, totalCollected, totalExpected, repaymentRate, totalOutstanding }
  }, [rows])

  const monthlySeries = useMemo(() => {
    const monthlyDisbSums = new Map()
    const monthlyCollSums = new Map()
    for (const r of rows) {
      const ds = r['Disbursed On Date'] || r.disbursed_on_date || ''
      if (!ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthlyDisbSums.set(key, (monthlyDisbSums.get(key) || 0) + (Number(r['Principal Amount']) || 0))
      monthlyCollSums.set(key, (monthlyCollSums.get(key) || 0) + (Number(r['Total Repayment Derived']) || 0))
    }
    return { monthlyDisbSums, monthlyCollSums }
  }, [rows])

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`

  const disbursed30Days = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    let sum = 0
    for (const r of rows) {
      const ds = r['Disbursed On Date'] || r.disbursed_on_date || ''
      if (!ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d >= cutoff) sum += Number(r['Principal Amount']) || 0
    }
    return sum
  }, [rows])

  const { monthlyDisbSums, monthlyCollSums } = monthlySeries
  const avgMonthlyDisb = useMemo(() => {
    if (!monthlyDisbSums.size) return 0
    return Array.from(monthlyDisbSums.values()).reduce((a, b) => a + b, 0) / monthlyDisbSums.size
  }, [monthlyDisbSums])
  const avgMonthlyCollection = useMemo(() => {
    if (!monthlyCollSums.size) return 0
    return Array.from(monthlyCollSums.values()).reduce((a, b) => a + b, 0) / monthlyCollSums.size
  }, [monthlyCollSums])

  const currentMonthDisb = monthlyDisbSums.get(currentMonthKey) || 0
  const prevMonthDisb = monthlyDisbSums.get(prevMonthKey) || 0
  const disbMonthChange = prevMonthDisb > 0 ? ((currentMonthDisb - prevMonthDisb) / prevMonthDisb) * 100 : 0

  const avgLoanSize = rows.length > 0 ? totals.totalPrincipal / rows.length : 0

  const portfolioSeries = useMemo(() => {
    const months = [null, 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const keys = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push({ y: d.getFullYear(), m: d.getMonth() + 1 })
    }
    return keys.map(({ y, m }) => {
      const key = `${y}-${String(m).padStart(2, '0')}`
      const collected = monthlyCollSums.get(key) || 0
      const disbursed = monthlyDisbSums.get(key) || 0
      const expected = collected // placeholder for stacked area
      const rate = expected > 0 ? (collected / expected) * 100 : 0
      return {
        month: `${months[m]} ${String(y).slice(-2)}`,
        disbursed,
        collected,
        rate: totals.totalExpected > 0 ? (collected / totals.totalExpected) * 100 : 0
      }
    })
  }, [monthlyCollSums, monthlyDisbSums, now, totals.totalExpected])

  const branchPerformance = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const branch = (r['Branch Name'] || r.branch_name || 'Unknown').trim()
      if (!branch) continue
      if (!map.has(branch)) map.set(branch, { disbursed: 0, collected: 0, expected: 0 })
      const entry = map.get(branch)
      entry.disbursed += Number(r['Principal Amount']) || 0
      entry.collected += Number(r['Total Repayment Derived']) || 0
      entry.expected += Number(r['Total Expected Repayment Derived']) || 0
    }
    return Array.from(map.entries())
      .map(([branch, v]) => ({
        branch,
        disbursed: v.disbursed,
        collected: v.collected,
        rate: v.expected > 0 ? (v.collected / v.expected) * 100 : 0
      }))
      .sort((a, b) => b.disbursed - a.disbursed)
  }, [rows])

  const avgLoanSizeData = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const product = (r['Product Name'] || r.product_name || 'Unknown').trim()
      const amount = Number(r['Principal Amount']) || 0
      map.set(product, (map.get(product) || 0) + amount)
    }
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1
    return Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        value,
        percent: (value / total) * 100
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [rows])

  const collectionsRisk = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const buckets = {
      'On-time': 0,
      '1-13 days overdue': 0,
      '14-30 days overdue': 0,
      '31+ days overdue': 0
    }
    for (const r of rows) {
      const expected = Number(r['Total Expected Repayment Derived']) || 0
      const repaid = Number(r['Total Repayment Derived']) || 0
      if (repaid >= expected * 0.99) {
        buckets['On-time'] += 1
        continue
      }
      const expDate = r['Expected Matured On Date'] || r.expected_matured_on_date
      if (!expDate) continue
      const d = new Date(expDate)
      d.setHours(0, 0, 0, 0)
      const diff = Math.floor((today - d) / (1000 * 60 * 60 * 24))
      if (diff <= 0) {
        buckets['On-time'] += 1
      } else if (diff <= 13) {
        buckets['1-13 days overdue'] += 1
      } else if (diff <= 30) {
        buckets['14-30 days overdue'] += 1
      } else {
        buckets['31+ days overdue'] += 1
      }
    }
    return Object.entries(buckets)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0)
  }, [rows])

  const loanVolumeByCategory = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const product = (r['Product Name'] || r.product_name || 'Unknown').trim()
      map.set(product, (map.get(product) || 0) + 1)
    }
    const entries = Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
    return entries.length > 6
      ? [...entries.slice(0, 5), { name: 'Other', count: entries.slice(5).reduce((sum, item) => sum + item.count, 0) }]
      : entries
  }, [rows])

  const operationalInsights = useMemo(() => {
    let totalTerm = 0
    let termCount = 0
    const closingThisMonth = rows.filter(r => {
      const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
      if (!exp) return false
      const d = new Date(exp)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
    const officerSet = new Set()
    for (const r of rows) {
      const disb = r['Disbursed On Date'] || r.disbursed_on_date
      const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
      if (disb && exp) {
        const start = new Date(disb)
        const end = new Date(exp)
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          totalTerm += Math.abs(end - start) / (1000 * 60 * 60 * 24)
          termCount += 1
        }
      }
      const officer = r['Loan Officer Name'] || r.loan_officer_name
      if (officer) officerSet.add(officer)
    }
    const avgTerm = termCount > 0 ? totalTerm / termCount : 0
    const activeOfficers = officerSet.size || 1
    const avgPortfolio = rows.length / activeOfficers

    return [
      { label: 'Average Loan Term', value: `${avgTerm.toFixed(1)} days` },
      { label: 'Loans Closing This Month', value: closingThisMonth.toLocaleString() },
      { label: 'Active Collection Officers', value: activeOfficers.toLocaleString() },
      { label: 'Avg Loans per Officer', value: avgPortfolio.toFixed(1) }
    ]
  }, [rows, now])

  const alerts = useMemo(() => {
    const items = []
    if (disbMonthChange < 0) {
      items.push({
        type: 'warning',
        message: `Monthly disbursements dropped ${Math.abs(disbMonthChange).toFixed(1)}% vs last month`
      })
    } else if (disbMonthChange > 0) {
      items.push({
        type: 'success',
        message: `Monthly disbursements increased ${disbMonthChange.toFixed(1)}% vs last month`
      })
    }
    const highestBranch = [...branchPerformance].sort((a, b) => b.rate - a.rate)[0]
    if (highestBranch) {
      items.push({
        type: 'success',
        message: `${highestBranch.branch} achieved ${highestBranch.rate.toFixed(1)}% collection rate`
      })
    }
    const overdueBranches = branchPerformance.filter(b => b.rate < 70)
    if (overdueBranches.length) {
      items.push({
        type: 'alert',
        message: `${overdueBranches.length} branch${overdueBranches.length > 1 ? 'es' : ''} below 70% collection rate`
      })
    }
    if (!items.length) {
      items.push({
        type: 'info',
        message: 'Portfolio metrics are tracking within expected thresholds.'
      })
    }
    return items.slice(0, 4)
  }, [branchPerformance, disbMonthChange])

  const summaryCards = [
    {
      title: 'Active Borrowers',
      value: activeBorrowers.toLocaleString(),
      change: '+2.1%',
      icon: Users,
      trend: 'up'
    },
    {
      title: 'Active Loans',
      value: activeLoans.toLocaleString(),
      change: '+1.4%',
      icon: BarChart3,
      trend: 'up'
    },
    {
      title: '30-Day Disbursements',
      value: formatKES(disbursed30Days),
      change: `${disbMonthChange >= 0 ? '+' : ''}${disbMonthChange.toFixed(1)}%`,
      icon: DollarSign,
      trend: disbMonthChange >= 0 ? 'up' : 'down'
    },
    {
      title: 'Repayment Rate',
      value: `${totals.repaymentRate.toFixed(1)}%`,
      change: totals.repaymentRate >= 90 ? 'On target' : 'Needs attention',
      icon: TrendingUp,
      trend: totals.repaymentRate >= 90 ? 'up' : 'down'
    }
  ]

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-gray-600">Loading...</div>
  }

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  const donutColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Zidisha Nairobi Branches – 30-Day Loan Portfolio Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Real-time overview of performance, collections, and risk across Zidisha branches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {meta && (
            <span className="text-sm text-gray-500">
              Showing {rows.length.toLocaleString()} of {(meta.total || rows.length).toLocaleString()} records
            </span>
          )}
          {canLoadMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:border-gray-300 hover:text-gray-900 transition-colors disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : 'Load more data'}
            </button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card, idx) => {
          const Icon = card.icon
          const TrendIcon = card.trend === 'down' ? ArrowDownRight : ArrowUpRight
          const trendColor = card.trend === 'down' ? 'text-red-500 bg-red-50' : 'text-emerald-500 bg-emerald-50'
          return (
            <div key={idx} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.title}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{card.value}</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                  <Icon size={20} />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${trendColor}`}>
                  <TrendIcon size={14} />
                  {card.change}
                </span>
              </div>
            </div>
          )
        })}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Portfolio Performance</h3>
              <p className="text-sm text-gray-500">Disbursements vs collections with collection rate trend</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={portfolioSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#6b7280" />
              <YAxis yAxisId="left" tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} stroke="#6b7280" />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} stroke="#6b7280" />
              <Tooltip
                formatter={(value, name) => {
                  const key = (name || '').toString().toLowerCase()
                  if (key.includes('rate')) return [`${value.toFixed(1)}%`, 'Collection Rate']
                  if (key.includes('disbursed')) return [formatKES(value), 'Disbursed']
                  if (key.includes('collected')) return [formatKES(value), 'Collected']
                  return [formatKES(value), name]
                }}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
              />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="disbursed" name="Disbursed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
              <Area yAxisId="left" type="monotone" dataKey="collected" name="Collected" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
              <Line yAxisId="right" type="monotone" dataKey="rate" name="Collection Rate" stroke="#6366f1" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Branch Performance</h3>
            <Target className="text-gray-400" size={18} />
          </div>
          <div className="space-y-3">
            {branchPerformance.map((branch) => (
              <div key={branch.branch} className="flex items-center">
                <div className="w-28 text-sm text-gray-600">{branch.branch}</div>
                <div className="flex-1 mx-3">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Disb {formatKES(branch.disbursed)}</span>
                    <span>Coll {formatKES(branch.collected)}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.min(branch.rate, 100)}%` }}
                    />
                  </div>
                </div>
                <span className={`text-sm font-semibold ${branch.rate >= 85 ? 'text-emerald-600' : branch.rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {branch.rate.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Average Loan Size</h3>
          {avgLoanSizeData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={avgLoanSizeData} dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={4}>
                  {avgLoanSizeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={donutColors[index % donutColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [formatKES(value), name]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400">No data</div>
          )}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Total Disbursed</span>
              <span className="font-semibold text-gray-900">{formatKES(totals.totalPrincipal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Avg Loan Size</span>
              <span className="font-semibold text-gray-900">{formatKES(avgLoanSize)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Collections &amp; Risk</h3>
          {collectionsRisk.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={collectionsRisk} dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={4}>
                  {collectionsRisk.map((entry, index) => (
                    <Cell key={`risk-${index}`} fill={donutColors[index % donutColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [value.toLocaleString(), name]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400">No risk data</div>
          )}
          <div className="mt-4 space-y-2 text-sm text-gray-600">
            <p><span className="font-semibold text-gray-900">{collectionsRisk.reduce((sum, item) => sum + item.value, 0).toLocaleString()}</span> loans monitored</p>
            <p>Outstanding: <span className="font-semibold text-gray-900">{formatKES(totals.totalOutstanding)}</span></p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Loan Volume by Category</h3>
          <ResponsiveContainer width="100%" height={240}>
            <RBarChart data={loanVolumeByCategory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" stroke="#6b7280" />
              <YAxis stroke="#6b7280" />
              <Tooltip formatter={(value) => [value.toLocaleString(), 'Loans']} />
              <Legend />
              <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </RBarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Operational Insights</h3>
            <Clock className="text-gray-400" size={18} />
          </div>
          <div className="grid grid-cols-1 gap-3">
            {operationalInsights.map((insight, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500">{insight.label}</span>
                <span className="text-sm font-semibold text-gray-900">{insight.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Alerts &amp; Exceptions</h3>
            <ShieldAlert className="text-gray-400" size={18} />
          </div>
          <ul className="space-y-3">
            {alerts.map((alert, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <div className={`mt-1 w-2 h-2 rounded-full ${
                  alert.type === 'warning' ? 'bg-yellow-500' :
                  alert.type === 'alert' ? 'bg-red-500' :
                  alert.type === 'success' ? 'bg-emerald-500' :
                  'bg-blue-500'
                }`} />
                <p className="text-sm text-gray-700">{alert.message}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

export default ZidishaDashboard

import React, { useEffect, useMemo, useState } from 'react'
import { DollarSign, Calendar, TrendingUp, Users } from 'lucide-react'
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

function AdvansDisbursement() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        // Use backend filtering for Advans Branch only
        const advans = await fetchAllZidishaRows({
          signal: controller.signal,
          branch: 'Advans Branch'
        })
        setRows(advans)
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
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const summary = useMemo(() => {
    let totalDisbursedYTD = 0
    let totalDisbursedThisMonth = 0
    let loanCountThisMonth = 0
    let totalLoansYTD = 0
    for (const row of rows) {
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      if (y === currentYear) {
        totalDisbursedYTD += amt
        totalLoansYTD += 1
        if (m === currentMonth) {
          totalDisbursedThisMonth += amt
          loanCountThisMonth += 1
        }
      }
    }
    const avgLoanSize = totalLoansYTD > 0 ? totalDisbursedYTD / totalLoansYTD : 0
    return {
      totalDisbursedYTD,
      totalDisbursedThisMonth,
      loanCountThisMonth,
      avgLoanSize,
    }
  }, [rows, currentMonth, currentYear])

  const monthlyTrend = useMemo(() => {
    const months = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const points = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
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
      month: `${months[m]} ${String(y).slice(-2)}`,
      amount: map.get(`${y}-${m}`) || 0,
    }))
  }, [rows, now])

  const dailyTrend = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
    const map = new Array(daysInMonth + 1).fill(0)
    for (const row of rows) {
      const amt = Number(row['Principal Amount']) || 0
      const ds = row['Disbursed On Date'] || row.disbursed_on_date
      if (!amt || !ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() === currentYear && d.getMonth() + 1 === currentMonth) {
        const day = d.getDate()
        map[day] += amt
      }
    }
    return Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      amount: map[i + 1] || 0,
    }))
  }, [rows, currentMonth, currentYear])

  const productMix = useMemo(() => {
    const mix = new Map()
    for (const row of rows) {
      const name = (row['Product Name'] || row.product_name || 'Unknown').trim() || 'Unknown'
      const amt = Number(row['Principal Amount']) || 0
      mix.set(name, (mix.get(name) || 0) + amt)
    }
    return Array.from(mix.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [rows])

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

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-gray-600">Loading disbursements...</div>
  }

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Advans Disbursement</h1>
        <p className="text-gray-600 mt-2">Track and manage Advans loan disbursements with real data</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Disbursed ({currentYear})</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(summary.totalDisbursedYTD)}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Disbursed This Month</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(summary.totalDisbursedThisMonth)}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Calendar size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Average Loan Size ({currentYear})</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(summary.avgLoanSize)}</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Loans This Month</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{summary.loanCountThisMonth.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-rose-50 text-rose-600">
              <Users size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Disbursements (Current Month)</h3>
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Product Mix by Disbursed Amount</h3>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={productMix}
                cx="50%"
                cy="96%"
                startAngle={180}
                endAngle={0}
                innerRadius={100}
                outerRadius={160}
                labelLine={false}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {productMix.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatKES(value), 'Disbursed']} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Loan Officer Performance ({currentYear})</h3>
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

export default AdvansDisbursement

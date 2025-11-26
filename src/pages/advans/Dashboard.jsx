import React, { useEffect, useState, useMemo } from 'react'
import { BarChart3, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts'
import { formatKES } from '../../utils/format.js'
import { API_URLS } from '../../utils/api.js'

function AdvansDashboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(API_URLS.zidisha.data, { credentials: 'include' })
        const data = await res.json()
        const all = Array.isArray(data) ? data : []
        const advans = all.filter(r => (r['Branch Name'] || r.branch_name || '').trim().toLowerCase() === 'advans branch')
        setRows(advans)
        setLoading(false)
      } catch (e) {
        setError(e.message)
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalLoaned = rows.reduce((sum, r) => sum + (Number(r['Principal Amount']) || 0), 0)

  // Calculate current year collection rate for Advans Branch
  const currentYearCollectionRate = useMemo(() => {
    const now = new Date()
    const currentYear = now.getFullYear()
    let totalRepayment = 0
    let totalExpected = 0

    for (const row of rows) {
      const expectedDate = row['Expected Matured On Date'] || row.expected_matured_on_date
      if (!expectedDate) continue
      
      const date = new Date(expectedDate)
      if (isNaN(date.getTime())) continue
      
      // Filter for current year
      if (date.getFullYear() !== currentYear) continue
      
      const repayment = Number(row['Total Repayment Derived'] || row.total_repayment_derived || 0)
      const expected = Number(row['Total Expected Repayment Derived'] || row.total_expected_repayment_derived || 0)
      
      totalRepayment += repayment
      totalExpected += expected
    }

    if (totalExpected > 0) {
      const rate = (totalRepayment / totalExpected) * 100
      return `${rate.toFixed(1)}%`
    }
    return '—'
  }, [rows])

  const stats = [
    { title: 'Total loaned', value: formatKES(totalLoaned), change: '', icon: DollarSign, color: 'text-green-600' },
    { title: 'Active Loans', value: rows.length.toLocaleString(), change: '', icon: BarChart3, color: 'text-blue-600' },
    { title: 'Current Year Collection Rate', value: currentYearCollectionRate, change: '', icon: TrendingUp, color: 'text-purple-600' },
    { title: 'PAR', value: '—', change: '', icon: AlertTriangle, color: 'text-orange-600' }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Advans Dashboard</h1>
        <p className="text-gray-600 mt-2">Overview of Advans business unit performance</p>
      </div>

      {loading && (
        <div className="h-24 flex items-center text-gray-600">Loading...</div>
      )}
      {error && (
        <div className="h-24 flex items-center text-red-600">{error}</div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                {stat.change ? (<p className={`text-sm mt-1 ${stat.color}`}>{stat.change}</p>) : null}
              </div>
              <div className={`p-3 rounded-lg bg-gray-50 ${stat.color}`}>
                <stat.icon size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {(() => {
        // Portfolio Growth - last 12 months, disbursed vs collected (area chart)
        const now = new Date()
        const months = [null, 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const keys = []
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          keys.push({ y: d.getFullYear(), m: d.getMonth() + 1 })
        }
        const disbMap = new Map(keys.map(({y,m}) => [`${y}-${m}`, 0]))
        const collMap = new Map(keys.map(({y,m}) => [`${y}-${m}`, 0]))
        for (const r of rows) {
          const ds = r['Disbursed On Date'] || r.disbursed_on_date || ''
          if (!ds) continue
          const d = new Date(ds)
          if (isNaN(d.getTime())) continue
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`
          const disbAmt = Number(r['Principal Amount']) || 0
          const collAmt = Number(r['Total Repayment Derived']) || 0
          if (disbMap.has(key)) disbMap.set(key, disbMap.get(key) + disbAmt)
          if (collMap.has(key)) collMap.set(key, collMap.get(key) + collAmt)
        }
        const growthSeries = keys.map(({ y, m }) => ({
          month: `${months[m]} ${String(y).slice(-2)}`,
          disbursed: disbMap.get(`${y}-${m}`) || 0,
          collected: collMap.get(`${y}-${m}`) || 0,
        }))

        // Product Name distribution (counts)
        const productCountsMap = new Map()
        for (const r of rows) {
          const p = (r['Product Name'] || r.product_name || 'Unknown').trim()
          productCountsMap.set(p, (productCountsMap.get(p) || 0) + 1)
        }
        const productCounts = Array.from(productCountsMap.entries()).map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
        const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Growth (Last 12 Months)</h3>
              {growthSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={growthSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                    <Tooltip formatter={(v, name) => [formatKES(v), name]} />
                    <Legend />
                    <Area type="monotone" dataKey="disbursed" name="Disbursed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                    <Area type="monotone" dataKey="collected" name="Collected" stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
                  <p className="text-gray-500">No data available</p>
                </div>
              )}
            </div>
            
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Loan Distribution by Product</h3>
              {productCounts.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={productCounts}
                      cx="50%"
                      cy="96%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius={100}
                      outerRadius={160}
                      labelLine={false}
                      dataKey="count"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {productCounts.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value.toLocaleString()}`, 'Loans']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
                  <p className="text-gray-500">No data available</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default AdvansDashboard

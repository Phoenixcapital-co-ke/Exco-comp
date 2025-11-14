import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Clock, CheckCircle, AlertCircle, DollarSign, Target, Zap, Calendar, Users, BarChart3 } from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ComposedChart } from 'recharts'
import { API_URLS } from '../../utils/api.js'

function AdvansCollection() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(API_URLS.zidisha.data)
        const data = await res.json()
        const all = Array.isArray(data) ? data : []
        // Filter for Advans Branch only
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

  const filtered = useMemo(() => {
    const inMonth = (iso) => {
      if (!iso) return false
      const d = new Date(iso)
      if (isNaN(d.getTime())) return false
      return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth
    }
    return rows.filter(r => inMonth(r['Expected Matured On Date'] || r.expected_matured_on_date))
  }, [rows, selectedMonth, selectedYear])

  // Previous month for comparison
  const prevMonth = useMemo(() => {
    const prev = selectedMonth === 1 ? { m: 12, y: selectedYear - 1 } : { m: selectedMonth - 1, y: selectedYear }
    const inMonth = (iso) => {
      if (!iso) return false
      const d = new Date(iso)
      if (isNaN(d.getTime())) return false
      return d.getFullYear() === prev.y && (d.getMonth() + 1) === prev.m
    }
    return rows.filter(r => inMonth(r['Expected Matured On Date'] || r.expected_matured_on_date))
  }, [rows, selectedMonth, selectedYear])

  const totalCollectedMonth = useMemo(() => {
    return filtered.reduce((sum, r) => sum + (Number(r['Total Repayment Derived']) || 0), 0)
  }, [filtered])
  const totalExpectedMonth = useMemo(() => {
    return filtered.reduce((sum, r) => sum + (Number(r['Total Expected Repayment Derived']) || 0), 0)
  }, [filtered])
  const totalOutstandingMonth = useMemo(() => {
    return filtered.reduce((sum, r) => sum + (Number(r['Total Outstanding Derived']) || 0), 0)
  }, [filtered])
  
  const prevMonthCollected = useMemo(() => {
    return prevMonth.reduce((sum, r) => sum + (Number(r['Total Repayment Derived']) || 0), 0)
  }, [prevMonth])
  
  const collectionRatePct = useMemo(() => {
    if (totalExpectedMonth > 0) {
      const pct = (totalCollectedMonth / totalExpectedMonth) * 100
      return { value: pct, display: `${pct.toFixed(1)}%` }
    }
    return { value: 0, display: '0.0%' }
  }, [totalCollectedMonth, totalExpectedMonth])

  const collectionChange = useMemo(() => {
    if (prevMonthCollected > 0) {
      const change = ((totalCollectedMonth - prevMonthCollected) / prevMonthCollected) * 100
      return { value: change, display: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` }
    }
    return { value: 0, display: 'N/A' }
  }, [totalCollectedMonth, prevMonthCollected])

  // Average collection per loan
  const avgCollectionPerLoan = useMemo(() => {
    const loansWithCollection = filtered.filter(r => (Number(r['Total Repayment Derived']) || 0) > 0)
    if (loansWithCollection.length === 0) return 0
    return totalCollectedMonth / loansWithCollection.length
  }, [filtered, totalCollectedMonth])

  // Collection efficiency (collected vs expected ratio)
  const collectionEfficiency = useMemo(() => {
    if (totalExpectedMonth > 0) {
      return (totalCollectedMonth / totalExpectedMonth) * 100
    }
    return 0
  }, [totalCollectedMonth, totalExpectedMonth])

  // MTD collection rate: loans maturing in current month up to today
  const mtdCollectionRatePct = useMemo(() => {
    const nowD = new Date()
    const y = nowD.getFullYear()
    const m = nowD.getMonth() + 1
    let expSum = 0
    let repSum = 0
    for (const r of rows) {
      const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
      if (!exp) continue
      const d = new Date(exp)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m && d <= nowD) {
        expSum += Number(r['Total Expected Repayment Derived']) || 0
        repSum += Number(r['Total Repayment Derived']) || 0
      }
    }
    if (expSum > 0) {
      const pct = (repSum / expSum) * 100
      return `${pct.toFixed(1)}%`
    }
    return '0.0%'
  }, [rows])

  // Monthly Collection Trend (Last 12 Months)
  const monthlyCollectionTrend = useMemo(() => {
    const months = [null, 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const keys = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push({ y: d.getFullYear(), m: d.getMonth() + 1 })
    }
    const collMap = new Map(keys.map(({y,m}) => [`${y}-${m}`, 0]))
    const expMap = new Map(keys.map(({y,m}) => [`${y}-${m}`, 0]))
    for (const r of rows) {
      const ds = r['Disbursed On Date'] || r.disbursed_on_date || ''
      if (!ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`
      const collAmt = Number(r['Total Repayment Derived']) || 0
      const expAmt = Number(r['Total Expected Repayment Derived']) || 0
      if (collMap.has(key)) collMap.set(key, collMap.get(key) + collAmt)
      if (expMap.has(key)) expMap.set(key, expMap.get(key) + expAmt)
    }
    return keys.map(({ y, m }) => {
      const collected = collMap.get(`${y}-${m}`) || 0
      const expected = expMap.get(`${y}-${m}`) || 0
      return {
        month: `${months[m]} ${String(y).slice(-2)}`,
        collected,
        expected,
        rate: expected > 0 ? (collected / expected) * 100 : 0
      }
    })
  }, [rows])

  // Daily Expected vs Collected (Current Month)
  const dailyExpectedVsCollected = useMemo(() => {
    const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
    const expByDay = Array(daysIn + 1).fill(0)
    const repByDay = Array(daysIn + 1).fill(0)
    for (const r of rows) {
      const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
      if (!exp) continue
      const d = new Date(exp)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() !== selectedYear || (d.getMonth() + 1) !== selectedMonth) continue
      const day = d.getDate()
      if (day >= 1 && day <= daysIn) {
        expByDay[day] += Number(r['Total Expected Repayment Derived']) || 0
        repByDay[day] += Number(r['Total Repayment Derived']) || 0
      }
    }
    const arr = []
    for (let i = 1; i <= daysIn; i++) {
      const expected = expByDay[i]
      const collected = repByDay[i]
      arr.push({ 
        day: String(i), 
        expected, 
        collected,
        rate: expected > 0 ? (collected / expected) * 100 : 0
      })
    }
    return arr
  }, [rows, selectedMonth, selectedYear])

  // Collection Rate by Product
  const collectionRateByProduct = useMemo(() => {
    const productMap = new Map()
    for (const r of rows) {
      const product = (r['Product Name'] || r.product_name || 'Unknown').trim()
      if (!productMap.has(product)) {
        productMap.set(product, { expected: 0, collected: 0, count: 0 })
      }
      const entry = productMap.get(product)
      entry.expected += Number(r['Total Expected Repayment Derived']) || 0
      entry.collected += Number(r['Total Repayment Derived']) || 0
      entry.count += 1
    }
    return Array.from(productMap.entries())
      .map(([name, v]) => ({
        name: name.length > 20 ? name.substring(0, 20) + '...' : name,
        fullName: name,
        rate: v.expected > 0 ? (v.collected / v.expected) * 100 : 0,
        collected: v.collected,
        expected: v.expected,
        count: v.count
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10)
  }, [rows])

  // Collection Status Distribution
  const collectionStatusDistribution = useMemo(() => {
    let collected = 0
    let overdue = 0
    let pending = 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (const r of rows) {
      const expected = Number(r['Total Expected Repayment Derived']) || 0
      const repaid = Number(r['Total Repayment Derived']) || 0
      const expDate = r['Expected Matured On Date'] || r.expected_matured_on_date
      
      if (repaid >= expected * 0.99) {
        collected++
      } else if (expDate) {
        const d = new Date(expDate)
        d.setHours(0, 0, 0, 0)
        if (d < today) {
          overdue++
        } else {
          pending++
        }
      } else {
        pending++
      }
    }

    return [
      { name: 'Collected', value: collected, color: '#10b981' },
      { name: 'Overdue', value: overdue, color: '#ef4444' },
      { name: 'Pending', value: pending, color: '#f59e0b' }
    ].filter(item => item.value > 0)
  }, [rows])

  // Overdue Analysis
  const overdueAnalysis = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const buckets = {
      '0-30': { count: 0, amount: 0 },
      '31-60': { count: 0, amount: 0 },
      '61-90': { count: 0, amount: 0 },
      '90+': { count: 0, amount: 0 }
    }

    for (const r of rows) {
      const expected = Number(r['Total Expected Repayment Derived']) || 0
      const repaid = Number(r['Total Repayment Derived']) || 0
      const expDate = r['Expected Matured On Date'] || r.expected_matured_on_date
      
      if (repaid >= expected * 0.99) continue
      if (!expDate) continue
      
      const d = new Date(expDate)
      d.setHours(0, 0, 0, 0)
      if (d >= today) continue
      
      const daysPast = Math.floor((today - d) / (1000 * 60 * 60 * 24))
      const outstanding = expected - repaid
      
      if (daysPast <= 30) {
        buckets['0-30'].count++
        buckets['0-30'].amount += outstanding
      } else if (daysPast <= 60) {
        buckets['31-60'].count++
        buckets['31-60'].amount += outstanding
      } else if (daysPast <= 90) {
        buckets['61-90'].count++
        buckets['61-90'].amount += outstanding
      } else {
        buckets['90+'].count++
        buckets['90+'].amount += outstanding
      }
    }

    return Object.entries(buckets).map(([range, data]) => ({
      range,
      count: data.count,
      amount: data.amount
    })).filter(item => item.count > 0)
  }, [rows])

  // Top performing loan officers by collection
  const topOfficers = useMemo(() => {
    const officerMap = new Map()
    for (const r of rows) {
      const officer = (r['Loan Officer Name'] || r.loan_officer_name || 'Unknown').trim()
      if (!officerMap.has(officer)) {
        officerMap.set(officer, { collected: 0, expected: 0, count: 0 })
      }
      const entry = officerMap.get(officer)
      entry.collected += Number(r['Total Repayment Derived']) || 0
      entry.expected += Number(r['Total Expected Repayment Derived']) || 0
      entry.count += 1
    }
    return Array.from(officerMap.entries())
      .map(([name, v]) => ({
        name,
        collected: v.collected,
        expected: v.expected,
        rate: v.expected > 0 ? (v.collected / v.expected) * 100 : 0,
        count: v.count
      }))
      .sort((a, b) => b.collected - a.collected)
      .slice(0, 10)
  }, [rows])

  // Collection Status Table Data
  const collectionTableData = useMemo(() => {
    return filtered
      .map(r => {
        const expected = Number(r['Total Expected Repayment Derived']) || 0
        const repaid = Number(r['Total Repayment Derived']) || 0
        const expDate = r['Expected Matured On Date'] || r.expected_matured_on_date
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        
        let status = 'Pending'
        let daysPast = 0
        if (repaid >= expected * 0.99) {
          status = 'Collected'
        } else if (expDate) {
          const d = new Date(expDate)
          d.setHours(0, 0, 0, 0)
          if (d < today) {
            status = 'Overdue'
            daysPast = Math.floor((today - d) / (1000 * 60 * 60 * 24))
          }
        }

        return {
          client: r['Client Name'] || r.client_name || 'Unknown',
          product: r['Product Name'] || r.product_name || 'Unknown',
          amount: expected,
          dueDate: expDate || '',
          status,
          collected: repaid,
          outstanding: expected - repaid,
          daysPast
        }
      })
      .sort((a, b) => {
        if (a.status === 'Overdue' && b.status !== 'Overdue') return -1
        if (a.status !== 'Overdue' && b.status === 'Overdue') return 1
        if (a.status === 'Overdue' && b.status === 'Overdue') return b.daysPast - a.daysPast
        return b.amount - a.amount
      })
      .slice(0, 50)
  }, [filtered])

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Collected':
        return <CheckCircle className="text-green-500" size={16} />
      case 'Overdue':
        return <AlertCircle className="text-red-500" size={16} />
      case 'Pending':
        return <Clock className="text-yellow-500" size={16} />
      default:
        return null
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'Collected':
        return 'bg-green-100 text-green-800'
      case 'Overdue':
        return 'bg-red-100 text-red-800'
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-gray-600">Loading collection data...</div>
  }

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Advans Collection</h1>
          <p className="text-gray-600 mt-2">Monitor Advans loan collections and payment status</p>
        </div>
        <div className="flex items-end space-x-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Month</label>
            <select className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString('en-US', { month: 'long' })}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Year</label>
            <select className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
              {[selectedYear-1, selectedYear, selectedYear+1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Enhanced Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl shadow-sm border border-green-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Total Collected</p>
              <p className="text-3xl font-bold text-gray-900">{formatKES(totalCollectedMonth)}</p>
              <div className="flex items-center mt-2 space-x-2">
                {collectionChange.value >= 0 ? (
                  <TrendingUp className="text-green-600" size={16} />
                ) : (
                  <TrendingDown className="text-red-600" size={16} />
                )}
                <span className={`text-xs font-medium ${collectionChange.value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {collectionChange.display} vs last month
                </span>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-green-500 text-white">
              <CheckCircle size={28} />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl shadow-sm border border-blue-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Collection Rate</p>
              <p className="text-3xl font-bold text-gray-900">{collectionRatePct.display}</p>
              <p className="text-xs text-gray-500 mt-2">Efficiency: {collectionEfficiency.toFixed(1)}%</p>
            </div>
            <div className="p-4 rounded-xl bg-blue-500 text-white">
              <Target size={28} />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl shadow-sm border border-red-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Outstanding</p>
              <p className="text-3xl font-bold text-gray-900">{formatKES(totalOutstandingMonth)}</p>
              <p className="text-xs text-gray-500 mt-2">
                {totalExpectedMonth > 0 ? `${((totalOutstandingMonth / totalExpectedMonth) * 100).toFixed(1)}% of expected` : 'N/A'}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-red-500 text-white">
              <AlertCircle size={28} />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow-sm border border-purple-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Avg per Loan</p>
              <p className="text-3xl font-bold text-gray-900">{formatKES(avgCollectionPerLoan)}</p>
              <p className="text-xs text-gray-500 mt-2">
                {filtered.filter(r => (Number(r['Total Repayment Derived']) || 0) > 0).length} active collections
              </p>
            </div>
            <div className="p-4 rounded-xl bg-purple-500 text-white">
              <DollarSign size={28} />
            </div>
          </div>
        </div>
      </div>

      {/* Additional Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">MTD Collection Rate</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{mtdCollectionRatePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600">
              <Zap size={24} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">
                {new Date(selectedYear, selectedMonth - 1).toLocaleString('en-US', { month: 'long' })} Total Expected Repayment
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(totalExpectedMonth)}</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Calendar size={24} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Loans</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{filtered.length.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 text-gray-600">
              <Users size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Collection Trend with Rate */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Collection Performance (Last 12 Months)</h3>
          {monthlyCollectionTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={monthlyCollectionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" />
                <YAxis yAxisId="left" tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} stroke="#6b7280" />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} stroke="#6b7280" />
                <Tooltip 
                  formatter={(value, name) => {
                    const key = (name || '').toString().toLowerCase()
                    if (key === 'rate %' || key === 'rate') return [`${value.toFixed(1)}%`, 'Collection Rate']
                    if (key === 'collected') return [formatKES(value), 'Collected']
                    if (key === 'expected') return [formatKES(value), 'Expected']
                    return [formatKES(value), name]
                  }}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="collected" name="Collected" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                <Area yAxisId="left" type="monotone" dataKey="expected" name="Expected" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} />
                <Line yAxisId="right" type="monotone" dataKey="rate" name="Rate %" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <p className="text-gray-500">No data available</p>
            </div>
          )}
        </div>

        {/* Collection Status Distribution */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Collection Status Overview</h3>
          {collectionStatusDistribution.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={collectionStatusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {collectionStatusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [value.toLocaleString(), 'Loans']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
                {collectionStatusDistribution.map((item, idx) => (
                  <div key={idx} className="text-center">
                    <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value.toLocaleString()}</p>
                    <p className="text-xs text-gray-600 mt-1">{item.name}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <p className="text-gray-500">No data available</p>
            </div>
          )}
        </div>
      </div>

      {/* Daily Expected vs Collected */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Daily Expected vs Collected ({new Date(2000, selectedMonth-1, 1).toLocaleString('en-US', { month: 'long' })} {selectedYear})
        </h3>
        {dailyExpectedVsCollected.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={dailyExpectedVsCollected}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="day" stroke="#6b7280" />
              <YAxis yAxisId="left" tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} stroke="#6b7280" />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} stroke="#6b7280" />
              <Tooltip 
                formatter={(value, name) => {
                  const key = (name || '').toString().toLowerCase()
                  if (key === 'rate %' || key === 'rate') return [`${value.toFixed(1)}%`, 'Collection Rate']
                  if (key === 'expected') return [formatKES(value), 'Expected']
                  if (key === 'collected') return [formatKES(value), 'Collected']
                  return [formatKES(value), name]
                }}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
              />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="expected" name="Expected" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
              <Area yAxisId="left" type="monotone" dataKey="collected" name="Collected" stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
              <Line yAxisId="right" type="monotone" dataKey="rate" name="Rate %" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <p className="text-gray-500">No data available</p>
          </div>
        )}
      </div>

      {/* Collection Rate by Product and Overdue Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Collection Rate by Product */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Collection Rate by Product</h3>
          {collectionRateByProduct.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={collectionRateByProduct} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} stroke="#6b7280" />
                <YAxis dataKey="name" type="category" width={120} stroke="#6b7280" />
                <Tooltip 
                  formatter={(value, name) => {
                    if (name === 'rate') return [`${value.toFixed(1)}%`, 'Collection Rate']
                    return [formatKES(value), name === 'collected' ? 'Collected' : 'Expected']
                  }}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                />
                <Legend />
                <Bar dataKey="rate" fill="#3b82f6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <p className="text-gray-500">No data available</p>
            </div>
          )}
        </div>

        {/* Overdue Analysis */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Overdue Analysis by Age</h3>
          {overdueAnalysis.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={overdueAnalysis}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="range" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip 
                    formatter={(value, name) => {
                      if (name === 'amount') return [formatKES(value), 'Outstanding']
                      return [value, 'Loans']
                    }}
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                  />
                  <Legend />
                  <Bar dataKey="count" fill="#ef4444" radius={[6, 6, 0, 0]} name="Loans" />
                </BarChart>
              </ResponsiveContainer>
              <div className="space-y-2 pt-4 border-t border-gray-200">
                {overdueAnalysis.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.range} days</p>
                      <p className="text-xs text-gray-600">{item.count} loans</p>
                    </div>
                    <p className="text-lg font-bold text-red-600">{formatKES(item.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <p className="text-gray-500">No overdue loans</p>
            </div>
          )}
        </div>
      </div>

      {/* Top Performing Loan Officers */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Top Performing Loan Officers</h3>
          <BarChart3 className="text-gray-400" size={20} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Rank</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Officer</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Collected</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Expected</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Rate</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Loans</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {topOfficers.map((officer, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                      idx === 0 ? 'bg-yellow-100 text-yellow-800' :
                      idx === 1 ? 'bg-gray-100 text-gray-800' :
                      idx === 2 ? 'bg-orange-100 text-orange-800' :
                      'bg-gray-50 text-gray-600'
                    }`}>
                      {idx + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{officer.name}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatKES(officer.collected)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatKES(officer.expected)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                      officer.rate >= 90 ? 'bg-green-100 text-green-800' :
                      officer.rate >= 70 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {officer.rate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{officer.count.toLocaleString()}</td>
                </tr>
              ))}
              {topOfficers.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collection Status Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Collection Status Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Due Date</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Collected</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Outstanding</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {collectionTableData.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.client}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{item.product}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{formatKES(item.amount)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(item.status)}
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(item.status)}`}>
                        {item.status}
                        {item.status === 'Overdue' && item.daysPast > 0 && (
                          <span className="ml-1">({item.daysPast}d)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">{formatKES(item.collected)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-red-600">{formatKES(item.outstanding)}</td>
                </tr>
              ))}
              {collectionTableData.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-center text-gray-500" colSpan={7}>No data available for selected period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default AdvansCollection

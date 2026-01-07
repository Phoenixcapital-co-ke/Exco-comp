import React, { useEffect, useMemo, useState } from 'react'
import { DollarSign, Calendar, TrendingUp, ChevronDown, ChevronRight, Building2, Target } from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { API_URLS } from '../../utils/api.js'

function ZidishaDisbursement() {
  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#6366f1']
  const [rows, setRows] = useState([])
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedBranch, setSelectedBranch] = useState('All')
  const [selectedDay, setSelectedDay] = useState(now.getDate())
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
        const all = await fetchAllZidishaRows({ signal: controller.signal })
        const filtered = all.filter(r => (r['Branch Name'] || r.branch_name || '').trim().toLowerCase() !== 'advans branch')
        setRows(filtered)
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
        console.error('Failed to load targets', e)
      }
    }
    loadTargets()
  }, [])

  // Helpers
  const inSelectedMonth = (dateLike) => {
    if (!dateLike) return false
    const d = new Date(dateLike)
    if (isNaN(d.getTime())) return false
    return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth
  }

  // Filtered rows for selected month
  const monthRows = rows.filter(r => inSelectedMonth(r['Disbursed On Date'] || r.disbursed_on_date))

  // Get targets for selected month/year
  const selectedTargets = useMemo(() => {
    return targets.filter(t => 
      t.month === selectedMonth && 
      t.year === selectedYear && 
      t.active
    )
  }, [targets, selectedMonth, selectedYear])

  // Create a map of branch -> target for quick lookup
  const targetMap = useMemo(() => {
    const map = new Map()
    selectedTargets.forEach(t => {
      const key = cleanBranchName(t.branch || '')
      map.set(key, { ...t, branch: key })
    })
    return map
  }, [selectedTargets])

  // Calculate disbursement vs target
  const disbursementVsTarget = useMemo(() => {
    const branchTotals = new Map()
    for (const r of monthRows) {
      const branchName = cleanBranchName((r['Branch Name'] || r.branch_name || 'Unknown').trim() || 'Unknown')
      const principal = Number(r['Principal Amount'] || r.principal_amount || 0) || 0
      branchTotals.set(branchName, (branchTotals.get(branchName) || 0) + principal)
    }

    const results = []
    for (const [branch, actual] of branchTotals.entries()) {
      const target = targetMap.get(branch)
      if (target) {
        const targetAmount = target.disbursementTarget || 0
        const variance = actual - targetAmount
        const percentage = targetAmount > 0 ? (actual / targetAmount) * 100 : 0
        results.push({
          branch,
          actual,
          target: targetAmount,
          variance,
          percentage
        })
      } else {
        results.push({
          branch,
          actual,
          target: 0,
          variance: actual,
          percentage: 0
        })
      }
    }
    return results.sort((a, b) => b.actual - a.actual)
  }, [monthRows, targetMap])

  // Overall totals
  const overallActual = disbursementVsTarget.reduce((sum, r) => sum + r.actual, 0)
  const overallTarget = disbursementVsTarget.reduce((sum, r) => sum + r.target, 0)
  const overallVariance = overallActual - overallTarget
  const overallPercentage = overallTarget > 0 ? (overallActual / overallTarget) * 100 : 0

  const productBreakdown = useMemo(() => {
    const agg = new Map()
    for (const r of monthRows) {
      const product = (r['Product Name'] || r.product_name || 'Unknown').trim() || 'Unknown'
      const principal = Number(r['Principal Amount'] || r.principal_amount || 0) || 0
      if (!agg.has(product)) agg.set(product, 0)
      agg.set(product, agg.get(product) + principal)
    }
    return Array.from(agg.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [monthRows])

  const branchSummaryTable = useMemo(() => {
    const map = new Map()
    for (const r of monthRows) {
      const branchName = cleanBranchName((r['Branch Name'] || r.branch_name || 'Unknown').trim() || 'Unknown')
      const principal = Number(r['Principal Amount'] || r.principal_amount || 0) || 0
      const productName = (r['Product Name'] || r.product_name || '').trim()
      const isNew = productName === 'Zidisha Simba'

      if (!map.has(branchName)) {
        map.set(branchName, {
          branch: branchName,
          totalAmount: 0,
          totalCount: 0,
          newAmount: 0,
          newCount: 0,
          repeatAmount: 0,
          repeatCount: 0,
          officers: new Map()
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
          repeatCount: 0
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
        officers: Array.from(entry.officers.values()).sort((a, b) => b.totalAmount - a.totalAmount)
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
  }, [monthRows])

  if (loading) return <div className="h-64 flex items-center justify-center text-gray-600">Loading...</div>
  if (error) return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>

  // Metrics
  const totalDisbursedMonth = monthRows.reduce((sum, r) => sum + (Number(r['Principal Amount']) || 0), 0)
  const numLoansMonth = monthRows.length
  const monthLabel = new Date(selectedYear, selectedMonth - 1, 1).toLocaleString('en-US', { month: 'long' })

  // Previous month metrics for MoM rates
  const prev = selectedMonth === 1 ? { y: selectedYear - 1, m: 12 } : { y: selectedYear, m: selectedMonth - 1 }
  const prevRows = rows.filter(r => {
    const ds = r['Disbursed On Date'] || r.disbursed_on_date
    if (!ds) return false
    const d = new Date(ds)
    if (isNaN(d.getTime())) return false
    return d.getFullYear() === prev.y && (d.getMonth() + 1) === prev.m
  })
  const totalDisbursedPrevMonth = prevRows.reduce((sum, r) => sum + (Number(r['Principal Amount']) || 0), 0)
  const numLoansPrevMonth = prevRows.length
  const pctStr = (cur, prev) => {
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    }
    return '+0.0%'
  }
  const changeColor = (s) => (s.startsWith('-') ? 'text-red-700' : 'text-green-700')
  const totalDisbursedMoM = pctStr(totalDisbursedMonth, totalDisbursedPrevMonth)
  const numLoansMoM = pctStr(numLoansMonth, numLoansPrevMonth)

  const isCurrentSelection = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1)
  // Disbursed Today (only if current month selected)
  const disbursedTodaySelected = (() => {
    if (!isCurrentSelection) return 0
    const todayY = now.getFullYear(), todayM = now.getMonth() + 1, todayD = now.getDate()
    let sum = 0
    for (const r of monthRows) {
      const ds = r['Disbursed On Date'] || r.disbursed_on_date
      if (!ds) continue
      const d = new Date(ds)
      if (isNaN(d.getTime())) continue
      if (d.getFullYear() === todayY && (d.getMonth() + 1) === todayM && d.getDate() === todayD) {
        sum += Number(r['Principal Amount']) || 0
      }
    }
    return sum
  })()
  // Average per day for selected month (calendar days)
  const daysInSelectedMonth = new Date(selectedYear, selectedMonth, 0).getDate()
  const avgDisbursementPerDay = daysInSelectedMonth > 0 ? (totalDisbursedMonth / daysInSelectedMonth) : 0

  // Recent table data (last 20 by disbursed date)
  const recentRows = [...monthRows].sort((a, b) => new Date(b['Disbursed On Date'] || b.disbursed_on_date) - new Date(a['Disbursed On Date'] || a.disbursed_on_date)).slice(0, 20)

  const yearsOptions = (() => {
    const ys = new Set(rows.map(r => new Date(r['Disbursed On Date'] || r.disbursed_on_date).getFullYear()).filter(y => !isNaN(y)))
    return Array.from(ys).sort((a, b) => a - b)
  })()
  const branchOptions = (() => {
    const bs = new Set(rows.map(r => cleanBranchName((r['Branch Name'] || r.branch_name || 'Unknown').trim())).filter(Boolean))
    const arr = Array.from(bs).sort((a, b) => a.localeCompare(b))
    return ['All', ...arr]
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Zidisha Disbursement</h1>
          <p className="text-gray-600 mt-2">Track and manage Zidisha loan disbursements</p>
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
              {(yearsOptions.length ? yearsOptions : [selectedYear-1, selectedYear, selectedYear+1]).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{`Total ${monthLabel} ${selectedYear} Disbursed`}</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalDisbursedMonth)}</p>
              <p className={`text-sm mt-1 ${changeColor(totalDisbursedMoM)}`}>{totalDisbursedMoM}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{isCurrentSelection ? 'Disbursed Today' : 'Avg Disbursement / Day'}</p>
              <p className="text-2xl font-bold text-gray-900">{isCurrentSelection ? formatKES(disbursedTodaySelected) : formatKES(avgDisbursementPerDay)}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Calendar size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Number of Loans</p>
              <p className="text-2xl font-bold text-gray-900">{numLoansMonth.toLocaleString()}</p>
              <p className={`text-sm mt-1 ${changeColor(numLoansMoM)}`}>{numLoansMoM}</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Disbursement vs Target</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(overallActual)}</p>
              {overallTarget > 0 ? (
                <>
                  <p className={`text-sm mt-1 ${overallPercentage >= 100 ? 'text-green-700' : 'text-red-700'}`}>
                    {overallPercentage.toFixed(1)}% of {formatKES(overallTarget)}
                  </p>
                  <p className={`text-xs mt-1 ${overallVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {overallVariance >= 0 ? '+' : ''}{formatKES(overallVariance)}
                  </p>
                </>
              ) : (
                <p className="text-sm mt-1 text-gray-500">No target set</p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
              <Target size={24} />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col lg:flex-row lg:gap-6">
      {/* Daily Disbursements for Selected Month with Branch Comparison */}
      {(() => {
        const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
        const overallByDay = Array(daysIn + 1).fill(0)
        const branchByDay = Array(daysIn + 1).fill(0)
        const branchFilter = selectedBranch
        for (const r of monthRows) {
          const ds = r['Disbursed On Date'] || r.disbursed_on_date
          if (!ds) continue
          const d = new Date(ds)
          if (isNaN(d.getTime())) continue
          const day = d.getDate()
          const amt = Number(r['Principal Amount']) || 0
          if (day >= 1 && day <= daysIn) {
            overallByDay[day] += amt
            if (branchFilter !== 'All') {
                const bname = cleanBranchName((r['Branch Name'] || r.branch_name || 'Unknown').trim())
              if (bname === branchFilter) branchByDay[day] += amt
            }
          }
        }
        const dailySeries = []
        for (let i = 1; i <= daysIn; i++) dailySeries.push({ day: String(i), overall: overallByDay[i], branch: branchByDay[i] })
        if (!dailySeries.length) return null
        return (
            <div className="w-full lg:w-2/3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Daily Disbursements ({monthLabel} {selectedYear})</h3>
              <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}>
                {branchOptions.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip formatter={(v, n) => [formatKES(v), n === 'overall' ? 'Overall' : selectedBranch]} />
                  <Area type="monotone" dataKey="overall" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} name="Overall" />
                  {selectedBranch !== 'All' && (
                    <Area type="monotone" dataKey="branch" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name={selectedBranch} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })()}

        {/* Daily Branch Breakdown (Selected Day) */}
      {(() => {
          const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
          const day = Math.min(selectedDay, daysIn)
        const agg = new Map()
        for (const r of monthRows) {
          const ds = r['Disbursed On Date'] || r.disbursed_on_date
            if (!ds) continue
          const d = new Date(ds)
            if (isNaN(d.getTime())) continue
            if (d.getFullYear() !== selectedYear || (d.getMonth() + 1) !== selectedMonth || d.getDate() !== day) continue
            const b = cleanBranchName(r['Branch Name'] || r.branch_name || 'Unknown')
            const amt = Number(r['Principal Amount']) || 0
            if (!agg.has(b)) agg.set(b, 0)
            agg.set(b, agg.get(b) + amt)
          }
          const rowsTbl = Array.from(agg.entries())
            .map(([branch, amount]) => ({ branch, amount }))
          .sort((a, b) => b.amount - a.amount)

        return (
            <div className="w-full lg:w-1/3 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Daily Branch Breakdown</h3>
                <div className="flex items-center space-x-2">
                  <label className="text-xs text-gray-600">Day</label>
                  <select
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                    value={day}
                    onChange={(e) => setSelectedDay(Number(e.target.value))}
                  >
                    {Array.from({ length: daysIn }, (_, i) => i + 1).map((dv) => (
                      <option key={dv} value={dv}>{dv}</option>
                    ))}
                  </select>
                </div>
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
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={2}>No disbursements for selected day.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                  </div>
                )
        })()}
        </div>
      </div>

      {/* Disbursement vs Target by Branch */}
      {disbursementVsTarget.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="text-orange-600" size={20} />
            <h3 className="text-lg font-semibold text-gray-900">Disbursement vs Target by Branch ({monthLabel} {selectedYear})</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 w-full h-[520px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={disbursementVsTarget.map(item => ({
                    branch: item.branch.length > 12 ? item.branch.substring(0, 12) + '...' : item.branch,
                    fullBranch: item.branch,
                    actual: item.actual,
                    target: item.target > 0 ? item.target : 0,
                    percentage: item.target > 0 ? item.percentage : 0
                  }))}
                  margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="branch" 
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    interval={0}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'actual') return [formatKES(value), 'Actual Disbursement']
                      if (name === 'target') return [formatKES(value), 'Target']
                      return [value, name]
                    }}
                    labelFormatter={(label) => {
                      const item = disbursementVsTarget.find(i => i.branch.startsWith(label) || label.startsWith(i.branch))
                      return item ? item.branch : label
                    }}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '8px'
                    }}
                  />
                  <Legend />
                  <Bar 
                    dataKey="actual" 
                    name="Actual Disbursement" 
                    fill="#3b82f6" 
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar 
                    dataKey="target" 
                    name="Target" 
                    fill="#f59e0b" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {productBreakdown.length > 0 && (
              <div className="w-full h-[520px] bg-gray-50 rounded-lg border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-3">Disbursement by Product</h4>
                <ResponsiveContainer width="100%" height="90%">
                  <PieChart>
                    <Pie
                      data={productBreakdown}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                    >
                      {productBreakdown.map((entry, index) => (
                        <Cell key={`cell-${entry.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [formatKES(v), n]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branch Summary Table */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">Branch Summary ({monthLabel} {selectedYear})</h3>
          <p className="text-sm text-gray-600 mt-1">Click on a branch to view loan officer details</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full table-auto text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-300">
                <th rowSpan={2} className="px-3 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider align-bottom border-r border-gray-300 whitespace-normal break-words w-40">
                  <div className="flex items-center gap-2">
                    <Building2 size={16} className="text-indigo-600" />
                    <span>Branch</span>
                  </div>
                </th>
                <th colSpan={3} className="px-3 py-3 text-center align-middle text-xs font-bold text-gray-700 uppercase tracking-wider bg-green-50 border-r border-gray-300">
                  <div className="flex items-center justify-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <span>New (Zidisha Simba)</span>
                  </div>
                </th>
                <th colSpan={2} className="px-3 py-3 text-center align-middle text-xs font-bold text-gray-700 uppercase tracking-wider bg-amber-50">
                  <div className="flex items-center justify-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span>Repeat</span>
                  </div>
                </th>
                <th colSpan={4} className="px-3 py-3 text-center align-middle text-xs font-bold text-gray-700 uppercase tracking-wider bg-blue-50 border-l border-gray-300">
                  <div className="flex items-center justify-center gap-1">
                    <TrendingUp size={14} className="text-blue-600" />
                    <span>Total</span>
                  </div>
                </th>
              </tr>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-300">
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-green-50 border-r border-gray-300">Amount</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-green-50 border-r border-gray-300">Loans</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-green-50 border-r border-gray-300">New Target</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-amber-50 border-r border-gray-300">Amount</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-amber-50">Loans</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-l border-gray-300">Amount</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-r border-gray-300">Loans</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-r border-gray-300">Target</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50 border-r border-gray-300">%</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {branchSummaryTable.map((row, idx) => {
                const targetInfo = targetMap.get(row.branch)
                const targetAmount = targetInfo?.disbursementTarget || 0
                const percentage = targetAmount > 0 ? (row.totalAmount / targetAmount) * 100 : 0
                return (
                <React.Fragment key={row.branch}>
                  <tr className={`transition-all duration-200 ${expandedBranch === row.branch ? 'bg-indigo-50' : 'hover:bg-gray-50'} ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                    <td className="px-3 py-3 whitespace-normal break-words">
                      <button
                        type="button"
                        onClick={() => setExpandedBranch(expandedBranch === row.branch ? null : row.branch)}
                        className="inline-flex items-center gap-2 text-left font-semibold text-gray-900 hover:text-indigo-600 focus:outline-none transition-colors group"
                      >
                        <div className={`transition-transform duration-200 ${expandedBranch === row.branch ? 'rotate-90' : ''}`}>
                          {expandedBranch === row.branch ? (
                            <ChevronDown size={18} className="text-indigo-600" />
                          ) : (
                            <ChevronRight size={18} className="text-gray-400 group-hover:text-indigo-600" />
                          )}
                        </div>
                        <span className="font-semibold">{row.branch}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-green-700 text-right">{formatKES(row.newAmount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-green-600 text-right">{row.newCount.toLocaleString()}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-gray-700 text-right">
                      {targetInfo?.newClientsAmountPerMonth ? formatKES(targetInfo.newClientsAmountPerMonth) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-amber-700 text-right">{formatKES(row.repeatAmount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-amber-600 text-right">{row.repeatCount.toLocaleString()}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-gray-900 text-right">{formatKES(row.totalAmount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm font-semibold text-gray-700 text-right">{row.totalCount.toLocaleString()}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-700 text-right">
                      {targetAmount > 0 ? formatKES(targetAmount) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className={`px-3 py-3 whitespace-nowrap text-sm font-semibold text-right ${percentage >= 100 ? 'text-green-700' : percentage >= 80 ? 'text-yellow-700' : 'text-red-700'}`}>
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
                                    <th className="px-5 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300">Loan Officer</th>
                                    <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-blue-50">Total Amount</th>
                                    <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-blue-50">Total Loans</th>
                                    <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-green-50">New Amount</th>
                                    <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-green-50">New Loans</th>
                                    <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider border-r border-gray-300 bg-amber-50">Repeat Amount</th>
                                    <th className="px-5 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider bg-amber-50">Repeat Loans</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                  {row.officers.map((officer, oIdx) => (
                                    <tr key={officer.officer} className={`hover:bg-indigo-50/50 transition-colors ${oIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
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

      {/* Disbursement Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Disbursements</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentRows.map((r, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r['Client Name'] || r.client_name || 'Unknown'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{r['Product Name'] || r.product_name || 'Unknown'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatKES(Number(r['Principal Amount']) || 0)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{cleanBranchName(r['Branch Name'] || r.branch_name || 'Unknown')}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{r['Disbursed On Date'] || r.disbursed_on_date || ''}</td>
                  <td className="px-6 py-4 whitespace-normal break-words">
                    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Completed</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ZidishaDisbursement

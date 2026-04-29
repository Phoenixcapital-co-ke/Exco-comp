import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { useZidishaBranch } from '../../context/ZidishaBranchContext.jsx'
import ZidishaBranchFilter from '../../components/ZidishaBranchFilter.jsx'

function ZidishaCollection() {
  const now = new Date()
  const prev = now.getMonth() === 0 ? { m: 12, y: now.getFullYear() - 1 } : { m: now.getMonth(), y: now.getFullYear() }
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Track if data is ready to prevent showing zeros
  const [dataReady, setDataReady] = useState(false)
  const { selectedBranch } = useZidishaBranch()
  const [selectedDay, setSelectedDay] = useState(() => {
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const todayD = new Date().getDate()
    return Math.min(todayD, daysIn)
  })

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        setDataReady(false)
        // Filter for Zidisha products only using backend filtering
        const zidishaProducts = ['Zidisha Kifaru', 'Zidisha Nyati', 'Zidisha Simba', 'Zidisha Tembo', 'Zidisha Express']
        // Use backend filtering for products and exclude Advans branch
        const filteredRows = await fetchAllZidishaRows({ 
          signal: controller.signal,
          products: zidishaProducts,
          branch: selectedBranch !== 'All' ? selectedBranch : undefined,
          excludeBranch: 'Advans Branch'
        })
        setRows(filteredRows)
        setDataReady(true)
        setLoading(false)
      } catch (e) {
        if (e.name === 'AbortError') return
        setError(e.message)
        setDataReady(false)
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [selectedBranch])

  const filtered = useMemo(() => {
    const inMonth = (iso) => {
      if (!iso) return false
      const d = new Date(iso)
      if (isNaN(d.getTime())) return false
      return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth
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
  const collectionRatePct = useMemo(() => {
    if (totalExpectedMonth > 0) {
      const pct = (totalCollectedMonth / totalExpectedMonth) * 100
      return `${pct.toFixed(1)}%`
    }
    return '0.0%'
  }, [totalCollectedMonth, totalExpectedMonth])

  // MTD collection rate: loans maturing in current month up to today
  // Optimized: calculate during filtered calculation to avoid extra loop
  const mtdCollectionRatePct = useMemo(() => {
    const nowD = new Date()
    const y = nowD.getFullYear()
    const m = nowD.getMonth() + 1
    // Only calculate if viewing current month, otherwise use filtered data
    if (selectedYear === y && selectedMonth === m) {
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
    }
    // For past months, use filtered data (already filtered by month)
    if (totalExpectedMonth > 0) {
      const pct = (totalCollectedMonth / totalExpectedMonth) * 100
      return `${pct.toFixed(1)}%`
    }
    return '0.0%'
  }, [rows, selectedYear, selectedMonth, totalExpectedMonth, totalCollectedMonth])

  // Daily series for Expected vs Collected over selected month (based on Expected Matured On Date)
  const dailyExpectedVsCollected = useMemo(() => {
    const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
    const expByDay = Array(daysIn + 1).fill(0)
    const repByDay = Array(daysIn + 1).fill(0)
    const expByDayBranch = Array(daysIn + 1).fill(0)
    const repByDayBranch = Array(daysIn + 1).fill(0)
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
        if (selectedBranch !== 'All') {
          const b = (r['Branch Name'] || r.branch_name || 'Unknown').trim()
          if (b === selectedBranch) {
            expByDayBranch[day] += Number(r['Total Expected Repayment Derived']) || 0
            repByDayBranch[day] += Number(r['Total Repayment Derived']) || 0
          }
        }
      }
    }
    const arr = []
    for (let i = 1; i <= daysIn; i++) arr.push({ day: String(i), expected_overall: expByDay[i], collected_overall: repByDay[i], expected_branch: expByDayBranch[i], collected_branch: repByDayBranch[i] })
    return arr
  }, [rows, selectedMonth, selectedYear, selectedBranch])

  const selectedBranchLabel =
    selectedBranch === 'All' ? 'Overall' : String(selectedBranch || '').replace(/\s*branch\s*$/i, '').trim()

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

  // Show loading state until data is ready
  if (loading || !dataReady) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-gray-600">
        <div className="inline-block h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm">Loading collection data...</p>
        <p className="text-xs text-gray-500 mt-2">Fetching Zidisha loan data</p>
      </div>
    )
  }

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Zidisha Collection</h1>
          <p className="text-gray-600 mt-2">Monitor Zidisha loan collections and payment status</p>
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
          <div className="pb-0.5">
            <ZidishaBranchFilter />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Collected</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalCollectedMonth)}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <CheckCircle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">EOM collection rate</p>
              <p className="text-2xl font-bold text-gray-900">{collectionRatePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">MTD collection rate</p>
              <p className="text-2xl font-bold text-gray-900">{mtdCollectionRatePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Outstanding</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalOutstandingMonth)}</p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-red-600">
              <AlertCircle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Expected Repayment</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalExpectedMonth)}</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Clock size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* MTD Collection by Branch */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">MTD Collection by Branch</h3>
        </div>
        {(() => {
          const today = new Date()
          const isCurrentMonth = (selectedYear === today.getFullYear()) && (selectedMonth === (today.getMonth() + 1))
          // For past months, use the last day of the selected month (day 0 of next month)
          // For current month, use today as cutoff
          const cutoff = isCurrentMonth ? today : new Date(selectedYear, selectedMonth, 0)
          const agg = new Map()
          for (const r of rows) {
            const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
            if (!exp) continue
            const d = new Date(exp)
            if (isNaN(d.getTime())) continue
            if (d.getFullYear() !== selectedYear || (d.getMonth() + 1) !== selectedMonth) continue
            // For past months, include all loans (no date cutoff needed since month is complete)
            // For current month, only include loans maturing up to today
            if (isCurrentMonth && d > cutoff) continue
            const b = (r['Branch Name'] || r.branch_name || 'Unknown').trim()
            if (!b || b.toLowerCase() === 'unknown' || b.toLowerCase() === 'advans branch') continue
            const expAmt = Number(r['Total Expected Repayment Derived']) || 0
            const repAmt = Number(r['Total Repayment Derived']) || 0
            if (!agg.has(b)) agg.set(b, { expected: 0, collected: 0 })
            const cur = agg.get(b)
            cur.expected += expAmt
            cur.collected += repAmt
          }
          const items = Array.from(agg.entries())
            .map(([branch, v]) => {
              const rate = v.expected > 0 ? (v.collected / v.expected) * 100 : 0
              const to95 = v.expected > 0 ? Math.max(0, (0.95 * v.expected) - v.collected) : 0
              return { branch, ...v, rate, to95 }
            })
            .sort((a, b) => {
              if (b.rate === a.rate) return b.collected - a.collected
              return b.rate - a.rate
            })
          return (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Expected</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Collected</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">To 95%</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {items.map(r => (
                    <tr key={r.branch} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900">{r.branch}</td>
                      <td className="px-3 py-2 text-right">{formatKES(r.expected)}</td>
                      <td className="px-3 py-2 text-right">{formatKES(r.collected)}</td>
                      <td className="px-3 py-2 text-right">{r.expected > 0 ? formatKES(r.to95) : '-'}</td>
                      <td className="px-3 py-2 text-right">{r.rate.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>No data for selected period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>

      {/* Branch Gauges + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gauge: Expected vs Collected by Branch (2/3) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Expected vs Collected by Branch (Selected Month)</h3>
          {(() => {
            const agg = new Map()
            for (const r of filtered) {
              const b = (r['Branch Name'] || r.branch_name || 'Unknown').trim()
              if (!b || b.toLowerCase() === 'unknown' || b.toLowerCase() === 'advans branch') continue
              if (selectedBranch !== 'All' && b !== selectedBranch) continue
              const exp = Number(r['Total Expected Repayment Derived']) || 0
              const rep = Number(r['Total Repayment Derived']) || 0
              if (!agg.has(b)) agg.set(b, { expected: 0, collected: 0 })
              const cur = agg.get(b)
              cur.expected += exp
              cur.collected += rep
            }
            const items = Array.from(agg.entries())
              .map(([branch, v]) => {
                const rate = v.expected > 0 ? (v.collected / v.expected) * 100 : 0
                return { branch, ...v, rate }
              })
              .sort((a, b) => {
                if (b.rate === a.rate) return b.collected - a.collected
                return b.rate - a.rate
              })
            if (!items.length) return <div className="text-sm text-gray-600">No data for selected period.</div>
            return (
              <div className="space-y-3">
                {items.map((it) => {
                  const pct = it.rate
                  return (
                    <div key={it.branch} className="flex items-center space-x-3 text-sm">
                      <div className="w-48 font-medium text-gray-800">{it.branch}</div>
                      <div className="flex-1 relative h-4 bg-gray-200 rounded-full mr-2">
                        <div
                          className="absolute top-0 left-0 h-4 bg-green-500 rounded-full transition-all"
                          style={{ width: Math.min(100, pct) + '%' }}
                        ></div>
                      </div>
                      <div className="min-w-[140px] tabular-nums">{formatKES(it.collected)} / {formatKES(it.expected)}</div>
                      <div className="min-w-[50px] text-right text-gray-500">{pct.toFixed(1)}%</div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* Table: By Branch for Selected Day (1/3) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 lg:pr-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Daily Branch Breakdown</h3>
            {(() => {
              const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
              const options = Array.from({ length: daysIn }, (_, i) => i + 1)
              const value = Math.min(selectedDay, daysIn)
              return (
                <div className="flex items-center space-x-2">
                  <label className="text-xs text-gray-600">Day</label>
                  <select
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                    value={value}
                    onChange={(e) => setSelectedDay(Number(e.target.value))}
                  >
                    {options.map(dv => (
                      <option key={dv} value={dv}>{dv}</option>
                    ))}
                  </select>
                </div>
              )
            })()}
          </div>
          {(() => {
            /* no-op */
          })()}
          {(() => {
            // Ensure day state
            const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
            const day = Math.min(selectedDay, daysIn)
            // aggregate by branch for that day
            const agg = new Map()
            for (const r of rows) {
              const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
              if (!exp) continue
              const d = new Date(exp)
              if (isNaN(d.getTime())) continue
              if (d.getFullYear() !== selectedYear || (d.getMonth() + 1) !== selectedMonth || d.getDate() !== day) continue
              const b = (r['Branch Name'] || r.branch_name || 'Unknown').trim()
              if (!b || b.toLowerCase() === 'unknown' || b.toLowerCase() === 'advans branch') continue
              const expAmt = Number(r['Total Expected Repayment Derived']) || 0
              const repAmt = Number(r['Total Repayment Derived']) || 0
              if (!agg.has(b)) agg.set(b, { expected: 0, collected: 0 })
              const cur = agg.get(b)
              cur.expected += expAmt
              cur.collected += repAmt
            }
            const rowsTbl = Array.from(agg.entries()).map(([branch, v]) => ({ branch, ...v }))
              .map(it => ({ ...it, rate: it.expected > 0 ? (it.collected / it.expected) * 100 : 0 }))
              .sort((a, b) => {
                if (b.rate === a.rate) return b.collected - a.collected
                return b.rate - a.rate
              })
            return (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Total Expected</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Total Collected</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {rowsTbl.map((r) => (
                        <tr key={r.branch} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-900">{r.branch}</td>
                          <td className="px-3 py-2 text-right">{formatKES(r.expected)}</td>
                          <td className="px-3 py-2 text-right">{formatKES(r.collected)}</td>
                          <td className="px-3 py-2 text-right">{r.rate.toFixed(1)}%</td>
                        </tr>
                      ))}
                      {!rowsTbl.length && (
                        <tr>
                          <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>No data for selected day.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* Daily Expected vs Collected (Selected Month) */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Daily Expected vs Collected (Selected Month)</h3>
          <div className="text-sm text-gray-600">{selectedBranchLabel}</div>
        </div>
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyExpectedVsCollected}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip formatter={(v, n) => [formatKES(v),
                selectedBranch === 'All'
                  ? (n === 'expected_overall' ? 'Expected' : 'Repayed')
                  : (n === 'expected_branch' ? 'Expected' : 'Repayed')
              ]} />
              <Legend formatter={(v) => (
                selectedBranch === 'All'
                  ? (v === 'expected_overall' ? 'Expected' : 'Repayed')
                  : (v === 'expected_branch' ? 'Expected' : 'Repayed')
              )} />
              {selectedBranch === 'All' ? (
                <>
                  <Area type="monotone" dataKey="expected_overall" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} name="Expected" />
                  <Area type="monotone" dataKey="collected_overall" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="Repayed" />
                </>
              ) : (
                <>
                  <Area type="monotone" dataKey="expected_branch" stroke="#f97316" fill="#f97316" fillOpacity={0.2} name="Expected" />
                  <Area type="monotone" dataKey="collected_branch" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} name="Repayed" />
                </>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Collection Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Collection Status</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Matured On Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Disbursed On Date</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.map((r, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{r['Client Name'] || r.client_name || 'Unknown'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatKES(Number(r['Total Repayment Derived']) || 0)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{r['Expected Matured On Date'] || r.expected_matured_on_date || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon('Collected')}
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor('Collected')}`}>
                        Collected
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{r['Disbursed On Date'] || r.disbursed_on_date || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ZidishaCollection

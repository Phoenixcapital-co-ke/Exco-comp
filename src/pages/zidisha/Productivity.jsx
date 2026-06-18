import React, { useEffect, useMemo, useState } from 'react'
import { Activity, Users, Target, Award, ChevronDown, ChevronRight, User } from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { useZidishaBranch } from '../../context/ZidishaBranchContext.jsx'
import ZidishaBranchFilter from '../../components/ZidishaBranchFilter.jsx'

const ZIDISHA_PRODUCTS = [
  'Zidisha Kifaru',
  'Zidisha Nyati',
  'Zidisha Simba',
  'Zidisha Tembo',
  'Zidisha Express',
]

function branchKey(name) {
  return String(name || '').trim()
}

function isExcludedBranch(name) {
  const b = branchKey(name).toLowerCase()
  return !b || b === 'unknown' || b === 'advans branch'
}

function aggregateMtdByBranchAndOfficer(rows, selectedYear, selectedMonth) {
  const today = new Date()
  const isCurrentMonth =
    selectedYear === today.getFullYear() && selectedMonth === today.getMonth() + 1
  const cutoff = isCurrentMonth ? today : new Date(selectedYear, selectedMonth, 0)

  const agg = new Map()

  for (const r of rows) {
    const exp = r['Expected Matured On Date'] || r.expected_matured_on_date
    if (!exp) continue
    const d = new Date(exp)
    if (isNaN(d.getTime())) continue
    if (d.getFullYear() !== selectedYear || d.getMonth() + 1 !== selectedMonth) continue
    if (isCurrentMonth && d > cutoff) continue

    const branch = branchKey(r['Branch Name'] || r.branch_name || 'Unknown')
    if (isExcludedBranch(branch)) continue

    const officer =
      (r['Loan Officer Name'] || r.loan_officer_name || 'Unknown').trim() || 'Unknown'
    const expAmt = Number(r['Total Expected Repayment Derived']) || 0
    const repAmt = Number(r['Total Repayment Derived']) || 0

    if (!agg.has(branch)) {
      agg.set(branch, { branch, expected: 0, collected: 0, officers: new Map() })
    }
    const entry = agg.get(branch)
    entry.expected += expAmt
    entry.collected += repAmt

    if (!entry.officers.has(officer)) {
      entry.officers.set(officer, { officer, expected: 0, collected: 0 })
    }
    const officerEntry = entry.officers.get(officer)
    officerEntry.expected += expAmt
    officerEntry.collected += repAmt
  }

  return Array.from(agg.values())
    .map((entry) => {
      const rate = entry.expected > 0 ? (entry.collected / entry.expected) * 100 : 0
      const to95 = entry.expected > 0 ? Math.max(0, 0.95 * entry.expected - entry.collected) : 0
      const officers = Array.from(entry.officers.values())
        .map((o) => ({
          ...o,
          rate: o.expected > 0 ? (o.collected / o.expected) * 100 : 0,
          to95: o.expected > 0 ? Math.max(0, 0.95 * o.expected - o.collected) : 0,
        }))
        .sort((a, b) => {
          if (b.rate === a.rate) return b.collected - a.collected
          return b.rate - a.rate
        })
      return { ...entry, rate, to95, officers }
    })
    .sort((a, b) => {
      if (b.rate === a.rate) return b.collected - a.collected
      return b.rate - a.rate
    })
}

function ZidishaProductivity() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dataReady, setDataReady] = useState(false)
  const [expandedBranch, setExpandedBranch] = useState(null)
  const { selectedBranch } = useZidishaBranch()

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        setDataReady(false)
        const filteredRows = await fetchAllZidishaRows({
          signal: controller.signal,
          products: ZIDISHA_PRODUCTS,
          branch: selectedBranch !== 'All' ? selectedBranch : undefined,
          excludeBranch: 'Advans Branch',
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

  const mtdBranchRows = useMemo(
    () => aggregateMtdByBranchAndOfficer(rows, selectedYear, selectedMonth),
    [rows, selectedYear, selectedMonth],
  )

  const summary = useMemo(() => {
    const totalExpected = mtdBranchRows.reduce((s, r) => s + r.expected, 0)
    const totalCollected = mtdBranchRows.reduce((s, r) => s + r.collected, 0)
    const avgRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0

    const officerSet = new Set()
    for (const branch of mtdBranchRows) {
      for (const o of branch.officers) officerSet.add(o.officer)
    }

    let topOfficer = null
    for (const branch of mtdBranchRows) {
      for (const o of branch.officers) {
        if (!topOfficer || o.rate > topOfficer.rate || (o.rate === topOfficer.rate && o.collected > topOfficer.collected)) {
          topOfficer = o
        }
      }
    }

    return {
      totalExpected,
      totalCollected,
      avgRate,
      activeOfficers: officerSet.size,
      topOfficer: topOfficer?.officer || '—',
      topOfficerRate: topOfficer?.rate ?? 0,
    }
  }, [mtdBranchRows])

  if (loading || !dataReady) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-gray-600">
        <div className="inline-block h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">Loading productivity data...</p>
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
          <h1 className="text-3xl font-bold text-gray-900">Zidisha Productivity</h1>
          <p className="text-gray-600 mt-2">
            MTD collection performance by branch and loan officer
          </p>
        </div>
        <div className="flex items-end space-x-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Month</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Year</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="pb-0.5">
            <ZidishaBranchFilter />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">MTD Collected</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(summary.totalCollected)}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Activity size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Collection Rate</p>
              <p className="text-2xl font-bold text-gray-900">{summary.avgRate.toFixed(1)}%</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <Target size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Loan Officers</p>
              <p className="text-2xl font-bold text-gray-900">{summary.activeOfficers}</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <Users size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Top Performer</p>
              <p className="text-lg font-bold text-gray-900 truncate max-w-[140px]" title={summary.topOfficer}>
                {summary.topOfficer}
              </p>
              {summary.topOfficer !== '—' && (
                <p className="text-xs text-gray-500 mt-0.5">{summary.topOfficerRate.toFixed(1)}% rate</p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Award size={24} />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-gray-900">MTD Collection by Branch</h3>
        </div>
        <p className="text-sm text-gray-500 mb-4">Click a branch to view loan officer performance</p>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 w-8" />
                <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Expected</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Collected</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">To 95%</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {mtdBranchRows.map((row, idx) => (
                <React.Fragment key={row.branch}>
                  <tr
                    className={`transition-colors ${
                      expandedBranch === row.branch ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    } ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedBranch(expandedBranch === row.branch ? null : row.branch)
                        }
                        className="p-1 rounded hover:bg-indigo-100 text-gray-500 hover:text-indigo-600"
                        aria-label={expandedBranch === row.branch ? 'Collapse' : 'Expand'}
                      >
                        {expandedBranch === row.branch ? (
                          <ChevronDown size={18} />
                        ) : (
                          <ChevronRight size={18} />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-gray-900 font-medium">{row.branch}</td>
                    <td className="px-3 py-2 text-right">{formatKES(row.expected)}</td>
                    <td className="px-3 py-2 text-right">{formatKES(row.collected)}</td>
                    <td className="px-3 py-2 text-right">
                      {row.expected > 0 ? formatKES(row.to95) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{row.rate.toFixed(1)}%</td>
                  </tr>

                  {expandedBranch === row.branch && (
                    <tr className="bg-indigo-50/40">
                      <td colSpan={6} className="px-4 pb-4 pt-2">
                        <div className="bg-white rounded-lg border border-indigo-200 overflow-hidden shadow-sm">
                          <div className="px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-indigo-100">
                            <h4 className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
                              <User size={15} />
                              Loan Officers — {row.branch}
                            </h4>
                          </div>
                          {row.officers.length ? (
                            <table className="min-w-full divide-y divide-gray-100 text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-2 text-left font-medium text-gray-600">
                                    Loan Officer
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    Expected
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    Collected
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    To 95%
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    Rate
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {row.officers.map((officer) => (
                                  <tr key={officer.officer} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 text-gray-900">{officer.officer}</td>
                                    <td className="px-4 py-2 text-right">
                                      {formatKES(officer.expected)}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {formatKES(officer.collected)}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {officer.expected > 0 ? formatKES(officer.to95) : '-'}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {officer.rate.toFixed(1)}%
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="px-4 py-6 text-center text-sm text-gray-500">
                              No loan officer data for this branch.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}

              {!mtdBranchRows.length && (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>
                    No data for selected period.
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

export default ZidishaProductivity

import React, { useEffect, useMemo, useState } from 'react'
import { Activity, Users, Target, Award, ChevronDown, ChevronRight, User } from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { API_URLS } from '../../utils/api.js'
import { useBodaBranch } from '../../context/BodaBranchContext.jsx'
import ParArcGauge from '../../components/ParArcGauge.jsx'

const TARGET_RATE = 0.97

function BodaProductivity() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedBranch, setExpandedBranch] = useState(null)
  const [parAging, setParAging] = useState({
    par: null,
    par7: null,
    par14: null,
    par21: null,
    par21plus: null,
    atRiskOutstanding: null,
    par7Outstanding: null,
    par14Outstanding: null,
    par21Outstanding: null,
    par21plusOutstanding: null,
    byBranch: {},
    byOfficer: {},
  })
  const [parLoading, setParLoading] = useState(true)
  const { selectedBranch, setSelectedBranch, branchOptions, cleanBranchLabel } = useBodaBranch()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const today = new Date()
        const isCurrentMonth =
          selectedYear === today.getFullYear() && selectedMonth === today.getMonth() + 1
        const cutoffDay = isCurrentMonth
          ? today.getDate()
          : new Date(selectedYear, selectedMonth, 0).getDate()
        const params = new URLSearchParams({
          month: String(selectedMonth),
          year: String(selectedYear),
          cutoffDay: String(cutoffDay),
        })
        if (selectedBranch && String(selectedBranch).toLowerCase() !== 'all') {
          params.set('branch', String(selectedBranch))
        }
        const res = await fetch(`${API_URLS.boda.scheduleMtdByBranchOfficers}?${params.toString()}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Failed to load productivity data (${res.status})`)
        }
        const data = await res.json()
        setRows(Array.isArray(data.rows) ? data.rows : [])
      } catch (e) {
        setError(e.message)
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    if (selectedMonth && selectedYear) load()
  }, [selectedMonth, selectedYear, selectedBranch])

  // PAR cards (same methodology as /boda/dashboard; aging via unpaid schedule days)
  useEffect(() => {
    const controller = new AbortController()
    const loadPar = async () => {
      setParLoading(true)
      try {
        const params = new URLSearchParams()
        if (selectedBranch && String(selectedBranch).toLowerCase() !== 'all') {
          params.set('branch', String(selectedBranch))
        }
        const qs = params.toString()
        const res = await fetch(`${API_URLS.boda.parAging}${qs ? `?${qs}` : ''}`, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Failed to load PAR (${res.status})`)
        }
        const data = await res.json()
        setParAging({
          par: data.par ?? null,
          par7: data.par7 ?? null,
          par14: data.par14 ?? null,
          par21: data.par21 ?? null,
          par21plus: data.par21plus ?? null,
          atRiskOutstanding: data.atRiskOutstanding ?? null,
          par7Outstanding: data.par7Outstanding ?? null,
          par14Outstanding: data.par14Outstanding ?? null,
          par21Outstanding: data.par21Outstanding ?? null,
          par21plusOutstanding: data.par21plusOutstanding ?? null,
          byBranch: data.byBranch && typeof data.byBranch === 'object' ? data.byBranch : {},
          byOfficer: data.byOfficer && typeof data.byOfficer === 'object' ? data.byOfficer : {},
        })
      } catch (e) {
        if (e.name === 'AbortError') return
        setParAging({
          par: null,
          par7: null,
          par14: null,
          par21: null,
          par21plus: null,
          atRiskOutstanding: null,
          par7Outstanding: null,
          par14Outstanding: null,
          par21Outstanding: null,
          par21plusOutstanding: null,
          byBranch: {},
          byOfficer: {},
        })
      } finally {
        setParLoading(false)
      }
    }
    loadPar()
    return () => controller.abort()
  }, [selectedBranch])

  const lookupBranchPar = (branchName, byBranch) => {
    if (!byBranch || typeof byBranch !== 'object') return null
    const want = String(branchName || '').trim().toLowerCase()
    if (!want) return null
    if (byBranch[branchName]?.par != null) return byBranch[branchName]
    for (const [k, v] of Object.entries(byBranch)) {
      if (String(k).trim().toLowerCase() === want) return v
    }
    return null
  }

  const lookupOfficerPar = (branchName, officerName, byOfficer) => {
    if (!byOfficer || typeof byOfficer !== 'object') return null
    const wantBranch = String(branchName || '').trim().toLowerCase()
    const wantOfficer = String(officerName || '').trim().toLowerCase()
    let branchBucket = byOfficer[branchName]
    if (!branchBucket) {
      const entry = Object.entries(byOfficer).find(
        ([k]) => String(k).trim().toLowerCase() === wantBranch,
      )
      branchBucket = entry?.[1]
    }
    if (!branchBucket || typeof branchBucket !== 'object') return null
    if (branchBucket[officerName]?.par != null) return branchBucket[officerName]
    for (const [k, v] of Object.entries(branchBucket)) {
      if (String(k).trim().toLowerCase() === wantOfficer) return v
    }
    return null
  }

  const formatParPct = (v) =>
    v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`

  const parCellClass = (v, threshold = 35) =>
    v != null && Number(v) >= threshold ? 'text-[#EF5322]' : 'text-gray-900'

  const mtdBranchRows = useMemo(
    () =>
      rows.map((r) => {
        const expected = Number(r.expected || 0)
        const collected = Number(r.collected || 0)
        const rate = Number(r.ratePercent || 0)
        const to97 = expected > 0 ? Math.max(0, TARGET_RATE * expected - collected) : 0
        const branchPar = lookupBranchPar(r.branch, parAging.byBranch)
        const officers = Array.isArray(r.officers)
          ? r.officers.map((o) => {
              const oExpected = Number(o.expected || 0)
              const oCollected = Number(o.collected || 0)
              const oRate = Number(o.ratePercent || 0)
              const oPar = lookupOfficerPar(r.branch, o.officer, parAging.byOfficer)
              return {
                ...o,
                expected: oExpected,
                collected: oCollected,
                rate: oRate,
                to97: oExpected > 0 ? Math.max(0, TARGET_RATE * oExpected - oCollected) : 0,
                par: oPar?.par ?? null,
                par7: oPar?.par7 ?? null,
                par14: oPar?.par14 ?? null,
                par21: oPar?.par21 ?? null,
                par21plus: oPar?.par21plus ?? null,
              }
            })
          : []
        return {
          ...r,
          expected,
          collected,
          rate,
          to97,
          officers,
          par: branchPar?.par ?? null,
          par7: branchPar?.par7 ?? null,
          par14: branchPar?.par14 ?? null,
          par21: branchPar?.par21 ?? null,
          par21plus: branchPar?.par21plus ?? null,
        }
      }),
    [rows, parAging.byBranch, parAging.byOfficer],
  )

  const summary = useMemo(() => {
    const totalExpected = mtdBranchRows.reduce((s, r) => s + r.expected, 0)
    const totalCollected = mtdBranchRows.reduce((s, r) => s + r.collected, 0)
    const avgRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0

    const officerSet = new Set()
    let topOfficer = null
    for (const branch of mtdBranchRows) {
      for (const o of branch.officers) {
        officerSet.add(o.officer)
        if (
          !topOfficer ||
          o.rate > topOfficer.rate ||
          (o.rate === topOfficer.rate && o.collected > topOfficer.collected)
        ) {
          topOfficer = o
        }
      }
    }

    return {
      totalCollected,
      avgRate,
      activeOfficers: officerSet.size,
      topOfficer: topOfficer?.officer || '—',
      topOfficerRate: topOfficer?.rate ?? 0,
    }
  }, [mtdBranchRows])

  if (loading) {
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
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Boda Productivity</h1>
          <p className="text-gray-600 mt-2">
            MTD collection performance by branch and loan officer
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {branchOptions.length > 1 && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Branch</label>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                {branchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b === 'All' ? 'All branches' : cleanBranchLabel(b)}
                  </option>
                ))}
              </select>
            </div>
          )}
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
        <ParArcGauge
          label="PAR"
          hint="Total portfolio at risk"
          value={parAging.par}
          amount={parAging.atRiskOutstanding}
          loading={parLoading}
          dangerFrom={35}
        />
        <ParArcGauge
          label="PAR 1-7"
          hint="Overdue 1–7 days"
          value={parAging.par7}
          amount={parAging.par7Outstanding}
          loading={parLoading}
          dangerFrom={15}
        />
        <ParArcGauge
          label="PAR 8-14"
          hint="Overdue 8–14 days"
          value={parAging.par14}
          amount={parAging.par14Outstanding}
          loading={parLoading}
          dangerFrom={15}
        />
        <ParArcGauge
          label="PAR 15-21"
          hint="Overdue 15–21 days"
          value={parAging.par21}
          amount={parAging.par21Outstanding}
          loading={parLoading}
          dangerFrom={15}
        />
        <ParArcGauge
          label="PAR 21+"
          hint="Overdue 21+ days"
          value={parAging.par21plus}
          amount={parAging.par21plusOutstanding}
          loading={parLoading}
          dangerFrom={15}
        />
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
                <th className="px-3 py-2 text-right font-medium text-gray-600">To 97%</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">PAR</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">PAR 1-7</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">PAR 8-14</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">PAR 15-21</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">PAR 21+</th>
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
                      {row.expected > 0 ? formatKES(row.to97) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{row.rate.toFixed(1)}%</td>
                    <td className={`px-3 py-2 text-right font-semibold ${parCellClass(row.par, 35)}`}>
                      {formatParPct(row.par)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${parCellClass(row.par7, 15)}`}>
                      {formatParPct(row.par7)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${parCellClass(row.par14, 15)}`}>
                      {formatParPct(row.par14)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${parCellClass(row.par21, 15)}`}>
                      {formatParPct(row.par21)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${parCellClass(row.par21plus, 15)}`}>
                      {formatParPct(row.par21plus)}
                    </td>
                  </tr>

                  {expandedBranch === row.branch && (
                    <tr className="bg-indigo-50/40">
                      <td colSpan={11} className="px-4 pb-4 pt-2">
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
                                    To 97%
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    Rate
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    PAR
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    PAR 1-7
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    PAR 8-14
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    PAR 15-21
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-600">
                                    PAR 21+
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
                                      {officer.expected > 0 ? formatKES(officer.to97) : '-'}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      {officer.rate.toFixed(1)}%
                                    </td>
                                    <td
                                      className={`px-4 py-2 text-right font-semibold ${parCellClass(officer.par, 35)}`}
                                    >
                                      {formatParPct(officer.par)}
                                    </td>
                                    <td
                                      className={`px-4 py-2 text-right font-semibold ${parCellClass(officer.par7, 15)}`}
                                    >
                                      {formatParPct(officer.par7)}
                                    </td>
                                    <td
                                      className={`px-4 py-2 text-right font-semibold ${parCellClass(officer.par14, 15)}`}
                                    >
                                      {formatParPct(officer.par14)}
                                    </td>
                                    <td
                                      className={`px-4 py-2 text-right font-semibold ${parCellClass(officer.par21, 15)}`}
                                    >
                                      {formatParPct(officer.par21)}
                                    </td>
                                    <td
                                      className={`px-4 py-2 text-right font-semibold ${parCellClass(officer.par21plus, 15)}`}
                                    >
                                      {formatParPct(officer.par21plus)}
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
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={10}>
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

export default BodaProductivity

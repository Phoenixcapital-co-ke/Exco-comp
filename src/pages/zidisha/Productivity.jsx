import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Users,
  Target,
  Award,
  ChevronDown,
  ChevronRight,
  User,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { API_URLS } from '../../utils/api.js'
import { useZidishaBranch } from '../../context/ZidishaBranchContext.jsx'
import ZidishaBranchFilter from '../../components/ZidishaBranchFilter.jsx'

const TARGET_RATE = 0.95

function formatWeekLabel(monday, friday) {
  if (!monday || !friday) return ''
  const opts = { day: 'numeric', month: 'short' }
  const start = new Date(`${monday}T12:00:00`)
  const end = new Date(`${friday}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${monday} → ${friday}`
  const sameYear = start.getFullYear() === end.getFullYear()
  const startStr = start.toLocaleDateString('en-GB', sameYear ? opts : { ...opts, year: 'numeric' })
  const endStr = end.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })
  return `${startStr} – ${endStr}`
}

function normalizeBranchRows(rawRows) {
  return (rawRows || []).map((r) => {
    const expected = Number(r.expected || 0)
    const collected = Number(r.collected || 0)
    const rate = Number(r.ratePercent || 0)
    const to95 = expected > 0 ? Math.max(0, TARGET_RATE * expected - collected) : 0
    const officers = Array.isArray(r.officers)
      ? r.officers.map((o) => {
          const oExpected = Number(o.expected || 0)
          const oCollected = Number(o.collected || 0)
          const oRate = Number(o.ratePercent || 0)
          return {
            ...o,
            expected: oExpected,
            collected: oCollected,
            rate: oRate,
            to95: oExpected > 0 ? Math.max(0, TARGET_RATE * oExpected - oCollected) : 0,
          }
        })
      : []
    return { ...r, expected, collected, rate, to95, officers }
  })
}

function flattenOfficerRanks(branchRows) {
  const officers = []
  for (const branch of branchRows || []) {
    for (const o of branch.officers || []) {
      officers.push({
        officer: o.officer,
        branch: branch.branch,
        expected: o.expected,
        collected: o.collected,
        to95: o.to95,
        rate: o.rate,
      })
    }
  }
  return officers.sort((a, b) => {
    if (b.rate === a.rate) return b.collected - a.collected
    return b.rate - a.rate
  })
}

function buildRankMap(keysInOrder) {
  const map = new Map()
  keysInOrder.forEach((key, idx) => {
    if (!map.has(key)) map.set(key, idx + 1)
  })
  return map
}

function RankMoveIndicator({ currentRank, previousRank }) {
  if (previousRank == null || currentRank == null) {
    return <Minus size={14} className="text-gray-300" aria-label="No prior rank" />
  }
  if (currentRank < previousRank) {
    return <ArrowUp size={14} className="text-green-600" aria-label={`Up from ${previousRank}`} />
  }
  if (currentRank > previousRank) {
    return <ArrowDown size={14} className="text-red-600" aria-label={`Down from ${previousRank}`} />
  }
  return <Minus size={14} className="text-gray-400" aria-label="Unchanged" />
}

function ZidishaProductivity() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([])
  const [prevRows, setPrevRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedBranch, setExpandedBranch] = useState(null)
  const [weeklyTop, setWeeklyTop] = useState({ topPerformer: null, week: null })
  const { selectedBranch } = useZidishaBranch()

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

        const fetchRows = async (day) => {
          const p = new URLSearchParams(params)
          p.set('cutoffDay', String(day))
          const res = await fetch(
            `${API_URLS.zidisha.productivityMtdByBranchOfficers}?${p.toString()}`,
            { credentials: 'include' },
          )
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body?.error || `Failed to load productivity data (${res.status})`)
          }
          const data = await res.json()
          return Array.isArray(data.rows) ? data.rows : []
        }

        const current = await fetchRows(cutoffDay)
        setRows(current)

        if (cutoffDay > 1) {
          try {
            setPrevRows(await fetchRows(cutoffDay - 1))
          } catch {
            setPrevRows([])
          }
        } else {
          setPrevRows([])
        }
      } catch (e) {
        setError(e.message)
        setRows([])
        setPrevRows([])
      } finally {
        setLoading(false)
      }
    }
    if (selectedMonth && selectedYear) load()
  }, [selectedMonth, selectedYear, selectedBranch])

  useEffect(() => {
    const controller = new AbortController()
    const loadWeekly = async () => {
      try {
        const params = new URLSearchParams()
        if (selectedBranch && String(selectedBranch).toLowerCase() !== 'all') {
          params.set('branch', String(selectedBranch))
        }
        const qs = params.toString()
        const res = await fetch(
          `${API_URLS.zidisha.productivityWeeklyTopPerformer}${qs ? `?${qs}` : ''}`,
          { credentials: 'include', signal: controller.signal },
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Failed to load weekly top performer (${res.status})`)
        }
        const data = await res.json()
        setWeeklyTop({
          topPerformer: data.topPerformer || null,
          week: data.week || null,
        })
      } catch (e) {
        if (e.name === 'AbortError') return
        setWeeklyTop({ topPerformer: null, week: null })
      }
    }
    loadWeekly()
    return () => controller.abort()
  }, [selectedBranch])

  const mtdBranchRows = useMemo(() => normalizeBranchRows(rows), [rows])
  const prevBranchRows = useMemo(() => normalizeBranchRows(prevRows), [prevRows])

  const allOfficerRanks = useMemo(() => flattenOfficerRanks(mtdBranchRows), [mtdBranchRows])
  const prevOfficerRanks = useMemo(() => flattenOfficerRanks(prevBranchRows), [prevBranchRows])

  const prevOfficerRankMap = useMemo(
    () =>
      buildRankMap(
        prevOfficerRanks.map((o) => `${String(o.branch).toLowerCase()}::${String(o.officer).toLowerCase()}`),
      ),
    [prevOfficerRanks],
  )

  const prevBranchRankMap = useMemo(
    () => buildRankMap(prevBranchRows.map((b) => String(b.branch).toLowerCase())),
    [prevBranchRows],
  )

  const prevBranchOfficerRankMaps = useMemo(() => {
    const maps = new Map()
    for (const branch of prevBranchRows) {
      const keys = (branch.officers || []).map((o) => String(o.officer).toLowerCase())
      maps.set(String(branch.branch).toLowerCase(), buildRankMap(keys))
    }
    return maps
  }, [prevBranchRows])

  const summary = useMemo(() => {
    const totalExpected = mtdBranchRows.reduce((s, r) => s + r.expected, 0)
    const totalCollected = mtdBranchRows.reduce((s, r) => s + r.collected, 0)
    const avgRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0
    const officerSet = new Set(allOfficerRanks.map((o) => `${o.branch}::${o.officer}`))

    return {
      totalCollected,
      avgRate,
      activeOfficers: officerSet.size,
    }
  }, [mtdBranchRows, allOfficerRanks])

  const topWeeklyName = weeklyTop.topPerformer?.officer || '—'
  const topWeeklyRate = Number(weeklyTop.topPerformer?.ratePercent ?? 0)
  const topWeeklyBranch = weeklyTop.topPerformer?.branch || ''
  const weekLabel = formatWeekLabel(weeklyTop.week?.monday, weeklyTop.week?.friday)

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
              <p className="text-xs text-gray-500 mb-0.5">Last week (Mon–Fri)</p>
              <p className="text-lg font-bold text-gray-900 truncate max-w-[160px]" title={topWeeklyName}>
                {topWeeklyName}
              </p>
              {topWeeklyName !== '—' && (
                <>
                  <p className="text-xs text-gray-500 mt-0.5">{topWeeklyRate.toFixed(1)}% rate</p>
                  {(topWeeklyBranch || weekLabel) && (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[160px]" title={`${topWeeklyBranch}${weekLabel ? ` · ${weekLabel}` : ''}`}>
                      {[topWeeklyBranch, weekLabel].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Award size={24} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-semibold text-gray-900">Loan Officer Ranking (All Branches)</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Ranked by collection rate across all branches · arrows vs yesterday
            <span className="inline-flex items-center gap-2 ml-2">
              <span className="inline-flex items-center gap-0.5 text-green-600"><ArrowUp size={12} /> up</span>
              <span className="inline-flex items-center gap-0.5 text-red-600"><ArrowDown size={12} /> down</span>
            </span>
          </p>

          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-16">#</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Loan Officer</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Branch</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Expected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Collected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">To 95%</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Rate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {allOfficerRanks.map((officer, idx) => {
                  const key = `${String(officer.branch).toLowerCase()}::${String(officer.officer).toLowerCase()}`
                  const currentRank = idx + 1
                  const previousRank = prevOfficerRankMap.get(key) ?? null
                  return (
                  <tr
                    key={`${officer.branch}-${officer.officer}`}
                    className={`hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-3 py-2 text-gray-500 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {currentRank}
                        <RankMoveIndicator currentRank={currentRank} previousRank={previousRank} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-900 font-medium">{officer.officer}</td>
                    <td className="px-3 py-2 text-gray-700">{officer.branch}</td>
                    <td className="px-3 py-2 text-right">{formatKES(officer.expected)}</td>
                    <td className="px-3 py-2 text-right">{formatKES(officer.collected)}</td>
                    <td className="px-3 py-2 text-right">
                      {officer.expected > 0 ? formatKES(officer.to95) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{officer.rate.toFixed(1)}%</td>
                  </tr>
                  )
                })}

                {!allOfficerRanks.length && (
                  <tr>
                    <td className="px-3 py-6 text-center text-gray-500" colSpan={7}>
                      No loan officer data for selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-semibold text-gray-900">MTD Collection by Branch</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Click a branch to view loan officers · arrows vs yesterday
          </p>

          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
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
                {mtdBranchRows.map((row, idx) => {
                  const currentRank = idx + 1
                  const previousRank = prevBranchRankMap.get(String(row.branch).toLowerCase()) ?? null
                  return (
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
                      <td className="px-3 py-2 text-gray-900 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {row.branch}
                          <RankMoveIndicator currentRank={currentRank} previousRank={previousRank} />
                        </span>
                      </td>
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
                                    <th className="px-4 py-2 text-left font-medium text-gray-600 w-12">
                                      #
                                    </th>
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
                                  {row.officers.map((officer, oIdx) => {
                                    const currentOfficerRank = oIdx + 1
                                    const previousOfficerRank =
                                      prevBranchOfficerRankMaps
                                        .get(String(row.branch).toLowerCase())
                                        ?.get(String(officer.officer).toLowerCase()) ?? null
                                    return (
                                    <tr key={officer.officer} className="hover:bg-gray-50">
                                      <td className="px-4 py-2 text-gray-500">
                                        <span className="inline-flex items-center gap-1.5">
                                          {currentOfficerRank}
                                          <RankMoveIndicator
                                            currentRank={currentOfficerRank}
                                            previousRank={previousOfficerRank}
                                          />
                                        </span>
                                      </td>
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
                                    )
                                  })}
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
                  )
                })}

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
    </div>
  )
}

export default ZidishaProductivity

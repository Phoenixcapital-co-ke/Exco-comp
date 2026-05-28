import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { AlertTriangle, TrendingUp, Loader2, Play } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { useLogbookCurrency } from '../../context/LogbookCurrencyContext.jsx'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

function LogbookPAR({ country }) {
  const { convert, formatMoney } = useLogbookCurrency()
  const [triggerLoading, setTriggerLoading] = useState(false)
  const [triggerMessage, setTriggerMessage] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [branchData, setBranchData] = useState([])
  const [branchLoading, setBranchLoading] = useState(true)
  const [borrowerData, setBorrowerData] = useState([])
  const [borrowerLoading, setBorrowerLoading] = useState(true)
  const [borrowerBranchFilter, setBorrowerBranchFilter] = useState('ALL')
  const [progress, setProgress] = useState(null)
  const [lastRunTime, setLastRunTime] = useState(null)
  const [loanOfficers, setLoanOfficers] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')

  const loadLoanOfficers = useCallback(async () => {
    try {
      const res = await fetch(API_URLS.loanOfficers.list, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load loan officers')
      const data = await res.json()
      setLoanOfficers(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Error loading loan officers:', e)
      setLoanOfficers([])
    }
  }, [country])

  const loadLastRunTime = useCallback(async () => {
    try {
      const res = await fetch(API_URLS.par.lastRun, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setLastRunTime(data.last_run_time)
      }
    } catch (e) {
      console.error('Error loading last run time:', e)
    }
  }, [])

  const loadBranchData = useCallback(async () => {
    try {
      setBranchLoading(true)
      const base = API_URLS.par.branches
      const url = country ? `${base}?country=${encodeURIComponent(country)}` : base
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`Failed to load branch data: ${res.status}`)
      }
      const data = await res.json()
      setBranchData(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Error loading branch data:', e)
      setBranchData([])
    } finally {
      setBranchLoading(false)
    }
  }, [country])

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true)
      const historyBase = API_URLS.par.history
      const historyUrl = country ? `${historyBase}?country=${encodeURIComponent(country)}` : historyBase
      const historyRes = await fetch(historyUrl, { credentials: 'include' })
      const historyData = await historyRes.json().catch(() => [])
      setHistory(Array.isArray(historyData) ? historyData : [])
    } catch (e) {
      console.error('Error loading history:', e)
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [country])

  const loadBorrowerData = useCallback(async () => {
    try {
      setBorrowerLoading(true)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
      
      const base = API_URLS.par.borrowerAccess
      const url = country ? `${base}?country=${encodeURIComponent(country)}` : base
      const res = await fetch(url, { 
        credentials: 'include',
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      
      if (!res.ok) {
        throw new Error(`Failed to load borrower access data: ${res.status}`)
      }
      const data = await res.json()
      setBorrowerData(Array.isArray(data) ? data : [])
    } catch (e) {
      if (e.name === 'AbortError') {
        console.error('Borrower access data request timed out')
        setBorrowerData([])
      } else {
      console.error('Error loading borrower access data:', e)
      setBorrowerData([])
      }
    } finally {
      setBorrowerLoading(false)
    }
  }, [])

  const triggerSnapshot = async () => {
    let eventSource = null
    try {
      setTriggerLoading(true)
      setTriggerMessage(null)
      setProgress({ current: 0, total: 0, branch: null, status: 'starting' })

      // Connect to SSE for progress updates
      const progressBase = API_URLS.par.progress
      const progressUrl = country ? `${progressBase}?country=${encodeURIComponent(country)}` : progressBase
      eventSource = new EventSource(progressUrl, { withCredentials: true })
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          setProgress(data)
          
          if (data.status === 'completed' || data.status === 'error') {
            eventSource.close()
          }
        } catch (e) {
          console.error('Error parsing progress event:', e)
        }
      }
      eventSource.onerror = (error) => {
        console.error('SSE error:', error)
        eventSource.close()
      }

      // Trigger the snapshot
      const snapshotBase = API_URLS.par.fetchSnapshot
      const snapshotUrl = country ? `${snapshotBase}?country=${encodeURIComponent(country)}` : snapshotBase
      const res = await fetch(snapshotUrl, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error || `Request failed (${res.status})`)
      }
      const data = await res.json()
      // Reload all data after snapshot
      await Promise.all([loadHistory(), loadBranchData(), loadBorrowerData(), loadLoanOfficers(), loadLastRunTime()])
      
      // Wait a bit for final progress event
      setTimeout(() => {
        setProgress(null)
      }, 1000)
    } catch (err) {
      setTriggerMessage(`Error: ${err.message}`)
      setProgress(null)
      if (eventSource) eventSource.close()
    } finally {
      setTriggerLoading(false)
      if (eventSource) {
        setTimeout(() => eventSource.close(), 2000)
      }
    }
  }

  useEffect(() => {
    // Load all data in parallel for better performance
    Promise.all([
      loadHistory(),
      loadBranchData(),
      loadBorrowerData(),
      loadLoanOfficers(),
    loadLastRunTime()
    ]).catch(e => {
      console.error('Error loading initial data:', e)
    })
    
    // Refresh last run time every 30 seconds
    const interval = setInterval(loadLastRunTime, 30000)
    return () => clearInterval(interval)
  }, [loadHistory, loadBranchData, loadBorrowerData, loadLoanOfficers, loadLastRunTime])

  // Always compute totals from branch-level data (it is already country-filtered and branch-scoped by backend).
  // This allows PAR 30/60/90 to be shown without changing the stored PAR history schema.
  const scopedTotals = useMemo(() => {
    const open = Array.isArray(branchData) ? branchData.reduce((sum, b) => sum + (Number(b.openLoans) || 0), 0) : 0
    const pastMissed = Array.isArray(branchData) ? branchData.reduce((sum, b) => sum + (Number(b.pastMissed) || 0), 0) : 0
    const par30 = Array.isArray(branchData) ? branchData.reduce((sum, b) => sum + (Number(b.par30) || 0), 0) : 0
    const par60 = Array.isArray(branchData) ? branchData.reduce((sum, b) => sum + (Number(b.par60) || 0), 0) : 0
    const par90 = Array.isArray(branchData) ? branchData.reduce((sum, b) => sum + (Number(b.par90) || 0), 0) : 0
    return { openLoans: open, pastMissed, par30, par60, par90 }
  }, [branchData])

  const parNowRate = useMemo(() => {
    return scopedTotals.openLoans > 0 ? (scopedTotals.pastMissed / scopedTotals.openLoans) * 100 : null
  }, [scopedTotals])

  const par30Rate = useMemo(() => {
    return scopedTotals.openLoans > 0 ? (scopedTotals.par30 / scopedTotals.openLoans) * 100 : null
  }, [scopedTotals])

  const par60Rate = useMemo(() => {
    return scopedTotals.openLoans > 0 ? (scopedTotals.par60 / scopedTotals.openLoans) * 100 : null
  }, [scopedTotals])

  const par90Rate = useMemo(() => {
    return scopedTotals.openLoans > 0 ? (scopedTotals.par90 / scopedTotals.openLoans) * 100 : null
  }, [scopedTotals])

  const branchOptions = useMemo(() => {
    const options = [{ code: 'ALL', name: 'All Branches' }]
    const seen = new Set()
    for (const branch of branchData) {
      if (!seen.has(branch.code)) {
        seen.add(branch.code)
        options.push({ code: branch.code, name: branch.name || branch.code })
      }
    }
    return options
  }, [branchData])

  // Create a mapping from branch code to branch name
  const branchCodeToName = useMemo(() => {
    const map = new Map()
    for (const branch of branchData) {
      map.set(branch.code, branch.name || branch.code)
    }
    return map
  }, [branchData])

  const filteredBorrowerData = useMemo(() => {
    if (borrowerBranchFilter === 'ALL') return borrowerData
    return borrowerData.filter(
      (entry) => Array.isArray(entry.branches) && entry.branches.includes(borrowerBranchFilter)
    )
  }, [borrowerData, borrowerBranchFilter])

  const loanOfficerMap = useMemo(() => {
    const map = new Map()
    for (const officer of loanOfficers) {
      if (officer?.borrowerAccessId) {
        map.set(String(officer.borrowerAccessId), officer.name || officer.borrowerAccessId)
      }
    }
    return map
  }, [loanOfficers])

  // Extract available months from PAR history (use string month key derived from time column)
  const monthOptions = useMemo(() => {
    if (!history.length) return []
    
    const map = new Map()

    for (const entry of history) {
      const rawTime = entry.time || entry.Time
      if (!rawTime) continue
      const timeStr = String(rawTime)
      // Expect ISO-like time, e.g. 2025-12-04T...
      const key = timeStr.slice(0, 7) // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(key)) continue

      if (!map.has(key)) {
        // Build label strictly from the YYYY-MM key to avoid timezone shifts
        const [yearStr, monthStr] = key.split('-')
        const year = Number(yearStr)
        const monthIndex = Number(monthStr) - 1
        let label = key
        if (Number.isFinite(year) && Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex <= 11) {
          const d = new Date(Date.UTC(year, monthIndex, 1))
          label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        }
        map.set(key, { value: key, label, sortKey: key })
      }
    }

    return Array.from(map.values()).sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1))
  }, [history])

  // Auto-select the latest month when options change
  useEffect(() => {
    if (!selectedMonth && monthOptions.length) {
      setSelectedMonth(monthOptions[0].value)
    }
  }, [monthOptions, selectedMonth])

  // Process history data for selected month daily PAR chart
  const dailyParData = useMemo(() => {
    if (!history.length || !selectedMonth) return []

    const monthKey = String(selectedMonth).trim()
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return []

    // Filter history to selected month using the month substring from the time column
    const monthData = history.filter((entry) => {
      const rawTime = entry.time || entry.Time
      if (!rawTime) return false
      const timeStr = String(rawTime)
      return timeStr.slice(0, 7) === monthKey
    })
    
    if (!monthData.length) return []
    
    // Group by day and get the latest *valid* entry for each day.
    // Occasionally a snapshot can be partial (e.g., openLoans = 0) which would create a false dip.
    const dayMap = new Map()
    for (const entry of monthData) {
      const timeStr = entry.time || entry.Time
      const entryDate = new Date(timeStr)
      const dayKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`
      
      const pastMissed = Number(entry.Past_Arrears_missed || entry.past_arrears_missed || 0)
      const openLoans = Number(entry.Open_loans || entry.open_loans || 0)
      const parRate = openLoans > 0 ? (pastMissed / openLoans) * 100 : 0
      
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { date: entryDate, time: entryDate, pastMissed, openLoans, parRate })
      } else {
        const existing = dayMap.get(dayKey)
        // Prefer the latest valid entry (openLoans > 0). Only replace a valid existing
        // with another valid one that is later, or replace an invalid existing with a valid one.
        const existingValid = Number(existing.openLoans) > 0
        const currentValid = openLoans > 0
        if (currentValid && (!existingValid || entryDate > existing.time)) {
          dayMap.set(dayKey, { date: entryDate, time: entryDate, pastMissed, openLoans, parRate })
        } else if (!existingValid && !currentValid && entryDate > existing.time) {
          // Both invalid: still keep the latest so the UI is deterministic.
          dayMap.set(dayKey, { date: entryDate, time: entryDate, pastMissed, openLoans, parRate })
        }
      }
    }
    
    // Convert to array and sort by date
    return Array.from(dayMap.values())
      .map(({ date, parRate, pastMissed, openLoans }) => ({
        day: date.getDate(),
        date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
        parRate: Number(parRate.toFixed(2)),
        pastMissed,
        openLoans
      }))
      .sort((a, b) => a.day - b.day)
  }, [history, selectedMonth])

  // Table-only formatter: show plain number (no "KES"/currency symbol), but still respect country FX conversion.
  const formatAmountPlain = useCallback((amount) => {
    const n = convert(amount)
    const safe = Number.isFinite(n) ? n : 0
    return safe.toLocaleString('en', { maximumFractionDigits: 0 })
  }, [convert])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Logbook PAR (Portfolio at Risk)</h1>
        <p className="text-gray-600 mt-2">Monitor loans that are past due and assess risk levels</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Refresh PAR Snapshot</h2>
          <p className="text-sm text-gray-600 mt-1">
            Trigger a refresh to pull both past-missed repayments and open loans from Loandisk and store them in PAR history.
            <span className="block mt-1 text-xs text-gray-500">
              Auto-refreshes every hour automatically.
            </span>
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2">
          <button
            onClick={triggerSnapshot}
            disabled={triggerLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {triggerLoading ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
            Trigger Snapshot Fetch
          </button>
          {lastRunTime && (() => {
            const date = new Date(lastRunTime)
            const formatted = date.toLocaleString('en-US', {
              timeZone: 'Africa/Nairobi',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            })
            return (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-50 border border-blue-200">
                <span className="text-xs font-medium text-blue-700">Last Run (Africa/Nairobi):</span>
                <span className="text-xs text-blue-600">
                  {formatted}
                </span>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Progress Bar */}
      {progress && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {progress.status === 'starting' && 'Starting snapshot...'}
                  {progress.status === 'processing' && `Processing branch ${progress.branch}...`}
                  {progress.status === 'completed' && progress.branch && `Completed branch ${progress.branch}`}
                  {progress.status === 'failed' && `Failed branch ${progress.branch}`}
                  {progress.status === 'saving' && 'Saving to database...'}
                  {progress.status === 'completed' && !progress.branch && 'Snapshot completed!'}
                  {progress.status === 'error' && 'Error occurred'}
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  {progress.total > 0 ? `${progress.current} of ${progress.total} branches processed` : 'Initializing...'}
                </p>
              </div>
              <div className="text-sm font-semibold text-gray-700">
                {progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : '0%'}
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-300 ${
                  progress.status === 'error' || progress.status === 'failed'
                    ? 'bg-red-500'
                    : progress.status === 'completed' && !progress.branch
                    ? 'bg-green-500'
                    : 'bg-blue-500'
                }`}
                style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
              />
            </div>
            {progress.branch && (
              <p className="text-xs text-gray-500">
                Current branch: {progress.branch}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">PAR</p>
              {branchLoading ? (
                <>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 mt-1"></div>
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-32"></div>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900">{parNowRate != null ? `${parNowRate.toFixed(1)}%` : '—'}</p>
                  {parNowRate != null && (
                    <p className="text-xs text-gray-500 mt-1">{formatMoney(scopedTotals.pastMissed)} / {formatMoney(scopedTotals.openLoans)}</p>
                  )}
                </>
              )}
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-red-600">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">PAR 30+</p>
              {branchLoading ? (
                <>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 mt-1"></div>
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-32"></div>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900">{par30Rate != null ? `${par30Rate.toFixed(1)}%` : '—'}</p>
                  {par30Rate != null && (
                    <p className="text-xs text-gray-500 mt-1">{formatMoney(scopedTotals.par30)} / {formatMoney(scopedTotals.openLoans)}</p>
                  )}
                </>
              )}
            </div>
            <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">PAR 60+</p>
              {branchLoading ? (
                <>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 mt-1"></div>
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-32"></div>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900">{par60Rate != null ? `${par60Rate.toFixed(1)}%` : '—'}</p>
                  {par60Rate != null && (
                    <p className="text-xs text-gray-500 mt-1">{formatMoney(scopedTotals.par60)} / {formatMoney(scopedTotals.openLoans)}</p>
                  )}
                </>
              )}
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-700">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">PAR 90+</p>
              {branchLoading ? (
                <>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 mt-1"></div>
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-32"></div>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900">{par90Rate != null ? `${par90Rate.toFixed(1)}%` : '—'}</p>
                  {par90Rate != null && (
                    <p className="text-xs text-gray-500 mt-1">{formatMoney(scopedTotals.par90)} / {formatMoney(scopedTotals.openLoans)}</p>
                  )}
                </>
              )}
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-red-600">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Open Loans</p>
              {branchLoading ? (
                <>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 mt-1"></div>
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-40"></div>
                </>
              ) : (
                <>
              <p className="text-2xl font-bold text-gray-900">
                {formatMoney(scopedTotals.openLoans)}
              </p>
              {(
                <p className="text-xs text-gray-500 mt-1">Latest Open loans snapshot</p>
                  )}
                </>
              )}
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* PAR Tables Side by Side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* PAR by Branch Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-[600px] flex flex-col">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">PAR by Branch</h3>
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-x-auto">
              {branchLoading ? (
                <div className="p-6 flex flex-col items-center justify-center text-gray-600 min-h-[400px]">
                  <Loader2 className="animate-spin mb-3" size={24} />
                  <p className="text-sm">Loading branch data...</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Open Loans</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">PAR</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">PAR 30</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">PAR 60</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">PAR 90</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">PAR %</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">PAR 30%</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {branchData.map((branch) => (
                      <tr key={branch.code} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{branch.name}</p>
                            <p className="text-xs text-gray-500">{branch.code}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-gray-900">
                          {formatAmountPlain(branch.openLoans)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-red-600">
                          {formatAmountPlain(branch.pastMissed || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-red-600">
                          {formatAmountPlain(branch.par30 || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-red-600">
                          {formatAmountPlain(branch.par60 || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-red-600">
                          {formatAmountPlain(branch.par90 || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              (branch.parRate ?? 0) >= 10
                                ? 'bg-red-100 text-red-800'
                                : (branch.parRate ?? 0) >= 5
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {(branch.parRate ?? 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              (branch.par30Rate ?? branch.parRate) >= 10
                                ? 'bg-red-100 text-red-800'
                                : (branch.par30Rate ?? branch.parRate) >= 5
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {(branch.par30Rate ?? branch.parRate).toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {branchData.length === 0 && (
                      <tr>
                        <td className="px-6 py-6 text-center text-gray-500" colSpan={8}>
                          No branch data available. Trigger a snapshot to fetch data.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* PAR by Borrower Access ID */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-[600px] flex flex-col">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h3 className="text-lg font-semibold text-gray-900">PAR per Borrower Access ID</h3>
              <div className="flex items-center gap-2">
                <label htmlFor="borrower-branch-filter" className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Branch
                </label>
                <select
                  id="borrower-branch-filter"
                  value={borrowerBranchFilter}
                  onChange={(e) => setBorrowerBranchFilter(e.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {branchOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-x-auto overflow-y-auto">
            {borrowerLoading ? (
              <div className="p-6 flex flex-col items-center justify-center text-gray-600 min-h-[400px]">
                <Loader2 className="animate-spin mb-3" size={24} />
                <p className="text-sm">Loading borrower access data...</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Loan Officer
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Open Loans
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Past-Missed Repayment
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      PAR %
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Branches
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredBorrowerData.map((entry) => {
                    const officerId = String(entry.officerId ?? '')
                    const officerName = loanOfficerMap.get(officerId)
                    return (
                      <tr key={entry.officerId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {officerName || officerId || 'Unknown Officer'}
                            </p>
                            {officerId && (
                              <p className="text-xs text-gray-500">
                                {officerName ? `ID: ${officerId}` : officerId}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-gray-900">
                          {formatAmountPlain(entry.openLoans)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-red-600">
                          {formatAmountPlain(entry.pastMissed)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              entry.parRate >= 10
                                ? 'bg-red-100 text-red-800'
                                : entry.parRate >= 5
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {entry.parRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {entry.branches && entry.branches.length
                            ? entry.branches.map((code) => branchCodeToName.get(code) || code).join(', ')
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {filteredBorrowerData.length === 0 && (
                    <tr>
                      <td className="px-6 py-6 text-center text-gray-500" colSpan={5}>
                        No borrower access data available. Trigger a snapshot to fetch data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {monthOptions.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Daily PAR Trend</h3>
              <p className="text-sm text-gray-500">Latest daily snapshot of PAR 30+ for the selected month.</p>
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="par-month-filter"
                className="text-xs font-medium text-gray-500 uppercase tracking-wide"
              >
                Month
              </label>
              <select
                id="par-month-filter"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {dailyParData.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyParData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 12 }} />
                <YAxis
                  stroke="#6b7280"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'PAR %', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'parRate') {
                      return [`${value.toFixed(2)}%`, 'PAR %']
                    }
                    return [value, name]
                  }}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="parRate"
                  name="PAR %"
                  stroke="#ef4444"
                  fill="#fee2e2"
                  fillOpacity={0.6}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-500">
              <p>No data available for the selected month.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default LogbookPAR

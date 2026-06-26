import React, { useEffect, useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react'
import {
  AlertTriangle,
  Loader2,
  Play,
  ShieldAlert,
  CheckCircle2,
  BarChart3,
  Flame,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { useLogbookCurrency } from '../../context/LogbookCurrencyContext.jsx'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts'

const PAR_COLORS = {
  par30: '#f59e0b',
  par60: '#fbbf24',
  par90: '#10b981',
  par90Plus: '#ef4444',
  current: '#86efac',
  trend: '#ef4444',
}

function parPillClass(rate) {
  const n = Number(rate) || 0
  if (n >= 20) return 'bg-red-100 text-red-800'
  if (n >= 10) return 'bg-amber-100 text-amber-800'
  if (n >= 5) return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-800'
}

function ParPill({ rate }) {
  const n = Number(rate) || 0
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold min-w-[52px] text-center ${parPillClass(n)}`}>
      {n.toFixed(1)}%
    </span>
  )
}

function shortBranchLabel(name) {
  return String(name || '')
    .replace(/\s+Branch$/i, '')
    .trim()
}

function CommentaryColumn({ title, emoji, items, dotClass }) {
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-700 mb-2">
        {emoji} {title}
      </h4>
      <div className="space-y-2">
        {(items || []).map((item, i) => (
          <div key={i} className="flex gap-2 text-[12px] text-gray-600 leading-relaxed">
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotClass}`} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, accent = 'gray', valueClass = '', icon: Icon, loading, compactValue }) {
  const accentMap = {
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    green: 'bg-green-500',
    gray: 'bg-gray-400',
    purple: 'bg-purple-500',
  }
  const iconBgMap = {
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-green-50 text-green-600',
    gray: 'bg-gray-100 text-gray-600',
    purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="bg-white rounded-[10px] shadow-sm border border-gray-200 px-4 py-3.5 sm:px-4 sm:py-4 relative overflow-hidden min-w-0">
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${accentMap[accent] || accentMap.gray}`} />
      <div className={`absolute top-3.5 right-3.5 p-2 rounded-lg ${iconBgMap[accent] || iconBgMap.gray}`}>
        {Icon ? <Icon size={16} /> : null}
      </div>
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide pr-9 leading-tight">{label}</p>
      {loading ? (
        <div className="h-8 bg-gray-100 rounded animate-pulse mt-2" />
      ) : (
        <p className={`font-bold mt-1.5 ${compactValue ? 'text-base sm:text-lg' : 'text-xl sm:text-2xl'} ${valueClass}`}>{value}</p>
      )}
      {sub && !loading ? <p className="text-[11px] text-gray-400 mt-1 leading-snug">{sub}</p> : null}
    </div>
  )
}

function LogbookPAR({ country }) {
  const { formatMoney } = useLogbookCurrency()
  const formatCompact = useCallback(
    (v) => formatMoney(v, { notation: 'compact', maximumFractionDigits: 1 }),
    [formatMoney],
  )

  const [triggerLoading, setTriggerLoading] = useState(false)
  const [triggerMessage, setTriggerMessage] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [branchData, setBranchData] = useState([])
  const [branchLoading, setBranchLoading] = useState(true)
  const [borrowerData, setBorrowerData] = useState([])
  const [borrowerLoading, setBorrowerLoading] = useState(true)
  const [borrowerBranchFilter, setBorrowerBranchFilter] = useState('ALL')
  const [displayBranchFilter, setDisplayBranchFilter] = useState('ALL')
  const [progress, setProgress] = useState(null)
  const [lastRunTime, setLastRunTime] = useState(null)
  const [loanOfficers, setLoanOfficers] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [commentary, setCommentary] = useState(null)
  const [commentaryLoading, setCommentaryLoading] = useState(false)
  const [commentaryError, setCommentaryError] = useState(null)
  const [expandedBranchCode, setExpandedBranchCode] = useState(null)
  const branchPanelRef = useRef(null)
  const [matchedPanelHeight, setMatchedPanelHeight] = useState(null)

  const syncMatchedPanelHeight = useCallback(() => {
    const el = branchPanelRef.current
    if (!el) return
    const isWide = window.matchMedia('(min-width: 1280px)').matches
    if (!isWide) {
      setMatchedPanelHeight(null)
      return
    }
    setMatchedPanelHeight(el.offsetHeight)
  }, [])

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
  }, [])

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
      if (!res.ok) throw new Error(`Failed to load branch data: ${res.status}`)
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
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const base = API_URLS.par.borrowerAccess
      const url = country ? `${base}?country=${encodeURIComponent(country)}` : base
      const res = await fetch(url, { credentials: 'include', signal: controller.signal })
      clearTimeout(timeoutId)
      if (!res.ok) throw new Error(`Failed to load borrower access data: ${res.status}`)
      const data = await res.json()
      setBorrowerData(Array.isArray(data) ? data : [])
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Error loading borrower access data:', e)
      setBorrowerData([])
    } finally {
      setBorrowerLoading(false)
    }
  }, [country])

  const triggerSnapshot = async () => {
    let eventSource = null
    try {
      setTriggerLoading(true)
      setTriggerMessage(null)
      setProgress({ current: 0, total: 0, branch: null, status: 'starting' })
      const progressBase = API_URLS.par.progress
      const progressUrl = country ? `${progressBase}?country=${encodeURIComponent(country)}` : progressBase
      eventSource = new EventSource(progressUrl, { withCredentials: true })
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          setProgress(data)
          if (data.status === 'completed' || data.status === 'error') eventSource.close()
        } catch (e) {
          console.error('Error parsing progress event:', e)
        }
      }
      eventSource.onerror = () => eventSource?.close()

      const snapshotBase = API_URLS.par.fetchSnapshot
      const snapshotUrl = country ? `${snapshotBase}?country=${encodeURIComponent(country)}` : snapshotBase
      const res = await fetch(snapshotUrl, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error || `Request failed (${res.status})`)
      }
      await Promise.all([loadHistory(), loadBranchData(), loadBorrowerData(), loadLoanOfficers(), loadLastRunTime()])
      setTimeout(() => setProgress(null), 1000)
    } catch (err) {
      setTriggerMessage(`Error: ${err.message}`)
      setProgress(null)
      if (eventSource) eventSource.close()
    } finally {
      setTriggerLoading(false)
      if (eventSource) setTimeout(() => eventSource.close(), 2000)
    }
  }

  useEffect(() => {
    Promise.all([loadHistory(), loadBranchData(), loadBorrowerData(), loadLoanOfficers(), loadLastRunTime()]).catch(
      (e) => console.error('Error loading initial data:', e),
    )
    const interval = setInterval(loadLastRunTime, 30000)
    return () => clearInterval(interval)
  }, [loadHistory, loadBranchData, loadBorrowerData, loadLoanOfficers, loadLastRunTime])

  const latestPastMissed = history.length
    ? Number(history[0]?.Past_Arrears_missed || history[0]?.past_arrears_missed || 0)
    : null
  const latestOpenLoans = history.length ? Number(history[0]?.Open_loans || history[0]?.open_loans || 0) : null

  const countryTotals = useMemo(() => {
    const open = branchData.reduce((sum, b) => sum + (Number(b.openLoans) || 0), 0)
    const missed = branchData.reduce((sum, b) => sum + (Number(b.pastMissed) || 0), 0)
    return { openLoans: open, pastMissed: missed }
  }, [branchData])

  const scopedOpenLoans = country ? countryTotals.openLoans : latestOpenLoans
  const scopedPastMissed = country ? countryTotals.pastMissed : latestPastMissed

  const filteredBranchData = useMemo(() => {
    if (displayBranchFilter === 'ALL') return branchData
    return branchData.filter((b) => String(b.code) === displayBranchFilter)
  }, [branchData, displayBranchFilter])

  const parSummary = useMemo(() => {
    const source = filteredBranchData.length ? filteredBranchData : branchData
    const openFromBranches = source.reduce((sum, b) => sum + (Number(b.openLoans) || 0), 0)
    const open = openFromBranches > 0 ? openFromBranches : Number(scopedOpenLoans) || 0

    if (source.length > 0 && open > 0) {
      const par30 = source.reduce((sum, b) => sum + (Number(b.par30) || 0), 0)
      const par60 = source.reduce((sum, b) => sum + (Number(b.par60) || 0), 0)
      const par90 = source.reduce((sum, b) => sum + (Number(b.par90) || 0), 0)
      const par90Plus = source.reduce((sum, b) => sum + (Number(b.par90Plus) || 0), 0)
      const pastMissed = source.reduce((sum, b) => sum + (Number(b.pastMissed) || 0), 0)
      const pct = (n) => (open > 0 ? (n / open) * 100 : 0)
      return {
        openLoans: open,
        pastMissed,
        par30Rate: pct(par30),
        par60Rate: pct(par60),
        par90Rate: pct(par90),
        par90PlusRate: pct(par90Plus),
        totalParRate: pct(pastMissed),
      }
    }

    const h = history[0]
    if (h && open > 0) {
      const par30 = Number(h.par_30 ?? h.par30 ?? 0)
      const par60 = Number(h.par_60 ?? h.par60 ?? 0)
      const par90 = Number(h.par_90 ?? h.par90 ?? 0)
      const par90Plus = Number(h.par_90_plus ?? h.par90Plus ?? 0)
      const pastMissed = Number(h.Past_Arrears_missed ?? h.past_arrears_missed ?? scopedPastMissed ?? 0)
      const pct = (n) => (open > 0 ? (n / open) * 100 : 0)
      return {
        openLoans: open,
        pastMissed,
        par30Rate: pct(par30),
        par60Rate: pct(par60),
        par90Rate: pct(par90),
        par90PlusRate: pct(par90Plus),
        totalParRate: pct(pastMissed),
      }
    }
    return null
  }, [filteredBranchData, branchData, history, scopedOpenLoans, scopedPastMissed])

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

  const branchCodeToName = useMemo(() => {
    const map = new Map()
    for (const branch of branchData) map.set(branch.code, branch.name || branch.code)
    return map
  }, [branchData])

  const filteredBorrowerData = useMemo(() => {
    const filter = borrowerBranchFilter !== 'ALL' ? borrowerBranchFilter : displayBranchFilter
    if (filter === 'ALL') return borrowerData
    return borrowerData.filter((entry) => Array.isArray(entry.branches) && entry.branches.includes(filter))
  }, [borrowerData, borrowerBranchFilter, displayBranchFilter])

  const loanOfficerMap = useMemo(() => {
    const map = new Map()
    for (const officer of loanOfficers) {
      if (officer?.borrowerAccessId) map.set(String(officer.borrowerAccessId), officer.name || officer.borrowerAccessId)
    }
    return map
  }, [loanOfficers])

  const monthOptions = useMemo(() => {
    if (!history.length) return []
    const map = new Map()
    for (const entry of history) {
      const rawTime = entry.time || entry.Time
      if (!rawTime) continue
      const key = String(rawTime).slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(key)) continue
      if (!map.has(key)) {
        const [yearStr, monthStr] = key.split('-')
        const year = Number(yearStr)
        const monthIndex = Number(monthStr) - 1
        let label = key
        if (Number.isFinite(year) && monthIndex >= 0 && monthIndex <= 11) {
          label = new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        }
        map.set(key, { value: key, label })
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.value < b.value ? 1 : -1))
  }, [history])

  useEffect(() => {
    if (!selectedMonth && monthOptions.length) setSelectedMonth(monthOptions[0].value)
  }, [monthOptions, selectedMonth])

  useEffect(() => {
    setExpandedBranchCode(null)
  }, [displayBranchFilter])

  const selectedMonthLabel = monthOptions.find((m) => m.value === selectedMonth)?.label || 'Selected month'

  const prevMonthParRate = useMemo(() => {
    if (!selectedMonth || !history.length) return null
    const [y, m] = selectedMonth.split('-').map(Number)
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const monthRows = history.filter((e) => String(e.time || e.Time || '').slice(0, 7) === prev)
    if (!monthRows.length) return null
    const latest = monthRows[0]
    const open = Number(latest.Open_loans || latest.open_loans || 0)
    const missed = Number(latest.Past_Arrears_missed || latest.past_arrears_missed || 0)
    return open > 0 ? (missed / open) * 100 : null
  }, [history, selectedMonth])

  const dailyParData = useMemo(() => {
    if (!history.length || !selectedMonth) return []
    const monthKey = String(selectedMonth).trim()
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return []
    const monthData = history.filter((entry) => String(entry.time || entry.Time || '').slice(0, 7) === monthKey)
    if (!monthData.length) return []
    const dayMap = new Map()
    for (const entry of monthData) {
      const entryDate = new Date(entry.time || entry.Time)
      const dayKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`
      const pastMissed = Number(entry.Past_Arrears_missed || entry.past_arrears_missed || 0)
      const openLoans = Number(entry.Open_loans || entry.open_loans || 0)
      const parRate = openLoans > 0 ? (pastMissed / openLoans) * 100 : 0
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { date: entryDate, time: entryDate, parRate })
      } else {
        const existing = dayMap.get(dayKey)
        const existingValid = Number(existing.openLoans) > 0
        const currentValid = openLoans > 0
        if (currentValid && (!existingValid || entryDate > existing.time)) {
          dayMap.set(dayKey, { date: entryDate, time: entryDate, parRate, openLoans, pastMissed })
        }
      }
    }
    return Array.from(dayMap.values())
      .map(({ date, parRate }) => ({
        date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
        parRate: Number(parRate.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [history, selectedMonth])

  const summaryLoading = country ? branchLoading : historyLoading || branchLoading

  const donutData = useMemo(() => {
    if (!parSummary) return []
    const current = Math.max(0, 100 - parSummary.totalParRate)
    return [
      { name: 'PAR 90+', value: parSummary.par90PlusRate, color: PAR_COLORS.par90Plus },
      { name: 'PAR 30', value: parSummary.par30Rate, color: PAR_COLORS.par30 },
      { name: 'PAR 60', value: parSummary.par60Rate, color: PAR_COLORS.par60 },
      { name: 'PAR 90', value: parSummary.par90Rate, color: PAR_COLORS.par90 },
      { name: 'Current', value: current, color: PAR_COLORS.current },
    ].filter((d) => d.value > 0.05)
  }, [parSummary])

  const branchChartData = useMemo(
    () =>
      filteredBranchData.map((b) => ({
        name: shortBranchLabel(b.name || b.code),
        par30: Number((b.par30Rate || 0).toFixed(1)),
        par60: Number((b.par60Rate || 0).toFixed(1)),
        par90: Number((b.par90Rate || 0).toFixed(1)),
        par90Plus: Number((b.par90PlusRate || 0).toFixed(1)),
      })),
    [filteredBranchData],
  )

  const officerRows = useMemo(() => {
    return filteredBorrowerData.map((entry) => {
      const officerId = String(entry.officerId ?? '')
      const officerName = loanOfficerMap.get(officerId) || officerId || 'Unknown Officer'
      const branchNames =
        entry.branches?.map((code) => branchCodeToName.get(code) || code).join(', ') || '—'
      return { ...entry, officerName, branchNames }
    })
  }, [filteredBorrowerData, loanOfficerMap, branchCodeToName])

  const commentaryPayload = useMemo(() => {
    if (!parSummary) return null
    const branches = filteredBranchData.slice(0, 15).map((b) => ({
      name: b.name || b.code,
      par: Number(b.parRate || 0).toFixed(1),
      par30: Number(b.par30Rate || 0).toFixed(1),
      par60: Number(b.par60Rate || 0).toFixed(1),
      par90: Number(b.par90Rate || 0).toFixed(1),
      par90plus: Number(b.par90PlusRate || 0).toFixed(1),
      atRiskLabel: formatMoney(b.pastMissed),
    }))
    const loanOfficers = [...officerRows]
      .sort((a, b) => (Number(b.parRate) || 0) - (Number(a.parRate) || 0))
      .slice(0, 12)
      .map((o) => ({
        name: o.officerName,
        branch: o.branchNames,
        par: Number(o.parRate || 0).toFixed(1),
        atRiskLabel: o.pastMissed ? formatMoney(o.pastMissed) : '—',
      }))
    return {
      period: selectedMonthLabel,
      summary: {
        totalPAR: parSummary.totalParRate.toFixed(1),
        par30: parSummary.par30Rate.toFixed(1),
        par60: parSummary.par60Rate.toFixed(1),
        par90: parSummary.par90Rate.toFixed(1),
        par90plus: parSummary.par90PlusRate.toFixed(1),
        openLoansLabel: formatMoney(parSummary.openLoans),
        atRiskBalanceLabel: formatMoney(parSummary.pastMissed),
      },
      branches,
      loanOfficers,
    }
  }, [parSummary, filteredBranchData, officerRows, selectedMonthLabel, formatMoney])

  const commentaryFetchKey = useMemo(() => {
    if (!commentaryPayload || !parSummary) return null
    return `${selectedMonth}|${displayBranchFilter}|${parSummary.totalParRate.toFixed(1)}|${filteredBranchData.length}|${officerRows.length}`
  }, [commentaryPayload, parSummary, selectedMonth, displayBranchFilter, filteredBranchData.length, officerRows.length])

  useEffect(() => {
    if (!commentaryFetchKey || !commentaryPayload) return undefined
    if (summaryLoading || branchLoading || borrowerLoading) return undefined

    let cancelled = false
    const controller = new AbortController()

    const loadCommentary = async () => {
      setCommentaryLoading(true)
      setCommentaryError(null)
      try {
        const res = await fetch(API_URLS.par.aiCommentary, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commentaryPayload),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Failed to load commentary (${res.status})`)
        if (!cancelled) {
          setCommentary({
            highlights: data.highlights || [],
            risks: data.risks || [],
            actions: data.actions || [],
            generatedAt: data.generatedAt,
          })
        }
      } catch (e) {
        if (!cancelled && e.name !== 'AbortError') {
          setCommentary(null)
          setCommentaryError(e.message || 'Failed to load commentary')
        }
      } finally {
        if (!cancelled) setCommentaryLoading(false)
      }
    }

    loadCommentary()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [commentaryFetchKey, commentaryPayload, summaryLoading, branchLoading, borrowerLoading])

  useLayoutEffect(() => {
    syncMatchedPanelHeight()
    const el = branchPanelRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => syncMatchedPanelHeight())
    ro.observe(el)
    window.addEventListener('resize', syncMatchedPanelHeight)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', syncMatchedPanelHeight)
    }
  }, [syncMatchedPanelHeight, filteredBranchData, branchLoading, displayBranchFilter, borrowerLoading])

  const lastRefreshLabel = lastRunTime
    ? new Date(lastRunTime).toLocaleString('en-KE', {
        timeZone: 'Africa/Nairobi',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

  const parTrendDelta =
    parSummary && prevMonthParRate != null ? parSummary.totalParRate - prevMonthParRate : null

  return (
    <div className="space-y-4 lg:space-y-5 min-w-0 w-full">
      {/* Header — full width within content area */}
      <div className="bg-white text-gray-900 border-b border-gray-200 -mx-4 md:-mx-5 lg:-mx-6 xl:-mx-8 px-4 md:px-5 lg:px-6 xl:px-8 py-3.5 sm:py-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-[#E04B2A] text-white flex items-center justify-center font-black text-sm">P</div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold truncate">Logbook PAR (Portfolio at Risk)</h1>
            <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">Monitor loans that are past due and assess risk levels</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <span className="text-[11px] text-gray-500 whitespace-nowrap">Last refresh: {lastRefreshLabel}</span>
          {monthOptions.length > 0 && (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-md border border-gray-300 bg-white text-gray-900 text-xs px-2.5 py-1.5"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="text-gray-900">
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          {branchOptions.length > 1 && (
            <select
              value={displayBranchFilter}
              onChange={(e) => setDisplayBranchFilter(e.target.value)}
              className="rounded-md border border-gray-300 bg-white text-gray-900 text-xs px-2.5 py-1.5"
            >
              {branchOptions.map((opt) => (
                <option key={opt.code} value={opt.code} className="text-gray-900">
                  {opt.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={triggerSnapshot}
            disabled={triggerLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#E04B2A] hover:bg-[#c94324] text-white text-xs font-semibold disabled:opacity-60"
          >
            {triggerLoading ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
            Trigger Snapshot Fetch
          </button>
        </div>
      </div>

      {triggerMessage && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{triggerMessage}</div>
      )}

      {progress && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-gray-900">
              {progress.status === 'completed' && !progress.branch ? 'Snapshot completed' : `Processing${progress.branch ? `: ${progress.branch}` : '…'}`}
            </span>
            <span className="text-gray-600">
              {progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : '0%'}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-[#E04B2A] transition-all"
              style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* KPI row — 7 cols only on very wide screens (matches HTML mockup) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-3 lg:gap-3.5">
        <KpiCard
          label="Total PAR"
          accent="red"
          icon={Flame}
          loading={summaryLoading}
          value={parSummary ? `${parSummary.totalParRate.toFixed(1)}%` : '—'}
          valueClass={parSummary && parSummary.totalParRate >= 10 ? 'text-red-600' : 'text-gray-900'}
          sub={
            parTrendDelta != null
              ? `${parTrendDelta >= 0 ? '▲' : '▼'} vs ${prevMonthParRate.toFixed(1)}% prior month`
              : 'Portfolio at risk'
          }
        />
        <KpiCard label="PAR 30" accent="amber" icon={AlertTriangle} loading={branchLoading} value={parSummary ? `${parSummary.par30Rate.toFixed(1)}%` : '—'} sub="1–30 days overdue" valueClass="text-amber-600" />
        <KpiCard label="PAR 60" accent="amber" icon={AlertTriangle} loading={branchLoading} value={parSummary ? `${parSummary.par60Rate.toFixed(1)}%` : '—'} sub="31–60 days overdue" valueClass="text-amber-600" />
        <KpiCard label="PAR 90" accent="green" icon={CheckCircle2} loading={branchLoading} value={parSummary ? `${parSummary.par90Rate.toFixed(1)}%` : '—'} sub="61–90 days overdue" valueClass="text-green-600" />
        <KpiCard label="PAR 90+" accent="red" icon={ShieldAlert} loading={branchLoading} value={parSummary ? `${parSummary.par90PlusRate.toFixed(1)}%` : '—'} sub="Over 90 days overdue" valueClass="text-red-600" />
        <KpiCard label="Open Loans" accent="gray" icon={BarChart3} loading={summaryLoading} compactValue value={scopedOpenLoans != null ? formatCompact(scopedOpenLoans) : '—'} sub="Active loan portfolio" valueClass="text-gray-900" />
        <KpiCard
          label="At-Risk Balance"
          accent="red"
          icon={AlertTriangle}
          loading={summaryLoading}
          compactValue
          value={scopedPastMissed != null ? formatCompact(scopedPastMissed) : '—'}
          sub={parSummary ? `${parSummary.totalParRate.toFixed(1)}% of portfolio` : 'Past due exposure'}
          valueClass="text-red-600"
        />
      </div>

      {/* Charts — cards share row height; chart areas grow to fill */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_340px_minmax(0,1fr)] gap-3.5 lg:gap-4 items-stretch">
        <div className="bg-white rounded-[10px] shadow-sm border border-gray-200 p-4 sm:p-[18px] min-w-0 lg:col-span-2 2xl:col-span-1 flex flex-col min-h-0 h-full">
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <h3 className="text-[13px] font-bold text-gray-900 leading-snug">PAR % Daily Trend – {selectedMonthLabel}</h3>
            {parSummary && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">
                {parSummary.totalParRate.toFixed(1)}% Current
              </span>
            )}
          </div>
          <div className="flex-1 min-h-[200px] w-full">
            {dailyParData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyParData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" interval="preserveStartEnd" height={28} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={(v) => `${v}%`} width={36} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`, 'PAR %']} />
                  <Area type="monotone" dataKey="parRate" stroke={PAR_COLORS.trend} fill="#fee2e2" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">No trend data for this month</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-[10px] shadow-sm border border-gray-200 p-4 sm:p-[18px] min-w-0 2xl:max-w-[340px] 2xl:mx-auto 2xl:w-full flex flex-col min-h-0 h-full">
          <h3 className="text-[13px] font-bold text-gray-900 mb-3 shrink-0">PAR Age Composition</h3>
          <div className="flex flex-col items-center flex-1 min-h-0">
            <div className="shrink-0" style={{ width: 168, height: 168 }}>
              {donutData.length > 0 ? (
                <PieChart width={168} height={168}>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    cx={84}
                    cy={84}
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={1}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                </PieChart>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-gray-400">No data</div>
              )}
            </div>
            <div className="space-y-1.5 mt-3 w-full max-w-[220px] shrink-0">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-gray-600 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="font-bold text-gray-900 shrink-0 ml-2">{d.value.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-[10px] shadow-sm border border-gray-200 p-4 sm:p-[18px] min-w-0 lg:col-span-2 2xl:col-span-1 flex flex-col min-h-0 h-full">
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <h3 className="text-[13px] font-bold text-gray-900">PAR % by Branch</h3>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">MTD</span>
          </div>
          <div className="flex-1 min-h-[200px] w-full">
            {branchChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={branchChartData} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={36}
                  />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={32} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Legend
                    verticalAlign="bottom"
                    height={28}
                    wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                    iconSize={10}
                  />
                  <Bar dataKey="par30" stackId="a" fill={PAR_COLORS.par30} name="PAR 30" />
                  <Bar dataKey="par60" stackId="a" fill={PAR_COLORS.par60} name="PAR 60" />
                  <Bar dataKey="par90" stackId="a" fill={PAR_COLORS.par90} name="PAR 90" />
                  <Bar dataKey="par90Plus" stackId="a" fill={PAR_COLORS.par90Plus} name="PAR 90+" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">No branch data</div>
            )}
          </div>
        </div>
      </div>

      {/* Tables — branch panel height drives matched officer panel */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 lg:gap-4">
        <div
          ref={branchPanelRef}
          className="bg-white rounded-[10px] shadow-sm border border-gray-200 overflow-hidden min-w-0"
        >
          <div className="px-4 sm:px-[18px] py-3.5 border-b border-gray-100 flex items-center justify-between gap-2 shrink-0">
            <h3 className="text-[13px] font-bold text-gray-900">PAR by Branch</h3>
            <span className="text-[11px] text-gray-400 shrink-0">
              {displayBranchFilter === 'ALL' ? 'All Branches' : branchCodeToName.get(displayBranchFilter)}
            </span>
          </div>
          <div className="overflow-x-auto">
            {branchLoading ? (
              <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full min-w-[580px] text-[12px]">
                <thead className="bg-gray-50">
                  <tr>
                    {['Branch', 'Open Loans', 'At-Risk', 'PAR', 'PAR 30', 'PAR 60', 'PAR 90+'].map((h, i) => (
                      <th key={h} className={`px-2.5 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBranchData.map((branch) => {
                    const isExpanded = expandedBranchCode === branch.code
                    return (
                      <React.Fragment key={branch.code}>
                        <tr className={isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50'}>
                          <td className="px-2.5 py-2.5">
                            <div className="flex items-start gap-1.5">
                              <button
                                type="button"
                                onClick={() => setExpandedBranchCode(isExpanded ? null : branch.code)}
                                className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 shrink-0 mt-0.5"
                                aria-label={isExpanded ? 'Collapse branch details' : 'Expand branch details'}
                              >
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900">{branch.name}</p>
                                <p className="text-[10px] text-gray-400">#{branch.code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5 text-right text-gray-700 whitespace-nowrap">{formatCompact(branch.openLoans)}</td>
                          <td className="px-2.5 py-2.5 text-right font-semibold text-red-600 whitespace-nowrap">{formatCompact(branch.pastMissed)}</td>
                          <td className="px-2.5 py-2.5 text-right"><ParPill rate={branch.parRate} /></td>
                          <td className="px-2.5 py-2.5 text-right"><ParPill rate={branch.par30Rate} /></td>
                          <td className="px-2.5 py-2.5 text-right"><ParPill rate={branch.par60Rate} /></td>
                          <td className="px-2.5 py-2.5 text-right"><ParPill rate={branch.par90PlusRate} /></td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-gray-50">
                            <td colSpan={7} className="px-4 pb-3 pt-0">
                              <div className="ml-6 grid grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                                <div>
                                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">PAR 30</p>
                                  <p className="text-[12px] font-semibold text-amber-600 mt-0.5">{formatMoney(branch.par30 || 0)}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">{Number(branch.par30Rate || 0).toFixed(1)}% of portfolio</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">PAR 60</p>
                                  <p className="text-[12px] font-semibold text-amber-600 mt-0.5">{formatMoney(branch.par60 || 0)}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">{Number(branch.par60Rate || 0).toFixed(1)}% of portfolio</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">PAR 90</p>
                                  <p className="text-[12px] font-semibold text-green-600 mt-0.5">{formatMoney(branch.par90 || 0)}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">{Number(branch.par90Rate || 0).toFixed(1)}% of portfolio</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">PAR 90+</p>
                                  <p className="text-[12px] font-semibold text-red-600 mt-0.5">{formatMoney(branch.par90Plus || 0)}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">{Number(branch.par90PlusRate || 0).toFixed(1)}% of portfolio</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {!filteredBranchData.length && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No branch data. Trigger a snapshot.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div
          className="bg-white rounded-[10px] shadow-sm border border-gray-200 overflow-hidden min-w-0 flex flex-col"
          style={matchedPanelHeight ? { height: matchedPanelHeight } : undefined}
        >
          <div className="px-4 sm:px-[18px] py-3.5 border-b border-gray-100 flex items-center justify-between gap-2 shrink-0">
            <h3 className="text-[13px] font-bold text-gray-900">PAR per Loan Officer</h3>
            <select
              value={borrowerBranchFilter}
              onChange={(e) => setBorrowerBranchFilter(e.target.value)}
              className="text-[11px] border border-gray-200 rounded-md px-2 py-1 text-gray-700 max-w-[140px] truncate"
            >
              {branchOptions.map((opt) => (
                <option key={opt.code} value={opt.code}>{opt.name}</option>
              ))}
            </select>
          </div>
          <div
            className={`flex-1 min-h-0 overflow-y-auto overflow-x-auto ${matchedPanelHeight ? '' : 'max-h-[50vh] xl:max-h-none'}`}
          >
            {borrowerLoading ? (
              <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>
            ) : (
              <table className="w-full min-w-[480px] text-[12px]">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    {['Loan Officer', 'Open Loans', 'At-Risk', 'PAR', 'Branch'].map((h, i) => (
                      <th key={h} className={`px-2.5 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide ${i === 0 || i === 4 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {officerRows.map((row) => (
                    <tr key={row.officerId} className={`hover:bg-gray-50 ${(row.parRate || 0) >= 30 ? 'bg-red-50/50' : ''}`}>
                      <td className="px-2.5 py-2.5">
                        <p className="font-semibold text-gray-900">{row.officerName}</p>
                        <p className="text-[10px] text-gray-400">ID: {row.officerId}</p>
                      </td>
                      <td className="px-2.5 py-2.5 text-right text-gray-700 whitespace-nowrap">{row.openLoans ? formatCompact(row.openLoans) : '—'}</td>
                      <td className="px-2.5 py-2.5 text-right font-semibold text-red-600 whitespace-nowrap">{row.pastMissed ? formatCompact(row.pastMissed) : '—'}</td>
                      <td className="px-2.5 py-2.5 text-right"><ParPill rate={row.parRate} /></td>
                      <td className="px-2.5 py-2.5 text-left text-gray-500 text-[11px] max-w-[140px]">{row.branchNames}</td>
                    </tr>
                  ))}
                  {!officerRows.length && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No officer data. Trigger a snapshot.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[10px] shadow-sm border border-gray-200 p-4 sm:p-[18px] min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-[13px] font-bold text-gray-900">Management Commentary</h3>
          {commentary?.generatedAt && !commentaryLoading && (
            <span className="text-[10px] text-gray-400">
              Updated{' '}
              {new Date(commentary.generatedAt).toLocaleString('en-KE', {
                timeZone: 'Africa/Nairobi',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        {commentaryLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 className="animate-spin" size={16} />
            Generating commentary…
          </div>
        ) : commentaryError ? (
          <p className="text-sm text-red-600 py-4">{commentaryError}</p>
        ) : commentary ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            <CommentaryColumn title="Highlights" emoji="✅" items={commentary.highlights} dotClass="bg-green-500" />
            <CommentaryColumn title="Risks" emoji="⚠️" items={commentary.risks} dotClass="bg-amber-500" />
            <CommentaryColumn title="Actions" emoji="🎯" items={commentary.actions} dotClass="bg-[#E04B2A]" />
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-4">Commentary will appear once PAR data is loaded.</p>
        )}
      </div>
    </div>
  )
}

export default LogbookPAR

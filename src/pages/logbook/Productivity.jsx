import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Activity, Users, Target, Award, ChevronDown, ChevronRight, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'
import { API_URLS } from '../../utils/api.js'
import { formatKES } from '../../utils/format.js'
import { useLogbookCurrency } from '../../context/LogbookCurrencyContext.jsx'
import LogbookDataProcessor from '../../utils/LogbookDataProcessor.js'

function LogbookProductivity({ country }) {
  const { formatMoney } = useLogbookCurrency()
  const nowInit = new Date()
  const [selectedMonth, setSelectedMonth] = useState(nowInit.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(nowInit.getFullYear())
  const [borrowerData, setBorrowerData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [staffParData, setStaffParData] = useState([])
  const [staffParLoading, setStaffParLoading] = useState(true)
  const [staffParError, setStaffParError] = useState(null)
  const [initialParDataLoaded, setInitialParDataLoaded] = useState(false)
  const [salesData, setSalesData] = useState([]) // { borrower_access_id, newSales, repeatSales }
  const [disbursementData, setDisbursementData] = useState([])
  const [branchData, setBranchData] = useState([])
  const [parHistory, setParHistory] = useState([])
  const [repaymentsProcessor, setRepaymentsProcessor] = useState(null)
  const [selectedBranch, setSelectedBranch] = useState('ALL')
  const [expandedRows, setExpandedRows] = useState(new Set())

  // Load data that depends on month/year
  useEffect(() => {
    const loadMonthYearData = async () => {
      try {
        const basePerfUrl = API_URLS.logbook.collectorPerformance(selectedMonth, selectedYear)
        const perfUrl = country ? `${basePerfUrl}&country=${encodeURIComponent(country)}` : basePerfUrl
        const baseSalesUrl = API_URLS.logbook.productivitySales(selectedMonth, selectedYear)
        const salesUrl = country ? `${baseSalesUrl}&country=${encodeURIComponent(country)}` : baseSalesUrl

        const [borrowerRes, salesRes] = await Promise.all([
          fetch(perfUrl, { credentials: 'include' }),
          fetch(salesUrl, { credentials: 'include' })
        ])
        
        if (borrowerRes.ok) {
          const data = await borrowerRes.json()
          setBorrowerData(Array.isArray(data) ? data : [])
      setError(null)
        } else {
          throw new Error(`Failed to load borrower data (${borrowerRes.status})`)
        }
        
        if (salesRes.ok) {
          const data = await salesRes.json()
          setSalesData(Array.isArray(data) ? data : [])
        }
    } catch (e) {
        console.error('Error loading month/year data:', e)
      setError(e.message)
      setBorrowerData([])
        setSalesData([])
    } finally {
      setLoading(false)
    }
  }
    setLoading(true)
    loadMonthYearData()
  }, [selectedMonth, selectedYear, country])

  // Load critical static data once on mount (parallel) - optimized for speed
  useEffect(() => {
    const loadStaticData = async () => {
      try {
        // Load critical data in parallel (PAR, branches, history needed for cards)
        const parBase = API_URLS.par.borrowerAccess
        const parUrl = country ? `${parBase}?country=${encodeURIComponent(country)}` : parBase
        const branchesBase = API_URLS.par.branches
        const branchesUrl = country ? `${branchesBase}?country=${encodeURIComponent(country)}` : branchesBase
        const historyBase = API_URLS.par.history
        const historyUrl = country ? `${historyBase}?country=${encodeURIComponent(country)}` : historyBase

        const [parRes, branchRes, historyRes] = await Promise.all([
          fetch(parUrl, { credentials: 'include' }),
          fetch(branchesUrl, { credentials: 'include' }),
          fetch(historyUrl, { credentials: 'include' })
        ])
        
        if (parRes.ok) {
          const data = await parRes.json()
          setStaffParData(Array.isArray(data) ? data : [])
          setStaffParError(null)
          setInitialParDataLoaded(true)
        } else {
          throw new Error(`Failed to load staff PAR data: ${parRes.status}`)
        }
        
        if (branchRes.ok) {
          const data = await branchRes.json()
          setBranchData(Array.isArray(data) ? data : [])
        }
        
        if (historyRes.ok) {
          const data = await historyRes.json()
          setParHistory(Array.isArray(data) ? data : [])
        }
      } catch (e) {
        console.error('Error loading static data:', e)
        setStaffParError(e.message)
        setStaffParData([])
        setBranchData([])
        setParHistory([])
      } finally {
        setStaffParLoading(false)
      }
    }
    loadStaticData()
  }, [country])

  // Load branch-specific PAR data when branch changes (skip initial load for 'ALL' since it's loaded in first useEffect)
  useEffect(() => {
    // Skip if initial load hasn't completed yet and branch is 'ALL' (to avoid double-loading)
    if (!initialParDataLoaded && selectedBranch === 'ALL') {
      return
    }
    
    const loadBranchSpecificData = async () => {
    try {
      setStaffParLoading(true)
        // Fetch branch-specific data if branch is selected, otherwise fetch all data
        const base = API_URLS.par.borrowerAccess
        const withCountry = country ? `${base}?country=${encodeURIComponent(country)}` : base
        const url = selectedBranch === 'ALL' 
          ? withCountry
          : `${withCountry}${withCountry.includes('?') ? '&' : '?'}branch=${encodeURIComponent(selectedBranch)}`
        const res = await fetch(url, { credentials: 'include' })
        if (res.ok) {
      const data = await res.json()
      setStaffParData(Array.isArray(data) ? data : [])
          setStaffParError(null)
        } else {
          throw new Error(`Failed to load PAR data: ${res.status}`)
        }
    } catch (e) {
        console.error('Error loading PAR data:', e)
      setStaffParError(e.message)
      setStaffParData([])
    } finally {
      setStaffParLoading(false)
    }
  }

    loadBranchSpecificData()
  }, [selectedBranch, initialParDataLoaded, country])

  // Defer disbursement data loading (large dataset, not critical for initial render)
  useEffect(() => {
    // Load disbursements after initial render to improve page load time
    const timer = setTimeout(async () => {
      try {
        const baseDisb = API_URLS.logbook.disbursements
        const disbUrl = country ? `${baseDisb}?country=${encodeURIComponent(country)}` : baseDisb
        const disbursementRes = await fetch(disbUrl, { credentials: 'include' })
        if (disbursementRes.ok) {
          const data = await disbursementRes.json()
          setDisbursementData(Array.isArray(data) ? data : [])
        }
      } catch (e) {
        console.error('Error loading disbursement data:', e)
        setDisbursementData([])
      }
    }, 300) // Small delay to prioritize critical data
    
    return () => clearTimeout(timer)
  }, [country])

  // Load repayments data only if borrowerData doesn't have total_repayment_amount (lazy/deferred)
  useEffect(() => {
    if (repaymentsProcessor) return // Already loaded
    
    // Check if we actually need repayments data - borrowerData might already have what we need
    const hasRepaymentData = borrowerData.length > 0 && borrowerData.some(item => 
      item.total_repayment_amount != null && Number(item.total_repayment_amount) > 0
    )
    
    // Only load if we don't have repayment data in borrowerData
    if (!hasRepaymentData) {
      // Defer loading repayments data significantly to improve initial page load time
      const timer = setTimeout(() => {
        const loadRepaymentsData = async () => {
          try {
            const processor = new LogbookDataProcessor(country)
            await processor.loadRepaymentsData()
            setRepaymentsProcessor(processor)
          } catch (e) {
            console.error('Error loading repayments data:', e)
            setRepaymentsProcessor(null)
          }
        }
        loadRepaymentsData()
      }, 1000) // Even longer delay - load in background after page renders
      
      return () => clearTimeout(timer)
    }
  }, [repaymentsProcessor, borrowerData, country])


  // Toggle row expansion (memoized to avoid recreating function)
  const toggleRowExpansion = useCallback((borrowerId) => {
    setExpandedRows(prev => {
      const newExpanded = new Set(prev)
      if (newExpanded.has(borrowerId)) {
        newExpanded.delete(borrowerId)
      } else {
        newExpanded.add(borrowerId)
      }
      return newExpanded
    })
  }, [])

  // Create branch-specific maps of borrower_access_id to PAR rate and portfolio (openLoans)
  // staffParData is already filtered by branch when selectedBranch !== 'ALL' (fetched with branch parameter)
  const parRateMap = useMemo(() => {
    const map = new Map()
    for (const entry of staffParData) {
      if (entry.officerId) {
        const id = String(entry.officerId)
        map.set(id, Number(entry.parRate) || 0)
      }
    }
    return map
  }, [staffParData])

  // Create branch-specific map of borrower_access_id to portfolio (openLoans)
  const portfolioMap = useMemo(() => {
    const map = new Map()
    for (const entry of staffParData) {
      if (entry.officerId) {
        const id = String(entry.officerId)
        map.set(id, Number(entry.openLoans) || 0)
      }
    }
    return map
  }, [staffParData])

  // Map borrower_access_id -> { newSales, repeatSales }
  const salesMap = useMemo(() => {
    const map = new Map()
    for (const entry of salesData) {
      const id = String(entry.borrower_access_id || '').trim()
      if (id) {
        map.set(id, {
          newSales: Number(entry.newSales) || 0,
          repeatSales: Number(entry.repeatSales) || 0
        })
      }
    }
    return map
  }, [salesData])

  // Branch options for filter
  const branchOptions = useMemo(() => {
    const options = [{ code: 'ALL', name: 'All Branches' }]
    const seen = new Set()
    for (const branch of branchData) {
      if (branch.code && !seen.has(branch.code)) {
        seen.add(branch.code)
        options.push({ code: branch.code, name: branch.name || branch.code })
      }
    }
    return options
  }, [branchData])

  // Map borrower_access_id -> branches[] from PAR borrower-access (same as PAR page "PAR per Borrower Access ID" table)
  const borrowerIdToBranches = useMemo(() => {
    const map = new Map()
    for (const entry of staffParData) {
      const id = String(entry.officerId ?? '').trim()
      if (!id) continue
      const branches = Array.isArray(entry.branches) ? entry.branches : []
      map.set(id, branches)
    }
    return map
  }, [staffParData])

  // Map borrower_access_id -> name from borrowerData
  const borrowerIdToName = useMemo(() => {
    const map = new Map()
    for (const item of borrowerData) {
      const id = String(item.borrower_access_id ?? '').trim()
      const name = item.name || ''
      if (id && name) {
        map.set(id, name)
      }
    }
    return map
  }, [borrowerData])

  // Filter borrower data by branch using same logic as PAR page: entry.branches.includes(branchCode)
  const filteredBorrowerData = useMemo(() => {
    if (selectedBranch === 'ALL') return borrowerData
    return borrowerData.filter(item => {
      const id = String(item.borrower_access_id ?? '').trim()
      const branches = borrowerIdToBranches.get(id)
      return branches && branches.length > 0 && branches.includes(selectedBranch)
    })
  }, [borrowerData, selectedBranch, borrowerIdToBranches])

  // Filter staff PAR data by branch
  const filteredStaffParData = useMemo(() => {
    if (selectedBranch === 'ALL') return staffParData
    return staffParData.filter(entry => {
      // Check if staff member belongs to selected branch
      const branches = entry.branches || []
      const branch = entry.branch || ''
      return Array.isArray(branches) && branches.includes(selectedBranch) || branch === selectedBranch
    })
  }, [staffParData, selectedBranch])

  // Filter disbursement data by branch
  const filteredDisbursementData = useMemo(() => {
    if (selectedBranch === 'ALL') return disbursementData
    return disbursementData.filter(loan => {
      const branch = loan.branch || loan.Branch || ''
      return String(branch).trim() === String(selectedBranch).trim()
    })
  }, [disbursementData, selectedBranch])

  // Calculate summary stats (filtered by branch)
  const totalBorrowers = filteredBorrowerData.length
  const totalAccounts = useMemo(() =>
    filteredBorrowerData.reduce((sum, item) => sum + (Number(item.accounts) || 0), 0),
    [filteredBorrowerData]
  )
  const totalCustomers = useMemo(() =>
    filteredBorrowerData.reduce((sum, item) => sum + (Number(item.customers) || 0), 0),
    [filteredBorrowerData]
  )
  
  // Calculate total collection - use borrowerData first (faster), fallback to repaymentsProcessor if needed
  const totalRepayment = useMemo(() => {
    // First try: use borrowerData which already has total_repayment_amount aggregated
    // This is much faster than looping through all repayments
    if (filteredBorrowerData.length > 0) {
      const sum = filteredBorrowerData.reduce((acc, item) => {
        return acc + (Number(item.total_repayment_amount) || 0)
      }, 0)
      if (sum > 0) return sum
    }
    
    // Fallback: use repaymentsProcessor if borrowerData doesn't have the data
    if (!repaymentsProcessor || !repaymentsProcessor.repaymentsData) return 0
    const repayments = repaymentsProcessor.repaymentsData
    if (!repayments.length) return 0
    
    const y = selectedYear
    const m = selectedMonth
    const normalizeName = (name) => String(name || '').replace(/\s*branch$/i, '').trim()
    
    // Pre-compute branch normalization if filtering by branch
    let normalizedSelectedBranch = null
    let selectedBranchCode = null
    if (selectedBranch !== 'ALL') {
      const selectedBranchInfo = branchData.find(b => b.code === selectedBranch)
      normalizedSelectedBranch = normalizeName(selectedBranchInfo?.name || selectedBranch)
      selectedBranchCode = selectedBranch
    }
    
    let sum = 0
    const getBranchName = repaymentsProcessor.getBranchName
    
    // Optimize: filter early by date, then by branch
    for (let i = 0; i < repayments.length; i++) {
      const r = repayments[i]
      const s = String(r.repayment_collected_date || '').trim()
      if (!s) continue
      
      const dateParts = s.split('/')
      if (dateParts.length < 3) continue
      
      const mm = Number(dateParts[1])
      const yyyy = Number(dateParts[2])
      
      // Early exit: skip if not matching month/year
      if (yyyy !== y || mm !== m) continue
      
      const code = String(r.branch || r.Branch || '').trim()
      if (!code) continue
      
      // Filter by branch if not 'ALL'
      if (selectedBranch !== 'ALL') {
        if (code !== selectedBranchCode) {
          const branchName = getBranchName ? getBranchName(code) : code
          const normalizedBranch = normalizeName(branchName)
          if (normalizedBranch !== normalizedSelectedBranch) continue
        }
      }
      
      sum += (Number(r.repayment_amount) || 0)
    }
    
    return sum
  }, [filteredBorrowerData, repaymentsProcessor, selectedMonth, selectedYear, selectedBranch, branchData])
  
  // Total Portfolio: matching PAR page "Open Loans" logic
  const totalPortfolio = useMemo(() => {
    if (selectedBranch === 'ALL') {
      // For "ALL" branches: use latest PAR history entry (same as PAR page "Open Loans" card)
      if (parHistory.length === 0) return 0
      const latest = parHistory[0]
      return Number(latest?.Open_loans || latest?.open_loans || 0)
    } else {
      // For specific branch: use branch's openLoans from branchData (same as PAR page "PAR by Branch" table)
      const branch = branchData.find(b => b.code === selectedBranch)
      return branch ? (Number(branch.openLoans) || 0) : 0
    }
  }, [selectedBranch, parHistory, branchData])

  const totalTarget = useMemo(() => 
    filteredBorrowerData.reduce((sum, item) => sum + (Number(item.target) || 0), 0),
    [filteredBorrowerData]
  )
  
  const overallPercentageAchieved = useMemo(() => 
    totalTarget > 0 ? (totalRepayment / totalTarget) * 100 : null,
    [totalTarget, totalRepayment]
  )
  
  const overallPercentOver100 = useMemo(() =>
    overallPercentageAchieved !== null
    ? (overallPercentageAchieved >= 100 ? 100 : overallPercentageAchieved)
      : null,
    [overallPercentageAchieved]
  )

  // Calculate PAR (matching PAR page logic)
  const averagePAR = useMemo(() => {
    if (selectedBranch === 'ALL') {
      // For "ALL" branches: use latest PAR history entry (same as PAR page)
      if (parHistory.length === 0) return null
      const latest = parHistory[0]
      const pastMissed = Number(latest?.Past_Arrears_missed || latest?.past_arrears_missed || 0)
      const openLoans = Number(latest?.Open_loans || latest?.open_loans || 0)
      if (openLoans === 0) return null
      return (pastMissed / openLoans) * 100
    } else {
      // For specific branch: use branch's parRate from branchData (same as PAR page "PAR by Branch" table)
      const branch = branchData.find(b => b.code === selectedBranch)
      if (!branch || branch.parRate == null) return null
      return Number(branch.parRate)
    }
  }, [selectedBranch, parHistory, branchData])

  // Memoize chart data to avoid recalculating on every render - optimized with early returns and for loops
  const parPerformanceChartData = useMemo(() => {
    if (!filteredStaffParData.length) return []
    const data = []
    for (let i = 0; i < filteredStaffParData.length; i++) {
      const entry = filteredStaffParData[i]
      const id = String(entry.officerId || '').trim()
      const name = borrowerIdToName.get(id) || id || 'N/A'
      const openLoans = Number(entry.openLoans) || 0
      const pastMissed = Number(entry.pastMissed) || 0
      data.push({
        name,
        id,
        parRate: openLoans > 0 ? (pastMissed / openLoans * 100) : 0,
        openLoans,
        pastMissed
      })
    }
    return data.sort((a, b) => a.parRate - b.parRate).slice(0, 15)
  }, [filteredStaffParData, borrowerIdToName])

  const portfolioChartData = useMemo(() => {
    if (!filteredStaffParData.length) return []
    const data = []
    for (let i = 0; i < filteredStaffParData.length; i++) {
      const entry = filteredStaffParData[i]
      const id = String(entry.officerId || '').trim()
      const name = borrowerIdToName.get(id) || id || 'N/A'
      const openLoans = Number(entry.openLoans) || 0
      const pastMissed = Number(entry.pastMissed) || 0
      data.push({
        name,
        id,
        parRate: openLoans > 0 ? (pastMissed / openLoans * 100) : 0,
        openLoans,
        pastMissed
      })
    }
    return data.sort((a, b) => b.openLoans - a.openLoans).slice(0, 15)
  }, [filteredStaffParData, borrowerIdToName])

  const topPerformersData = useMemo(() => {
    if (!filteredStaffParData.length) return []
    const data = []
    for (let i = 0; i < filteredStaffParData.length; i++) {
      const entry = filteredStaffParData[i]
      const id = String(entry.officerId || '').trim()
      const name = borrowerIdToName.get(id) || id || 'N/A'
      const openLoans = Number(entry.openLoans) || 0
      const pastMissed = Number(entry.pastMissed) || 0
      data.push({
        id,
        name,
        parRate: openLoans > 0 ? (pastMissed / openLoans * 100) : 0,
        openLoans
      })
    }
    return data.sort((a, b) => a.parRate - b.parRate).slice(0, 5)
  }, [filteredStaffParData, borrowerIdToName])

  // Memoize PAR distribution pie chart data - optimized with for loop
  const parDistributionData = useMemo(() => {
    if (!filteredStaffParData.length) return []
    const categories = [
      { name: 'Excellent (<8%)', value: 0, color: '#10b981' },
      { name: 'Good (8-12%)', value: 0, color: '#3b82f6' },
      { name: 'Fair (12-15%)', value: 0, color: '#f59e0b' },
      { name: 'Poor (>15%)', value: 0, color: '#ef4444' }
    ]
    for (let i = 0; i < filteredStaffParData.length; i++) {
      const entry = filteredStaffParData[i]
      const openLoans = Number(entry.openLoans) || 0
      if (openLoans === 0) continue
      const parRate = (Number(entry.pastMissed) || 0) / openLoans * 100
      if (parRate < 8) categories[0].value++
      else if (parRate < 12) categories[1].value++
      else if (parRate < 15) categories[2].value++
      else categories[3].value++
    }
    return categories.filter(c => c.value > 0)
  }, [filteredStaffParData])

  // Calculate total disbursement for selected month/year (filtered by branch) - optimized
  const totalDisbursement = useMemo(() => {
    if (!filteredDisbursementData.length) return 0
    let sum = 0
    const y = selectedYear
    const m = selectedMonth
    
    // Optimize: parse date inline and filter early
    for (let i = 0; i < filteredDisbursementData.length; i++) {
      const loan = filteredDisbursementData[i]
      const dateStr = String(loan.disbursed_date || loan['Disbursed Date'] || '').trim()
      if (!dateStr) continue
      
      const parts = dateStr.split(/[\/\-]/)
      if (parts.length < 3) continue
      
      const mm = Number(parts[1])
      const yyyy = Number(parts[2])
      
      // Early exit: skip if not matching month/year
      if (yyyy !== y || mm !== m) continue
      
      const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
      sum += (amt || 0)
    }
    return sum
  }, [filteredDisbursementData, selectedMonth, selectedYear])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Logbook Productivity</h1>
          <p className="text-gray-600 mt-2">Track staff performance and productivity metrics</p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Month</label>
            <select 
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white" 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString('en-US', { month: 'long' })}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Year</label>
            <select 
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white" 
              value={selectedYear} 
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {[selectedYear-1, selectedYear, selectedYear+1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Branch</label>
            <select 
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white" 
              value={selectedBranch} 
              onChange={(e) => setSelectedBranch(e.target.value)}
            >
              {branchOptions.map(branch => (
                <option key={branch.code} value={branch.code}>{branch.name}</option>
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
              <p className="text-sm font-medium text-gray-600">Total Portfolio</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalPortfolio)}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">PAR</p>
              <p className="text-2xl font-bold text-gray-900">
                {averagePAR !== null ? `${averagePAR.toFixed(2)}%` : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Collection</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalRepayment)}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Disbursement</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalDisbursement)}</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <Activity size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Collector Performance Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Borrower Performance ({new Date(selectedYear, selectedMonth - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })})</h3>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
              Loading...
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          {error ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-red-600">Error loading data: {error}</p>
            </div>
          ) : filteredBorrowerData.length === 0 && !loading ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">No borrower data available for the selected month and branch</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Accounts</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Customers</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Repayment Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage Achieved</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Commission</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredBorrowerData.map((item, index) => {
                  const targetVal = Number(item.target) || 0
                  const repaymentVal = Number(item.total_repayment_amount) || 0
                  const accountsVal = Number(item.accounts) || 0
                  const customersVal = Number(item.customers) || 0
                  // Use branch-specific portfolio from staffParData instead of aggregated item.portfolio
                  const portfolioVal = portfolioMap.get(String(item.borrower_access_id || '')) || 0
                  const portfolioTargetVal = Number(item.portfolioTarget) || 0
                  const percentageAchieved = targetVal > 0 ? (repaymentVal / targetVal) * 100 : null
                  const percentOver100 = percentageAchieved === null
                    ? null
                    : (percentageAchieved >= 100 ? 100 : percentageAchieved)
                  
                  // Portfolio calculations
                  const portfolioPercentageAchieved = portfolioTargetVal > 0 ? (portfolioVal / portfolioTargetVal) * 100 : null
                  const portfolioPercentOver100 = portfolioPercentageAchieved === null
                    ? null
                    : (portfolioPercentageAchieved >= 100 ? 100 : portfolioPercentageAchieved)
                  
                  // Portfolio Performance uses range-based scoring: Above 110% = 100%, 90-109% = 80%, 70-89% = 60%
                  let portfolioPerformanceScore = null
                  if (portfolioPercentageAchieved !== null) {
                    if (portfolioPercentageAchieved >= 110) {
                      portfolioPerformanceScore = 100
                    } else if (portfolioPercentageAchieved >= 90) {
                      portfolioPerformanceScore = 80
                    } else if (portfolioPercentageAchieved >= 70) {
                      portfolioPerformanceScore = 60
                    } else {
                      portfolioPerformanceScore = portfolioPercentageAchieved
                    }
                  }
                  
                  // PAR calculations
                  const parPercentage = parRateMap.get(String(item.borrower_access_id || '')) || 0
                  const parTarget = 8 // PAR target is always 8%
                  // Percentage Achieved = inverted (lower PAR is better): target/actual * 100
                  let parPercentageAchieved = null
                  let parPercentOver100 = null
                  let parPerformanceScore = null
                  if (parPercentage > 0) {
                    parPercentageAchieved = parTarget > 0 ? ((parTarget / parPercentage) * 100) : null
                    // Percent Over 100% from Percentage Achieved: IF(D6>=110%,100%,IF(D6>=90%,80%,IF(D6>=70%,60%,IF(D6<70,D6))))
                    if (parPercentageAchieved != null) {
                      const d6 = parPercentageAchieved
                      parPercentOver100 = d6 >= 110 ? 100 : d6 >= 90 ? 80 : d6 >= 70 ? 60 : d6
                      parPerformanceScore = parPercentOver100
                    }
                  }
                  
                  // Sales and weighted performance for Commission (G10 = Weighted Performance Performance column)
                  const sales = salesMap.get(String(item.borrower_access_id || '')) || {}
                  const newSalesVal = Number(sales.newSales) || 0
                  const repeatSalesVal = Number(sales.repeatSales) || 0
                  const NEW_SALES_TARGET = 1000000
                  const REPEAT_SALES_TARGET = 2000000
                  const newSalesPct = NEW_SALES_TARGET > 0 ? (newSalesVal / NEW_SALES_TARGET) * 100 : null
                  const repeatSalesPct = REPEAT_SALES_TARGET > 0 ? (repeatSalesVal / REPEAT_SALES_TARGET) * 100 : null
                  // New Sales Percent Over 100%: =IF(D8>=100%,100%,IF(B8<C8,D8))
                  // where D8 = newSalesPct, B8 = newSalesVal, C8 = NEW_SALES_TARGET
                  const newSalesOver100 = newSalesPct != null
                    ? (newSalesPct >= 100 ? 100 : (newSalesVal < NEW_SALES_TARGET ? newSalesPct : null))
                    : null
                  // Repeat Sales Percent Over 100%: =IF(D9>=100%,100%,IF(B9<C9,D9))
                  // where D9 = repeatSalesPct, B9 = repeatSalesVal, C9 = REPEAT_SALES_TARGET
                  const repeatSalesPercentOver100 = repeatSalesPct != null
                    ? (repeatSalesPct >= 100 ? 100 : (repeatSalesVal < REPEAT_SALES_TARGET ? repeatSalesPct : null))
                    : null
                  const perfCollection = percentOver100 != null ? (percentOver100 / 100) * 40 : 0
                  const perfPortfolio = portfolioPerformanceScore != null ? (portfolioPerformanceScore / 100) * 10 : 0
                  const perfPar = parPerformanceScore != null ? (parPerformanceScore / 100) * 20 : 0
                  const perfNewSales = newSalesOver100 != null ? (newSalesOver100 / 100) * 10 : 0
                  const perfRepeatSales = repeatSalesPercentOver100 != null ? (repeatSalesPercentOver100 / 100) * 20 : 0
                  const totalPerformance = perfCollection + perfPortfolio + perfPar + perfNewSales + perfRepeatSales
                  // PAR Commission: =IF(G10>=90%,12500,IF(G10>=80%,10000,IF(G10>=70%,7500,IF(G10<70%,0))))
                  const parCommission = totalPerformance >= 90 ? 12500 : totalPerformance >= 80 ? 10000 : totalPerformance >= 70 ? 7500 : 0
                  const netSalesActuals = (repeatSalesPercentOver100 != null && repeatSalesPercentOver100 >= 50) ? repeatSalesVal : 0
                  const netSalesCommission = netSalesActuals * 0.02
                  const totalCommission = parCommission + netSalesCommission
                  
                  const borrowerId = item.borrower_access_id || `row-${index}`
                  const isExpanded = expandedRows.has(borrowerId)

                  return (
                    <React.Fragment key={borrowerId}>
                      <tr 
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => toggleRowExpansion(borrowerId)}
                      >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )}
                        {item.name || '—'}
                          </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {accountsVal.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {customersVal.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatMoney(portfolioVal)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatMoney(targetVal)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatMoney(repaymentVal)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {percentageAchieved === null ? '—' : `${percentageAchieved.toFixed(1)}%`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatMoney(totalCommission)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={8} className="px-6 py-6">
                            <div className="bg-white rounded-lg border border-gray-200 p-6">
                              <h4 className="text-lg font-semibold text-gray-900 mb-6">Performance Breakdown</h4>
                              
                              {/* Performance Metrics Table */}
                              <div className="mb-8">
                                <h5 className="text-sm font-semibold text-gray-700 mb-3">Performance Metrics</h5>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Metric</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Actuals</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Target</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Percentage Achieved</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Percent Over 100%</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Weight</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Performance</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      <tr>
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">Collection</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney(repaymentVal)}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{targetVal > 0 ? formatMoney(targetVal) : '—'}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{percentageAchieved === null ? '—' : `${percentageAchieved.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{percentOver100 === null ? '—' : `${percentOver100.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">40%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                          {percentOver100 !== null ? `${((percentOver100 / 100) * 40).toFixed(2)}%` : '—'}
                                        </td>
                                      </tr>
                                      <tr className="bg-gray-50">
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">Portfolio</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney(portfolioVal)}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{portfolioTargetVal > 0 ? formatMoney(portfolioTargetVal) : '—'}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{portfolioPercentageAchieved === null ? '—' : `${portfolioPercentageAchieved.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{portfolioPercentOver100 === null ? '—' : `${portfolioPercentOver100.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">10%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                          {portfolioPerformanceScore !== null ? `${((portfolioPerformanceScore / 100) * 10).toFixed(2)}%` : '—'}
                                        </td>
                                      </tr>
                                      <tr>
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">PAR</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{parPercentage > 0 ? `${parPercentage.toFixed(2)}%` : '—'}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{parTarget}%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{parPercentageAchieved === null ? '—' : `${parPercentageAchieved.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{parPercentOver100 === null ? '—' : `${parPercentOver100.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">20%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                          {parPerformanceScore !== null ? `${((parPerformanceScore / 100) * 20).toFixed(2)}%` : '—'}
                                        </td>
                                      </tr>
                                      {(() => {
                                        const sales = salesMap.get(String(item.borrower_access_id || '')) || {}
                                        const newSalesVal = Number(sales.newSales) || 0
                                        const repeatSalesVal = Number(sales.repeatSales) || 0
                                        const NEW_SALES_TARGET = 1000000
                                        const REPEAT_SALES_TARGET = 2000000
                                        const newSalesPct = NEW_SALES_TARGET > 0 ? (newSalesVal / NEW_SALES_TARGET) * 100 : null
                                        const repeatSalesPct = REPEAT_SALES_TARGET > 0 ? (repeatSalesVal / REPEAT_SALES_TARGET) * 100 : null
                                        // New Sales Percent Over 100%: =IF(D8>=100%,100%,IF(B8<C8,D8))
                                        // where D8 = newSalesPct, B8 = newSalesVal, C8 = NEW_SALES_TARGET
                                        const newSalesOver100 = newSalesPct != null
                                          ? (newSalesPct >= 100 ? 100 : (newSalesVal < NEW_SALES_TARGET ? newSalesPct : null))
                                          : null
                                        // Repeat Sales Percent Over 100%: =IF(D9>=100%,100%,IF(B9<C9,D9))
                                        // where D9 = repeatSalesPct, B9 = repeatSalesVal, C9 = REPEAT_SALES_TARGET
                                        const repeatSalesPercentOver100 = repeatSalesPct != null
                                          ? (repeatSalesPct >= 100 ? 100 : (repeatSalesVal < REPEAT_SALES_TARGET ? repeatSalesPct : null))
                                          : null
                                        // Sum of Weight and Performance columns for Weighted Performance row
                                        const perfCollection = percentOver100 != null ? (percentOver100 / 100) * 40 : 0
                                        const perfPortfolio = portfolioPerformanceScore != null ? (portfolioPerformanceScore / 100) * 10 : 0
                                        const perfPar = parPerformanceScore != null ? (parPerformanceScore / 100) * 20 : 0
                                        const perfNewSales = newSalesOver100 != null ? (newSalesOver100 / 100) * 10 : 0
                                        const perfRepeatSales = repeatSalesPercentOver100 != null ? (repeatSalesPercentOver100 / 100) * 20 : 0
                                        const totalWeight = 40 + 10 + 20 + 10 + 20
                                        const totalPerformance = perfCollection + perfPortfolio + perfPar + perfNewSales + perfRepeatSales
                                        return (
                                          <>
                                            <tr className="bg-gray-50">
                                              <td className="px-4 py-3 text-sm font-medium text-gray-900">New Sales</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney(newSalesVal)}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney(NEW_SALES_TARGET)}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{newSalesPct != null ? `${newSalesPct.toFixed(1)}%` : '—'}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{newSalesOver100 != null ? `${newSalesOver100.toFixed(1)}%` : '—'}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">10%</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{newSalesOver100 != null ? `${((newSalesOver100 / 100) * 10).toFixed(2)}%` : '—'}</td>
                                            </tr>
                                            <tr>
                                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Repeat Sales</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney(repeatSalesVal)}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney(REPEAT_SALES_TARGET)}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{repeatSalesPct != null ? `${repeatSalesPct.toFixed(1)}%` : '—'}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{repeatSalesPercentOver100 != null ? `${repeatSalesPercentOver100.toFixed(1)}%` : '—'}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">20%</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{repeatSalesPercentOver100 != null ? `${((repeatSalesPercentOver100 / 100) * 20).toFixed(2)}%` : '—'}</td>
                                            </tr>
                                            <tr className="bg-blue-50 border-t-2 border-blue-200">
                                              <td className="px-4 py-3 text-sm font-semibold text-gray-900">Weighted Performance</td>
                                              <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right" colSpan={4}>—</td>
                                              <td className="px-4 py-3 text-sm font-semibold text-blue-900 text-right">{totalWeight}%</td>
                                              <td className="px-4 py-3 text-sm font-semibold text-blue-900 text-right">{totalPerformance.toFixed(2)}%</td>
                                            </tr>
                                            <tr>
                                              <td className="px-4 py-3 text-sm font-medium text-gray-900">Net Sales</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatMoney((repeatSalesPercentOver100 != null && repeatSalesPercentOver100 >= 50) ? repeatSalesVal : 0)}</td>
                                              <td className="px-4 py-3 text-sm text-gray-900 text-right" colSpan={5}>—</td>
                                            </tr>
                                          </>
                                        )
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* Range Tables and Commission Section */}
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* PORTFOLIO Range and Percentage */}
                                <div className="bg-gray-50 rounded-lg p-4">
                                  <h5 className="text-sm font-semibold text-gray-700 mb-3">PORTFOLIO Range and Percentage</h5>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-100">
                                        <tr>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Range</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-700">Percentage</th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        <tr>
                                          <td className="px-3 py-2 text-sm text-gray-900">Above 110%</td>
                                          <td className="px-3 py-2 text-sm text-gray-900 text-right">100%</td>
                                        </tr>
                                        <tr>
                                          <td className="px-3 py-2 text-sm text-gray-900">90% - 109%</td>
                                          <td className="px-3 py-2 text-sm text-gray-900 text-right">80%</td>
                                        </tr>
                                        <tr>
                                          <td className="px-3 py-2 text-sm text-gray-900">70% - 89%</td>
                                          <td className="px-3 py-2 text-sm text-gray-900 text-right">60%</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* PAR Range and Percentage */}
                                <div className="bg-gray-50 rounded-lg p-4">
                                  <h5 className="text-sm font-semibold text-gray-700 mb-3">PAR Range and Percentage</h5>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-100">
                                        <tr>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Range</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-700">Percentage</th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        <tr>
                                          <td className="px-3 py-2 text-sm text-gray-900">Below 8%</td>
                                          <td className="px-3 py-2 text-sm text-gray-900 text-right">100%</td>
                                        </tr>
                                        <tr>
                                          <td className="px-3 py-2 text-sm text-gray-900">9% - 12%</td>
                                          <td className="px-3 py-2 text-sm text-gray-900 text-right">80%</td>
                                        </tr>
                                        <tr>
                                          <td className="px-3 py-2 text-sm text-gray-900">12% - 15%</td>
                                          <td className="px-3 py-2 text-sm text-gray-900 text-right">60%</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* Commission and Pay Calculation */}
                                <div className="bg-gray-50 rounded-lg p-4">
                                  <h5 className="text-sm font-semibold text-gray-700 mb-3">Commission and Pay</h5>
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-700">PAR Commission</span>
                                      <span className="text-sm font-semibold text-gray-900">{formatMoney(parCommission)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-700">Net Sales Commission</span>
                                      <span className="text-sm font-semibold text-gray-900">{formatMoney(netSalesCommission)}</span>
                                    </div>
                                    <div className="border-t border-gray-300 pt-2 flex justify-between items-center">
                                      <span className="text-sm font-semibold text-gray-900">Total Commission</span>
                                      <span className="text-sm font-semibold text-gray-900">{formatMoney(totalCommission)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Note */}
                              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                                <p className="text-sm text-gray-700">
                                  <span className="font-semibold">Note:</span> The Portfolio Target is the highest amount of Portfolio the Relationship Officer has ever had/allocated. It moves with increase in portfolio.
                                </p>
                              </div>
                            </div>
                      </td>
                    </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
              {filteredBorrowerData.length > 0 && (
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900">Total</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{totalAccounts.toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{totalCustomers.toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{formatMoney(totalPortfolio)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{formatMoney(totalTarget)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{formatMoney(totalRepayment)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">
                      {overallPercentageAchieved === null ? '-' : `${overallPercentageAchieved.toFixed(1)}%`}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">-</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* Staff Productivity Visualizations */}
          {staffParError ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <p className="text-sm text-red-600">Error loading staff PAR data: {staffParError}</p>
            </div>
      ) : staffParLoading || staffParData.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500 text-sm">
          {staffParLoading ? 'Loading staff productivity metrics...' : 'No staff productivity data available. Ensure PAR snapshots are running.'}
            </div>
      ) : filteredStaffParData.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500 text-sm">
          No data available for selected branch.
            </div>
          ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* PAR Performance Chart */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">PAR Performance by Staff</h3>
            {parPerformanceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
              <BarChart
                data={parPerformanceChartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis 
                  label={{ value: 'PAR %', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip 
                  formatter={(value, name) => {
                    if (name === 'parRate') return [`${value.toFixed(2)}%`, 'PAR Rate']
                    if (name === 'openLoans') return [formatMoney(value), 'Open Loans']
                    if (name === 'pastMissed') return [formatMoney(value), 'Past Missed']
                    return [value, name]
                  }}
                />
                <Legend />
                <Bar 
                  dataKey="parRate" 
                  name="PAR Rate" 
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            ) : (
              <div className="h-[350px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </div>

          {/* Portfolio Distribution Chart */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Distribution by Staff</h3>
            {portfolioChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
              <BarChart
                data={portfolioChartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis 
                  label={{ value: 'Amount (KES)', angle: -90, position: 'insideLeft' }}
                  tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip 
                  formatter={(value) => formatMoney(value)}
                />
                <Legend />
                <Bar 
                  dataKey="openLoans" 
                  name="Open Loans (Portfolio)" 
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar 
                  dataKey="pastMissed" 
                  name="Past Missed" 
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            ) : (
              <div className="h-[350px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </div>

          {/* PAR Distribution Pie Chart */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">PAR Rate Distribution</h3>
            {parDistributionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={parDistributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {parDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </div>

          {/* Top Performers Summary */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Performers Summary</h3>
            {topPerformersData.length > 0 ? (
              <div className="space-y-4">
                {topPerformersData.map((entry, index) => (
                  <div key={entry.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                        index === 0 ? 'bg-yellow-500' : 
                        index === 1 ? 'bg-gray-400' : 
                        index === 2 ? 'bg-orange-600' : 
                        'bg-gray-300'
                      }`}>
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{entry.name}</p>
                        <p className="text-xs text-gray-500">Portfolio: {formatMoney(entry.openLoans)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${
                        entry.parRate < 8 ? 'text-green-600' :
                        entry.parRate < 12 ? 'text-blue-600' :
                        entry.parRate < 15 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {entry.parRate.toFixed(2)}%
                      </p>
                      <p className="text-xs text-gray-500">PAR Rate</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-500 text-sm">
                No data available
              </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

export default LogbookProductivity


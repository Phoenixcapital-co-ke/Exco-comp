import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Clock, CheckCircle, AlertCircle, DollarSign, Target, Zap, Calendar, Users, BarChart3 } from 'lucide-react'
import { formatKES } from '../../utils/format.js'
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line, ComposedChart } from 'recharts'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'
import { API_URLS } from '../../utils/api.js'

function BodaCollection() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([])
  const [repaymentMap, setRepaymentMap] = useState({})
  const [allRepaymentsMap, setAllRepaymentsMap] = useState({})
  const [dailyRepayments, setDailyRepayments] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadingRepayments, setLoadingRepayments] = useState(true)
  const [loadingAllRepayments, setLoadingAllRepayments] = useState(true)
  const [loadingDailyRepayments, setLoadingDailyRepayments] = useState(true)
  const [error, setError] = useState(null)
  const [clientSearchFilter, setClientSearchFilter] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        const data = await fetchAllZidishaRows({ signal: controller.signal })
        const boda = data.filter((r) => {
          const product = (r['Product Name'] || r.product_name || '').trim().toLowerCase()
          const clientId = (r['Client Id'] || r.client_id || '').trim()
          if (clientId === '3926') return false
          return product === 'zidisha boda'
        })
        setRows(boda)
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

  // Fetch all repayments (all time) - load once on mount
  useEffect(() => {
    const loadAllRepayments = async () => {
      setLoadingAllRepayments(true)
      try {
        const res = await fetch(API_URLS.boda.repaymentsAll, {
          credentials: 'include',
        })
        if (!res.ok) {
          console.warn('Failed to load all repayment data:', res.status)
          setAllRepaymentsMap({})
          setLoadingAllRepayments(false)
          return
        }
        const data = await res.json()
        setAllRepaymentsMap(data || {})
        setLoadingAllRepayments(false)
      } catch (e) {
        console.warn('Error loading all repayment data:', e.message)
        setAllRepaymentsMap({})
        setLoadingAllRepayments(false)
      }
    }
    loadAllRepayments()
  }, [])

  // Fetch repayment data for the selected month/year
  useEffect(() => {
    const loadRepayments = async () => {
      setLoadingRepayments(true)
      try {
        const params = new URLSearchParams({
          month: String(selectedMonth),
          year: String(selectedYear),
        })
        const res = await fetch(`${API_URLS.boda.repayments}?${params.toString()}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          console.warn('Failed to load repayment data:', res.status)
          setRepaymentMap({})
          setLoadingRepayments(false)
          return
        }
        const data = await res.json()
        setRepaymentMap(data || {})
        setLoadingRepayments(false)
      } catch (e) {
        console.warn('Error loading repayment data:', e.message)
        setRepaymentMap({})
        setLoadingRepayments(false)
      }
    }
    if (selectedMonth && selectedYear) {
      loadRepayments()
    }
  }, [selectedMonth, selectedYear])

  // Fetch daily repayment data for the selected month/year
  useEffect(() => {
    const loadDailyRepayments = async () => {
      setLoadingDailyRepayments(true)
      try {
        const params = new URLSearchParams({
          month: String(selectedMonth),
          year: String(selectedYear),
        })
        const res = await fetch(`${API_URLS.boda.repaymentsDaily}?${params.toString()}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          console.warn('Failed to load daily repayment data:', res.status)
          setDailyRepayments({})
          setLoadingDailyRepayments(false)
          return
        }
        const data = await res.json()
        console.log(`[Boda Collection] Daily repayments for ${selectedMonth}/${selectedYear}:`, data)
        setDailyRepayments(data || {})
        setLoadingDailyRepayments(false)
      } catch (e) {
        console.warn('Error loading daily repayment data:', e.message)
        setDailyRepayments({})
        setLoadingDailyRepayments(false)
      }
    }
    if (selectedMonth && selectedYear) {
      loadDailyRepayments()
    }
  }, [selectedMonth, selectedYear])

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

  const MS_PER_DAY = 1000 * 60 * 60 * 24

  const totalCollectedMonth = useMemo(() => {
    // Sum of all repayment amounts from repaymentMap for the selected month
    return Object.values(repaymentMap).reduce((sum, amount) => sum + (Number(amount) || 0), 0)
  }, [repaymentMap])
  const totalExpectedMonth = useMemo(() => {
    return filtered.reduce((sum, r) => sum + (Number(r['Total Expected Repayment Derived']) || 0), 0)
  }, [filtered])
  // Outstanding will be calculated after currentMonthTarget is available
  
  const prevMonthCollected = useMemo(() => {
    return prevMonth.reduce((sum, r) => sum + (Number(r['Total Repayment Derived']) || 0), 0)
  }, [prevMonth])

  const collectionChange = useMemo(() => {
    if (prevMonthCollected > 0) {
      const change = ((totalCollectedMonth - prevMonthCollected) / prevMonthCollected) * 100
      return { value: change, display: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` }
    }
    return { value: 0, display: '0.0%' }
  }, [totalCollectedMonth, prevMonthCollected])

  // Average collection per loan
  const avgCollectionPerLoan = useMemo(() => {
    const loansWithCollection = filtered.filter(r => (Number(r['Total Repayment Derived']) || 0) > 0)
    if (loansWithCollection.length === 0) return 0
    return totalCollectedMonth / loansWithCollection.length
  }, [filtered, totalCollectedMonth])

  // Client Performance Data (with active days in selected month)
  const clientPerformanceData = useMemo(() => {
    const monthStart = new Date(selectedYear, selectedMonth - 1, 1)
    const monthEnd = new Date(selectedYear, selectedMonth, 0) // last day of month
    const today = new Date()
    const todayInMonth =
      today.getFullYear() === selectedYear && today.getMonth() + 1 === selectedMonth
        ? today
        : null

    return rows
      .map(r => {
        const expected = Number(r['Total Expected Repayment Derived'] || r.total_expected_repayment_derived || 0)
        const charges = Number(r['Total Charges Due At Disbursement Derived'] || r.total_charges_due_at_disbursement_derived || 0)
        const disbursedDate = r['Disbursed On Date'] || r.disbursed_on_date
        const maturedDate = r['Expected Matured On Date'] || r.expected_matured_on_date
        
        let period = 0
        let dailyInstallment = 0
        let activeDays = 0
        let mtdActiveDays = 0
        
        if (disbursedDate && maturedDate) {
          const d1 = new Date(disbursedDate)
          const d2 = new Date(maturedDate)
          if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
            period = Math.max(1, Math.ceil((d2 - d1) / MS_PER_DAY))
            dailyInstallment = (expected - charges) / period

            // Active days in the selected month:
            // - Start from Disbursed On Date if within the month, else from first day of month
            // - End at Expected Matured On Date if it falls in or before the month, else at month end
            const overlapStart = d1 > monthStart ? d1 : monthStart
            const overlapEnd = d2 < monthEnd ? d2 : monthEnd
            if (overlapEnd >= overlapStart) {
              activeDays = Math.floor((overlapEnd - overlapStart) / MS_PER_DAY) + 1
            }

            // MTD active days (capped to today if within the selected month)
            if (todayInMonth) {
              const mtdEnd = overlapEnd < todayInMonth ? overlapEnd : todayInMonth
              if (mtdEnd >= overlapStart) {
                mtdActiveDays = Math.floor((mtdEnd - overlapStart) / MS_PER_DAY) + 1
              }
            } else {
              // If today's month is different, MTD = full active days when today is after month, else 0
              mtdActiveDays = today > monthEnd ? activeDays : 0
            }
          }
        }

        const eomTarget = dailyInstallment * activeDays
        const mtdTarget = dailyInstallment * mtdActiveDays

        // Get repayment sum for this client/loan in the selected month
        const clientId = (r['Client Id'] || r.client_id || '').trim()
        const loanId = (r['Loan ID'] || r.loan_id || '').trim()
        const repaymentKey = `${clientId}|${loanId}`
        const repaidCurrentMonth = repaymentMap[repaymentKey] || 0
        const totalRepaid = allRepaymentsMap[repaymentKey] || 0

      // Calculate Total Expected Collection = Total Expected Repayment - Total Charges Due At Disbursement
      const totalExpectedCollection = expected - charges

      return {
          client: r['Client Name'] || r.client_name || 'Unknown',
          clientId,
          loanId,
          dailyInstallment,
          period,
          activeDays,
          mtdTarget,
          eomTarget,
          totalExpected: totalExpectedCollection,
          repaidCurrentMonth,
          totalRepaid
        }
      })
      .sort((a, b) => b.totalExpected - a.totalExpected)
  }, [rows, selectedMonth, selectedYear, repaymentMap, allRepaymentsMap, MS_PER_DAY])

  // Daily Expected vs Collected (Current Month) - based on active days and daily installments
  const dailyExpectedVsCollected = useMemo(() => {
    const daysIn = new Date(selectedYear, selectedMonth, 0).getDate()
    const monthStart = new Date(selectedYear, selectedMonth - 1, 1)
    const monthEnd = new Date(selectedYear, selectedMonth, 0)
    const expByDay = Array(daysIn + 1).fill(0)
    
    // Calculate expected amounts based on active days and daily installments
    for (const client of clientPerformanceData) {
      if (!client.dailyInstallment || client.dailyInstallment <= 0) continue
      
      // Determine which days in the month this client's loan is active
      const row = rows.find(r => {
        const clientId = (r['Client Id'] || r.client_id || '').trim()
        const loanId = (r['Loan ID'] || r.loan_id || '').trim()
        return clientId === client.clientId && loanId === client.loanId
      })
      
      if (!row) continue
      
      const disbursedDate = row['Disbursed On Date'] || row.disbursed_on_date
      const maturedDate = row['Expected Matured On Date'] || row.expected_matured_on_date
      
      if (!disbursedDate || !maturedDate) continue
      
      const d1 = new Date(disbursedDate)
      const d2 = new Date(maturedDate)
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) continue
      
      // Calculate overlap with selected month
      const overlapStart = d1 > monthStart ? d1 : monthStart
      const overlapEnd = d2 < monthEnd ? d2 : monthEnd
      
      if (overlapEnd < overlapStart) continue
      
      // For each day in the overlap, add the daily installment
      const startDay = Math.max(1, overlapStart.getDate())
      const endDay = Math.min(daysIn, overlapEnd.getDate())
      
      for (let day = startDay; day <= endDay; day++) {
        expByDay[day] += client.dailyInstallment
      }
    }
    
    // Get collected amounts from daily repayments API
    const arr = []
    let totalExpected = 0
    let totalCollected = 0
    for (let i = 1; i <= daysIn; i++) {
      const expected = expByDay[i]
      const collected = dailyRepayments[i] || 0
      totalExpected += expected
      totalCollected += collected
      arr.push({ 
        day: String(i), 
        expected, 
        collected,
        rate: expected > 0 ? (collected / expected) * 100 : 0
      })
    }
    console.log(`[Boda Collection] Daily chart data - Total Expected: ${totalExpected.toFixed(2)}, Total Collected: ${totalCollected.toFixed(2)}`)
    return arr
  }, [clientPerformanceData, rows, selectedMonth, selectedYear, dailyRepayments])

  // Helper function to clean branch name
  const cleanBranchName = (name = '') => {
    const trimmed = String(name || '').trim()
    const noSuffix = trimmed.replace(/\s*branch\s*$/i, '').trim()
    return noSuffix || trimmed || 'Unknown'
  }

  // Branch Breakdown Table
  const branchBreakdown = useMemo(() => {
    const branchMap = new Map()

    for (const r of rows) {
      const branchName = cleanBranchName(r['Branch Name'] || r.branch_name || 'Unknown')
      
      if (!branchMap.has(branchName)) {
        branchMap.set(branchName, {
          branch: branchName,
          totalLoans: 0,
          totalExpected: 0,
          totalChargesAtDisbursement: 0,
          totalDailyInstallment: 0,
          avgDailyInstallment: 0,
          mtdTarget: 0,
          eomTarget: 0,
          repaidCurrentMonth: 0
        })
      }
      
      const entry = branchMap.get(branchName)
      const expected = Number(r['Total Expected Repayment Derived'] || r.total_expected_repayment_derived || 0)
      const charges = Number(r['Total Charges Due At Disbursement Derived'] || r.total_charges_due_at_disbursement_derived || 0)
      const disbursedDate = r['Disbursed On Date'] || r.disbursed_on_date
      const maturedDate = r['Expected Matured On Date'] || r.expected_matured_on_date
      
      entry.totalLoans += 1
      // Total Expected Collection = Total Expected Repayment - Total Charges Due At Disbursement
      entry.totalExpected += (expected - charges)
      entry.totalChargesAtDisbursement += charges
      
      // Calculate daily installment for this loan
      if (disbursedDate && maturedDate) {
        const d1 = new Date(disbursedDate)
        const d2 = new Date(maturedDate)
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          const daysDiff = Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)))
          const dailyInstallment = (expected - charges) / daysDiff
          entry.totalDailyInstallment += dailyInstallment
        }
      }
      
      // Get MTD Target, EoM Target, and Repaid Current Month from clientPerformanceData
      const clientId = (r['Client Id'] || r.client_id || '').trim()
      const loanId = (r['Loan ID'] || r.loan_id || '').trim()
      const clientData = clientPerformanceData.find(c => 
        c.clientId === clientId && c.loanId === loanId
      )
      
      if (clientData) {
        entry.mtdTarget += clientData.mtdTarget || 0
        entry.eomTarget += clientData.eomTarget || 0
        entry.repaidCurrentMonth += clientData.repaidCurrentMonth || 0
      }
    }

    // Calculate average daily installment per branch
    const result = Array.from(branchMap.values()).map(entry => ({
      ...entry,
      avgDailyInstallment: entry.totalLoans > 0 ? entry.totalDailyInstallment / entry.totalLoans : 0
    }))
    
    return result.sort((a, b) => b.totalExpected - a.totalExpected)
  }, [rows, clientPerformanceData])

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

  // Current month target: sum of EoM targets for all clients in the selected month
  const currentMonthTarget = useMemo(() => {
    return clientPerformanceData.reduce((sum, r) => sum + (r.eomTarget || 0), 0)
  }, [clientPerformanceData])

  // MTD Target: sum of MTD targets for all clients in the selected month
  const mtdTargetTotal = useMemo(() => {
    return clientPerformanceData.reduce((sum, r) => sum + (r.mtdTarget || 0), 0)
  }, [clientPerformanceData])

  // MTD Collection Rate: percentage of Total Collected on MTD Target
  const mtdCollectionRatePct = useMemo(() => {
    if (mtdTargetTotal > 0) {
      const pct = (totalCollectedMonth / mtdTargetTotal) * 100
      return `${pct.toFixed(1)}%`
    }
    return '0.0%'
  }, [totalCollectedMonth, mtdTargetTotal])

  // Collection Rate: percentage of Current Month Target
  const collectionRatePct = useMemo(() => {
    if (currentMonthTarget > 0) {
      const pct = (totalCollectedMonth / currentMonthTarget) * 100
      return { value: pct, display: `${pct.toFixed(1)}%` }
        }
    return { value: 0, display: '0.0%' }
  }, [totalCollectedMonth, currentMonthTarget])

  // Collection efficiency: same as Collection Rate (collected vs Current Month Target)
  const collectionEfficiency = useMemo(() => {
    if (currentMonthTarget > 0) {
      return (totalCollectedMonth / currentMonthTarget) * 100
    }
    return 0
  }, [totalCollectedMonth, currentMonthTarget])

  // Outstanding: Current Month Target - Total Collected
  const totalOutstandingMonth = useMemo(() => {
    return Math.max(0, currentMonthTarget - totalCollectedMonth)
  }, [currentMonthTarget, totalCollectedMonth])

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

  // Progressive rendering: show what's ready, skeleton loaders for what's not
  // Main data must be loaded before showing anything
  const mainDataReady = !loading && rows.length > 0

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  if (!mainDataReady) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-gray-600">
        <div className="inline-block h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm">Loading collection data...</p>
        <p className="text-xs text-gray-500 mt-2">Fetching Boda loan data</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Boda Collection</h1>
          <p className="text-gray-600 mt-2">Monitor Boda loan collections and payment status</p>
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
              {loadingRepayments ? (
                <div className="h-9 bg-gray-200 rounded animate-pulse mb-2"></div>
              ) : (
              <p className="text-3xl font-bold text-gray-900">{formatKES(totalCollectedMonth)}</p>
              )}
              {loadingRepayments ? (
                <div className="h-4 bg-gray-200 rounded animate-pulse w-24 mt-2"></div>
              ) : (
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
              )}
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
              {loadingRepayments ? (
                <div className="h-9 bg-gray-200 rounded animate-pulse mb-2"></div>
              ) : (
              <p className="text-3xl font-bold text-gray-900">{collectionRatePct.display}</p>
              )}
              {loadingRepayments ? (
                <div className="h-4 bg-gray-200 rounded animate-pulse w-32 mt-2"></div>
              ) : (
              <p className="text-xs text-gray-500 mt-2">Efficiency: {collectionEfficiency.toFixed(1)}%</p>
              )}
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
              {loadingRepayments ? (
                <div className="h-9 bg-gray-200 rounded animate-pulse mb-2"></div>
              ) : (
              <p className="text-3xl font-bold text-gray-900">{formatKES(totalOutstandingMonth)}</p>
              )}
              {loadingRepayments ? (
                <div className="h-4 bg-gray-200 rounded animate-pulse w-28 mt-2"></div>
              ) : (
              <p className="text-xs text-gray-500 mt-2">
                  {currentMonthTarget > 0 ? `${((totalOutstandingMonth / currentMonthTarget) * 100).toFixed(1)}% of target` : '0.0% of target'}
              </p>
              )}
            </div>
            <div className="p-4 rounded-xl bg-red-500 text-white">
              <AlertCircle size={28} />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow-sm border border-purple-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">MTD Target</p>
              {loadingRepayments ? (
                <div className="h-9 bg-gray-200 rounded animate-pulse mb-2"></div>
              ) : (
                <p className="text-3xl font-bold text-gray-900">{formatKES(mtdTargetTotal)}</p>
              )}
              {loadingRepayments ? (
                <div className="h-4 bg-gray-200 rounded animate-pulse w-40 mt-2"></div>
              ) : (
              <p className="text-xs text-gray-500 mt-2">
                  Sum of MTD targets for all clients in {new Date(2000, selectedMonth-1, 1).toLocaleString('en-US', { month: 'long' })} {selectedYear}
              </p>
              )}
            </div>
            <div className="p-4 rounded-xl bg-purple-500 text-white">
              <Target size={28} />
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
                {new Date(selectedYear, selectedMonth - 1).toLocaleString('en-US', { month: 'long' })} Total Expected Collection
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatKES(currentMonthTarget)}</p>
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
              <p className="text-2xl font-bold text-gray-900 mt-1">{clientPerformanceData.filter(c => c.activeDays > 0).length.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 text-gray-600">
              <Users size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Performing Loan Officers */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-900">Top Performing Loan Officers</h3>
            <BarChart3 className="text-gray-400" size={18} />
          </div>
          {topOfficers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700">Officer</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700">Collected</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700">Rate</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700">Loans</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {topOfficers.map((officer, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-2 font-medium text-gray-900 text-xs">{officer.name.length > 15 ? officer.name.substring(0, 15) + '...' : officer.name}</td>
                      <td className="px-2 py-2 text-right font-semibold text-gray-900 text-xs">{formatKES(officer.collected)}</td>
                      <td className="px-2 py-2 text-right">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                          officer.rate >= 90 ? 'bg-green-100 text-green-800' :
                          officer.rate >= 70 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {officer.rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right text-gray-600 text-xs">{officer.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-48 bg-gray-50 rounded-lg flex items-center justify-center">
              <p className="text-gray-500 text-sm">No data available</p>
            </div>
          )}
        </div>

        {/* Branch Breakdown Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Branch Breakdown</h3>
          {branchBreakdown.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Branch
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Charges at Disbursement
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" colSpan={2}>
                        MTD Target
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" colSpan={2}>
                        EoM Target
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Repaid Current Month
                      </th>
                    </tr>
                    <tr>
                      <th></th>
                      <th></th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        %
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        %
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {branchBreakdown.map((branch, idx) => {
                      // Calculate collection rate percentages: Repaid Current Month / Target
                      const mtdPct = branch.mtdTarget > 0 ? (branch.repaidCurrentMonth / branch.mtdTarget) * 100 : 0
                      const eomPct = branch.eomTarget > 0 ? (branch.repaidCurrentMonth / branch.eomTarget) * 100 : 0
                      return (
                        <tr key={branch.branch} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                            {branch.branch}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatKES(branch.totalChargesAtDisbursement)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatKES(branch.mtdTarget)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                            <span className={`font-semibold ${
                              mtdPct >= 70 ? 'text-green-600' :
                              mtdPct >= 50 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {mtdPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatKES(branch.eomTarget)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                            <span className={`font-semibold ${
                              eomPct >= 70 ? 'text-green-600' :
                              eomPct >= 50 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {eomPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-green-600 text-right">
                            {formatKES(branch.repaidCurrentMonth)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
            </div>
          ) : (
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <p className="text-gray-500">No branch data available</p>
            </div>
          )}
        </div>
      </div>

      {/* Daily Expected vs Collected */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Daily Expected vs Collected ({new Date(2000, selectedMonth-1, 1).toLocaleString('en-US', { month: 'long' })} {selectedYear})
        </h3>
        {loadingDailyRepayments ? (
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
              <p className="text-gray-500">Loading daily data...</p>
            </div>
          </div>
        ) : dailyExpectedVsCollected.length > 0 ? (
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

      {/* Client Performance Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Client Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Daily Installment</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">MTD Target</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">EoM Target</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Repaid Current Month</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">EoM Rate %</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Repaid</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Expected Collection</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {clientPerformanceData.map((item, idx) => {
                const eomRate = item.eomTarget > 0 ? (item.repaidCurrentMonth / item.eomTarget) * 100 : 0
                return (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.client}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatKES(item.dailyInstallment)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatKES(item.mtdTarget)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatKES(item.eomTarget)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600 text-right">{formatKES(item.repaidCurrentMonth)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-right" style={{ color: eomRate >= 100 ? '#10b981' : eomRate >= 80 ? '#f59e0b' : '#ef4444' }}>
                      {eomRate.toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-blue-600 text-right">{formatKES(item.totalRepaid)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 text-right">{formatKES(item.totalExpected)}</td>
                  </tr>
                )
              })}
                {clientPerformanceData.length === 0 && (
                <tr>
                    <td className="px-6 py-6 text-center text-gray-500" colSpan={8}>No client data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default BodaCollection

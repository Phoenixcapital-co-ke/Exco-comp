import React, { useState, useEffect, useMemo } from 'react'
import { Activity, Users, Target, Award, ChevronDown, ChevronRight } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { formatKES } from '../../utils/format.js'

function LogbookProductivity() {
  const nowInit = new Date()
  const [selectedMonth, setSelectedMonth] = useState(nowInit.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(nowInit.getFullYear())
  const [borrowerData, setBorrowerData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [staffParData, setStaffParData] = useState([])
  const [staffParLoading, setStaffParLoading] = useState(true)
  const [staffParError, setStaffParError] = useState(null)
  const [expandedRows, setExpandedRows] = useState(new Set())

  useEffect(() => {
    loadBorrowerData()
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    loadStaffParData()
  }, [])

  const loadBorrowerData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(API_URLS.logbook.collectorPerformance(selectedMonth, selectedYear), { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`Failed to load borrower data (${res.status})`)
      }
      const data = await res.json()
      setBorrowerData(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Error loading borrower data:', e)
      setError(e.message)
      setBorrowerData([])
    } finally {
      setLoading(false)
    }
  }

  const loadStaffParData = async () => {
    try {
      setStaffParLoading(true)
      setStaffParError(null)
      const res = await fetch(API_URLS.par.borrowerAccess, { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`Failed to load staff PAR data (${res.status})`)
      }
      const data = await res.json()
      setStaffParData(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Error loading staff PAR data:', e)
      setStaffParError(e.message)
      setStaffParData([])
    } finally {
      setStaffParLoading(false)
    }
  }

  // Toggle row expansion
  const toggleRowExpansion = (borrowerId) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(borrowerId)) {
      newExpanded.delete(borrowerId)
    } else {
      newExpanded.add(borrowerId)
    }
    setExpandedRows(newExpanded)
  }

  // Create a map of borrower_access_id to PAR rate
  const parRateMap = useMemo(() => {
    const map = new Map()
    for (const entry of staffParData) {
      if (entry.officerId) {
        map.set(String(entry.officerId), Number(entry.parRate) || 0)
      }
    }
    return map
  }, [staffParData])

  // Calculate summary stats
  const totalBorrowers = borrowerData.length
  const totalRepayment = borrowerData.reduce((sum, item) => sum + (Number(item.total_repayment_amount) || 0), 0)
  const totalPortfolio = borrowerData.reduce((sum, item) => sum + (Number(item.portfolio) || 0), 0)
  const totalTarget = borrowerData.reduce((sum, item) => sum + (Number(item.target) || 0), 0)
  const overallPercentageAchieved = totalTarget > 0 ? (totalRepayment / totalTarget) * 100 : null
  const overallPercentOver100 = overallPercentageAchieved !== null
    ? (overallPercentageAchieved >= 100 ? 100 : overallPercentageAchieved)
    : null

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
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Loans Processed</p>
              <p className="text-2xl font-bold text-gray-900">224</p>
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
              <p className="text-2xl font-bold text-gray-900">96.4%</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <Target size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Staff</p>
              <p className="text-2xl font-bold text-gray-900">5</p>
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
              <p className="text-2xl font-bold text-gray-900">David</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Award size={24} />
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
          ) : borrowerData.length === 0 && !loading ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">No borrower data available for the selected month</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Borrower Access ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Repayment Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage Achieved</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Percent Over 100%</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {borrowerData.map((item, index) => {
                  const targetVal = Number(item.target) || 0
                  const repaymentVal = Number(item.total_repayment_amount) || 0
                  const portfolioVal = Number(item.portfolio) || 0
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
                  // PAR uses range-based scoring: Below 8% = 100%, 9-12% = 80%, 12-15% = 60%
                  // Note: Lower PAR is better, so we use inverted logic
                  let parPercentageAchieved = null
                  let parPercentOver100 = null
                  let parPerformanceScore = null
                  if (parPercentage > 0) {
                    // Calculate percentage achieved (inverted: lower PAR is better)
                    parPercentageAchieved = parTarget > 0 ? ((parTarget / parPercentage) * 100) : null
                    
                    // Determine performance score based on PAR ranges
                    if (parPercentage <= 8) {
                      parPercentOver100 = 100
                      parPerformanceScore = 100
                    } else if (parPercentage <= 12) {
                      parPercentOver100 = 80
                      parPerformanceScore = 80
                    } else if (parPercentage <= 15) {
                      parPercentOver100 = 60
                      parPerformanceScore = 60
                    } else {
                      // Above 15%, calculate as percentage of target (inverted)
                      parPercentOver100 = Math.max(0, ((parTarget / parPercentage) * 100))
                      parPerformanceScore = parPercentOver100 >= 100 ? 100 : parPercentOver100
                    }
                  }
                  
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
                            {item.borrower_access_id || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                          {item.name || '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatKES(portfolioVal)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatKES(targetVal)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatKES(repaymentVal)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {percentageAchieved === null ? '—' : `${percentageAchieved.toFixed(1)}%`}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {percentOver100 === null ? '—' : `${percentOver100.toFixed(1)}%`}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="px-6 py-6">
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
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatKES(repaymentVal)}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{targetVal > 0 ? formatKES(targetVal) : '—'}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{percentageAchieved === null ? '—' : `${percentageAchieved.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{percentOver100 === null ? '—' : `${percentOver100.toFixed(1)}%`}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">40%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                                          {percentOver100 !== null ? `${((percentOver100 / 100) * 40).toFixed(2)}%` : '—'}
                                        </td>
                                      </tr>
                                      <tr className="bg-gray-50">
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">Portfolio</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatKES(portfolioVal)}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{portfolioTargetVal > 0 ? formatKES(portfolioTargetVal) : '—'}</td>
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
                                      <tr className="bg-gray-50">
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">New Sales</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">10%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                      </tr>
                                      <tr>
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">Repeat Sales</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">20%</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right">—</td>
                                      </tr>
                                      <tr className="bg-blue-50 border-t-2 border-blue-200">
                                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">Weighted Performance</td>
                                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right" colSpan={5}>—</td>
                                        <td className="px-4 py-3 text-sm font-semibold text-blue-900 text-right">—</td>
                                      </tr>
                                      <tr>
                                        <td className="px-4 py-3 text-sm font-medium text-gray-900">Net Sales</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 text-right" colSpan={6}>—</td>
                                      </tr>
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
                                      <span className="text-sm font-semibold text-gray-900">—</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-700">Net Sales Commission</span>
                                      <span className="text-sm font-semibold text-gray-900">—</span>
                                    </div>
                                    <div className="border-t border-gray-300 pt-2 flex justify-between items-center">
                                      <span className="text-sm font-semibold text-gray-900">Total Commission</span>
                                      <span className="text-sm font-semibold text-gray-900">—</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-700">Retainer</span>
                                      <span className="text-sm font-semibold text-gray-900">—</span>
                                    </div>
                                    <div className="border-t-2 border-gray-400 pt-2 flex justify-between items-center">
                                      <span className="text-base font-bold text-gray-900">Total Pay</span>
                                      <span className="text-base font-bold text-gray-900">—</span>
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
              {borrowerData.length > 0 && (
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900" colSpan={2}>Total</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{formatKES(totalPortfolio)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{formatKES(totalTarget)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">{formatKES(totalRepayment)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">
                      {overallPercentageAchieved === null ? '—' : `${overallPercentageAchieved.toFixed(1)}%`}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right">
                      {overallPercentOver100 === null ? '—' : `${overallPercentOver100.toFixed(1)}%`}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* Productivity Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Staff Productivity Metrics</h3>
        </div>
        <div className="overflow-x-auto">
          {staffParError ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-red-600">Error loading staff PAR data: {staffParError}</p>
            </div>
          ) : staffParLoading && staffParData.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              Loading staff productivity metrics...
            </div>
          ) : staffParData.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              No staff productivity data available. Ensure PAR snapshots are running.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Borrower Access ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Snapshot Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Open Loans (Portfolio)
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Past-Missed Repayment
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PAR %
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {staffParData.map((entry) => (
                  <tr key={entry.officerId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {entry.officerId || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {entry.snapshotTime
                        ? new Date(entry.snapshotTime).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: '2-digit',
                            timeZone: 'Africa/Nairobi',
                          })
                        : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatKES(Number(entry.openLoans) || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatKES(Number(entry.pastMissed) || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {entry.openLoans > 0 ? `${((Number(entry.pastMissed) || 0) / Number(entry.openLoans) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default LogbookProductivity


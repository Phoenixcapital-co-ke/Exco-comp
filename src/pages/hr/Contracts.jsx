import React, { useEffect, useState, useMemo } from 'react'
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts'
import { Calendar, AlertTriangle, Clock, FileText, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

function HRContracts() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    const loadEmployees = async () => {
      try {
        setLoading(true)
        const res = await fetch(API_URLS.hr.employees, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Failed to load employees: ${res.status}`)
        }
        const data = await res.json()
        setEmployees(Array.isArray(data) ? data : [])
      } catch (e) {
        if (e.name === 'AbortError') return
        setError(e.message)
        setEmployees([])
      } finally {
        setLoading(false)
      }
    }
    loadEmployees()
    return () => controller.abort()
  }, [])

  const calculateDaysUntil = (dateStr) => {
    if (!dateStr) return null
    try {
      const date = new Date(dateStr)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      date.setHours(0, 0, 0, 0)
      const diffTime = date - today
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      return diffDays
    } catch {
      return null
    }
  }

  const calculateContractDuration = (startStr, endStr) => {
    if (!startStr || !endStr) return null
    try {
      const start = new Date(startStr)
      const end = new Date(endStr)
      const diffTime = end - start
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      return diffDays
    } catch {
      return null
    }
  }

  // Contract Status Overview
  const contractStatus = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    
    let active = 0
    let expiringSoon = 0
    let expired = 0
    let noEndDate = 0

    employees.forEach(emp => {
      if (!emp.contract_end) {
        noEndDate++
      } else {
        try {
          const endDate = new Date(emp.contract_end)
          endDate.setHours(0, 0, 0, 0)
          const daysUntil = calculateDaysUntil(emp.contract_end)
          
          if (daysUntil < 0) {
            expired++
          } else if (daysUntil <= 90) {
            expiringSoon++
          } else {
            active++
          }
        } catch {
          noEndDate++
        }
      }
    })

    return { active, expiringSoon, expired, noEndDate }
  }, [employees])

  // Contracts Expiring Timeline
  const contractExpiryTimeline = useMemo(() => {
    const timelineMap = new Map()
    employees.forEach(emp => {
      if (emp.contract_end) {
        try {
          const endDate = new Date(emp.contract_end)
          const monthKey = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`
          const daysUntil = calculateDaysUntil(emp.contract_end)
          
          if (daysUntil >= 0 && daysUntil <= 180) {
            timelineMap.set(monthKey, (timelineMap.get(monthKey) || 0) + 1)
          }
        } catch {}
      }
    })
    
    return Array.from(timelineMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [employees])

  // Contract Duration Distribution
  const contractDurationData = useMemo(() => {
    const durations = employees
      .map(emp => calculateContractDuration(emp.contract_start, emp.contract_end))
      .filter(d => d !== null && d > 0)
    
    const bins = {}
    durations.forEach(days => {
      const bin = Math.floor(days / 30) * 30 // Group by months
      bins[bin] = (bins[bin] || 0) + 1
    })
    
    return Object.entries(bins)
      .map(([days, count]) => ({ duration: `${parseInt(days) / 30} months`, count }))
      .sort((a, b) => parseFloat(a.duration) - parseFloat(b.duration))
      .slice(0, 12)
  }, [employees])

  // Upcoming Expirations
  const upcomingExpirations = useMemo(() => {
    return employees
      .filter(emp => {
        if (!emp.contract_end) return false
        const daysUntil = calculateDaysUntil(emp.contract_end)
        return daysUntil >= 0 && daysUntil <= 90
      })
      .map(emp => ({
        ...emp,
        daysUntil: calculateDaysUntil(emp.contract_end),
        fullName: [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown'
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil)
  }, [employees])

  // Expired Contracts
  const expiredContracts = useMemo(() => {
    return employees
      .filter(emp => {
        if (!emp.contract_end) return false
        const daysUntil = calculateDaysUntil(emp.contract_end)
        return daysUntil < 0
      })
      .map(emp => ({
        ...emp,
        daysSince: Math.abs(calculateDaysUntil(emp.contract_end)),
        fullName: [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown'
      }))
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, 50)
  }, [employees])

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading contract data</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Contract Management</h1>
        <p className="text-gray-600 mt-2">Track and manage employee contracts</p>
      </header>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading contract data...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Contract Status Cards */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Active Contracts</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{contractStatus.active}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 text-green-600">
                  <FileText size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Expiring Soon (≤90 days)</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{contractStatus.expiringSoon}</p>
                </div>
                <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
                  <AlertTriangle size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Expired</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{contractStatus.expired}</p>
                </div>
                <div className="p-3 rounded-lg bg-red-50 text-red-600">
                  <Clock size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">No End Date</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{contractStatus.noEndDate}</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 text-gray-600">
                  <Calendar size={24} />
                </div>
              </div>
            </div>
          </section>

          {/* Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contract Expiry Timeline */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar size={20} />
                Contracts Expiring (Next 6 Months)
              </h3>
              {contractExpiryTimeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={contractExpiryTimeline}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No contracts expiring in the next 6 months</div>
              )}
            </div>

            {/* Contract Duration Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Contract Duration Distribution</h3>
              {contractDurationData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={contractDurationData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="duration" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Upcoming Expirations Table */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Upcoming Expirations (Next 90 Days)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Employee</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Department</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Branch</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Contract Start</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Contract End</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Days Until Expiry</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {upcomingExpirations.length > 0 ? (
                    upcomingExpirations.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{emp.fullName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.department || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.region || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {emp.contract_start ? new Date(emp.contract_start).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {emp.contract_end ? new Date(emp.contract_end).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            emp.daysUntil <= 30 ? 'bg-red-100 text-red-800' :
                            emp.daysUntil <= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {emp.daysUntil} days
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No contracts expiring in the next 90 days</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Expired Contracts Table */}
          {expiredContracts.length > 0 && (
            <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Recently Expired Contracts</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Employee</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Department</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Contract End</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Days Since Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {expiredContracts.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{emp.fullName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.department || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {emp.contract_end ? new Date(emp.contract_end).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                            {emp.daysSince} days ago
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default HRContracts


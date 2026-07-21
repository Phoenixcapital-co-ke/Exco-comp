import React, { useEffect, useState, useMemo } from 'react'
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  LineChart, 
  Line,
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts'
import { Users, Building2, TrendingUp, Calendar, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { HrShell, HrToolbar } from '../../components/hr/HrUi.jsx'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1']

function HRAnalytics() {
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

  // Calculate age from date of birth
  const calculateAge = (dob) => {
    if (!dob) return null
    try {
      const birthDate = new Date(dob)
      const today = new Date()
      let age = today.getFullYear() - birthDate.getFullYear()
      const monthDiff = today.getMonth() - birthDate.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--
      }
      return age
    } catch {
      return null
    }
  }

  // Department Distribution
  const departmentData = useMemo(() => {
    const deptMap = new Map()
    employees.forEach(emp => {
      if (emp.department) {
        deptMap.set(emp.department, (deptMap.get(emp.department) || 0) + 1)
      }
    })
    return Array.from(deptMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [employees])

  // Branch/Region Distribution
  const branchData = useMemo(() => {
    const branchMap = new Map()
    employees.forEach(emp => {
      if (emp.region) {
        branchMap.set(emp.region, (branchMap.get(emp.region) || 0) + 1)
      }
    })
    return Array.from(branchMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [employees])

  // Gender Distribution
  const genderData = useMemo(() => {
    const genderMap = new Map()
    employees.forEach(emp => {
      const gender = emp.gender || 'Not Specified'
      genderMap.set(gender, (genderMap.get(gender) || 0) + 1)
    })
    return Array.from(genderMap.entries())
      .map(([name, value]) => ({ name, value }))
  }, [employees])

  // Employment Type Distribution
  const employmentTypeData = useMemo(() => {
    const typeMap = new Map()
    employees.forEach(emp => {
      const type = emp.employment_type || 'Not Specified'
      typeMap.set(type, (typeMap.get(type) || 0) + 1)
    })
    return Array.from(typeMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [employees])

  // Active vs Inactive
  const activeStatusData = useMemo(() => {
    const active = employees.filter(e => e.active === '1' || e.active === 1).length
    const inactive = employees.length - active
    return [
      { name: 'Active', value: active },
      { name: 'Inactive', value: inactive }
    ]
  }, [employees])

  // Hiring Trends (by contract_start date)
  const hiringTrendData = useMemo(() => {
    const trendMap = new Map()
    employees.forEach(emp => {
      if (emp.contract_start) {
        try {
          const date = new Date(emp.contract_start)
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          trendMap.set(monthKey, (trendMap.get(monthKey) || 0) + 1)
        } catch {}
      }
    })
    return Array.from(trendMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12) // Last 12 months
  }, [employees])

  // Age Groups
  const ageGroupData = useMemo(() => {
    const groups = {
      '18-25': 0,
      '26-35': 0,
      '36-45': 0,
      '46-55': 0,
      '56-65': 0,
      '65+': 0
    }
    employees.forEach(emp => {
      const age = calculateAge(emp.date_of_birth)
      if (age !== null) {
        if (age <= 25) groups['18-25']++
        else if (age <= 35) groups['26-35']++
        else if (age <= 45) groups['36-45']++
        else if (age <= 55) groups['46-55']++
        else if (age <= 65) groups['56-65']++
        else groups['65+']++
      }
    })
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0)
  }, [employees])

  // Contract Expiry Timeline
  const contractExpiryData = useMemo(() => {
    const now = new Date()
    const next6Months = new Date()
    next6Months.setMonth(next6Months.getMonth() + 6)
    
    const expiryMap = new Map()
    employees.forEach(emp => {
      if (emp.contract_end) {
        try {
          const endDate = new Date(emp.contract_end)
          if (endDate >= now && endDate <= next6Months) {
            const monthKey = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`
            expiryMap.set(monthKey, (expiryMap.get(monthKey) || 0) + 1)
          }
        } catch {}
      }
    })
    return Array.from(expiryMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [employees])

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading analytics</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <HrShell>
      <HrToolbar page="ANALYTICS" />
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">HR Analytics</h1>
        <p className="text-gray-600 mt-2">Comprehensive workforce analytics and insights</p>
      </header>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading analytics...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Distribution Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Department Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 size={20} />
                Employee Distribution by Department
              </h3>
              {departmentData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={departmentData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {departmentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>

            {/* Branch Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 size={20} />
                Employee Distribution by Branch
              </h3>
              {branchData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={branchData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {branchData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>

            {/* Gender Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users size={20} />
                Gender Distribution
              </h3>
              {genderData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={genderData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {genderData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>

            {/* Active vs Inactive */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users size={20} />
                Active vs Inactive Employees
              </h3>
              {activeStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={activeStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {activeStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Bar Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employment Type */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Employment Type Distribution</h3>
              {employmentTypeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={employmentTypeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>

            {/* Age Groups */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Age Group Distribution</h3>
              {ageGroupData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ageGroupData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Line Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hiring Trends */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp size={20} />
                Hiring Trends (Last 12 Months)
              </h3>
              {hiringTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={hiringTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>

            {/* Contract Expiry Timeline */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar size={20} />
                Contracts Expiring (Next 6 Months)
              </h3>
              {contractExpiryData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={contractExpiryData}>
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
          </section>
        </>
      )}
    </div>
    </HrShell>
  )
}

export default HRAnalytics


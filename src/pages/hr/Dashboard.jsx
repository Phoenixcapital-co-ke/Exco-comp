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
import { Users, Mail, Phone, Building2, Briefcase, Calendar, Loader2, Search, TrendingUp } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1']

function HRDashboard() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

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

  // Filter employees based on search query
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees
    const query = searchQuery.toLowerCase().trim()
    return employees.filter((emp) => {
      const fullName = `${emp.first_name || ''} ${emp.last_name || ''} ${emp.middle_name || ''}`.toLowerCase()
      const email = ((emp.official_email || emp.personal_email) || '').toLowerCase()
      const phone = (emp.telephone || '').toLowerCase()
      const employeeNumber = (emp.employee_number || '').toLowerCase()
      const department = (emp.department || '').toLowerCase()
      const position = (emp.job_title || '').toLowerCase()
      
      return (
        fullName.includes(query) ||
        email.includes(query) ||
        phone.includes(query) ||
        employeeNumber.includes(query) ||
        department.includes(query) ||
        position.includes(query)
      )
    })
  }, [employees, searchQuery])

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

  // Statistics
  const stats = useMemo(() => {
    const total = employees.length
    const active = employees.filter((e) => e.active === '1' || e.active === 1).length
    const departments = new Set(employees.map((e) => e.department).filter(Boolean)).size
    const branches = new Set(employees.map((e) => e.region).filter(Boolean)).size
    
    return { total, active, departments, branches }
  }, [employees])

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
          const monthKey = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`
          const daysUntil = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24))
          
          if (daysUntil >= 0 && daysUntil <= 180) {
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
          <p className="text-lg font-semibold">Error loading employees</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">HR Management</h1>
          <p className="text-gray-600 mt-2">Manage and view employee information from Wingubox</p>
        </div>
      </header>

      {/* Statistics Cards */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded animate-pulse mb-3 w-24"></div>
                  <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 w-32"></div>
                </div>
                <div className="p-3 rounded-lg bg-gray-100">
                  <div className="w-5 h-5 bg-gray-200 rounded animate-pulse"></div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Employees</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                  <Users size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Active Employees</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.active.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 text-green-600">
                  <Users size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Departments</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.departments.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
                  <Building2 size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Branches</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.branches.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
                  <Building2 size={24} />
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Analytics Visualizations */}
      {!loading && (
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

          </section>

          {/* Bar Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

      {/* Employees Table */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Employees</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
                <p className="text-gray-500 text-sm">Loading employees...</p>
              </div>
            </div>
          ) : filteredEmployees.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Employee</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Employee Number</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Contact</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Department</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Position</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Employment Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Hire Date</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredEmployees.map((employee) => {
                  const fullName = [
                    employee.first_name,
                    employee.middle_name,
                    employee.last_name
                  ].filter(Boolean).join(' ') || 'Unknown'
                  
                  const isActive = employee.active === '1' || employee.active === 1
                  
                  return (
                    <tr key={employee.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-blue-600 font-semibold text-sm">
                              {fullName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{fullName}</div>
                            {employee.employee_id && (
                              <div className="text-sm text-gray-500">ID: {employee.employee_id}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.employee_number || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {(employee.official_email || employee.personal_email) && (
                            <div className="flex items-center gap-1 text-gray-600">
                              <Mail size={14} />
                              <span>{employee.official_email || employee.personal_email}</span>
                            </div>
                          )}
                          {employee.telephone && (
                            <div className="flex items-center gap-1 text-gray-600 mt-1">
                              <Phone size={14} />
                              <span>{employee.telephone}</span>
                            </div>
                          )}
                          {!employee.official_email && !employee.personal_email && !employee.telephone && <span className="text-gray-400">-</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.department || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.job_title || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.employment_type || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {isActive ? 'Active' : 'Terminated'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.contract_start ? (
                          <div className="flex items-center gap-1">
                            <Calendar size={14} className="text-gray-400" />
                            <span>{new Date(employee.contract_start).toLocaleDateString()}</span>
                          </div>
                        ) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="h-64 flex items-center justify-center">
              <div className="text-center">
                <Users className="text-gray-400 mx-auto mb-2" size={48} />
                <p className="text-gray-500 text-sm">
                  {searchQuery ? 'No employees found matching your search' : 'No employees found'}
                </p>
              </div>
            </div>
          )}
        </div>
        {!loading && filteredEmployees.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
            Showing {filteredEmployees.length} of {employees.length} employees
          </div>
        )}
      </section>
    </div>
  )
}

export default HRDashboard


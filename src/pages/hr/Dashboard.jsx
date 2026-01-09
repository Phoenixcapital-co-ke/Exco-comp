import React, { useEffect, useState, useMemo } from 'react'
import { Users, Mail, Phone, Building2, Briefcase, Calendar, Loader2, Search } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

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

  // Statistics
  const stats = useMemo(() => {
    const total = employees.length
    const active = employees.filter((e) => e.active === '1' || e.active === 1).length
    const departments = new Set(employees.map((e) => e.department).filter(Boolean)).size
    const branches = new Set(employees.map((e) => e.region).filter(Boolean)).size
    
    return { total, active, departments, branches }
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


import React, { useEffect, useState, useMemo } from 'react'
import { Users, Mail, Phone, Building2, Briefcase, Calendar, Search, Filter, Download, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { HrShell, HrToolbar } from '../../components/hr/HrUi.jsx'

function HRDirectory() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({
    department: '',
    branch: '',
    status: '',
    employmentType: ''
  })

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

  // Get unique filter options
  const filterOptions = useMemo(() => {
    const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort()
    const branches = [...new Set(employees.map(e => e.region).filter(Boolean))].sort()
    const employmentTypes = [...new Set(employees.map(e => e.employment_type).filter(Boolean))].sort()
    return { departments, branches, employmentTypes }
  }, [employees])

  // Filter employees
  const filteredEmployees = useMemo(() => {
    let filtered = employees

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(emp => {
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
    }

    // Department filter
    if (filters.department) {
      filtered = filtered.filter(emp => emp.department === filters.department)
    }

    // Branch filter
    if (filters.branch) {
      filtered = filtered.filter(emp => emp.region === filters.branch)
    }

    // Status filter
    if (filters.status) {
      if (filters.status === 'active') {
        filtered = filtered.filter(emp => emp.active === '1' || emp.active === 1)
      } else if (filters.status === 'inactive') {
        filtered = filtered.filter(emp => emp.active !== '1' && emp.active !== 1)
      }
    }

    // Employment type filter
    if (filters.employmentType) {
      filtered = filtered.filter(emp => emp.employment_type === filters.employmentType)
    }

    return filtered
  }, [employees, searchQuery, filters])

  const handleExport = () => {
    const csv = [
      ['Name', 'Employee Number', 'Department', 'Branch', 'Position', 'Email', 'Phone', 'Status', 'Contract Start', 'Contract End'].join(','),
      ...filteredEmployees.map(emp => {
        const fullName = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ')
        const email = emp.official_email || emp.personal_email || ''
        const status = (emp.active === '1' || emp.active === 1) ? 'Active' : 'Inactive'
        return [
          `"${fullName}"`,
          emp.employee_number || '',
          `"${emp.department || ''}"`,
          `"${emp.region || ''}"`,
          `"${emp.job_title || ''}"`,
          email,
          emp.telephone || '',
          status,
          emp.contract_start || '',
          emp.contract_end || ''
        ].join(',')
      })
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `employee_directory_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading directory</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <HrShell>
      <HrToolbar page="DIRECTORY" />
    <div className="space-y-6 pb-10">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Employee Directory</h1>
          <p className="text-gray-600 mt-2">Comprehensive employee directory with advanced filtering</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Download size={18} />
          Export CSV
        </button>
      </header>

      {/* Filters */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <select
            value={filters.department}
            onChange={(e) => setFilters({ ...filters, department: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Departments</option>
            {filterOptions.departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>

          <select
            value={filters.branch}
            onChange={(e) => setFilters({ ...filters, branch: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Branches</option>
            {filterOptions.branches.map(branch => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <select
            value={filters.employmentType}
            onChange={(e) => setFilters({ ...filters, employmentType: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Employment Types</option>
            {filterOptions.employmentTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Employees Grid */}
      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading directory...</p>
          </div>
        </div>
      ) : filteredEmployees.length > 0 ? (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEmployees.map((employee) => {
            const fullName = [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown'
            const isActive = employee.active === '1' || employee.active === 1
            
            return (
              <div key={employee.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-blue-600 font-semibold text-lg">
                        {fullName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{fullName}</h3>
                      {employee.employee_number && (
                        <p className="text-sm text-gray-500">#{employee.employee_number}</p>
                      )}
                    </div>
                  </div>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="space-y-2 text-sm">
                  {employee.job_title && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Briefcase size={16} className="text-gray-400" />
                      <span>{employee.job_title}</span>
                    </div>
                  )}
                  {employee.department && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Building2 size={16} className="text-gray-400" />
                      <span>{employee.department}</span>
                    </div>
                  )}
                  {employee.region && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Building2 size={16} className="text-gray-400" />
                      <span>{employee.region}</span>
                    </div>
                  )}
                  {(employee.official_email || employee.personal_email) && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Mail size={16} className="text-gray-400" />
                      <span className="truncate">{employee.official_email || employee.personal_email}</span>
                    </div>
                  )}
                  {employee.telephone && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Phone size={16} className="text-gray-400" />
                      <span>{employee.telephone}</span>
                    </div>
                  )}
                  {employee.contract_start && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Calendar size={16} className="text-gray-400" />
                      <span>Started: {new Date(employee.contract_start).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ) : (
        <div className="h-64 flex items-center justify-center bg-white rounded-xl border border-gray-200">
          <div className="text-center">
            <Users className="text-gray-400 mx-auto mb-2" size={48} />
            <p className="text-gray-500 text-sm">
              {searchQuery || Object.values(filters).some(f => f) 
                ? 'No employees found matching your filters' 
                : 'No employees found'}
            </p>
          </div>
        </div>
      )}

      {!loading && filteredEmployees.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4 text-sm text-gray-600">
          Showing {filteredEmployees.length} of {employees.length} employees
        </div>
      )}
    </div>
    </HrShell>
  )
}

export default HRDirectory


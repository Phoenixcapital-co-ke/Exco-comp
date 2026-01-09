import React, { useEffect, useState, useMemo } from 'react'
import { FileText, Download, Calendar, TrendingUp, Users, Building2, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

function HRReports() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedReport, setSelectedReport] = useState('summary')

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

  // Summary Report Data
  const summaryReport = useMemo(() => {
    const total = employees.length
    const active = employees.filter(e => e.active === '1' || e.active === 1).length
    const inactive = total - active
    const departments = new Set(employees.map(e => e.department).filter(Boolean)).size
    const branches = new Set(employees.map(e => e.region).filter(Boolean)).size
    const avgAge = employees
      .map(e => calculateAge(e.date_of_birth))
      .filter(a => a !== null)
    const avgAgeValue = avgAge.length > 0 ? (avgAge.reduce((a, b) => a + b, 0) / avgAge.length).toFixed(1) : 0

    return { total, active, inactive, departments, branches, avgAge: avgAgeValue }
  }, [employees])

  // Department Report
  const departmentReport = useMemo(() => {
    const deptMap = new Map()
    employees.forEach(emp => {
      if (emp.department) {
        if (!deptMap.has(emp.department)) {
          deptMap.set(emp.department, { total: 0, active: 0 })
        }
        const dept = deptMap.get(emp.department)
        dept.total++
        if (emp.active === '1' || emp.active === 1) {
          dept.active++
        }
      }
    })
    return Array.from(deptMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
  }, [employees])

  // Branch Report
  const branchReport = useMemo(() => {
    const branchMap = new Map()
    employees.forEach(emp => {
      if (emp.region) {
        if (!branchMap.has(emp.region)) {
          branchMap.set(emp.region, { total: 0, active: 0 })
        }
        const branch = branchMap.get(emp.region)
        branch.total++
        if (emp.active === '1' || emp.active === 1) {
          branch.active++
        }
      }
    })
    return Array.from(branchMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
  }, [employees])

  const exportReport = (type) => {
    let csv = []
    let filename = ''

    if (type === 'summary') {
      filename = `hr_summary_report_${new Date().toISOString().split('T')[0]}.csv`
      csv = [
        ['Metric', 'Value'],
        ['Total Employees', summaryReport.total],
        ['Active Employees', summaryReport.active],
        ['Inactive Employees', summaryReport.inactive],
        ['Total Departments', summaryReport.departments],
        ['Total Branches', summaryReport.branches],
        ['Average Age', summaryReport.avgAge]
      ]
    } else if (type === 'department') {
      filename = `hr_department_report_${new Date().toISOString().split('T')[0]}.csv`
      csv = [
        ['Department', 'Total Employees', 'Active Employees', 'Inactive Employees'],
        ...departmentReport.map(dept => [
          `"${dept.name}"`,
          dept.total,
          dept.active,
          dept.total - dept.active
        ])
      ]
    } else if (type === 'branch') {
      filename = `hr_branch_report_${new Date().toISOString().split('T')[0]}.csv`
      csv = [
        ['Branch', 'Total Employees', 'Active Employees', 'Inactive Employees'],
        ...branchReport.map(branch => [
          `"${branch.name}"`,
          branch.total,
          branch.active,
          branch.total - branch.active
        ])
      ]
    } else if (type === 'full') {
      filename = `hr_full_report_${new Date().toISOString().split('T')[0]}.csv`
      csv = [
        ['Name', 'Employee Number', 'Department', 'Branch', 'Position', 'Employment Type', 'Status', 'Email', 'Phone', 'Contract Start', 'Contract End'],
        ...employees.map(emp => {
          const fullName = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ')
          const email = emp.official_email || emp.personal_email || ''
          const status = (emp.active === '1' || emp.active === 1) ? 'Active' : 'Inactive'
          return [
            `"${fullName}"`,
            emp.employee_number || '',
            `"${emp.department || ''}"`,
            `"${emp.region || ''}"`,
            `"${emp.job_title || ''}"`,
            `"${emp.employment_type || ''}"`,
            status,
            email,
            emp.telephone || '',
            emp.contract_start || '',
            emp.contract_end || ''
          ]
        })
      ]
    }

    const csvContent = csv.map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading reports</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">HR Reports</h1>
        <p className="text-gray-600 mt-2">Generate and export comprehensive HR reports</p>
      </header>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading reports...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Report Cards */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedReport('summary')}>
              <div className="flex items-center justify-between mb-4">
                <FileText className="text-blue-600" size={24} />
                <button
                  onClick={(e) => { e.stopPropagation(); exportReport('summary') }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <Download size={18} className="text-gray-600" />
                </button>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary Report</h3>
              <p className="text-sm text-gray-600">Overall workforce statistics and metrics</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedReport('department')}>
              <div className="flex items-center justify-between mb-4">
                <Building2 className="text-purple-600" size={24} />
                <button
                  onClick={(e) => { e.stopPropagation(); exportReport('department') }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <Download size={18} className="text-gray-600" />
                </button>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Department Report</h3>
              <p className="text-sm text-gray-600">Department-wise employee breakdown</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedReport('branch')}>
              <div className="flex items-center justify-between mb-4">
                <Building2 className="text-green-600" size={24} />
                <button
                  onClick={(e) => { e.stopPropagation(); exportReport('branch') }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <Download size={18} className="text-gray-600" />
                </button>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Branch Report</h3>
              <p className="text-sm text-gray-600">Branch-wise employee breakdown</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedReport('full')}>
              <div className="flex items-center justify-between mb-4">
                <Users className="text-orange-600" size={24} />
                <button
                  onClick={(e) => { e.stopPropagation(); exportReport('full') }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <Download size={18} className="text-gray-600" />
                </button>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Full Employee Report</h3>
              <p className="text-sm text-gray-600">Complete employee directory export</p>
            </div>
          </section>

          {/* Report Preview */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {selectedReport === 'summary' && 'Summary Report'}
              {selectedReport === 'department' && 'Department Report'}
              {selectedReport === 'branch' && 'Branch Report'}
              {selectedReport === 'full' && 'Full Employee Report'}
            </h3>

            {selectedReport === 'summary' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Total Employees</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{summaryReport.total}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Active Employees</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{summaryReport.active}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Inactive Employees</p>
                  <p className="text-2xl font-bold text-red-600 mt-1">{summaryReport.inactive}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Total Departments</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{summaryReport.departments}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Total Branches</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{summaryReport.branches}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Average Age</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{summaryReport.avgAge} years</p>
                </div>
              </div>
            )}

            {selectedReport === 'department' && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Department</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Total</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Active</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Inactive</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {departmentReport.map(dept => (
                      <tr key={dept.name} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{dept.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{dept.total}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{dept.active}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{dept.total - dept.active}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedReport === 'branch' && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Branch</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Total</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Active</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Inactive</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {branchReport.map(branch => (
                      <tr key={branch.name} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{branch.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{branch.total}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{branch.active}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{branch.total - branch.active}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedReport === 'full' && (
              <div className="text-center py-8">
                <Users className="text-gray-400 mx-auto mb-4" size={48} />
                <p className="text-gray-600 mb-4">Full employee report contains all employee details</p>
                <p className="text-sm text-gray-500">Click the download button above to export the complete report</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default HRReports


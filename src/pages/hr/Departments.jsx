import React, { useEffect, useState, useMemo } from 'react'
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
import { Building2, Users, TrendingUp, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { HrShell, HrToolbar } from '../../components/hr/HrUi.jsx'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

function HRDepartments() {
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

  // Department Headcount
  const departmentHeadcount = useMemo(() => {
    const deptMap = new Map()
    employees.forEach(emp => {
      if (emp.department) {
        if (!deptMap.has(emp.department)) {
          deptMap.set(emp.department, { total: 0, active: 0, inactive: 0, branches: new Set() })
        }
        const dept = deptMap.get(emp.department)
        dept.total++
        if (emp.active === '1' || emp.active === 1) {
          dept.active++
        } else {
          dept.inactive++
        }
        if (emp.region) {
          dept.branches.add(emp.region)
        }
      }
    })
    
    return Array.from(deptMap.entries())
      .map(([name, data]) => ({
        name,
        total: data.total,
        active: data.active,
        inactive: data.inactive,
        branches: data.branches.size
      }))
      .sort((a, b) => b.total - a.total)
  }, [employees])

  // Department vs Branch Matrix
  const departmentBranchMatrix = useMemo(() => {
    const matrix = new Map()
    employees.forEach(emp => {
      if (emp.department && emp.region) {
        const key = `${emp.department}|${emp.region}`
        matrix.set(key, (matrix.get(key) || 0) + 1)
      }
    })
    
    const departments = [...new Set(employees.map(e => e.department).filter(Boolean))]
    const branches = [...new Set(employees.map(e => e.region).filter(Boolean))]
    
    return { departments, branches, matrix }
  }, [employees])

  // Top Departments
  const topDepartments = useMemo(() => {
    return departmentHeadcount.slice(0, 10)
  }, [departmentHeadcount])

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading department data</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <HrShell>
      <HrToolbar page="DEPARTMENTS" />
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Department Analysis</h1>
        <p className="text-gray-600 mt-2">Comprehensive department-level workforce insights</p>
      </header>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading department data...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Department Headcount Chart */}
          <section className="grid grid-cols-1 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 size={20} />
                Department Headcount
              </h3>
              {departmentHeadcount.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={departmentHeadcount}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={120} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="total" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Total Employees" />
                    <Bar dataKey="active" fill="#10b981" radius={[6, 6, 0, 0]} name="Active" />
                    <Bar dataKey="inactive" fill="#ef4444" radius={[6, 6, 0, 0]} name="Inactive" />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Top Departments Pie Chart */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top 10 Departments</h3>
              {topDepartments.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={topDepartments}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="total"
                    >
                      {topDepartments.map((entry, index) => (
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

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Departments by Branch Coverage</h3>
              {departmentHeadcount.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={departmentHeadcount.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="branches" fill="#8b5cf6" radius={[6, 6, 0, 0]} name="Number of Branches" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Department Breakdown Table */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Department Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Department</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Total Employees</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Active</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Inactive</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Active %</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Branches</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {departmentHeadcount.map((dept) => {
                    const activePercent = dept.total > 0 ? ((dept.active / dept.total) * 100).toFixed(1) : '0.0'
                    return (
                      <tr key={dept.name} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{dept.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{dept.total || 0}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{dept.active || 0}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{dept.inactive || 0}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{activePercent}%</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{dept.branches || 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
    </HrShell>
  )
}

export default HRDepartments


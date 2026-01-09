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
import { Building2, Users, MapPin, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

function HRBranches() {
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

  // Branch Headcount
  const branchHeadcount = useMemo(() => {
    const branchMap = new Map()
    employees.forEach(emp => {
      if (emp.region) {
        if (!branchMap.has(emp.region)) {
          branchMap.set(emp.region, { total: 0, active: 0, inactive: 0, departments: new Set() })
        }
        const branch = branchMap.get(emp.region)
        branch.total++
        if (emp.active === '1' || emp.active === 1) {
          branch.active++
        } else {
          branch.inactive++
        }
        if (emp.department) {
          branch.departments.add(emp.department)
        }
      }
    })
    
    return Array.from(branchMap.entries())
      .map(([name, data]) => ({
        name,
        total: data.total,
        active: data.active,
        inactive: data.inactive,
        departments: data.departments.size
      }))
      .sort((a, b) => b.total - a.total)
  }, [employees])

  // Branch vs Department Breakdown
  const branchDepartmentData = useMemo(() => {
    const matrix = new Map()
    employees.forEach(emp => {
      if (emp.region && emp.department) {
        const key = `${emp.region}|${emp.department}`
        matrix.set(key, (matrix.get(key) || 0) + 1)
      }
    })
    
    const branches = [...new Set(employees.map(e => e.region).filter(Boolean))]
    const departments = [...new Set(employees.map(e => e.department).filter(Boolean))]
    
    // Create data for grouped bar chart
    const chartData = branches.map(branch => {
      const data = { branch }
      departments.forEach(dept => {
        const key = `${branch}|${dept}`
        data[dept] = matrix.get(key) || 0
      })
      return data
    })
    
    return { branches, departments, chartData: chartData.slice(0, 10) }
  }, [employees])

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading branch data</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Branch/Region Analysis</h1>
        <p className="text-gray-600 mt-2">Comprehensive branch-level workforce insights</p>
      </header>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading branch data...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Branch Headcount Chart */}
          <section className="grid grid-cols-1 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 size={20} />
                Branch Headcount
              </h3>
              {branchHeadcount.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={branchHeadcount}>
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

          {/* Branch Distribution Pie Chart */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Branch Distribution</h3>
              {branchHeadcount.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={branchHeadcount}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="total"
                    >
                      {branchHeadcount.map((entry, index) => (
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
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Branches by Department Coverage</h3>
              {branchHeadcount.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={branchHeadcount.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="departments" fill="#8b5cf6" radius={[6, 6, 0, 0]} name="Number of Departments" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Branch Breakdown Table */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Branch Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Branch/Region</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Total Employees</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Active</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Inactive</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Active %</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Departments</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {branchHeadcount.map((branch) => {
                    const activePercent = branch.total > 0 ? ((branch.active / branch.total) * 100).toFixed(1) : 0
                    return (
                      <tr key={branch.name} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{branch.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{branch.total}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{branch.active}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{branch.inactive}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{activePercent}%</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{branch.departments}</td>
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
  )
}

export default HRBranches


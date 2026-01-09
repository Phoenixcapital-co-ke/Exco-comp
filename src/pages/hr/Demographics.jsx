import React, { useEffect, useState, useMemo } from 'react'
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts'
import { Users, MapPin, Calendar, Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']

function HRDemographics() {
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

  // Age Distribution (Histogram)
  const ageData = useMemo(() => {
    const ages = employees
      .map(emp => calculateAge(emp.date_of_birth))
      .filter(age => age !== null)
    
    const bins = {}
    ages.forEach(age => {
      const bin = Math.floor(age / 5) * 5
      bins[bin] = (bins[bin] || 0) + 1
    })
    
    return Object.entries(bins)
      .map(([age, count]) => ({ age: `${age}-${parseInt(age) + 4}`, count }))
      .sort((a, b) => parseInt(a.age) - parseInt(b.age))
  }, [employees])

  // Geographic Distribution - City
  const cityData = useMemo(() => {
    const cityMap = new Map()
    employees.forEach(emp => {
      if (emp.city) {
        cityMap.set(emp.city, (cityMap.get(emp.city) || 0) + 1)
      }
    })
    return Array.from(cityMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [employees])

  // Geographic Distribution - State/Province
  const stateData = useMemo(() => {
    const stateMap = new Map()
    employees.forEach(emp => {
      if (emp.state_province_county) {
        stateMap.set(emp.state_province_county, (stateMap.get(emp.state_province_county) || 0) + 1)
      }
    })
    return Array.from(stateMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [employees])

  // Country Distribution
  const countryData = useMemo(() => {
    const countryMap = new Map()
    employees.forEach(emp => {
      const country = emp.country || 'Not Specified'
      countryMap.set(country, (countryMap.get(country) || 0) + 1)
    })
    return Array.from(countryMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [employees])

  // Residential Status
  const residentialStatusData = useMemo(() => {
    const statusMap = new Map()
    employees.forEach(emp => {
      const status = emp.residential_status || 'Not Specified'
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
    })
    return Array.from(statusMap.entries())
      .map(([name, value]) => ({ name, value }))
  }, [employees])

  // Demographics Table Data
  const demographicsTable = useMemo(() => {
    return employees.map(emp => ({
      ...emp,
      age: calculateAge(emp.date_of_birth)
    })).filter(emp => emp.age !== null)
  }, [employees])

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-red-600">
        <div className="text-center">
          <p className="text-lg font-semibold">Error loading demographics</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">HR Demographics</h1>
        <p className="text-gray-600 mt-2">Workforce demographics and geographic distribution</p>
      </header>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32} />
            <p className="text-gray-500 text-sm">Loading demographics...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Distribution Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

            {/* Residential Status */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <MapPin size={20} />
                Residential Status
              </h3>
              {residentialStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={residentialStatusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {residentialStatusData.map((entry, index) => (
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

          {/* Age Distribution */}
          <section className="grid grid-cols-1 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar size={20} />
                Age Distribution
              </h3>
              {ageData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ageData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="age" />
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

          {/* Geographic Distribution */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Cities */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Cities</h3>
              {cityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={cityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>

            {/* Top States/Provinces */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top States/Provinces</h3>
              {stateData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stateData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">No data available</div>
              )}
            </div>
          </section>

          {/* Country Distribution */}
          <section className="grid grid-cols-1 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Country Distribution</h3>
              {countryData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={countryData}>
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

          {/* Demographics Table */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Employee Demographics Details</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Age</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Gender</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">City</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">State/Province</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Country</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Residential Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {demographicsTable.slice(0, 50).map((emp) => {
                    const fullName = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown'
                    return (
                      <tr key={emp.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{fullName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.age}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.gender || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.city || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.state_province_county || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.country || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{emp.residential_status || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {demographicsTable.length > 50 && (
              <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
                Showing 50 of {demographicsTable.length} employees
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default HRDemographics


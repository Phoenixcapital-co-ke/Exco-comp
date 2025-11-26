import React, { useEffect, useMemo, useState } from 'react'
import { Users, UserCheck, UserPlus, MapPin, Building2, TrendingUp, BarChart3, PieChart as PieChartIcon } from 'lucide-react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts'
import { API_URLS } from '../../utils/api.js'

const GENDER_COLORS = {
  Female: '#ec4899',
  Male: '#3b82f6',
  Other: '#6b7280'
}

const AGE_BUCKETS = [
  { label: 'Under 25', min: 0, max: 24 },
  { label: '25 - 34', min: 25, max: 34 },
  { label: '35 - 44', min: 35, max: 44 },
  { label: '45 - 54', min: 45, max: 54 },
  { label: '55+', min: 55, max: Infinity }
]

function normalizeString(value) {
  if (!value) return 'Unknown'
  return String(value).trim().replace(/\s+/g, ' ')
}

function normalizeGender(value) {
  const v = normalizeString(value).toLowerCase()
  if (!v || v === 'unknown') return 'Other'
  if (v.includes('female') || v === 'f') return 'Female'
  if (v.includes('male') || v === 'm') return 'Male'
  return 'Other'
}

function calculateAgeFromDob(dobStr) {
  if (!dobStr) return null
  const value = String(dobStr).trim()
  let dob = null
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split('/').map((part) => Number(part))
    dob = new Date(year, month - 1, day)
  } else {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      dob = parsed
    }
  }
  if (!dob) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }
  if (age < 0 || age > 120) return null
  return age
}

function extractCityFromAddress(address) {
  const normalized = normalizeString(address)
  if (!normalized || normalized === 'Unknown') return 'Unknown'
  const parts = normalized.split(/[,|-]/).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return normalized
  return parts[parts.length - 1]
}

function normalizeBranchCode(value) {
  if (value === undefined || value === null) return 'Unknown'
  const code = String(value).trim()
  return code || 'Unknown'
}

export default function LogbookDemographics() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedBranch, setSelectedBranch] = useState('All')
  const [branchNames, setBranchNames] = useState({})

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const [borrowerRes, branchRes] = await Promise.all([
          fetch(API_URLS.logbook.borrowers, { credentials: 'include' }),
          fetch(API_URLS.branches.list, { credentials: 'include' }).catch(() => null)
        ])
        if (!borrowerRes.ok) throw new Error(`Failed to load data (${borrowerRes.status})`)
        const borrowerData = await borrowerRes.json()
        const all = Array.isArray(borrowerData) ? borrowerData : []
        setRows(all)
        if (branchRes && branchRes.ok) {
          const branchJson = await branchRes.json()
          const map = {}
          for (const branch of Array.isArray(branchJson) ? branchJson : []) {
            const code = normalizeBranchCode(branch.code)
            map[code] = normalizeString(branch.name || code)
          }
          setBranchNames(map)
        }
        setLoading(false)
      } catch (e) {
        setError(e.message)
        setLoading(false)
      }
    }
    load()
  }, [])

  const branches = useMemo(() => {
    const codes = new Set()
    for (const row of rows) {
      const branchCode = normalizeBranchCode(row.branch)
      if (branchCode && branchCode !== 'Unknown') {
        codes.add(branchCode)
      }
    }
    return ['All', ...Array.from(codes).sort()]
  }, [rows])

  const filteredRows = useMemo(() => {
    if (selectedBranch === 'All') return rows
    return rows.filter((row) => normalizeBranchCode(row.branch) === selectedBranch)
  }, [rows, selectedBranch])

  const uniqueClients = useMemo(() => {
    const idSet = new Set()
    for (const row of filteredRows) {
      const preferredId = row.borrower_id ?? row.national_id
      if (preferredId && String(preferredId).trim()) {
        idSet.add(String(preferredId).trim())
      }
    }
    return idSet.size
  }, [filteredRows])

  const enriched = useMemo(() => {
    return filteredRows.map((row) => {
      const genderRaw = row.borrower_gender || row.gender
      const cityRaw = row.borrower_address || row.borrower_city || row.city

      return {
        age: calculateAgeFromDob(row.borrower_dob || row.dob),
        gender: normalizeGender(genderRaw),
        genderRaw: normalizeString(genderRaw),
        city: extractCityFromAddress(cityRaw)
      }
    })
  }, [filteredRows])

  const ageValues = useMemo(
    () => enriched.map((c) => c.age).filter((age) => age !== null),
    [enriched]
  )

  const genderCounts = useMemo(() => {
    const base = { Male: 0, Female: 0, Other: 0 }
    for (const c of enriched) {
      base[c.gender] = (base[c.gender] || 0) + 1
    }
    return base
  }, [enriched])

  const cityCounts = useMemo(() => {
    const map = new Map()
    for (const c of enriched) {
      const city = c.city || 'Unknown'
      map.set(city, (map.get(city) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [enriched])

  const ageBucketsData = useMemo(() => {
    return AGE_BUCKETS.map((bucket) => {
      const male = enriched.filter(
        (c) => c.age !== null && c.age >= bucket.min && c.age <= bucket.max && c.gender === 'Male'
      ).length
      const female = enriched.filter(
        (c) => c.age !== null && c.age >= bucket.min && c.age <= bucket.max && c.gender === 'Female'
      ).length
      const other = enriched.filter(
        (c) => c.age !== null && c.age >= bucket.min && c.age <= bucket.max && c.gender === 'Other'
      ).length
      return {
        bucket: bucket.label,
        male,
        female,
        other,
        total: male + female + other
      }
    })
  }, [enriched])

  const totalClients = uniqueClients
  const avgAge =
    ageValues.length > 0 ? (ageValues.reduce((sum, age) => sum + age, 0) / ageValues.length).toFixed(1) : 'N/A'
  const sortedAges = [...ageValues].sort((a, b) => a - b)
  let medianAge = 'N/A'
  if (sortedAges.length > 0) {
    const mid = Math.floor(sortedAges.length / 2)
    medianAge =
      sortedAges.length % 2 !== 0
        ? sortedAges[mid].toString()
        : ((sortedAges[mid - 1] + sortedAges[mid]) / 2).toFixed(1)
  }
  const femaleShare =
    totalClients > 0 ? `${((genderCounts.Female / totalClients) * 100).toFixed(1)}%` : 'N/A'
  const topCity = cityCounts[0]?.name || 'N/A'
  const uniqueCityCount = cityCounts.length

  const femaleBorrowers = genderCounts.Female || 0
  const maleBorrowers = genderCounts.Male || 0
  const femalePercentValue = totalClients > 0 ? (femaleBorrowers / totalClients) * 100 : 0
  const malePercentValue = totalClients > 0 ? (maleBorrowers / totalClients) * 100 : 0
  const femalePercentLabel = `${femalePercentValue.toFixed(1)}%`
  const malePercentLabel = `${malePercentValue.toFixed(1)}%`

  const genderChartData = useMemo(() => {
    return Object.entries(genderCounts)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => ({
        name,
        value: count
      }))
  }, [genderCounts])

  const topCityChart = cityCounts.slice(0, 10)

  const ageCountSeries = useMemo(() => {
    const map = new Map()
    for (const c of enriched) {
      if (c.age === null) continue
      map.set(c.age, (map.get(c.age) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([age, count]) => ({ age, count }))
      .sort((a, b) => a.age - b.age)
  }, [enriched])

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-gray-600">Loading demographics...</div>
  }

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  if (!enriched.length) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 rounded-xl shadow-lg border border-gray-200 p-6">
          <h1 className="text-3xl font-bold text-gray-900">Logbook Demographics</h1>
          <p className="text-gray-600 mt-2">Logbook demographic insights.</p>
        </div>
        <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Users size={40} className="text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-2">No client data available</p>
            <p className="text-sm text-gray-500">Please ensure data has been ingested for the selected branch.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 rounded-xl shadow-lg border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between md:space-x-6 space-y-4 md:space-y-0">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Logbook Demographics</h1>
            <p className="text-gray-600 mt-2">
              Understand the people behind Logbook loans — age, gender, and city insights.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Building2 size={20} className="text-indigo-600" />
            <span className="text-sm font-medium text-gray-700">Branch</span>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="text-sm border-2 border-indigo-200 rounded-lg px-4 py-2 bg-white font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition-all"
            >
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch === 'All'
                    ? 'All'
                    : branchNames[branch]
                      ? `${branchNames[branch]} (${branch})`
                      : branch}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-lg border-2 border-blue-200 p-6 hover:shadow-xl transition-all duration-300 hover:border-blue-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Total Clients</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{totalClients.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Unique clients by national ID</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl shadow-md">
              <Users size={28} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-lg border-2 border-purple-200 p-6 hover:shadow-xl transition-all duration-300 hover:border-purple-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Median Age</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{medianAge}</p>
              <p className="text-xs text-gray-500 mt-1">
                Average: <span className="font-semibold text-gray-700">{avgAge}</span>
              </p>
            </div>
            <div className="p-4 bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl shadow-md">
              <UserCheck size={28} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-lg border-2 border-rose-200 p-6 hover:shadow-xl transition-all duration-300 hover:border-rose-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Female Borrowers</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{femaleBorrowers.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">{femalePercentLabel} of total clients</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-rose-500 to-pink-600 text-white rounded-xl shadow-md">
              <UserPlus size={28} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-lg border-2 border-emerald-200 p-6 hover:shadow-xl transition-all duration-300 hover:border-emerald-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Male Borrowers</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{maleBorrowers.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">{malePercentLabel} of total clients</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-xl shadow-md">
              <TrendingUp size={28} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Gender distribution */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-indigo-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b-2 border-indigo-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <PieChartIcon size={20} className="text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Gender Distribution</h3>
            </div>
          </div>
          <div className="p-6">
            {genderChartData.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={genderChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={130}
                    dataKey="value"
                    paddingAngle={4}
                  >
                    {genderChartData.map((entry) => (
                      <Cell key={entry.name} fill={GENDER_COLORS[entry.name] || '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value.toLocaleString()}`, 'Borrowers']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-80 flex items-center justify-center">
                <div className="text-center">
                  <PieChartIcon size={48} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No gender information available.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Age distribution */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-blue-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-cyan-50 border-b-2 border-blue-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <BarChart3 size={20} className="text-blue-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Age Distribution by Gender</h3>
            </div>
          </div>
          <div className="p-6">
            {ageBucketsData.some((item) => item.total > 0) ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={ageBucketsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="bucket" stroke="#6b7280" />
                  <YAxis allowDecimals={false} stroke="#6b7280" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white', 
                      border: '2px solid #e5e7eb', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }} 
                  />
                  <Legend />
                  <Bar dataKey="female" stackId="a" fill={GENDER_COLORS.Female} name="Female" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="male" stackId="a" fill={GENDER_COLORS.Male} name="Male" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="other" stackId="a" fill={GENDER_COLORS.Other} name="Other / Unspecified" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-80 flex items-center justify-center">
                <div className="text-center">
                  <BarChart3 size={48} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No age information available.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top cities */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-emerald-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b-2 border-emerald-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <MapPin size={20} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Top Cities by Borrower Count</h3>
            </div>
          </div>
          <div className="p-6">
            {topCityChart.length ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={topCityChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={90} stroke="#6b7280" />
                  <YAxis allowDecimals={false} stroke="#6b7280" />
                  <Tooltip 
                    formatter={(value) => [`${value.toLocaleString()}`, 'Borrowers']}
                    contentStyle={{ 
                      backgroundColor: 'white', 
                      border: '2px solid #e5e7eb', 
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Bar dataKey="count" fill="#10b981" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[360px] flex items-center justify-center">
                <div className="text-center">
                  <MapPin size={48} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No city information available.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* City list */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-amber-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b-2 border-amber-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Building2 size={20} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">City Distribution</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
              {cityCounts.slice(0, 15).map((item, index) => {
                const share = totalClients > 0 ? ((item.count / totalClients) * 100).toFixed(1) : '0.0'
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-amber-50 hover:border-amber-200 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {item.name}
                        </p>
                        <p className="text-xs text-gray-500">Borrowers: {item.count.toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-amber-100 rounded-full">
                      <span className="text-sm font-bold text-amber-700">{share}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

        {/* Age vs Borrower Count area chart */}
      <div className="bg-white rounded-xl shadow-lg border-2 border-indigo-200 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-b-2 border-indigo-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <TrendingUp size={20} className="text-indigo-600" />
              </div>
                <h3 className="text-lg font-bold text-gray-900">Borrower Count by Age</h3>
            </div>
            <div className="px-4 py-2 bg-white rounded-lg border-2 border-indigo-200">
                <span className="text-sm font-semibold text-indigo-700">
                  {selectedBranch === 'All'
                    ? 'All branches'
                    : branchNames[selectedBranch]
                      ? `${branchNames[selectedBranch]} (${selectedBranch})`
                      : selectedBranch}
                </span>
            </div>
          </div>
        </div>
        <div className="p-6">
            {ageCountSeries.length ? (
            <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={ageCountSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="age" stroke="#6b7280" />
                  <YAxis allowDecimals={false} stroke="#6b7280" />
                  <Tooltip
                    formatter={(value) => [`${value.toLocaleString()}`, 'Borrowers']}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Borrowers"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                    strokeWidth={2}
                  />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-80 flex items-center justify-center">
              <div className="text-center">
                  <TrendingUp size={48} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No borrower data by age available.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useMemo, useState } from 'react'
import { Users, UserCheck, UserPlus, Briefcase, Building2, TrendingUp, BarChart3, PieChart as PieChartIcon } from 'lucide-react'
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
import { formatKES } from '../../utils/format.js'
import { fetchAllZidishaRows } from '../../utils/zidishaClient.js'

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

function calculateAge(dobStr) {
  if (!dobStr) return null
  const dob = new Date(dobStr)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age -= 1
  }
  if (age < 0 || age > 120) return null
  return age
}

export default function ZidishaDemographics() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedBranch, setSelectedBranch] = useState('All')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const all = await fetchAllZidishaRows({ signal: controller.signal })
        const filtered = all.filter(
          (row) => (row['Branch Name'] || row.branch_name || '').trim().toLowerCase() !== 'advans branch'
        )
        setRows(filtered)
        setLoading(false)
      } catch (e) {
        if (e.name === 'AbortError') return
        setError(e.message)
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  const branches = useMemo(() => {
    const set = new Set()
    for (const row of rows) {
      const b = normalizeString(row['Branch Name'] || row.branch_name)
      if (b && b !== 'Unknown') set.add(b)
    }
    return ['All', ...Array.from(set).sort()]
  }, [rows])

  const filteredRows = useMemo(() => {
    if (selectedBranch === 'All') return rows
    return rows.filter((row) => normalizeString(row['Branch Name'] || row.branch_name) === selectedBranch)
  }, [rows, selectedBranch])

  const clients = useMemo(() => {
    const unique = new Map()
    for (const row of filteredRows) {
      const id = row['Client Id'] || row.client_id || row.id
      if (!id) continue
      if (!unique.has(id)) unique.set(id, row)
    }
    return Array.from(unique.values())
  }, [filteredRows])

  const enriched = useMemo(() => {
    return clients.map((row) => {
      const dob = row['Date Of Birth'] || row.date_of_birth || null
      const genderRaw = row['Gender'] || row.gender
      const businessRaw =
        row['Business Profile - Business'] ??
        row['Business Profile - Business Name'] ??
        row['Business Profile - Business Type'] ??
        row['Business Profile - Business Category']

      return {
        clientId: row['Client Id'] || row.client_id || 'Unknown',
        name: normalizeString(row['Client Name'] || row.client_name),
        gender: normalizeGender(genderRaw),
        genderRaw: normalizeString(genderRaw),
        age: calculateAge(dob),
        dob: dob,
        business: normalizeString(businessRaw)
      }
    })
  }, [clients])

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

  const businessCounts = useMemo(() => {
    const map = new Map()
    for (const c of enriched) {
      const business = c.business || 'Unknown'
      map.set(business, (map.get(business) || 0) + 1)
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

  const totalClients = clients.length
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
  const { maleAvgPrincipal, femaleAvgPrincipal } = useMemo(() => {
    let maleSum = 0
    let maleCount = 0
    let femaleSum = 0
    let femaleCount = 0
    for (const row of filteredRows) {
      const gender = normalizeGender(row['Gender'] || row.gender)
      const amt = Number(row['Principal Amount'] ?? row.principal_amount ?? row.Principal ?? 0) || 0
      if (gender === 'Male') {
        maleSum += amt
        maleCount += 1
      } else if (gender === 'Female') {
        femaleSum += amt
        femaleCount += 1
      }
    }
    return {
      maleAvgPrincipal: maleCount > 0 ? maleSum / maleCount : 0,
      femaleAvgPrincipal: femaleCount > 0 ? femaleSum / femaleCount : 0
    }
  }, [filteredRows])

  const genderChartData = useMemo(() => {
    return Object.entries(genderCounts)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => ({
        name,
        value: count
      }))
  }, [genderCounts])

  const topBusinessChart = businessCounts.slice(0, 8)

  const ageRepaymentSeries = useMemo(() => {
    const map = new Map()
    for (const row of filteredRows) {
      const dob = row['Date Of Birth'] || row.date_of_birth || null
      const age = calculateAge(dob)
      if (age === null) continue
      const repay = Number(row['Total Repayment Derived']) || 0
      const expected = Number(row['Total Expected Repayment Derived']) || 0
      if (!map.has(age)) {
        map.set(age, { age, repayment: 0, expected: 0 })
      }
      const entry = map.get(age)
      entry.repayment += repay
      entry.expected += expected
    }
    return Array.from(map.values())
      .sort((a, b) => a.age - b.age)
      .slice(0, 120)
  }, [filteredRows])

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-gray-600">Loading demographics...</div>
  }

  if (error) {
    return <div className="h-64 flex items-center justify-center text-red-600">{error}</div>
  }

  if (!clients.length) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 rounded-xl shadow-lg border border-gray-200 p-6">
          <h1 className="text-3xl font-bold text-gray-900">Zidisha Demographics</h1>
          <p className="text-gray-600 mt-2">Zidisha demographic insights.</p>
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
            <h1 className="text-3xl font-bold text-gray-900">Zidisha Demographics</h1>
            <p className="text-gray-600 mt-2">
              Understand the people behind Zidisha loans — age, gender, and business profile insights.
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
                  {branch}
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
              <p className="text-xs text-gray-500 mt-1">Unique borrower profiles</p>
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
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Avg Loan (Female)</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{formatKES(femaleAvgPrincipal)}</p>
              <p className="text-xs text-gray-500 mt-1">Average loan to females</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-rose-500 to-pink-600 text-white rounded-xl shadow-md">
              <UserPlus size={28} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-lg border-2 border-emerald-200 p-6 hover:shadow-xl transition-all duration-300 hover:border-emerald-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Avg Loan (Male)</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{formatKES(maleAvgPrincipal)}</p>
              <p className="text-xs text-gray-500 mt-1">Average principal amount for male borrowers</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-xl shadow-md">
              <Briefcase size={28} />
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
                  <Tooltip formatter={(value) => [`${value.toLocaleString()}`, 'Clients']} />
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
        {/* Business segments */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-emerald-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b-2 border-emerald-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Briefcase size={20} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Top Business Segments</h3>
            </div>
          </div>
          <div className="p-6">
            {topBusinessChart.length ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={topBusinessChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={90} stroke="#6b7280" />
                  <YAxis allowDecimals={false} stroke="#6b7280" />
                  <Tooltip 
                    formatter={(value) => [`${value.toLocaleString()}`, 'Clients']}
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
                  <Briefcase size={48} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No business information available.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Business list */}
        <div className="bg-white rounded-xl shadow-lg border-2 border-amber-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b-2 border-amber-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Building2 size={20} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Business Profile Spotlight</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
              {businessCounts.slice(0, 12).map((item, index) => {
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
                        <p className="text-xs text-gray-500">Clients: {item.count.toLocaleString()}</p>
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

      {/* Age vs repayment area chart */}
      <div className="bg-white rounded-xl shadow-lg border-2 border-indigo-200 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-b-2 border-indigo-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <TrendingUp size={20} className="text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Repayment vs Expected by Age</h3>
            </div>
            <div className="px-4 py-2 bg-white rounded-lg border-2 border-indigo-200">
              <span className="text-sm font-semibold text-indigo-700">
                {selectedBranch === 'All' ? 'All branches' : selectedBranch}
              </span>
            </div>
          </div>
        </div>
        <div className="p-6">
          {ageRepaymentSeries.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={ageRepaymentSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="age" stroke="#6b7280" />
                <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} stroke="#6b7280" />
                <Tooltip 
                  formatter={(value, name) => [formatKES(value), name === 'repayment' ? 'Total Repayment' : 'Total Expected']}
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '2px solid #e5e7eb', 
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="repayment" name="Total Repayment" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} strokeWidth={2} />
                <Area type="monotone" dataKey="expected" name="Total Expected" stroke="#f97316" fill="#f97316" fillOpacity={0.25} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-80 flex items-center justify-center">
              <div className="text-center">
                <TrendingUp size={48} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No repayment information available.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

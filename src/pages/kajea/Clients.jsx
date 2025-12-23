import React, { useState, useEffect, useMemo } from 'react'
import { Users, TrendingUp, UserPlus, Activity, Car, Search } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { API_URLS } from '../../utils/api.js'

function KajeaClients() {
  const [stats, setStats] = useState({ clients: 0, devices: 0, vehicleTypes: [], clientGrowth: [] })
  const [clients, setClients] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [clientsLoading, setClientsLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filter clients based on search query
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) {
      return clients
    }
    const query = searchQuery.toLowerCase().trim()
    return clients.filter(client => 
      client.name?.toLowerCase().includes(query) ||
      client.source?.toLowerCase().includes(query) ||
      client.reseller?.toLowerCase().includes(query)
    )
  }, [clients, searchQuery])

  // Get available years from clientGrowth data
  const availableYears = useMemo(() => {
    if (!stats.clientGrowth || stats.clientGrowth.length === 0) {
      return [new Date().getFullYear()]
    }
    const years = new Set()
    stats.clientGrowth.forEach(item => {
      if (item.key) {
        const year = parseInt(item.key.split('-')[0])
        if (!isNaN(year)) {
          years.add(year)
        }
      }
    })
    return Array.from(years).sort((a, b) => b - a) // Sort descending (newest first)
  }, [stats.clientGrowth])

  // Filter clientGrowth data by selected year
  const filteredClientGrowth = useMemo(() => {
    if (!stats.clientGrowth || stats.clientGrowth.length === 0) {
      return []
    }
    return stats.clientGrowth.filter(item => {
      if (!item.key) return false
      const year = parseInt(item.key.split('-')[0])
      return !isNaN(year) && year === selectedYear
    })
  }, [stats.clientGrowth, selectedYear])

  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(API_URLS.kajea.stats, { credentials: 'include' })
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.error || `Failed to load stats (${res.status})`)
        }
        const data = await res.json()
        setStats(data)
      } catch (e) {
        console.error('[Kajea Clients] Error loading stats:', e)
        setError(e.message)
        // Set defaults on error so we show 0 instead of "—"
        setStats({ clients: 0, devices: 0, vehicleTypes: [], clientGrowth: [] })
      } finally {
        setLoading(false)
      }
    }
    loadStats()
    // Refresh every 30 seconds
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [])

  // Update selected year when available years change (if current year is not available, select first available)
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYears])

  useEffect(() => {
    const loadClients = async () => {
      try {
        setClientsLoading(true)
        setError(null)
        const res = await fetch(API_URLS.kajea.clients, { credentials: 'include' })
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.error || `Failed to load clients (${res.status})`)
        }
        const data = await res.json()
        setClients(Array.isArray(data) ? data : [])
      } catch (e) {
        console.error('[Kajea Clients] Error loading clients list:', e)
        setError(e.message)
        setClients([])
      } finally {
        setClientsLoading(false)
      }
    }
    loadClients()
    // Refresh every 30 seconds
    const interval = setInterval(loadClients, 30000)
    return () => clearInterval(interval)
  }, [])

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active':
        return 'bg-green-100 text-green-800'
      case 'Inactive':
        return 'bg-gray-100 text-gray-800'
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Kajea - Tech Clients</h1>
        <p className="text-gray-600 mt-2">Manage and track technology client portfolio</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Number of Clients</p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? '...' : error ? '—' : stats.clients.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Users size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Number of Devices</p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? '...' : error ? '—' : stats.devices.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <Activity size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Vehicle Types</p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? '...' : error ? '—' : stats.vehicleTypes.length}
              </p>
              {!loading && !error && stats.vehicleTypes.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {stats.vehicleTypes.slice(0, 3).join(', ')}
                  {stats.vehicleTypes.length > 3 && ` +${stats.vehicleTypes.length - 3} more`}
                </p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <Car size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Client Growth */}
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Client Growth</h3>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="flex flex-col items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
                <p className="text-sm text-gray-500">Loading client growth...</p>
              </div>
            </div>
          ) : !stats.clientGrowth || stats.clientGrowth.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <p className="text-sm text-gray-500">No client growth data available.</p>
            </div>
          ) : filteredClientGrowth.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <p className="text-sm text-gray-500">No client growth data available for {selectedYear}.</p>
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredClientGrowth} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'cumulative') {
                        return [value, 'Cumulative Clients']
                      }
                      if (name === 'count') {
                        return [value, 'New Clients']
                      }
                      return [value, name]
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.25}
                    name="Cumulative Clients"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.15}
                    name="New Clients"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Client Portfolio</h3>
          <div className="relative w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clients..."
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
        {searchQuery && (
          <div className="px-6 py-2 bg-gray-50 border-b border-gray-200">
            <p className="text-sm text-gray-600">
              Showing {filteredClients.length} of {clients.length} clients
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reseller</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Devices</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vehicle Types</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Activation</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {clientsLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
                      <p className="text-sm text-gray-500">Loading clients...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredClients.length > 0 ? (
                filteredClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{client.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          client.source === 'GPSIoT' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {client.source}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{client.reseller || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {client.devices != null ? client.devices.toLocaleString() : '0'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {client.vehicleTypes != null ? client.vehicleTypes.toLocaleString() : '0'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {client.lastActivate
                        ? new Date(client.lastActivate).toLocaleDateString('en-KE', {
                            year: '2-digit',
                            month: 'short',
                            day: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))
              ) : searchQuery ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Search size={48} className="text-gray-300 mb-3" />
                      <p className="text-sm font-medium text-gray-500">No clients found</p>
                      <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Users size={48} className="text-gray-300 mb-3" />
                      <p className="text-sm font-medium text-gray-500">No clients available</p>
                      <p className="text-xs text-gray-400 mt-1">Run the fetch scripts to populate client data</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default KajeaClients

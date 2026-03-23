import React, { useEffect, useMemo, useState } from 'react'
import { Car, Search, Clock } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

function toDateTimeLocalValue(d) {
  const date = d instanceof Date ? d : new Date(d)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toApiDateTime(localValue) {
  if (!localValue) return ''
  const [datePart, timePart] = String(localValue).split('T')
  if (!datePart || !timePart) return ''
  return `${datePart} ${timePart}:00`
}

export default function OSParkingReport() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0)

  const [vehicles, setVehicles] = useState([])
  const [vehiclesLoading, setVehiclesLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState(null)

  const [startTime, setStartTime] = useState(toDateTimeLocalValue(startOfMonth))
  const [endTime, setEndTime] = useState(toDateTimeLocalValue(endOfToday))
  const [conditionType, setConditionType] = useState('1')
  const [minDuration, setMinDuration] = useState('0')

  const [reportRows, setReportRows] = useState([])
  const [reportRaw, setReportRaw] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadVehicles = async () => {
    try {
      setVehiclesLoading(true)
      setError(null)
      const res = await fetch(API_URLS.kajea.osVehicles, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load vehicles (${res.status})`)
      }
      const data = await res.json()
      const list = Array.isArray(data?.vehicles) ? data.vehicles : []
      setVehicles(list)
      if (list.length && !selectedVehicle) setSelectedVehicle(list[0])
    } catch (e) {
      setError(e.message)
      setVehicles([])
    } finally {
      setVehiclesLoading(false)
    }
  }

  useEffect(() => {
    loadVehicles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) =>
      String(v.name || '').toLowerCase().includes(q) ||
      String(v.productId || '').toLowerCase().includes(q) ||
      String(v.dbId || '').toLowerCase().includes(q),
    )
  }, [vehicles, search])

  const runReport = async () => {
    if (!selectedVehicle) return
    try {
      setReportLoading(true)
      setError(null)
      const params = new URLSearchParams({
        productId: String(selectedVehicle.productId || ''),
        dbId: String(selectedVehicle.dbId || ''),
        startTime: toApiDateTime(startTime),
        endTime: toApiDateTime(endTime),
        conditionType: String(conditionType || '1'),
        minDuration: String(minDuration || '0'),
      })
      const res = await fetch(`${API_URLS.kajea.osParkingReport}?${params.toString()}`, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load parking report (${res.status})`)
      }
      const data = await res.json()
      setReportRows(Array.isArray(data?.records) ? data.records : [])
      setReportRaw(data?.raw || null)
    } catch (e) {
      setError(e.message)
      setReportRows([])
      setReportRaw(null)
    } finally {
      setReportLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">OS-Parking report</h1>
        <p className="text-gray-600 mt-2">
          Select a vehicle and fetch its parking report from Oversea Tracking.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Vehicles</h3>
            <button
              type="button"
              onClick={loadVehicles}
              className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vehicle..."
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <div className="max-h-[500px] overflow-auto border border-gray-100 rounded">
            {vehiclesLoading ? (
              <div className="p-4 text-sm text-gray-500">Loading vehicles...</div>
            ) : filteredVehicles.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No vehicles found.</div>
            ) : (
              filteredVehicles.map((v) => {
                const isSelected = selectedVehicle && String(selectedVehicle.productId) === String(v.productId)
                return (
                  <button
                    key={`${v.productId}-${v.dbId}`}
                    type="button"
                    onClick={() => setSelectedVehicle(v)}
                    className={`w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-50 ${
                      isSelected ? 'bg-blue-50' : 'bg-white'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">{v.name || `Vehicle ${v.productId}`}</div>
                    <div className="text-xs text-gray-500">ProductID: {v.productId} | DbID: {v.dbId}</div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="xl:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Parking Query</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Condition Type</label>
              <select
                value={conditionType}
                onChange={(e) => setConditionType(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="1">1 - Ignition Off as parking</option>
                <option value="2">2 - No speed as parking</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Min Duration</label>
              <input
                value={minDuration}
                onChange={(e) => setMinDuration(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-600">
              Selected: <span className="font-medium text-gray-900">{selectedVehicle?.name || 'None'}</span>
            </div>
            <button
              type="button"
              disabled={!selectedVehicle || reportLoading}
              onClick={runReport}
              className="inline-flex items-center rounded bg-indigo-600 text-white px-4 py-2 text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {reportLoading ? 'Loading...' : 'Run Parking Report'}
            </button>
          </div>

          <div className="overflow-x-auto border border-gray-100 rounded">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">ProductID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">PlateNO</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Day</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">StartTime</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">EndTime</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">ParkCoordinates</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">IsTotalCount</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">DayResultRowCount</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">TotalResultRowCount</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">ParkAddress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reportRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                      {reportLoading ? 'Fetching report...' : 'No parking rows yet. Run a query.'}
                    </td>
                  </tr>
                ) : (
                  reportRows.map((r, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-gray-900">{r.productId || r.raw?.ProductID || selectedVehicle?.productId || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.plateNo || r.raw?.PlateNO || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.day || r.raw?.Day || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.startTime || r.raw?.StartTime || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.endTime || r.raw?.EndTime || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{r.duration || r.raw?.Duration || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.parkCoordinates || r.raw?.ParkCoordinates || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.isTotalCount || r.raw?.IsTotalCount || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{r.dayResultRowCount || r.raw?.DayResultRowCount || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{r.totalResultRowCount || r.raw?.TotalResultRowCount || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.parkAddress || r.raw?.ParkAddress || r.address || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500 flex items-center gap-2">
            <Clock size={14} />
            Raw rows: {Array.isArray(reportRows) ? reportRows.length : 0}
            {reportRaw ? ' (normalized from Oversea response)' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}


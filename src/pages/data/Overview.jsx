import React, { useEffect, useRef, useState } from 'react'
import { API_URLS } from '../../utils/api.js'
import { useLastRefresh } from '../../hooks/useLastRefresh.js'
import { useAuth } from '../../context/AuthContext.jsx'

function DataOverview() {
  const [logs, setLogs] = useState([
    'Ready for ingestion...'
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [maintenanceError, setMaintenanceError] = useState(null)
  const esRef = useRef()
  const {
    formattedLastRefresh,
    error: lastRefreshError,
    refresh: reloadLastRefresh
  } = useLastRefresh()
  const { user } = useAuth()

  const handleRefresh = () => {
    setLogs(['Ready for ingestion...', 'Starting data refresh...'])
    setLoading(true)
    setError(null)
    setShowSuccess(false)
    // Close previous EventSource if any
    if (esRef.current) esRef.current.close()
    // NOTE: Using GET /api/ingest
    const es = new EventSource(API_URLS.ingest, { withCredentials: true })
    esRef.current = es
    es.onmessage = (e) => {
      if (!e.data) return
      setLogs(l => [...l, ...e.data.split('\n').filter(Boolean)])
      if (e.data.startsWith('<completed')) {
        setLoading(false)
        setShowSuccess(true)
        reloadLastRefresh()
        es.close()
      }
    }
    es.onerror = (err) => {
      setLoading(false)
      setError('Connection lost.')
      es.close()
    }
  }

  const fetchMaintenance = async () => {
    try {
      const res = await fetch(API_URLS.system.status, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch status')
      const data = await res.json()
      setMaintenance(Boolean(data.maintenance))
    } catch (e) {
      setMaintenanceError('Unable to load maintenance status')
    }
  }

  useEffect(() => {
    fetchMaintenance()
  }, [])

  const handleMaintenanceToggle = async (enabled) => {
    setMaintenanceLoading(true)
    setMaintenanceError(null)
    try {
      const res = await fetch(API_URLS.system.maintenance, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to update maintenance mode')
      }
      const data = await res.json()
      setMaintenance(Boolean(data.maintenance))
    } catch (e) {
      setMaintenanceError(e.message)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4 w-80 text-center">
            <div className="w-14 h-14 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            <div>
              <p className="text-lg font-semibold text-gray-900">Refreshing data…</p>
              <p className="text-sm text-gray-500 mt-1">
                Please wait while we pull the latest disbursements, collections, and borrowers.
              </p>
            </div>
          </div>
        </div>
      )}

      {showSuccess && !loading && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-2xl">
              ✓
            </div>
            <p className="text-lg font-semibold text-gray-900">Refresh complete</p>
            <p className="text-sm text-gray-600">
              All datasets were refreshed successfully. You can review the logs below.
            </p>
            <button
              onClick={() => setShowSuccess(false)}
              className="w-full px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto mt-12 p-8 bg-white shadow-lg rounded-lg border border-gray-200 relative">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <h1 className="text-2xl font-semibold">Data Management</h1>
          {user?.role?.toLowerCase() === 'superuser' && (
            <div className="flex items-center gap-3">
              <div className="text-sm">
                <div className="font-semibold text-gray-800">Maintenance mode</div>
                <div className="text-gray-600">{maintenance ? 'On' : 'Off'}</div>
              </div>
              <button
                onClick={() => handleMaintenanceToggle(!maintenance)}
                disabled={maintenanceLoading}
                className={`px-3 py-2 rounded font-semibold text-sm border ${
                  maintenance
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200'
                } disabled:opacity-60`}
              >
                {maintenanceLoading ? 'Updating...' : maintenance ? 'Disable' : 'Enable'}
              </button>
            </div>
          )}
        </div>
        {maintenanceError && (
          <div className="mb-4 text-sm text-red-600">{maintenanceError}</div>
        )}
        <button onClick={handleRefresh} disabled={loading} className="bg-primary-600 text-white font-semibold px-6 py-2 rounded shadow hover:bg-primary-700 disabled:opacity-70">
          {loading ? 'Refreshing...' : 'Refresh All Data'}
        </button>
        <div className="mt-3 text-sm text-gray-600">
          Last refresh:{' '}
          {formattedLastRefresh || 'Not recorded yet'}
        </div>
        {lastRefreshError && (
          <div className="mt-1 text-xs text-red-500">{lastRefreshError}</div>
        )}
        <div className="mt-8 mb-2 font-semibold">Logs:</div>
        <div className="h-52 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-3 text-sm font-mono">
          {logs.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
        {error && <div className="text-red-600 mt-3">{error}</div>}
      </div>
    </>
  )
}

export default DataOverview

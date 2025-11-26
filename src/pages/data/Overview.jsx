import React, { useState, useRef } from 'react'
import { API_URLS } from '../../utils/api.js'

function DataOverview() {
  const [logs, setLogs] = useState([
    'Ready for ingestion...'
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const esRef = useRef()

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
        es.close()
      }
    }
    es.onerror = (err) => {
      setLoading(false)
      setError('Connection lost.')
      es.close()
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
        <h1 className="text-2xl font-semibold mb-6">Data Management</h1>
        <button onClick={handleRefresh} disabled={loading} className="bg-primary-600 text-white font-semibold px-6 py-2 rounded shadow hover:bg-primary-700 disabled:opacity-70">
          {loading ? 'Refreshing...' : 'Refresh All Data'}
        </button>
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

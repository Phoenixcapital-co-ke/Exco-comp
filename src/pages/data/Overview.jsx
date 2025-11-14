import React, { useState, useRef } from 'react'
import { API_URLS } from '../../utils/api.js'

function DataOverview() {
  const [logs, setLogs] = useState([
    'Ready for ingestion...'
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const esRef = useRef()

  const handleRefresh = () => {
    setLogs(['Ready for ingestion...', 'Starting data refresh...'])
    setLoading(true)
    setError(null)
    // Close previous EventSource if any
    if (esRef.current) esRef.current.close()
    // NOTE: Using GET /api/ingest
    const es = new EventSource(API_URLS.ingest)
    esRef.current = es
    es.onmessage = (e) => {
      if (!e.data) return
      setLogs(l => [...l, ...e.data.split('\n').filter(Boolean)])
      if (e.data.startsWith('<completed')) {
        setLoading(false)
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
    <div className="max-w-2xl mx-auto mt-12 p-8 bg-white shadow-lg rounded-lg border border-gray-200">
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
  )
}

export default DataOverview

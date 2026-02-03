import React, { useEffect, useState } from 'react'
import { Target, Plus, Save, XCircle, Trash2, X, Upload, FileText } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import * as XLSX from 'xlsx'

function ROTargets() {
  const [roTargets, setROTargets] = useState([])
  const [roLoading, setROLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showROOverlay, setShowROOverlay] = useState(false)
  const [roMode, setROMode] = useState(null) // 'manual' or 'upload'
  const [roDraft, setRODraft] = useState({
    loanOfficerName: '',
    month: '',
    year: new Date().getFullYear(),
    sumOfTarget: 0,
    sumOfPrincipalBalance: 0
  })
  const [roBulkData, setROBulkData] = useState([])
  const [roSaving, setROSaving] = useState(false)

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  useEffect(() => {
    loadROTargets()
  }, [])

  const loadROTargets = async () => {
    try {
      setROLoading(true)
      const res = await fetch(API_URLS.targets.ro.list, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load RO targets (${res.status})`)
      const data = await res.json()
      setROTargets(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Error loading RO targets:', e)
      setROTargets([])
      setError(e.message)
    } finally {
      setROLoading(false)
    }
  }

  const handleCreateROTarget = () => {
    setRODraft({
      loanOfficerName: '',
      month: '',
      year: new Date().getFullYear(),
      sumOfTarget: 0,
      sumOfPrincipalBalance: 0
    })
    setROBulkData([])
    setROMode(null)
    setShowROOverlay(true)
    setError(null)
  }

  const handleROManualSubmit = async (e) => {
    e.preventDefault()
    if (!roDraft.loanOfficerName.trim() || !roDraft.month || !roDraft.year) {
      setError('Loan Officer Name, Month, and Year are required')
      return
    }
    try {
      setROSaving(true)
      setError(null)
      const res = await fetch(API_URLS.targets.ro.create, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          loanOfficerName: roDraft.loanOfficerName.trim(),
          month: Number(roDraft.month),
          year: Number(roDraft.year),
          sumOfTarget: Number(roDraft.sumOfTarget) || 0,
          sumOfPrincipalBalance: Number(roDraft.sumOfPrincipalBalance) || 0,
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create RO target')
      }
      await loadROTargets()
      setShowROOverlay(false)
      setROMode(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setROSaving(false)
    }
  }

  const handleROFileUpload = async (e) => {
    console.log('handleROFileUpload called', e.target.files)
    const file = e.target.files?.[0]
    if (!file) {
      console.log('No file selected')
      setROBulkData([])
      return
    }

    console.log('Processing file:', file.name, file.type, file.size)

    try {
      setError(null)
      console.log('Reading file as array buffer...')
      const data = await file.arrayBuffer()
      console.log('File read, parsing Excel...')
      const workbook = XLSX.read(data, { type: 'array' })
      console.log('Available sheets:', workbook.SheetNames)
      
      // Try to find a sheet with data
      let jsonData = []
      let sheetName = null
      
      for (const name of workbook.SheetNames) {
        const worksheet = workbook.Sheets[name]
        console.log(`Trying sheet: ${name}`)
        
        // Try different parsing options
        const options1 = { defval: '', raw: false }
        const options2 = { defval: null, raw: false, header: 1 }
        const options3 = { defval: '', raw: false, blankrows: true }
        
        let parsed = XLSX.utils.sheet_to_json(worksheet, options1)
        console.log(`Sheet ${name} parsed with default options:`, parsed.length, 'rows')
        
        // Check the raw range to see if there's data
        const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null
        if (range) {
          console.log(`Sheet ${name} range:`, worksheet['!ref'], `(${range.e.r + 1} rows, ${range.e.c + 1} cols)`)
        }
        
        if (parsed.length === 0) {
          // Try with header: 1 to see raw data
          const rawData = XLSX.utils.sheet_to_json(worksheet, options2)
          console.log(`Sheet ${name} raw data (first 10 rows):`, rawData.slice(0, 10))
          
          // Check if there are any non-empty cells
          if (rawData.length > 0) {
            console.log(`Sheet ${name} has ${rawData.length} raw rows, but no parsed data. This might mean headers are present but no data rows, or data structure is different.`)
          }
          
          // Try with blankrows: true
          parsed = XLSX.utils.sheet_to_json(worksheet, options3)
          console.log(`Sheet ${name} parsed with blankrows:`, parsed.length, 'rows')
          
          // If still empty but has raw data, try without header assumption
          if (parsed.length === 0 && rawData.length > 1) {
            // Maybe the first row is not headers, try treating first row as data
            const firstRow = rawData[0]
            console.log(`Sheet ${name} first raw row:`, firstRow)
            // Try parsing assuming first row might be headers
            parsed = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false, range: 0 })
            console.log(`Sheet ${name} parsed with range 0:`, parsed.length, 'rows')
          }
        }
        
        if (parsed.length > 0) {
          jsonData = parsed
          sheetName = name
          console.log(`✓ Using sheet: ${name} with ${parsed.length} rows`)
          break
        }
      }
      
      console.log('Final parsed JSON data:', jsonData.length, 'rows')
      console.log('First row:', jsonData[0])

      if (!jsonData.length) {
        const errorMsg = `Excel file appears to be empty or has no data rows. Found ${workbook.SheetNames.length} sheet(s): ${workbook.SheetNames.join(', ')}. Please ensure your Excel file has data rows with headers: "Loan Officers", "Sum of Target", and "Sum of Principal Balance".`
        console.error(errorMsg)
        setError(errorMsg)
        setROBulkData([])
        return
      }

      // Validate columns - check all possible column name variations
      const firstRow = jsonData[0]
      const allKeys = Object.keys(firstRow).map(k => k.trim())
      console.log('All column keys found:', allKeys)
      
      // Find loan officers column (case-insensitive, flexible matching)
      const loanOfficerKey = allKeys.find(k => {
        const kLower = k.toLowerCase()
        return (kLower.includes('loan') && (kLower.includes('officer') || kLower.includes('officers'))) ||
               kLower === 'loan officers' || kLower === 'loan officer'
      })
      console.log('Loan Officer Key found:', loanOfficerKey)
      
      // Find target column
      const targetKey = allKeys.find(k => {
        const kLower = k.toLowerCase()
        return (kLower.includes('target') && (kLower.includes('sum') || kLower.includes('of'))) ||
               kLower === 'sum of target' || kLower === 'target'
      })
      console.log('Target Key found:', targetKey)
      
      // Find principal balance column
      const principalBalanceKey = allKeys.find(k => {
        const kLower = k.toLowerCase()
        return (kLower.includes('principal') && kLower.includes('balance')) ||
               kLower === 'sum of principal balance' || kLower.includes('principal balance')
      })
      console.log('Principal Balance Key found:', principalBalanceKey)

      if (!loanOfficerKey || !targetKey || !principalBalanceKey) {
        const missing = []
        if (!loanOfficerKey) missing.push('Loan Officers')
        if (!targetKey) missing.push('Sum of Target')
        if (!principalBalanceKey) missing.push('Sum of Principal Balance')
        const errorMsg = `Excel file is missing required columns: ${missing.join(', ')}. Found columns: ${allKeys.join(', ')}`
        console.error(errorMsg)
        setError(errorMsg)
        setROBulkData([])
        return
      }

      // Map the data to use consistent keys
      const mappedData = jsonData.map(row => ({
        'Loan Officers': row[loanOfficerKey] || '',
        'Sum of Target': row[targetKey] || 0,
        'Sum of Principal Balance': row[principalBalanceKey] || 0,
        // Also keep original keys for compatibility
        loanOfficers: row[loanOfficerKey] || '',
        sumOfTarget: row[targetKey] || 0,
        sumOfPrincipalBalance: row[principalBalanceKey] || 0,
      }))

      console.log('Mapped data sample:', mappedData.slice(0, 2))
      console.log('Setting roBulkData with', mappedData.length, 'rows')
      setROBulkData(mappedData)
      console.log('roBulkData set successfully')
    } catch (e) {
      console.error('Error parsing Excel file:', e)
      console.error('Error stack:', e.stack)
      setError(`Failed to parse Excel file: ${e.message}`)
      setROBulkData([])
    }
  }

  const handleROBulkSubmit = async (e) => {
    e.preventDefault()
    if (!roDraft.month || !roDraft.year) {
      setError('Month and Year are required')
      return
    }
    if (!roBulkData.length) {
      setError('No data to upload')
      return
    }

    try {
      setROSaving(true)
      setError(null)
      const res = await fetch(API_URLS.targets.ro.bulk, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          month: Number(roDraft.month),
          year: Number(roDraft.year),
          targets: roBulkData
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to upload RO targets')
      }
      await loadROTargets()
      setShowROOverlay(false)
      setROMode(null)
      setROBulkData([])
    } catch (e) {
      setError(e.message)
    } finally {
      setROSaving(false)
    }
  }

  const handleRODelete = async (target) => {
    if (!window.confirm(`Delete RO target for ${target.loanOfficerName} ${target.month}/${target.year}?`)) return
    try {
      const res = await fetch(API_URLS.targets.ro.delete(target.id), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      await loadROTargets()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Target className="text-primary-600" size={32} />
            RO Targets
          </h1>
          <p className="text-gray-600 mt-2">Manage loan officer targets for RO (Relationship Officer) performance tracking.</p>
        </div>
        {!showROOverlay && (
          <button
            onClick={handleCreateROTarget}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors duration-200 shadow-sm hover:shadow-md"
          >
            <Plus size={18} />
            Create Target
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 transition-colors">
            <XCircle size={18} />
          </button>
        </div>
      )}

      {/* RO Target Overlay */}
      {showROOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Plus size={20} className="text-primary-600" />
                Create RO Target
              </h2>
              <button
                onClick={() => {
                  setShowROOverlay(false)
                  setROMode(null)
                  setROBulkData([])
                  setError(null)
                }}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {!roMode ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Choose how you want to create RO targets:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={() => setROMode('manual')}
                      className="flex flex-col items-center justify-center p-6 border-2 border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
                    >
                      <FileText size={32} className="text-primary-600 mb-2" />
                      <span className="font-semibold text-gray-900">Manual Entry</span>
                      <span className="text-xs text-gray-500 mt-1">Enter targets one at a time</span>
                    </button>
                    <button
                      onClick={() => setROMode('upload')}
                      className="flex flex-col items-center justify-center p-6 border-2 border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
                    >
                      <Upload size={32} className="text-primary-600 mb-2" />
                      <span className="font-semibold text-gray-900">Upload File</span>
                      <span className="text-xs text-gray-500 mt-1">Upload Excel file with targets</span>
                    </button>
                  </div>
                </div>
              ) : roMode === 'manual' ? (
                <form onSubmit={handleROManualSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Loan Officer Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={roDraft.loanOfficerName}
                        onChange={(e) => setRODraft(prev => ({ ...prev, loanOfficerName: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                        required
                        placeholder="Enter loan officer name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Month <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={roDraft.month}
                        onChange={(e) => setRODraft(prev => ({ ...prev, month: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
                        required
                      >
                        <option value="">Select month</option>
                        {months.map((month, idx) => (
                          <option key={idx} value={String(idx + 1)}>{month}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Year <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={roDraft.year}
                        onChange={(e) => setRODraft(prev => ({ ...prev, year: parseInt(e.target.value) || new Date().getFullYear() }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                        min="2020"
                        max="2100"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Sum of Target
                      </label>
                      <input
                        type="number"
                        value={roDraft.sumOfTarget}
                        onChange={(e) => setRODraft(prev => ({ ...prev, sumOfTarget: parseFloat(e.target.value) || 0 }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Sum of Principal Balance
                      </label>
                      <input
                        type="number"
                        value={roDraft.sumOfPrincipalBalance}
                        onChange={(e) => setRODraft(prev => ({ ...prev, sumOfPrincipalBalance: parseFloat(e.target.value) || 0 }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setROMode(null)
                        setRODraft({
                          loanOfficerName: '',
                          month: '',
                          year: new Date().getFullYear(),
                          sumOfTarget: 0,
                          sumOfPrincipalBalance: 0
                        })
                        setError(null)
                      }}
                      className="inline-flex items-center px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={roSaving}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
                    >
                      <Save size={16} />
                      {roSaving ? 'Saving...' : 'Create Target'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleROBulkSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Month <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={roDraft.month}
                        onChange={(e) => setRODraft(prev => ({ ...prev, month: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
                        required
                      >
                        <option value="">Select month</option>
                        {months.map((month, idx) => (
                          <option key={idx} value={String(idx + 1)}>{month}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Year <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={roDraft.year}
                        onChange={(e) => setRODraft(prev => ({ ...prev, year: parseInt(e.target.value) || new Date().getFullYear() }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                        min="2020"
                        max="2100"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Excel File <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        console.log('File input onChange triggered', e.target.files)
                        handleROFileUpload(e)
                      }}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      File must contain columns: "Loan Officers", "Sum of Target", "Sum of Principal Balance"
                    </p>
                    {roBulkData.length > 0 && (
                      <p className="text-xs text-green-600 mt-1 font-semibold">
                        ✓ File loaded: {roBulkData.length} rows ready to upload
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      Debug: roBulkData.length = {roBulkData.length}, roSaving = {String(roSaving)}
                    </p>
                  </div>
                  {roBulkData.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                        <p className="text-sm font-semibold text-gray-700">Preview ({roBulkData.length} rows)</p>
                      </div>
                      <div className="overflow-x-auto max-h-64">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-4 py-2 text-left font-semibold text-gray-600">Loan Officers</th>
                              <th className="px-4 py-2 text-right font-semibold text-gray-600">Sum of Target</th>
                              <th className="px-4 py-2 text-right font-semibold text-gray-600">Sum of Principal Balance</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {roBulkData.slice(0, 10).map((row, idx) => (
                              <tr key={idx}>
                                <td className="px-4 py-2 text-gray-900">{row['Loan Officers'] || row.loanOfficers || row['Loan Officer'] || ''}</td>
                                <td className="px-4 py-2 text-right text-gray-700">{Number(row['Sum of Target'] || row.sumOfTarget || 0).toLocaleString()}</td>
                                <td className="px-4 py-2 text-right text-gray-700">{Number(row['Sum of Principal Balance'] || row.sumOfPrincipalBalance || 0).toLocaleString()}</td>
                              </tr>
                            ))}
                            {roBulkData.length > 10 && (
                              <tr>
                                <td colSpan={3} className="px-4 py-2 text-center text-xs text-gray-500">
                                  ... and {roBulkData.length - 10} more rows
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setROMode(null)
                        setROBulkData([])
                        setError(null)
                      }}
                      className="inline-flex items-center px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={roSaving || !roBulkData.length}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
                    >
                      <Save size={16} />
                      {roSaving ? 'Uploading...' : 'Upload Targets'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">RO Targets ({roTargets.length})</h3>
        </div>
        <div className="overflow-x-auto">
          {roLoading ? (
            <div className="px-6 py-12 text-center">
              <div className="flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
                <p className="text-sm text-gray-500">Loading RO targets...</p>
              </div>
            </div>
          ) : roTargets.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="flex flex-col items-center justify-center">
                <Target size={48} className="text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-500">No RO targets available</p>
                <p className="text-xs text-gray-400 mt-1">Create a new RO target to get started</p>
              </div>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Loan Officer</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Month/Year</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Sum of Target</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Sum of Principal Balance</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {roTargets.map((target) => (
                  <tr key={target.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{target.loanOfficerName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700">{months[parseInt(target.month) - 1]} {target.year}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-sm text-gray-700">KES {target.sumOfTarget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-sm text-gray-700">KES {target.sumOfPrincipalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleRODelete(target)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors">
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default ROTargets


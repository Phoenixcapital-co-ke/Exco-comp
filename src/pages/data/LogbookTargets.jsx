import React, { useEffect, useState } from 'react'
import { Target, Plus, Save, XCircle, Trash2, Edit2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

// Holiday Calendar Component
function HolidayCalendar({ month, year, selectedDates = [], onSelect, onClose }) {
  const [currentMonth, setCurrentMonth] = useState(month)
  const [currentYear, setCurrentYear] = useState(year)
  
  // Sync calendar with form's month/year
  useEffect(() => {
    setCurrentMonth(month)
    setCurrentYear(year)
  }, [month, year])
  
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
  const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1).getDay()
  
  const isSelected = (day) => {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return selectedDates.includes(dateStr)
  }
  
  const isSunday = (day) => {
    const date = new Date(currentYear, currentMonth - 1, day)
    const dayOfWeek = date.getDay()
    return dayOfWeek === 0 // Only Sundays are non-working days
  }
  
  const toggleDate = (day) => {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    let newDates = [...selectedDates]
    
    if (isSelected(day)) {
      newDates = newDates.filter(d => d !== dateStr)
    } else {
      newDates.push(dateStr)
      newDates.sort()
    }
    
    onSelect(newDates)
  }
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  
  const prevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }
  
  const nextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }
  
  const days = []
  // Empty cells for days before the first day of the month
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null)
  }
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day)
  }
  
  return (
    <div className="absolute z-50 mt-2 bg-white border border-gray-300 rounded-lg shadow-xl p-4 w-80">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <ChevronLeft size={20} />
        </button>
        <h3 className="font-semibold text-gray-900">
          {monthNames[currentMonth - 1]} {currentYear}
        </h3>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <ChevronRight size={20} />
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayNames.map(day => (
          <div key={day} className="text-xs font-semibold text-gray-600 text-center py-1">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, idx) => {
          if (day === null) {
            return <div key={idx} className="aspect-square" />
          }
          
          const selected = isSelected(day)
          const sunday = isSunday(day)
          
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDate(day)}
              disabled={sunday}
              className={`
                aspect-square text-sm rounded transition-colors
                ${selected 
                  ? 'bg-primary-600 text-white font-semibold' 
                  : sunday 
                    ? 'text-gray-300 cursor-not-allowed' 
                    : 'hover:bg-gray-100 text-gray-700'
                }
              `}
            >
              {day}
            </button>
          )
        })}
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
        <div className="text-xs text-gray-600">
          {selectedDates.length} holiday{selectedDates.length !== 1 ? 's' : ''} selected
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-primary-600 hover:text-primary-700 font-semibold"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function LogbookTargets() {
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [branches, setBranches] = useState([])
  const [draft, setDraft] = useState({
    month: '',
    year: new Date().getFullYear(),
    holidays: [],
    active: true
  })
  const [showHolidayCalendar, setShowHolidayCalendar] = useState(false)
  const [branchTargets, setBranchTargets] = useState([])
  const [editTargetId, setEditTargetId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const loadTargets = async () => {
    try {
      setLoading(true)
      const res = await fetch(API_URLS.targets.logbook.list, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load targets (${res.status})`)
      const data = await res.json()
      setTargets(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTargets()
    loadBranches()
  }, [])

  const loadBranches = async () => {
    try {
      const res = await fetch(API_URLS.logbook.branches, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const names = Array.isArray(data)
          ? data.map((b) => b.name || b.code || '').filter((n) => n && String(n).trim().length > 0)
          : []
        setBranches(names)
        setBranchTargets(names.map((name) => ({
          branch: name,
          disbursementTarget: 0,
          collectionTarget: 0,
          active: true
        })))
      }
    } catch (e) {
      console.error('Failed to load branches', e)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!draft.month) {
      setError('Month is required')
      return
    }
    if (!branchTargets.length) {
      setError('No branches available')
      return
    }
    try {
      setSaving(true)
      const monthVal = Number(draft.month)
      const yearVal = Number(draft.year)
      const activeVal = !!draft.active
      const holidaysVal = Array.isArray(draft.holidays) ? draft.holidays : []
      const payloads = branchTargets.map((bt) => ({
        branch: bt.branch,
        month: monthVal,
        year: yearVal,
        disbursementTarget: Number(bt.disbursementTarget) || 0,
        collectionTarget: Number(bt.collectionTarget) || 0,
        holidays: holidaysVal,
        active: activeVal && bt.active !== false,
      }))

      if (editTargetId && payloads.length === 1) {
        const res = await fetch(API_URLS.targets.logbook.update(editTargetId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payloads[0])
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Update failed')
        }
      } else {
        for (const p of payloads) {
          const res = await fetch(API_URLS.targets.logbook.create, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(p)
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || `Save failed for ${p.branch}`)
          }
        }
      }
      await loadTargets()
      resetForm()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setDraft({
      month: '',
      year: new Date().getFullYear(),
      holidays: [],
      active: true
    })
    setBranchTargets(branches.map((name) => ({
      branch: name,
      disbursementTarget: 0,
      collectionTarget: 0,
      active: true
    })))
    setEditTargetId(null)
    setError(null)
    setShowForm(false)
    setShowHolidayCalendar(false)
  }

  const handleCreateClick = () => {
    setDraft({
      month: '',
      year: new Date().getFullYear(),
      holidays: [],
      active: true
    })
    setBranchTargets(branches.map((name) => ({
      branch: name,
      disbursementTarget: 0,
      collectionTarget: 0,
      active: true
    })))
    setEditTargetId(null)
    setError(null)
    setShowForm(true)
    setShowHolidayCalendar(false)
  }

  const handleEdit = (target) => {
    setDraft({
      month: String(target.month || ''),
      year: target.year || new Date().getFullYear(),
      holidays: Array.isArray(target.holidays) ? target.holidays : [],
      active: !!target.active
    })
    setBranchTargets([{
      branch: target.branch || '',
      disbursementTarget: target.disbursementTarget || 0,
      collectionTarget: target.collectionTarget || 0,
      active: !!target.active
    }])
    setEditTargetId(target.id)
    setError(null)
    setShowForm(true)
    setShowHolidayCalendar(false)
  }

  const handleDelete = async (target) => {
    if (!window.confirm(`Delete target for ${target.branch} ${target.month}/${target.year}?`)) return
    try {
      const res = await fetch(API_URLS.targets.logbook.delete(target.id), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      await loadTargets()
    } catch (e) {
      setError(e.message)
    }
  }

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Target className="text-primary-600" size={32} />
            Logbook Targets
          </h1>
          <p className="text-gray-600 mt-2">Manage disbursement and collection targets for Logbook branches.</p>
        </div>
        {!showForm && (
          <button
            onClick={handleCreateClick}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors duration-200 shadow-sm hover:shadow-md"
          >
            <Plus size={18} />
            Add Target
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

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-md border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Plus size={20} className="text-primary-600" />
                {editTargetId ? 'Edit Target' : 'Add Monthly Targets (All Branches)'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {editTargetId ? 'Edit the target for this branch.' : 'Enter disbursement and collection targets for every branch in one submission.'}
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Close form"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Month <span className="text-red-500">*</span>
              </label>
              <select
                value={draft.month}
                onChange={(e) => setDraft((prev) => ({ ...prev, month: e.target.value }))}
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
                value={draft.year}
                onChange={(e) => setDraft((prev) => ({ ...prev, year: parseInt(e.target.value) || new Date().getFullYear() }))}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                min="2020"
                max="2100"
                required
              />
            </div>
            <div className="relative">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Holidays
              </label>
              <button
                type="button"
                onClick={() => setShowHolidayCalendar(!showHolidayCalendar)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-left focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
              >
                {draft.holidays.length > 0 
                  ? `${draft.holidays.length} holiday${draft.holidays.length > 1 ? 's' : ''} selected`
                  : 'Select holidays'}
              </button>
              {showHolidayCalendar && draft.month && (
                <HolidayCalendar
                  month={Number(draft.month)}
                  year={draft.year}
                  selectedDates={draft.holidays}
                  onSelect={(dates) => {
                    setDraft((prev) => ({ ...prev, holidays: dates }))
                  }}
                  onClose={() => setShowHolidayCalendar(false)}
                />
              )}
            </div>
            <div className="flex items-center">
              <div className="flex items-center space-x-3 mt-8">
                <input
                  id="target-active"
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  checked={draft.active}
                  onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
                />
                <label htmlFor="target-active" className="text-sm font-semibold text-gray-700 cursor-pointer">
                  Active Targets
                </label>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-600">Branch</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-600">Disbursement Target (KES)</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-600">Collection Target (KES)</th>
                    <th className="px-4 py-2 text-center font-semibold text-gray-600">Active</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {branchTargets.map((bt, idx) => (
                    <tr key={bt.branch || idx} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-semibold text-gray-900">{bt.branch}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          className="w-full rounded border border-gray-300 px-2 py-1 text-right"
                          min="0"
                          step="0.01"
                          value={bt.disbursementTarget}
                          onChange={(e) => setBranchTargets((prev) => {
                            const next = [...prev]
                            next[idx] = { ...next[idx], disbursementTarget: parseFloat(e.target.value) || 0 }
                            return next
                          })}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          className="w-full rounded border border-gray-300 px-2 py-1 text-right"
                          min="0"
                          step="0.01"
                          value={bt.collectionTarget}
                          onChange={(e) => setBranchTargets((prev) => {
                            const next = [...prev]
                            next[idx] = { ...next[idx], collectionTarget: parseFloat(e.target.value) || 0 }
                            return next
                          })}
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded"
                          checked={bt.active}
                          onChange={(e) => setBranchTargets((prev) => {
                            const next = [...prev]
                            next[idx] = { ...next[idx], active: e.target.checked }
                            return next
                          })}
                        />
                      </td>
                    </tr>
                  ))}
                  {!branchTargets.length && (
                    <tr>
                      <td className="px-4 py-4 text-center text-gray-500" colSpan={4}>No branches available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
              >
                <Save size={16} />
                {saving ? 'Saving...' : editTargetId ? 'Update Target' : 'Create Targets'}
              </button>
            </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">All Targets ({targets.length})</h3>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-6 py-12 text-center">
              <div className="flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
                <p className="text-sm text-gray-500">Loading targets...</p>
              </div>
            </div>
          ) : targets.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="flex flex-col items-center justify-center">
                <Target size={48} className="text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-500">No targets available</p>
                <p className="text-xs text-gray-400 mt-1">Create a new target to get started</p>
              </div>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Branch</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Month/Year</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Disbursement Target</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Collection Target</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Working Days</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {targets.map((target) => (
                  <tr key={target.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{target.branch}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700">{months[parseInt(target.month) - 1]} {target.year}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700">KES {target.disbursementTarget.toLocaleString()}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700">KES {target.collectionTarget.toLocaleString()}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700">{target.workingDays || 0}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {target.active ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(target)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary-300 text-primary-700 hover:bg-primary-50 text-xs font-semibold transition-colors">
                          <Edit2 size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(target)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors">
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
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

export default LogbookTargets


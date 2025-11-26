import React, { useEffect, useState } from 'react'
import { API_URLS } from '../../utils/api.js'
import { Plus, Save, Trash2, XCircle } from 'lucide-react'

const emptyDraft = {
  id: null,
  borrowerAccessId: '',
  name: '',
  active: true
}

function LoanOfficersPage() {
  const [officers, setOfficers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)

  const loadOfficers = async () => {
    try {
      setLoading(true)
      const res = await fetch(API_URLS.loanOfficers.list, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load loan officers (${res.status})`)
      const data = await res.json()
      setOfficers(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOfficers()
  }, [])

  const resetForm = () => {
    setDraft(emptyDraft)
    setError(null)
  }

  const handleEdit = (officer) => {
    setDraft({
      id: officer.id,
      borrowerAccessId: officer.borrowerAccessId || '',
      name: officer.name || '',
      active: !!officer.active
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!draft.borrowerAccessId.trim() || !draft.name.trim()) {
      setError('Borrower Access ID and Name are required.')
      return
    }

    try {
      setSaving(true)
      const payload = {
        borrowerAccessId: draft.borrowerAccessId.trim(),
        name: draft.name.trim(),
        active: draft.active
      }
      const url = draft.id ? API_URLS.loanOfficers.update(draft.id) : API_URLS.loanOfficers.create
      const method = draft.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Unable to save loan officer')
      }
      await loadOfficers()
      resetForm()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (officer) => {
    try {
      const res = await fetch(API_URLS.loanOfficers.update(officer.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !officer.active }),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update status')
      }
      await loadOfficers()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (officer) => {
    if (!window.confirm(`Delete ${officer.name}? This cannot be undone.`)) return
    try {
      const res = await fetch(API_URLS.loanOfficers.delete(officer.id), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      await loadOfficers()
      if (draft.id === officer.id) resetForm()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Loan Officers</h1>
        <p className="text-gray-600 mt-2">
          Manage borrower access IDs for your loan officers. Add new officers, edit their details, or remove entries.
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <XCircle size={18} />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {draft.id ? 'Edit Loan Officer' : 'Add Loan Officer'}
            </h2>
            <p className="text-sm text-gray-500">Provide the borrower access ID and the officer&apos;s full name.</p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <Plus size={16} className="mr-1" />
            New Officer
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Borrower Access ID</label>
            <input
              type="text"
              value={draft.borrowerAccessId}
              onChange={(e) => setDraft((prev) => ({ ...prev, borrowerAccessId: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g. 97469"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Officer name"
              required
            />
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <input
              id="lo-active"
              type="checkbox"
              className="rounded border-gray-300"
              checked={draft.active}
              onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
            />
            <label htmlFor="lo-active" className="text-sm text-gray-700">Active</label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {draft.id && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60"
          >
            <Save size={16} className="mr-2" />
            {draft.id ? 'Update Officer' : 'Add Officer'}
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Borrower Access ID</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Updated</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Loading loan officers...
                </td>
              </tr>
            ) : officers.length ? (
              officers.map((officer) => (
                <tr key={officer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{officer.name}</td>
                  <td className="px-4 py-3 text-gray-700">{officer.borrowerAccessId}</td>
                  <td className="px-4 py-3">
                    {officer.active ? (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {officer.updatedAt ? new Date(officer.updatedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => toggleActive(officer)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-semibold"
                    >
                      {officer.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleEdit(officer)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-primary-200 text-primary-600 hover:bg-primary-50 text-xs font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(officer)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold"
                    >
                      <Trash2 size={14} className="mr-1" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No loan officers found. Add the first entry to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default LoanOfficersPage



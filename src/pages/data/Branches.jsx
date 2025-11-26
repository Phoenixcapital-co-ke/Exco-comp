import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, Pencil } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

export default function DataBranches() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState({ code: '', name: '', active: true })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const res = await fetch(API_URLS.branches.list, { credentials: 'include' })
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
      setLoading(false)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const onSave = async () => {
    if (!draft.code.trim() || !draft.name.trim()) return
    try {
      setSaving(true)
      await fetch(API_URLS.branches.upsert, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: draft.code.trim(),
          name: draft.name.trim(),
          active: draft.active ? 1 : 0
        }),
        credentials: 'include',
      })
      setDraft({ code: '', name: '', active: true })
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (code) => {
    if (!code) return
    const ok = window.confirm('Delete this branch? This cannot be undone.')
    if (!ok) return
    try {
      const res = await fetch(API_URLS.branches.delete(code), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `Delete failed: ${res.status}`)
      }
      await load()
    } catch (e) {
      setError(`Failed to delete branch: ${e.message}`)
      console.error('Delete error:', e)
    }
  }

  if (loading) return <div className="p-6 text-gray-600">Loading branches...</div>

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Branches</h1>
        <p className="text-gray-600 mt-2">Manage Logbook branch codes used for API fetches.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-red-800 text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-600 hover:text-red-800"
          >
            ×
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Code</label>
            <input
              className="w-full border border-gray-300 rounded px-2 py-2 text-sm"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="e.g. 12936"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Name</label>
            <input
              className="w-full border border-gray-300 rounded px-2 py-2 text-sm"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Nairobi"
            />
          </div>
          <div className="flex items-center space-x-2">
            <input
              id="active"
              type="checkbox"
              className="rounded border-gray-300"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            <label htmlFor="active" className="text-sm text-gray-700">Active</label>
          </div>
          <div>
            <button
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save size={16} className="mr-2" />
              Save
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Code</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Active</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.code} className="hover:bg-gray-50">
                <td className="px-3 py-2">{r.code}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.active ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setDraft({ code: r.code, name: r.name, active: !!r.active })}
                    className="inline-flex items-center px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 mr-2"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => onDelete(r.code)}
                    className="inline-flex items-center px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>No branches configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}



import React, { useEffect, useState } from 'react'
import { API_URLS } from '../../utils/api.js'
import { Plus, Save, XCircle, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

const defaultDraft = {
  id: null,
  username: '',
  fullName: '',
  email: '',
  role: 'user',
  password: '',
  active: true
}

function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(defaultDraft)
  const [saving, setSaving] = useState(false)

  const loadUsers = async () => {
    try {
      setLoading(true)
      const res = await fetch(API_URLS.users.list, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load users (${res.status})`)
      const data = await res.json()
      setUsers(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleEdit = (user) => {
    setDraft({
      id: user.id,
      username: user.username,
      fullName: user.fullName || '',
      email: user.email || '',
      role: user.role || 'user',
      password: '',
      active: !!user.active
    })
  }

  const handleDelete = async (user) => {
    if (!window.confirm(`Delete ${user.username}? This cannot be undone.`)) return
    try {
      setSaving(true)
      const res = await fetch(API_URLS.users.delete(user.id), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      await loadUsers()
      if (draft.id === user.id) {
        setDraft(defaultDraft)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setDraft(defaultDraft)
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!draft.username.trim()) {
      setError('Username is required')
      return
    }
    if (!draft.id && !draft.password.trim()) {
      setError('Password is required for new users')
      return
    }

    try {
      setSaving(true)
      const payload = {
        username: draft.username.trim(),
        fullName: draft.fullName.trim(),
        email: draft.email.trim(),
        role: draft.role,
        active: draft.active,
      }
      if (draft.password.trim()) {
        payload.password = draft.password
      }

      const url = draft.id ? API_URLS.users.update(draft.id) : API_URLS.users.create
      const method = draft.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Save failed')
      }
      await loadUsers()
      setDraft(defaultDraft)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (user) => {
    try {
      const res = await fetch(API_URLS.users.update(user.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update status')
      }
      await loadUsers()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-600 mt-2">Add, edit, deactivate, or remove dashboard users.</p>
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
              {draft.id ? 'Edit User' : 'Add New User'}
            </h2>
            <p className="text-sm text-gray-500">Provide user credentials and role.</p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <Plus size={16} className="mr-1" />
            New User
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={draft.username}
              onChange={(e) => setDraft((prev) => ({ ...prev, username: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Username"
              required
              disabled={Boolean(draft.id)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={draft.fullName}
              onChange={(e) => setDraft((prev) => ({ ...prev, fullName: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft((prev) => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={draft.role}
              onChange={(e) => setDraft((prev) => ({ ...prev, role: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="logbook">Logbook</option>
              <option value="zidisha">Zidisha</option>
              <option value="advans">Advans</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password {draft.id ? '(leave blank to keep existing)' : ''}
            </label>
            <input
              type="password"
              value={draft.password}
              onChange={(e) => setDraft((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="******"
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center space-x-2 mt-6">
            <input
              id="user-active"
              type="checkbox"
              className="rounded border-gray-300"
              checked={draft.active}
              onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
            />
            <label htmlFor="user-active" className="text-sm text-gray-700">Active</label>
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
            {draft.id ? 'Update User' : 'Create User'}
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Username</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading users...
                </td>
              </tr>
            ) : users.length ? (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{user.fullName || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.username}</td>
                  <td className="px-4 py-3 text-gray-700">{user.email || '—'}</td>
                  <td className="px-4 py-3 capitalize text-gray-700">{user.role || 'user'}</td>
                  <td className="px-4 py-3">
                    {user.active ? (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">
                        Deactivated
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => toggleActive(user)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-semibold"
                      title={user.active ? 'Deactivate user' : 'Activate user'}
                    >
                      {user.active ? (
                        <>
                          <ToggleLeft size={16} className="mr-1 text-red-500" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <ToggleRight size={16} className="mr-1 text-emerald-500" />
                          Activate
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleEdit(user)}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-primary-200 text-primary-600 hover:bg-primary-50 text-xs font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
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
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No users available. Create a new user to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default UsersPage


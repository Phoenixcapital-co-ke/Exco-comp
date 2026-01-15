import React, { useCallback, useEffect, useState } from 'react'
import { API_URLS } from '../../utils/api.js'
import { Plus, Save, XCircle, Trash2, ToggleLeft, ToggleRight, X, Users, Edit2, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

const defaultDraft = {
  id: null,
  username: '',
  fullName: '',
  email: '',
  role: 'user',
  password: '',
  active: true,
  allowedPages: [],
  allowedZidishaBranches: []
}

function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [draft, setDraft] = useState(defaultDraft)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [availablePages, setAvailablePages] = useState([])
  const [availableZidishaBranches, setAvailableZidishaBranches] = useState([])
  const { user: currentUser } = useAuth()

  const loadUsers = async () => {
    try {
      setLoading(true)
      const res = await fetch(API_URLS.users.list, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load users (${res.status})`)
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      const currentRole = String(currentUser?.role || '').toLowerCase()
      // Admins should not see superuser accounts in the list
      const filtered =
        currentRole === 'admin'
          ? list.filter((u) => String(u.role || '').toLowerCase() !== 'superuser')
          : list
      setUsers(filtered)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
    loadAvailablePages()
    loadAvailableZidishaBranches()
  }, [])

  const loadAvailablePages = async () => {
    try {
      const res = await fetch(API_URLS.pages.list, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setAvailablePages(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.error('Failed to load pages:', e)
    }
  }

  const loadAvailableZidishaBranches = async () => {
    try {
      const res = await fetch(API_URLS.zidisha.branches, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setAvailableZidishaBranches(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.error('Failed to load Zidisha branches:', e)
    }
  }

  const handleEdit = (user) => {
    setDraft({
      id: user.id,
      username: user.username,
      fullName: user.fullName || '',
      email: user.email || '',
      role: user.role || 'user',
      password: '',
      active: !!user.active,
      allowedPages: Array.isArray(user.allowedPages) ? user.allowedPages : [],
      allowedZidishaBranches: Array.isArray(user.allowedZidishaBranches) ? user.allowedZidishaBranches : [],
    })
    setShowForm(true)
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

  const resetForm = useCallback(() => {
    setDraft(defaultDraft)
    setError(null)
    setShowForm(false)
  }, [])

  const handleCreateClick = () => {
    setDraft(defaultDraft)
    setError(null)
    setShowForm(true)
  }

  useEffect(() => {
    if (!success) return
    const t = window.setTimeout(() => setSuccess(null), 3500)
    return () => window.clearTimeout(t)
  }, [success])

  useEffect(() => {
    if (!showForm) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') resetForm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showForm, resetForm])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!draft.username.trim()) {
      setError('Username is required')
      return
    }
    if (!draft.id && !draft.password.trim()) {
      setError('Password is required for new users')
      return
    }
    if (draft.role === 'custom' && (!Array.isArray(draft.allowedPages) || draft.allowedPages.length === 0)) {
      setError('At least one page must be selected for custom role users')
      return
    }
    if (draft.role === 'custom') {
      const pagesArr = Array.isArray(draft.allowedPages) ? draft.allowedPages : []
      const hasZidishaPages = pagesArr.some((p) => String(p || '').startsWith('/zidisha/'))
      if (hasZidishaPages) {
        const branchesArr = Array.isArray(draft.allowedZidishaBranches) ? draft.allowedZidishaBranches : []
        if (branchesArr.length === 0) {
          setError('At least one Zidisha branch must be selected for Zidisha page access')
          return
        }
      }
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
      if (draft.role === 'custom') {
        payload.allowedPages = Array.isArray(draft.allowedPages) ? draft.allowedPages : []
        payload.allowedZidishaBranches = Array.isArray(draft.allowedZidishaBranches) ? draft.allowedZidishaBranches : []
      }

      const isCreate = !draft.id
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
      setShowForm(false)
      setSuccess(isCreate ? 'User created successfully.' : 'User updated successfully.')
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Users className="text-primary-600" size={32} />
            User Management
          </h1>
          <p className="text-gray-600 mt-2">Add, edit, deactivate, or remove dashboard users.</p>
        </div>
        {!showForm && (
          <button
            onClick={handleCreateClick}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors duration-200 shadow-sm hover:shadow-md"
          >
            <Plus size={18} />
            Create User
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

      {success && (
        <div className="fixed top-5 right-5 z-[60] flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg">
          <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
          <div className="flex-1">
            <div className="font-semibold">Success</div>
            <div className="text-emerald-800/90">{success}</div>
          </div>
          <button
            onClick={() => setSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 transition-colors"
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={resetForm} />

          {/* Centered modal */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white shadow-2xl border border-gray-200 rounded-2xl overflow-hidden">
              <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                    {draft.id ? (
                      <>
                        <Edit2 size={20} className="text-primary-600" />
                        Edit User
                      </>
                    ) : (
                      <>
                        <Plus size={20} className="text-primary-600" />
                        Add New User
                      </>
                    )}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">Provide user credentials and role.</p>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Close form"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Username <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={draft.username}
                    onChange={(e) => setDraft((prev) => ({ ...prev, username: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="Enter username"
                    required
                    disabled={Boolean(draft.id)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={draft.fullName}
                    onChange={(e) => setDraft((prev) => ({ ...prev, fullName: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="Enter full name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft((prev) => ({ ...prev, email: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                  <select
                    value={draft.role}
                    onChange={(e) => {
                      const newRole = e.target.value
                      setDraft((prev) => ({
                        ...prev,
                        role: newRole,
                        allowedPages: newRole === 'custom' ? (prev.allowedPages || []) : [],
                        allowedZidishaBranches: newRole === 'custom' ? (prev.allowedZidishaBranches || []) : [],
                      }))
                    }}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
                  >
                    {/* Only superuser can assign the superuser role */}
                    {String(currentUser?.role || '').toLowerCase() === 'superuser' && (
                      <option value="superuser">Superuser</option>
                    )}
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="logbook">Logbook</option>
                    <option value="zidisha">Zidisha</option>
                    <option value="advans">Advans</option>
                    <option value="boda">Boda</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Password {draft.id && <span className="text-gray-500 font-normal">(leave blank to keep existing)</span>}
                    {!draft.id && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="password"
                    value={draft.password}
                    onChange={(e) => setDraft((prev) => ({ ...prev, password: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                    placeholder="Enter password"
                    autoComplete="new-password"
                    required={!draft.id}
                  />
                </div>
                <div className="flex items-center">
                  <div className="flex items-center space-x-3 mt-8">
                    <input
                      id="user-active"
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      checked={draft.active}
                      onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
                    />
                    <label htmlFor="user-active" className="text-sm font-semibold text-gray-700 cursor-pointer">
                      Active User
                    </label>
                  </div>
                </div>
              </div>

              {draft.role === 'custom' && (
                <div className="border-t border-gray-200 pt-5">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Allowed Pages <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-4">Select which pages this user can access</p>
                  <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4 space-y-2">
                    {availablePages.length === 0 ? (
                      <p className="text-sm text-gray-500">Loading pages...</p>
                    ) : (
                      (() => {
                        const grouped = availablePages.reduce((acc, page) => {
                          const cat = page.category || 'Other'
                          if (!acc[cat]) acc[cat] = []
                          acc[cat].push(page)
                          return acc
                        }, {})
                        return Object.entries(grouped).map(([category, pages]) => (
                          <div key={category} className="mb-4">
                            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{category}</h4>
                            <div className="space-y-2 pl-2">
                              {pages.map((page) => {
                                const isChecked =
                                  Array.isArray(draft.allowedPages) && draft.allowedPages.includes(page.path)
                                return (
                                  <label
                                    key={page.path}
                                    className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const current = Array.isArray(draft.allowedPages) ? draft.allowedPages : []
                                        if (e.target.checked) {
                                          setDraft((prev) => ({ ...prev, allowedPages: [...current, page.path] }))
                                        } else {
                                          setDraft((prev) => ({
                                            ...prev,
                                            allowedPages: current.filter((p) => p !== page.path),
                                          }))
                                        }
                                      }}
                                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-gray-700">{page.label}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        ))
                      })()
                    )}
                  </div>
                  {draft.role === 'custom' && (!Array.isArray(draft.allowedPages) || draft.allowedPages.length === 0) && (
                    <p className="text-xs text-red-600 mt-2">At least one page must be selected for custom role users</p>
                  )}
                </div>
              )}

              {draft.role === 'custom' &&
                Array.isArray(draft.allowedPages) &&
                draft.allowedPages.some((p) => String(p || '').startsWith('/zidisha/')) && (
                  <div className="border-t border-gray-200 pt-5">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Zidisha Branch Access <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-4">Select which Zidisha branches this user can see</p>
                    <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg p-4 space-y-2">
                      {availableZidishaBranches.length === 0 ? (
                        <p className="text-sm text-gray-500">Loading branches...</p>
                      ) : (
                        availableZidishaBranches.map((branch) => {
                          const isChecked =
                            Array.isArray(draft.allowedZidishaBranches) &&
                            draft.allowedZidishaBranches.includes(branch)
                          return (
                            <label
                              key={branch}
                              className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const current = Array.isArray(draft.allowedZidishaBranches)
                                    ? draft.allowedZidishaBranches
                                    : []
                                  if (e.target.checked) {
                                    setDraft((prev) => ({
                                      ...prev,
                                      allowedZidishaBranches: [...current, branch],
                                    }))
                                  } else {
                                    setDraft((prev) => ({
                                      ...prev,
                                      allowedZidishaBranches: current.filter((b) => b !== branch),
                                    }))
                                  }
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                              <span className="text-sm text-gray-700">{branch}</span>
                            </label>
                          )
                        })
                      )}
                    </div>
                    {(!Array.isArray(draft.allowedZidishaBranches) || draft.allowedZidishaBranches.length === 0) && (
                      <p className="text-xs text-red-600 mt-2">Select at least one branch for Zidisha access</p>
                    )}
                  </div>
                )}

              <div className="sticky bottom-0 bg-white pt-4 border-t border-gray-200">
                <div className="flex items-center justify-end gap-3">
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
                    {saving ? 'Saving...' : draft.id ? 'Update User' : 'Create User'}
                  </button>
                </div>
              </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">All Users ({users.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Username</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
                      <p className="text-sm text-gray-500">Loading users...</p>
                    </div>
                  </td>
                </tr>
              ) : users.length ? (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-semibold text-gray-900">{user.fullName || '—'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700 font-medium">{user.username}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">{user.email || '—'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100 text-blue-800 capitalize">
                        {user.role || 'user'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.active ? (
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
                          onClick={() => toggleActive(user)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-semibold transition-colors"
                          title={user.active ? 'Deactivate user' : 'Activate user'}
                        >
                          {user.active ? (
                            <>
                              <ToggleLeft size={14} className="text-red-500" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <ToggleRight size={14} className="text-emerald-500" />
                              Activate
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(user)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary-300 text-primary-700 hover:bg-primary-50 text-xs font-semibold transition-colors"
                        >
                          <Edit2 size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(user)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Users size={48} className="text-gray-300 mb-3" />
                      <p className="text-sm font-medium text-gray-500">No users available</p>
                      <p className="text-xs text-gray-400 mt-1">Create a new user to get started</p>
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

export default UsersPage


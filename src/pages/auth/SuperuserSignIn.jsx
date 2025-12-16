import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { API_URLS } from '../../utils/api.js'
import phoenixLogo from '../../assets/phoenix-logo.png'

function SuperuserSignIn() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(API_URLS.auth.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, superuserOnly: true }),
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Login failed')
      }
      const data = await res.json()
      // Verify the user is actually a superuser
      if (String(data.user?.role || '').toLowerCase() !== 'superuser') {
        throw new Error('Access denied. Superuser credentials required.')
      }
      login(data.user)
      const target = location.state?.from?.pathname || '/logbook/dashboard'
      navigate(target, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-8 space-y-6">
        <div className="text-center space-y-2">
          <img
            src={phoenixLogo}
            alt="Phoenix Capital"
            className="mx-auto w-28 h-28 object-contain drop-shadow-sm"
            draggable="false"
          />
          <p className="text-sm text-gray-500">Superuser access only</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter superuser username"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter superuser password"
              autoComplete="current-password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary-600 text-white py-2.5 text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-60"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-gray-500 text-center">
          Superuser credentials required for system administration.
        </p>
      </div>
    </div>
  )
}

export default SuperuserSignIn


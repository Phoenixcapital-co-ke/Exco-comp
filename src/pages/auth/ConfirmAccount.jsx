import React, { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { API_URLS } from '../../utils/api.js'
import phoenixLogo from '../../assets/phoenix-logo.png'

function ConfirmAccount() {
  const location = useLocation()
  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search])
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const validatePassword = (pw, pw2) => {
    const p = String(pw || '')
    if (p.length < 6) return 'Password must be at least 6 characters.'
    if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
      return 'Password must contain at least one letter and one number.'
    }
    if (p !== String(pw2 || '')) return 'Passwords do not match.'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const validationError = validatePassword(password, password2)
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(API_URLS.auth.confirmEmail, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to confirm account')
      }
      // Small delay to show loading state
      await new Promise((resolve) => setTimeout(resolve, 500))
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Loading screen overlay
  if (submitting) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gray-50">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="text-center space-y-4">
            <img
              src={phoenixLogo}
              alt="Phoenix Capital"
              className="mx-auto w-24 h-24 object-contain drop-shadow-sm"
              draggable="false"
            />
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
            <p className="text-sm text-gray-600">Confirming your account...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-8 space-y-6">
        <div className="text-center space-y-2">
          <img
            src={phoenixLogo}
            alt="Phoenix Capital"
            className="mx-auto w-24 h-24 object-contain drop-shadow-sm"
            draggable="false"
          />
          <h1 className="text-lg font-semibold text-gray-900">Confirm your account</h1>
          <p className="text-sm text-gray-500">Set your password to activate your account.</p>
        </div>

        {!token && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Missing token. Please use the confirmation link from your email.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 text-center">
              Account created successfully. Please log in below.
            </div>
            <Link
              to="/login"
              className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary-600 text-white py-2.5 text-sm font-semibold hover:bg-primary-700 transition"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Choose a password"
                  autoComplete="new-password"
                  required
                  disabled={!token}
                />
                <p className="text-xs text-gray-500 mt-1">At least 6 characters, including a letter and a number.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Repeat password</label>
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  required
                  disabled={!token}
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !token}
                className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary-600 text-white py-2.5 text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-60"
              >
                Confirm account
              </button>
            </form>

            <div className="text-center">
              <Link to="/login" className="text-xs text-primary-600 hover:underline">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ConfirmAccount



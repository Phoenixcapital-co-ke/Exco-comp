import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import phoenixLogo from '../../assets/phoenix-logo.png'
import { API_URLS } from '../../utils/api.js'
import { useAuth } from '../../context/AuthContext.jsx'

function FirstPassword() {
  const navigate = useNavigate()
  const { refreshUser, user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

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
    const err = validatePassword(newPassword, newPassword2)
    if (err) {
      setError(err)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(API_URLS.auth.firstPasswordChange, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update password')
      }
      await refreshUser(true)
      navigate('/logbook/kenya/dashboard', { replace: true })
    } catch (err2) {
      setError(err2.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-md border border-gray-200 p-8 space-y-6">
      <div className="text-center space-y-2">
        <img
          src={phoenixLogo}
          alt="Phoenix Capital"
          className="mx-auto w-24 h-24 object-contain drop-shadow-sm"
          draggable={false}
        />
        <h1 className="text-lg font-semibold text-gray-900">Set your new password</h1>
        <p className="text-sm text-gray-500">
          Signed in as <span className="font-medium text-gray-700">{user?.username}</span>. Enter the 5-digit first-time code from your SMS
          as your current password, then choose a new password.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">First-time code (5 digits)</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            autoComplete="new-password"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
          <input
            type="password"
            value={newPassword2}
            onChange={(e) => setNewPassword2(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            autoComplete="new-password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary-600 text-white py-2.5 text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  )
}

export default FirstPassword

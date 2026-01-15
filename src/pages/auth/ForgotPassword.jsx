import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { API_URLS } from '../../utils/api.js'
import phoenixLogo from '../../assets/phoenix-logo.png'

function ForgotPassword() {
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const requestCode = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(API_URLS.auth.forgotPassword, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to request reset code')
      }
      setSuccess('Reset code sent. Check your email.')
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const resetPassword = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(API_URLS.auth.resetPassword, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code, newPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reset password')
      }
      setSuccess('Password reset successfully. You can now sign in.')
      setStep(3)
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
            className="mx-auto w-24 h-24 object-contain drop-shadow-sm"
            draggable="false"
          />
          <h1 className="text-lg font-semibold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-500">
            {step === 1
              ? 'Enter your email to receive a reset code.'
              : step === 2
                ? 'Enter the code from your email and choose a new password.'
                : 'Done.'}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {success}
          </div>
        )}

        {step === 1 && (
          <form className="space-y-4" onSubmit={requestCode}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary-600 text-white py-2.5 text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-60"
            >
              {submitting ? 'Sending...' : 'Send reset code'}
            </button>
          </form>
        )}

        {step === 2 && (
          <form className="space-y-4" onSubmit={resetPassword}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reset code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="6-digit code"
                inputMode="numeric"
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
                placeholder="New password"
                autoComplete="new-password"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary-600 text-white py-2.5 text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-60"
            >
              {submitting ? 'Resetting...' : 'Reset password'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setStep(1)}
              className="w-full rounded-lg border border-gray-300 text-gray-700 py-2.5 text-sm font-semibold hover:bg-gray-50 transition disabled:opacity-60"
            >
              Request a new code
            </button>
          </form>
        )}

        {step === 3 && (
          <div className="text-center">
            <Link to="/login" className="text-sm text-primary-600 hover:underline">
              Go to Sign in
            </Link>
          </div>
        )}

        <div className="text-center">
          <Link to="/login" className="text-xs text-primary-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword



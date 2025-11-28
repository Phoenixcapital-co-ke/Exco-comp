import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

const getTimeoutMinutes = () => {
  const raw = typeof import.meta !== 'undefined'
    ? import.meta.env?.VITE_IDLE_TIMEOUT_MINUTES
    : null
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return 30 // default to 30 minutes
}

const DEFAULT_TIMEOUT_MINUTES = getTimeoutMinutes()
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'focus']

export function useInactivityLogout(timeoutMinutes = DEFAULT_TIMEOUT_MINUTES) {
  const { user, logout } = useAuth()
  const timerRef = useRef(null)

  useEffect(() => {
    if (!user) {
      return undefined
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined
    }

    const timeoutMs = Math.max(1, Number(timeoutMinutes) || DEFAULT_TIMEOUT_MINUTES) * 60 * 1000

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const triggerLogout = () => {
      clearTimer()
      logout()
    }

    const resetTimer = () => {
      clearTimer()
      timerRef.current = setTimeout(triggerLogout, timeoutMs)
    }

    const handleActivity = () => {
      resetTimer()
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer()
      } else {
        resetTimer()
      }
    }

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibilityChange)

    resetTimer()

    return () => {
      clearTimer()
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handleActivity))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user, logout, timeoutMinutes])
}



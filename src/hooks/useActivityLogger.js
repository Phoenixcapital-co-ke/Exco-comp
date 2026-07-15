// Auto-track page navigations for monitored users (React Router).
// Bot token stays server-side via POST /api/activity-log.

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { API_URLS } from '../utils/api.js'

/**
 * @param {object|null} user - currently logged-in user (null if not logged in)
 */
export function useActivityLogger(user) {
  const location = useLocation()
  const lastPage = useRef(null)

  useEffect(() => {
    if (!user) return

    const page = location.pathname + (location.search || '')
    if (page === lastPage.current) return
    lastPage.current = page

    sendLog('pageView', {
      page,
      title: typeof document !== 'undefined' ? document.title : '',
    })
  }, [user, location.pathname, location.search])
}

async function sendLog(type, payload) {
  try {
    await fetch(API_URLS.activityLog, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type, ...payload }),
    })
  } catch (err) {
    console.warn('[ActivityLogger] Failed to send log:', err.message)
  }
}

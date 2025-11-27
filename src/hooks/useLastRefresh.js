import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_URLS } from '../utils/api.js'

const NAIROBI_FORMATTER = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi'
})

export function useLastRefresh() {
  const [lastRefresh, setLastRefresh] = useState(null)
  const [error, setError] = useState(null)
  const eventsRef = useRef(null)

  const fetchLastRefresh = useCallback(async () => {
    try {
      const res = await fetch(API_URLS.data.lastRefresh, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load last refresh (${res.status})`)
      const payload = await res.json()
      setLastRefresh(payload?.last_run_time || null)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch last refresh time:', err)
      setError('Unable to load last refresh time.')
    }
  }, [])

  useEffect(() => {
    fetchLastRefresh()
    const es = new EventSource(API_URLS.events, { withCredentials: true })
    eventsRef.current = es
    es.onmessage = (evt) => {
      if (evt?.data === 'data_updated') {
        fetchLastRefresh()
      }
    }
    es.onerror = () => {
      // Ignore errors; browser will retry automatically
    }
    return () => {
      if (eventsRef.current) {
        eventsRef.current.close()
      }
    }
  }, [fetchLastRefresh])

  const formattedLastRefresh = useMemo(() => {
    if (!lastRefresh) return null
    try {
      return NAIROBI_FORMATTER.format(new Date(lastRefresh))
    } catch {
      return lastRefresh
    }
  }, [lastRefresh])

  return {
    lastRefresh,
    formattedLastRefresh,
    error,
    refresh: fetchLastRefresh
  }
}



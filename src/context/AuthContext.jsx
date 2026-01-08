import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { API_URLS } from '../utils/api.js'

const AuthContext = createContext({
  user: null,
  login: () => {},
  logout: () => {},
  refreshUser: () => Promise.resolve(),
  isLoading: true,
})

const CACHE_KEY = 'auth_user_cache'
const CACHE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

const getCachedUser = () => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (!cached) return null
    const { user, timestamp } = JSON.parse(cached)
    const age = Date.now() - timestamp
    if (age > CACHE_EXPIRY_MS) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    return user
  } catch {
    return null
  }
}

const setCachedUser = (user) => {
  try {
    if (user) {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ user, timestamp: Date.now() }))
    } else {
      sessionStorage.removeItem(CACHE_KEY)
    }
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({ children }) {
  // Load from cache immediately for instant initial render
  const cachedUserOnMount = getCachedUser()
  const [user, setUser] = useState(cachedUserOnMount)
  // If we have cached user, don't show loading (instant render)
  const [isLoading, setIsLoading] = useState(!cachedUserOnMount)
  const INACTIVITY_LIMIT_MS = 10 * 60 * 1000 // 10 minutes

  const refreshUser = useCallback(async (showLoading = true) => {
    // Set loading only if explicitly requested
    if (showLoading) {
      setIsLoading(true)
    }
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
    
    try {
      const res = await fetch(API_URLS.auth.me, { 
        credentials: 'include',
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      
      if (res.ok) {
        const data = await res.json()
        const newUser = data.user ?? null
        setUser(newUser)
        setCachedUser(newUser)
      } else if (res.status === 401) {
        setUser(null)
        setCachedUser(null)
      }
    } catch (err) {
      clearTimeout(timeoutId)
      // Only clear user if request wasn't aborted (means network/server error)
      if (err.name !== 'AbortError') {
        // Use functional update to check current state
        setUser((currentUser) => {
          // If we had no user and request failed, clear cache
          if (!currentUser) {
            setCachedUser(null)
            return null
          }
          // If we had cached user and request failed, keep it (might be network issue)
          return currentUser
        })
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // If we have cached user, validate in background (non-blocking)
    // Otherwise, load from server (blocking)
    if (user) {
      // Validate in background (non-blocking, don't show loading)
      refreshUser(false).catch(() => {
        // Silently fail background validation
      })
    } else {
      // No cache, load from server (show loading)
      refreshUser(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  const login = useCallback((userData) => {
    setUser(userData)
    setCachedUser(userData)
    setIsLoading(false)
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch(API_URLS.auth.logout, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore
    } finally {
      setUser(null)
      setCachedUser(null)
      setIsLoading(false)
    }
  }, [])

  // Client-side inactivity logout
  useEffect(() => {
    let timer = null

    const clear = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = () => {
      if (!user) return
      clear()
      timer = setTimeout(async () => {
        await logout()
        // Force navigation to login after logout
        window.location.href = '/auth/signin'
      }, INACTIVITY_LIMIT_MS)
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    const onActivity = () => {
      if (!user) return
      schedule()
    }

    if (user) {
      schedule()
      events.forEach((evt) => window.addEventListener(evt, onActivity))
    }

    return () => {
      clear()
      events.forEach((evt) => window.removeEventListener(evt, onActivity))
    }
  }, [user, logout])

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}


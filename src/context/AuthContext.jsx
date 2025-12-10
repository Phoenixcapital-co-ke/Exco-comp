import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { API_URLS } from '../utils/api.js'

const AuthContext = createContext({
  user: null,
  login: () => {},
  logout: () => {},
  refreshUser: () => Promise.resolve(),
  isLoading: true,
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const INACTIVITY_LIMIT_MS = 10 * 60 * 1000 // 10 minutes

  const refreshUser = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(API_URLS.auth.me, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user ?? null)
      } else if (res.status === 401) {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  const login = (userData) => {
    setUser(userData)
    setIsLoading(false)
  }

  const logout = async () => {
    try {
      await fetch(API_URLS.auth.logout, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore
    } finally {
      setUser(null)
      setIsLoading(false)
    }
  }

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


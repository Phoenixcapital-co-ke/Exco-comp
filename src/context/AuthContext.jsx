import React, { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem('authUser')
    if (!stored) return null
    try {
      return JSON.parse(stored)
    } catch {
      return null
    }
  })

  const login = (userData) => {
    setUser(userData)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('authUser', JSON.stringify(userData))
    }
  }

  const logout = () => {
    setUser(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('authUser')
    }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}


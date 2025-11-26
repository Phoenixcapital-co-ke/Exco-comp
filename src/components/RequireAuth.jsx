import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const ROLE_DEFAULT_ROUTE = {
  admin: '/logbook/dashboard',
  manager: '/logbook/dashboard',
  logbook: '/logbook/dashboard',
  zidisha: '/zidisha/dashboard',
  advans: '/advans/dashboard',
}

function RequireAuth({ children, allowedRoles }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Checking session...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length) {
    const normalizedUserRole = String(user.role || '').toLowerCase()
    const normalizedAllowed = allowedRoles.map((role) => role.toLowerCase())
    const isAdmin = normalizedUserRole === 'admin'
    const hasAccess = isAdmin || normalizedAllowed.includes(normalizedUserRole)

    if (!hasAccess) {
      const fallback = ROLE_DEFAULT_ROUTE[normalizedUserRole] || ROLE_DEFAULT_ROUTE.admin
      return <Navigate to={fallback} replace />
    }
  }

  return children
}

export default RequireAuth


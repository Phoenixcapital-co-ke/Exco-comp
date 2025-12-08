import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const ROLE_DEFAULT_ROUTE = {
  admin: '/logbook/dashboard',
  manager: '/logbook/dashboard',
  logbook: '/logbook/dashboard',
  zidisha: '/zidisha/dashboard',
  advans: '/advans/dashboard',
  custom: '/login', // Custom users will be redirected to their first allowed page
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

    const normalizedUserRole = String(user.role || '').toLowerCase()
  const isAdmin = normalizedUserRole === 'admin'
  const isCustom = normalizedUserRole === 'custom'

  // Check page-level permissions for custom role users
  if (isCustom) {
    const allowedPages = Array.isArray(user.allowedPages) ? user.allowedPages : []
    const currentPath = location.pathname
    const hasPageAccess = allowedPages.includes(currentPath)
    
    if (!hasPageAccess) {
      // Redirect to first allowed page, or login if no pages
      if (allowedPages.length > 0) {
        return <Navigate to={allowedPages[0]} replace />
      }
      return <Navigate to="/login" replace />
    }
  }

  // Check role-based access for non-custom roles
  if (Array.isArray(allowedRoles) && allowedRoles.length && !isCustom) {
    const normalizedAllowed = allowedRoles.map((role) => role.toLowerCase())
    const hasAccess = isAdmin || normalizedAllowed.includes(normalizedUserRole)

    if (!hasAccess) {
      const fallback = ROLE_DEFAULT_ROUTE[normalizedUserRole] || ROLE_DEFAULT_ROUTE.admin
      return <Navigate to={fallback} replace />
    }
  }

  return children
}

export default RequireAuth


import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const ROLE_DEFAULT_ROUTE = {
  superuser: '/logbook/kenya/dashboard',
  admin: '/logbook/kenya/dashboard',
  manager: '/logbook/kenya/dashboard',
  logbook: '/logbook/kenya/dashboard',
  zidisha: '/zidisha/dashboard',
  advans: '/advans/dashboard',
  boda: '/boda/dashboard',
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

  if (user.mustChangePassword) {
    if (location.pathname !== '/auth/first-password') {
      return <Navigate to="/auth/first-password" replace />
    }
    return children
  }

  if (location.pathname === '/auth/first-password') {
    const fallback = ROLE_DEFAULT_ROUTE[String(user.role || '').toLowerCase()] || '/logbook/kenya/dashboard'
    return <Navigate to={fallback === '/login' ? '/logbook/kenya/dashboard' : fallback} replace />
  }

    const normalizedUserRole = String(user.role || '').toLowerCase()
  const isSuperuser = normalizedUserRole === 'superuser'
  const isAdmin = normalizedUserRole === 'admin'
  const isCustom = normalizedUserRole === 'custom'

  const hasCustomPageAccess = (path, allowedPages) => {
    if (allowedPages.includes(path)) return true
    const m = String(path || '').match(/^\/logbook\/[^/]+\/([^/]+)$/)
    if (m) {
      const legacy = `/logbook/${m[1]}`
      if (allowedPages.includes(legacy)) return true
    }
    return false
  }

  const toPreferredCustomPath = (path) => {
    // Backward compatibility: old custom pages like /logbook/dashboard
    // should map to the country-scoped default.
    const m = String(path || '').match(/^\/logbook\/([^/]+)$/)
    if (m) {
      return `/logbook/kenya/${m[1]}`
    }
    return path
  }

  // Check page-level permissions for custom role users
  if (isCustom) {
    const allowedPages = Array.isArray(user.allowedPages) ? user.allowedPages : []
    const currentPath = location.pathname
    const hasPageAccess = hasCustomPageAccess(currentPath, allowedPages)
    
    if (!hasPageAccess) {
      // Redirect to first allowed page, or login if no pages
      if (allowedPages.length > 0) {
        return <Navigate to={toPreferredCustomPath(allowedPages[0])} replace />
      }
      return <Navigate to="/login" replace />
    }
  }

  // Check role-based access for non-custom roles
  if (Array.isArray(allowedRoles) && allowedRoles.length && !isCustom) {
    const normalizedAllowed = allowedRoles.map((role) => role.toLowerCase())
    const hasAccess = isSuperuser || isAdmin || normalizedAllowed.includes(normalizedUserRole)

    if (!hasAccess) {
      const fallback = ROLE_DEFAULT_ROUTE[normalizedUserRole] || ROLE_DEFAULT_ROUTE.admin
      return <Navigate to={fallback} replace />
    }
  }

  return children
}

export default RequireAuth


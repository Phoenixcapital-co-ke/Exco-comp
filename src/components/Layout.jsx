import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'
import MaintenanceDownScreen, { DEFAULT_MAINTENANCE_MESSAGE } from './MaintenanceDownScreen.jsx'
import { useBreakpoint } from '../hooks/useBreakpoint.js'
import { useInactivityLogout } from '../hooks/useInactivityLogout.js'
import { API_URLS } from '../utils/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { LogbookCurrencyProvider } from '../context/LogbookCurrencyContext.jsx'

const NO_CHROME_ROUTES = ['/login', '/done', '/auth/signin', '/auth/forgot-password', '/auth/confirm']
const DESKTOP_BREAKPOINT = 1024

function Layout({ children }) {
  const isDesktop = useBreakpoint(DESKTOP_BREAKPOINT)
  const [sidebarOpen, setSidebarOpen] = useState(() => isDesktop)
  const [maintenance, setMaintenance] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState(DEFAULT_MAINTENANCE_MESSAGE)
  const [statusLoading, setStatusLoading] = useState(true)
  const location = useLocation()
  const { user, isLoading } = useAuth()

  useInactivityLogout()

  useEffect(() => {
    setSidebarOpen(isDesktop)
  }, [isDesktop])

  useEffect(() => {
    let cancelled = false
    let intervalId

    const fetchStatus = async () => {
      try {
        const res = await fetch(API_URLS.system.status, { credentials: 'include' })
        if (!res.ok) throw new Error('Failed status')
        const data = await res.json()
        if (!cancelled) {
          setMaintenance(Boolean(data.maintenance))
          if (data.maintenanceMessage) {
            setMaintenanceMessage(String(data.maintenanceMessage))
          }
        }
      } catch {
        if (!cancelled) {
          // On fetch error, assume maintenance is off to avoid locking admins out
          setMaintenance(false)
        }
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    }

    fetchStatus()
    intervalId = setInterval(fetchStatus, 30000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  const normalizedRole = String(user?.role || '').toLowerCase()
  const isSuperuser = normalizedRole === 'superuser'
  const isLoggedIn = !!user
  const isOnSuperuserLoginPage = location.pathname === '/done'
  const isAuthFlowRoute = location.pathname.startsWith('/auth/')
  const isClientPerformanceRoute =
    location.pathname === '/boda/client-performance' || location.pathname === '/zidisha/client-performance'

  // During maintenance: blank white crash screen for everyone except logged-in superusers
  // and visitors on /done (superuser login entry).
  const bypassMaintenance = isSuperuser || (isOnSuperuserLoginPage && !isLoggedIn)
  if (!statusLoading && maintenance && !bypassMaintenance) {
    return <MaintenanceDownScreen message={maintenanceMessage} />
  }

  if (NO_CHROME_ROUTES.includes(location.pathname) || isAuthFlowRoute) {
    return <div className="min-h-screen bg-gray-50">{children}</div>
  }

  // Don't render layout with sidebar if user is not authenticated
  // This prevents the "sidebar but no content" issue
  if (!user && !isLoading) {
    // User is not authenticated - let RequireAuth handle redirect
    return <div className="min-h-screen bg-gray-50">{children}</div>
  }

  // Show loading state while checking auth
  if (isLoading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Checking session...
      </div>
    )
  }

  return (
    <LogbookCurrencyProvider>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
      {!isDesktop && (
        <>
          <div
            className={`fixed inset-0 z-30 bg-gray-900/40 transition-opacity duration-200 ${
              sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setSidebarOpen(false)}
          />
          <div
            className={`fixed inset-y-0 left-0 z-40 flex h-full max-h-[100dvh] w-64 flex-col overflow-hidden transform bg-white shadow-2xl transition-transform duration-300 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar
              isOpen
              onToggle={() => setSidebarOpen(false)}
              onNavigate={() => setSidebarOpen(false)}
              showUserInfo
              fullHeight
            />
          </div>
        </>
      )}

      {isDesktop && (
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onNavigate={() => {}}
          showUserInfo={false}
          fullHeight
        />
      )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <Header onMenuClick={() => setSidebarOpen((prev) => !prev)} />
          <main
            className={`flex-1 overflow-x-hidden ${
              isClientPerformanceRoute ? 'overflow-y-hidden' : 'overflow-y-auto'
            } bg-gray-50 p-4 md:px-5 lg:px-6 lg:py-6 xl:px-8`}
          >
            <div className="mx-auto w-full max-w-[1400px] lg:max-w-none">{children}</div>
          </main>
        </div>
      </div>
    </LogbookCurrencyProvider>
  )
}

export default Layout

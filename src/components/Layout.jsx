import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'
import { useBreakpoint } from '../hooks/useBreakpoint.js'
import { useInactivityLogout } from '../hooks/useInactivityLogout.js'
import { API_URLS } from '../utils/api.js'
import { useAuth } from '../context/AuthContext.jsx'

const NO_CHROME_ROUTES = ['/login', '/done']
const DESKTOP_BREAKPOINT = 1024

function Layout({ children }) {
  const isDesktop = useBreakpoint(DESKTOP_BREAKPOINT)
  const [sidebarOpen, setSidebarOpen] = useState(() => isDesktop)
  const [maintenance, setMaintenance] = useState(false)
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
  const isOnLoginPage = location.pathname === '/login'
  const isOnSuperuserPage = location.pathname === '/done'

  // Show maintenance screen on /login when maintenance is ON (even if not logged in)
  if (!statusLoading && maintenance && isOnLoginPage && !isLoggedIn) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="max-w-xl w-full text-left text-gray-900">
          <div className="mb-6 text-6xl leading-none select-none text-gray-400">:(</div>
          <h1 className="text-2xl font-normal mb-3">This site can’t be reached</h1>
          <p className="text-sm text-gray-700 mb-4">
            <span className="font-mono">localhost</span> refused to connect.
          </p>
          <p className="text-sm text-gray-700 mb-1">Try:</p>
          <ul className="list-disc list-inside text-sm text-gray-700 mb-4 space-y-0.5">
            <li>Checking the connection</li>
            <li>Checking the proxy and the firewall</li>
          </ul>
          <p className="text-xs text-gray-500 font-mono">ERR_CONNECTION_REFUSED</p>
        </div>
      </div>
    )
  }

  // During maintenance, block all logged-in non-superusers with the
  // connection-refused style page. /done route is always accessible for superuser login.
  if (!statusLoading && maintenance && isLoggedIn && !isSuperuser) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="max-w-xl w-full text-left text-gray-900">
          <div className="mb-6 text-6xl leading-none select-none text-gray-400">:(</div>
          <h1 className="text-2xl font-normal mb-3">This site can’t be reached</h1>
          <p className="text-sm text-gray-700 mb-4">
            <span className="font-mono">localhost</span> refused to connect.
          </p>
          <p className="text-sm text-gray-700 mb-1">Try:</p>
          <ul className="list-disc list-inside text-sm text-gray-700 mb-4 space-y-0.5">
            <li>Checking the connection</li>
            <li>Checking the proxy and the firewall</li>
          </ul>
          <p className="text-xs text-gray-500 font-mono">ERR_CONNECTION_REFUSED</p>
        </div>
      </div>
    )
  }

  if (NO_CHROME_ROUTES.includes(location.pathname)) {
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
            className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-white shadow-2xl transition-transform duration-300 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar
              isOpen
              onToggle={() => setSidebarOpen(false)}
              onNavigate={() => setSidebarOpen(false)}
              showUserInfo
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
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen((prev) => !prev)} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-4 md:px-5 lg:px-6 lg:py-6 xl:px-8">
          <div className="mx-auto w-full max-w-[1400px] lg:max-w-none">{children}</div>
        </main>
      </div>
    </div>
  )
}

export default Layout

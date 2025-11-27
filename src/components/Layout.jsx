import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'
import { useBreakpoint } from '../hooks/useBreakpoint.js'

const NO_CHROME_ROUTES = ['/login']
const DESKTOP_BREAKPOINT = 1024

function Layout({ children }) {
  const isDesktop = useBreakpoint(DESKTOP_BREAKPOINT)
  const [sidebarOpen, setSidebarOpen] = useState(() => isDesktop)
  const location = useLocation()

  useEffect(() => {
    setSidebarOpen(isDesktop)
  }, [isDesktop])

  if (NO_CHROME_ROUTES.includes(location.pathname)) {
    return <div className="min-h-screen bg-gray-50">{children}</div>
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
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

export default Layout

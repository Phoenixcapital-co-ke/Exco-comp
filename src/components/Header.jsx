import React from 'react'
import { Menu, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'
import { useLastRefresh } from '../hooks/useLastRefresh.js'
import { useBreakpoint } from '../hooks/useBreakpoint.js'
import { useLogbookCurrency } from '../context/LogbookCurrencyContext.jsx'

const DESKTOP_BREAKPOINT = 1024

function Header({ onMenuClick }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { formattedLastRefresh } = useLastRefresh()
  const isDesktop = useBreakpoint(DESKTOP_BREAKPOINT)
  const { isNonKenyaLogbook, countryName, displayCurrency, setDisplayCurrency } = useLogbookCurrency()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          {isNonKenyaLogbook && (
            <div className="flex items-center space-x-2 mr-2">
              <span className="text-xs text-gray-500 hidden sm:inline">
                Currency ({countryName})
              </span>
              <select
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="LOCAL">Local</option>
                <option value="KES">KES</option>
                <option value="USD">USD</option>
                <option value="UGX">UGX</option>
                <option value="TZS">TZS</option>
                <option value="RWF">RWF</option>
                <option value="BIF">BIF</option>
                <option value="SSP">SSP</option>
                <option value="ETB">ETB</option>
              </select>
            </div>
          )}
          <button
            onClick={onMenuClick}
            className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            aria-label="Toggle navigation"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
            Executive Dashboard
          </h1>
        </div>
        
        <div className="flex items-center space-x-3">
          {user && (
            <>
              {isDesktop && (
                <>
                  <div className="text-right text-sm text-gray-600">
                    <p className="font-semibold text-gray-800">{user.fullName || user.username}</p>
                    <p className="text-xs text-gray-500 uppercase">{user.role}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Last refresh: {formattedLastRefresh || 'Not recorded yet'}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="inline-flex items-center rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                  >
                    <LogOut size={16} className="mr-2" />
                    Logout
                  </button>
                </>
              )}
              {!isDesktop && (
                <p className="text-xs text-gray-500">
                  Last refresh: {formattedLastRefresh || 'Not recorded yet'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header

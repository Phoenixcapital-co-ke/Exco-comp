import React from 'react'
import { Menu, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'

function Header({ onMenuClick }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">
            Phoenix Capital Executive Dashboard
          </h1>
        </div>
        
        <div className="flex items-center space-x-4">
          {user && (
            <>
              <div className="text-sm text-gray-600 text-right">
                <p className="font-semibold text-gray-800">{user.fullName || user.username}</p>
                <p className="text-xs text-gray-500 uppercase">{user.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center px-3 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-100 transition-colors duration-200"
              >
                <LogOut size={16} className="mr-2" />
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header

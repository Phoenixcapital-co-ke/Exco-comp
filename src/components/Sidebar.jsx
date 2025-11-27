import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { 
  ChevronDown, 
  ChevronRight, 
  BookOpen, 
  Users, 
  Building2, 
  Cpu, 
  Shield,
  BarChart3,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Activity,
  LogOut
} from 'lucide-react'
import phoenixLogo from '../assets/phoenix-logo.png'
import { useAuth } from '../context/AuthContext.jsx'

function Sidebar({ isOpen, onToggle, onNavigate, showUserInfo = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [expandedSection, setExpandedSection] = useState('logbook')

  const toggleSection = (section) => {
    setExpandedSection(prev => (prev === section ? null : section))
  }

  const navigationItems = [
    {
      id: 'logbook',
      label: 'Logbook',
      icon: BookOpen,
      items: [
        { path: '/logbook/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/logbook/disbursement', label: 'Disbursement', icon: DollarSign },
        { path: '/logbook/collection', label: 'Collection', icon: TrendingUp },
        { path: '/logbook/par', label: 'PAR', icon: AlertTriangle },
        { path: '/logbook/productivity', label: 'Productivity', icon: Activity },
        { path: '/logbook/demographics', label: 'Demographics', icon: Users }
      ]
    },
    {
      id: 'zidisha',
      label: 'Zidisha',
      icon: Users,
      items: [
        { path: '/zidisha/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/zidisha/disbursement', label: 'Disbursement', icon: DollarSign },
        { path: '/zidisha/collection', label: 'Collection', icon: TrendingUp },
        { path: '/zidisha/par', label: 'PAR', icon: AlertTriangle },
        { path: '/zidisha/productivity', label: 'Productivity', icon: Activity },
        { path: '/zidisha/demographics', label: 'Demographics', icon: Users }
      ]
    },
    {
      id: 'advans',
      label: 'Advans',
      icon: Building2,
      items: [
        { path: '/advans/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/advans/disbursement', label: 'Disbursement', icon: DollarSign },
        { path: '/advans/collection', label: 'Collection', icon: TrendingUp },
        { path: '/advans/par', label: 'PAR', icon: AlertTriangle },
        { path: '/advans/productivity', label: 'Productivity', icon: Activity }
      ]
    },
    {
      id: 'kajea',
      label: 'Kajea - Tech',
      icon: Cpu,
      items: [
        { path: '/kajea/clients', label: 'Number of Clients', icon: Users }
      ]
    },
    {
      id: 'insurance',
      label: 'Insurance',
      icon: Shield,
      items: [
        { path: '/insurance/dashboard', label: 'Dashboard', icon: BarChart3 }
      ]
    },
    // --- new Data nav ---
    {
      id: 'data',
      label: 'Data',
      icon: BarChart3,
      items: [
        { path: '/data/overview', label: 'Overview', icon: BarChart3 },
        { path: '/data/branches', label: 'Branches', icon: Building2 },
        { path: '/data/users', label: 'Users', icon: Users },
        { path: '/data/loan-officers', label: 'Loan Officers', icon: Users }
      ]
    }
  ]

  const roleKey = String(user?.role || '').toLowerCase()
  const defaultSections = navigationItems.filter((item) => item.id !== 'data').map((item) => item.id)
  const ROLE_SECTIONS = {
    admin: navigationItems.map((item) => item.id),
    manager: navigationItems.filter((item) => item.id !== 'data').map((item) => item.id),
    logbook: ['logbook'],
    zidisha: ['zidisha'],
    advans: ['advans'],
  }
  const allowedSectionIds = ROLE_SECTIONS[roleKey] || defaultSections
  const filteredNavigation = navigationItems.filter((item) => allowedSectionIds.includes(item.id))
  const visibleExpandedSection = filteredNavigation.some((item) => item.id === expandedSection)
    ? expandedSection
    : filteredNavigation[0]?.id ?? null

  if (!isOpen) {
    return (
      <div className="w-16 bg-white shadow-lg border-r border-gray-200 flex flex-col">
        <div className="p-4 flex justify-center">
          <img
            src={phoenixLogo}
            alt="Phoenix Capital"
            className="h-12 w-auto object-contain"
            draggable="false"
          />
        </div>
        <div className="flex-1 py-4">
          {filteredNavigation.map((item) => (
            <div key={item.id} className="px-3 py-2">
              <div className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors duration-200">
                <item.icon size={20} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const handleMobileLogout = () => {
    logout()
    onNavigate?.()
    navigate('/login')
  }

  return (
    <div className="w-64 bg-white shadow-lg border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200 space-y-4">
        <div className="flex justify-center">
          <img
            src={phoenixLogo}
            alt="Phoenix Capital"
            className="h-16 w-auto object-contain"
            draggable="false"
          />
        </div>
        {showUserInfo && user && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center space-y-2">
            <div>
              <p className="text-base font-semibold text-gray-900">{user.fullName || user.username}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">{user.role}</p>
            </div>
            <button
              onClick={handleMobileLogout}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors duration-200"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {filteredNavigation.map((section) => (
          <div key={section.id} className="mb-2">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-200"
            >
              <div className="flex items-center space-x-3">
                <section.icon size={20} />
                <span className="font-medium">{section.label}</span>
              </div>
              {visibleExpandedSection === section.id ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>

            {/* Section Items */}
            {visibleExpandedSection === section.id && (
              <div className="ml-4 space-y-1">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path
                  return (
                <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center space-x-3 px-4 py-2 text-sm rounded-lg transition-colors duration-200 ${
                        isActive
                          ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-500'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                      }`}
                  onClick={() => onNavigate?.()}
                    >
                      <item.icon size={16} />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  )
}

export default Sidebar

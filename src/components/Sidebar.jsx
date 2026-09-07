import React, { useEffect, useState } from 'react'
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
  Car,
  LogOut,
  Target,
  PieChart,
  MapPin,
  Calendar,
  FileText,
  Search,
  Gauge,
  BadgeDollarSign,
  CalendarCheck,
  GraduationCap,
  RefreshCw,
  WalletCards,
  CreditCard
} from 'lucide-react'
import phoenixLogo from '../assets/phoenix-logo.png'
import { useAuth } from '../context/AuthContext.jsx'
import { API_URLS } from '../utils/api.js'

function Sidebar({ isOpen, onToggle, onNavigate, showUserInfo = false, fullHeight = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [expandedSection, setExpandedSection] = useState('logbook')
  const [expandedSubSection, setExpandedSubSection] = useState(null)
  const [logbookCountries, setLogbookCountries] = useState([])

  const hasCustomPageAccess = (path, allowedPages) => {
    const p = String(path || '')
    if (allowedPages.includes(p)) return true
    const m = p.match(/^\/logbook\/[^/]+\/([^/]+)$/)
    if (m) {
      const legacy = `/logbook/${m[1]}`
      if (allowedPages.includes(legacy)) return true
    }
    return false
  }

  const toggleSection = (section) => {
    setExpandedSection(prev => (prev === section ? null : section))
    // Reset sub-section when collapsing parent
    if (expandedSection === section) {
      setExpandedSubSection(null)
    }
  }

  const toggleSubSection = (subSection) => {
    setExpandedSubSection(prev => (prev === subSection ? null : subSection))
  }

  useEffect(() => {
    const loadCountries = async () => {
      try {
        const res = await fetch(API_URLS.branches.list, { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        const countries = new Set()
        for (const row of Array.isArray(data) ? data : []) {
          const c = (row.country || 'Kenya').trim()
          if (c) countries.add(c)
        }
        setLogbookCountries(Array.from(countries).sort())
      } catch {
        // Ignore errors; sidebar falls back to default Logbook section
        setLogbookCountries([])
      }
    }
    loadCountries()
  }, [])

  const baseNavigationItems = [
    {
      id: 'zidisha',
      label: 'Zidisha',
      icon: Users,
      items: [
        { path: '/zidisha/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/zidisha/disbursement', label: 'Disbursement', icon: DollarSign },
        { path: '/zidisha/collection', label: 'Collection', icon: TrendingUp },
        { path: '/zidisha/client-performance', label: 'Client Performance', icon: Gauge },
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
        { path: '/advans/productivity', label: 'Productivity', icon: Activity }
      ]
    },
    {
      id: 'boda',
      label: 'Boda',
      icon: Building2,
      items: [
        { path: '/boda/dashboard', label: 'Dashboard', icon: BarChart3 },
        { path: '/boda/disbursement', label: 'Disbursement', icon: DollarSign },
        { path: '/boda/collection', label: 'Collection', icon: TrendingUp },
        { path: '/boda/client-performance', label: 'Client Performance', icon: Gauge },
        { path: '/boda/productivity', label: 'Productivity', icon: Activity }
      ]
    },
    {
      id: 'kajea',
      label: 'Kajea - Tech',
      icon: Cpu,
      items: [
        { path: '/kajea/clients', label: 'Number of Clients', icon: Users },
        { path: '/kajea/os-parking-report', label: 'OS-Parking report', icon: Car }
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
    {
      id: 'hr',
      label: 'People Intelligence',
      icon: Users,
      items: [
        { path: '/hr/overview', label: 'Command Centre', icon: BarChart3 },
        { path: '/hr/sales-force', label: 'Sales Force', icon: Target },
        { path: '/hr/collections-quality', label: 'Collections & PAR', icon: Gauge },
        { path: '/hr/productivity', label: 'Productivity', icon: Activity },
        { path: '/hr/attendance-field', label: 'Attendance & Field', icon: CalendarCheck },
        { path: '/hr/compensation', label: 'Compensation', icon: BadgeDollarSign },
        { path: '/hr/retention', label: 'Turnover & Retention', icon: RefreshCw },
        { path: '/hr/training', label: 'Training & Capability', icon: GraduationCap },
        { path: '/hr/branch-performance', label: 'Branch Scorecards', icon: WalletCards }
      ]
    },
    // --- Data nav ---
    {
      id: 'data',
      label: 'Data',
      icon: BarChart3,
      items: [
        { path: '/data/overview', label: 'Overview', icon: BarChart3 },
        { path: '/data/users', label: 'Users', icon: Users },
        { path: '/data/payments', label: 'Payments', icon: CreditCard },
        {
          type: 'subsection',
          id: 'logbook-data',
          label: 'Logbook Data',
          icon: BookOpen,
          items: [
            { path: '/data/logbook/branches', label: 'Branches', icon: Building2 },
            { path: '/data/logbook/loan-officers', label: 'Loan Officers', icon: Users },
            { path: '/data/logbook/targets', label: 'Branch Targets', icon: Target },
            { path: '/data/logbook/sales-targets', label: 'Sales Person Targets', icon: Target },
            { path: '/data/logbook/ro-targets', label: 'RO Targets', icon: Target }
          ]
        },
        {
          type: 'subsection',
          id: 'zidisha-data',
          label: 'Zidisha Data',
          icon: Users,
          items: [
            { path: '/data/zidisha/targets', label: 'Targets', icon: Target }
          ]
        }
      ]
    }
  ]

  const countryLogbookSections = logbookCountries.map((country) => {
    const slug = country.toLowerCase().replace(/\s+/g, '-')
    return {
      id: `logbook-${slug}`,
      label: `Logbook - ${country}`,
      icon: BookOpen,
      items: [
        { path: `/logbook/${slug}/dashboard`, label: 'Dashboard', icon: BarChart3 },
        { path: `/logbook/${slug}/disbursement`, label: 'Disbursement', icon: DollarSign },
        { path: `/logbook/${slug}/collection`, label: 'Collection', icon: TrendingUp },
        { path: `/logbook/${slug}/par`, label: 'PAR', icon: AlertTriangle },
        { path: `/logbook/${slug}/productivity`, label: 'Productivity', icon: Activity },
        { path: `/logbook/${slug}/demographics`, label: 'Demographics', icon: Users }
      ]
    }
  })

  const navigationItems = [...baseNavigationItems, ...countryLogbookSections]

  const roleKey = String(user?.role || '').toLowerCase()
  const isCustom = roleKey === 'custom'
  const allowedPages = Array.isArray(user?.allowedPages) ? user.allowedPages : []
  
  let filteredNavigation = []
  
  if (isCustom) {
    // For custom role, filter based on allowedPages
    filteredNavigation = navigationItems.map(section => {
      const filteredItems = section.items.map(item => {
        if (item.type === 'subsection') {
          // Filter subsection items
          const allowedSubItems = item.items.filter((subItem) => hasCustomPageAccess(subItem.path, allowedPages))
          if (allowedSubItems.length === 0) return null
          return {
            ...item,
            items: allowedSubItems
          }
        } else {
          // Regular item - check if allowed
          return hasCustomPageAccess(item.path, allowedPages) ? item : null
        }
      }).filter(Boolean)
      
      if (filteredItems.length === 0) return null
      return {
        ...section,
        items: filteredItems
      }
    }).filter(Boolean)
  } else {
    // For other roles, use existing role-based filtering
  const defaultSections = navigationItems.filter((item) => item.id !== 'data').map((item) => item.id)
  const ROLE_SECTIONS = {
    superuser: navigationItems.map((item) => item.id),
    admin: navigationItems.map((item) => item.id),
    manager: navigationItems.filter((item) => item.id !== 'data').map((item) => item.id),
    // Logbook role: see all Logbook country sections (ids starting with 'logbook')
    logbook: navigationItems.filter((item) => item.id.startsWith('logbook')).map((item) => item.id),
    zidisha: ['zidisha'],
    advans: ['advans'],
    boda: ['boda'],
  }
  const allowedSectionIds = ROLE_SECTIONS[roleKey] || defaultSections
    // Always include data section for admin/superuser and manager roles only
    if (roleKey === 'admin' || roleKey === 'superuser') {
      allowedSectionIds.push('data')
    } else if (roleKey === 'manager') {
      allowedSectionIds.push('data')
    }
    filteredNavigation = navigationItems.filter((item) => allowedSectionIds.includes(item.id))
  }
  
  const visibleExpandedSection = filteredNavigation.some((item) => item.id === expandedSection)
    ? expandedSection
    : filteredNavigation[0]?.id ?? null

  const heightClass = fullHeight ? 'h-full min-h-0' : ''

  if (!isOpen) {
    return (
      <div className={`w-16 bg-white shadow-lg border-r border-gray-200 flex flex-col ${heightClass}`}>
        <div className="p-4 flex justify-center">
          <img
            src={phoenixLogo}
            alt="Phoenix Capital"
            className="h-12 w-auto object-contain"
            draggable="false"
          />
        </div>
        <div className="flex-1 min-h-0 py-4 overflow-y-auto">
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
    <div className={`w-64 bg-white shadow-lg border-r border-gray-200 flex flex-col ${heightClass}`}>
      {/* Logo */}
      <div className={`flex-shrink-0 border-b border-gray-200 space-y-4 ${showUserInfo ? 'p-4' : 'p-6'}`}>
        <div className="flex justify-center">
          <img
            src={phoenixLogo}
            alt="Phoenix Capital"
            className={`w-auto object-contain ${showUserInfo ? 'h-12' : 'h-16'}`}
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
      <nav className="flex-1 min-h-0 py-4 overflow-y-auto overscroll-contain">
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
                  // Handle nested subsections
                  if (item.type === 'subsection') {
                    const isSubExpanded = expandedSubSection === item.id
                    return (
                      <div key={item.id} className="mb-1">
                        <button
                          onClick={() => toggleSubSection(item.id)}
                          className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-800 rounded-lg transition-colors duration-200"
                        >
                          <div className="flex items-center space-x-3">
                            <item.icon size={16} />
                            <span>{item.label}</span>
                          </div>
                          {isSubExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                        {isSubExpanded && (
                          <div className="ml-6 mt-1 space-y-1">
                            {item.items.map((subItem) => {
                              const isActive = location.pathname === subItem.path
                              return (
                                <Link
                                  key={subItem.path}
                                  to={subItem.path}
                                  className={`flex items-center space-x-3 px-4 py-2 text-sm rounded-lg transition-colors duration-200 ${
                                    isActive
                                      ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-500'
                                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                                  }`}
                                  onClick={() => onNavigate?.()}
                                >
                                  <subItem.icon size={16} />
                                  <span>{subItem.label}</span>
                                </Link>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  }
                  // Regular items
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

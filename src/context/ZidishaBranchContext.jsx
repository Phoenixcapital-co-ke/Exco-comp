import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { API_URLS } from '../utils/api.js'
import { useAuth } from './AuthContext.jsx'

const ZidishaBranchContext = createContext({
  selectedBranch: 'All',
  setSelectedBranch: () => {},
  branchOptions: ['All'],
  isLoading: false,
})

const CLEAN_BRANCH = (name = '') => String(name || '').replace(/\s*branch\s*$/i, '').trim()

export function ZidishaBranchProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'
  const storageKey = `zidisha_selected_branch_${userId}`

  const [allBranches, setAllBranches] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedBranch, setSelectedBranchState] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) || 'All'
    } catch {
      return 'All'
    }
  })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setIsLoading(true)
        const res = await fetch(API_URLS.zidisha.branches, { credentials: 'include' })
        if (!res.ok) throw new Error(`Failed to load branches (${res.status})`)
        const data = await res.json()
        if (cancelled) return
        setAllBranches(Array.isArray(data) ? data : [])
      } catch (e) {
        if (!cancelled) setAllBranches([])
        console.error('[ZidishaBranchProvider] Failed to load branches:', e)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role])

  const allowedBranches = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    const allowed = Array.isArray(user?.allowedZidishaBranches) ? user.allowedZidishaBranches : null
    if (role !== 'custom' || !allowed) return allBranches
    const allowedNorm = new Set(allowed.map((b) => String(b || '').trim().toLowerCase()).filter(Boolean))
    return allBranches.filter((b) => allowedNorm.has(String(b || '').trim().toLowerCase()))
  }, [allBranches, user?.allowedZidishaBranches, user?.role])

  const branchOptions = useMemo(() => {
    const opts = [...allowedBranches]
    const hasMultiple = opts.length > 1
    return hasMultiple ? ['All', ...opts] : (opts.length === 1 ? [opts[0]] : ['All'])
  }, [allowedBranches])

  // Keep selectedBranch valid if permissions/branches change
  useEffect(() => {
    const normalizedOptions = new Set(branchOptions.map((b) => String(b)))
    if (!normalizedOptions.has(String(selectedBranch))) {
      const next = branchOptions.includes('All') ? 'All' : (branchOptions[0] || 'All')
      setSelectedBranchState(next)
      try {
        sessionStorage.setItem(storageKey, next)
      } catch {
        // ignore
      }
    }
  }, [branchOptions, selectedBranch, storageKey])

  const setSelectedBranch = (val) => {
    const next = String(val || 'All')
    setSelectedBranchState(next)
    try {
      sessionStorage.setItem(storageKey, next)
    } catch {
      // ignore
    }
  }

  const value = useMemo(() => {
    return {
      selectedBranch,
      setSelectedBranch,
      branchOptions,
      isLoading,
      cleanBranchLabel: CLEAN_BRANCH,
    }
  }, [selectedBranch, branchOptions, isLoading])

  return <ZidishaBranchContext.Provider value={value}>{children}</ZidishaBranchContext.Provider>
}

export function useZidishaBranch() {
  return useContext(ZidishaBranchContext)
}



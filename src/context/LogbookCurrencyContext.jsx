import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { API_URLS } from '../utils/api.js'
import { formatCurrency } from '../utils/format.js'

const LogbookCurrencyContext = createContext(null)

const localCurrencyByCountrySlug = {
  kenya: 'KES',
  uganda: 'UGX',
  tanzania: 'TZS',
  rwanda: 'RWF',
  burundi: 'BIF',
  'south-sudan': 'SSP',
  ethiopia: 'ETB',
}

function titleCaseSlug(slug) {
  if (!slug) return null
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function computeRateUSD(rates, ccy) {
  if (!rates) return null
  const key = String(ccy || '').toUpperCase()
  const v = rates[key]
  const num = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(num) && num > 0 ? num : null
}

export function LogbookCurrencyProvider({ children }) {
  const location = useLocation()
  const pathname = location.pathname || ''
  const parts = pathname.split('/').filter(Boolean)

  const isCountryLogbook = parts[0] === 'logbook' && parts.length >= 2
  const countrySlug = isCountryLogbook ? parts[1] : null
  const countryName = countrySlug ? titleCaseSlug(countrySlug) : null

  const sourceCurrency = countrySlug ? (localCurrencyByCountrySlug[countrySlug] || 'KES') : 'KES'
  const isNonKenyaLogbook = isCountryLogbook && countrySlug && countrySlug !== 'kenya'

  const [rates, setRates] = useState(null)
  const [ratesFetchedAt, setRatesFetchedAt] = useState(null)
  const [ratesLoading, setRatesLoading] = useState(false)
  const [ratesError, setRatesError] = useState(null)

  const [displayCurrency, setDisplayCurrency] = useState('LOCAL')

  // Load stored display currency per country
  useEffect(() => {
    if (!isCountryLogbook || !countrySlug) return
    const key = `logbook_currency_${countrySlug}`
    const stored = window.localStorage.getItem(key)
    setDisplayCurrency(stored || 'LOCAL')
  }, [isCountryLogbook, countrySlug])

  // Persist display currency per country
  useEffect(() => {
    if (!isCountryLogbook || !countrySlug) return
    const key = `logbook_currency_${countrySlug}`
    window.localStorage.setItem(key, displayCurrency)
  }, [isCountryLogbook, countrySlug, displayCurrency])

  // Fetch FX rates (USD base) and refresh periodically
  useEffect(() => {
    let cancelled = false
    let intervalId

    const load = async () => {
      try {
        setRatesLoading(true)
        setRatesError(null)
        const res = await fetch(API_URLS.fx.rates, { credentials: 'include' })
        if (!res.ok) throw new Error(`Failed to load FX rates (${res.status})`)
        const data = await res.json()
        if (!cancelled) {
          setRates(data?.rates || null)
          setRatesFetchedAt(data?.fetchedAt || null)
        }
      } catch (e) {
        if (!cancelled) setRatesError(e.message)
      } finally {
        if (!cancelled) setRatesLoading(false)
      }
    }

    load()
    intervalId = window.setInterval(load, 60 * 60 * 1000) // hourly refresh
    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [])

  const targetCurrency = useMemo(() => {
    if (!isCountryLogbook) return 'KES'
    if (displayCurrency === 'LOCAL') return sourceCurrency
    return String(displayCurrency || sourceCurrency).toUpperCase()
  }, [displayCurrency, isCountryLogbook, sourceCurrency])

  const convert = useMemo(() => {
    // Convert from sourceCurrency -> targetCurrency using USD cross rates.
    // amount(target) = amount(source) / rateUSD(source) * rateUSD(target)
    return (amount) => {
      const num = Number(amount) || 0
      if (!isCountryLogbook) return num
      if (sourceCurrency === targetCurrency) return num
      const rs = computeRateUSD(rates, sourceCurrency)
      const rt = computeRateUSD(rates, targetCurrency)
      if (!rs || !rt) return num
      return (num / rs) * rt
    }
  }, [rates, isCountryLogbook, sourceCurrency, targetCurrency])

  const formatMoney = useMemo(() => {
    return (amount, opts = {}) => formatCurrency(convert(amount), targetCurrency, opts)
  }, [convert, targetCurrency])

  const value = useMemo(
    () => ({
      isCountryLogbook,
      isNonKenyaLogbook,
      countrySlug,
      countryName,
      sourceCurrency,
      displayCurrency,
      setDisplayCurrency,
      targetCurrency,
      ratesLoading,
      ratesError,
      ratesFetchedAt,
      convert,
      formatMoney,
    }),
    [
      isCountryLogbook,
      isNonKenyaLogbook,
      countrySlug,
      countryName,
      sourceCurrency,
      displayCurrency,
      targetCurrency,
      ratesLoading,
      ratesError,
      ratesFetchedAt,
      convert,
      formatMoney,
    ],
  )

  return <LogbookCurrencyContext.Provider value={value}>{children}</LogbookCurrencyContext.Provider>
}

export function useLogbookCurrency() {
  const ctx = useContext(LogbookCurrencyContext)
  if (!ctx) {
    return {
      isCountryLogbook: false,
      isNonKenyaLogbook: false,
      countrySlug: null,
      countryName: null,
      sourceCurrency: 'KES',
      displayCurrency: 'KES',
      setDisplayCurrency: () => {},
      targetCurrency: 'KES',
      ratesLoading: false,
      ratesError: null,
      ratesFetchedAt: null,
      convert: (n) => Number(n) || 0,
      formatMoney: (n) => formatCurrency(Number(n) || 0, 'KES'),
    }
  }
  return ctx
}


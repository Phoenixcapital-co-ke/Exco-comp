// API configuration - prefer explicit env override, then smart fallback
const envApiBase = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE
const hasWindow = typeof window !== 'undefined'
const hostname = hasWindow ? window.location.hostname : 'localhost'
const origin = hasWindow ? window.location.origin : null
const protocol = hasWindow ? window.location.protocol : 'http:'
const isNgrok = /\bngrok\b/.test(hostname)

function resolveDefaultBase() {
  if (envApiBase) return envApiBase
  if (isNgrok) return 'http://localhost:3001'
  if (hasWindow && protocol === 'https:') {
    // When served via HTTPS (Cloudflare Tunnel, production), reuse same origin to avoid mixed content
    return origin
  }
  return `http://${hostname}:3001`
}

export const API_BASE = resolveDefaultBase()

export const API_URLS = {
  logbook: {
    disbursements: `${API_BASE}/api/logbook/disbursements`,
    collections: `${API_BASE}/api/logbook/collections`,
    borrowers: `${API_BASE}/api/logbook/borrowers`,
    branches: `${API_BASE}/api/logbook/branches`,
  },
  zidisha: {
    data: `${API_BASE}/api/zidisha/data`,
    branches: `${API_BASE}/api/zidisha/branches`,
  },
  boda: {
    repayments: `${API_BASE}/api/boda/repayments`,
    repaymentsAll: `${API_BASE}/api/boda/repayments/all`,
    repaymentsDaily: `${API_BASE}/api/boda/repayments/daily`,
  },
  events: `${API_BASE}/api/events`,
  ingest: `${API_BASE}/api/ingest`,
  reports: {
    generate: `${API_BASE}/api/reports/generate`,
  },
  par: {
    history: `${API_BASE}/api/par`,
    fetchPastMissed: `${API_BASE}/api/par/past-missed`,
    fetchOpen: `${API_BASE}/api/par/open`,
    fetchSnapshot: `${API_BASE}/api/par/snapshot`,
    branches: `${API_BASE}/api/par/branches`,
    progress: `${API_BASE}/api/par/progress`,
    borrowerAccess: `${API_BASE}/api/par/borrower-access`,
    lastRun: `${API_BASE}/api/par/last-run`,
  },
  branches: {
    list: `${API_BASE}/api/logbook/branches`,
    upsert: `${API_BASE}/api/logbook/branches`,
    delete: (code) => `${API_BASE}/api/logbook/branches/${encodeURIComponent(code)}`
  },
  auth: {
    login: `${API_BASE}/api/auth/login`,
    logout: `${API_BASE}/api/auth/logout`,
    me: `${API_BASE}/api/auth/me`,
    confirmEmail: `${API_BASE}/api/auth/confirm-email`,
    forgotPassword: `${API_BASE}/api/auth/forgot-password`,
    resetPassword: `${API_BASE}/api/auth/reset-password`,
  },
  users: {
    list: `${API_BASE}/api/users`,
    create: `${API_BASE}/api/users`,
    update: (id) => `${API_BASE}/api/users/${id}`,
    delete: (id) => `${API_BASE}/api/users/${id}`,
  },
  loanOfficers: {
    list: `${API_BASE}/api/loan-officers`,
    create: `${API_BASE}/api/loan-officers`,
    update: (id) => `${API_BASE}/api/loan-officers/${id}`,
    delete: (id) => `${API_BASE}/api/loan-officers/${id}`,
  },
  targets: {
    logbook: {
      list: `${API_BASE}/api/targets/logbook`,
      create: `${API_BASE}/api/targets/logbook`,
      update: (id) => `${API_BASE}/api/targets/logbook/${id}`,
      delete: (id) => `${API_BASE}/api/targets/logbook/${id}`,
    },
    zidisha: {
      list: `${API_BASE}/api/targets/zidisha`,
      create: `${API_BASE}/api/targets/zidisha`,
      update: (id) => `${API_BASE}/api/targets/zidisha/${id}`,
      delete: (id) => `${API_BASE}/api/targets/zidisha/${id}`,
    }
  },
  data: {
    lastRefresh: `${API_BASE}/api/data/last-refresh`,
  },
  pages: {
    list: `${API_BASE}/api/pages`,
  },
  system: {
    status: `${API_BASE}/api/system/status`,
    maintenance: `${API_BASE}/api/system/maintenance`,
  },
  kajea: {
    stats: `${API_BASE}/api/kajea/stats`,
    clients: `${API_BASE}/api/kajea/clients`,
  },
  hr: {
    employees: `${API_BASE}/api/hr/employees`,
  },
}


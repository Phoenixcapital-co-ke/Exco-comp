// API configuration - prefer explicit env override, then smart fallback
const envApiBase = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE
const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const isNgrok = /\bngrok\b/.test(hostname)
export const API_BASE = envApiBase
  ? envApiBase
  : (isNgrok ? 'http://localhost:3001' : `http://${hostname}:3001`)

export const API_URLS = {
  logbook: {
    disbursements: `${API_BASE}/api/logbook/disbursements`,
    collections: `${API_BASE}/api/logbook/collections`,
  },
  zidisha: {
    data: `${API_BASE}/api/zidisha/data`,
  },
  events: `${API_BASE}/api/events`,
  ingest: `${API_BASE}/api/ingest`,
  par: {
    history: `${API_BASE}/api/par`,
    fetchPastMissed: `${API_BASE}/api/par/past-missed`,
    fetchOpen: `${API_BASE}/api/par/open`,
    fetchSnapshot: `${API_BASE}/api/par/snapshot`,
    branches: `${API_BASE}/api/par/branches`,
    progress: `${API_BASE}/api/par/progress`,
    borrowerAccess: `${API_BASE}/api/par/borrower-access`,
  },
  branches: {
    list: `${API_BASE}/api/logbook/branches`,
    upsert: `${API_BASE}/api/logbook/branches`,
    delete: (code) => `${API_BASE}/api/logbook/branches/${encodeURIComponent(code)}`
  },
  auth: {
    login: `${API_BASE}/api/auth/login`,
  },
  users: {
    list: `${API_BASE}/api/users`,
    create: `${API_BASE}/api/users`,
    update: (id) => `${API_BASE}/api/users/${id}`,
    delete: (id) => `${API_BASE}/api/users/${id}`,
  }
}


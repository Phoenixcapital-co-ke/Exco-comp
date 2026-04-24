import React, { useEffect, useMemo, useState } from 'react'
import { API_URLS } from '../../utils/api.js'
import { formatKES } from '../../utils/format.js'
import { Loader2 } from 'lucide-react'

const BAND_ORDER = ['Gold', 'Silver', 'Bronze', 'At Risk']

function bandBadgeClass(band) {
  if (band === 'Gold') return 'bg-yellow-100 text-yellow-800'
  if (band === 'Silver') return 'bg-gray-200 text-gray-800'
  if (band === 'Bronze') return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

export default function ClientPerformance({ product }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [q, setQ] = useState('')
  const [band, setBand] = useState('')
  const [branch, setBranch] = useState('')
  const [officer, setOfficer] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const url = API_URLS.credit.clientPerformance(product)
        const resp = await fetch(url, { signal: controller.signal, credentials: 'include' })
        const json = await resp.json()
        if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`)
        setData(json)
      } catch (e) {
        if (e.name === 'AbortError') return
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [product])

  const clients = Array.isArray(data?.clients) ? data.clients : []
  const branchNames = Array.isArray(data?.branchNames) ? data.branchNames : []
  const officerNames = Array.isArray(data?.officerNames) ? data.officerNames : []

  const filtered = useMemo(() => {
    const query = String(q || '').trim().toLowerCase()
    return clients.filter((c) => {
      if (band && String(c.band) !== band) return false
      if (branch && String(c.branch) !== branch) return false
      if (officer && String(c.loanOfficer) !== officer) return false
      if (!query) return true
      const hay = [
        c.clientId,
        c.clientName,
        c.phone,
        c.branch,
        c.loanOfficer,
        c.currentLoanId,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(query)
    })
  }, [clients, q, band, branch, officer])

  const k = data?.kpis || {}

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading client performance…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-600 font-medium">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <div className="text-2xl font-semibold text-gray-900">Client Performance</div>
        <div className="text-sm text-gray-500">
          Credit scorecard computed from `zidisha_data` + `boda_repayments`.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Clients</div>
          <div className="text-xl font-semibold">{k.totalClients ?? clients.length}</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Avg score</div>
          <div className="text-xl font-semibold">{Number(k.avgScore || 0).toFixed(1)}</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Outstanding</div>
          <div className="text-xl font-semibold">{formatKES(k.totalOutstanding || 0)}</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">At risk</div>
          <div className="text-xl font-semibold">{k.atRisk || 0}</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Branches</div>
          <div className="text-xl font-semibold">{k.branches || 0}</div>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Officers</div>
          <div className="text-xl font-semibold">{k.officers || 0}</div>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="border rounded-md px-3 py-2 text-sm"
            placeholder="Search client, phone, branch, officer…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="border rounded-md px-3 py-2 text-sm" value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">All bands</option>
            {BAND_ORDER.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select className="border rounded-md px-3 py-2 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {branchNames.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select className="border rounded-md px-3 py-2 text-sm" value={officer} onChange={(e) => setOfficer(e.target.value)}>
            <option value="">All officers</option>
            {officerNames.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-gray-500">
          Showing <span className="font-medium text-gray-700">{filtered.length}</span> of {clients.length} clients.
        </div>

        <div className="overflow-auto border rounded-lg">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-2">Client</th>
                <th className="text-left p-2">Phone</th>
                <th className="text-left p-2">Branch</th>
                <th className="text-left p-2">Officer</th>
                <th className="text-right p-2">Score</th>
                <th className="text-left p-2">Band</th>
                <th className="text-right p-2">Missed 30d</th>
                <th className="text-right p-2">Days since pay</th>
                <th className="text-right p-2">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={`${c.clientId}-${c.currentLoanId}`} className="border-t">
                  <td className="p-2">
                    <div className="font-medium text-gray-900">{c.clientName}</div>
                    <div className="text-xs text-gray-500">{c.clientId}</div>
                  </td>
                  <td className="p-2">{c.phone}</td>
                  <td className="p-2">{c.branch}</td>
                  <td className="p-2">{c.loanOfficer}</td>
                  <td className="p-2 text-right font-medium">{Number(c.score || 0).toFixed(1)}</td>
                  <td className="p-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${bandBadgeClass(c.band)}`}>
                      {c.band}
                    </span>
                  </td>
                  <td className="p-2 text-right">{Number(c.missedLast30 || 0)}</td>
                  <td className="p-2 text-right">{c.daysSinceLastPay == null ? '' : Number(c.daysSinceLastPay)}</td>
                  <td className="p-2 text-right">{formatKES(c.outstandingKes || 0)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={9}>
                    No clients match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


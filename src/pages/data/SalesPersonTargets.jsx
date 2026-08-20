import React, { useEffect, useMemo, useState } from 'react'
import { Target, Plus, Save, X, XCircle, Trash2, Copy } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { formatKES } from '../../utils/format.js'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function SalesPersonTargets() {
  const now = new Date()
  const country = 'Kenya'
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [roster, setRoster] = useState([])
  const [rows, setRows] = useState([]) // { salesPerson, disbursementTarget, active }
  const [savedTargets, setSavedTargets] = useState([])
  const [performance, setPerformance] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [newName, setNewName] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const [personsRes, targetsRes, perfRes] = await Promise.all([
        fetch(`${API_URLS.logbookSalesPersons.list}?country=${encodeURIComponent(country)}`, {
          credentials: 'include',
        }),
        fetch(
          `${API_URLS.targets.logbookSalesPerson.list}?country=${encodeURIComponent(country)}&month=${month}&year=${year}`,
          { credentials: 'include' },
        ),
        fetch(
          `${API_URLS.targets.logbookSalesPerson.performance}?country=${encodeURIComponent(country)}&month=${month}&year=${year}`,
          { credentials: 'include' },
        ),
      ])
      if (!personsRes.ok) throw new Error(`Failed to load sales persons (${personsRes.status})`)
      if (!targetsRes.ok) throw new Error(`Failed to load targets (${targetsRes.status})`)
      const personsData = await personsRes.json()
      const targetsData = await targetsRes.json()
      const perfData = perfRes.ok ? await perfRes.json() : { rows: [] }

      // Official dropdown list only (active). Inactive / loan-only names stay out unless toggled.
      const activeRoster = Array.isArray(personsData.roster) ? personsData.roster : []
      const inactivePeople = Array.isArray(personsData.inactive)
        ? personsData.inactive
        : Array.isArray(personsData.extras)
          ? personsData.extras
          : []
      setRoster(activeRoster)

      const targetByName = new Map(
        (Array.isArray(targetsData) ? targetsData : []).map((t) => [
          String(t.salesPerson || '').trim().toLowerCase(),
          t,
        ]),
      )

      const buildRow = (p, defaultActive) => {
        const name = String(p.name || '').trim()
        const t = targetByName.get(name.toLowerCase())
        return {
          salesPerson: name,
          disbursementTarget: t ? Number(t.disbursementTarget) || 0 : 0,
          // Official list → active; everyone else → inactive unless already saved otherwise
          active: t ? !!t.active : defaultActive,
          fromLoans: !!p.fromLoans,
          rosterActive: defaultActive,
          id: t?.id || null,
        }
      }

      const editorRows = activeRoster.map((p) => buildRow(p, true))

      if (showInactive) {
        for (const p of inactivePeople) {
          const name = String(p.name || '').trim()
          if (!name) continue
          if (editorRows.some((r) => r.salesPerson.toLowerCase() === name.toLowerCase())) continue
          editorRows.push(buildRow(p, false))
        }
      }

      editorRows.sort((a, b) => {
        if (!!b.rosterActive !== !!a.rosterActive) return a.rosterActive ? -1 : 1
        return a.salesPerson.localeCompare(b.salesPerson, undefined, { sensitivity: 'base' })
      })
      setRows(editorRows)
      setSavedTargets(Array.isArray(targetsData) ? targetsData : [])
      setPerformance(Array.isArray(perfData.rows) ? perfData.rows : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [month, year, showInactive])

  const totals = useMemo(() => {
    const targetSum = rows.reduce((s, r) => s + (Number(r.disbursementTarget) || 0), 0)
    const actualSum = performance.reduce((s, r) => s + (Number(r.actual) || 0), 0)
    return { targetSum, actualSum }
  }, [rows, performance])

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      const res = await fetch(API_URLS.targets.logbookSalesPerson.bulk, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          country,
          month: Number(month),
          year: Number(year),
          items: rows.map((r) => ({
            salesPerson: r.salesPerson,
            disbursementTarget: Number(r.disbursementTarget) || 0,
            active: r.active !== false,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Save failed (${res.status})`)
      }
      const data = await res.json()
      setSuccess(`Saved ${data.saved} sales-person targets for ${MONTHS[month - 1]} ${year}.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCopyFromPreviousMonth = async () => {
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    try {
      setError(null)
      const res = await fetch(
        `${API_URLS.targets.logbookSalesPerson.list}?country=${encodeURIComponent(country)}&month=${prevMonth}&year=${prevYear}`,
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`Failed to load ${MONTHS[prevMonth - 1]} ${prevYear} targets`)
      const prev = await res.json()
      if (!Array.isArray(prev) || !prev.length) {
        setError(`No targets found for ${MONTHS[prevMonth - 1]} ${prevYear}`)
        return
      }
      const byName = new Map(
        prev.map((t) => [String(t.salesPerson || '').trim().toLowerCase(), Number(t.disbursementTarget) || 0]),
      )
      setRows((cur) =>
        cur.map((r) => ({
          ...r,
          disbursementTarget: byName.has(r.salesPerson.toLowerCase())
            ? byName.get(r.salesPerson.toLowerCase())
            : r.disbursementTarget,
        })),
      )
      setSuccess(`Copied amounts from ${MONTHS[prevMonth - 1]} ${prevYear}. Review and Save.`)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleAddPerson = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      setError(null)
      const res = await fetch(API_URLS.logbookSalesPersons.create, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, country }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to add sales person')
      }
      setNewName('')
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDeleteTarget = async (id, name) => {
    if (!id) return
    if (!window.confirm(`Delete ${name} target for ${MONTHS[month - 1]} ${year}?`)) return
    try {
      const res = await fetch(API_URLS.targets.logbookSalesPerson.delete(id), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const perfByName = useMemo(() => {
    const m = new Map()
    for (const p of performance) {
      m.set(String(p.salesPerson || '').trim().toLowerCase(), p)
    }
    return m
  }, [performance])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Target className="text-primary-600" size={32} />
            Sales Person Targets
          </h1>
          <p className="text-gray-600 mt-2">
            Set monthly disbursement targets for Kenya Sales Persons (Loandisk field). Update each month.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyFromPreviousMonth}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50"
          >
            <Copy size={16} />
            Copy previous month
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50"
          >
            <Save size={18} />
            {saving ? 'Saving…' : 'Save month'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <XCircle size={18} />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess(null)} className="text-green-700 hover:text-green-900">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Month</label>
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Year</label>
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-600 pb-2">
          Total target: <span className="font-semibold text-gray-900">{formatKES(totals.targetSum)}</span>
          {' · '}
          Actual MTD: <span className="font-semibold text-gray-900">{formatKES(totals.actualSum)}</span>
          {totals.targetSum > 0 && (
            <>
              {' · '}
              Achieved:{' '}
              <span className="font-semibold text-gray-900">
                {((totals.actualSum / totals.targetSum) * 100).toFixed(1)}%
              </span>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive / other loan names
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-600 mb-1">Add sales person to roster</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Exact Loandisk Sales Person spelling"
            />
          </div>
          <button
            type="button"
            onClick={handleAddPerson}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50"
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {loading ? (
          <div className="text-gray-600 py-8 text-center">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">Sales Person</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">Target</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">Actual</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">Loans</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">Ach %</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-500 uppercase tracking-wider">Active</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {rows.map((r, idx) => {
                  const perf = perfByName.get(r.salesPerson.toLowerCase())
                  const actual = Number(perf?.actual) || 0
                  const loans = Number(perf?.loans) || 0
                  const target = Number(r.disbursementTarget) || 0
                  const ach = target > 0 ? (actual / target) * 100 : null
                  return (
                    <tr key={`${r.salesPerson}-${idx}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {r.salesPerson}
                        {!r.rosterActive && (
                          <span className="ml-2 text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">inactive</span>
                        )}
                        {r.fromLoans && (
                          <span className="ml-2 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">from loans</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="1000"
                          className="w-36 border border-gray-300 rounded px-2 py-1 text-right"
                          value={r.disbursementTarget}
                          onChange={(e) => {
                            const v = e.target.value
                            setRows((cur) => {
                              const next = [...cur]
                              next[idx] = { ...next[idx], disbursementTarget: v === '' ? 0 : Number(v) }
                              return next
                            })
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">{formatKES(actual)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{loans}</td>
                      <td className={`px-3 py-2 text-right font-medium ${ach == null ? 'text-gray-400' : ach >= 100 ? 'text-green-700' : ach >= 70 ? 'text-amber-700' : 'text-red-700'}`}>
                        {ach == null ? '—' : `${ach.toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.active !== false}
                          onChange={(e) => {
                            setRows((cur) => {
                              const next = [...cur]
                              next[idx] = { ...next[idx], active: e.target.checked }
                              return next
                            })
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.id ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteTarget(r.id, r.salesPerson)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Delete this month's target row"
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="text-center text-gray-500 py-8">No Kenya sales persons on the active roster.</div>
            )}
          </div>
        )}
      </div>

      {savedTargets.length > 0 && (
        <p className="text-xs text-gray-500">
          {savedTargets.length} target row(s) already saved for {MONTHS[month - 1]} {year}. Saving again updates them.
        </p>
      )}
    </div>
  )
}

export default SalesPersonTargets

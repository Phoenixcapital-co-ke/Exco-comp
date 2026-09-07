import React, { useEffect, useMemo, useState } from 'react'
import { CreditCard, Plus, Save, X, XCircle, Trash2, Edit2, Mail, AlertTriangle } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'

const emptyDraft = () => ({
  name: '',
  dueDay: '',
  amountDisplay: '',
  amountValue: '',
  currency: 'USD',
  notes: '',
  reminderDaysBefore: 3,
  reminderEmail: 'gregory@phoenixcapital.co.ke',
  active: true,
})

function formatDueLabel(item) {
  if (!item.dueDay) return 'Not set'
  const n = Number(item.dueDay)
  if (n === 1 || n === 21 || n === 31) return `${n}st`
  if (n === 2 || n === 22) return `${n}nd`
  if (n === 3 || n === 23) return `${n}rd`
  return `${n}th`
}

function daysBadge(item) {
  if (item.daysUntilDue == null) {
    return <span className="text-xs text-gray-400">No due day</span>
  }
  if (item.daysUntilDue === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        Due today
      </span>
    )
  }
  if (item.daysUntilDue <= (item.reminderDaysBefore || 3)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
        In {item.daysUntilDue} day{item.daysUntilDue === 1 ? '' : 's'}
      </span>
    )
  }
  return (
    <span className="text-xs text-gray-600">
      In {item.daysUntilDue} day{item.daysUntilDue === 1 ? '' : 's'}
    </span>
  )
}

function Payments() {
  const now = new Date()
  const [items, setItems] = useState([])
  const [asOf, setAsOf] = useState('')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(emptyDraft())
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [includeInactive, setIncludeInactive] = useState(false)

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({
        month: String(month),
        year: String(year),
      })
      if (includeInactive) params.set('includeInactive', '1')
      const res = await fetch(`${API_URLS.payments.list}?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load payments (${res.status})`)
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
      setAsOf(data.asOf || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [includeInactive, month, year])

  const dueSoonCount = useMemo(
    () => items.filter((i) => i.active && i.inReminderWindow && !i.paid).length,
    [items],
  )

  const paidCount = useMemo(() => items.filter((i) => i.paid).length, [items])

  const togglePaid = async (item, paid) => {
    try {
      setTogglingId(item.id)
      setError(null)
      const res = await fetch(API_URLS.payments.monthStatus(item.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month, year, paid }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update paid status')
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? { ...row, paid: !!data.paid, paidAt: data.paidAt || null }
            : row,
        ),
      )
      setSuccess(
        paid
          ? `Marked “${item.name}” paid for ${MONTHS[month - 1]} ${year}`
          : `Cleared paid mark for “${item.name}” (${MONTHS[month - 1]} ${year})`,
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingId(null)
    }
  }

  const resetForm = () => {
    setDraft(emptyDraft())
    setEditId(null)
    setShowForm(false)
    setError(null)
  }

  const openCreate = () => {
    setDraft(emptyDraft())
    setEditId(null)
    setShowForm(true)
    setSuccess(null)
  }

  const openEdit = (item) => {
    setEditId(item.id)
    setDraft({
      name: item.name || '',
      dueDay: item.dueDay == null ? '' : String(item.dueDay),
      amountDisplay: item.amountDisplay || '',
      amountValue: item.amountValue == null ? '' : String(item.amountValue),
      currency: item.currency || 'USD',
      notes: item.notes || '',
      reminderDaysBefore: item.reminderDaysBefore ?? 3,
      reminderEmail: item.reminderEmail || 'gregory@phoenixcapital.co.ke',
      active: !!item.active,
    })
    setShowForm(true)
    setSuccess(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!String(draft.name || '').trim()) {
      setError('Name is required')
      return
    }
    const payload = {
      name: String(draft.name).trim(),
      dueDay: draft.dueDay === '' ? null : Number(draft.dueDay),
      amountDisplay: String(draft.amountDisplay || '').trim(),
      amountValue: draft.amountValue === '' ? null : Number(draft.amountValue),
      currency: String(draft.currency || '').trim(),
      notes: String(draft.notes || '').trim(),
      reminderDaysBefore: Number(draft.reminderDaysBefore) || 3,
      reminderEmail: String(draft.reminderEmail || '').trim() || 'gregory@phoenixcapital.co.ke',
      active: !!draft.active,
    }
    try {
      setSaving(true)
      const url = editId ? API_URLS.payments.update(editId) : API_URLS.payments.create
      const res = await fetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Save failed')
      }
      setSuccess(editId ? 'Payment updated' : 'Payment added')
      resetForm()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete “${item.name}”?`)) return
    try {
      setError(null)
      const res = await fetch(API_URLS.payments.delete(item.id), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      setSuccess('Payment deleted')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const sendReminders = async (force = false) => {
    try {
      setSending(true)
      setError(null)
      setSuccess(null)
      const res = await fetch(API_URLS.payments.sendReminders, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ force }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to send reminders')
      if (data.skipped && data.sent === 0) {
        setSuccess(data.reason || 'No reminders to send')
      } else {
        setSuccess(`Reminder email(s) sent: ${data.sent || 0}`)
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="text-primary-600" size={28} />
            Payments
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Track recurring vendor bills. Reminders go to{' '}
            <span className="font-medium text-gray-800">gregory@phoenixcapital.co.ke</span> each morning
            when a due date is within the reminder window
            {asOf ? ` · as of ${asOf}` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => sendReminders(false)}
            disabled={sending}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Mail size={16} />
            {sending ? 'Sending…' : 'Send due reminders'}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
          >
            <Plus size={16} />
            Add payment
          </button>
        </div>
      </div>

      {dueSoonCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            <strong>{dueSoonCount}</strong> unpaid payment{dueSoonCount === 1 ? '' : 's'} in the reminder window
            (due today or within configured days).
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <XCircle size={16} />
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={resetForm} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white shadow-2xl border border-gray-200 rounded-2xl overflow-hidden">
              <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      {editId ? (
                        <>
                          <Edit2 size={20} className="text-primary-600" />
                          Edit payment
                        </>
                      ) : (
                        <>
                          <Plus size={20} className="text-primary-600" />
                          New payment
                        </>
                      )}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Set the due day, amount, and reminder settings.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    title="Close form"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Service / item <span className="text-red-500">*</span>
                    </label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Due day of month (1–31)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={draft.dueDay}
                      onChange={(e) => setDraft((d) => ({ ...d, dueDay: e.target.value }))}
                      placeholder="e.g. 30"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Amount (display)</label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={draft.amountDisplay}
                      onChange={(e) => setDraft((d) => ({ ...d, amountDisplay: e.target.value }))}
                      placeholder="Varies / $20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Amount value</label>
                      <input
                        type="number"
                        step="any"
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        value={draft.amountValue}
                        onChange={(e) => setDraft((d) => ({ ...d, amountValue: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Currency</label>
                      <input
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        value={draft.currency}
                        onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
                        placeholder="USD"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Remind days before</label>
                    <input
                      type="number"
                      min={0}
                      max={14}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={draft.reminderDaysBefore}
                      onChange={(e) => setDraft((d) => ({ ...d, reminderDaysBefore: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Reminder email</label>
                    <input
                      type="email"
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={draft.reminderEmail}
                      onChange={(e) => setDraft((d) => ({ ...d, reminderEmail: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={draft.notes}
                      onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      checked={!!draft.active}
                      onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                    />
                    Active (included in reminders)
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                  >
                    <Save size={16} />
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-gray-700">
            Tracking month
            <select
              className="ml-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-normal bg-white"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Year
            <input
              type="number"
              min={2020}
              max={2100}
              className="ml-2 w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-normal"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
            />
          </label>
          <span className="text-xs text-gray-500">
            Paid {paidCount}/{items.length} for {MONTHS[month - 1]} {year}
          </span>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">No payments yet. Add one above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase w-24">
                    Paid
                    <div className="font-normal normal-case text-[10px] text-gray-400 mt-0.5">
                      {MONTHS[month - 1].slice(0, 3)} {year}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Service</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Due</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Next due</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Remind</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-gray-50 ${
                      item.paid
                        ? 'bg-emerald-50/50'
                        : item.inReminderWindow
                          ? 'bg-amber-50/40'
                          : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
                        checked={!!item.paid}
                        disabled={togglingId === item.id}
                        title={
                          item.paid
                            ? `Paid${item.paidAt ? ` at ${item.paidAt}` : ''} — uncheck to clear`
                            : `Mark paid for ${MONTHS[month - 1]} ${year}`
                        }
                        onChange={(e) => togglePaid(item, e.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className={`text-sm font-medium ${item.paid ? 'text-emerald-900' : 'text-gray-900'}`}>
                        {item.name}
                      </div>
                      {item.notes ? <div className="text-xs text-gray-500 mt-0.5">{item.notes}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDueLabel(item)}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-700">{item.nextDueDate || '—'}</div>
                      <div className="mt-0.5">{item.paid ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          Paid
                        </span>
                      ) : (
                        daysBadge(item)
                      )}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {item.amountDisplay ||
                        (item.amountValue != null
                          ? `${item.currency ? item.currency + ' ' : ''}${Number(item.amountValue).toLocaleString()}`
                          : '—')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.dueDay ? `${item.reminderDaysBefore}d before` : '—'}
                      <div className="text-xs text-gray-400 truncate max-w-[140px]" title={item.reminderEmail}>
                        {item.reminderEmail}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.active ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-primary-300 text-primary-700 hover:bg-primary-50 text-xs font-semibold mr-1"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Payments

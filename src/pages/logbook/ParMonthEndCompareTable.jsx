import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { API_URLS } from '../../utils/api.js'
import { useLogbookCurrency } from '../../context/LogbookCurrencyContext.jsx'

function parPillClass(rate) {
  const n = Number(rate) || 0
  if (n >= 20) return 'bg-red-100 text-red-800'
  if (n >= 10) return 'bg-amber-100 text-amber-800'
  if (n >= 5) return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-800'
}

function ParPill({ rate }) {
  const n = Number(rate) || 0
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold min-w-[52px] text-center ${parPillClass(n)}`}>
      {n.toFixed(1)}%
    </span>
  )
}

function shortBranchLabel(name) {
  return String(name || '')
    .replace(/\s+Branch$/i, '')
    .trim()
}

export default function ParMonthEndCompareTable({ country }) {
  const { formatMoney } = useLogbookCurrency()
  const formatCompact = useCallback(
    (v) => formatMoney(v, { notation: 'compact', maximumFractionDigits: 1 }),
    [formatMoney],
  )

  const [monthEndCompare, setMonthEndCompare] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadMonthEndCompare = useCallback(async () => {
    try {
      setLoading(true)
      const base = API_URLS.par.branchesMonthEndCompare
      const url = country ? `${base}?country=${encodeURIComponent(country)}` : base
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load month-end compare: ${res.status}`)
      setMonthEndCompare(await res.json())
    } catch (e) {
      console.error('Error loading month-end PAR compare:', e)
      setMonthEndCompare(null)
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => {
    loadMonthEndCompare()
  }, [loadMonthEndCompare])

  const monthLabel =
    monthEndCompare?.previous?.monthLabel ||
    monthEndCompare?.previous?.label ||
    'Previous month'

  const performanceMonthLabel =
    monthEndCompare?.performance?.monthLabel || 'This month'

  const totals = useMemo(() => {
    const rows = monthEndCompare?.branches || []
    if (!rows.length) return null
    const t = rows.reduce(
      (acc, row) => {
        const o = row.opening || {}
        const a = row.actual || {}
        acc.openingLoanbook += Number(o.loanbook) || 0
        acc.openingPar += Number(o.par) || 0
        acc.collectedFromPar += Number(a.collectedFromPar) || 0
        acc.closingPar += Number(a.closingPar) || 0
        acc.netParMovement += Number(a.netParMovement) || 0
        return acc
      },
      {
        openingLoanbook: 0,
        openingPar: 0,
        collectedFromPar: 0,
        closingPar: 0,
        netParMovement: 0,
      },
    )
    t.openingParPct = t.openingLoanbook > 0 ? (t.openingPar / t.openingLoanbook) * 100 : 0
    return t
  }, [monthEndCompare])

  return (
    <div className="bg-white rounded-[10px] shadow-sm border border-gray-200 overflow-hidden min-w-0">
      <div className="px-4 sm:px-[18px] py-3.5 border-b border-gray-100 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-gray-900">PAR by Branch — Month-end vs Now</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Opening position from {monthLabel}
            {monthEndCompare?.previous?.asOfLabel ? ` (${monthEndCompare.previous.asOfLabel} EAT)` : ''}
            {' · '}
            MTD collections from opening PAR for {performanceMonthLabel}
            {monthEndCompare?.current?.asOfLabel ? ` · Closing as of ${monthEndCompare.current.asOfLabel} EAT` : ''}
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 border border-slate-200/80">
            Opening · {monthLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-50 text-sky-900 border border-sky-200/80">
            Actual · {performanceMonthLabel}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="animate-spin text-gray-400" />
          </div>
        ) : (
          <table className="w-full min-w-[880px] text-[11px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 bg-gray-50 px-3 py-2.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide border-b border-r border-gray-200 min-w-[130px]"
                >
                  Branch
                </th>
                <th
                  colSpan={3}
                  className="px-2 py-2 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wide bg-slate-100 border-b border-r border-gray-200"
                >
                  Opening Position
                  <span className="block normal-case font-medium text-[9px] text-slate-500 tracking-normal mt-0.5">
                    {monthLabel} month-end
                  </span>
                </th>
                <th
                  colSpan={3}
                  className="px-2 py-2 text-center text-[10px] font-bold text-sky-900 uppercase tracking-wide bg-sky-50 border-b border-gray-200"
                >
                  Actual Performance — This Month
                  <span className="block normal-case font-medium text-[9px] text-sky-700/80 tracking-normal mt-0.5">
                    {performanceMonthLabel} MTD · closing from latest snapshot
                  </span>
                </th>
              </tr>
              <tr className="bg-gray-50">
                {[
                  { label: 'Opening Loanbook', tone: 'emerald' },
                  { label: 'Opening PAR', tone: 'rose' },
                  { label: 'Opening PAR %', tone: 'slate', border: true },
                ].map((c) => (
                  <th
                    key={`o-${c.label}`}
                    className={`px-1.5 py-1.5 text-right text-[9px] font-bold uppercase tracking-wide whitespace-nowrap border-b border-gray-200 ${
                      c.border ? 'border-r' : ''
                    } ${
                      c.tone === 'emerald'
                        ? 'text-emerald-700'
                        : c.tone === 'rose'
                          ? 'text-rose-700'
                          : 'text-slate-600'
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
                {[
                  { label: 'Actual Collected (From PAR)', tone: 'sky' },
                  { label: 'Closing PAR', tone: 'rose' },
                  { label: 'Net PAR Movement', tone: 'slate' },
                ].map((c) => (
                  <th
                    key={`a-${c.label}`}
                    className={`px-1.5 py-1.5 text-right text-[9px] font-bold uppercase tracking-wide whitespace-nowrap border-b border-gray-200 bg-sky-50/60 ${
                      c.tone === 'rose' ? 'text-rose-700' : c.tone === 'sky' ? 'text-sky-800' : 'text-slate-600'
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(monthEndCompare?.branches || []).map((row) => {
                const o = row.opening || {}
                const a = row.actual || {}
                const money = (v, tone = '') => (
                  <td
                    className={`px-1.5 py-2 text-right font-semibold tabular-nums whitespace-nowrap border-b border-gray-100 ${tone}`}
                  >
                    {formatCompact(Number(v) || 0)}
                  </td>
                )
                const signedTone = (v) =>
                  Number(v) > 0 ? 'text-rose-600' : Number(v) < 0 ? 'text-emerald-600' : 'text-gray-400'
                return (
                  <tr key={row.code} className="group hover:bg-amber-50/30">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-amber-50/30 px-3 py-2 border-b border-r border-gray-100 min-w-[130px]">
                      <p className="font-semibold text-gray-900 leading-tight">{shortBranchLabel(row.name)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">#{row.code}</p>
                    </td>
                    {money(o.loanbook, 'text-emerald-800')}
                    {money(o.par, Number(o.par) > 0 ? 'text-rose-700' : 'text-gray-400')}
                    <td className="px-1.5 py-2 text-right border-b border-r border-gray-100">
                      <ParPill rate={o.parPct} />
                    </td>
                    {money(a.collectedFromPar, 'bg-sky-50/25 text-sky-900')}
                    {money(a.closingPar, `bg-sky-50/25 ${Number(a.closingPar) > 0 ? 'text-rose-700' : 'text-gray-400'}`)}
                    <td className={`px-1.5 py-2 text-right font-bold tabular-nums whitespace-nowrap border-b border-gray-100 bg-sky-50/25 ${signedTone(a.netParMovement)}`}>
                      {Number(a.netParMovement) > 0 ? '+' : ''}
                      {formatCompact(Number(a.netParMovement) || 0)}
                    </td>
                  </tr>
                )
              })}
              {totals ? (
                <tr className="bg-slate-50">
                  <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 border-t-2 border-r border-slate-200 font-bold text-slate-800 uppercase text-[10px] tracking-wide">
                    Total
                  </td>
                  <td className="px-1.5 py-2.5 text-right font-bold tabular-nums border-t-2 border-slate-200 text-slate-800">
                    {formatCompact(totals.openingLoanbook)}
                  </td>
                  <td className="px-1.5 py-2.5 text-right font-bold tabular-nums border-t-2 border-slate-200 text-slate-800">
                    {formatCompact(totals.openingPar)}
                  </td>
                  <td className="px-1.5 py-2.5 text-right border-t-2 border-r border-slate-200">
                    <ParPill rate={totals.openingParPct} />
                  </td>
                  <td className="px-1.5 py-2.5 text-right font-bold tabular-nums border-t-2 border-slate-200 bg-sky-50/40 text-slate-800">
                    {formatCompact(totals.collectedFromPar)}
                  </td>
                  <td className="px-1.5 py-2.5 text-right font-bold tabular-nums border-t-2 border-slate-200 bg-sky-50/40 text-slate-800">
                    {formatCompact(totals.closingPar)}
                  </td>
                  <td className={`px-1.5 py-2.5 text-right font-bold tabular-nums border-t-2 border-slate-200 bg-sky-50/40 ${totals.netParMovement > 0 ? 'text-rose-600' : totals.netParMovement < 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {totals.netParMovement > 0 ? '+' : ''}
                    {formatCompact(totals.netParMovement)}
                  </td>
                </tr>
              ) : null}
              {!(monthEndCompare?.branches || []).length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    No comparable PAR snapshots found for {monthLabel} month-end and now.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

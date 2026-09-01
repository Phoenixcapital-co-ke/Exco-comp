import React, { useState, useEffect } from 'react'
import { DollarSign, Calendar, TrendingUp, Building2, Users } from 'lucide-react'
import { 
  BarChart, 
  Bar, 
  LabelList,
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area 
} from 'recharts'
import LogbookDataProcessor from '../../utils/LogbookDataProcessor.js'
import { formatKES } from '../../utils/format.js'
import { useLogbookCurrency } from '../../context/LogbookCurrencyContext.jsx'
import { API_URLS } from '../../utils/api.js'

function LogbookDisbursement({ country }) {
  const { formatMoney } = useLogbookCurrency()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const nowInit = new Date()
  const [selectedMonth, setSelectedMonth] = useState(nowInit.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(nowInit.getFullYear())
  const [selectedBranch, setSelectedBranch] = useState('All')
  const [targets, setTargets] = useState([])
  const [salesPerf, setSalesPerf] = useState({ rows: [], summary: null, mtdFraction: 0, workingDaysElapsed: 0, workingDaysTotal: 0 })
  const [salesPerfLoading, setSalesPerfLoading] = useState(false)
  useEffect(() => {
    const loadData = async () => {
      try {
        const processor = new LogbookDataProcessor(country)
        await processor.loadDisbursementsData()
        
        const disbursementAnalytics = processor.getDisbursementAnalytics()
        setData({
          ...disbursementAnalytics,
          processor: processor
        })
        setLoading(false)
      } catch (err) {
        setError(err.message)
        setLoading(false)
      }
    }

    loadData()
  }, [country])

  useEffect(() => {
    const loadTargets = async () => {
      try {
        const base = API_URLS.targets.logbook.list
        const url = country ? `${base}?country=${encodeURIComponent(country)}` : base
        const res = await fetch(url, { credentials: 'include' })
        if (res.ok) {
          const t = await res.json()
          setTargets(Array.isArray(t) ? t : [])
        }
      } catch (e) {
        console.error('Failed to load logbook targets', e)
      }
    }
    loadTargets()
  }, [country])

  useEffect(() => {
    if (String(country || '').toLowerCase() !== 'kenya') {
      setSalesPerf({ rows: [], summary: null, mtdFraction: 0, workingDaysElapsed: 0, workingDaysTotal: 0 })
      return
    }
    const loadSalesPerf = async () => {
      try {
        setSalesPerfLoading(true)
        const url = `${API_URLS.targets.logbookSalesPerson.performance}?country=Kenya&month=${selectedMonth}&year=${selectedYear}`
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) throw new Error(`Failed to load sales performance (${res.status})`)
        const json = await res.json()
        setSalesPerf({
          rows: Array.isArray(json.rows) ? json.rows : [],
          summary: json.summary || null,
          mtdFraction: Number(json.mtdFraction) || 0,
          workingDaysElapsed: Number(json.workingDaysElapsed) || 0,
          workingDaysTotal: Number(json.workingDaysTotal) || 0,
        })
      } catch (e) {
        console.error('Failed to load sales person performance', e)
        setSalesPerf({ rows: [], summary: null, mtdFraction: 0, workingDaysElapsed: 0, workingDaysTotal: 0 })
      } finally {
        setSalesPerfLoading(false)
      }
    }
    loadSalesPerf()
  }, [country, selectedMonth, selectedYear])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading disbursement data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-red-600">Error loading data: {error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">No data available</div>
      </div>
    )
  }

  // Compute current month label and total disbursed this month from raw dataset
  const monthLabel = (() => {
    const now = new Date()
    return now.toLocaleString('en-US', { month: 'long' })
  })()

  const totalDisbursedThisMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return 0
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    let sum = 0
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const d = parseDMY(dateStr)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        sum += (amt || 0)
      }
    }
    return sum
  })()

  const numLoansThisMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return 0
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    let count = 0
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const d = parseDMY(dateStr)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        count += 1
      }
    }
    return count
  })()

  const numOfficersThisMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return 0
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    const set = new Set()
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const d = parseDMY(dateStr)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const officer = loan.loan_officer || loan.LoanOfficer
        if (officer) set.add(String(officer))
      }
    }
    return set.size
  })()

  // Daily disbursement trend (current month)
  const dailyDisbTrend = (() => {
    const proc = data.processor
    if (!proc) return []
    const mk = proc.getCurrentMonthKey()
    return proc.getDailyTrendForMonth(mk)
  })()

  // Loans per product for the selected month
  const productData = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return []
    const y = selectedYear
    const m = selectedMonth
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    const agg = {}
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const d = parseDMY(dateStr)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const product = String(loan.product || loan.Product || 'Unknown')
          .replace('Logbook Loan', 'LL')
          .replace('Product', '')
          .trim() || 'Unknown'
        if (!agg[product]) agg[product] = { amount: 0, count: 0 }
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        agg[product].amount += amt || 0
        agg[product].count += 1
      }
    }
    const rows = Object.entries(agg)
      .map(([name, stats]) => ({ name, amount: stats.amount, count: stats.count }))
      .sort((a, b) => b.count - a.count || b.amount - a.amount)
    const totalLoans = rows.reduce((s, r) => s + r.count, 0)
    return rows.map((r) => ({
      ...r,
      share: totalLoans > 0 ? (r.count / totalLoans) * 100 : 0,
    }))
  })()

  // New clients = unique borrower_no whose first-ever disbursement falls in the selected month
  const newClientsThisMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return { current: 0, previous: 0 }
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map((p) => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    const earliestByBorrower = new Map()
    for (const loan of proc.disbursementsData) {
      const bn = String(loan.borrower_no || loan['Borrower#'] || '').trim()
      if (!bn) continue
      const d = parseDMY(loan.disbursed_date || loan['Disbursed Date'] || '')
      if (!d) continue
      const existing = earliestByBorrower.get(bn)
      if (!existing || d < existing) earliestByBorrower.set(bn, d)
    }
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1
    const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear
    let current = 0
    let previous = 0
    for (const d of earliestByBorrower.values()) {
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      if (y === selectedYear && m === selectedMonth) current += 1
      if (y === prevYear && m === prevMonth) previous += 1
    }
    return { current, previous }
  })()

  // Top Loan Officers (legacy; Kenya uses sales-person performance table instead)
  const officerData = (() => {
    if (String(country || '').toLowerCase() === 'kenya') return []
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return []
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    const agg = {}
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const d = parseDMY(dateStr)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const officer = loan.loan_officer || loan.LoanOfficer || 'Unknown'
        if (!agg[officer]) agg[officer] = { amount: 0, count: 0 }
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        agg[officer].amount += (amt || 0)
        agg[officer].count += 1
      }
    }
    return Object.entries(agg)
      .map(([officer, stats]) => ({ name: officer, amount: stats.amount, count: stats.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
  })()

  const salesPerfByCategory = (() => {
    const order = ['PERFORMER', 'AVERAGE PERFORMER', 'BELOW AVERAGE PERFORMER', 'NON PERFORMER']
    const map = new Map(order.map((c) => [c, []]))
    for (const r of salesPerf.rows || []) {
      const cat = r.category || 'NON PERFORMER'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat).push(r)
    }
    return order.map((category) => {
      const items = map.get(category) || []
      const totals = items.reduce(
        (a, r) => {
          a.staff += 1
          a.monthlyTarget += Number(r.monthlyTarget) || 0
          a.mtdTarget += Number(r.mtdTarget) || 0
          a.actual += Number(r.actual) || 0
          return a
        },
        { staff: 0, monthlyTarget: 0, mtdTarget: 0, actual: 0 },
      )
      totals.achievementPct =
        totals.mtdTarget > 0 ? (totals.actual / totals.mtdTarget) * 100 : null
      return { category, items, totals }
    }).filter((g) => g.items.length > 0)
  })()

  // Branch performance from full dataset (selected month/year) with targets
  const branchChartData = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return []
    const y = selectedYear
    const m = selectedMonth
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    const normalizeName = (name) => String(name || '').replace(/\s*branch$/i, '').trim()
    const targetMap = new Map()
    targets
      .filter(t => t.active && Number(t.month) === m && Number(t.year) === y)
      .forEach(t => {
        const key = normalizeName(t.branch)
        targetMap.set(key, {
          disbursementTarget: Number(t.disbursementTarget) || 0,
          workingDays: Number(t.workingDays) || 0,
          holidays: Array.isArray(t.holidays) ? t.holidays : []
        })
      })
    const agg = {}
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const d = parseDMY(dateStr)
      const code = loan.branch || loan.Branch
      if (!d || !code) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        if (!agg[code]) agg[code] = { amount: 0, count: 0 }
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        agg[code].amount += (amt || 0)
        agg[code].count += 1
      }
    }
    const workingDaysElapsed = (month, year, totalWorkingDays, holidays = []) => {
      const today = new Date()
      const isFuture =
        year > today.getFullYear() ||
        (year === today.getFullYear() && month > (today.getMonth() + 1))
      if (isFuture) return 0

      const lastDay = (year === today.getFullYear() && month === (today.getMonth() + 1))
        ? today.getDate()
        : new Date(year, month, 0).getDate()

      const holidaySet = new Set(
        (Array.isArray(holidays) ? holidays : []).map(d => new Date(d).toDateString())
      )

      let count = 0
      for (let day = 1; day <= lastDay; day++) {
        const date = new Date(year, month - 1, day)
        // Sunday = 0; Saturdays are working
        if (date.getDay() === 0) continue
        if (holidaySet.has(date.toDateString())) continue
        count++
      }
      // Guard against malformed totalWorkingDays
      if (totalWorkingDays && totalWorkingDays > 0) {
        return Math.min(count, totalWorkingDays)
      }
      return count
    }

    return Object.entries(agg).map(([code, stats]) => {
      const name = proc.getBranchName ? proc.getBranchName(code) : code
      const key = normalizeName(name)
      const targetInfo = targetMap.get(key) || { disbursementTarget: 0, workingDays: 0, holidays: [] }
      const target = targetInfo.disbursementTarget || 0
      const workingDays = targetInfo.workingDays || 0
      const holidays = targetInfo.holidays || []
      const elapsed = workingDaysElapsed(m, y, workingDays, holidays)
      const mtd = workingDays > 0 ? (target / workingDays) * elapsed : 0
      return {
        name,
      amount: stats.amount,
      count: stats.count,
        target,
        mtd,
        actualPct: target > 0 ? (stats.amount / target) * 100 : null,
      }
    })
  })()

  // Calculate Total Disbursed This Week for Disbursement.jsx
  function getWeekRange(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [monday, sunday];
  }
  function parseDMY(s) {
    if (!s) return null;
    const [dd, mm, yyyy] = String(s).split('/');
    if (!yyyy || !mm || !dd) return null;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  const nowDate = new Date();
  const [thisMon, thisSun] = getWeekRange(nowDate);
  const [prevMon, prevSun] = getWeekRange(new Date(thisMon.getTime() - 7 * 864e5));
  // This week total
  const totalDisbursedThisWeek = (data.processor.disbursementsData || []).reduce((sum, loan) => {
    const d = parseDMY(loan.disbursed_date);
    return d && d >= thisMon && d <= thisSun ? sum + (Number(loan.disbursed) || 0) : sum;
  }, 0);
  // Previous week
  const totalDisbursedPrevWeek = (data.processor.disbursementsData || []).reduce((sum, loan) => {
    const d = parseDMY(loan.disbursed_date);
    return d && d >= prevMon && d <= prevSun ? sum + (Number(loan.disbursed) || 0) : sum;
  }, 0);
  let totalDisbursedWeekChangePct = '+0.0%';
  if (totalDisbursedPrevWeek > 0) {
    const pct = ((totalDisbursedThisWeek - totalDisbursedPrevWeek) / totalDisbursedPrevWeek) * 100;
    totalDisbursedWeekChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // Compute previous month context
  const prevMonth = (() => {
    const now = new Date()
    const m = now.getMonth() + 1
    const y = now.getFullYear()
    if (m === 1) return { pm: 12, py: y - 1 }
    return { pm: m - 1, py: y }
  })()

  // Helpers
  const parseDMYForMonth = (s) => {
    if (!s) return null
    const parts = String(s).split(/[\/\-]/)
    if (parts.length < 3) return null
    const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
    if (!yyyy || !mm || !dd) return null
    return { y: yyyy, m: mm }
  }

  // Previous month totals using DB fields (with legacy fallbacks)
  const totalDisbursedPrevMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return 0
    const { pm, py } = prevMonth
    let sum = 0
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const dm = parseDMYForMonth(dateStr)
      if (!dm) continue
      if (dm.y === py && dm.m === pm) {
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        sum += (amt || 0)
      }
    }
    return sum
  })()

  const numLoansPrevMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return 0
    const { pm, py } = prevMonth
    let count = 0
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const dm = parseDMYForMonth(dateStr)
      if (!dm) continue
      if (dm.y === py && dm.m === pm) count += 1
    }
    return count
  })()

  const numOfficersPrevMonth = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return 0
    const { pm, py } = prevMonth
    const set = new Set()
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const dm = parseDMYForMonth(dateStr)
      if (!dm) continue
      if (dm.y === py && dm.m === pm) {
        const officer = loan.loan_officer || loan.LoanOfficer
        if (officer) set.add(String(officer))
      }
    }
    return set.size
  })()

  // MoM change strings
  const pctStr = (cur, prev) => {
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    }
    return '+0.0%'
  }
  const totalDisbursedMonthChangePct = pctStr(totalDisbursedThisMonth, totalDisbursedPrevMonth)
  const numLoansMonthChangePct2 = pctStr(numLoansThisMonth, numLoansPrevMonth)
  const numOfficersMonthChangePct = pctStr(numOfficersThisMonth, numOfficersPrevMonth)
  const newClientsMonthChangePct = pctStr(newClientsThisMonth.current, newClientsThisMonth.previous)

  // Utility to colorize change
  const changeColor = (s) => (s.startsWith('-') ? 'text-red-700' : 'text-green-700')

  // Compute average loan for current and previous month
  const avgLoanThisMonth = numLoansThisMonth > 0 ? (totalDisbursedThisMonth / numLoansThisMonth) : 0
  const avgLoanPrevMonth = numLoansPrevMonth > 0 ? (totalDisbursedPrevMonth / numLoansPrevMonth) : 0
  const avgLoanChangePct = (() => {
    if (avgLoanPrevMonth > 0) {
      const pct = ((avgLoanThisMonth - avgLoanPrevMonth) / avgLoanPrevMonth) * 100
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    }
    return '+0.0%'
  })()

  // Helper for today
  const today = new Date()
  const todayDay = today.getDate(), todayMonth = today.getMonth() + 1, todayYear = today.getFullYear()
  // Yesterday
  const yesterday = new Date(todayYear, todayMonth - 1, todayDay - 1)
  const yDay = yesterday.getDate(), yMonth = yesterday.getMonth() + 1, yYear = yesterday.getFullYear()

  // Disbursements Today (unique loan count for today)
  const disbursementsToday = (() => {
    const proc = data.processor;
    if (!proc || !proc.disbursementsData) return 0;
    let count = 0;
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || '';
      const [dd, mm, yyyy] = String(dateStr).split('/');
      if (yyyy && mm && dd && Number(yyyy) === todayYear && Number(mm) === todayMonth && Number(dd) === todayDay) {
        count += 1;
      }
    }
    return count;
  })();
  // Disbursements Yesterday (count)
  const disbursementsYesterday = (() => {
    const proc = data.processor;
    if (!proc || !proc.disbursementsData) return 0;
    let count = 0;
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || '';
      const [dd, mm, yyyy] = String(dateStr).split('/');
      if (yyyy && mm && dd && Number(yyyy) === yYear && Number(mm) === yMonth && Number(dd) === yDay) {
        count += 1;
      }
    }
    return count;
  })();

  // Total Disbursed Today (sum of amounts for today's date)
  const totalDisbursedToday = (() => {
    const proc = data.processor;
    if (!proc || !proc.disbursementsData) return 0;
    let sum = 0;
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || '';
      const [dd, mm, yyyy] = String(dateStr).split('/');
      if (yyyy && mm && dd && Number(yyyy) === todayYear && Number(mm) === todayMonth && Number(dd) === todayDay) {
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        sum += (amt || 0);
      }
    }
    return sum;
  })();
  // Total Disbursed Yesterday
  const totalDisbursedYesterday = (() => {
    const proc = data.processor;
    if (!proc || !proc.disbursementsData) return 0;
    let sum = 0;
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || '';
      const [dd, mm, yyyy] = String(dateStr).split('/');
      if (yyyy && mm && dd && Number(yyyy) === yYear && Number(mm) === yMonth && Number(dd) === yDay) {
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        sum += (amt || 0);
      }
    }
    return sum;
  })();

  // Average Loans Per Day (This Month)
  const daysSoFar = todayDay;
  const avgLoansPerDay = daysSoFar > 0 ? (numLoansThisMonth / daysSoFar) : 0;
  // Previous month average loans per day
  const daysInPrevMonth = new Date(prevMonth.py, prevMonth.pm, 0).getDate();
  const avgLoansPerDayPrevMonth = daysInPrevMonth > 0 ? (numLoansPrevMonth / daysInPrevMonth) : 0;

  // Change helpers
  const pctStr2 = (cur, prev) => {
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100;
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }
    return '+0.0%';
  };
  const disbursementsTodayChangePct = pctStr2(disbursementsToday, disbursementsYesterday);
  const totalDisbursedTodayChangePct = pctStr2(totalDisbursedToday, totalDisbursedYesterday);
  const avgLoansPerDayChangePct = pctStr2(avgLoansPerDay, avgLoansPerDayPrevMonth);

  // Branch options from current dataset (mapped names, excluding unknown)
  const branchOptions = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return ['All']
    const set = new Set()
    for (const loan of proc.disbursementsData) {
      const code = loan.branch || loan.Branch
      if (!code) continue
      const name = proc.getBranchName ? proc.getBranchName(code) : String(code)
      if (name && name.toLowerCase() !== 'unknown') set.add(name)
    }
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  })()

  // ----- Daily Disbursement data for this month (DB fields) -----
  const nowForDaily = new Date();
  const yDaily = selectedYear;
  const mDaily = selectedMonth;
  const daysInMonthDaily = new Date(yDaily, mDaily, 0).getDate();
  const overallByDay = Array(daysInMonthDaily + 1).fill(0)
  const branchByDay = Array(daysInMonthDaily + 1).fill(0)
  ;(data.processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
    const [dd, mm, yyyy] = String(dateStr).split('/')
    if (yyyy && mm && Number(yyyy) === yDaily && Number(mm) === mDaily) {
      const day = Number(dd)
      if (day >= 1 && day <= daysInMonthDaily) {
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        overallByDay[day] += amt || 0
        if (selectedBranch !== 'All') {
          const code = loan.branch || loan.Branch
          const name = data.processor.getBranchName ? data.processor.getBranchName(code) : String(code)
          if (name === selectedBranch) branchByDay[day] += amt || 0
        }
      }
    }
  })
  // Build daily target from targets for the month (sum of branch targets, excluding Sundays/branch holidays)
  const targetByDay = Array(daysInMonthDaily + 1).fill(0)
  const targetsForMonth = targets.filter(
    (t) => t.active && Number(t.year) === yDaily && Number(t.month) === mDaily
  )
  for (let day = 1; day <= daysInMonthDaily; day++) {
    const date = new Date(yDaily, mDaily - 1, day)
    if (date.getDay() === 0) continue // Sundays are not working days
    for (const t of targetsForMonth) {
      const workingDays = Number(t.workingDays) || 0
      if (!workingDays) continue
      const holidaySet = new Set(
        (Array.isArray(t.holidays) ? t.holidays : []).map((d) => new Date(d).toDateString())
      )
      if (holidaySet.has(date.toDateString())) continue
      targetByDay[day] += (Number(t.disbursementTarget) || 0) / workingDays
    }
  }

  const dailyDisbursementData = []
  for (let day = 1; day <= daysInMonthDaily; day++) {
    dailyDisbursementData.push({
      day: String(day),
      overall: overallByDay[day],
      branch: branchByDay[day],
      target: targetByDay[day],
    })
  }
  const monthLabelDaily = new Date(selectedYear, selectedMonth - 1, 1).toLocaleString('en-US', { month: 'long' });

  // ----- Branch disbursements for selected month (cards) -----
  const branchMonthCards = (() => {
    const proc = data.processor
    if (!proc || !proc.disbursementsData) return []
    const agg = new Map()
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const [dd, mm, yyyy] = String(dateStr).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) !== selectedYear || Number(mm) !== selectedMonth) continue
      const code = loan.branch || loan.Branch
      if (!code) continue
      const name = proc.getBranchName ? proc.getBranchName(code) : String(code)
      if (!name || name.toLowerCase() === 'unknown') continue
      const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
      agg.set(name, (agg.get(name) || 0) + (amt || 0))
    }
    return Array.from(agg.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
  })()

  // ----- Selected month aggregates (for past-month view) -----
  const isPastMonth = (() => {
    const now = new Date()
    const ny = now.getFullYear()
    const nm = now.getMonth() + 1
    return selectedYear < ny || (selectedYear === ny && selectedMonth < nm)
  })()

  const selectedMonthAgg = (() => {
    const proc = data.processor
    const res = { total: 0, loans: 0, branches: 0, daysIn: new Date(selectedYear, selectedMonth, 0).getDate() }
    if (!proc || !proc.disbursementsData) return res
    const branchSet = new Set()
    for (const loan of proc.disbursementsData) {
      const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
      const [dd, mm, yyyy] = String(dateStr).split('/')
      if (!yyyy || !mm || !dd) continue
      if (Number(yyyy) === selectedYear && Number(mm) === selectedMonth) {
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        res.total += (amt || 0)
        res.loans += 1
        const code = loan.branch || loan.Branch
        if (code) branchSet.add(proc.getBranchName ? proc.getBranchName(code) : String(code))
      }
    }
    res.branches = branchSet.size
    return res
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Logbook Disbursement</h1>
          <p className="text-gray-600 mt-2">Track and manage loan disbursements with real data</p>
        </div>
        <div className="flex items-end space-x-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Month</label>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{new Date(2000, m-1, 1).toLocaleString('en-US', { month: 'long' })}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Year</label>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
              {[selectedYear-1, selectedYear, selectedYear+1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {isPastMonth ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Disbursed</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(selectedMonthAgg.total)}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-50 text-green-600">
                <DollarSign size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Daily Average</p>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(selectedMonthAgg.daysIn > 0 ? (selectedMonthAgg.total / selectedMonthAgg.daysIn) : 0)}</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                <Calendar size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Number of Loans</p>
                <p className="text-2xl font-bold text-gray-900">{selectedMonthAgg.loans}</p>
              </div>
              <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
                <TrendingUp size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">New Clients Onboarded</p>
                <p className="text-2xl font-bold text-gray-900">{newClientsThisMonth.current}</p>
              </div>
              <div className="p-3 rounded-lg bg-teal-50 text-teal-600">
                <Users size={24} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Number of Branches</p>
                <p className="text-2xl font-bold text-gray-900">{selectedMonthAgg.branches}</p>
              </div>
              <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
                <Building2 size={24} />
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Disbursed This Week</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalDisbursedThisWeek)}</p>
              <p className="text-sm mt-1 text-green-800">{totalDisbursedWeekChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{`Total ${monthLabel} Disbursed`}</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalDisbursedThisMonth)}</p>
              <p className={`text-sm mt-1 ${changeColor(totalDisbursedMonthChangePct)}`}>{totalDisbursedMonthChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Loans</p>
              <p className="text-2xl font-bold text-gray-900">{numLoansThisMonth}</p>
              <p className={`text-sm mt-1 ${changeColor(numLoansMonthChangePct2)}`}>{numLoansMonthChangePct2}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Calendar size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Average Loan</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(avgLoanThisMonth)}</p>
              <p className={`text-sm mt-1 ${changeColor(avgLoanChangePct)}`}>{avgLoanChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
        
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Disbursed Today</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(totalDisbursedToday)}</p>
              <p className={`text-sm mt-1 ${changeColor(totalDisbursedTodayChangePct)}`}>{totalDisbursedTodayChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">New Clients Onboarded</p>
              <p className="text-2xl font-bold text-gray-900">{newClientsThisMonth.current}</p>
              <p className={`text-sm mt-1 ${changeColor(newClientsMonthChangePct)}`}>{newClientsMonthChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-teal-50 text-teal-600">
              <Users size={24} />
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Branch Disbursements (Selected Month) — continuous marquee */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Branch Disbursements ({monthLabelDaily})</h3>
        </div>
        {branchMonthCards.length === 0 ? (
          <div className="text-sm text-gray-600">No disbursements for the selected month.</div>
        ) : (
          <div className="overflow-hidden">
            <div
              className="branch-marquee-track flex w-max gap-4"
              style={{ animationDuration: `${Math.max(24, branchMonthCards.length * 5)}s` }}
            >
              {[...branchMonthCards, ...branchMonthCards].map((b, i) => (
                <div
                  key={`${b.name}-${i}`}
                  className="w-64 flex-shrink-0 rounded-lg border border-gray-200 p-4 bg-gradient-to-br from-white to-gray-50"
                >
                  <div className="text-sm text-gray-600">{b.name}</div>
                  <div className="text-xl font-semibold text-gray-900 mt-1">{formatMoney(b.total)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Branch Performance + Daily Disbursement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Branch Performance</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={branchChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null
                  return (
                    <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                      {payload.map((entry, index) => {
                        const labelMap = {
                          'amount': 'Actual',
                          'target': 'EoM Target',
                          'mtd': 'MTD Target'
                        }
                        const label = labelMap[entry.dataKey] || entry.name || 'Actual'
                        return (
                          <div key={index} className="text-sm" style={{ color: entry.color }}>
                            <span className="font-semibold">{label}:</span> {formatMoney(entry.value)}
                          </div>
                        )
                      })}
                    </div>
                  )
                }}
              />
              <Legend />
              <Bar dataKey="target" name="EoM Target" fill="#f59e0b" />
              <Bar dataKey="mtd" name="MTD Target" fill="#10b981" />
              <Bar dataKey="amount" name="Actual" fill="#3b82f6">
                <LabelList
                  dataKey="actualPct"
                  position="top"
                  formatter={(v) => (v == null ? '' : `${v.toFixed(1)}%`)}
                  fill="#111827"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Daily Disbursement ({monthLabelDaily})</h3>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm" value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}>
              {branchOptions.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={dailyDisbursementData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip
                formatter={(v, n) => {
                  if (n === 'overall') return [formatMoney(v), 'Overall']
                  if (n === 'branch') return [formatMoney(v), selectedBranch]
                  if (n === 'target') return [formatMoney(v), 'Daily Target']
                  return [formatMoney(v), n]
                }}
              />
              <Area type="monotone" dataKey="overall" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} name="Overall" />
              {selectedBranch !== 'All' && (
                <Area type="monotone" dataKey="branch" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name={selectedBranch} />
              )}
              <Area type="monotone" dataKey="target" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} name="Daily Target" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sales Person Performance (Kenya) / Top Loan Officers (other) — before Loans by Product */}
      {String(country || '').toLowerCase() === 'kenya' ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Sales Person Performance ({monthLabelDaily} {selectedYear})
              </h3>
            </div>
          </div>
          {salesPerfLoading ? (
            <div className="text-sm text-gray-600 py-8 text-center">Loading sales performance…</div>
          ) : salesPerf.rows.length === 0 ? (
            <div className="text-sm text-gray-600 py-6">
              No sales person targets for this month. Set them under Data → Sales Person Targets.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    <th className="px-3 py-2 border border-gray-200">Performance Category</th>
                    <th className="px-3 py-2 border border-gray-200">Branch</th>
                    <th className="px-3 py-2 border border-gray-200">Name</th>
                    <th className="px-3 py-2 border border-gray-200 text-right">Staff</th>
                    <th className="px-3 py-2 border border-gray-200 text-right">Target Monthly</th>
                    <th className="px-3 py-2 border border-gray-200 text-right">Target MTD</th>
                    <th className="px-3 py-2 border border-gray-200 text-right">MTD Disbursement</th>
                    <th className="px-3 py-2 border border-gray-200 text-right">MTD % Achieved</th>
                  </tr>
                </thead>
                <tbody>
                  {salesPerfByCategory.map((group) => {
                    const catColor =
                      group.category === 'PERFORMER'
                        ? 'bg-green-50 text-green-900'
                        : group.category === 'AVERAGE PERFORMER'
                          ? 'bg-amber-50 text-amber-900'
                          : group.category === 'BELOW AVERAGE PERFORMER'
                            ? 'bg-orange-50 text-orange-900'
                            : 'bg-red-50 text-red-900'
                    return (
                      <React.Fragment key={group.category}>
                        {group.items.map((r, idx) => (
                          <tr key={`${group.category}-${r.salesPerson}`} className="hover:bg-gray-50">
                            <td className={`px-3 py-2 border border-gray-200 font-semibold ${catColor}`}>
                              {idx === 0 ? group.category : ''}
                            </td>
                            <td className="px-3 py-2 border border-gray-200 text-gray-800">{r.branch}</td>
                            <td className="px-3 py-2 border border-gray-200 font-medium text-gray-900">{r.salesPerson}</td>
                            <td className="px-3 py-2 border border-gray-200 text-right">1</td>
                            <td className="px-3 py-2 border border-gray-200 text-right">{formatMoney(r.monthlyTarget)}</td>
                            <td className="px-3 py-2 border border-gray-200 text-right">{formatMoney(r.mtdTarget)}</td>
                            <td className="px-3 py-2 border border-gray-200 text-right">{formatMoney(r.actual)}</td>
                            <td className="px-3 py-2 border border-gray-200 text-right font-semibold">
                              {r.achievementPct == null ? '—' : `${Number(r.achievementPct).toFixed(2)}%`}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-3 py-2 border border-gray-200" colSpan={3}>
                            {group.category} TOTAL
                          </td>
                          <td className="px-3 py-2 border border-gray-200 text-right">{group.totals.staff}</td>
                          <td className="px-3 py-2 border border-gray-200 text-right">{formatMoney(group.totals.monthlyTarget)}</td>
                          <td className="px-3 py-2 border border-gray-200 text-right">{formatMoney(group.totals.mtdTarget)}</td>
                          <td className="px-3 py-2 border border-gray-200 text-right">{formatMoney(group.totals.actual)}</td>
                          <td className="px-3 py-2 border border-gray-200 text-right">
                            {group.totals.achievementPct == null
                              ? '—'
                              : `${group.totals.achievementPct.toFixed(2)}%`}
                          </td>
                        </tr>
                      </React.Fragment>
                    )
                  })}
                  {salesPerf.summary && (
                    <tr className="bg-gray-900 text-white font-bold">
                      <td className="px-3 py-2 border border-gray-700" colSpan={3}>GRAND TOTAL</td>
                      <td className="px-3 py-2 border border-gray-700 text-right">{salesPerf.summary.staff}</td>
                      <td className="px-3 py-2 border border-gray-700 text-right">{formatMoney(salesPerf.summary.monthlyTarget)}</td>
                      <td className="px-3 py-2 border border-gray-700 text-right">{formatMoney(salesPerf.summary.mtdTarget)}</td>
                      <td className="px-3 py-2 border border-gray-700 text-right">{formatMoney(salesPerf.summary.actual)}</td>
                      <td className="px-3 py-2 border border-gray-700 text-right">
                        {salesPerf.summary.achievementPct == null
                          ? '—'
                          : `${Number(salesPerf.summary.achievementPct).toFixed(2)}%`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Loan Officers (This Month)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={officerData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
              <Tooltip formatter={(value) => [formatMoney(value), 'Amount']} />
            <Bar dataKey="amount" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}

      {/* Loans by Product (Selected Month) */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Loans by Product ({monthLabelDaily})</h3>
        {productData.length === 0 ? (
          <div className="text-sm text-gray-600">No loans for the selected month.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Loans</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Share</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {productData.map((row) => (
                    <tr key={row.name} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{row.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{row.count}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{formatMoney(row.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 text-right">{row.share.toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-4 py-3 text-sm text-gray-900">Total</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">
                      {productData.reduce((s, r) => s + r.count, 0)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">
                      {formatMoney(productData.reduce((s, r) => s + r.amount, 0))}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(240, productData.length * 44)}>
              <BarChart data={productData} layout="vertical" margin={{ left: 16, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(v, n) => {
                    if (n === 'count') return [v, 'Loans']
                    if (n === 'amount') return [formatMoney(v), 'Amount']
                    return [v, n]
                  }}
                />
                <Bar dataKey="count" name="Loans" fill="#3b82f6">
                  <LabelList dataKey="count" position="right" fill="#111827" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Recent Disbursements Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Disbursements</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Officer</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(data.processor.disbursementsData || [])
                .filter(loan => {
                  const code = loan.branch || loan.Branch
                  return code && data.processor.branchNames[code]
                })
                .slice(-20)
                .reverse()
                .map((loan, index) => {
                  const code = loan.branch || loan.Branch
                  const client = loan.name || loan.Name || 'Unknown'
                  const product = loan.product || loan.Product || 'Unknown'
                  const amount = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
                  const branchName = data.processor.getBranchName ? data.processor.getBranchName(code) : code
                  const dateStr = loan.disbursed_date || loan['Disbursed Date'] || ''
                  const status = loan.status || loan.Status || 'Unknown'
                  const officer = loan.loan_officer || loan.LoanOfficer || 'Unknown'
                  return (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{client}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{product}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatMoney(amount)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{branchName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{dateStr}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          status === 'Current' 
                            ? 'bg-green-100 text-green-800' 
                            : status === 'Fully Paid'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{officer}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default LogbookDisbursement

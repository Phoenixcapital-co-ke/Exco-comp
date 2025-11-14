import React, { useState, useEffect } from 'react'
import { DollarSign, Calendar, TrendingUp, Building2 } from 'lucide-react'
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell, 
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

function LogbookDisbursement() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const nowInit = new Date()
  const [selectedMonth, setSelectedMonth] = useState(nowInit.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(nowInit.getFullYear())
  const [selectedBranch, setSelectedBranch] = useState('All')

  useEffect(() => {
    const loadData = async () => {
      try {
        const processor = new LogbookDataProcessor()
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
  }, [])

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

  // Prepare product data for current month only
  const productData = (() => {
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
      const d = parseDMY(loan['Disbursed Date'])
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const product = (loan.Product || 'Unknown').replace('Logbook Loan', 'LL').replace('Product', '').trim()
        if (!agg[product]) agg[product] = { amount: 0, count: 0 }
        agg[product].amount += Number(loan.Disbursed || 0)
        agg[product].count += 1
      }
    }
    return Object.entries(agg)
      .map(([name, stats]) => ({ name, amount: stats.amount, count: stats.count }))
      .sort((a, b) => b.amount - a.amount)
  })()

  // Top Loan Officers (current month only) aggregated from dataset
  const officerData = (() => {
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

  // Branch performance from full dataset (current month only)
  const branchChartData = (() => {
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
      const code = loan.branch || loan.Branch
      if (!d || !code) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        if (!agg[code]) agg[code] = { amount: 0, count: 0 }
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        agg[code].amount += (amt || 0)
        agg[code].count += 1
      }
    }
    return Object.entries(agg).map(([code, stats]) => ({
      name: proc.getBranchName ? proc.getBranchName(code) : code,
      amount: stats.amount,
      count: stats.count,
    }))
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

  // Utility to colorize change
  const changeColor = (s) => (s.startsWith('-') ? 'text-red-700' : 'text-green-700')

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

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
  const dailyDisbursementData = []
  for (let day = 1; day <= daysInMonthDaily; day++) {
    dailyDisbursementData.push({ day: String(day), overall: overallByDay[day], branch: branchByDay[day] })
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

  // Prepare status data for current month only
  const statusData = (() => {
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
      const d = parseDMY(loan.disbursed_date || loan['Disbursed Date'])
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const status = (loan.status || loan.Status || 'Unknown').trim()
        if (!agg[status]) agg[status] = { amount: 0, count: 0 }
        const amt = loan.disbursed != null ? Number(loan.disbursed) : Number(loan.Disbursed || 0)
        agg[status].amount += (amt || 0)
        agg[status].count += 1
      }
    }
    return Object.entries(agg)
      .map(([name, stats]) => ({ name, amount: stats.amount, count: stats.count }))
      .sort((a, b) => b.amount - a.amount)
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Disbursed</p>
                <p className="text-2xl font-bold text-gray-900">{formatKES(selectedMonthAgg.total)}</p>
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
                <p className="text-2xl font-bold text-gray-900">{formatKES(selectedMonthAgg.daysIn > 0 ? (selectedMonthAgg.total / selectedMonthAgg.daysIn) : 0)}</p>
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Disbursed This Week</p>
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalDisbursedThisWeek)}</p>
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
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalDisbursedThisMonth)}</p>
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
              <p className="text-2xl font-bold text-gray-900">{formatKES(avgLoanThisMonth)}</p>
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
              <p className="text-2xl font-bold text-gray-900">{formatKES(totalDisbursedToday)}</p>
              <p className={`text-sm mt-1 ${changeColor(totalDisbursedTodayChangePct)}`}>{totalDisbursedTodayChangePct}</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={24} />
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Branch Disbursements (Selected Month) */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Branch Disbursements ({monthLabelDaily})</h3>
        {branchMonthCards.length === 0 ? (
          <div className="text-sm text-gray-600">No disbursements for the selected month.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max">
              {branchMonthCards.map((b) => (
                <div key={b.name} className="w-64 flex-shrink-0 rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-600">{b.name}</div>
                  <div className="text-xl font-semibold text-gray-900 mt-1">{formatKES(b.total)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Daily Disbursement over the Month */}
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
            <Tooltip formatter={(v, n) => [formatKES(v), n === 'overall' ? 'Overall' : selectedBranch]} />
            <Area type="monotone" dataKey="overall" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} name="Overall" />
            {selectedBranch !== 'All' && (
              <Area type="monotone" dataKey="branch" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name={selectedBranch} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Branch Performance (wider on large screens) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Branch Performance</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={branchChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => [formatKES(value), 'Amount']} />
              <Bar dataKey="amount" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution (This Month) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 lg:col-span-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Disbursements by Status (This Month)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="amount"
              >
                {statusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatKES(value), 'Amount']} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Loan Officer Performance */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Loan Officers (This Month)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={officerData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(value) => [formatKES(value), 'Amount']} />
            <Bar dataKey="amount" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatKES(amount)}</td>
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

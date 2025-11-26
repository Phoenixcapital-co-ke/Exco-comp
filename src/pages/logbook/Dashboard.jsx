import React, { useState, useEffect, useRef } from 'react'
import { BarChart3, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'
import { 
  LineChart, 
  Line, 
  AreaChart, 
  Area, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts'
import { formatKES } from '../../utils/format.js'
import LogbookDataProcessor from '../../utils/LogbookDataProcessor.js'
import { API_URLS } from '../../utils/api.js'

function LogbookDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const esRef = useRef()

  // Refactor loadData so it can be called repeatedly
  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const processor = new LogbookDataProcessor()
      await processor.loadDisbursementsData()
      await processor.loadRepaymentsData()
      const dashboardMetrics = processor.getDashboardMetrics()
      const currentMonthKey = processor.getCurrentMonthKey()
      const monthlyDisb = processor.getDisbursementAggregatesForMonth(currentMonthKey)
      const monthlyColl = processor.getCollectionAggregatesForMonth(currentMonthKey)
      const dailyTrend = processor.getDailyTrendForMonth(currentMonthKey)
      setData({
        metrics: dashboardMetrics,
        monthlyDisb,
        monthlyColl,
        dailyTrend,
        processor: processor
      })
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // Setup SSE for live-updated dashboards
    const es = new window.EventSource(API_URLS.events, { withCredentials: true })
    es.onmessage = (e) => {
      if (e.data === 'data_updated') {
        loadData()
      }
    }
    es.onerror = () => {
      es.close()
    }
    esRef.current = es
    return () => {
      if (esRef.current) esRef.current.close()
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600">Loading dashboard data...</div>
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

  const { metrics, monthlyDisb, monthlyColl, dailyTrend, processor } = data;

  // Calculate current year and previous year stats using DB data fields
  const thisYear = new Date().getFullYear();
  
  // Total Disbursed This Year
  const totalDisbursedThisYear = (processor.disbursementsData || []).reduce((sum, loan) => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && Number(yyyy) === thisYear) {
      return sum + (Number(loan.disbursed) || 0);
    }
    return sum;
  }, 0);
  // Total Disbursed Previous Year
  const totalDisbursedPrevYear = (processor.disbursementsData || []).reduce((sum, loan) => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && Number(yyyy) === thisYear - 1) {
      return sum + (Number(loan.disbursed) || 0);
    }
    return sum;
  }, 0);
  let totalDisbursedChangePct = '+0.0%';
  if (totalDisbursedPrevYear > 0) {
    const pct = ((totalDisbursedThisYear - totalDisbursedPrevYear) / totalDisbursedPrevYear) * 100;
    totalDisbursedChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // Unique loan counts for this year and previous year
  const uniqueLoanIdsThisYear = new Set();
  const uniqueLoanIdsPrevYear = new Set();
  (processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (!loan.loan_id) return;
    if (yyyy && Number(yyyy) === thisYear) uniqueLoanIdsThisYear.add(String(loan.loan_id));
    if (yyyy && Number(yyyy) === thisYear - 1) uniqueLoanIdsPrevYear.add(String(loan.loan_id));
  });
  const numLoansThisYear = uniqueLoanIdsThisYear.size;
  const numLoansPrevYear = uniqueLoanIdsPrevYear.size;
  let numLoansChangePct = '+0.0%';
  if (numLoansPrevYear > 0) {
    const pct = ((numLoansThisYear - numLoansPrevYear) / numLoansPrevYear) * 100;
    numLoansChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // Calculate current year/month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  // Total Disbursed This Month
  const totalDisbursedCurrentMonth = (processor.disbursementsData || []).reduce((sum, loan) => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth) {
      return sum + (Number(loan.disbursed) || 0);
    }
    return sum;
  }, 0);

  // Total Disbursed Previous Month
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const totalDisbursedPrevMonth = (processor.disbursementsData || []).reduce((sum, loan) => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === prevMonthYear && Number(mm) === prevMonth) {
      return sum + (Number(loan.disbursed) || 0);
    }
    return sum;
  }, 0);
  let totalDisbursedMonthChangePct = '+0.0%';
  if (totalDisbursedPrevMonth > 0) {
    const pct = ((totalDisbursedCurrentMonth - totalDisbursedPrevMonth) / totalDisbursedPrevMonth) * 100;
    totalDisbursedMonthChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // Prepare chart data
  const productData = (monthlyDisb?.byProduct || []).map(p => ({ name: p.name, value: p.amount }))

  // Rebuild daily trend for the current month (dynamic)
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const disbByDay = Array(daysInMonth + 1).fill(0);
  const collByDay = Array(daysInMonth + 1).fill(0);
  (processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth) {
      const day = Number(dd);
      if (day >= 1 && day <= daysInMonth) {
        disbByDay[day] += Number(loan.disbursed) || 0;
      }
    }
  });
  (processor.repaymentsData || []).forEach(r => {
    const dateStr = r.repayment_collected_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth) {
      const day = Number(dd);
      if (day >= 1 && day <= daysInMonth) {
        collByDay[day] += Number(r.repayment_amount) || 0;
      }
    }
  });
  const dailyTrendData = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dailyTrendData.push({
      day: String(day),
      disbursed: disbByDay[day],
      collected: collByDay[day]
    });
  }

  const collectionData = Object.entries(monthlyColl?.byDay || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([day, amount]) => ({ date: String(day), amount }))

  // Derive month label from currentMonthKey (e.g., 2025-10 -> October)
  const monthLabel = (() => {
    const key = metrics.currentMonthKey
    if (!key) return 'This Month'
    const [y, m] = key.split('-')
    const d = new Date(Number(y), Number(m) - 1, 1)
    return d.toLocaleString('en-US', { month: 'long' })
  })()

  const disbursedMoM = metrics.momDisbursedChangePct
  const loansMoM = metrics.momLoansChangePct
  const disbursedDelta = disbursedMoM == null ? '—' : `${disbursedMoM >= 0 ? '+' : ''}${disbursedMoM.toFixed(1)}%`
  const loansDelta = loansMoM == null ? '—' : `${loansMoM >= 0 ? '+' : ''}${loansMoM.toFixed(1)}%`

  // Calculate total collected for current and previous month
  const totalCollectedCurrentMonth = (processor.repaymentsData || []).reduce((sum, r) => {
    const dateStr = r.repayment_collected_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth) {
      return sum + (Number(r.repayment_amount) || 0);
    }
    return sum;
  }, 0);
  const totalCollectedPrevMonth = (processor.repaymentsData || []).reduce((sum, r) => {
    const dateStr = r.repayment_collected_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === prevMonthYear && Number(mm) === prevMonth) {
      return sum + (Number(r.repayment_amount) || 0);
    }
    return sum;
  }, 0);
  let totalCollectedMonthChangePct = '+0.0%';
  if (totalCollectedPrevMonth > 0) {
    const pct = ((totalCollectedCurrentMonth - totalCollectedPrevMonth) / totalCollectedPrevMonth) * 100;
    totalCollectedMonthChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // Unique loans issued this month
  const uniqueLoanIdsThisMonth = new Set();
  const uniqueLoanIdsPrevMonth = new Set();
  (processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (!loan.loan_id) return;
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth) uniqueLoanIdsThisMonth.add(String(loan.loan_id));
    if (yyyy && mm && Number(yyyy) === prevMonthYear && Number(mm) === prevMonth) uniqueLoanIdsPrevMonth.add(String(loan.loan_id));
  });
  const numLoansThisMonth = uniqueLoanIdsThisMonth.size;
  const numLoansPrevMonth = uniqueLoanIdsPrevMonth.size;
  let numLoansMonthChangePct = '+0.0%';
  if (numLoansPrevMonth > 0) {
    const pct = ((numLoansThisMonth - numLoansPrevMonth) / numLoansPrevMonth) * 100;
    numLoansMonthChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  // Aggregate disbursements by branch (current month)
  const branchAgg = {};
  (processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth) {
      const branchCode = loan.branch || loan.Branch;
      if (!branchCode) return;
      branchAgg[branchCode] = (branchAgg[branchCode] || 0) + (Number(loan.disbursed) || 0);
    }
  });
  const disbByBranchData = Object.entries(branchAgg).map(([code, amount]) => ({
    name: processor.getBranchName ? processor.getBranchName(code) : code,
    value: amount
  }));
  const numActiveBranches = disbByBranchData.length;

  // Prepare data for bar chart: per-branch disbursed and collected for current month
  const branchBars = {};
  (processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    const branchCode = loan.branch || loan.Branch;
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth && branchCode) {
      const name = processor.getBranchName ? processor.getBranchName(branchCode) : branchCode;
      branchBars[name] = branchBars[name] || { branch: name, disbursed: 0, collected: 0 };
      branchBars[name].disbursed += Number(loan.disbursed) || 0;
    }
  });
  (processor.repaymentsData || []).forEach(r => {
    const dateStr = r.repayment_collected_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    const branchCode = r.branch || r.Branch; // Use repayment's branch code field
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth && branchCode) {
      const name = processor.getBranchName ? processor.getBranchName(branchCode) : branchCode;
      branchBars[name] = branchBars[name] || { branch: name, disbursed: 0, collected: 0 };
      branchBars[name].collected += Number(r.repayment_amount) || 0;
    }
  });
  const branchBarData = Object.values(branchBars);

  // Calculate the current week (Monday-Sunday) and previous week
  function getWeekRange(date) {
    // Start of the week (Monday)
    const d = new Date(date)
    const day = d.getDay(); // 0=Sunday, 1=Monday, ...
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [monday, sunday];
  }
  function parseDisbDateDisb(loan) {
    const ds = loan.disbursed_date || '';
    const [dd, mm, yyyy] = ds.split('/');
    if (!yyyy || !mm || !dd) return null;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  const nowDate = new Date();
  const [thisMon, thisSun] = getWeekRange(nowDate);
  const [prevMon, prevSun] = getWeekRange(new Date(thisMon.getTime() - 7 * 864e5));
  // This week total
  const totalDisbursedThisWeek = (processor.disbursementsData || []).reduce((sum, loan) => {
    const d = parseDisbDateDisb(loan);
    return d && d >= thisMon && d <= thisSun ? sum + (Number(loan.disbursed) || 0) : sum;
  }, 0);
  // Previous week
  const totalDisbursedPrevWeek = (processor.disbursementsData || []).reduce((sum, loan) => {
    const d = parseDisbDateDisb(loan);
    return d && d >= prevMon && d <= prevSun ? sum + (Number(loan.disbursed) || 0) : sum;
  }, 0);
  let totalDisbursedWeekChangePct = '+0.0%';
  if (totalDisbursedPrevWeek > 0) {
    const pct = ((totalDisbursedThisWeek - totalDisbursedPrevWeek) / totalDisbursedPrevWeek) * 100;
    totalDisbursedWeekChangePct = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  const stats = [
    {
      title: 'Total Disbursed This Year',
      value: `${formatKES(totalDisbursedThisYear)}`,
      change: totalDisbursedChangePct,
      icon: DollarSign,
      color: 'text-green-600'
    },
    {
      title: `Number of Loans This Month`,
      value: numLoansThisMonth.toLocaleString(),
      change: numLoansMonthChangePct,
      icon: BarChart3,
      color: 'text-blue-600'
    },
    {
      title: `Total ${now.toLocaleString('en-US', { month: 'long' })} Disbursed`,
      value: formatKES(totalDisbursedCurrentMonth),
      change: totalDisbursedMonthChangePct,
      icon: TrendingUp,
      color: 'text-purple-600'
    },
    {
      title: `Total ${now.toLocaleString('en-US', { month: 'long' })} Collected`,
      value: formatKES(totalCollectedCurrentMonth),
      change: totalCollectedMonthChangePct,
      icon: AlertTriangle,
      color: 'text-orange-600'
    }
    // (No weekly card)
  ];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

  // Yearly trend: disbursed vs collected per month
  const yearlyDisb = Array(13).fill(0);
  const yearlyColl = Array(13).fill(0);
  (processor.disbursementsData || []).forEach(loan => {
    const dateStr = loan.disbursed_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear) {
      const month = Number(mm);
      if (month >= 1 && month <= 12) yearlyDisb[month] += Number(loan.disbursed) || 0;
    }
  });
  (processor.repaymentsData || []).forEach(r => {
    const dateStr = r.repayment_collected_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    if (yyyy && mm && Number(yyyy) === currentYear) {
      const month = Number(mm);
      if (month >= 1 && month <= 12) yearlyColl[month] += Number(r.repayment_amount) || 0;
    }
  });
  const months = [null, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yearlyTrend = [];
  for (let m = 1; m <= 12; m++) {
    yearlyTrend.push({
      month: months[m],
      disbursed: yearlyDisb[m],
      collected: yearlyColl[m]
    });
  }

  // Compute collection per branch for current month
  const branchCollectionAgg = {};
  (processor.repaymentsData || []).forEach(r => {
    const dateStr = r.repayment_collected_date || '';
    const [dd, mm, yyyy] = String(dateStr).split('/');
    const branchCode = r.branch || r.Branch;
    if (yyyy && mm && Number(yyyy) === currentYear && Number(mm) === currentMonth && branchCode) {
      branchCollectionAgg[branchCode] = (branchCollectionAgg[branchCode] || 0) + (Number(r.repayment_amount) || 0);
    }
  });
  const collectionByBranchForGauge = Object.entries(branchCollectionAgg).map(([code, amount]) => ({
    name: processor.getBranchName ? processor.getBranchName(code) : code,
    value: amount
  })).sort((a,b) => b.value - a.value);
  const totalCollectedMonthForGauge = collectionByBranchForGauge.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Logbook Dashboard</h1>
        <p className="text-gray-600 mt-2">Real-time overview of Logbook business unit performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                <p className={`text-sm mt-1 ${stat.color}`}>{stat.change}</p>
              </div>
              <div className={`p-3 rounded-lg bg-gray-50 ${stat.color}`}>
                <stat.icon size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Product Distribution */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Disbursement By Branch (Current Month)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={disbByBranchData}
                cx="50%"
                cy="50%"
                labelLine={false}
                innerRadius={70}
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                fill="#8884d8"
                dataKey="value"
              >
                {disbByBranchData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatKES(value), 'Amount']} />
              <text x={"50%"} y={"50%"} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight="bold">
                {numActiveBranches}
              </text>
              <text x={"50%"} y={"60%"} textAnchor="middle" fontSize={12} fill="#888">Active Branches</text>
            </PieChart>
          </ResponsiveContainer>
          {/* Bar chart for Disbursement vs Collection (Current Month) */}
          <div className="mt-6 mb-2 font-semibold">Disbursement vs Collection (Current Month)</div>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={branchBarData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="branch" />
              <YAxis />
              <Tooltip formatter={(v, n) => [formatKES(v), n]} />
              <Legend />
              <Bar dataKey="disbursed" name="Disbursed" fill="#3b82f6" />
              <Bar dataKey="collected" name="Collected" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Daily Trend: Disbursement vs Collection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Disbursement vs Collection</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={dailyTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip formatter={formatKES} />
              <Legend formatter={(value) =>
                value === 'disbursed' ? 'Disbursed' :
                value === 'collected' ? 'Collected' : value
              } />
              <Line type="monotone" dataKey="disbursed" stroke="#3b82f6" strokeWidth={2} dot={false} name="Disbursed" />
              <Line type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} dot={false} name="Collected" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-10">
            <h4 className="text-md font-semibold mb-3 text-gray-900">Collection By Branch (Current Month)</h4>
            <div className="space-y-2">
              {collectionByBranchForGauge.map((entry, idx) => {
                const pct = totalCollectedMonthForGauge > 0 ? (entry.value / totalCollectedMonthForGauge) * 100 : 0;
                return (
                  <div key={entry.name} className="flex items-center space-x-3 text-sm">
                    <div className="w-32 font-medium text-gray-800">{entry.name}</div>
                    <div className="flex-1 relative h-3 bg-gray-200 rounded-full mr-2">
                      <div
                        className="absolute top-0 left-0 h-3 bg-green-500 rounded-full transition-all"
                        style={{ width: pct + '%' }}
                      ></div>
                    </div>
                    <div className="min-w-[80px] tabular-nums">{formatKES(entry.value)}</div>
                    <div className="min-w-[40px] text-right text-gray-500">{pct.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Collection Trend */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Disbursement vs Collection (Yearly Trend)</h3>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={yearlyTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(v) => [formatKES(v), 'Amount']} />
            <Legend />
            <Area type="monotone" dataKey="disbursed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} name="Disbursed" />
            <Area type="monotone" dataKey="collected" stroke="#10b981" fill="#10b981" fillOpacity={0.25} name="Collected" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Activity Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Disbursements</h3>
          <div className="space-y-3">
            {(processor.disbursementsData || [])
              .filter(loan => processor.branchNames[loan.Branch])
              .slice(-20)
              .slice(-5)
              .map((loan, index) => (
              <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100">
                <div>
                  <p className="font-medium text-gray-900">{loan.Name || 'Unknown'}</p>
                  <p className="text-sm text-gray-600">{loan.Product}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{formatKES(loan.Disbursed)}</p>
                  <p className="text-sm text-gray-600">{loan.Status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Collections</h3>
          <div className="space-y-3">
            {(processor.repaymentsData || []).slice(-5).map((repayment, index) => (
              <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100">
                <div>
                  <p className="font-medium text-gray-900">Loan #{repayment.loan_id}</p>
                  <p className="text-sm text-gray-600">{repayment.repayment_collected_date}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{formatKES(repayment.repayment_amount)}</p>
                  <p className="text-sm text-gray-600">Collector: {repayment.collector_id}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LogbookDashboard

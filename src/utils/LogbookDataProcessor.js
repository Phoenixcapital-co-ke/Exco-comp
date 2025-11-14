import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { API_URLS } from './api.js'
// Data processing utilities for Logbook
export class LogbookDataProcessor {
  constructor() {
    this.disbursementsData = null
    this.repaymentsData = null
    
    // Branch name mappings
    this.branchNames = {
      '12936': 'BURUBURU BRANCH',
      '63796': 'Kiambu Branch',
      '27133': 'KIlimani Branch',
      '77791': 'Kitengela Branch',
      '75350': 'Thika Branch',
      '8550': 'TOWN BRANCH',
      '55886': 'Utawala Branch'
    }
  }

  // Helper method to get branch name
  getBranchName(branchCode) {
    const full = this.branchNames[branchCode]
    if (!full) return `Branch ${branchCode}`
    // Remove trailing "BRANCH"/"Branch"
    return String(full).replace(/\s*branch$/i, '').trim()
  }

  // Parse date in formats like 21/10/2025 (DD/MM/YYYY)
  parseDMY(dateLike) {
    if (!dateLike) return null;
    if (dateLike instanceof Date) return dateLike;
    const s = String(dateLike).trim();
    // If numeric Excel date serialized, try XLSX parsing by Date constructor
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      // ISO-like
      return new Date(s);
    }
    const parts = s.split(/[\/\-]/); // supports 21/10/2025 or 21-10-2025
    if (parts.length < 3) return null;
    const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10));
    if (!yyyy || !mm || !dd) return null;
    return new Date(yyyy, mm - 1, dd);
  }

  monthKey(date) {
    if (!date) return null;
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  getCurrentMonthKey(baseDate) {
    const d = baseDate instanceof Date ? baseDate : new Date()
    return this.monthKey(d)
  }

  // General disbursement aggregates for a given month key (YYYY-MM)
  getDisbursementAggregatesForMonth(monthKey) {
    if (!this.disbursementsData || !monthKey) return null
    const [yS, mS] = monthKey.split('-')
    const y = Number(yS), m = Number(mS)
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }
    const safe = v => (v == null || v === '' ? 0 : Number(v))

    let totalAmount = 0
    let numLoans = 0
    const officerSet = new Set()
    const byProduct = {}
    const byBranch = {}
    const byOfficer = {}

    for (const loan of this.disbursementsData) {
      const d = parseDMY(loan['Disbursed Date'])
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const amount = safe(loan.Disbursed)
        totalAmount += amount
        numLoans += 1
        if (loan.LoanOfficer) officerSet.add(String(loan.LoanOfficer))

        const product = (loan.Product || 'Unknown').replace('Logbook Loan', 'LL').replace('Product', '').trim()
        byProduct[product] = (byProduct[product] || 0) + amount

        const branchCode = loan.Branch
        if (this.branchNames[branchCode]) {
          byBranch[branchCode] = (byBranch[branchCode] || 0) + amount
        }

        const officer = loan.LoanOfficer || 'Unknown'
        byOfficer[officer] = (byOfficer[officer] || 0) + amount
      }
    }

    return {
      totalAmount,
      numLoans,
      numOfficers: officerSet.size,
      byProduct: Object.entries(byProduct)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
      byBranch: Object.entries(byBranch)
        .map(([code, amount]) => ({ name: this.getBranchName(code), amount }))
        .sort((a, b) => b.amount - a.amount),
      byOfficer: Object.entries(byOfficer)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    }
  }

  // Load disbursements data from backend API
  async loadDisbursementsData() {
    try {
        const response = await fetch(API_URLS.logbook.disbursements)
      this.disbursementsData = await response.json()
      return this.disbursementsData
    } catch (error) {
      console.error('Error loading disbursements data:', error)
      return null
    }
  }

  // Load repayments data from backend API
  async loadRepaymentsData() {
    try {
        const response = await fetch(API_URLS.logbook.collections)
      this.repaymentsData = await response.json()
      return this.repaymentsData
    } catch (error) {
      console.error('Error loading repayments data:', error)
      return null
    }
  }
  // Dashboard calculations
  getDashboardMetrics() {
    if (!this.disbursementsData || !this.repaymentsData) return null

    // Coerce numeric fields
    const safeNum = v => (v == null || v === '' ? 0 : Number(v))

    // Build month aggregates from disbursements
    const byMonthAmount = {}
    const byMonthCount = {}
    let latestDate = null
    for (const loan of this.disbursementsData) {
      const d = this.parseDMY(loan['Disbursed Date'])
      if (!d) continue
      if (!latestDate || d > latestDate) latestDate = d
      const key = this.monthKey(d)
      byMonthAmount[key] = (byMonthAmount[key] || 0) + safeNum(loan.Disbursed)
      byMonthCount[key] = (byMonthCount[key] || 0) + 1
    }

    // Determine current and previous month keys
    let currentMonthKey = this.monthKey(latestDate)
    // Previous month
    const prev = latestDate ? new Date(latestDate.getFullYear(), latestDate.getMonth() - 1, 1) : null
    const previousMonthKey = this.monthKey(prev)

    const totalDisbursed = this.disbursementsData.reduce((sum, loan) => sum + safeNum(loan.Disbursed), 0)
    const totalCollected = this.repaymentsData.reduce((sum, repayment) => sum + safeNum(repayment.repayment_amount), 0)
    const activeLoans = this.disbursementsData.length
    const collectionRate = totalDisbursed > 0 ? (totalCollected / totalDisbursed) * 100 : 0

    const thisMonthDisbursed = byMonthAmount[currentMonthKey] || 0
    const prevMonthDisbursed = byMonthAmount[previousMonthKey] || 0
    const thisMonthLoans = byMonthCount[currentMonthKey] || 0
    const prevMonthLoans = byMonthCount[previousMonthKey] || 0

    // If no previous month data, show 0 change instead of null
    const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : 0)
    const momDisbursedChangePct = pct(thisMonthDisbursed, prevMonthDisbursed)
    const momLoansChangePct = pct(thisMonthLoans, prevMonthLoans)

    return {
      // Totals
      totalPortfolio: totalDisbursed,
      activeLoans,
      collectionRate: collectionRate.toFixed(1),
      totalCollected,
      // Monthly metrics
      currentMonthKey,
      previousMonthKey,
      totalDisbursedThisMonth: thisMonthDisbursed,
      numLoansThisMonth: thisMonthLoans,
      momDisbursedChangePct,
      momLoansChangePct,
    }
  }

  // Disbursement analytics
  getDisbursementAnalytics() {
    if (!this.disbursementsData) return null

    const getAmt = (loan) => Number(loan?.disbursed ?? loan?.Disbursed ?? 0) || 0

    const totalDisbursed = this.disbursementsData.reduce((sum, loan) => sum + getAmt(loan), 0)
    const averageLoanSize = this.disbursementsData.length > 0 ? totalDisbursed / this.disbursementsData.length : 0

    // Group by product
    const productStats = this.disbursementsData.reduce((acc, loan) => {
      const product = loan.Product || 'Unknown'
      if (!acc[product]) {
        acc[product] = { count: 0, amount: 0 }
      }
      acc[product].count++
      acc[product].amount += getAmt(loan)
      return acc
    }, {})

    // Group by loan officer
    const officerStats = this.disbursementsData.reduce((acc, loan) => {
      const officer = loan.loan_officer || loan.LoanOfficer || 'Unknown'
      if (!acc[officer]) {
        acc[officer] = { count: 0, amount: 0 }
      }
      acc[officer].count++
      acc[officer].amount += getAmt(loan)
      return acc
    }, {})

    return {
      totalDisbursed,
      averageLoanSize,
      productStats,
      officerStats,
      recentDisbursements: this.disbursementsData.slice(-20)
    }
  }

  // Collection analytics
  getCollectionAnalytics() {
    if (!this.repaymentsData) return null

    const safeNum = v => (v == null || v === '' ? 0 : Number(v))

    const totalCollected = this.repaymentsData.reduce((sum, r) => sum + safeNum(r.repayment_amount), 0)
    const totalPrincipal = this.repaymentsData.reduce((sum, r) => sum + safeNum(r.principal_repayment_amount), 0)
    const totalInterest = this.repaymentsData.reduce((sum, r) => sum + safeNum(r.interest_repayment_amount), 0)
    const totalFees = this.repaymentsData.reduce((sum, r) => sum + safeNum(r.fees_repayment_amount), 0)
    const totalPenalty = this.repaymentsData.reduce((sum, r) => sum + safeNum(r.penalty_repayment_amount), 0)

    // Group by collector
    const collectorStats = this.repaymentsData.reduce((acc, r) => {
      const collector = r.collector_id || 'Unknown'
      if (!acc[collector]) {
        acc[collector] = { count: 0, amount: 0 }
      }
      acc[collector].count++
      acc[collector].amount += safeNum(r.repayment_amount)
      return acc
    }, {})

    // Monthly aggregates for collections
    const byMonthCollected = {}
    const byMonthCount = {}
    for (const r of this.repaymentsData) {
      const d = this.parseDMY(r.repayment_collected_date)
      if (!d) continue
      const key = this.monthKey(d)
      byMonthCollected[key] = (byMonthCollected[key] || 0) + safeNum(r.repayment_amount)
      byMonthCount[key] = (byMonthCount[key] || 0) + 1
    }

    const now = new Date()
    const currentMonthKey = this.monthKey(now)
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const previousMonthKey = this.monthKey(prev)

    const thisMonthCollected = byMonthCollected[currentMonthKey] || 0
    const prevMonthCollected = byMonthCollected[previousMonthKey] || 0
    const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : 0)
    const momCollectedChangePct = pct(thisMonthCollected, prevMonthCollected)

    return {
      totalCollected,
      totalPrincipal,
      totalInterest,
      totalFees,
      totalPenalty,
      collectorStats,
      recentCollections: this.repaymentsData.slice(-20),
      // monthly
      currentMonthKey,
      previousMonthKey,
      totalCollectedThisMonth: thisMonthCollected,
      momCollectedChangePct,
    }
  }

  // Collection aggregates for a given month key (YYYY-MM)
  getCollectionAggregatesForMonth(monthKey) {
    if (!this.repaymentsData || !monthKey) return null
    const [yS, mS] = monthKey.split('-')
    const y = Number(yS), m = Number(mS)
    const safe = v => (v == null || v === '' ? 0 : Number(v))
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }

    let totalAmount = 0
    let totalPrincipal = 0
    let totalInterest = 0
    let totalFees = 0
    let totalPenalty = 0
    const byCollector = {}
    const byDay = {}

    for (const r of this.repaymentsData) {
      const d = parseDMY(r.repayment_collected_date)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        const amt = safe(r.repayment_amount)
        totalAmount += amt
        totalPrincipal += safe(r.principal_repayment_amount)
        totalInterest += safe(r.interest_repayment_amount)
        totalFees += safe(r.fees_repayment_amount)
        totalPenalty += safe(r.penalty_repayment_amount)

        const collector = r.collector_id || 'Unknown'
        byCollector[collector] = (byCollector[collector] || 0) + amt

        const day = d.getDate()
        byDay[day] = (byDay[day] || 0) + amt
      }
    }

    return {
      totalAmount,
      totalPrincipal,
      totalInterest,
      totalFees,
      totalPenalty,
      byCollector: Object.entries(byCollector)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
      byDay,
    }
  }

  // Daily trend (disbursed vs collected) for a month key (YYYY-MM)
  getDailyTrendForMonth(monthKey) {
    if (!monthKey) return []
    const [yS, mS] = monthKey.split('-')
    const y = Number(yS), m = Number(mS)
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 0)
    const daysInMonth = end.getDate()

    const safe = v => (v == null || v === '' ? 0 : Number(v))
    const parseDMY = (s) => {
      if (!s) return null
      const parts = String(s).split(/[\/\-]/)
      if (parts.length < 3) return null
      const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10))
      if (!yyyy || !mm || !dd) return null
      return new Date(yyyy, mm - 1, dd)
    }

    const disbByDay = Array(daysInMonth + 1).fill(0)
    const collByDay = Array(daysInMonth + 1).fill(0)

    for (const loan of (this.disbursementsData || [])) {
      const d = parseDMY(loan['Disbursed Date'])
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        disbByDay[d.getDate()] += safe(loan.Disbursed)
      }
    }

    for (const r of (this.repaymentsData || [])) {
      const d = parseDMY(r.repayment_collected_date)
      if (!d) continue
      if (d.getFullYear() === y && (d.getMonth() + 1) === m) {
        collByDay[d.getDate()] += safe(r.repayment_amount)
      }
    }

    const out = []
    for (let day = 1; day <= daysInMonth; day++) {
      out.push({ day: String(day), disbursed: disbByDay[day], collected: collByDay[day] })
    }
    return out
  }

  // PAR analytics
  getPARAnalytics() {
    if (!this.disbursementsData) return null

    const currentLoans = this.disbursementsData.filter(loan => loan.Status === 'Current').length
    const restructuredLoans = this.disbursementsData.filter(loan => loan.Status === 'Restructured').length
    const fullyPaidLoans = this.disbursementsData.filter(loan => loan.Status === 'Fully Paid').length

    const totalOutstanding = this.disbursementsData.reduce((sum, loan) => sum + (loan.Outstanding || 0), 0)
    const totalDisbursed = this.disbursementsData.reduce((sum, loan) => sum + (loan.Disbursed || 0), 0)
    const parRate = totalDisbursed > 0 ? (totalOutstanding / totalDisbursed) * 100 : 0

    return {
      currentLoans,
      restructuredLoans,
      fullyPaidLoans,
      totalOutstanding,
      totalDisbursed,
      parRate: parRate.toFixed(1),
      riskDistribution: {
        current: currentLoans,
        restructured: restructuredLoans,
        fullyPaid: fullyPaidLoans
      }
    }
  }

  // Productivity analytics
  getProductivityAnalytics() {
    if (!this.disbursementsData || !this.repaymentsData) return null

    // Loan officer productivity
    const officerProductivity = this.disbursementsData.reduce((acc, loan) => {
      const officer = loan.LoanOfficer || 'Unknown'
      if (!acc[officer]) {
        acc[officer] = { loansProcessed: 0, totalDisbursed: 0 }
      }
      acc[officer].loansProcessed++
      acc[officer].totalDisbursed += loan.Disbursed || 0
      return acc
    }, {})

    // Collector productivity
    const collectorProductivity = this.repaymentsData.reduce((acc, repayment) => {
      const collector = repayment.collector_id || 'Unknown'
      if (!acc[collector]) {
        acc[collector] = { collectionsProcessed: 0, totalCollected: 0 }
      }
      acc[collector].collectionsProcessed++
      acc[collector].totalCollected += repayment.repayment_amount || 0
      return acc
    }, {})

    return {
      officerProductivity,
      collectorProductivity,
      totalStaff: Object.keys(officerProductivity).length + Object.keys(collectorProductivity).length
    }
  }
}

export default LogbookDataProcessor

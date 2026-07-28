import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CircleAlert,
  Gauge,
  GraduationCap,
  Loader2,
  MapPinned,
  RefreshCw,
  Search,
  Target,
  UserMinus,
  UserPlus,
  Users,
  WalletCards,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { API_URLS } from '../../utils/api.js'

const BRAND = '#EF5322'
const CHART_COLORS = ['#EF5322', '#F78A65', '#FDB8A2', '#334155', '#94A3B8', '#CBD5E1']

export const HR_SECTIONS = [
  {
    id: 'sales-force',
    title: 'Sales Force',
    shortTitle: 'Sales Force',
    description: 'Targets, rankings and branch sales execution',
    icon: Target,
    visuals: [
      'Daily / weekly target vs actual',
      'Top vs bottom performers',
      'Branch-wise sales ranking',
    ],
    source: 'Sales and target integration',
  },
  {
    id: 'collections-quality',
    title: 'Collections & Portfolio Quality',
    shortTitle: 'Collections & PAR',
    description: 'Collections execution and portfolio risk',
    icon: Gauge,
    visuals: [
      'Collections officer / RO performance ranking',
      'Branch PAR comparison',
    ],
    source: 'Collections and PAR integration',
  },
  {
    id: 'productivity',
    title: 'Employee Productivity',
    shortTitle: 'Productivity',
    description: 'Workforce capacity, output and cost efficiency',
    icon: Activity,
    visuals: [
      'Productivity per branch',
      'Output per employee vs cost',
      'Workload distribution',
    ],
    source: 'Output and payroll integration',
  },
  {
    id: 'attendance-field',
    title: 'Attendance & Field Activity',
    shortTitle: 'Attendance & Field',
    description: 'Availability, field execution and performance correlation',
    icon: CalendarCheck,
    visuals: [
      'Absenteeism trends',
      'Field activity vs performance correlation',
      'Branch attendance comparison',
    ],
    source: 'Attendance and field activity integration',
  },
  {
    id: 'compensation',
    title: 'Incentives & Compensation',
    shortTitle: 'Compensation',
    description: 'Pay, incentives and performance alignment',
    icon: BadgeDollarSign,
    visuals: [
      'Top earners vs performance',
      'Incentive effectiveness analysis',
      'Compensation vs productivity',
    ],
    source: 'Payroll and incentive integration',
  },
  {
    id: 'retention',
    title: 'Turnover & Retention',
    shortTitle: 'Retention',
    description: 'Attrition, tenure and workforce stability',
    icon: RefreshCw,
    visuals: [
      'Attrition rate',
      'New hires vs exits',
      'Tenure of employees',
      'Turnover by role',
      'High-risk branches',
      'Exit reasons analysis',
      'Retention trends',
    ],
    source: 'Wingubox employees',
  },
  {
    id: 'training',
    title: 'Training & Capability',
    shortTitle: 'Training',
    description: 'Learning completion, skills and training impact',
    icon: GraduationCap,
    visuals: [
      'Training completion rates',
      'Performance before vs after training',
      'Skill gaps',
      'Training ROI',
      'Skill gap analysis',
    ],
    source: 'Learning and skills integration',
  },
  {
    id: 'branch-performance',
    title: 'Branch & Manager Performance',
    shortTitle: 'Branch Scorecards',
    description: 'Profitability, leadership and regional comparisons',
    icon: Building2,
    visuals: [
      'Branch profitability',
      'Sales + collections combined performance',
      'PAR per branch',
      'Staff productivity per branch',
      'Branch traffic-light scorecard',
      'Manager performance ranking',
      'Regional comparisons',
    ],
    source: 'Finance, operations and manager integration',
  },
]

const isActive = (employee) =>
  employee?.active === 1 || employee?.active === '1' || employee?.active === true

const safeDate = (value) => {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null

  // Wingubox dates are typically DD/MM/YYYY (sometimes with a time suffix).
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/)
  if (dmy) {
    const dd = Number(dmy[1])
    const mm = Number(dmy[2])
    const yyyy = Number(dmy[3])
    const date = new Date(yyyy, mm - 1, dd)
    if (
      date.getFullYear() === yyyy &&
      date.getMonth() === mm - 1 &&
      date.getDate() === dd
    ) {
      return date
    }
    return null
  }

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

const employeeBranch = (employee) =>
  String(employee?.region || employee?.branch || 'Unassigned').trim() || 'Unassigned'

const employeeRole = (employee) =>
  String(employee?.job_title || employee?.position || 'Unspecified').trim() || 'Unspecified'

function useEmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        setError('')
        const response = await fetch(API_URLS.hr.employees, {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Unable to load workforce data (${response.status})`)
        const payload = await response.json()
        setEmployees(Array.isArray(payload) ? payload : [])
      } catch (err) {
        if (err.name !== 'AbortError') {
          setEmployees([])
          setError(err.message)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  return { employees, loading, error }
}

function KpiCard({ label, value, detail, icon: Icon, tone = 'orange' }) {
  const toneClass = {
    orange: 'bg-[#FFF1EC] text-[#EF5322]',
    green: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-100 text-slate-600',
    sky: 'bg-sky-50 text-sky-700',
    red: 'bg-red-50 text-red-600',
  }[tone]
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
        </div>
        <div className={`rounded-xl p-2.5 ${toneClass}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}

function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-5">
        <h3 className="font-semibold text-slate-950">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function EmptyVisual({ title, source }) {
  return (
    <div className="flex min-h-[220px] flex-col justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5">
      <div className="flex items-start justify-between">
        <div className="rounded-xl bg-white p-2.5 text-[#EF5322] shadow-sm ring-1 ring-slate-200">
          <BarChart3 size={20} />
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
          Data integration
        </span>
      </div>
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Visual container is ready. Connect {source.toLowerCase()} to activate this analysis.
        </p>
      </div>
    </div>
  )
}

function WorkspaceHeader({ section }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-[#EF5322] text-white shadow-xl">
      <div className="relative px-6 py-7 md:px-8">
        <div className="absolute -right-16 -top-24 h-56 w-56 rounded-full bg-white/20 blur-3xl" />
        <div className="relative">
          <div>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight md:text-4xl">
              {section?.title || 'HR Command Centre'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
              {section?.description ||
                'One view of workforce performance, portfolio quality, productivity and capability.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function CyberPanel({ title, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h3 className="mb-4 text-sm font-semibold tracking-wider text-slate-900">{title}</h3>
      {children}
    </section>
  )
}

function OverviewCommandCards({ analytics }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <CyberPanel title="BRANCH ALLOCATION">
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="font-mono text-2xl font-bold text-[#EF5322]">{analytics.departmentCount.toLocaleString()}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Departments</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-2xl font-bold text-[#EF5322]">{analytics.active.toLocaleString()}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Active Field</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-2xl font-bold text-[#EF5322]">{analytics.branchHeadcount.length.toLocaleString()}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Branches</div>
          </div>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {analytics.branchHeadcount.map((branch) => {
            const status = branch.active > 0 ? (branch.inactive > branch.active ? 'risk' : 'active') : 'standby'
            return (
              <div
                key={branch.name}
                className="flex items-center justify-between rounded-lg border border-[#EF5322] bg-[#EF5322] p-2.5 transition-colors hover:bg-[#D94719]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      status === 'active' ? 'bg-white' : status === 'standby' ? 'bg-white/60' : 'bg-red-200'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-white">{branch.name}</div>
                    <div className="text-[10px] text-white/75">
                      {branch.active} active · {branch.inactive} former
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-xs font-semibold text-white">{branch.total}</div>
                  <div className="text-[10px] text-white/80">{branch.attritionRate.toFixed(1)}% attrition</div>
                </div>
              </div>
            )
          })}
        </div>
      </CyberPanel>

      <CyberPanel title="DEPARTMENT ALLOCATION">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <div className="font-mono text-lg font-bold text-[#EF5322]">{analytics.departmentCount.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Departments</div>
          </div>
          <div>
            <div className="font-mono text-lg font-bold text-[#EF5322]">{analytics.active.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Active workforce</div>
            <div className="mt-0.5 text-[10px] text-[#EF5322]">{analytics.activeRate.toFixed(1)}% of workforce</div>
          </div>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {analytics.departmentHeadcount.length ? (
            analytics.departmentHeadcount.map((dept) => (
              <div
                key={dept.name}
                className="rounded-lg border border-[#EF5322] bg-[#EF5322] p-2.5 transition-colors hover:bg-[#D94719]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-white">{dept.name}</div>
                    <div className="mt-1 font-mono text-[10px] text-white/75">
                      {dept.active} active · {dept.inactive} former
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-xs font-semibold text-white">{dept.total}</div>
                    <div className="text-[10px] text-white/80">{dept.attritionRate.toFixed(1)}% attrition</div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border-l-2 border-[#EF5322] bg-slate-50 p-2.5 text-xs text-slate-500">
              No department data available.
            </div>
          )}
        </div>
      </CyberPanel>

      <CyberPanel title="NEW HIRES VS EXITS">
        <p className="mb-4 text-xs text-slate-500">Monthly workforce movement from employee records</p>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="font-mono text-2xl font-bold text-[#EF5322]">{analytics.attritionRate.toFixed(1)}%</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Attrition rate</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-2xl font-bold text-[#EF5322]">{analytics.retentionRate.toFixed(1)}%</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Retention rate</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={analytics.movementTrend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="month" tick={{ fontSize: 9 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="hires" stroke={BRAND} fill={BRAND} fillOpacity={0.18} name="Hires" />
            <Area type="monotone" dataKey="exits" stroke="#475569" fill="#475569" fillOpacity={0.12} name="Exits" />
          </AreaChart>
        </ResponsiveContainer>
      </CyberPanel>
    </div>
  )
}

function Overview({ analytics }) {
  return (
    <>
      <OverviewCommandCards analytics={analytics} />

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <ChartCard title="Workforce by age" subtitle="Current and former staff by age group">
          <ResponsiveContainer width="100%" height={330}>
            <BarChart data={analytics.ageDistribution} layout="vertical" margin={{ left: 10, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="active" stackId="headcount" fill={BRAND} name="Active" radius={[0, 3, 3, 0]} />
              <Bar dataKey="inactive" stackId="headcount" fill="#CBD5E1" name="Former staff" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Gender" subtitle="Workforce gender distribution">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={analytics.genderData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3}>
                {analytics.genderData.map((entry, index) => (
                  <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap justify-center gap-5 text-xs text-slate-600">
            {analytics.genderData.map((item, index) => (
              <span key={item.name} className="flex items-center gap-2">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                {item.name}: {item.value}
              </span>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#EF5322]/20 bg-[#FFF1EC] px-3 py-3 text-center">
              <div className="font-mono text-xl font-bold text-[#EF5322]">
                {analytics.genderAttrition.male.toFixed(1)}%
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Male attrition</div>
            </div>
            <div className="rounded-xl border border-[#EF5322]/20 bg-[#FFF1EC] px-3 py-3 text-center">
              <div className="font-mono text-xl font-bold text-[#EF5322]">
                {analytics.genderAttrition.female.toFixed(1)}%
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Female attrition</div>
            </div>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="People analytics workspace" subtitle="Select a domain to open its visual command centre">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {HR_SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <Link
                key={section.id}
                to={`/hr/${section.id}`}
                className="group rounded-2xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-[#EF5322]/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="rounded-xl bg-[#FFF1EC] p-2.5 text-[#EF5322]"><Icon size={19} /></span>
                  <ArrowRight size={17} className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#EF5322]" />
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{section.shortTitle}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{section.description}</p>
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.visuals.length} visual modules
                </p>
              </Link>
            )
          })}
        </div>
      </ChartCard>
    </>
  )
}

function RetentionVisuals({ analytics }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Historical leaver share" value={`${analytics.formerStaffShare.toFixed(1)}%`} detail="Former staff ÷ all known staff" icon={UserMinus} tone="red" />
        <KpiCard label="New hires · 12M" value={analytics.hires12m.toLocaleString()} detail="Contract starts in last 12 months" icon={UserPlus} tone="green" />
        <KpiCard label="Average tenure" value={`${analytics.averageTenure.toFixed(1)} yrs`} detail="Across active employees" icon={BriefcaseBusiness} tone="slate" />
        <KpiCard label="Former staff" value={analytics.inactive.toLocaleString()} detail="Employees who have left the company" icon={CircleAlert} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="New hires vs exits" subtitle="Monthly workforce movement from employee records">
          <ResponsiveContainer width="100%" height={310}>
            <AreaChart data={analytics.movementTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="hires" stroke={BRAND} fill={BRAND} fillOpacity={0.18} name="Hires" />
              <Area type="monotone" dataKey="exits" stroke="#475569" fill="#475569" fillOpacity={0.12} name="Exits" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Tenure distribution" subtitle="Current employees grouped by years of service">
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={analytics.tenureBands}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill={BRAND} radius={[6, 6, 0, 0]} name="Employees" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Turnover by role" subtitle="Former staff by job title">
          <ResponsiveContainer width="100%" height={330}>
            <BarChart data={analytics.turnoverRoles.slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#475569" radius={[0, 5, 5, 0]} name="Former staff" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="High-risk branches" subtitle="Branches ranked by historical leaver share">
          <div className="space-y-3">
            {analytics.highRiskBranches.slice(0, 8).map((branch, index) => (
              <div key={branch.name} className="flex items-center gap-3">
                <span className="w-5 text-xs font-bold text-slate-400">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="truncate font-medium text-slate-700">{branch.name}</span>
                    <span className="font-semibold text-slate-900">{branch.rate.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-[#EF5322]" style={{ width: `${Math.min(100, branch.rate)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
      <EmptyVisual title="Exit reasons analysis" source="Exit interview / separation reason data" />
    </>
  )
}

function ProductivityVisuals({ analytics, section }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active workforce" value={analytics.active.toLocaleString()} detail="Employees available for allocation" icon={Users} />
        <KpiCard label="Branches" value={analytics.branchHeadcount.length.toLocaleString()} detail="Current workforce footprint" icon={Building2} tone="slate" />
        <KpiCard label="Average branch size" value={analytics.averageBranchSize.toFixed(1)} detail="Active employees per branch" icon={Activity} tone="green" />
        <KpiCard label="Job roles" value={analytics.roleCount.toLocaleString()} detail="Distinct job titles" icon={BriefcaseBusiness} />
      </div>
      <ChartCard title="Workload distribution proxy" subtitle="Active headcount by branch; output integration will add workload units">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={analytics.branchHeadcount.slice(0, 15)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="name" angle={-35} textAnchor="end" height={85} tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="active" fill={BRAND} radius={[6, 6, 0, 0]} name="Active employees" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="grid gap-5 lg:grid-cols-2">
        {section.visuals
          .filter((visual) => visual !== 'Workload distribution')
          .map((visual) => <EmptyVisual key={visual} title={visual} source={section.source} />)}
      </div>
    </>
  )
}

const formatSalesAmount = (value) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value) || 0)

const PRODUCT_TABS = [
  { id: 'boda', label: 'Boda' },
  { id: 'zidisha', label: 'Zidisha' },
  { id: 'advans', label: 'Advans' },
  { id: 'logbook', label: 'Logbook' },
]

function formatBranchLabel(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return 'Unassigned'
  return (
    trimmed
      .replace(/^boda\s*[-–—]?\s*/i, '')
      .replace(/\s+branch$/i, '')
      .trim() || trimmed
  )
}

function salesBranchName(employee) {
  return formatBranchLabel(employee?.region)
}

function SalesArcMeter({ label, value, detail, colorClass = 'stroke-[#EF5322]', emptyLabel = 'No target' }) {
  const hasValue = value != null && Number.isFinite(Number(value))
  const raw = hasValue ? Number(value) : 0
  const arcPct = Math.max(0, Math.min(100, raw))
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (arcPct / 100) * circumference
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 112 112">
          <circle cx="56" cy="56" r={radius} className="fill-none stroke-slate-100" strokeWidth="8" />
          <circle
            cx="56"
            cy="56"
            r={radius}
            className={`fill-none transition-all duration-500 ${colorClass}`}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={hasValue ? offset : circumference}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
          <span className="font-mono text-lg font-bold text-slate-900">
            {hasValue ? `${raw.toFixed(0)}%` : emptyLabel}
          </span>
          {detail ? <span className="text-[10px] leading-tight text-slate-500">{detail}</span> : null}
        </div>
      </div>
      <span className="text-sm font-medium text-slate-600">{label}</span>
    </div>
  )
}

function ProductRateCard({ product, rate, actualVerb = 'disbursed' }) {
  const branches = rate.branches || []
  const maxActual = Math.max(...branches.map((b) => b.actual), 1)
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 justify-center sm:w-[140px]">
          <SalesArcMeter
            label={`${product.label} ${product.meterLabel || 'vs target'}`}
            value={rate.hasTarget ? rate.rate : null}
            detail={
              rate.hasTarget
                ? `${formatSalesAmount(rate.actual)} / ${formatSalesAmount(rate.target)}`
                : `${formatSalesAmount(rate.actual)} ${actualVerb}`
            }
            colorClass={product.meterColor}
            emptyLabel="No target"
          />
        </div>
        <div className="min-w-0 flex-1 border-t border-slate-100 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Branch breakdown
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {branches.map((branch) => (
              <div key={branch.branch}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium text-slate-700">{formatBranchLabel(branch.branch)}</span>
                  <span className="shrink-0 font-mono text-slate-500">
                    {branch.hasTarget
                      ? `${branch.rate.toFixed(0)}% · ${formatSalesAmount(branch.actual)}`
                      : formatSalesAmount(branch.actual)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#EF5322] to-[#F78A65]"
                    style={{
                      width: `${branch.hasTarget
                        ? Math.min(100, branch.rate)
                        : (branch.actual / maxActual) * 100}%`,
                    }}
                  />
                </div>
                {branch.hasTarget ? (
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    Target {formatSalesAmount(branch.target)}
                  </div>
                ) : null}
              </div>
            ))}
            {!branches.length ? (
              <p className="py-2 text-center text-xs text-slate-400">No branch activity this month.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SalesForceVisuals() {
  const now = new Date()
  const [period, setPeriod] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  )
  const [salesData, setSalesData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('boda')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const [year, month] = period.split('-').map(Number)
    const load = async () => {
      try {
        setLoading(true)
        setError('')
        const response = await fetch(API_URLS.hr.salesForce(month, year), {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Unable to load sales-force data (${response.status})`)
        setSalesData(await response.json())
      } catch (err) {
        if (err.name !== 'AbortError') {
          setSalesData(null)
          setError(err.message)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [period])

  const totals = salesData?.totals
  const employees = salesData?.employees || []
  const productCards = [
    {
      key: 'boda',
      label: 'Boda',
      detail: 'Zidisha Boda loans',
      tone: 'green',
      meterColor: 'stroke-emerald-500',
    },
    {
      key: 'zidisha',
      label: 'Zidisha',
      detail: 'All Zidisha loan products',
      tone: 'slate',
      meterColor: 'stroke-slate-600',
    },
    {
      key: 'advans',
      label: 'Advans',
      detail: 'Advans Branch / Advans products',
      tone: 'sky',
      meterColor: 'stroke-sky-600',
    },
    {
      key: 'logbook',
      label: 'Logbook',
      detail: 'Logbook disbursements',
      tone: 'orange',
      meterColor: 'stroke-[#EF5322]',
    },
  ]

  const staffWithSales = employees.filter((e) => e.total.loans > 0).length

  const tabProduct = activeTab
  const tabMeta = PRODUCT_TABS.find((t) => t.id === tabProduct) || PRODUCT_TABS[0]
  const tabTotals = totals?.[tabProduct] || { loans: 0, amount: 0, staff: 0 }

  const tabStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return employees
      .map((employee) => ({
        ...employee,
        filtered: {
          amount: Number(employee.products?.[tabProduct]?.amount) || 0,
          loans: Number(employee.products?.[tabProduct]?.loans) || 0,
        },
      }))
      .filter((employee) => {
        if (employee.filtered.loans <= 0) return false
        if (!q) return true
        return [employee.full_name, employee.department, employee.region, employee.job_title]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => b.filtered.amount - a.filtered.amount || a.full_name.localeCompare(b.full_name))
  }, [employees, tabProduct, searchQuery])

  const tabBranches = useMemo(() => {
    const map = new Map()
    for (const employee of employees) {
      const loans = Number(employee.products?.[tabProduct]?.loans) || 0
      const amount = Number(employee.products?.[tabProduct]?.amount) || 0
      if (loans <= 0) continue
      const branch = salesBranchName(employee)
      if (!map.has(branch)) map.set(branch, { name: branch, amount: 0, loans: 0, staff: 0 })
      const row = map.get(branch)
      row.amount += amount
      row.loans += loans
      row.staff += 1
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [employees, tabProduct])

  const tabBranchMax = Math.max(...tabBranches.map((b) => b.amount), 1)
  const rates = salesData?.rates || {}

  const staffBranchRates = useMemo(() => {
    const result = { boda: [], zidisha: [], advans: [], logbook: [] }
    for (const key of Object.keys(result)) {
      const map = new Map()
      for (const employee of employees) {
        const actual = Number(employee.products?.[key]?.amount) || 0
        if (actual <= 0) continue
        const branch = salesBranchName(employee)
        if (!map.has(branch)) {
          map.set(branch, { branch, actual: 0, target: 0, rate: 0, hasTarget: false })
        }
        map.get(branch).actual += actual
      }
      result[key] = Array.from(map.values())
        .map((row) => ({ ...row, actual: Math.round(row.actual) }))
        .sort((a, b) => b.actual - a.actual || a.branch.localeCompare(b.branch))
    }
    return result
  }, [employees])

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-900">Sales Force Analyzer</h2>
          <p className="mt-1 text-xs text-slate-500">
            Disbursement vs target rates, product tabs and staff rankings — same reporting month as the KPI cards.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Reporting month
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#EF5322] focus:ring-2 focus:ring-[#EF5322]/15"
          />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <div className="text-center">
            <Loader2 className="mx-auto animate-spin text-[#EF5322]" size={30} />
            <p className="mt-3 text-sm text-slate-500">Matching staff to product sales…</p>
          </div>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
      ) : null}

      {!loading && !error && salesData ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Sales staff"
              value={employees.length.toLocaleString()}
              detail={`${staffWithSales} with recorded sales`}
              icon={Users}
            />
            {productCards.map((product) => (
              <KpiCard
                key={product.key}
                label={product.label}
                value={formatSalesAmount(totals[product.key]?.amount || 0)}
                detail={`${Number(totals[product.key]?.staff || 0).toLocaleString()} staff · ${Number(totals[product.key]?.loans || 0).toLocaleString()} loans · ${product.detail}`}
                icon={WalletCards}
                tone={product.tone}
              />
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {productCards.map((product) => {
              const apiRate = rates[product.key]
              const fallbackActual = Number(totals[product.key]?.amount) || 0
              const apiBranches = Array.isArray(apiRate?.branches) ? apiRate.branches : []
              const branches = apiBranches.length ? apiBranches : staffBranchRates[product.key] || []
              const actual = Number(apiRate?.actual) || fallbackActual
              const target = Number(apiRate?.target) || 0
              const hasTarget = Boolean(apiRate?.hasTarget) && target > 0
              const rate = {
                actual,
                target,
                rate: hasTarget ? (actual / target) * 100 : Number(apiRate?.rate) || 0,
                hasTarget,
                branches,
              }
              return <ProductRateCard key={product.key} product={product} rate={rate} />
            })}
          </div>

          <div className="space-y-4">
            <div className="grid max-w-2xl grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
              {PRODUCT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">{tabMeta.label} staff</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {Number(tabTotals.staff || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">{tabMeta.label} loans</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {Number(tabTotals.loans || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">{tabMeta.label} disbursed</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {formatSalesAmount(tabTotals.amount || 0)}
                </div>
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${tabMeta.label} staff, department or branch…`}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#EF5322] focus:ring-2 focus:ring-[#EF5322]/15"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title={`${tabMeta.label} staff stream`}
                subtitle={`${tabStaff.length} staff with ${tabMeta.label} sales · ${period}`}
              >
                <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                  {tabStaff.map((employee, index) => (
                    <div
                      key={employee.id || employee.employee_id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white font-mono text-[10px] font-semibold text-slate-500">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{employee.full_name}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            {employee.department || 'Unassigned'} · {formatBranchLabel(employee.region) || 'No branch'}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {formatSalesAmount(employee.filtered.amount)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {employee.filtered.loans.toLocaleString()} loans
                        </div>
                      </div>
                    </div>
                  ))}
                  {!tabStaff.length ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No staff with {tabMeta.label} sales this month.
                    </p>
                  ) : null}
                </div>
              </ChartCard>

              <ChartCard
                title={`${tabMeta.label} branch footprint`}
                subtitle={`${tabBranches.length} branches · relative disbursement volume`}
              >
                <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                  {tabBranches.map((branch, idx) => (
                    <div key={branch.name} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-[10px] font-semibold text-slate-600">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-slate-800">{branch.name}</span>
                          <span className="shrink-0 font-mono text-slate-600">
                            {formatSalesAmount(branch.amount)}
                          </span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#EF5322] to-[#F78A65]"
                            style={{ width: `${(branch.amount / tabBranchMax) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          {branch.staff} staff · {branch.loans.toLocaleString()} loans
                        </div>
                      </div>
                      <MapPinned size={16} className="shrink-0 text-slate-400" />
                    </div>
                  ))}
                  {!tabBranches.length ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No {tabMeta.label} branch activity this month.
                    </p>
                  ) : null}
                </div>
              </ChartCard>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

function CollectionsParVisuals() {
  const now = new Date()
  const [period, setPeriod] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  )
  const [collectionsData, setCollectionsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('boda')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const [year, month] = period.split('-').map(Number)
    const load = async () => {
      try {
        setLoading(true)
        setError('')
        const response = await fetch(API_URLS.hr.collectionsPar(month, year), {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Unable to load collections-par data (${response.status})`)
        setCollectionsData(await response.json())
      } catch (err) {
        if (err.name !== 'AbortError') {
          setCollectionsData(null)
          setError(err.message)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [period])

  const totals = collectionsData?.totals
  const employees = collectionsData?.employees || []
  const productCards = [
    {
      key: 'boda',
      label: 'Boda',
      detail: 'Boda schedule collections',
      tone: 'green',
      meterColor: 'stroke-emerald-500',
      meterLabel: 'collection rate',
    },
    {
      key: 'zidisha',
      label: 'Zidisha',
      detail: 'Zidisha maturity collections',
      tone: 'slate',
      meterColor: 'stroke-slate-600',
      meterLabel: 'collection rate',
    },
    {
      key: 'advans',
      label: 'Advans',
      detail: 'Advans maturity collections',
      tone: 'sky',
      meterColor: 'stroke-sky-600',
      meterLabel: 'collection rate',
    },
    {
      key: 'logbook',
      label: 'Logbook',
      detail: 'Logbook cash collections',
      tone: 'orange',
      meterColor: 'stroke-[#EF5322]',
      meterLabel: 'collection rate',
    },
  ]

  const staffWithCollections = employees.filter((e) => (e.total?.amount || 0) > 0 || (e.total?.loans || 0) > 0).length

  const tabProduct = activeTab
  const tabMeta = PRODUCT_TABS.find((t) => t.id === tabProduct) || PRODUCT_TABS[0]
  const tabTotals = totals?.[tabProduct] || { loans: 0, amount: 0, staff: 0 }

  const tabStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return employees
      .map((employee) => ({
        ...employee,
        filtered: {
          amount: Number(employee.products?.[tabProduct]?.amount) || 0,
          loans: Number(employee.products?.[tabProduct]?.loans) || 0,
        },
      }))
      .filter((employee) => {
        if (employee.filtered.amount <= 0 && employee.filtered.loans <= 0) return false
        if (!q) return true
        return [employee.full_name, employee.department, employee.region, employee.job_title]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => b.filtered.amount - a.filtered.amount || a.full_name.localeCompare(b.full_name))
  }, [employees, tabProduct, searchQuery])

  const tabBranches = useMemo(() => {
    const map = new Map()
    for (const employee of employees) {
      const loans = Number(employee.products?.[tabProduct]?.loans) || 0
      const amount = Number(employee.products?.[tabProduct]?.amount) || 0
      if (amount <= 0 && loans <= 0) continue
      const branch = salesBranchName(employee)
      if (!map.has(branch)) map.set(branch, { name: branch, amount: 0, loans: 0, staff: 0 })
      const row = map.get(branch)
      row.amount += amount
      row.loans += loans
      row.staff += 1
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [employees, tabProduct])

  const tabBranchMax = Math.max(...tabBranches.map((b) => b.amount), 1)
  const rates = collectionsData?.rates || {}

  const staffBranchRates = useMemo(() => {
    const result = { boda: [], zidisha: [], advans: [], logbook: [] }
    for (const key of Object.keys(result)) {
      const map = new Map()
      for (const employee of employees) {
        const actual = Number(employee.products?.[key]?.amount) || 0
        if (actual <= 0) continue
        const branch = salesBranchName(employee)
        if (!map.has(branch)) {
          map.set(branch, { branch, actual: 0, target: 0, rate: 0, hasTarget: false })
        }
        map.get(branch).actual += actual
      }
      result[key] = Array.from(map.values())
        .map((row) => ({ ...row, actual: Math.round(row.actual) }))
        .sort((a, b) => b.actual - a.actual || a.branch.localeCompare(b.branch))
    }
    return result
  }, [employees])

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-900">Collections & PAR Analyzer</h2>
          <p className="mt-1 text-xs text-slate-500">
            Collection vs target rates, product tabs and officer rankings — same reporting month as the KPI cards.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Reporting month
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#EF5322] focus:ring-2 focus:ring-[#EF5322]/15"
          />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <div className="text-center">
            <Loader2 className="mx-auto animate-spin text-[#EF5322]" size={30} />
            <p className="mt-3 text-sm text-slate-500">Matching staff to collections…</p>
          </div>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
      ) : null}

      {!loading && !error && collectionsData ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Collection staff"
              value={employees.length.toLocaleString()}
              detail={`${staffWithCollections} with recorded collections`}
              icon={Users}
            />
            {productCards.map((product) => (
              <KpiCard
                key={product.key}
                label={product.label}
                value={formatSalesAmount(totals[product.key]?.amount || 0)}
                detail={`${Number(totals[product.key]?.staff || 0).toLocaleString()} staff · ${Number(totals[product.key]?.loans || 0).toLocaleString()} txns · ${product.detail}`}
                icon={WalletCards}
                tone={product.tone}
              />
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {productCards.map((product) => {
              const apiRate = rates[product.key]
              const fallbackActual = Number(totals[product.key]?.amount) || 0
              const apiBranches = Array.isArray(apiRate?.branches) ? apiRate.branches : []
              const branches = apiBranches.length ? apiBranches : staffBranchRates[product.key] || []
              const actual = Number(apiRate?.actual) || fallbackActual
              const target = Number(apiRate?.target) || 0
              const hasTarget = Boolean(apiRate?.hasTarget) && target > 0
              const rate = {
                actual,
                target,
                rate: hasTarget ? (actual / target) * 100 : Number(apiRate?.rate) || 0,
                hasTarget,
                branches,
              }
              return <ProductRateCard key={product.key} product={product} rate={rate} actualVerb="collected" />
            })}
          </div>

          <div className="space-y-4">
            <div className="grid max-w-2xl grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
              {PRODUCT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">{tabMeta.label} staff</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {Number(tabTotals.staff || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">{tabMeta.label} txns</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {Number(tabTotals.loans || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">{tabMeta.label} collected</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {formatSalesAmount(tabTotals.amount || 0)}
                </div>
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${tabMeta.label} staff, department or branch…`}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#EF5322] focus:ring-2 focus:ring-[#EF5322]/15"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title={`${tabMeta.label} collector stream`}
                subtitle={`${tabStaff.length} staff with ${tabMeta.label} collections · ${period}`}
              >
                <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                  {tabStaff.map((employee, index) => (
                    <div
                      key={employee.id || employee.employee_id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white font-mono text-[10px] font-semibold text-slate-500">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{employee.full_name}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            {employee.department || 'Unassigned'} · {formatBranchLabel(employee.region) || 'No branch'}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {formatSalesAmount(employee.filtered.amount)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {employee.filtered.loans.toLocaleString()} txns
                        </div>
                      </div>
                    </div>
                  ))}
                  {!tabStaff.length ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No staff with {tabMeta.label} collections this month.
                    </p>
                  ) : null}
                </div>
              </ChartCard>

              <ChartCard
                title={`${tabMeta.label} branch collections`}
                subtitle={`${tabBranches.length} branches · relative collection volume`}
              >
                <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                  {tabBranches.map((branch, idx) => (
                    <div key={branch.name} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-[10px] font-semibold text-slate-600">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-slate-800">{branch.name}</span>
                          <span className="shrink-0 font-mono text-slate-600">
                            {formatSalesAmount(branch.amount)}
                          </span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#EF5322] to-[#F78A65]"
                            style={{ width: `${(branch.amount / tabBranchMax) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          {branch.staff} staff · {branch.loans.toLocaleString()} txns
                        </div>
                      </div>
                      <MapPinned size={16} className="shrink-0 text-slate-400" />
                    </div>
                  ))}
                  {!tabBranches.length ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      No {tabMeta.label} branch collections this month.
                    </p>
                  ) : null}
                </div>
              </ChartCard>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}


function GenericSection({ section }) {
  return (
    <>
      <div className="rounded-2xl border border-[#EF5322]/20 bg-[#FFF8F5] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white p-2 text-[#EF5322] shadow-sm"><BookOpenCheck size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Visual framework ready</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              This workspace has been structured for the requested analysis. Metrics activate as the required source fields are connected.
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {section.visuals.map((visual) => <EmptyVisual key={visual} title={visual} source={section.source} />)}
      </div>
    </>
  )
}

function buildAnalytics(employees) {
  const now = new Date()
  const active = employees.filter(isActive).length
  const inactive = employees.length - active
  const branchMap = new Map()
  const departmentMap = new Map()
  const ageMap = new Map(
    ['18–25', '26–35', '36–45', '46–55', '56–65', '65+', 'Not specified'].map((name) => [
      name,
      { name, active: 0, inactive: 0 },
    ]),
  )
  const roleSet = new Set()
  const genderMap = new Map()
  const genderStats = {
    male: { active: 0, exits12m: 0 },
    female: { active: 0, exits12m: 0 },
  }
  const turnoverRoleMap = new Map()
  const movementMap = new Map()
  const tenure = []
  let hires12m = 0

  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    movementMap.set(key, { month: key, hires: 0, exits: 0 })
  }

  const normalizeGenderKey = (value) => {
    const gender = String(value || '').trim().toLowerCase()
    if (gender === 'male' || gender === 'm') return 'male'
    if (gender === 'female' || gender === 'f') return 'female'
    return null
  }

  employees.forEach((employee) => {
    const branch = employeeBranch(employee)
    if (!branchMap.has(branch)) branchMap.set(branch, { name: branch, active: 0, inactive: 0, exits12m: 0 })
    branchMap.get(branch)[isActive(employee) ? 'active' : 'inactive'] += 1

    const role = employeeRole(employee)
    roleSet.add(role)
    const department = String(employee?.department || '').trim() || 'Unassigned'
    if (!departmentMap.has(department)) departmentMap.set(department, { name: department, active: 0, inactive: 0, exits12m: 0 })
    departmentMap.get(department)[isActive(employee) ? 'active' : 'inactive'] += 1

    const birthDate = safeDate(employee.date_of_birth)
    let ageBand = 'Not specified'
    if (birthDate) {
      let age = now.getFullYear() - birthDate.getFullYear()
      const birthdayPending =
        now.getMonth() < birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate())
      if (birthdayPending) age -= 1
      if (age >= 18 && age <= 25) ageBand = '18–25'
      else if (age <= 35 && age > 25) ageBand = '26–35'
      else if (age <= 45 && age > 35) ageBand = '36–45'
      else if (age <= 55 && age > 45) ageBand = '46–55'
      else if (age <= 65 && age > 55) ageBand = '56–65'
      else if (age > 65 && age <= 120) ageBand = '65+'
    }
    ageMap.get(ageBand)[isActive(employee) ? 'active' : 'inactive'] += 1

    const gender = String(employee?.gender || '').trim() || 'Not specified'
    genderMap.set(gender, (genderMap.get(gender) || 0) + 1)
    const genderKey = normalizeGenderKey(employee?.gender)
    if (genderKey && isActive(employee)) genderStats[genderKey].active += 1
    if (!isActive(employee)) turnoverRoleMap.set(role, (turnoverRoleMap.get(role) || 0) + 1)

    const start = safeDate(employee.contract_start)
    const end = safeDate(employee.contract_end)
    if (start) {
      const years = Math.max(0, (now - start) / 31_556_952_000)
      if (isActive(employee)) tenure.push(years)
      if (now - start <= 365.25 * 86_400_000 && now >= start) hires12m += 1
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
      if (movementMap.has(key)) movementMap.get(key).hires += 1
    }
    if (!isActive(employee) && end) {
      const key = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
      if (movementMap.has(key)) {
        movementMap.get(key).exits += 1
        branchMap.get(branch).exits12m += 1
        departmentMap.get(department).exits12m += 1
        if (genderKey) genderStats[genderKey].exits12m += 1
      }
    }
  })

  const attritionFor = (row) => {
    const base = row.active + row.exits12m
    return base ? (row.exits12m / base) * 100 : 0
  }

  const branchHeadcount = Array.from(branchMap.values())
    .map((row) => ({ ...row, total: row.active + row.inactive, attritionRate: attritionFor(row) }))
    .sort((a, b) => b.total - a.total)

  const departmentHeadcount = Array.from(departmentMap.values())
    .map((row) => ({ ...row, total: row.active + row.inactive, attritionRate: attritionFor(row) }))
    .sort((a, b) => b.total - a.total)

  const tenureBands = [
    { name: '< 1 year', value: tenure.filter((v) => v < 1).length },
    { name: '1–2 years', value: tenure.filter((v) => v >= 1 && v < 3).length },
    { name: '3–5 years', value: tenure.filter((v) => v >= 3 && v < 6).length },
    { name: '6–10 years', value: tenure.filter((v) => v >= 6 && v < 11).length },
    { name: '10+ years', value: tenure.filter((v) => v >= 11).length },
  ]

  const movementTrend = Array.from(movementMap.values())
  const exits12m = movementTrend.reduce((sum, row) => sum + row.exits, 0)
  const attritionBase = active + exits12m
  const attritionRate = attritionBase ? (exits12m / attritionBase) * 100 : 0
  const retentionRate = Math.max(0, 100 - attritionRate)

  const genderAttritionRate = (stats) => {
    const base = stats.active + stats.exits12m
    return base ? (stats.exits12m / base) * 100 : 0
  }

  return {
    active,
    inactive,
    activeRate: employees.length ? (active / employees.length) * 100 : 0,
    formerStaffShare: employees.length ? (inactive / employees.length) * 100 : 0,
    attritionRate,
    retentionRate,
    exits12m,
    ageDistribution: Array.from(ageMap.values()).filter((row) => row.active + row.inactive > 0),
    branchHeadcount,
    departmentHeadcount,
    averageBranchSize: branchHeadcount.length ? active / branchHeadcount.length : 0,
    roleCount: roleSet.size,
    departmentCount: departmentHeadcount.filter((row) => row.name !== 'Unassigned').length || departmentHeadcount.length,
    hires12m,
    averageTenure: tenure.length ? tenure.reduce((sum, value) => sum + value, 0) / tenure.length : 0,
    movementTrend,
    tenureBands,
    turnoverRoles: Array.from(turnoverRoleMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    highRiskBranches: branchHeadcount
      .map((row) => ({ ...row, rate: row.total ? (row.inactive / row.total) * 100 : 0 }))
      .sort((a, b) => b.rate - a.rate),
    genderData: Array.from(genderMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    genderAttrition: {
      male: genderAttritionRate(genderStats.male),
      female: genderAttritionRate(genderStats.female),
    },
  }
}

export default function HRWorkspace() {
  const { section: sectionId } = useParams()
  const section = HR_SECTIONS.find((item) => item.id === sectionId)
  const { employees, loading, error } = useEmployees()
  const analytics = useMemo(() => buildAnalytics(employees), [employees])

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto animate-spin text-[#EF5322]" size={34} />
          <p className="mt-3 text-sm text-slate-500">Building people intelligence workspace…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <h2 className="font-semibold">Unable to load HR workspace</h2>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      <WorkspaceHeader section={section} />
      {!section ? <Overview analytics={analytics} /> : null}
      {section?.id === 'sales-force' ? <SalesForceVisuals /> : null}
      {section?.id === 'collections-quality' ? <CollectionsParVisuals /> : null}
      {section?.id === 'retention' ? <RetentionVisuals analytics={analytics} /> : null}
      {section?.id === 'productivity' ? <ProductivityVisuals analytics={analytics} section={section} /> : null}
      {section && !['sales-force', 'collections-quality', 'retention', 'productivity'].includes(section.id) ? <GenericSection section={section} /> : null}
    </div>
  )
}

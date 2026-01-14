import React from 'react'
import { Routes as RouterRoutes, Route } from 'react-router-dom'

// Import all page components
import LogbookDashboard from './pages/logbook/Dashboard.jsx'
import LogbookDisbursement from './pages/logbook/Disbursement.jsx'
import LogbookCollection from './pages/logbook/Collection.jsx'
import LogbookPAR from './pages/logbook/PAR.jsx'
import LogbookProductivity from './pages/logbook/Productivity.jsx'
import LogbookDemographics from './pages/logbook/Demographics.jsx'

import ZidishaDashboard from './pages/zidisha/Dashboard.jsx'
import ZidishaDisbursement from './pages/zidisha/Disbursement.jsx'
import ZidishaCollection from './pages/zidisha/Collection.jsx'
import ZidishaPAR from './pages/zidisha/PAR.jsx'
import ZidishaProductivity from './pages/zidisha/Productivity.jsx'
import ZidishaDemographics from './pages/zidisha/Demographics.jsx'
import { ZidishaBranchProvider } from './context/ZidishaBranchContext.jsx'

import AdvansDashboard from './pages/advans/Dashboard.jsx'
import AdvansDisbursement from './pages/advans/Disbursement.jsx'
import AdvansCollection from './pages/advans/Collection.jsx'
import AdvansPAR from './pages/advans/PAR.jsx'
import AdvansProductivity from './pages/advans/Productivity.jsx'

import BodaDashboard from './pages/boda/Dashboard.jsx'
import BodaDisbursement from './pages/boda/Disbursement.jsx'
import BodaCollection from './pages/boda/Collection.jsx'
import BodaPAR from './pages/boda/PAR.jsx'
import BodaProductivity from './pages/boda/Productivity.jsx'

import KajeaClients from './pages/kajea/Clients.jsx'

import InsuranceDashboard from './pages/insurance/Dashboard.jsx'
import HRDashboard from './pages/hr/Dashboard.jsx'
import HRAnalytics from './pages/hr/Analytics.jsx'
import HRDemographics from './pages/hr/Demographics.jsx'
import HRDepartments from './pages/hr/Departments.jsx'
import HRBranches from './pages/hr/Branches.jsx'
import HRContracts from './pages/hr/Contracts.jsx'
import HRDirectory from './pages/hr/Directory.jsx'
import HRReports from './pages/hr/Reports.jsx'
import DataOverview from './pages/data/Overview.jsx'
import DataBranches from './pages/data/Branches.jsx'
import DataUsers from './pages/data/Users.jsx'
import DataLoanOfficers from './pages/data/LoanOfficers.jsx'
import LogbookTargets from './pages/data/LogbookTargets.jsx'
import ZidishaTargets from './pages/data/ZidishaTargets.jsx'
import SignIn from './pages/auth/SignIn.jsx'
import SuperuserSignIn from './pages/auth/SuperuserSignIn.jsx'
import RequireAuth from './components/RequireAuth.jsx'

const LOGBOOK_ROLES = ['superuser', 'admin', 'manager', 'logbook']
const ZIDISHA_ROLES = ['superuser', 'admin', 'manager', 'zidisha']
const ADVANS_ROLES = ['superuser', 'admin', 'manager', 'advans']
const BODA_ROLES = ['superuser', 'admin', 'manager', 'boda']
const ADMIN_ONLY = ['superuser', 'admin']

function Routes() {
  return (
    <RouterRoutes>
      <Route path="/login" element={<SignIn />} />
      <Route path="/done" element={<SuperuserSignIn />} />

      {/* Default route */}
      <Route path="/" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDashboard /></RequireAuth>} />
      
      {/* Logbook routes */}
      <Route path="/logbook/dashboard" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDashboard /></RequireAuth>} />
      <Route path="/logbook/disbursement" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDisbursement /></RequireAuth>} />
      <Route path="/logbook/collection" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookCollection /></RequireAuth>} />
      <Route path="/logbook/par" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookPAR /></RequireAuth>} />
      <Route path="/logbook/productivity" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookProductivity /></RequireAuth>} />
      <Route path="/logbook/demographics" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDemographics /></RequireAuth>} />
      
      {/* Zidisha routes */}
      <Route path="/zidisha/dashboard" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaDashboard /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/disbursement" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaDisbursement /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/collection" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaCollection /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/productivity" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaProductivity /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/demographics" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaDemographics /></ZidishaBranchProvider></RequireAuth>} />
      
      {/* Advans routes */}
      <Route path="/advans/dashboard" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansDashboard /></RequireAuth>} />
      <Route path="/advans/disbursement" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansDisbursement /></RequireAuth>} />
      <Route path="/advans/collection" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansCollection /></RequireAuth>} />
      <Route path="/advans/productivity" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansProductivity /></RequireAuth>} />
      
      {/* Boda routes */}
      <Route path="/boda/dashboard" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaDashboard /></RequireAuth>} />
      <Route path="/boda/disbursement" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaDisbursement /></RequireAuth>} />
      <Route path="/boda/collection" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaCollection /></RequireAuth>} />
      <Route path="/boda/productivity" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaProductivity /></RequireAuth>} />
      
      {/* Kajea routes */}
      <Route path="/kajea/clients" element={<RequireAuth><KajeaClients /></RequireAuth>} />
      
      {/* Insurance routes */}
      <Route path="/insurance/dashboard" element={<RequireAuth><InsuranceDashboard /></RequireAuth>} />
      
      {/* HR Management routes */}
      <Route path="/hr/dashboard" element={<RequireAuth><HRDashboard /></RequireAuth>} />
      <Route path="/hr/analytics" element={<RequireAuth><HRAnalytics /></RequireAuth>} />
      <Route path="/hr/demographics" element={<RequireAuth><HRDemographics /></RequireAuth>} />
      <Route path="/hr/departments" element={<RequireAuth><HRDepartments /></RequireAuth>} />
      <Route path="/hr/branches" element={<RequireAuth><HRBranches /></RequireAuth>} />
      <Route path="/hr/contracts" element={<RequireAuth><HRContracts /></RequireAuth>} />
      <Route path="/hr/directory" element={<RequireAuth><HRDirectory /></RequireAuth>} />
      <Route path="/hr/reports" element={<RequireAuth><HRReports /></RequireAuth>} />
      <Route path="/data/overview" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataOverview /></RequireAuth>} />
      <Route path="/data/users" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataUsers /></RequireAuth>} />
      {/* Legacy routes - redirect to new paths */}
      <Route path="/data/branches" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataBranches /></RequireAuth>} />
      <Route path="/data/loan-officers" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataLoanOfficers /></RequireAuth>} />
      <Route path="/data/LoanOfficers" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataLoanOfficers /></RequireAuth>} />
      {/* Logbook Data routes */}
      <Route path="/data/logbook/branches" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataBranches /></RequireAuth>} />
      <Route path="/data/logbook/loan-officers" element={<RequireAuth allowedRoles={ADMIN_ONLY}><DataLoanOfficers /></RequireAuth>} />
      <Route path="/data/logbook/targets" element={<RequireAuth allowedRoles={ADMIN_ONLY}><LogbookTargets /></RequireAuth>} />
      {/* Zidisha Data routes */}
      <Route path="/data/zidisha/targets" element={<RequireAuth allowedRoles={ADMIN_ONLY}><ZidishaTargets /></RequireAuth>} />
    </RouterRoutes>
  )
}

export default Routes

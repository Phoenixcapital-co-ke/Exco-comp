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
import ZidishaClientPerformance from './pages/zidisha/ClientPerformance.jsx'
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
import BodaClientPerformance from './pages/boda/ClientPerformance.jsx'
import { BodaBranchProvider } from './context/BodaBranchContext.jsx'

import KajeaClients from './pages/kajea/Clients.jsx'
import OSParkingReport from './pages/kajea/OSParkingReport.jsx'

import InsuranceDashboard from './pages/insurance/Dashboard.jsx'
import HRWorkspace from './pages/hr/Workspace.jsx'
import DataOverview from './pages/data/Overview.jsx'
import DataBranches from './pages/data/Branches.jsx'
import DataUsers from './pages/data/Users.jsx'
import DataLoanOfficers from './pages/data/LoanOfficers.jsx'
import LogbookTargets from './pages/data/LogbookTargets.jsx'
import ROTargets from './pages/data/ROTargets.jsx'
import ZidishaTargets from './pages/data/ZidishaTargets.jsx'
import SignIn from './pages/auth/SignIn.jsx'
import SuperuserSignIn from './pages/auth/SuperuserSignIn.jsx'
import ForgotPassword from './pages/auth/ForgotPassword.jsx'
import ConfirmAccount from './pages/auth/ConfirmAccount.jsx'
import FirstPassword from './pages/auth/FirstPassword.jsx'
import RequireAuth from './components/RequireAuth.jsx'

const LOGBOOK_ROLES = ['superuser', 'admin', 'manager', 'logbook', 'user']
const ZIDISHA_ROLES = ['superuser', 'admin', 'manager', 'zidisha']
const ADVANS_ROLES = ['superuser', 'admin', 'manager', 'advans']
const BODA_ROLES = ['superuser', 'admin', 'manager', 'boda']
const ADMIN_ONLY = ['superuser', 'admin']

function Routes() {
  return (
    <RouterRoutes>
      <Route path="/login" element={<SignIn />} />
      <Route path="/auth/signin" element={<SignIn />} />
      <Route path="/done" element={<SuperuserSignIn />} />
      <Route path="/auth/forgot-password" element={<ForgotPassword />} />
      <Route path="/auth/confirm" element={<ConfirmAccount />} />
      <Route
        path="/auth/first-password"
        element={
          <RequireAuth>
            <FirstPassword />
          </RequireAuth>
        }
      />

      {/* Default route */}
      <Route path="/" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDashboard country="Kenya" /></RequireAuth>} />
      
      {/* Logbook routes */}
      <Route path="/logbook/dashboard" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDashboard /></RequireAuth>} />
      <Route path="/logbook/disbursement" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDisbursement /></RequireAuth>} />
      <Route path="/logbook/collection" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookCollection /></RequireAuth>} />
      <Route path="/logbook/par" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookPAR /></RequireAuth>} />
      <Route path="/logbook/productivity" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookProductivity /></RequireAuth>} />
      <Route path="/logbook/demographics" element={<RequireAuth allowedRoles={LOGBOOK_ROLES}><LogbookDemographics /></RequireAuth>} />
      
      {/* Logbook by country routes (currently Kenya & Uganda) */}
      <Route
        path="/logbook/kenya/dashboard"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookDashboard country="Kenya" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/uganda/dashboard"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookDashboard country="Uganda" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/kenya/disbursement"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookDisbursement country="Kenya" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/uganda/disbursement"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookDisbursement country="Uganda" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/kenya/collection"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookCollection country="Kenya" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/uganda/collection"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookCollection country="Uganda" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/kenya/par"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookPAR country="Kenya" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/uganda/par"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookPAR country="Uganda" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/kenya/productivity"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookProductivity country="Kenya" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/uganda/productivity"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookProductivity country="Uganda" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/kenya/demographics"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookDemographics country="Kenya" />
          </RequireAuth>
        }
      />
      <Route
        path="/logbook/uganda/demographics"
        element={
          <RequireAuth allowedRoles={LOGBOOK_ROLES}>
            <LogbookDemographics country="Uganda" />
          </RequireAuth>
        }
      />
      
      {/* Zidisha routes */}
      <Route path="/zidisha/dashboard" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaDashboard /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/disbursement" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaDisbursement /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/collection" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaCollection /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/client-performance" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaClientPerformance /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/productivity" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaProductivity /></ZidishaBranchProvider></RequireAuth>} />
      <Route path="/zidisha/demographics" element={<RequireAuth allowedRoles={ZIDISHA_ROLES}><ZidishaBranchProvider><ZidishaDemographics /></ZidishaBranchProvider></RequireAuth>} />
      
      {/* Advans routes */}
      <Route path="/advans/dashboard" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansDashboard /></RequireAuth>} />
      <Route path="/advans/disbursement" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansDisbursement /></RequireAuth>} />
      <Route path="/advans/collection" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansCollection /></RequireAuth>} />
      <Route path="/advans/productivity" element={<RequireAuth allowedRoles={ADVANS_ROLES}><AdvansProductivity /></RequireAuth>} />
      
      {/* Boda routes */}
      <Route path="/boda/dashboard" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaBranchProvider><BodaDashboard /></BodaBranchProvider></RequireAuth>} />
      <Route path="/boda/disbursement" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaBranchProvider><BodaDisbursement /></BodaBranchProvider></RequireAuth>} />
      <Route path="/boda/collection" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaBranchProvider><BodaCollection /></BodaBranchProvider></RequireAuth>} />
      <Route path="/boda/client-performance" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaBranchProvider><BodaClientPerformance /></BodaBranchProvider></RequireAuth>} />
      <Route path="/boda/productivity" element={<RequireAuth allowedRoles={BODA_ROLES}><BodaBranchProvider><BodaProductivity /></BodaBranchProvider></RequireAuth>} />
      
      {/* Kajea routes */}
      <Route path="/kajea/clients" element={<RequireAuth><KajeaClients /></RequireAuth>} />
      <Route path="/kajea/os-parking-report" element={<RequireAuth><OSParkingReport /></RequireAuth>} />
      
      {/* Insurance routes */}
      <Route path="/insurance/dashboard" element={<RequireAuth><InsuranceDashboard /></RequireAuth>} />
      
      {/* HR People Intelligence routes */}
      <Route path="/hr/overview" element={<RequireAuth><HRWorkspace /></RequireAuth>} />
      <Route path="/hr/:section" element={<RequireAuth><HRWorkspace /></RequireAuth>} />
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
      <Route path="/data/logbook/ro-targets" element={<RequireAuth allowedRoles={ADMIN_ONLY}><ROTargets /></RequireAuth>} />
      {/* Zidisha Data routes */}
      <Route path="/data/zidisha/targets" element={<RequireAuth allowedRoles={ADMIN_ONLY}><ZidishaTargets /></RequireAuth>} />
    </RouterRoutes>
  )
}

export default Routes

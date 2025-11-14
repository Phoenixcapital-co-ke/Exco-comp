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

import AdvansDashboard from './pages/advans/Dashboard.jsx'
import AdvansDisbursement from './pages/advans/Disbursement.jsx'
import AdvansCollection from './pages/advans/Collection.jsx'
import AdvansPAR from './pages/advans/PAR.jsx'
import AdvansProductivity from './pages/advans/Productivity.jsx'

import KajeaClients from './pages/kajea/Clients.jsx'

import InsuranceDashboard from './pages/insurance/Dashboard.jsx'
import DataOverview from './pages/data/Overview.jsx'
import DataBranches from './pages/data/Branches.jsx'
import DataUsers from './pages/data/Users.jsx'
import SignIn from './pages/auth/SignIn.jsx'
import RequireAuth from './components/RequireAuth.jsx'

// Default dashboard component (already imported above)

function Routes() {
  return (
    <RouterRoutes>
      <Route path="/login" element={<SignIn />} />

      {/* Default route */}
      <Route path="/" element={<RequireAuth><LogbookDashboard /></RequireAuth>} />
      
      {/* Logbook routes */}
      <Route path="/logbook/dashboard" element={<RequireAuth><LogbookDashboard /></RequireAuth>} />
      <Route path="/logbook/disbursement" element={<RequireAuth><LogbookDisbursement /></RequireAuth>} />
      <Route path="/logbook/collection" element={<RequireAuth><LogbookCollection /></RequireAuth>} />
      <Route path="/logbook/par" element={<RequireAuth><LogbookPAR /></RequireAuth>} />
      <Route path="/logbook/productivity" element={<RequireAuth><LogbookProductivity /></RequireAuth>} />
      <Route path="/logbook/demographics" element={<RequireAuth><LogbookDemographics /></RequireAuth>} />
      
      {/* Zidisha routes */}
      <Route path="/zidisha/dashboard" element={<RequireAuth><ZidishaDashboard /></RequireAuth>} />
      <Route path="/zidisha/disbursement" element={<RequireAuth><ZidishaDisbursement /></RequireAuth>} />
      <Route path="/zidisha/collection" element={<RequireAuth><ZidishaCollection /></RequireAuth>} />
      <Route path="/zidisha/par" element={<RequireAuth><ZidishaPAR /></RequireAuth>} />
      <Route path="/zidisha/productivity" element={<RequireAuth><ZidishaProductivity /></RequireAuth>} />
      <Route path="/zidisha/demographics" element={<RequireAuth><ZidishaDemographics /></RequireAuth>} />
      
      {/* Advans routes */}
      <Route path="/advans/dashboard" element={<RequireAuth><AdvansDashboard /></RequireAuth>} />
      <Route path="/advans/disbursement" element={<RequireAuth><AdvansDisbursement /></RequireAuth>} />
      <Route path="/advans/collection" element={<RequireAuth><AdvansCollection /></RequireAuth>} />
      <Route path="/advans/par" element={<RequireAuth><AdvansPAR /></RequireAuth>} />
      <Route path="/advans/productivity" element={<RequireAuth><AdvansProductivity /></RequireAuth>} />
      
      {/* Kajea routes */}
      <Route path="/kajea/clients" element={<RequireAuth><KajeaClients /></RequireAuth>} />
      
      {/* Insurance routes */}
      <Route path="/insurance/dashboard" element={<RequireAuth><InsuranceDashboard /></RequireAuth>} />
      <Route path="/data/overview" element={<RequireAuth><DataOverview /></RequireAuth>} />
      <Route path="/data/branches" element={<RequireAuth><DataBranches /></RequireAuth>} />
      <Route path="/data/users" element={<RequireAuth><DataUsers /></RequireAuth>} />
    </RouterRoutes>
  )
}

export default Routes

import React from 'react'
import { BrowserRouter as Router } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Routes from './routes.jsx'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Router>
        <Layout>
          <Routes />
        </Layout>
      </Router>
    </div>
  )
}

export default App

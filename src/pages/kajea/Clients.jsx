import React from 'react'
import { Users, TrendingUp, UserPlus, Activity } from 'lucide-react'

function KajeaClients() {
  const clientData = [
    { id: 1, name: 'Tech Startup Alpha', industry: 'Software', employees: 25, status: 'Active', joinDate: '2023-08-15' },
    { id: 2, name: 'Digital Agency Beta', industry: 'Marketing', employees: 12, status: 'Active', joinDate: '2023-09-22' },
    { id: 3, name: 'E-commerce Gamma', industry: 'Retail', employees: 8, status: 'Active', joinDate: '2023-10-05' },
    { id: 4, name: 'FinTech Delta', industry: 'Finance', employees: 35, status: 'Active', joinDate: '2023-11-12' },
    { id: 5, name: 'HealthTech Epsilon', industry: 'Healthcare', employees: 18, status: 'Active', joinDate: '2023-12-01' },
    { id: 6, name: 'EdTech Zeta', industry: 'Education', employees: 15, status: 'Active', joinDate: '2024-01-08' }
  ]

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active':
        return 'bg-green-100 text-green-800'
      case 'Inactive':
        return 'bg-gray-100 text-gray-800'
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Kajea - Tech Clients</h1>
        <p className="text-gray-600 mt-2">Manage and track technology client portfolio</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Clients</p>
              <p className="text-2xl font-bold text-gray-900">6</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Users size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Clients</p>
              <p className="text-2xl font-bold text-gray-900">6</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <Activity size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Employees</p>
              <p className="text-2xl font-bold text-gray-900">113</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <UserPlus size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Growth Rate</p>
              <p className="text-2xl font-bold text-gray-900">+25%</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Industry Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Industry Distribution</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Software</span>
              <span className="text-sm font-medium text-gray-900">1 client</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Marketing</span>
              <span className="text-sm font-medium text-gray-900">1 client</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Retail</span>
              <span className="text-sm font-medium text-gray-900">1 client</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Finance</span>
              <span className="text-sm font-medium text-gray-900">1 client</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Healthcare</span>
              <span className="text-sm font-medium text-gray-900">1 client</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Education</span>
              <span className="text-sm font-medium text-gray-900">1 client</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Client Growth</h3>
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <p className="text-gray-500">Chart placeholder - Client growth over time</p>
          </div>
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Client Portfolio</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industry</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employees</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Join Date</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {clientData.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{client.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{client.industry}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{client.employees}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(client.status)}`}>
                      {client.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{client.joinDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default KajeaClients

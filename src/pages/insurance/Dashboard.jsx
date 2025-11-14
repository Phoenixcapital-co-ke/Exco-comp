import React from 'react'
import { Shield, DollarSign, TrendingUp, AlertTriangle, Users, FileText } from 'lucide-react'

function InsuranceDashboard() {
  const stats = [
    { title: 'Total Premiums', value: '$485,000', change: '+12.3%', icon: DollarSign, color: 'text-green-600' },
    { title: 'Active Policies', value: '1,234', change: '+8.7%', icon: Shield, color: 'text-blue-600' },
    { title: 'Claims Paid', value: '$125,000', change: '+5.2%', icon: TrendingUp, color: 'text-purple-600' },
    { title: 'Pending Claims', value: '23', change: '-2.1%', icon: AlertTriangle, color: 'text-orange-600' }
  ]

  const recentClaims = [
    { id: 1, policy: 'POL-001234', client: 'John Smith', amount: '$2,500', type: 'Health', status: 'Approved', date: '2024-01-15' },
    { id: 2, policy: 'POL-001235', client: 'Jane Doe', amount: '$1,800', type: 'Auto', status: 'Pending', date: '2024-01-14' },
    { id: 3, policy: 'POL-001236', client: 'Mike Johnson', amount: '$3,200', type: 'Property', status: 'Under Review', date: '2024-01-13' },
    { id: 4, policy: 'POL-001237', client: 'Sarah Wilson', amount: '$950', type: 'Health', status: 'Approved', date: '2024-01-12' },
    { id: 5, policy: 'POL-001238', client: 'David Brown', amount: '$4,100', type: 'Life', status: 'Pending', date: '2024-01-11' }
  ]

  const getStatusColor = (status) => {
    switch (status) {
      case 'Approved':
        return 'bg-green-100 text-green-800'
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'Under Review':
        return 'bg-blue-100 text-blue-800'
      case 'Rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Insurance Dashboard</h1>
        <p className="text-gray-600 mt-2">Overview of insurance business unit performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Clients</p>
              <p className="text-2xl font-bold text-gray-900">892</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600">
              <Users size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Policy Types</p>
              <p className="text-2xl font-bold text-gray-900">8</p>
            </div>
            <div className="p-3 rounded-lg bg-teal-50 text-teal-600">
              <FileText size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Claim Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">87.5%</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Charts and Recent Claims */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Premium Collection</h3>
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <p className="text-gray-500">Chart placeholder - Premium collection trends</p>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Claims by Type</h3>
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <p className="text-gray-500">Chart placeholder - Claims distribution by type</p>
          </div>
        </div>
      </div>

      {/* Recent Claims Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Claims</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Policy</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentClaims.map((claim) => (
                <tr key={claim.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{claim.policy}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{claim.client}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{claim.amount}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{claim.type}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(claim.status)}`}>
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{claim.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default InsuranceDashboard

import React from 'react'
import { AlertTriangle, TrendingUp, TrendingDown, Clock } from 'lucide-react'

function BodaPAR() {
  const parData = [
    { id: 1, client: 'Frank Anderson', amount: '$2,800', daysPastDue: 20, riskLevel: 'Low' },
    { id: 2, client: 'Grace Taylor', amount: '$3,500', daysPastDue: 45, riskLevel: 'High' },
    { id: 3, client: 'Henry Clark', amount: '$2,200', daysPastDue: 35, riskLevel: 'Medium' },
    { id: 4, client: 'Ivy Martinez', amount: '$4,100', daysPastDue: 55, riskLevel: 'High' },
    { id: 5, client: 'Jack Thompson', amount: '$1,900', daysPastDue: 25, riskLevel: 'Low' }
  ]

  const getRiskColor = (riskLevel) => {
    switch (riskLevel) {
      case 'Low':
        return 'bg-green-100 text-green-800'
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'High':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getRiskIcon = (riskLevel) => {
    switch (riskLevel) {
      case 'Low':
        return <TrendingDown className="text-green-500" size={16} />
      case 'Medium':
        return <Clock className="text-yellow-500" size={16} />
      case 'High':
        return <TrendingUp className="text-red-500" size={16} />
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Boda PAR (Portfolio at Risk)</h1>
        <p className="text-gray-600 mt-2">Monitor Boda loans that are past due and assess risk levels</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">PAR 30+</p>
              <p className="text-2xl font-bold text-gray-900">4.2%</p>
            </div>
            <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total PAR Amount</p>
              <p className="text-2xl font-bold text-gray-900">$14,500</p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-red-600">
              <TrendingUp size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">High Risk Loans</p>
              <p className="text-2xl font-bold text-gray-900">2</p>
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-red-600">
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Days Past Due</p>
              <p className="text-2xl font-bold text-gray-900">36</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Clock size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* PAR Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Portfolio at Risk Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Days Past Due</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk Level</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {parData.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.client}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.amount}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.daysPastDue} days</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getRiskIcon(item.riskLevel)}
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRiskColor(item.riskLevel)}`}>
                        {item.riskLevel}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button className="text-primary-600 hover:text-primary-900">Contact</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default BodaPAR


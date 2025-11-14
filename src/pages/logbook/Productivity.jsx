import React from 'react'
import { Activity, Users, Target, Award } from 'lucide-react'

function LogbookProductivity() {
  const productivityData = [
    { id: 1, staff: 'John Manager', loansProcessed: 45, collectionRate: 96.5, clientsServed: 38 },
    { id: 2, staff: 'Jane Officer', loansProcessed: 52, collectionRate: 94.2, clientsServed: 42 },
    { id: 3, staff: 'Mike Agent', loansProcessed: 38, collectionRate: 97.1, clientsServed: 35 },
    { id: 4, staff: 'Sarah Coordinator', loansProcessed: 41, collectionRate: 95.8, clientsServed: 39 },
    { id: 5, staff: 'David Supervisor', loansProcessed: 48, collectionRate: 98.2, clientsServed: 44 }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Logbook Productivity</h1>
        <p className="text-gray-600 mt-2">Track staff performance and productivity metrics</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Loans Processed</p>
              <p className="text-2xl font-bold text-gray-900">224</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
              <Activity size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Collection Rate</p>
              <p className="text-2xl font-bold text-gray-900">96.4%</p>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-green-600">
              <Target size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Staff</p>
              <p className="text-2xl font-bold text-gray-900">5</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 text-purple-600">
              <Users size={24} />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Top Performer</p>
              <p className="text-2xl font-bold text-gray-900">David</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-50 text-yellow-600">
              <Award size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Productivity Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Staff Productivity Metrics</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Staff Member</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Loans Processed</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Collection Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Clients Served</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {productivityData.map((item) => {
                const performance = item.collectionRate >= 97 ? 'Excellent' : 
                                  item.collectionRate >= 95 ? 'Good' : 'Needs Improvement'
                const performanceColor = item.collectionRate >= 97 ? 'bg-green-100 text-green-800' : 
                                        item.collectionRate >= 95 ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.staff}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.loansProcessed}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.collectionRate}%</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.clientsServed}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${performanceColor}`}>
                        {performance}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default LogbookProductivity

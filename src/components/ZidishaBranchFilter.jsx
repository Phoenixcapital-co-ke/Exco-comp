import React from 'react'
import { useZidishaBranch } from '../context/ZidishaBranchContext.jsx'

export default function ZidishaBranchFilter() {
  const { selectedBranch, setSelectedBranch, branchOptions, isLoading, cleanBranchLabel } = useZidishaBranch()

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">Branch</span>
      <select
        className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
        value={selectedBranch}
        onChange={(e) => setSelectedBranch(e.target.value)}
        disabled={isLoading}
        title="Filter Zidisha pages by branch"
      >
        {branchOptions.map((b) => (
          <option key={b} value={b}>
            {b === 'All' ? 'All branches' : cleanBranchLabel(b)}
          </option>
        ))}
      </select>
    </div>
  )
}



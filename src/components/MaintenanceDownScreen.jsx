import React from 'react'

export const DEFAULT_MAINTENANCE_MESSAGE =
  'A Fatal Exception 0D has occurred on 098B:00000218'

export default function MaintenanceDownScreen({ message }) {
  const text = String(message || '').trim() || DEFAULT_MAINTENANCE_MESSAGE

  return (
    <div className="min-h-screen w-full bg-white" aria-hidden="true">
      <div className="min-h-screen flex items-center justify-center px-6 py-12">
        <p className="font-mono text-sm text-gray-800 text-center max-w-xl leading-relaxed select-none">
          {text}
        </p>
      </div>
    </div>
  )
}

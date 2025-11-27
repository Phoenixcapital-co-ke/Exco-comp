import { useEffect, useState } from 'react'

const DEFAULT_BREAKPOINT = 1024 // px (Tailwind lg)

export function useBreakpoint(breakpoint = DEFAULT_BREAKPOINT) {
  const getMatch = () => {
    if (typeof window === 'undefined') {
      return true
    }
    return window.innerWidth >= breakpoint
  }

  const [matches, setMatches] = useState(getMatch)

  useEffect(() => {
    const handler = () => setMatches(window.innerWidth >= breakpoint)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])

  return matches
}



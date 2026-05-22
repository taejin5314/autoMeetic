import { useEffect, useState } from 'react'

export function useClockMs(): number {
  const [clockMs, setClockMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return clockMs
}

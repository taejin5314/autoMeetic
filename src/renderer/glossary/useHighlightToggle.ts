import { useEffect, useState } from 'react'

const KEY = 'automeetic.showGlossaryHighlights'

export function useHighlightToggle(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(KEY)
    return stored == null ? true : stored === 'true'
  })
  useEffect(() => {
    window.localStorage.setItem(KEY, String(enabled))
  }, [enabled])
  return [enabled, setEnabled]
}

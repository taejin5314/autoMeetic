import { useCallback, useEffect, useState, type RefObject } from 'react'

type UseFullscreenStateResult = {
  isFullscreen: boolean
  toggleFullscreen: () => Promise<void>
}

export function useFullscreenState(
  shellRef: RefObject<HTMLElement | null>
): UseFullscreenStateResult {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      const target = shellRef.current
      if (target?.requestFullscreen) await target.requestFullscreen()
    } catch {
      // Fullscreen is best-effort for sharing mode.
    }
  }, [shellRef])

  return { isFullscreen, toggleFullscreen }
}

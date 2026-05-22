import { useEffect, useState } from 'react'

type Mode = 'freeform' | 'mindmap'
const STORAGE_KEY = 'automeetic.whiteboardMode'

function readInitial(): Mode {
  if (typeof window === 'undefined') return 'freeform'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'mindmap' ? 'mindmap' : 'freeform'
}

function pushToMain(mode: Mode): void {
  const api = window.electronAPI?.whiteboard?.setMode
  if (api) void api(mode)
}

export function WhiteboardModeToggle() {
  const [mode, setMode] = useState<Mode>(readInitial)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode)
    pushToMain(mode)
  }, [mode])

  return (
    <div className="v4p-wb-mode" role="group" aria-label="Diagram mode">
      <button
        type="button"
        className={`v4p-wb-mode-btn ${mode === 'freeform' ? 'on' : ''}`}
        onClick={() => setMode('freeform')}
        aria-pressed={mode === 'freeform'}
      >
        Freeform
      </button>
      <button
        type="button"
        className={`v4p-wb-mode-btn ${mode === 'mindmap' ? 'on' : ''}`}
        onClick={() => setMode('mindmap')}
        aria-pressed={mode === 'mindmap'}
      >
        Mind map
      </button>
    </div>
  )
}

import { useState } from 'react'

export type Shelf = 'whiteboard' | 'actions' | 'coach' | 'closed'

export interface PanelsState {
  shelf: Shelf
  setShelf: React.Dispatch<React.SetStateAction<Shelf>>
  whiteboardMaximized: boolean
  setWhiteboardMaximized: React.Dispatch<React.SetStateAction<boolean>>
  memoryLibraryOpen: boolean
  setMemoryLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>
  glossaryOpen: boolean
  setGlossaryOpen: React.Dispatch<React.SetStateAction<boolean>>
  slackSettingsOpen: boolean
  setSlackSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * Panel + shelf open/close UI state for the app shell.
 * Pure local state — no side effects.
 */
export function usePanels(): PanelsState {
  // V4: collapsible right shelf — 'whiteboard' | 'actions' | 'coach' | 'closed'
  const [shelf, setShelf] = useState<Shelf>('whiteboard')
  const [whiteboardMaximized, setWhiteboardMaximized] = useState(false)
  const [memoryLibraryOpen, setMemoryLibraryOpen] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [slackSettingsOpen, setSlackSettingsOpen] = useState(false)

  return {
    shelf,
    setShelf,
    whiteboardMaximized,
    setWhiteboardMaximized,
    memoryLibraryOpen,
    setMemoryLibraryOpen,
    glossaryOpen,
    setGlossaryOpen,
    slackSettingsOpen,
    setSlackSettingsOpen,
  }
}

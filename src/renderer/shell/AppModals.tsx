import type { ViewportCommand, WhiteboardElement } from '../../main/whiteboard/types'
import type { AskMindMapPayload } from '../../main/whiteboard/askMindMap'
import { GlossaryPanel } from '../glossary/GlossaryPanel'
import { MemoryLibraryPanel } from '../library/MemoryLibraryPanel'
import { SlackSettingsPanel } from '../slack/SlackSettingsPanel'
import { WhiteboardModal } from '../whiteboard/WhiteboardModal'

interface AppModalsProps {
  whiteboardMaximized: boolean
  whiteboardElements: WhiteboardElement[]
  viewportCommand: ViewportCommand | null
  agentStatus: 'idle' | 'thinking' | 'error'
  canvasResetVersion: number
  onWhiteboardElementsChange: (elements: WhiteboardElement[]) => void
  onWhiteboardScreenshot: (image: string) => void
  onWhiteboardClose: () => void
  memoryLibraryOpen: boolean
  onMemoryLibraryClose: () => void
  onSendAskToMindMap: (payload: AskMindMapPayload) => Promise<void>
  slackSettingsOpen: boolean
  onSlackSettingsClose: () => void
  glossaryOpen: boolean
  onGlossaryClose: () => void
}

/** Grouped modal mounts for the app shell — presentational only. */
export function AppModals({
  whiteboardMaximized,
  whiteboardElements,
  viewportCommand,
  agentStatus,
  canvasResetVersion,
  onWhiteboardElementsChange,
  onWhiteboardScreenshot,
  onWhiteboardClose,
  memoryLibraryOpen,
  onMemoryLibraryClose,
  onSendAskToMindMap,
  slackSettingsOpen,
  onSlackSettingsClose,
  glossaryOpen,
  onGlossaryClose,
}: AppModalsProps) {
  return (
    <>
      <WhiteboardModal
        open={whiteboardMaximized}
        elements={whiteboardElements}
        viewportCommand={viewportCommand}
        agentStatus={agentStatus}
        canvasResetVersion={canvasResetVersion}
        onElementsChange={onWhiteboardElementsChange}
        onScreenshot={onWhiteboardScreenshot}
        onClose={onWhiteboardClose}
      />

      <MemoryLibraryPanel
        open={memoryLibraryOpen}
        onClose={onMemoryLibraryClose}
        onSendAskToMindMap={onSendAskToMindMap}
      />
      <SlackSettingsPanel open={slackSettingsOpen} onClose={onSlackSettingsClose} />
      <GlossaryPanel open={glossaryOpen} meetingId={null} onClose={onGlossaryClose} />
    </>
  )
}

import type { ViewportCommand, WhiteboardElement } from '../../main/whiteboard/types'
import { ActionItemsPanel } from '../actions/ActionItemsPanel'
import type { ActionItem } from '../actions/types'
import { ExcalidrawCanvas } from '../whiteboard/ExcalidrawCanvas'
import { WhiteboardLabelLangSelect } from '../whiteboard/WhiteboardLabelLangSelect'

type Shelf = 'whiteboard' | 'actions' | 'closed'
type AgentStatus = 'idle' | 'thinking' | 'error'
type ActionItemPatch = Partial<Pick<ActionItem, 'title' | 'owner' | 'due'>>

type RightShelfProps = {
  shelf: Shelf
  whiteboardElements: WhiteboardElement[]
  actionItemList: ActionItem[]
  canvasResetVersion: number
  viewportCommand: ViewportCommand | null
  agentStatus: AgentStatus
  onShelfChange: (shelf: Shelf) => void
  onWhiteboardMaximize: () => void
  onAcceptActionItem: (id: string) => void
  onDismissActionItem: (id: string) => void
  onDoneActionItem: (id: string) => void
  onUpdateActionItem: (id: string, patch: ActionItemPatch) => void
}

export function RightShelf({
  shelf,
  whiteboardElements,
  actionItemList,
  canvasResetVersion,
  viewportCommand,
  agentStatus,
  onShelfChange,
  onWhiteboardMaximize,
  onAcceptActionItem,
  onDismissActionItem,
  onDoneActionItem,
  onUpdateActionItem,
}: RightShelfProps) {
  if (shelf === 'closed') return null

  return (
    <aside className="v4p-shelf">
      <div className="v4p-shelf-tabs">
        <button
          className={`v4p-shelf-tab ${shelf === 'whiteboard' ? 'on' : ''}`}
          onClick={() => onShelfChange('whiteboard')}
        >
          Whiteboard
          {whiteboardElements.length > 0 && (
            <span className="v4p-shelf-tab-badge amw-mono">
              {whiteboardElements.length}
            </span>
          )}
        </button>
        <button
          className={`v4p-shelf-tab ${shelf === 'actions' ? 'on' : ''}`}
          onClick={() => onShelfChange('actions')}
        >
          Actions
          {actionItemList.length > 0 && (
            <span className="v4p-shelf-tab-badge amw-mono">{actionItemList.length}</span>
          )}
        </button>
        {shelf === 'whiteboard' && <WhiteboardLabelLangSelect />}
        <button
          className="v4p-shelf-x"
          onClick={() => onShelfChange('closed')}
          title="Close panel"
          aria-label="Close panel"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            stroke="currentColor"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          >
            <path d="M2 2l7 7M9 2l-7 7" />
          </svg>
        </button>
      </div>
      <div className="v4p-shelf-body">
        <div
          className={`v4p-shelf-panel ${shelf === 'whiteboard' ? 'on' : ''}`}
          aria-hidden={shelf !== 'whiteboard'}
        >
          <div className="v4p-wb">
            <ExcalidrawCanvas
              key={`canvas-${canvasResetVersion}`}
              elements={whiteboardElements}
              viewportCommand={viewportCommand}
              compact
              onMaximize={onWhiteboardMaximize}
            />
            {whiteboardElements.length === 0 && (
              <div className="v4p-wb-empty">
                <em>Diagram appears here</em> as the agent finds key concepts.
              </div>
            )}
            {agentStatus === 'thinking' && (
              <div className="v4p-wb-badge">
                <span className="v4p-wb-spinner" /> Agent thinking
              </div>
            )}
            {agentStatus === 'error' && (
              <div className="v4p-wb-badge error">Diagram failed</div>
            )}
          </div>
        </div>
        <div
          className={`v4p-shelf-panel ${shelf === 'actions' ? 'on' : ''}`}
          aria-hidden={shelf !== 'actions'}
        >
          <ActionItemsPanel
            items={actionItemList}
            onAccept={onAcceptActionItem}
            onDismiss={onDismissActionItem}
            onDone={onDoneActionItem}
            onUpdate={onUpdateActionItem}
          />
        </div>
      </div>
    </aside>
  )
}

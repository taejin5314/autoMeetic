import { useTranslation } from 'react-i18next'
import type { ViewportCommand, WhiteboardElement } from '../../main/whiteboard/types'
import { ActionItemsPanel } from '../actions/ActionItemsPanel'
import type { ActionItem } from '../actions/types'
import { CoachFeed } from '../coach/CoachFeed'
import { useCoachFeed } from '../coach/useCoachFeed'
import { ExcalidrawCanvas } from '../whiteboard/ExcalidrawCanvas'
import { WhiteboardLabelLangSelect } from '../whiteboard/WhiteboardLabelLangSelect'
import type { Shelf } from './usePanels'

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
  onOpenCluster: (clusterId: string) => void
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
  onOpenCluster,
}: RightShelfProps) {
  const { t } = useTranslation()
  if (shelf === 'closed') return null

  return (
    <aside className="v4p-shelf">
      <div className="v4p-shelf-tabs">
        <button
          className={`v4p-shelf-tab ${shelf === 'whiteboard' ? 'on' : ''}`}
          onClick={() => onShelfChange('whiteboard')}
        >
          {t('rightShelf.whiteboard')}
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
          {t('rightShelf.actions')}
          {actionItemList.length > 0 && (
            <span className="v4p-shelf-tab-badge amw-mono">{actionItemList.length}</span>
          )}
        </button>
        <button
          className={`v4p-shelf-tab ${shelf === 'coach' ? 'on' : ''}`}
          onClick={() => onShelfChange('coach')}
        >
          {t('coach.tabLabel')}
        </button>
        {shelf === 'whiteboard' && <WhiteboardLabelLangSelect />}
        <button
          className="v4p-shelf-x"
          onClick={() => onShelfChange('closed')}
          title={t('rightShelf.closePanel')}
          aria-label={t('rightShelf.closePanel')}
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
                <em>{t('rightShelf.diagramEmptyLead')}</em>{' '}
                {t('rightShelf.diagramEmptyRest')}
              </div>
            )}
            {agentStatus === 'thinking' && (
              <div className="v4p-wb-badge">
                <span className="v4p-wb-spinner" /> {t('rightShelf.agentThinking')}
              </div>
            )}
            {agentStatus === 'error' && (
              <div className="v4p-wb-badge error">{t('rightShelf.diagramFailed')}</div>
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
        <div
          className={`v4p-shelf-panel ${shelf === 'coach' ? 'on' : ''}`}
          aria-hidden={shelf !== 'coach'}
        >
          {shelf === 'coach' && <CoachShelfPanel onOpenCluster={onOpenCluster} />}
        </div>
      </div>
    </aside>
  )
}

function CoachShelfPanel({ onOpenCluster }: { onOpenCluster: (clusterId: string) => void }) {
  const { cards, dismiss, clearAll } = useCoachFeed()
  return (
    <CoachFeed
      cards={cards}
      dismiss={dismiss}
      clearAll={clearAll}
      onOpenCluster={onOpenCluster}
    />
  )
}

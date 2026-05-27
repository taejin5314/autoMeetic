import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ViewportCommand, WhiteboardElement } from '../../main/whiteboard/types'
import { ExcalidrawCanvas } from './ExcalidrawCanvas'

interface WhiteboardModalProps {
  open: boolean
  elements: WhiteboardElement[]
  viewportCommand: ViewportCommand | null
  agentStatus: 'idle' | 'thinking' | 'error'
  canvasResetVersion: number
  onElementsChange: (elements: WhiteboardElement[]) => void
  onScreenshot: (image: string) => void
  onClose: () => void
}

export function WhiteboardModal({
  open,
  elements,
  viewportCommand,
  agentStatus,
  canvasResetVersion,
  onElementsChange,
  onScreenshot,
  onClose,
}: WhiteboardModalProps): ReactElement | null {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="v4p-wb-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('whiteboard.modal.aria')}
      onClick={onClose}
    >
      <div
        className="v4p-wb-modal-container"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="v4p-wb-modal-header">
          <div className="v4p-wb-modal-title">
            <em>{t('whiteboard.modal.title')}</em>
            {agentStatus === 'thinking' && (
              <span className="v4p-wb-modal-status">
                <span className="v4p-wb-spinner" /> {t('whiteboard.modal.agentThinking')}
              </span>
            )}
            {agentStatus === 'error' && (
              <span className="v4p-wb-modal-status error">{t('whiteboard.modal.agentError')}</span>
            )}
          </div>
          <div className="v4p-wb-modal-actions">
            <kbd className="v4p-wb-modal-hint">ESC</kbd>
            <button
              type="button"
              className="v4p-wb-modal-close"
              onClick={onClose}
              aria-label={t('whiteboard.modal.closeAria')}
              title={t('whiteboard.modal.closeTitle')}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              >
                <path d="M2 2l9 9M11 2l-9 9" />
              </svg>
            </button>
          </div>
        </div>
        <div className="v4p-wb-modal-body">
          <ExcalidrawCanvas
            key={`canvas-modal-${canvasResetVersion}`}
            elements={elements}
            onElementsChange={onElementsChange}
            onScreenshot={onScreenshot}
            viewportCommand={viewportCommand}
          />
        </div>
      </div>
    </div>
  )
}

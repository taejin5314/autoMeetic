import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerAssistStatus } from './types'

interface AnswerAssistCardProps {
  status: AnswerAssistStatus
  searchQuery: string | null
  answer: string
  answerKo: string
  errorMessage: string | null
  onDismiss: () => void
  onCopy: (section: 'source' | 'ko') => Promise<void>
}

export function AnswerAssistCard({
  status,
  searchQuery,
  answer,
  answerKo,
  errorMessage,
  onDismiss,
  onCopy,
}: AnswerAssistCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  )
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [copiedSection, setCopiedSection] = useState<'source' | 'ko' | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return
      const card = cardRef.current
      if (!card) return
      const rect = card.getBoundingClientRect()
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos?.x ?? rect.left,
        origY: pos?.y ?? rect.top,
      }
      card.setPointerCapture(e.pointerId)
    },
    [pos]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) })
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleCopy = useCallback(
    async (section: 'source' | 'ko') => {
      await onCopy(section)
      setCopiedSection(section)
      setTimeout(() => setCopiedSection(null), 1500)
    },
    [onCopy]
  )

  if (status === 'idle') return null

  const posStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {}

  return (
    <div
      ref={cardRef}
      className="answer-assist-card"
      style={posStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="answer-assist-header">
        <span className="answer-assist-title">Answer Assist</span>
        <button
          type="button"
          className="answer-assist-close"
          onClick={onDismiss}
          aria-label="Close"
        >
          x
        </button>
      </div>

      <div className="answer-assist-body">
        {status === 'loading' && (
          <div className="answer-assist-loading">Preparing answer...</div>
        )}

        {status === 'searching' && searchQuery && (
          <div className="answer-assist-searching">
            <span className="answer-assist-search-icon" aria-hidden="true">
              *
            </span>
            Searching "{searchQuery}"...
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div className="answer-assist-error">{errorMessage}</div>
        )}

        {(status === 'streaming' || status === 'done') && (
          <>
            {answer && (
              <div className="answer-assist-section">
                <div className="answer-assist-text source">{answer}</div>
              </div>
            )}
            {answerKo && (
              <>
                <div className="answer-assist-divider" />
                <div className="answer-assist-section">
                  <div className="answer-assist-text ko">{answerKo}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {status === 'done' && (
        <div className="answer-assist-footer">
          <button
            type="button"
            className="answer-assist-copy-btn"
            onClick={() => void handleCopy('source')}
          >
            {copiedSection === 'source' ? 'Copied!' : 'Copy Source'}
          </button>
          <button
            type="button"
            className="answer-assist-copy-btn"
            onClick={() => void handleCopy('ko')}
          >
            {copiedSection === 'ko' ? 'Copied!' : 'Copy KR'}
          </button>
        </div>
      )}
    </div>
  )
}

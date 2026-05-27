import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnswerAssistStatus } from './types'

interface AnswerAssistCardProps {
  status: AnswerAssistStatus
  searchQuery: string | null
  answer: string
  answerKo: string
  targetLang: string
  errorMessage: string | null
  onDismiss: () => void
  onCopy: (section: 'source' | 'ko') => Promise<void>
}

export function AnswerAssistCard({
  status,
  searchQuery,
  answer,
  answerKo,
  targetLang,
  errorMessage,
  onDismiss,
  onCopy,
}: AnswerAssistCardProps) {
  const { t } = useTranslation()
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
  const targetLabel = targetLang === 'off' ? t('answerAssist.translation') : targetLang.toUpperCase()

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
        <span className="answer-assist-title">{t('answerAssist.title')}</span>
        <button
          type="button"
          className="answer-assist-close"
          onClick={onDismiss}
          aria-label={t('answerAssist.close')}
        >
          x
        </button>
      </div>

      <div className="answer-assist-body">
        {status === 'loading' && (
          <div className="answer-assist-loading">{t('answerAssist.preparing')}</div>
        )}

        {status === 'searching' && searchQuery && (
          <div className="answer-assist-searching">
            <span className="answer-assist-search-icon" aria-hidden="true">
              *
            </span>
            {t('answerAssist.searching', { query: searchQuery })}
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
            {copiedSection === 'source' ? t('answerAssist.copied') : t('answerAssist.copySource')}
          </button>
          {answerKo && (
            <button
              type="button"
              className="answer-assist-copy-btn primary"
              onClick={() => void handleCopy('ko')}
            >
              {copiedSection === 'ko'
                ? t('answerAssist.copied')
                : t('answerAssist.copyTarget', { target: targetLabel })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

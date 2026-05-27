import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GlossarySuggestion } from './types'

interface Props {
  suggestion: GlossarySuggestion
  onAccept: (id: string) => Promise<void>
  onDismiss: (id: string) => Promise<void>
}

function formatMetaTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function SuggestionRow({ suggestion, onAccept, onDismiss }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAccept = async () => {
    setError(null)
    setBusy('accept')
    try {
      await onAccept(suggestion.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const handleDismiss = async () => {
    setError(null)
    setBusy('dismiss')
    try {
      await onDismiss(suggestion.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const translationPill = (() => {
    const entries = Object.entries(suggestion.translations)
    if (entries.length === 0) {
      if (suggestion.preserve) return <span className="glossary-preserve-chip">{t('glossary.panel.preserve')}</span>
      return <span className="glossary-row-empty">-</span>
    }
    return (
      <span className="glossary-translation-pill">
        <em className="amw-mono">{entries[0][0]}</em>: {entries[0][1]}
      </span>
    )
  })()

  const confidencePct = Math.round(suggestion.confidence * 100)

  return (
    <div className={`glossary-suggestion-row${busy ? ' is-busy' : ''}`}>
      <div className="glossary-suggestion-main">
        <div className="glossary-suggestion-term amw-mono">{suggestion.sourceTerm}</div>
        <div className="glossary-suggestion-translation">{translationPill}</div>
        <div className="glossary-suggestion-actions">
          <button
            type="button"
            className="glossary-suggestion-accept"
            onClick={handleAccept}
            disabled={busy !== null}
          >
            {t('glossary.suggestions.accept')}
          </button>
          <button
            type="button"
            className="glossary-suggestion-dismiss"
            onClick={handleDismiss}
            disabled={busy !== null}
          >
            {t('glossary.suggestions.dismiss')}
          </button>
        </div>
      </div>
      <div className="glossary-suggestion-meta">
        {suggestion.reason && <span>{suggestion.reason}</span>}
        <span>{confidencePct}%</span>
        <span>{t('glossary.suggestions.meetingTime', { time: formatMetaTime(suggestion.createdAt) })}</span>
      </div>
      {error && <div className="glossary-suggestion-error">{error}</div>}
    </div>
  )
}

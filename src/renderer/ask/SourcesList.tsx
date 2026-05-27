import { useTranslation } from 'react-i18next'
import type { ChatSource } from './types'

interface Props {
  sources: ChatSource[]
  onClickSource: (source: ChatSource) => void
}

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDate(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

export function SourcesList({ sources, onClickSource }: Props) {
  const { t } = useTranslation()
  if (sources.length === 0) return null
  return (
    <div className="ask-sources">
      <div className="ask-sources-title">{t('ask.sources.title')}</div>
      <ul className="ask-sources-list">
        {sources.map((source) => (
          <li key={source.marker}>
            <button
              type="button"
              className="ask-sources-item"
              onClick={() => onClickSource(source)}
            >
              <span className="ask-sources-marker amw-mono">{source.marker}</span>
              <span className="ask-sources-meta">
                {source.meetingTitle} | {formatDate(source.meetingStartedAt)}{' '}
                {formatMmSs(source.timestampMs)}
              </span>
              <span className="ask-sources-preview">"{source.segmentText}"</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

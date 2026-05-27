import { useEffect, useState } from 'react'
import { AskTab } from '../ask/AskTab'
import type { ChatSource } from '../ask/types'
import { MeetingsTab } from './MeetingsTab'

interface MemoryLibraryPanelProps {
  open: boolean
  onClose: () => void
  onSendAskToMindMap?: (payload: {
    question: string
    answer: string
    sources: ChatSource[]
  }) => Promise<void>
}

type Tab = 'meetings' | 'ask'

export function MemoryLibraryPanel({ open, onClose, onSendAskToMindMap }: MemoryLibraryPanelProps) {
  const [tab, setTab] = useState<Tab>('meetings')
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [highlightSegmentId, setHighlightSegmentId] = useState<string | null>(null)
  const [meetingCount, setMeetingCount] = useState(0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleCitationClick = (source: ChatSource) => {
    setTab('meetings')
    setSelectedMeetingId(source.meetingId)
    if (source.segmentId) {
      setHighlightSegmentId(source.segmentId)
      window.setTimeout(() => setHighlightSegmentId(null), 1800)
    }
  }

  return (
    <div
      className="memory-panel-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Meeting Library"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section className="memory-panel">
        <header className="memory-panel-head">
          <div>
            <span className="memory-kicker">Library</span>
            <h2>Meeting Memory</h2>
          </div>
          <button
            className="memory-icon-btn"
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </header>

        <div className="memory-library-tabs" role="tablist" aria-label="Meeting memory sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'meetings'}
            className={`memory-library-tab ${tab === 'meetings' ? 'on' : ''}`}
            onClick={() => setTab('meetings')}
          >
            Meetings{meetingCount > 0 ? ` (${meetingCount})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ask'}
            className={`memory-library-tab ${tab === 'ask' ? 'on' : ''}`}
            onClick={() => setTab('ask')}
          >
            Ask
          </button>
        </div>

        <div className="memory-library-body">
          {tab === 'meetings' ? (
            <MeetingsTab
              selectedMeetingId={selectedMeetingId}
              onSelectMeeting={setSelectedMeetingId}
              highlightSegmentId={highlightSegmentId}
              onMeetingCountChange={setMeetingCount}
            />
          ) : (
            <AskTab
              meetingCount={meetingCount}
              onCitationClick={handleCitationClick}
              onSendToMindMap={onSendAskToMindMap}
            />
          )}
        </div>
      </section>
    </div>
  )
}

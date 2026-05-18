import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MeetingDetail, MeetingSummary, SearchHit } from '../../main/memory/types'

interface MemoryLibraryPanelProps {
  open: boolean
  onClose: () => void
}

type DetailState =
  | { status: 'idle'; meeting: MeetingDetail | null }
  | { status: 'loading'; meeting: MeetingDetail | null }
  | { status: 'error'; meeting: MeetingDetail | null; message: string }

function formatMeetingTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return 'Live'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function getMemoryApi() {
  return window.electronAPI?.memory ?? null
}

export function MemoryLibraryPanel({ open, onClose }: MemoryLibraryPanelProps) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState>({ status: 'idle', meeting: null })
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const api = getMemoryApi()

  const loadMeetings = useCallback(async () => {
    if (!api) return
    const next = await api.listMeetings({ limit: 50 })
    setMeetings(next)
    if (!selectedId && next[0]) setSelectedId(next[0].meeting.id)
  }, [api, selectedId])

  const loadDetail = useCallback(
    async (id: string) => {
      if (!api) return
      setDetail((current) => ({ status: 'loading', meeting: current.meeting }))
      try {
        const next = await api.getMeeting(id)
        setDetail({ status: 'idle', meeting: next })
      } catch (err) {
        setDetail({
          status: 'error',
          meeting: null,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [api]
  )

  useEffect(() => {
    if (!open || !api) return
    const timeout = window.setTimeout(() => {
      void loadMeetings().catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [api, loadMeetings, open])

  useEffect(() => {
    if (!open || !api || !selectedId) return
    const timeout = window.setTimeout(() => {
      void loadDetail(selectedId)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [api, loadDetail, open, selectedId])

  useEffect(() => {
    if (!api) return undefined
    return api.onMeetingUpdated(() => {
      if (!open) return
      void loadMeetings()
      if (selectedId) void loadDetail(selectedId)
    })
  }, [api, loadDetail, loadMeetings, open, selectedId])

  useEffect(() => {
    if (!api || !open) return
    const trimmed = query.trim()
    if (!trimmed) return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void api.search(trimmed, 12).then((next) => {
        if (!cancelled) setHits(next)
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [api, open, query])

  const selectedMeeting = detail.meeting
  const titleDraft = selectedMeeting?.meeting.title ?? ''
  const summary = selectedMeeting?.summary
  const segments = selectedMeeting?.segments ?? []

  const actionItems = useMemo(() => summary?.actionItems ?? [], [summary])

  async function refreshSelected() {
    if (!selectedId) return
    await Promise.all([loadMeetings(), loadDetail(selectedId)])
  }

  async function renameSelected() {
    if (!api || !selectedMeeting) return
    const nextTitle = window.prompt('Rename meeting', selectedMeeting.meeting.title)?.trim()
    if (!nextTitle || nextTitle === selectedMeeting.meeting.title) return
    setBusy(true)
    try {
      await api.renameMeeting(selectedMeeting.meeting.id, nextTitle)
      await refreshSelected()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (!api || !selectedMeeting) return
    const ok = window.confirm(`Delete "${selectedMeeting.meeting.title}"?`)
    if (!ok) return
    setBusy(true)
    try {
      await api.deleteMeeting(selectedMeeting.meeting.id)
      setSelectedId(null)
      setDetail({ status: 'idle', meeting: null })
      await loadMeetings()
    } finally {
      setBusy(false)
    }
  }

  async function exportSelected() {
    if (!api || !selectedMeeting) return
    setBusy(true)
    try {
      const markdown = await api.exportMeeting(selectedMeeting.meeting.id, 'markdown')
      await navigator.clipboard.writeText(markdown)
    } finally {
      setBusy(false)
    }
  }

  async function regenerateSummary() {
    if (!api || !selectedMeeting) return
    setBusy(true)
    try {
      await api.regenerateSummary(selectedMeeting.meeting.id)
      await refreshSelected()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="memory-panel-backdrop" role="dialog" aria-modal="true" aria-label="Meeting Library">
      <section className="memory-panel">
        <header className="memory-panel-head">
          <div>
            <span className="memory-kicker">Library</span>
            <h2>Meeting Memory</h2>
          </div>
          <button className="memory-icon-btn" type="button" onClick={onClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </header>

        {!api ? (
          <div className="memory-empty">Memory is available in the desktop app.</div>
        ) : (
          <div className="memory-panel-grid">
            <aside className="memory-list-pane">
              <label className="memory-search">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="6" cy="6" r="4" />
                  <path d="M9.5 9.5L12 12" />
                </svg>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
              </label>
              {error && <div className="memory-error">{error}</div>}
              {query.trim() ? (
                <div className="memory-hit-list amw-scroll">
                  {hits.map((hit) => (
                    <button
                      key={`${hit.meetingId}-${hit.segmentId}`}
                      type="button"
                      className="memory-hit"
                      onClick={() => setSelectedId(hit.meetingId)}
                    >
                      <span>{hit.meetingTitle}</span>
                      <mark>{Math.round(hit.score * 100)}%</mark>
                      <small>{hit.sourceText}</small>
                    </button>
                  ))}
                  {hits.length === 0 && <div className="memory-empty compact">No matches</div>}
                </div>
              ) : (
                <div className="memory-meeting-list amw-scroll">
                  {meetings.map((item) => (
                    <button
                      key={item.meeting.id}
                      type="button"
                      className={`memory-meeting-row ${selectedId === item.meeting.id ? 'selected' : ''}`}
                      onClick={() => setSelectedId(item.meeting.id)}
                    >
                      <span>{item.meeting.title}</span>
                      <small>
                        {formatMeetingTime(item.meeting.startedAt)} · {item.meeting.segmentCount} turns
                      </small>
                      {item.shortSummary && <em>{item.shortSummary}</em>}
                    </button>
                  ))}
                  {meetings.length === 0 && <div className="memory-empty compact">No meetings yet</div>}
                </div>
              )}
            </aside>

            <div className="memory-detail-pane">
              {!selectedMeeting ? (
                <div className="memory-empty">{detail.status === 'loading' ? 'Loading...' : 'Select a meeting'}</div>
              ) : (
                <>
                  <div className="memory-detail-top">
                    <div>
                      <h3>{titleDraft}</h3>
                      <p>
                        {formatMeetingTime(selectedMeeting.meeting.startedAt)} ·{' '}
                        {formatDuration(selectedMeeting.meeting.durationMs)} ·{' '}
                        {selectedMeeting.meeting.segmentCount} turns
                      </p>
                    </div>
                    <div className="memory-actions">
                      <button type="button" onClick={renameSelected} disabled={busy} title="Rename" aria-label="Rename meeting">
                        Rename
                      </button>
                      <button type="button" onClick={regenerateSummary} disabled={busy} title="Regenerate summary">
                        Summarize
                      </button>
                      <button type="button" onClick={exportSelected} disabled={busy} title="Copy Markdown export">
                        Export
                      </button>
                      <button type="button" onClick={deleteSelected} disabled={busy} className="danger" title="Delete meeting">
                        Delete
                      </button>
                    </div>
                  </div>

                  {detail.status === 'error' && <div className="memory-error">{detail.message}</div>}

                  <section className="memory-summary-band">
                    <h4>Summary</h4>
                    <p>{summary?.shortSummary ?? 'Summary pending'}</p>
                    {summary?.detailedSummary && <p className="memory-detail-summary">{summary.detailedSummary}</p>}
                    {summary && summary.keyPoints.length > 0 && (
                      <ul>
                        {summary.keyPoints.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {actionItems.length > 0 && (
                    <section className="memory-actions-band">
                      <h4>Action Items</h4>
                      {actionItems.map((item) => (
                        <div className="memory-action-item" key={`${item.text}-${item.owner ?? ''}`}>
                          <span>{item.text}</span>
                          {(item.owner || item.due) && (
                            <small>
                              {[item.owner, item.due].filter(Boolean).join(' · ')}
                            </small>
                          )}
                        </div>
                      ))}
                    </section>
                  )}

                  <section className="memory-transcript amw-scroll">
                    {segments.map((segment) => (
                      <article className="memory-segment" key={segment.id}>
                        <div>
                          <span>{segment.speakerLabel ?? 'Unknown'}</span>
                          <small>#{segment.seq + 1}</small>
                        </div>
                        <p>{segment.sourceText}</p>
                        {segment.translatedText && <blockquote>{segment.translatedText}</blockquote>}
                      </article>
                    ))}
                  </section>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

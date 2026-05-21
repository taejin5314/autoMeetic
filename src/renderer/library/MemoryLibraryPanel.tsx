import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MeetingDetail, MeetingSummary, SearchHit } from '../../main/memory/types'

interface MemoryLibraryPanelProps {
  open: boolean
  onClose: () => void
}

type DetailState =
  | { status: 'idle'; meeting: MeetingDetail | null }
  | { status: 'loading'; meeting: MeetingDetail | null }
  | { status: 'error'; meeting: MeetingDetail | null; message: string }

type ExportLanguageMode = 'source' | 'translation' | 'both'

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

function sanitizeFileName(value: string): string {
  const invalid = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || invalid.has(char) ? '-' : char
  }).join('')
}

function highlightMatches(text: string, query: string): ReactNode {
  const trimmed = query.trim()
  if (!trimmed) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lowerText.indexOf(lowerQuery, cursor)
    if (idx === -1) {
      parts.push(<Fragment key={`text-${parts.length}`}>{text.slice(cursor)}</Fragment>)
      break
    }
    if (idx > cursor) {
      parts.push(<Fragment key={`text-${parts.length}`}>{text.slice(cursor, idx)}</Fragment>)
    }
    parts.push(
      <mark className="memory-match" key={`match-${parts.length}`}>
        {text.slice(idx, idx + trimmed.length)}
      </mark>
    )
    cursor = idx + trimmed.length
  }
  return parts.length > 0 ? parts : text
}

export function MemoryLibraryPanel({ open, onClose }: MemoryLibraryPanelProps) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState>({ status: 'idle', meeting: null })
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null)
  const [exportLanguage, setExportLanguage] = useState<ExportLanguageMode>('both')
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const exportLanguageRef = useRef<ExportLanguageMode>('both')
  const segmentRefs = useRef<Map<string, HTMLElement>>(new Map())

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
    const timeout = window.setTimeout(() => {
      setRenameDraft(null)
      setConfirmDelete(false)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [selectedId])

  useEffect(() => {
    if (!focusSegmentId) return
    const el = segmentRefs.current.get(focusSegmentId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timeout = window.setTimeout(() => {
      setFocusSegmentId((current) => (current === focusSegmentId ? null : current))
    }, 1800)
    return () => window.clearTimeout(timeout)
  }, [focusSegmentId, detail.meeting?.meeting.id])

  function jumpToHit(hit: SearchHit) {
    const targetSegment = hit.kind === 'segment' ? hit.segmentId : null
    if (hit.meetingId !== selectedId) setSelectedId(hit.meetingId)
    setFocusSegmentId(targetSegment)
  }

  useEffect(() => {
    if (!api || !open) return
    const trimmed = query.trim()
    if (!trimmed) {
      const timeout = window.setTimeout(() => {
        setHits([])
        setError(null)
      }, 0)
      return () => window.clearTimeout(timeout)
    }
    let cancelled = false
    const timeout = window.setTimeout(() => {
      api
        .search(trimmed, 12)
        .then((next) => {
          if (cancelled) return
          setHits(next)
          setError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : String(err)
          console.error('[memory] search failed:', err)
          setHits([])
          setError(`Search failed: ${message}`)
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

  function startRename() {
    if (!selectedMeeting) return
    setRenameDraft(selectedMeeting.meeting.title)
  }

  async function commitRename() {
    if (!api || !selectedMeeting || renameDraft === null) return
    const next = renameDraft.trim()
    setRenameDraft(null)
    if (!next || next === selectedMeeting.meeting.title) return
    setBusy(true)
    try {
      await api.renameMeeting(selectedMeeting.meeting.id, next)
      await refreshSelected()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (!api || !selectedMeeting) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await api.deleteMeeting(selectedMeeting.meeting.id)
      setConfirmDelete(false)
      setSelectedId(null)
      setDetail({ status: 'idle', meeting: null })
      await loadMeetings()
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

  async function exportSelected() {
    if (!api || !selectedMeeting) return
    const selectedExportLanguage = exportLanguageRef.current
    setBusy(true)
    setExportMessage(null)
    try {
      const content = await api.exportMeeting(
        selectedMeeting.meeting.id,
        'markdown',
        exportLanguageRef.current
      )
      const suffix =
        selectedExportLanguage === 'source'
          ? 'original'
          : selectedExportLanguage === 'translation'
            ? 'translation'
            : 'both'
      const safeTitle = sanitizeFileName(selectedMeeting.meeting.title)
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeTitle}-${suffix}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setExportMessage('Exported')
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="memory-panel-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Meeting Library"
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

        {!api ? (
          <div className="memory-empty">Memory is available in the desktop app.</div>
        ) : (
          <div className="memory-panel-grid">
            <aside className="memory-list-pane">
              <label className="memory-search">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="6" cy="6" r="4" />
                  <path d="M9.5 9.5L12 12" />
                </svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                />
              </label>
              {error && <div className="memory-error">{error}</div>}
              {query.trim() ? (
                <div className="memory-hit-list amw-scroll">
                  {hits.map((hit, index) => {
                    const previousMeetingId = index > 0 ? hits[index - 1].meetingId : null
                    const showMeetingHeader =
                      hit.kind !== 'title' && hit.meetingId !== previousMeetingId
                    const pct = `${Math.round(hit.score * 100)}%`
                    const meta =
                      hit.kind === 'title'
                        ? `TITLE · ${pct}`
                        : hit.kind === 'summary'
                          ? `SUMMARY · ${pct}`
                          : `#${hit.seq + 1} · ${pct}`
                    return (
                      <button
                        key={`${hit.meetingId}-${hit.kind}-${hit.segmentId ?? 'summary'}`}
                        type="button"
                        className="memory-hit"
                        onClick={() => jumpToHit(hit)}
                      >
                        {showMeetingHeader && (
                          <span className="memory-hit-meeting">{hit.meetingTitle}</span>
                        )}
                        <span className="memory-hit-snippet">
                          {highlightMatches(hit.sourceText, query)}
                        </span>
                        <small className="memory-hit-meta">{meta}</small>
                      </button>
                    )
                  })}
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
                        {formatMeetingTime(item.meeting.startedAt)} · {item.meeting.segmentCount}{' '}
                        turns
                      </small>
                      {item.shortSummary && <em>{item.shortSummary}</em>}
                    </button>
                  ))}
                  {meetings.length === 0 && (
                    <div className="memory-empty compact">No meetings yet</div>
                  )}
                </div>
              )}
            </aside>

            <div className="memory-detail-pane">
              {!selectedMeeting ? (
                <div className="memory-empty">
                  {detail.status === 'loading' ? 'Loading...' : 'Select a meeting'}
                </div>
              ) : (
                <>
                  <div className="memory-detail-top">
                    <div>
                      {renameDraft !== null ? (
                        <input
                          className="memory-rename-input"
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void commitRename()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              setRenameDraft(null)
                            }
                          }}
                        />
                      ) : (
                        <h3>{titleDraft}</h3>
                      )}
                      <p>
                        {formatMeetingTime(selectedMeeting.meeting.startedAt)} ·{' '}
                        {formatDuration(selectedMeeting.meeting.durationMs)} ·{' '}
                        {selectedMeeting.meeting.segmentCount} turns
                      </p>
                    </div>
                    <div className="memory-actions">
                      <button
                        type="button"
                        onClick={startRename}
                        disabled={busy || renameDraft !== null}
                        title="Rename"
                        aria-label="Rename meeting"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={regenerateSummary}
                        disabled={busy}
                        title="Regenerate summary"
                      >
                        Summarize
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelected}
                        disabled={busy}
                        className="danger"
                        title={confirmDelete ? 'Click again to confirm' : 'Delete meeting'}
                      >
                        {confirmDelete ? 'Confirm delete' : 'Delete'}
                      </button>
                      {confirmDelete && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      )}
                      <label className="memory-export-mode">
                        <span>Export</span>
                        <select
                          value={exportLanguage}
                          onChange={(event) => {
                            const nextLanguage = event.target.value as ExportLanguageMode
                            exportLanguageRef.current = nextLanguage
                            setExportLanguage(nextLanguage)
                          }}
                          disabled={busy}
                          aria-label="Export language"
                        >
                          <option value="source">Original</option>
                          <option value="translation">Translation</option>
                          <option value="both">Both</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => void exportSelected()}
                        disabled={busy}
                        title="Export meeting memory"
                      >
                        Export
                      </button>
                    </div>
                  </div>

                  <div className="memory-detail-scroll amw-scroll">
                    {exportMessage && <div className="memory-export-message">{exportMessage}</div>}
                    {detail.status === 'error' && (
                      <div className="memory-error">{detail.message}</div>
                    )}

                    <section className="memory-summary-band">
                      <h4>Summary</h4>
                      <p>
                        {summary?.shortSummary
                          ? highlightMatches(summary.shortSummary, query)
                          : 'Summary pending'}
                      </p>
                      {summary?.detailedSummary && (
                        <p className="memory-detail-summary">
                          {highlightMatches(summary.detailedSummary, query)}
                        </p>
                      )}
                      {summary && summary.keyPoints.length > 0 && (
                        <ul>
                          {summary.keyPoints.map((point) => (
                            <li key={point}>{highlightMatches(point, query)}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {actionItems.length > 0 && (
                      <section className="memory-actions-band">
                        <h4>Action Items</h4>
                        {actionItems.map((item) => (
                          <div
                            className="memory-action-item"
                            key={`${item.text}-${item.owner ?? ''}`}
                          >
                            <span>{highlightMatches(item.text, query)}</span>
                            {(item.owner || item.due) && (
                              <small>{[item.owner, item.due].filter(Boolean).join(' · ')}</small>
                            )}
                          </div>
                        ))}
                      </section>
                    )}

                    <section className="memory-transcript">
                      {segments.map((segment) => {
                        const speaker =
                          segment.speakerLabel && segment.speakerLabel !== 'Unknown'
                            ? segment.speakerLabel
                            : null
                        const isFocused = focusSegmentId === segment.id
                        return (
                          <article
                            className={`memory-segment${isFocused ? ' is-focused' : ''}`}
                            key={segment.id}
                            ref={(node) => {
                              if (node) segmentRefs.current.set(segment.id, node)
                              else segmentRefs.current.delete(segment.id)
                            }}
                          >
                            <div>
                              {speaker && <span>{speaker}</span>}
                              <small>#{segment.seq + 1}</small>
                            </div>
                            <p>{highlightMatches(segment.sourceText, query)}</p>
                            {segment.translatedText && (
                              <blockquote>
                                {highlightMatches(segment.translatedText, query)}
                              </blockquote>
                            )}
                          </article>
                        )
                      })}
                    </section>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

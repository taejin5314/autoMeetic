import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MeetingDetail, MeetingSummary, SearchHit } from '../../main/memory/types'
import { HighlightedText } from '../glossary/HighlightedText'
import { useActiveGlossary } from '../glossary/useActiveGlossary'
import { useHighlightToggle } from '../glossary/useHighlightToggle'
import { formatDate, formatNumber } from '../i18n/format'

interface MeetingsTabProps {
  selectedMeetingId?: string | null
  onSelectMeeting?: (id: string | null) => void
  highlightSegmentId?: string | null
  onMeetingCountChange?: (count: number) => void
}

type DetailState =
  | { status: 'idle'; meeting: MeetingDetail | null }
  | { status: 'loading'; meeting: MeetingDetail | null }
  | { status: 'error'; meeting: MeetingDetail | null; message: string }

type ExportLanguageMode = 'source' | 'translation' | 'both'

function formatMeetingTime(ms: number): string {
  return formatDate(ms, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(ms: number | null, liveLabel: string): string {
  if (!ms || ms < 0) return liveLabel
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${formatNumber(minutes)}:${seconds.toString().padStart(2, '0')}`
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

export function MeetingsTab({
  selectedMeetingId,
  onSelectMeeting,
  highlightSegmentId,
  onMeetingCountChange,
}: MeetingsTabProps) {
  const { t } = useTranslation()
  const [meetings, setMeetings] = useState<MeetingSummary[]>([])
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const selectedId = selectedMeetingId === undefined ? localSelectedId : selectedMeetingId
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
  const activeSegmentId = highlightSegmentId ?? focusSegmentId

  const selectMeeting = useCallback(
    (id: string | null) => {
      setLocalSelectedId(id)
      onSelectMeeting?.(id)
    },
    [onSelectMeeting]
  )

  const loadMeetings = useCallback(async () => {
    if (!api) return
    const next = await api.listMeetings({ limit: 50 })
    setMeetings(next)
    onMeetingCountChange?.(next.length)
    if (!selectedId && next[0]) selectMeeting(next[0].meeting.id)
  }, [api, onMeetingCountChange, selectMeeting, selectedId])

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
    if (!api) return
    const timeout = window.setTimeout(() => {
      void loadMeetings().catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [api, loadMeetings])

  useEffect(() => {
    if (!api || !selectedId) return
    const timeout = window.setTimeout(() => {
      void loadDetail(selectedId)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [api, loadDetail, selectedId])

  useEffect(() => {
    if (!exportMessage) return
    const timeout = window.setTimeout(() => setExportMessage(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [exportMessage])

  useEffect(() => {
    if (!api) return undefined
    return api.onMeetingUpdated(() => {
      void loadMeetings()
      if (selectedId) void loadDetail(selectedId)
    })
  }, [api, loadDetail, loadMeetings, selectedId])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setRenameDraft(null)
      setConfirmDelete(false)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [selectedId])

  useEffect(() => {
    if (!activeSegmentId) return
    const el = segmentRefs.current.get(activeSegmentId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timeout = window.setTimeout(() => {
      setFocusSegmentId((current) => (current === activeSegmentId ? null : current))
    }, 1800)
    return () => window.clearTimeout(timeout)
  }, [activeSegmentId, detail.meeting?.meeting.id])

  function jumpToHit(hit: SearchHit) {
    const targetSegment = hit.kind === 'segment' ? hit.segmentId : null
    if (hit.meetingId !== selectedId) selectMeeting(hit.meetingId)
    setFocusSegmentId(targetSegment)
  }

  useEffect(() => {
    if (!api) return
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
          setError(t('meetings.searchFailed', { message }))
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [api, query, t])

  const selectedMeeting = detail.meeting
  const titleDraft = selectedMeeting?.meeting.title ?? ''
  const summary = selectedMeeting?.summary
  const segments = selectedMeeting?.segments ?? []
  const activeGlossary = useActiveGlossary(selectedMeeting?.meeting.id ?? null)
  const [highlightEnabled] = useHighlightToggle()
  const searchActive = query.trim().length > 0

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
      selectMeeting(null)
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
      setExportMessage(t('meetings.exported'))
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!api ? (
        <div className="memory-empty">{t('meetings.desktopOnly')}</div>
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
                  placeholder={t('meetings.searchPlaceholder')}
                />
              </label>
              {error && <div className="memory-error">{error}</div>}
              {query.trim() ? (
                <div className="memory-hit-list amw-scroll">
                  {hits.map((hit, index) => {
                    const previousMeetingId = index > 0 ? hits[index - 1].meetingId : null
                    const showMeetingHeader =
                      hit.kind !== 'title' && hit.meetingId !== previousMeetingId
                    const pct = formatNumber(hit.score, {
                      style: 'percent',
                      maximumFractionDigits: 0,
                    })
                    const meta =
                      hit.kind === 'title'
                        ? t('meetings.hitTitle', { pct })
                        : hit.kind === 'summary'
                          ? t('meetings.hitSummary', { pct })
                          : t('meetings.hitSegment', { seq: hit.seq + 1, pct })
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
                  {hits.length === 0 && (
                    <div className="memory-empty compact">{t('meetings.noMatches')}</div>
                  )}
                </div>
              ) : (
                <div className="memory-meeting-list amw-scroll">
                  {meetings.map((item) => (
                    <button
                      key={item.meeting.id}
                      type="button"
                      className={`memory-meeting-row ${selectedId === item.meeting.id ? 'selected' : ''}`}
                      onClick={() => selectMeeting(item.meeting.id)}
                    >
                      <span>{item.meeting.title}</span>
                      <small>
                        {formatMeetingTime(item.meeting.startedAt)} ·{' '}
                        {formatNumber(item.meeting.segmentCount)}{' '}
                        {t('meetings.turns')}
                      </small>
                      {item.shortSummary && <em>{item.shortSummary}</em>}
                    </button>
                  ))}
                  {meetings.length === 0 && (
                    <div className="memory-empty compact">{t('meetings.noMeetings')}</div>
                  )}
                </div>
              )}
            </aside>

            <div className="memory-detail-pane">
              {!selectedMeeting ? (
                <div className="memory-empty">
                  {detail.status === 'loading' ? t('meetings.loading') : t('meetings.selectMeeting')}
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
                        {formatDuration(selectedMeeting.meeting.durationMs, t('meetings.live'))} ·{' '}
                        {formatNumber(selectedMeeting.meeting.segmentCount)} {t('meetings.turns')}
                      </p>
                    </div>
                    <div className="memory-actions">
                      <button
                        type="button"
                        onClick={startRename}
                        disabled={busy || renameDraft !== null}
                        title={t('meetings.rename')}
                        aria-label={t('meetings.renameAria')}
                      >
                        {t('meetings.rename')}
                      </button>
                      <button
                        type="button"
                        onClick={regenerateSummary}
                        disabled={busy}
                        title={t('meetings.regenerateSummary')}
                      >
                        {t('meetings.summarize')}
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelected}
                        disabled={busy}
                        className="danger"
                        title={confirmDelete ? t('meetings.confirmDeleteTitle') : t('meetings.deleteTitle')}
                      >
                        {confirmDelete ? t('meetings.confirmDelete') : t('meetings.delete')}
                      </button>
                      {confirmDelete && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          disabled={busy}
                        >
                          {t('meetings.cancel')}
                        </button>
                      )}
                      <label className="memory-export-mode">
                        <span>{t('meetings.export')}</span>
                        <select
                          value={exportLanguage}
                          onChange={(event) => {
                            const nextLanguage = event.target.value as ExportLanguageMode
                            exportLanguageRef.current = nextLanguage
                            setExportLanguage(nextLanguage)
                          }}
                          disabled={busy}
                          aria-label={t('meetings.exportLanguageAria')}
                        >
                          <option value="source">{t('meetings.exportOriginal')}</option>
                          <option value="translation">{t('meetings.exportTranslation')}</option>
                          <option value="both">{t('meetings.exportBoth')}</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => void exportSelected()}
                        disabled={busy}
                        title={t('meetings.exportTitle')}
                      >
                        {t('meetings.export')}
                      </button>
                    </div>
                  </div>

                  <div className="memory-detail-scroll amw-scroll">
                    {exportMessage && <div className="memory-export-message">{exportMessage}</div>}
                    {detail.status === 'error' && (
                      <div className="memory-error">{detail.message}</div>
                    )}

                    <section className="memory-summary-band">
                      <h4>{t('meetings.summary')}</h4>
                      <p>
                        {summary?.shortSummary
                          ? highlightMatches(summary.shortSummary, query)
                          : t('meetings.summaryPending')}
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
                        <h4>{t('meetings.actionItems')}</h4>
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
                        const isFocused = activeSegmentId === segment.id
                        return (
                          <article
                            className={`memory-segment${isFocused ? ' is-focused' : ''}`}
                            data-highlight={isFocused ? 'true' : undefined}
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
                            <p>
                              {searchActive ? (
                                highlightMatches(segment.sourceText, query)
                              ) : (
                                <HighlightedText
                                  text={segment.sourceText}
                                  entries={activeGlossary}
                                  enabled={highlightEnabled}
                                />
                              )}
                            </p>
                            {segment.translatedText && (
                              <blockquote>
                                {searchActive ? (
                                  highlightMatches(segment.translatedText, query)
                                ) : (
                                  <HighlightedText
                                    text={segment.translatedText}
                                    entries={activeGlossary}
                                    enabled={highlightEnabled}
                                  />
                                )}
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
    </>
  )
}

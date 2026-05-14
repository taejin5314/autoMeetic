/**
 * autoMeetic — live meeting transcription + whiteboard powered by AI.
 *
 * Architecture ported from autopreso by Kun Chen (MIT License).
 * https://github.com/kunchenguid/autopreso
 *
 * Key patterns from autopreso:
 * - Audio session ID tracking (correlates audio → transcription)
 * - Analyser node for waveform visualization
 * - Caption pill with auto-truncation
 * - Delta-quiet flushing (handled server-side in proxy.mjs)
 * - Resample from native rate to 24kHz (handled in capture.ts)
 * - Excalidraw whiteboard with AI agent
 */
import '@excalidraw/excalidraw/index.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SystemAudioCaptureService } from '../main/audio/capture'
import { PipelineHealthStore } from '../main/health/pipelineHealth'
import { RealtimeSttClient } from '../main/stt/realtimeClient'
import { TranscriptBus } from '../main/stt/transcriptBus'
import type { TranscriptSegment, TranslationSegment } from '../main/stt/types'
import { log } from '../main/telemetry/logger'
import type { ViewportCommand, WhiteboardElement } from '../main/whiteboard/types'
import { AnswerAssistCard } from './answer-assist/AnswerAssistCard'
import { useAnswerAssistStore } from './answer-assist/useAnswerAssistStore'
import { translate as apiTranslate, isElectron } from './api'
import './App.css'
import { ElectronSttClient } from './electronSttClient'
import { CaptionOverlay } from './overlay/CaptionOverlay'
import { useCaptionStore } from './overlay/useCaptionStore'
import { Waveform } from './overlay/Waveform'
import { ExcalidrawCanvas } from './whiteboard/ExcalidrawCanvas'
import { WhiteboardModal } from './whiteboard/WhiteboardModal'

const LANGUAGE_OPTIONS = [
  { code: 'auto', label: 'Auto detect' },
  { code: 'ko', label: 'Korean' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
]

const LANGUAGE_LABEL_BY_CODE = new Map(
  LANGUAGE_OPTIONS.map((language) => [language.code, language.label])
)
const LOCKABLE_LANGUAGE_CODES = new Set(['ko', 'en', 'ja', 'zh'])
const META_TRANSLATION_RE =
  /\b(this text appears|let me translate|translation|translate it|appears to be a mix)\b/i
const TRANSLATION_CONCURRENCY = 2
const FEED_MAX_WORDS = 15
const FEED_SENTENCE_END_RE = /[.!?。？！]\s*$/
const CAPTION_COMMITTED_HOLD_MS = 3500

type TranslationJob = {
  segment: TranscriptSegment
  targetLang: string
  generation: number
}

type DetectedLanguage = {
  code: string
  confidence: number
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function detectTranscriptLanguage(text: string): DetectedLanguage | null {
  const hangul = countMatches(text, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g)
  const kana = countMatches(text, /[\u3040-\u30ff]/g)
  const han = countMatches(text, /[\u3400-\u4dbf\u4e00-\u9fff]/g)
  const latin = countMatches(text, /[A-Za-z]/g)
  const total = hangul + kana + han + latin
  if (total < 2) return null

  if (hangul >= 2 && hangul >= kana * 2) return { code: 'ko', confidence: hangul / total }
  if (kana >= 2 && kana >= hangul) return { code: 'ja', confidence: kana / total }
  if (han >= 2 && hangul === 0 && kana === 0) return { code: 'zh', confidence: han / total }
  if (latin >= 8 && hangul === 0 && kana === 0 && han === 0)
    return { code: 'en', confidence: latin / total }
  return null
}

function conflictsWithLockedLanguage(text: string, lockedLanguage: string): boolean {
  const hangul = countMatches(text, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g)
  const kana = countMatches(text, /[\u3040-\u30ff]/g)
  const han = countMatches(text, /[\u3400-\u4dbf\u4e00-\u9fff]/g)
  const latin = countMatches(text, /[A-Za-z]/g)

  if (META_TRANSLATION_RE.test(text)) return true
  if (lockedLanguage === 'ko') return kana >= 2 && hangul < 2
  if (lockedLanguage === 'ja') return hangul >= 2 && kana < 2
  if (lockedLanguage === 'zh') return (hangul >= 2 || kana >= 2) && han < 2
  if (lockedLanguage === 'en') return hangul + kana + han >= 4 && latin < 8
  return false
}

function statusClass(status: 'connected' | 'degraded' | 'disconnected'): string {
  if (status === 'connected') return 'dot active'
  if (status === 'degraded') return 'dot degraded'
  return 'dot'
}

function isWhiteboardElement(value: unknown): value is WhiteboardElement {
  if (!value || typeof value !== 'object') return false
  const element = value as Partial<WhiteboardElement>
  return typeof element.id === 'string' && typeof element.type === 'string'
}

function App() {
  const shellRef = useRef<HTMLElement | null>(null)
  const resetTimeoutRef = useRef<number | null>(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [canvasResetVersion, setCanvasResetVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resetConfirming, setResetConfirming] = useState(false)
  const [healthTick, setHealthTick] = useState(0)
  const [activeAudioMs, setActiveAudioMs] = useState(0)
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null)
  const [runStartMs, setRunStartMs] = useState<number | null>(null)
  const [whiteboardConnected, setWhiteboardConnected] = useState(false)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [sttLanguage, setSttLanguage] = useState('auto')
  const [translationTarget, setTranslationTarget] = useState('off')
  const [languageLock, setLanguageLock] = useState<string | null>(null)
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  const [translatingCount, setTranslatingCount] = useState(0)
  // V4: collapsible right shelf — 'whiteboard' | 'actions' | 'closed'
  const [shelf, setShelf] = useState<'whiteboard' | 'actions' | 'closed'>('whiteboard')
  const [whiteboardMaximized, setWhiteboardMaximized] = useState(false)
  const enColRef = useRef<HTMLDivElement>(null)
  const koColRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef(false)
  const {
    items,
    currentPartial,
    applyTranscript,
    applyTranslation,
    clearPartial,
    clear,
    getRecentTranscript,
  } = useCaptionStore()
  const [captionText, setCaptionText] = useState('')
  const answerAssist = useAnswerAssistStore()

  // ── Whiteboard state (autopreso pattern) ──────────────────────────────────
  const [whiteboardElements, setWhiteboardElements] = useState<WhiteboardElement[]>([])
  const [viewportCommand, setViewportCommand] = useState<ViewportCommand | null>(null)
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'error'>('idle')
  const whiteboardWsRef = useRef<WebSocket | null>(null)
  const languageVotesRef = useRef<Record<string, number>>({})
  const lockedLanguageRef = useRef<string | null>(null)
  const reconnectLanguageRef = useRef<string | null>(null)
  const acceptedFinalTranscriptIdsRef = useRef<Set<string>>(new Set())
  const rejectedFinalTranscriptIdsRef = useRef<Set<string>>(new Set())
  const translationQueueRef = useRef<TranslationJob[]>([])
  const translationActiveCountRef = useRef(0)
  const translationTargetRef = useRef(translationTarget)
  const translationGenerationRef = useRef(0)

  // ── Feed accumulation buffer ─────────────────────────────────────────────
  // Accumulates short committed chunks until sentence boundary or 15 words,
  // then flushes to the feed + translation. Whiteboard agent receives commits
  // immediately (separate listener) so it stays fast.
  const feedBufferRef = useRef<{ id: string; createdAtMs: number; text: string } | null>(null)
  const [feedBufferText, setFeedBufferText] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const captionTimerRef = useRef<number | null>(null)

  // Refs to stabilize callback closure: these hold latest versions of functions
  // but don't cause useEffect to re-run when they change
  const shouldAcceptTranscriptRef = useRef<((segment: TranscriptSegment) => boolean) | null>(null)
  const applyTranscriptRef = useRef<((segment: TranscriptSegment) => void) | null>(null)
  const flushFeedBufferRef = useRef<((force?: boolean) => void) | null>(null)
  const clearPartialRef = useRef<(() => void) | null>(null)

  // Stable service instances — same lifecycle pattern as autopreso
  const bus = useMemo(() => new TranscriptBus(), [])
  const capture = useMemo(() => new SystemAudioCaptureService(), [])
  const sttClient = useMemo(
    () => (isElectron ? new ElectronSttClient(bus) : new RealtimeSttClient(bus)),
    [bus]
  )
  const health = useMemo(() => new PipelineHealthStore(), [])

  const updateHealth = useCallback(
    (
      stage: 'capture' | 'stt' | 'translation',
      status: 'connected' | 'degraded' | 'disconnected',
      message?: string
    ) => {
      health.update(stage, status, message)
      setHealthTick((v) => v + 1)
    },
    [health]
  )

  useEffect(() => {
    translationTargetRef.current = translationTarget
    translationGenerationRef.current += 1
    if (translationTarget === 'off') {
      translationQueueRef.current = []
      setTranslatingCount(translationActiveCountRef.current)
    }
  }, [translationTarget])

  const shouldAcceptTranscript = useCallback(
    (segment: TranscriptSegment): boolean => {
      if (segment.isFinal) {
        // Already processed — skip duplicate finals
        if (acceptedFinalTranscriptIdsRef.current.has(segment.id)) return false
        if (rejectedFinalTranscriptIdsRef.current.has(segment.id)) return false
      }

      const text = segment.text.trim()
      const detected = detectTranscriptLanguage(text)
      if (detected && LOCKABLE_LANGUAGE_CODES.has(detected.code)) {
        setDetectedLanguage(detected.code)

        if (segment.isFinal && sttLanguage === 'auto' && detected.confidence >= 0.35) {
          const votes = languageVotesRef.current
          votes[detected.code] = (votes[detected.code] ?? 0) + Math.max(detected.confidence, 0.5)
          const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]
          if (best && best[1] >= 1.5 && lockedLanguageRef.current !== best[0]) {
            lockedLanguageRef.current = best[0]
            setLanguageLock(best[0])
            updateHealth('stt', 'connected', `locked ${best[0]}`)
          }
        }
      }

      const preferredLanguage = sttLanguage === 'auto' ? lockedLanguageRef.current : sttLanguage
      if (!segment.isFinal) return true

      const accepted = !preferredLanguage || !conflictsWithLockedLanguage(text, preferredLanguage)
      if (!accepted) {
        log('warn', 'stt', 'filtered transcript that conflicts with locked language', {
          lockedLanguage: preferredLanguage,
          detectedLanguage: detected?.code ?? 'unknown',
          text: text.slice(0, 120),
        })
        clearPartial()
      }

      if (segment.isFinal) {
        const target = accepted ? acceptedFinalTranscriptIdsRef : rejectedFinalTranscriptIdsRef
        target.current.add(segment.id)
      }
      return accepted
    },
    [clearPartial, sttLanguage, updateHealth]
  )

  // Wire transcript bus → caption store, capture → STT client
  const updateTranslationQueueStatus = useCallback(() => {
    setTranslatingCount(translationActiveCountRef.current + translationQueueRef.current.length)
  }, [])

  const drainTranslationQueue = useCallback(() => {
    const pump = () => {
      while (
        translationActiveCountRef.current < TRANSLATION_CONCURRENCY &&
        translationQueueRef.current.length > 0
      ) {
        const job = translationQueueRef.current.shift()
        if (!job) return

        translationActiveCountRef.current += 1
        updateTranslationQueueStatus()
        updateHealth(
          'translation',
          'degraded',
          `translating ${translationActiveCountRef.current + translationQueueRef.current.length}`
        )

        void apiTranslate(job.segment.text, job.targetLang)
          .then((data) => {
            if (
              translationGenerationRef.current !== job.generation ||
              translationTargetRef.current !== job.targetLang
            ) {
              return
            }
            const translation: TranslationSegment = {
              segmentId: job.segment.id,
              text: data.translation,
              createdAtMs: Date.now(),
              provider: 'openai-async',
            }
            applyTranslation(translation)
          })
          .catch((err) => {
            updateHealth(
              'translation',
              'degraded',
              err instanceof Error ? err.message : String(err)
            )
          })
          .finally(() => {
            translationActiveCountRef.current = Math.max(translationActiveCountRef.current - 1, 0)
            updateTranslationQueueStatus()
            if (translationQueueRef.current.length > 0) {
              queueMicrotask(pump)
            } else if (
              translationGenerationRef.current === job.generation &&
              translationActiveCountRef.current === 0 &&
              translationTargetRef.current !== 'off'
            ) {
              updateHealth('translation', 'connected', `to ${translationTargetRef.current}`)
            }
          })
      }
    }

    pump()
  }, [applyTranslation, updateHealth, updateTranslationQueueStatus])

  const enqueueTranslation = useCallback(
    (segment: TranscriptSegment, targetLang: string) => {
      if (!segment.isFinal || targetLang === 'off') return
      translationQueueRef.current.push({
        segment,
        targetLang,
        generation: translationGenerationRef.current,
      })
      updateTranslationQueueStatus()
      drainTranslationQueue()
    },
    [drainTranslationQueue, updateTranslationQueueStatus]
  )

  /** Flush accumulated feed buffer → applyTranscript + enqueue translation. */
  const flushFeedBuffer = useCallback(
    (force = false) => {
      const buf = feedBufferRef.current
      if (!buf) return
      const text = buf.text.trim()
      if (!text) {
        feedBufferRef.current = null
        setFeedBufferText('')
        return
      }
      const wordCount = text.split(/\s+/).filter(Boolean).length
      if (!force && !FEED_SENTENCE_END_RE.test(text) && wordCount < FEED_MAX_WORDS) return

      const merged: TranscriptSegment = {
        id: buf.id,
        text,
        isFinal: true,
        createdAtMs: buf.createdAtMs,
        source: 'openai-realtime',
      }
      feedBufferRef.current = null
      setFeedBufferText('')
      applyTranscript(merged)

      // Match autopreso: committed text stays visible for 3.5s then clears.
      if (captionTimerRef.current !== null) {
        window.clearTimeout(captionTimerRef.current)
      }
      setCaptionText(text)
      captionTimerRef.current = window.setTimeout(() => {
        setCaptionText('')
        captionTimerRef.current = null
      }, CAPTION_COMMITTED_HOLD_MS)

      const sourceLanguage = sttLanguage === 'auto' ? lockedLanguageRef.current : sttLanguage
      if (
        translationTargetRef.current !== 'off' &&
        translationTargetRef.current !== sourceLanguage
      ) {
        enqueueTranslation(merged, translationTargetRef.current)
      }
    },
    [applyTranscript, enqueueTranslation, sttLanguage]
  )

  // Update refs to hold latest function versions without re-triggering main useEffect
  useEffect(() => {
    shouldAcceptTranscriptRef.current = shouldAcceptTranscript
  }, [shouldAcceptTranscript])
  useEffect(() => {
    applyTranscriptRef.current = applyTranscript
  }, [applyTranscript])
  useEffect(() => {
    flushFeedBufferRef.current = flushFeedBuffer
  }, [flushFeedBuffer])
  useEffect(() => {
    clearPartialRef.current = clearPartial
  }, [clearPartial])

  useEffect(() => {
    const offTranscript = bus.onTranscript((segment) => {
      if (!shouldAcceptTranscriptRef.current?.(segment)) return

      // Match autopreso: partials replace caption text directly.
      if (!segment.isFinal) {
        const text = segment.text.trim()
        if (text) {
          if (captionTimerRef.current !== null) {
            window.clearTimeout(captionTimerRef.current)
            captionTimerRef.current = null
          }
          setCaptionText(text)
        }
        applyTranscriptRef.current?.(segment)
        return
      }

      // Finals: clear partial and accumulate in feed buffer
      clearPartialRef.current?.()
      const text = segment.text.trim()
      if (!text) return
      if (!feedBufferRef.current) {
        feedBufferRef.current = { id: segment.id, createdAtMs: segment.createdAtMs, text }
      } else {
        feedBufferRef.current.text += ' ' + text
      }
      setFeedBufferText(feedBufferRef.current.text)
      flushFeedBufferRef.current?.(false)
    })
    const offCapture = capture.subscribe((chunk) => sttClient.ingest(chunk))

    return () => {
      offTranscript()
      offCapture()
      capture.stop()
      sttClient.disconnect()
    }
  }, [bus, capture, sttClient])

  // V4: auto-scroll bilingual columns to bottom when content changes.
  useEffect(() => {
    if (!autoScroll) return
    const en = enColRef.current
    const ko = koColRef.current
    requestAnimationFrame(() => {
      if (en) en.scrollTop = en.scrollHeight
      if (ko) ko.scrollTop = ko.scrollHeight
    })
  }, [items, feedBufferText, currentPartial, autoScroll])

  // V4: keep the EN and KO column scroll positions linked, and track
  // manual scrolling to toggle the auto-scroll state.
  useEffect(() => {
    const en = enColRef.current
    const ko = koColRef.current
    if (!en) return

    const updateAutoScroll = (el: HTMLDivElement) => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setAutoScroll(isNearBottom)
    }

    const link = (from: HTMLDivElement, to: HTMLDivElement | null) => () => {
      updateAutoScroll(from)
      if (!to || syncingScrollRef.current) return
      syncingScrollRef.current = true
      const denom = from.scrollHeight - from.clientHeight || 1
      const ratio = from.scrollTop / denom
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
      requestAnimationFrame(() => {
        syncingScrollRef.current = false
      })
    }

    const onEn = link(en, ko)
    en.addEventListener('scroll', onEn, { passive: true })
    let onKo: (() => void) | null = null
    if (ko) {
      onKo = link(ko, en)
      ko.addEventListener('scroll', onKo, { passive: true })
    }
    return () => {
      en.removeEventListener('scroll', onEn)
      if (ko && onKo) ko.removeEventListener('scroll', onKo)
    }
  }, [translationTarget])

  useEffect(() => {
    if (!running || sttLanguage !== 'auto' || !languageLock) return
    if (reconnectLanguageRef.current === languageLock) return
    reconnectLanguageRef.current = languageLock

    // Keep the active STT stream stable; only update lock status in UI.
    updateHealth('stt', 'connected', `locked ${languageLock}`)
  }, [languageLock, running, sttLanguage, updateHealth])

  // ── Whiteboard WebSocket connection (autopreso pattern) ───────────────────
  useEffect(() => {
    // Electron mode: listen for whiteboard events via IPC from main process
    if (isElectron) {
      const api = window.electronAPI
      if (!api) return

      const offUpdate = api.onWhiteboardUpdate((data: unknown) => {
        const msg = data as { elements?: unknown[] }
        if (Array.isArray(msg.elements)) {
          const filtered = msg.elements.filter(isWhiteboardElement) as WhiteboardElement[]
          setWhiteboardElements(filtered)
        }
      })

      const offViewport = api.onWhiteboardViewport((data: unknown) => {
        setViewportCommand(data as ViewportCommand)
      })

      const offStatus = api.onWhiteboardAgentStatus((data: unknown) => {
        const msg = data as { status?: string }
        if (msg.status === 'thinking') setAgentStatus('thinking')
        else if (msg.status === 'error') setAgentStatus('error')
        else setAgentStatus('idle')
      })

      setWhiteboardConnected(true)

      return () => {
        offUpdate()
        offViewport()
        offStatus()
        setWhiteboardConnected(false)
      }
    }

    let ws: WebSocket | null = null
    const connectTimer = window.setTimeout(() => {
      const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws/whiteboard`
      ws = new WebSocket(wsUrl)
      whiteboardWsRef.current = ws

      ws.onopen = () => {
        setWhiteboardConnected(true)
      }

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data as string) as Record<string, unknown>
        } catch {
          return
        }

        if (msg.type === 'whiteboard:update' && Array.isArray(msg.elements)) {
          const filtered = msg.elements.filter(isWhiteboardElement) as WhiteboardElement[]
          setWhiteboardElements(filtered)
        }

        if (msg.type === 'whiteboard:viewport') {
          setViewportCommand(msg as unknown as ViewportCommand)
        }

        if (msg.type === 'whiteboard:agent-status') {
          const status = msg.status as string
          if (status === 'thinking') setAgentStatus('thinking')
          else if (status === 'error') setAgentStatus('error')
          else setAgentStatus('idle')
        }
      }

      ws.onclose = () => {
        whiteboardWsRef.current = null
        setWhiteboardConnected(false)
      }
    }, 0)

    return () => {
      window.clearTimeout(connectTimer)
      if (ws) {
        ws.close()
        whiteboardWsRef.current = null
      }
      setWhiteboardConnected(false)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(
    () => () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
      if (captionTimerRef.current !== null) {
        window.clearTimeout(captionTimerRef.current)
      }
    },
    []
  )

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      const target = shellRef.current
      if (target?.requestFullscreen) await target.requestFullscreen()
    } catch {
      // No-op: fullscreen is best-effort for sharing mode.
    }
  }, [])

  // ── Feed transcripts to whiteboard agent ──────────────────────────────────
  useEffect(() => {
    if (!running) return

    const offTranscript = bus.onTranscript((segment) => {
      if (!segment.isFinal) return
      // Skip language-conflicting transcripts but do NOT re-check dedup
      // (the feed handler already recorded the ID in acceptedFinalTranscriptIdsRef)
      const text = segment.text.trim()
      if (!text) return
      const preferredLang = sttLanguage === 'auto' ? lockedLanguageRef.current : sttLanguage
      if (preferredLang && conflictsWithLockedLanguage(text, preferredLang)) return

      const ws = whiteboardWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'whiteboard:agent-run',
            transcript: text,
          })
        )
      }
    })

    return offTranscript
  }, [running, bus, sttLanguage])

  /**
   * Handle user edits on Excalidraw canvas — push to server.
   * Ported from autopreso/public/app.js handleExcalidrawChange()
   */
  const handleWhiteboardChange = useCallback((elements: WhiteboardElement[]) => {
    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:user-elements', elements }))
    }
  }, [])

  const handleWhiteboardScreenshot = useCallback((image: string) => {
    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:screenshot', image }))
    }
  }, [])

  const snapshot = health.getSnapshot()
  void healthTick

  const transcriptCount = items.length
  const sourceWordCount = useMemo(
    () =>
      items.reduce((total, item) => {
        const words = item.sourceText.trim().split(/\s+/).filter(Boolean).length
        return total + words
      }, 0),
    [items]
  )
  const currentRunMs = running && runStartMs !== null ? Math.max(clockMs - runStartMs, 0) : 0
  const totalAudioMs = activeAudioMs + currentRunMs

  const formatDuration = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }, [])

  /**
   * Start listening — connect STT proxy, then start capture.
   * Mirrors autopreso/public/app.js startListening() flow.
   */
  const onStart = useCallback(async () => {
    if (running || starting) return
    setError(null)
    setStarting(true)

    try {
      // 1. Connect to transcription proxy
      updateHealth('stt', 'degraded', 'connecting...')
      await sttClient.connect(sttLanguage)
      updateHealth('stt', 'connected', `OpenAI Realtime ready (${sttLanguage})`)

      // 2. Start system audio capture (prompts user to share tab/window)
      updateHealth('capture', 'degraded', 'requesting display media...')
      await capture.start()
      updateHealth('capture', 'connected', 'system audio active')
      if (sessionStartMs === null) setSessionStartMs(Date.now())
      setRunStartMs(Date.now())

      // 3. Expose analyser for waveform visualization (autopreso pattern)
      setAnalyser(capture.analyser ?? null)

      setRunning(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      updateHealth('stt', 'disconnected', msg)
      updateHealth('capture', 'disconnected', 'not started')
    } finally {
      setStarting(false)
    }
  }, [capture, running, sessionStartMs, starting, sttClient, sttLanguage, updateHealth])

  /**
   * Stop listening — mirrors autopreso/public/app.js stopListening().
   */
  const onStop = useCallback(() => {
    if (runStartMs !== null) {
      const startedAt = runStartMs
      setActiveAudioMs((ms) => ms + (Date.now() - startedAt))
      setRunStartMs(null)
    }
    capture.stop()
    sttClient.disconnect()
    flushFeedBuffer(true)
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current)
      captionTimerRef.current = null
    }
    setCaptionText('')
    setAnalyser(null)
    updateHealth('capture', 'disconnected', 'stopped')
    updateHealth('stt', 'disconnected', 'stopped')
    setRunning(false)
  }, [capture, flushFeedBuffer, runStartMs, sttClient, updateHealth])

  const resetSession = useCallback(() => {
    if (!resetConfirming) {
      setResetConfirming(true)
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = window.setTimeout(() => {
        setResetConfirming(false)
        resetTimeoutRef.current = null
      }, 2500)
      return
    }

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = null
    }

    if (running) onStop()
    clear()
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current)
      captionTimerRef.current = null
    }
    setCaptionText('')
    setError(null)
    setResetConfirming(false)
    setCanvasResetVersion((v) => v + 1)
    setWhiteboardElements([])
    setViewportCommand(null)
    setAgentStatus('idle')
    setWhiteboardMaximized(false)
    setLanguageLock(null)
    setDetectedLanguage(null)
    lockedLanguageRef.current = null
    reconnectLanguageRef.current = null
    languageVotesRef.current = {}
    acceptedFinalTranscriptIdsRef.current.clear()
    rejectedFinalTranscriptIdsRef.current.clear()
    feedBufferRef.current = null
    setFeedBufferText('')
    translationGenerationRef.current += 1
    translationQueueRef.current = []
    setTranslatingCount(translationActiveCountRef.current)
    setActiveAudioMs(0)
    setRunStartMs(null)
    setSessionStartMs(null)
    updateHealth('capture', 'disconnected', 'session reset')
    updateHealth('stt', 'disconnected', 'session reset')
    updateHealth('translation', 'disconnected', 'not connected')

    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:reset' }))
    }
  }, [clear, onStop, resetConfirming, running, updateHealth])

  const triggerAnswerAssist = useCallback(() => {
    if (answerAssist.status === 'loading' || answerAssist.status === 'streaming') return
    const transcript = getRecentTranscript(180_000)
    if (!transcript) return
    const sourceLang = sttLanguage === 'auto' ? (lockedLanguageRef.current ?? 'en') : sttLanguage
    void answerAssist.requestAnswer(transcript, sourceLang)
  }, [answerAssist, getRecentTranscript, sttLanguage])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        triggerAnswerAssist()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [triggerAnswerAssist])

  // ── V4 Bilingual Editorial layout ────────────────────────────────────────
  const sourceLang =
    sttLanguage === 'auto' ? (languageLock ?? detectedLanguage ?? 'auto') : sttLanguage
  const targetLang = translationTarget
  const showTranslationColumn = translationTarget !== 'off'
  const liveText =
    [feedBufferText, currentPartial].filter(Boolean).join(' ').trim() || captionText
  const lastItem = items[items.length - 1]
  const heroSourceText = liveText || lastItem?.sourceText || ''
  const heroTargetText = liveText ? '' : (lastItem?.translatedText ?? '')
  const heroDurationLabel = sessionStartMs ? formatDuration(totalAudioMs) : '00:00'
  const langCode = (code: string) => (code === 'auto' || code === 'off' ? '—' : code.toUpperCase())
  const answerBusy =
    answerAssist.status === 'loading' || answerAssist.status === 'streaming'

  const onLanguageChange = (next: string): void => {
    setSttLanguage(next)
    setLanguageLock(null)
    setDetectedLanguage(null)
    lockedLanguageRef.current = null
    reconnectLanguageRef.current = null
    languageVotesRef.current = {}
    acceptedFinalTranscriptIdsRef.current.clear()
    rejectedFinalTranscriptIdsRef.current.clear()
  }

  const onTranslationChange = (next: string): void => {
    setTranslationTarget(next)
    updateHealth(
      'translation',
      next === 'off' ? 'disconnected' : 'connected',
      next === 'off' ? 'not connected' : `to ${next}`
    )
  }

  return (
    <main className="v4-app" ref={shellRef} data-running={running ? 'true' : 'false'}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="v4p-head">
        <div className="v4p-head-left">
          <span className={`v4p-live ${running ? 'on' : 'off'}`}>
            <span className="v4p-live-dot" />
            <span className="v4p-live-text">
              {running ? 'Live' : starting ? 'Starting' : 'Idle'}
            </span>
            <span className="v4p-live-time amw-mono">{heroDurationLabel}</span>
          </span>
          <div className="v4p-statusdots" title="capture · stt · translate · agent">
            <span
              className={statusClass(snapshot.capture.status)}
              title={`Capture: ${snapshot.capture.message ?? snapshot.capture.status}`}
            />
            <span
              className={statusClass(snapshot.stt.status)}
              title={`STT: ${snapshot.stt.message ?? snapshot.stt.status}`}
            />
            <span
              className={statusClass(snapshot.translation.status)}
              title={`Translate: ${snapshot.translation.message ?? snapshot.translation.status}`}
            />
            <span
              className={
                agentStatus === 'thinking'
                  ? 'dot active'
                  : agentStatus === 'error'
                    ? 'dot degraded'
                    : whiteboardConnected
                      ? 'dot active'
                      : 'dot'
              }
              title={`Agent: ${
                agentStatus === 'thinking'
                  ? 'generating'
                  : agentStatus === 'error'
                    ? 'error'
                    : whiteboardConnected
                      ? 'ready'
                      : 'idle'
              }`}
            />
          </div>
        </div>

        <div className="v4p-head-mid">
          <span className="v4p-eyebrowtxt">Session</span>
          <h1 className="v4p-title">AutoMeetic</h1>
        </div>

        <div className="v4p-head-right">
          <div className="v4p-lang">
            <select
              className="v4p-lang-select"
              value={sttLanguage}
              onChange={(event) => onLanguageChange(event.target.value)}
              disabled={running || starting}
              aria-label="Input language"
            >
              {LANGUAGE_OPTIONS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code === 'auto' ? 'Auto' : language.code.toUpperCase()}
                </option>
              ))}
            </select>
            <em>→</em>
            <select
              className="v4p-lang-select"
              value={translationTarget}
              onChange={(event) => onTranslationChange(event.target.value)}
              aria-label="Translation target"
            >
              <option value="off">Off</option>
              {LANGUAGE_OPTIONS.filter((language) => language.code !== 'auto').map(
                (language) => (
                  <option key={language.code} value={language.code}>
                    {language.code.toUpperCase()}
                  </option>
                )
              )}
            </select>
          </div>

          <button
            className={`v4p-record ${running ? 'on' : ''}`}
            type="button"
            onClick={() => {
              if (running) onStop()
              else void onStart()
            }}
            disabled={starting}
            title={running ? 'Stop listening' : 'Start listening'}
          >
            <span className="v4p-record-icon" aria-hidden="true">
              {running ? (
                <svg width="9" height="9" viewBox="0 0 9 9">
                  <rect width="9" height="9" rx="1.5" fill="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <circle cx="5" cy="5" r="4" fill="currentColor" />
                </svg>
              )}
            </span>
            <span className="v4p-record-text">
              {running ? 'Stop' : starting ? 'Starting…' : 'Start'}
            </span>
          </button>

          <button
            className={`v4p-iconbtn ghost ${shelf !== 'closed' ? 'on' : ''}`}
            type="button"
            onClick={() => setShelf(shelf === 'closed' ? 'whiteboard' : 'closed')}
            title={shelf === 'closed' ? 'Show panel' : 'Hide panel'}
            aria-label="Toggle right panel"
            aria-pressed={shelf !== 'closed'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <rect x="1.25" y="2.5" width="11.5" height="9" rx="1.5" />
              <line x1="9" y1="2.5" x2="9" y2="11.5" />
            </svg>
          </button>

          <button
            className="v4p-iconbtn ghost"
            type="button"
            onClick={() => {
              void toggleFullscreen()
            }}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            aria-label="Toggle fullscreen"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              {isFullscreen ? (
                <path d="M5 1v4H1M8 12V8h4M1 8h4v4M12 5H8V1" />
              ) : (
                <path d="M1 5V1h4M12 5V1H8M1 8v4h4M12 8v4H8" />
              )}
            </svg>
          </button>

          <button
            className="v4p-iconbtn"
            type="button"
            onClick={triggerAnswerAssist}
            disabled={!running || answerBusy}
            title="Answer Assist (Ctrl+Shift+A)"
            aria-label="Answer Assist"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            >
              <path d="M7 1.5L8.5 5l3.5.5-2.5 2.4.6 3.5L7 9.8 3.9 11.4l.6-3.5L2 5.5 5.5 5 7 1.5z" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Source bar ─────────────────────────────────────────── */}
      <div className="v4p-sourcebar">
        <div className={`v4p-source-cell ${running ? 'on' : ''}`}>
          <svg
            className="v4p-source-icon"
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4v3h2l2.5 2V2L4 4H2z" />
            <path d="M8 3.5c.7.7 1 1.3 1 2s-.3 1.3-1 2" />
          </svg>
          <span className="v4p-source-name">System</span>
          <span className="v4p-source-app">tab / window audio</span>
          <div className="v4p-source-wave" aria-hidden="true">
            <Waveform analyser={analyser} active={running} />
          </div>
        </div>
        <div className="v4p-source-cell v4p-source-cell-mic">
          <svg
            className="v4p-source-icon"
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <rect x="4" y="1.5" width="3" height="5.5" rx="1.5" />
            <path d="M2.5 5.5a3 3 0 006 0M5.5 8.5V10" />
          </svg>
          <span className="v4p-source-name">Mic</span>
          <span className="v4p-source-app">disabled</span>
        </div>
        <div className="v4p-source-cell v4p-source-cell-meta">
          {error && <span className="v4p-source-error">{error}</span>}
          <button
            type="button"
            className={`v4p-resetbtn ${resetConfirming ? 'confirming' : ''}`}
            onClick={resetSession}
            title="Reset session"
          >
            {resetConfirming ? 'Confirm reset' : 'Reset'}
          </button>
          <span className="v4p-source-dot">·</span>
          <span className="amw-mono v4p-meta-num">{transcriptCount}</span>
          <span className="v4p-meta-lbl">captions</span>
          <span className="v4p-source-dot">·</span>
          <span className="amw-mono v4p-meta-num">{sourceWordCount}</span>
          <span className="v4p-meta-lbl">words</span>
        </div>
      </div>

      {/* ── Main: columns + shelf ─────────────────────────────── */}
      <div className="v4p-main">
        <section className="v4p-cols">
          <div className="v4p-col">
            <div className="v4p-col-hd">
              <span className="v4p-col-mark">{langCode(sourceLang)}</span>
              <span className="v4p-col-name">
                <em>Original</em>
                {languageLock && (
                  <> · {LANGUAGE_LABEL_BY_CODE.get(languageLock) ?? languageLock}</>
                )}
                {!languageLock && detectedLanguage && (
                  <>
                    {' '}
                    · detecting{' '}
                    {LANGUAGE_LABEL_BY_CODE.get(detectedLanguage) ?? detectedLanguage}
                  </>
                )}
              </span>
            </div>
            <div className="v4p-col-body amw-scroll" ref={enColRef}>
              <div className="v4p-col-pad">
                {items.length === 0 && !liveText && (
                  <p className="v4p-empty">
                    <em>Idle.</em> Press <kbd>Start</kbd> and share a tab with audio to begin.
                  </p>
                )}
                {items.map((item) => (
                  <div key={`en-${item.id}`} className="v4p-line">
                    <div className="v4p-line-time amw-mono">
                      {formatDuration(
                        Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
                      )}
                    </div>
                    <div className="v4p-line-text">{item.sourceText}</div>
                  </div>
                ))}
                {liveText && (
                  <div className="v4p-line v4p-line-live">
                    <div className="v4p-line-time amw-mono">·</div>
                    <div className="v4p-line-text">{liveText}</div>
                  </div>
                )}
                <div className="v4p-trail">·  ·  ·</div>
              </div>
            </div>
          </div>

          {showTranslationColumn && (
            <div className="v4p-col v4p-col-trans">
              <div className="v4p-col-hd">
                <span className="v4p-col-mark v4p-col-mark-alt">{langCode(targetLang)}</span>
                <span className="v4p-col-name">
                  <em>Translation</em> ·{' '}
                  {LANGUAGE_LABEL_BY_CODE.get(targetLang) ?? targetLang}
                </span>
                {translatingCount > 0 && (
                  <span className="v4p-col-pending">translating {translatingCount}…</span>
                )}
              </div>
              <div className="v4p-col-body amw-scroll" ref={koColRef}>
                <div className="v4p-col-pad">
                  {items.length === 0 && (
                    <p className="v4p-empty">
                      <em>Translations appear here.</em>
                    </p>
                  )}
                  {items.map((item) => (
                    <div key={`tr-${item.id}`} className="v4p-line">
                      <div className="v4p-line-time amw-mono">
                        {formatDuration(
                          Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
                        )}
                      </div>
                      <div className="v4p-line-text">
                        {item.translatedText || <span className="v4p-line-pending">…</span>}
                      </div>
                    </div>
                  ))}
                  <div className="v4p-trail">·  ·  ·</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right shelf */}
        {shelf !== 'closed' && (
          <aside className="v4p-shelf">
            <div className="v4p-shelf-tabs">
              <button
                className={`v4p-shelf-tab ${shelf === 'whiteboard' ? 'on' : ''}`}
                onClick={() => setShelf('whiteboard')}
              >
                Whiteboard
              </button>
              <button
                className={`v4p-shelf-tab ${shelf === 'actions' ? 'on' : ''}`}
                onClick={() => setShelf('actions')}
              >
                Actions
              </button>
              <button
                className="v4p-shelf-x"
                onClick={() => setShelf('closed')}
                title="Close panel"
                aria-label="Close panel"
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
              {shelf === 'whiteboard' && (
                <div className="v4p-wb">
                  <ExcalidrawCanvas
                    key={`canvas-${canvasResetVersion}`}
                    elements={whiteboardElements}
                    viewportCommand={viewportCommand}
                    compact
                    onMaximize={() => setWhiteboardMaximized(true)}
                  />
                  {whiteboardElements.length === 0 && (
                    <div className="v4p-wb-empty">
                      <em>Diagram appears here</em> as the agent finds key concepts.
                    </div>
                  )}
                  <button
                    type="button"
                    className="v4p-wb-expand"
                    onClick={() => setWhiteboardMaximized(true)}
                    title="Expand whiteboard"
                    aria-label="Expand whiteboard"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 13 13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 1h4v4M5 12H1V8M12 1L8 5M1 12l4-4" />
                    </svg>
                    <span>Expand</span>
                  </button>
                  {agentStatus === 'thinking' && (
                    <div className="v4p-wb-badge">
                      <span className="v4p-wb-spinner" /> Agent thinking
                    </div>
                  )}
                </div>
              )}
              {shelf === 'actions' && (
                <div className="v4p-actions-empty">
                  <p>
                    <em>No action items yet.</em>
                  </p>
                  <p className="v4p-actions-hint">
                    Action item extraction is not wired up yet. Captions accumulate in the
                    transcript as the session runs.
                  </p>
                </div>
              )}
            </div>
          </aside>
        )}

      </div>

      {/* ── Now speaking hero strip ───────────────────────────── */}
      <footer className="v4p-now">
        <div className={`v4p-now-rail ${running ? 'on' : ''}`} />
        <div className="v4p-now-body">
          <div className="v4p-now-meta">
            {running && <span className="v4p-now-pulse" />}
            <span className="v4p-now-label">
              <em>{running ? 'Now speaking' : 'Last caption'}</em>
            </span>
            <span className="v4p-now-divider">·</span>
            <span className="v4p-now-source">System audio</span>
            <span className="v4p-now-divider">·</span>
            <span className="amw-mono v4p-now-time">{heroDurationLabel}</span>
          </div>
          <div className="v4p-now-en">
            {heroSourceText || (
              <span className="v4p-now-placeholder">
                {running
                  ? 'Listening…'
                  : 'Press Start to begin a session. Share any browser tab or window with audio.'}
              </span>
            )}
          </div>
          {showTranslationColumn && heroTargetText && (
            <div className="v4p-now-ko">{heroTargetText}</div>
          )}
        </div>
        <div className="v4p-now-aside">
          <button
            className="v4p-ask"
            onClick={triggerAnswerAssist}
            disabled={!running || answerBusy}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M7 1.5L8.5 5l3.5.5-2.5 2.4.6 3.5L7 9.8 3.9 11.4l.6-3.5L2 5.5 5.5 5 7 1.5z" />
            </svg>
            <span>
              <em>{answerBusy ? 'Thinking…' : 'Ask'}</em> the meeting
            </span>
            <kbd>⌃⇧A</kbd>
          </button>
        </div>
      </footer>

      {/* Answer Assist overlay */}
      {answerAssist.status !== 'idle' && (
        <div className="v4p-aa-overlay">
          <AnswerAssistCard
            status={answerAssist.status}
            searchQuery={answerAssist.searchQuery}
            answer={answerAssist.answer}
            answerKo={answerAssist.answerKo}
            errorMessage={answerAssist.errorMessage}
            onDismiss={answerAssist.dismiss}
            onCopy={answerAssist.copyAnswer}
          />
        </div>
      )}

      {/* Caption overlay for screen sharing — kept for fullscreen presenters */}
      {isFullscreen && <CaptionOverlay currentPartial={captionText} />}

      <WhiteboardModal
        open={whiteboardMaximized}
        elements={whiteboardElements}
        viewportCommand={viewportCommand}
        agentStatus={agentStatus}
        canvasResetVersion={canvasResetVersion}
        onElementsChange={handleWhiteboardChange}
        onScreenshot={handleWhiteboardScreenshot}
        onClose={() => setWhiteboardMaximized(false)}
      />
    </main>
  )
}

export default App

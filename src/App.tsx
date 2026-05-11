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
import './App.css'
import { SystemAudioCaptureService } from './main/audio/capture'
import { PipelineHealthStore } from './main/health/pipelineHealth'
import { RealtimeSttClient } from './main/stt/realtimeClient'
import { TranscriptBus } from './main/stt/transcriptBus'
import type { TranscriptSegment, TranslationSegment } from './main/stt/types'
import { log } from './main/telemetry/logger'
import type { ViewportCommand, WhiteboardElement } from './main/whiteboard/types'
import { CaptionOverlay } from './renderer/overlay/CaptionOverlay'
import { useCaptionStore } from './renderer/overlay/useCaptionStore'
import { Waveform } from './renderer/overlay/Waveform'
import { ExcalidrawCanvas } from './renderer/whiteboard/ExcalidrawCanvas'

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

const LANGUAGE_LABEL_BY_CODE = new Map(LANGUAGE_OPTIONS.map((language) => [language.code, language.label]))
const LOCKABLE_LANGUAGE_CODES = new Set(['ko', 'en', 'ja', 'zh'])
const META_TRANSLATION_RE =
  /\b(this text appears|let me translate|translation|translate it|appears to be a mix)\b/i
const TRANSLATION_CONCURRENCY = 2
const CLIENT_TRANSCRIPT_MAX_CHARS = 180

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
  if (latin >= 8 && hangul === 0 && kana === 0 && han === 0) return { code: 'en', confidence: latin / total }
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

function splitTranscriptSegment(segment: TranscriptSegment): TranscriptSegment[] {
  const text = segment.text.trim()
  if (!segment.isFinal || text.length <= CLIENT_TRANSCRIPT_MAX_CHARS) return [{ ...segment, text }]

  const pieces: string[] = []
  const sentences = text.match(/[^.!?。？！]+[.!?。？！]?\s*/g) ?? [text]
  let buffer = ''

  for (const sentence of sentences) {
    const next = `${buffer}${sentence}`.trim()
    if (next.length <= CLIENT_TRANSCRIPT_MAX_CHARS) {
      buffer = next
      continue
    }
    if (buffer) pieces.push(buffer)
    const trimmed = sentence.trim()
    if (trimmed.length <= CLIENT_TRANSCRIPT_MAX_CHARS) {
      buffer = trimmed
      continue
    }
    for (let i = 0; i < trimmed.length; i += CLIENT_TRANSCRIPT_MAX_CHARS) {
      pieces.push(trimmed.slice(i, i + CLIENT_TRANSCRIPT_MAX_CHARS).trim())
    }
    buffer = ''
  }

  if (buffer) pieces.push(buffer)
  return pieces.filter(Boolean).map((piece, index) => ({
    ...segment,
    id: index === 0 ? segment.id : `${segment.id}-${index}`,
    text: piece,
  }))
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
  const [error, setError] = useState<string | null>(null)
  const [expandedStatus, setExpandedStatus] = useState<string | null>(null)
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
  const { items, currentPartial, applyTranscript, applyTranslation, clearPartial, clear } = useCaptionStore()

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

  // Stable service instances — same lifecycle pattern as autopreso
  const bus = useMemo(() => new TranscriptBus(), [])
  const capture = useMemo(() => new SystemAudioCaptureService(), [])
  const sttClient = useMemo(() => new RealtimeSttClient(bus), [bus])
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
        if (acceptedFinalTranscriptIdsRef.current.has(segment.id)) return true
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
      const accepted = !preferredLanguage || !conflictsWithLockedLanguage(text, preferredLanguage)
      if (!accepted) {
        log('warn', 'stt', 'filtered transcript that conflicts with locked language', {
          lockedLanguage: preferredLanguage,
          detectedLanguage: detected?.code ?? 'unknown',
          text: text.slice(0, 120),
        })
        if (segment.isFinal) clearPartial()
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

      void fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: job.segment.text, targetLang: job.targetLang }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Translation API error: ${res.status}`)
          return (await res.json()) as { translation: string }
        })
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
            provider: 'anthropic-async',
          }
          applyTranslation(translation)
        })
        .catch((err) => {
          updateHealth('translation', 'degraded', err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          translationActiveCountRef.current = Math.max(translationActiveCountRef.current - 1, 0)
          updateTranslationQueueStatus()
          if (translationQueueRef.current.length > 0) {
            drainTranslationQueue()
          } else if (
            translationGenerationRef.current === job.generation &&
            translationActiveCountRef.current === 0 &&
            translationTargetRef.current !== 'off'
          ) {
            updateHealth('translation', 'connected', `to ${translationTargetRef.current}`)
          }
        })
    }
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

  useEffect(() => {
    const offTranscript = bus.onTranscript((segment) => {
      if (!shouldAcceptTranscript(segment)) return
      const sourceLanguage = sttLanguage === 'auto' ? lockedLanguageRef.current : sttLanguage
      const segments = splitTranscriptSegment(segment)
      for (const nextSegment of segments) {
        applyTranscript(nextSegment)
        if (
          nextSegment.isFinal &&
          translationTarget !== 'off' &&
          translationTarget !== sourceLanguage
        ) {
          enqueueTranslation(nextSegment, translationTarget)
        }
      }
    })
    const offCapture = capture.subscribe((chunk) => sttClient.ingest(chunk))

    return () => {
      offTranscript()
      offCapture()
      capture.stop()
      sttClient.disconnect()
    }
  }, [
    applyTranscript,
    bus,
    capture,
    enqueueTranslation,
    shouldAcceptTranscript,
    sttClient,
    sttLanguage,
    translationTarget,
    updateHealth,
  ])

  useEffect(() => {
    if (!running || sttLanguage !== 'auto' || !languageLock) return
    if (reconnectLanguageRef.current === languageLock) return
    reconnectLanguageRef.current = languageLock

    updateHealth('stt', 'degraded', `reconnecting as ${languageLock}...`)
    sttClient.disconnect()
    void sttClient
      .connect(languageLock)
      .then(() => {
        updateHealth('stt', 'connected', `locked ${languageLock}`)
      })
      .catch((err) => {
        updateHealth('stt', 'degraded', err instanceof Error ? err.message : String(err))
      })
  }, [languageLock, running, sttClient, sttLanguage, updateHealth])

  // ── Whiteboard WebSocket connection (autopreso pattern) ───────────────────
  useEffect(() => {
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
          setWhiteboardElements(msg.elements.filter(isWhiteboardElement))
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
      if (!shouldAcceptTranscript(segment)) return
      const ws = whiteboardWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const nextSegment of splitTranscriptSegment(segment)) {
          ws.send(
            JSON.stringify({
              type: 'whiteboard:agent-run',
              transcript: nextSegment.text,
            })
          )
        }
      }
    })

    return offTranscript
  }, [running, bus, shouldAcceptTranscript])

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
  const sessionElapsedMs = sessionStartMs === null ? 0 : Math.max(clockMs - sessionStartMs, 0)
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
    setAnalyser(null)
    updateHealth('capture', 'disconnected', 'stopped')
    updateHealth('stt', 'disconnected', 'stopped')
    setRunning(false)
  }, [capture, runStartMs, sttClient, updateHealth])

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
    setError(null)
    setExpandedStatus(null)
    setResetConfirming(false)
    setWhiteboardElements([])
    setViewportCommand(null)
    setAgentStatus('idle')
    setLanguageLock(null)
    setDetectedLanguage(null)
    lockedLanguageRef.current = null
    reconnectLanguageRef.current = null
    languageVotesRef.current = {}
    acceptedFinalTranscriptIdsRef.current.clear()
    rejectedFinalTranscriptIdsRef.current.clear()
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

  return (
    <main className="shell" ref={shellRef}>
      {/* Left side — whiteboard with live captions overlaid */}
      <section className="canvas-wrap">
        <div className="whiteboard-wrap">
          <ExcalidrawCanvas
            elements={whiteboardElements}
            onElementsChange={handleWhiteboardChange}
            onScreenshot={handleWhiteboardScreenshot}
            viewportCommand={viewportCommand}
          />
          {agentStatus === 'thinking' && (
            <div className="whiteboard-agent-badge">AI thinking...</div>
          )}
          <CaptionOverlay items={items} currentPartial={currentPartial} />
        </div>
      </section>

      {/* Right side — controls + status (like autopreso's panel) */}
      <aside className="panel">
        <div className="brand">
          <div className="brand-row">
            <h1>AutoMeetic</h1>
          </div>
          <p>Share tab audio, capture captions, and let the whiteboard agent map ideas.</p>
        </div>

        <div className="controls">
          <div className="listen-row">
            {/* Record toggle — ported from autopreso's record-toggle pattern */}
            <button
              className={`record-toggle ${running ? 'recording' : ''}`}
              type="button"
              onClick={() => {
                if (running) onStop()
                else void onStart()
              }}
              disabled={starting}
            >
              <span className="record-icon">{running ? '\u25A0' : '\u25CF'}</span>{' '}
              {running ? 'Stop Listening' : starting ? 'Starting...' : 'Start Listening'}
            </button>
            <button
              className="fullscreen-toggle"
              type="button"
              onClick={() => {
                void toggleFullscreen()
              }}
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen for screen sharing'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? 'Exit' : 'Full'}
            </button>
          </div>

          {running && (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                clear()
              }}
            >
              Clear Feed
            </button>
          )}

          <button
            className={`reset-session ${resetConfirming ? 'confirming' : ''}`}
            type="button"
            onClick={resetSession}
          >
            {resetConfirming ? 'Click again to reset session' : 'Reset Session'}
          </button>
        </div>

        <div className="language-card">
          <label className="language-field">
            <span>Input language</span>
            <select
              value={sttLanguage}
              onChange={(event) => {
                setSttLanguage(event.target.value)
                setLanguageLock(null)
                setDetectedLanguage(null)
                lockedLanguageRef.current = null
                reconnectLanguageRef.current = null
                languageVotesRef.current = {}
                acceptedFinalTranscriptIdsRef.current.clear()
                rejectedFinalTranscriptIdsRef.current.clear()
              }}
              disabled={running || starting}
            >
              {LANGUAGE_OPTIONS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          {(languageLock || detectedLanguage) && (
            <div className="language-lock">
              {languageLock
                ? `Locked on ${LANGUAGE_LABEL_BY_CODE.get(languageLock) ?? languageLock}`
                : `Detecting ${LANGUAGE_LABEL_BY_CODE.get(detectedLanguage ?? '') ?? detectedLanguage}`}
            </div>
          )}

          <label className="language-field">
            <span>Translate to</span>
            <select
              value={translationTarget}
              onChange={(event) => {
                const next = event.target.value
                setTranslationTarget(next)
                updateHealth(
                  'translation',
                  next === 'off' ? 'disconnected' : 'connected',
                  next === 'off' ? 'not connected' : `to ${next}`
                )
              }}
            >
              <option value="off">Off</option>
              {LANGUAGE_OPTIONS.filter((language) => language.code !== 'auto').map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!running && !starting && !error && (
          <p className="hint-text">
            Click Start, then select any tab or window and enable "Share audio".
          </p>
        )}

        {error && <div className="error">{error}</div>}

        {/* Status card — ported from autopreso's statusRow() pattern */}
        <div className="status-card">
          <div className={`status-row-wrap ${expandedStatus === 'capture' ? 'expanded' : ''}`}>
            <button
              type="button"
              className={`status-row clickable ${expandedStatus === 'capture' ? 'open' : ''}`}
              onClick={() => setExpandedStatus((s) => (s === 'capture' ? null : 'capture'))}
            >
              <span className={statusClass(snapshot.capture.status)} aria-hidden="true" />
              <span className="label">Capture</span>
              <span className="value">{snapshot.capture.message ?? snapshot.capture.status}</span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {expandedStatus === 'capture' && (
              <div className="status-details">
                <div className="status-details-row">
                  <span>Session</span>
                  <strong>{formatDuration(sessionElapsedMs)}</strong>
                </div>
                <div className="status-details-row">
                  <span>Audio active</span>
                  <strong>{formatDuration(totalAudioMs)}</strong>
                </div>
              </div>
            )}
          </div>

          <div className={`status-row-wrap ${expandedStatus === 'stt' ? 'expanded' : ''}`}>
            <button
              type="button"
              className={`status-row clickable ${expandedStatus === 'stt' ? 'open' : ''}`}
              onClick={() => setExpandedStatus((s) => (s === 'stt' ? null : 'stt'))}
            >
              <span className={statusClass(snapshot.stt.status)} aria-hidden="true" />
              <span className="label">STT</span>
              <span className="value">{snapshot.stt.message ?? snapshot.stt.status}</span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {expandedStatus === 'stt' && (
              <div className="status-details">
                <div className="status-details-row">
                  <span>Committed captions</span>
                  <strong>{transcriptCount}</strong>
                </div>
                <div className="status-details-row">
                  <span>Total words</span>
                  <strong>{sourceWordCount}</strong>
                </div>
              </div>
            )}
          </div>

          <div className={`status-row-wrap ${expandedStatus === 'translation' ? 'expanded' : ''}`}>
            <button
              type="button"
              className={`status-row clickable ${expandedStatus === 'translation' ? 'open' : ''}`}
              onClick={() => setExpandedStatus((s) => (s === 'translation' ? null : 'translation'))}
            >
              <span className={statusClass(snapshot.translation.status)} aria-hidden="true" />
              <span className="label">Translate</span>
              <span className="value">
                {translatingCount > 0
                  ? `translating ${translatingCount}`
                  : snapshot.translation.message ?? 'not connected'}
              </span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {expandedStatus === 'translation' && (
              <div className="status-details">
                <div className="status-details-row">
                  <span>Whiteboard</span>
                  <strong>{whiteboardConnected ? 'connected' : 'disconnected'}</strong>
                </div>
                <div className="status-details-row">
                  <span>Partial text</span>
                  <strong>{currentPartial ? 'streaming' : 'idle'}</strong>
                </div>
                <div className="status-details-row">
                  <span>Translation queue</span>
                  <strong>{translatingCount}</strong>
                </div>
              </div>
            )}
          </div>

          <div className={`status-row-wrap ${expandedStatus === 'agent' ? 'expanded' : ''}`}>
            <button
              type="button"
              className={`status-row clickable ${expandedStatus === 'agent' ? 'open' : ''}`}
              onClick={() => setExpandedStatus((s) => (s === 'agent' ? null : 'agent'))}
            >
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
                aria-hidden="true"
              />
              <span className="label">Agent</span>
              <span className="value">
                {agentStatus === 'thinking'
                  ? 'generating diagram...'
                  : agentStatus === 'error'
                    ? 'error'
                    : whiteboardConnected
                      ? 'ready'
                      : 'disconnected'}
              </span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {expandedStatus === 'agent' && (
              <div className="status-details">
                <div className="status-details-row">
                  <span>Canvas elements</span>
                  <strong>{whiteboardElements.length}</strong>
                </div>
                <div className="status-details-row">
                  <span>Realtime link</span>
                  <strong>{whiteboardConnected ? 'connected' : 'disconnected'}</strong>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="cost-card">
          <div className="cost-card-header">
            <span className="cost-card-title">Session Metrics</span>
            <strong className="cost-card-total">{formatDuration(sessionElapsedMs)}</strong>
          </div>
          <div className="cost-row">
            <div className="cost-row-left">
              <span className="cost-row-label">Active audio</span>
              <span className="cost-row-sub">Time with capture running</span>
            </div>
            <span className="cost-row-value">{formatDuration(totalAudioMs)}</span>
          </div>
          <div className="cost-row">
            <div className="cost-row-left">
              <span className="cost-row-label">Captions</span>
              <span className="cost-row-sub">Committed transcript lines</span>
            </div>
            <span className="cost-row-value">{transcriptCount}</span>
          </div>
          <div className="cost-row">
            <div className="cost-row-left">
              <span className="cost-row-label">Words</span>
              <span className="cost-row-sub">Detected from source transcript</span>
            </div>
            <span className="cost-row-value">{sourceWordCount}</span>
          </div>
        </div>

        <section className="caption-feed panel-feed" aria-label="caption feed">
          <header className="caption-feed-header">
            <strong>Live Feed</strong>
            <span className={`caption-badge ${running ? 'active' : ''}`}>
              {running ? 'LIVE' : 'IDLE'}
            </span>
          </header>

          <div className="panel-feed-waveform" aria-hidden="true">
            <Waveform analyser={analyser} active={running} />
          </div>

          <div className="caption-feed-list">
            {currentPartial ? (
              <article className="caption-item partial">
                <div className="caption-source">{currentPartial}</div>
              </article>
            ) : null}
            {[...items].reverse().map((item) => (
              <article key={item.id} className="caption-item">
                <div className="caption-source">{item.sourceText}</div>
                {item.translatedText ? (
                  <div className="caption-target">{item.translatedText}</div>
                ) : null}
              </article>
            ))}
            {items.length === 0 && !currentPartial && (
              <p className="caption-empty">No transcript yet.</p>
            )}
          </div>
        </section>
      </aside>
    </main>
  )
}

export default App

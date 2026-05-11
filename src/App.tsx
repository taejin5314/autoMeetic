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
 * - Excalidraw whiteboard with AI agent (whiteboard mode)
 */
import '@excalidraw/excalidraw/index.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SystemAudioCaptureService } from './main/audio/capture'
import { PipelineHealthStore } from './main/health/pipelineHealth'
import { RealtimeSttClient } from './main/stt/realtimeClient'
import { TranscriptBus } from './main/stt/transcriptBus'
import type { ViewportCommand, WhiteboardElement } from './main/whiteboard/types'
import { CaptionOverlay } from './renderer/overlay/CaptionOverlay'
import { useCaptionStore } from './renderer/overlay/useCaptionStore'
import { ExcalidrawCanvas } from './renderer/whiteboard/ExcalidrawCanvas'

type AppMode = 'transcript' | 'whiteboard'

function statusClass(status: 'connected' | 'degraded' | 'disconnected'): string {
  if (status === 'connected') return 'dot active'
  if (status === 'degraded') return 'dot degraded'
  return 'dot'
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
  const [mode, setMode] = useState<AppMode>('transcript')
  const { items, currentPartial, applyTranscript, clear } = useCaptionStore()

  // ── Whiteboard state (autopreso pattern) ──────────────────────────────────
  const [whiteboardElements, setWhiteboardElements] = useState<WhiteboardElement[]>([])
  const [viewportCommand, setViewportCommand] = useState<ViewportCommand | null>(null)
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'error'>('idle')
  const whiteboardWsRef = useRef<WebSocket | null>(null)

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

  // Wire transcript bus → caption store, capture → STT client
  useEffect(() => {
    const offTranscript = bus.onTranscript((segment) => applyTranscript(segment))
    const offCapture = capture.subscribe((chunk) => sttClient.ingest(chunk))

    return () => {
      offTranscript()
      offCapture()
      capture.stop()
      sttClient.disconnect()
    }
  }, [applyTranscript, bus, capture, sttClient])

  // ── Whiteboard WebSocket connection (autopreso pattern) ───────────────────
  useEffect(() => {
    if (mode !== 'whiteboard') {
      // Not in whiteboard mode — close any existing connection
      if (whiteboardWsRef.current) {
        whiteboardWsRef.current.close()
        whiteboardWsRef.current = null
      }
      return
    }

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws/whiteboard`
    const ws = new WebSocket(wsUrl)
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
        setWhiteboardElements(msg.elements as WhiteboardElement[])
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

    return () => {
      ws.close()
      whiteboardWsRef.current = null
      setWhiteboardConnected(false)
    }
  }, [mode])

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

  // ── Feed transcripts to whiteboard agent when in whiteboard mode ──────────
  useEffect(() => {
    if (mode !== 'whiteboard' || !running) return

    const offTranscript = bus.onTranscript((segment) => {
      if (!segment.isFinal) return
      const ws = whiteboardWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'whiteboard:agent-run',
            transcript: segment.text,
          })
        )
      }
    })

    return offTranscript
  }, [mode, running, bus])

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
  const sessionElapsedMs =
    sessionStartMs === null ? 0 : Math.max(clockMs - sessionStartMs, 0)
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
      await sttClient.connect()
      updateHealth('stt', 'connected', 'OpenAI Realtime ready')

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
  }, [capture, running, sessionStartMs, starting, sttClient, updateHealth])

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
    setActiveAudioMs(0)
    setRunStartMs(null)
    setSessionStartMs(null)
    updateHealth('capture', 'disconnected', 'session reset')
    updateHealth('stt', 'disconnected', 'session reset')
    updateHealth('translation', 'disconnected', 'not connected')

    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:user-elements', elements: [] }))
    }
  }, [clear, onStop, resetConfirming, running, updateHealth])

  return (
    <main className={`shell mode-${mode}`} ref={shellRef}>
      {/* Left side — waveform + captions OR whiteboard (like autopreso's canvas-wrap) */}
      <section className="canvas-wrap">
        {mode === 'transcript' ? (
          <CaptionOverlay
            items={items}
            currentPartial={currentPartial}
            running={running}
            analyser={analyser}
          />
        ) : (
          <div className="whiteboard-wrap">
            <ExcalidrawCanvas
              elements={whiteboardElements}
              onElementsChange={handleWhiteboardChange}
              viewportCommand={viewportCommand}
            />
            {agentStatus === 'thinking' && (
              <div className="whiteboard-agent-badge">AI thinking...</div>
            )}
          </div>
        )}
      </section>

      {/* Right side — controls + status (like autopreso's panel) */}
      <aside className="panel">
        <div className="brand">
          <div className="brand-row">
            <h1>autoMeetic</h1>
            <div
              className={`mode-toggle mode-toggle-${mode}`}
              role="group"
              aria-label="Mode"
            >
              <button
                type="button"
                className={`mode-toggle-option ${mode === 'transcript' ? 'active' : ''}`}
                onClick={() => setMode('transcript')}
                aria-pressed={mode === 'transcript'}
              >
                Transcript
              </button>
              <button
                type="button"
                className={`mode-toggle-option ${mode === 'whiteboard' ? 'active' : ''}`}
                onClick={() => setMode('whiteboard')}
                aria-pressed={mode === 'whiteboard'}
              >
                Whiteboard
              </button>
            </div>
          </div>
          <p>
            {mode === 'transcript'
              ? 'Share tab audio and capture real-time captions.'
              : 'Talk through ideas and let the whiteboard agent map them.'}
          </p>
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
              <span className="value">{snapshot.translation.message ?? 'not connected'}</span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {expandedStatus === 'translation' && (
              <div className="status-details">
                <div className="status-details-row">
                  <span>Current mode</span>
                  <strong>{mode === 'transcript' ? 'Transcript' : 'Whiteboard'}</strong>
                </div>
                <div className="status-details-row">
                  <span>Partial text</span>
                  <strong>{currentPartial ? 'streaming' : 'idle'}</strong>
                </div>
              </div>
            )}
          </div>

          {mode === 'whiteboard' && (
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
                      : 'idle'}
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
          )}
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
      </aside>
    </main>
  )
}

export default App

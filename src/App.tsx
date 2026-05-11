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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import '@excalidraw/excalidraw/index.css'
import { SystemAudioCaptureService } from './main/audio/capture'
import { PipelineHealthStore } from './main/health/pipelineHealth'
import { RealtimeSttClient } from './main/stt/realtimeClient'
import { TranscriptBus } from './main/stt/transcriptBus'
import { CaptionOverlay } from './renderer/overlay/CaptionOverlay'
import { useCaptionStore } from './renderer/overlay/useCaptionStore'
import { ExcalidrawCanvas } from './renderer/whiteboard/ExcalidrawCanvas'
import type { WhiteboardElement, ViewportCommand } from './main/whiteboard/types'

type AppMode = 'transcript' | 'whiteboard'

function statusClass(status: 'connected' | 'degraded' | 'disconnected'): string {
  if (status === 'connected') return 'dot active'
  if (status === 'degraded') return 'dot degraded'
  return 'dot'
}

function App() {
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const captureRef = useRef(capture)
  const sttRef = useRef(sttClient)

  // Wire transcript bus → caption store, capture → STT client
  useEffect(() => {
    const offTranscript = bus.onTranscript((segment) => applyTranscript(segment))
    const offCapture = capture.subscribe((chunk) => sttClient.ingest(chunk))

    return () => {
      offTranscript()
      offCapture()
      captureRef.current.stop()
      sttRef.current.disconnect()
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
    }

    return () => {
      ws.close()
      whiteboardWsRef.current = null
    }
  }, [mode])

  // ── Feed transcripts to whiteboard agent when in whiteboard mode ──────────
  useEffect(() => {
    if (mode !== 'whiteboard' || !running) return

    const offTranscript = bus.onTranscript((segment) => {
      if (!segment.isFinal) return
      const ws = whiteboardWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'whiteboard:agent-run',
          transcript: segment.text,
        }))
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
      health.update('stt', 'degraded', 'connecting...')
      await sttClient.connect()
      health.update('stt', 'connected', `OpenAI Realtime ready`)

      // 2. Start system audio capture (prompts user to share tab/window)
      health.update('capture', 'degraded', 'requesting display media...')
      await capture.start()
      health.update('capture', 'connected', 'system audio active')

      // 3. Expose analyser for waveform visualization (autopreso pattern)
      setAnalyser(capture.analyser ?? null)

      setRunning(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      health.update('stt', 'disconnected', msg)
      health.update('capture', 'disconnected', 'not started')
    } finally {
      setStarting(false)
    }
  }, [capture, health, running, starting, sttClient])

  /**
   * Stop listening — mirrors autopreso/public/app.js stopListening().
   */
  const onStop = useCallback(() => {
    capture.stop()
    sttClient.disconnect()
    setAnalyser(null)
    health.update('capture', 'disconnected', 'stopped')
    health.update('stt', 'disconnected', 'stopped')
    setRunning(false)
  }, [capture, health, sttClient])

  return (
    <main className={`shell mode-${mode}`}>
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
          <h1>autoMeetic</h1>
          <p>Live meeting transcription + whiteboard</p>
        </div>

        {/* Mode tabs (autopreso's staging/live pattern) */}
        <div className="mode-tabs">
          <button
            type="button"
            className={`mode-tab ${mode === 'transcript' ? 'active' : ''}`}
            onClick={() => setMode('transcript')}
          >
            Transcript
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'whiteboard' ? 'active' : ''}`}
            onClick={() => setMode('whiteboard')}
          >
            Whiteboard
          </button>
        </div>

        <div className="controls">
          {/* Record toggle — ported from autopreso's record-toggle pattern */}
          <button
            className={`record-toggle ${running ? 'recording' : ''}`}
            type="button"
            onClick={() => { running ? onStop() : void onStart() }}
            disabled={starting}
          >
            <span className="record-icon">{running ? '\u25A0' : '\u25CF'}</span>
            {' '}
            {running ? 'Stop Listening' : starting ? 'Starting...' : 'Start Listening'}
          </button>

          {running && (
            <button className="secondary" type="button" onClick={() => { clear() }}>
              Clear Feed
            </button>
          )}
        </div>

        {!running && !starting && !error && (
          <p className="hint-text">
            Click Start, then select any tab or window (Slack, YouTube, Meet, Zoom) and enable "Share audio".
          </p>
        )}

        {error && <div className="error">{error}</div>}

        {/* Status card — ported from autopreso's statusRow() pattern */}
        <div className="status-card">
          <div className="status-row">
            <span className={statusClass(snapshot.capture.status)} aria-hidden="true" />
            <span className="label">Capture</span>
            <span className="value">{snapshot.capture.message ?? snapshot.capture.status}</span>
          </div>
          <div className="status-row">
            <span className={statusClass(snapshot.stt.status)} aria-hidden="true" />
            <span className="label">STT</span>
            <span className="value">{snapshot.stt.message ?? snapshot.stt.status}</span>
          </div>
          <div className="status-row">
            <span className={statusClass(snapshot.translation.status)} aria-hidden="true" />
            <span className="label">Translate</span>
            <span className="value">{snapshot.translation.message ?? 'not connected'}</span>
          </div>
          {mode === 'whiteboard' && (
            <div className="status-row">
              <span className={agentStatus === 'thinking' ? 'dot active' : agentStatus === 'error' ? 'dot degraded' : 'dot'} aria-hidden="true" />
              <span className="label">Agent</span>
              <span className="value">{agentStatus === 'thinking' ? 'generating diagram...' : agentStatus === 'error' ? 'error' : 'idle'}</span>
            </div>
          )}
        </div>
      </aside>
    </main>
  )
}

export default App

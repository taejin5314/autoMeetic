import { log } from '../telemetry/logger'
import type { AudioChunk } from '../audio/types'
import type { TranscriptSegment } from './types'
import { TranscriptBus } from './transcriptBus'

/**
 * Realtime STT client — connects to the proxy WebSocket for live transcription.
 *
 * Architecture ported from autopreso/public/app.js audio session management (MIT License).
 * https://github.com/kunchenguid/autopreso
 *
 * Key patterns from autopreso:
 * - Session ID tracking (audio:start message before streaming)
 * - Pending audio buffer (queue audio before WS is ready)
 * - Session-scoped audio correlation
 */

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

type ProxyMessage =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'committed'; text: string }
  | { type: 'error'; message: string }
  | { type: 'closed' }

export class RealtimeSttClient {
  private ws: WebSocket | undefined
  private pendingAudio: string[] = []
  private ready = false
  private sessionId: string | null = null
  private readonly bus: TranscriptBus

  constructor(bus: TranscriptBus) {
    this.bus = bus
  }

  /** Connect to the transcription proxy WebSocket. */
  connect(): Promise<void> {
    if (this.ws && this.ready) return Promise.resolve()
    if (this.ws && !this.ready) {
      const ws = this.ws
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('STT proxy ready timeout')), 10000)
        const onMessage = (event: MessageEvent<string>) => {
          try {
            const msg = JSON.parse(event.data) as ProxyMessage
            if (msg.type === 'ready') {
              window.clearTimeout(timeout)
              ws.removeEventListener('message', onMessage as EventListener)
              resolve()
            }
          } catch {
            // ignore parse errors in readiness wait
          }
        }
        ws.addEventListener('message', onMessage as EventListener)
      })
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/api/ws/transcribe`
    this.ws = new WebSocket(url)
    this.ready = false

    // Generate session ID (autopreso pattern: audio:start before streaming)
    this.sessionId = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const readyTimeout = window.setTimeout(() => {
        reject(new Error('STT proxy did not become ready in time'))
      }, 10000)

      this.ws!.onopen = () => {
        log('info', 'stt', 'connected to transcription proxy', { url })
        // Send audio:start with session ID (autopreso pattern)
        if (this.ws && this.sessionId) {
          this.ws.send(JSON.stringify({ type: 'audio:start', sessionId: this.sessionId }))
        }
      }

      this.ws!.onmessage = (event: MessageEvent<string>) => {
        let msg: ProxyMessage
        try {
          msg = JSON.parse(event.data) as ProxyMessage
        } catch {
          return
        }

        if (msg.type === 'ready') {
          this.ready = true
          window.clearTimeout(readyTimeout)
          resolve()
          // Flush pending audio (autopreso pattern)
          if (this.ws && this.ws.readyState === WebSocket.OPEN && this.pendingAudio.length > 0) {
            for (const audio of this.pendingAudio) {
              this.ws.send(JSON.stringify({ type: 'audio', sessionId: this.sessionId, data: audio }))
            }
            this.pendingAudio = []
          }
          return
        }

        if (msg.type === 'partial') {
          const segment: TranscriptSegment = {
            id: makeId('stt-p'),
            text: msg.text,
            isFinal: false,
            createdAtMs: Date.now(),
            source: 'openai-realtime',
          }
          this.bus.emitTranscript(segment)
        } else if (msg.type === 'committed') {
          const segment: TranscriptSegment = {
            id: makeId('stt'),
            text: msg.text,
            isFinal: true,
            createdAtMs: Date.now(),
            source: 'openai-realtime',
          }
          this.bus.emitTranscript(segment)
          log('info', 'stt', 'committed transcript', { text: msg.text.slice(0, 80) })
        } else if (msg.type === 'error') {
          log('error', 'stt', 'transcription error from proxy', { message: msg.message })
          if (!this.ready) {
            window.clearTimeout(readyTimeout)
            reject(new Error(msg.message))
          }
        } else if (msg.type === 'closed') {
          log('info', 'stt', 'proxy closed connection')
          this.ws = undefined
          this.ready = false
          this.sessionId = null
          this.pendingAudio = []
        }
      }

      this.ws!.onerror = () => {
        log('error', 'stt', 'WebSocket error — is the proxy server running?')
        if (!this.ready) {
          window.clearTimeout(readyTimeout)
          reject(new Error('WebSocket error: check proxy server'))
        }
      }

      this.ws!.onclose = () => {
        log('info', 'stt', 'WebSocket closed')
        if (!this.ready) {
          window.clearTimeout(readyTimeout)
          reject(new Error('WebSocket closed before ready'))
        }
        this.ws = undefined
        this.ready = false
        this.sessionId = null
        this.pendingAudio = []
      }
    })
  }

  /**
   * Forward a captured audio chunk to the proxy for transcription.
   * Includes session ID in each message (autopreso pattern).
   */
  ingest(chunk: AudioChunk): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) {
      this.pendingAudio.push(chunk.payload)
      if (this.pendingAudio.length > 64) {
        this.pendingAudio = this.pendingAudio.slice(-64)
      }
      return
    }
    this.ws.send(JSON.stringify({ type: 'audio', sessionId: this.sessionId, data: chunk.payload }))
  }

  /**
   * Signal stop and close the WebSocket.
   * Sends stop with session ID (autopreso pattern).
   */
  disconnect(): void {
    if (!this.ws) return
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop', sessionId: this.sessionId }))
    }
    this.ws.close()
    this.ws = undefined
    this.ready = false
    this.sessionId = null
    this.pendingAudio = []
  }
}

import type { AudioChunk } from '../main/audio/types'
import type { TranscriptBus } from '../main/stt/transcriptBus'

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * IPC-based STT client for Electron mode.
 * Same interface as RealtimeSttClient but routes through the preload bridge
 * instead of a browser WebSocket to the proxy server.
 */
export class ElectronSttClient {
  private readonly bus: TranscriptBus
  private cleanupFns: (() => void)[] = []
  private ready = false

  constructor(bus: TranscriptBus) {
    this.bus = bus
  }

  connect(language = 'ko'): Promise<void> {
    this.disconnect()

    const api = window.electronAPI
    if (!api) return Promise.reject(new Error('electronAPI not available'))

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('STT ready timeout'))
        }
      }, 15_000)

      const offReady = api.onSttReady(() => {
        if (settled) return
        settled = true
        this.ready = true
        window.clearTimeout(timeout)
        resolve()
      })

      const offPartial = api.onSttPartial((text: string) => {
        this.bus.emitTranscript({
          id: makeId('stt-p'),
          text,
          isFinal: false,
          createdAtMs: Date.now(),
          source: 'openai-realtime',
        })
      })

      const offCommitted = api.onSttCommitted((text: string) => {
        this.bus.emitTranscript({
          id: makeId('stt'),
          text,
          isFinal: true,
          createdAtMs: Date.now(),
          source: 'openai-realtime',
        })
      })

      const offError = api.onSttError((message: string) => {
        if (!settled) {
          settled = true
          window.clearTimeout(timeout)
          reject(new Error(message))
        }
      })

      this.cleanupFns = [offReady, offPartial, offCommitted, offError]

      api.startTranscription(language).catch((err: unknown) => {
        if (!settled) {
          settled = true
          window.clearTimeout(timeout)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  }

  ingest(chunk: AudioChunk): void {
    if (!this.ready) return
    window.electronAPI?.sendAudio(chunk.payload)
  }

  disconnect(): void {
    this.ready = false
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    window.electronAPI?.stopTranscription()
  }
}

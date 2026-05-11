import { log } from '../telemetry/logger'
import type { TranscriptSegment, TranslationSegment } from '../stt/types'
import { TranscriptBus } from '../stt/transcriptBus'
import type { AsyncTranslator } from './translator'

export class AsyncTranslationQueue {
  private pending: TranscriptSegment[] = []
  private running = false
  private readonly bus: TranscriptBus
  private readonly translator: AsyncTranslator

  constructor(bus: TranscriptBus, translator: AsyncTranslator) {
    this.bus = bus
    this.translator = translator
  }

  enqueue(segment: TranscriptSegment): void {
    if (!segment.isFinal) {
      return
    }

    this.pending.push(segment)
    if (!this.running) {
      void this.drain()
    }
  }

  private async drain(): Promise<void> {
    this.running = true

    while (this.pending.length > 0) {
      const segment = this.pending.shift()
      if (!segment) {
        continue
      }

      try {
        const translated = await this.translator.translate(segment.text)
        const output: TranslationSegment = {
          segmentId: segment.id,
          text: translated,
          createdAtMs: Date.now(),
          provider: 'anthropic-async',
        }
        this.bus.emitTranslation(output)
      } catch (error) {
        log('warn', 'translation', 'translation failed; keeping source text only', {
          segmentId: segment.id,
          error: String(error),
        })
      }
    }

    this.running = false
  }
}

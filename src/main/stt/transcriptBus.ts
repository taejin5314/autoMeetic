import type { TranscriptSegment, TranslationSegment } from './types'

type TranscriptListener = (segment: TranscriptSegment) => void
type TranslationListener = (segment: TranslationSegment) => void

export class TranscriptBus {
  private transcriptListeners = new Set<TranscriptListener>()
  private translationListeners = new Set<TranslationListener>()

  onTranscript(listener: TranscriptListener): () => void {
    this.transcriptListeners.add(listener)
    return () => this.transcriptListeners.delete(listener)
  }

  onTranslation(listener: TranslationListener): () => void {
    this.translationListeners.add(listener)
    return () => this.translationListeners.delete(listener)
  }

  emitTranscript(segment: TranscriptSegment): void {
    for (const listener of this.transcriptListeners) {
      listener(segment)
    }
  }

  emitTranslation(segment: TranslationSegment): void {
    for (const listener of this.translationListeners) {
      listener(segment)
    }
  }
}

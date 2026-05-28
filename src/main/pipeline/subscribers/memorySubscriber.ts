import {
  notifySourceTextUpdate,
  notifyTranslation,
  notifyTurnFinalized,
} from '../../memory/transcriptHook'
import type { PipelineEvent, PipelineSubscriber } from '../types'

interface MemoryDeps {
  notifyTurnFinalized: typeof notifyTurnFinalized
  notifyTranslation: typeof notifyTranslation
  notifySourceTextUpdate: typeof notifySourceTextUpdate
}

export function makeMemorySubscriber(
  deps: MemoryDeps = { notifyTurnFinalized, notifyTranslation, notifySourceTextUpdate }
): PipelineSubscriber {
  return {
    name: 'memory',
    onEvent(event: PipelineEvent) {
      if (event.type === 'turn-finalized') {
        deps.notifyTurnFinalized({
          id: event.turn.id,
          text: event.turn.text,
          sourceLanguage: event.turn.sourceLanguage,
          targetLanguage: event.turn.targetLanguage,
          createdAtMs: event.turn.createdAtMs,
          speakerId: event.turn.speakerId,
          speakerLabel: event.turn.speakerLabel,
        })
      } else if (event.type === 'translation-updated') {
        deps.notifyTranslation(event.id, event.translation)
      } else if (event.type === 'turn-source-updated') {
        deps.notifySourceTextUpdate(event.id, event.text)
      }
    },
  }
}

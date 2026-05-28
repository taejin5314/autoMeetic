import { enqueueTranscript } from '../../actionItemService'
import type { PipelineEvent, PipelineSubscriber } from '../types'

export function makeActionItemsSubscriber(
  enqueue: (text: string) => void = enqueueTranscript
): PipelineSubscriber {
  return {
    name: 'actionItems',
    onEvent(event: PipelineEvent) {
      if (event.type !== 'turn-finalized') return
      enqueue(`${event.turn.speakerLabel}: ${event.turn.text}`)
    },
  }
}

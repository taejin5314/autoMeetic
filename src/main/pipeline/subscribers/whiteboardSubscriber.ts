import { enqueueTranscript } from '../../whiteboardService'
import type { PipelineEvent, PipelineSubscriber } from '../types'

export function makeWhiteboardSubscriber(
  enqueue: (text: string) => void = enqueueTranscript
): PipelineSubscriber {
  return {
    name: 'whiteboard',
    onEvent(event: PipelineEvent) {
      if (event.type !== 'turn-finalized') return
      enqueue(`${event.turn.speakerLabel}: ${event.turn.text}`)
    },
  }
}

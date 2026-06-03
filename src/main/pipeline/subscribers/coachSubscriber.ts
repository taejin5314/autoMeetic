import type { CoachService } from '../../coach/coachService'
import type { PipelineSubscriber } from '../types'

export function makeCoachSubscriber(service: CoachService): PipelineSubscriber {
  return {
    name: 'coach',
    onEvent(event) {
      if (event.type === 'turn-finalized') service.onTurnFinalized(event.turn)
      else if (event.type === 'glossary-normalize-applied') service.onGlossaryNormalize(event)
      else if (event.type === 'meeting-ended') service.onMeetingEnded()
    },
  }
}

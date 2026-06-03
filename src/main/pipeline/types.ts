export interface FinalizedTurn {
  id: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
  speakerId: string
  speakerLabel: string
}

export type PipelineEvent =
  | { type: 'meeting-began'; meetingId: string }
  | { type: 'meeting-ended'; meetingId: string }
  | { type: 'turn-finalized'; turn: FinalizedTurn }
  | { type: 'turn-source-updated'; id: string; text: string }
  | { type: 'translation-updated'; id: string; translation: string }
  | { type: 'glossary-normalize-applied'; id: string; pairs: { variant: string; canonical: string }[] }

export interface PipelineSubscriber {
  name: string
  onEvent(event: PipelineEvent): void | Promise<void>
}

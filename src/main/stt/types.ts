export type SpeakerId = 'speaker_a' | 'speaker_b' | 'speaker_c' | 'unknown'

export type SpeakerLabel = 'Speaker A' | 'Speaker B' | 'Speaker C' | 'Unknown'

export interface ProcessedTranscriptTurn {
  id: string
  speakerId: SpeakerId
  speakerLabel: SpeakerLabel
  text: string
  /** Translation of `text` into the user's target language. Null when target is 'off' or matches the source language. */
  translation: string | null
  /** Source language code as decided by the post-processor (e.g. 'en', 'ko'). */
  sourceLanguage: string
  /** Target language requested at flush time (or 'off'). */
  targetLanguage: string
  createdAtMs: number
}

export interface ProcessedTurnsEvent {
  turns: ProcessedTranscriptTurn[]
}

export interface TranscriptSegment {
  id: string
  text: string
  isFinal: boolean
  createdAtMs: number
  source?: 'openai-realtime'
  speakerId?: string
  speakerLabel?: string
}

export interface TranslationSegment {
  segmentId: string
  text: string
  createdAtMs: number
  provider: 'openai-async'
}

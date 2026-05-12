export interface TranscriptSegment {
  id: string
  text: string
  isFinal: boolean
  createdAtMs: number
  source?: 'openai-realtime'
}

export interface TranslationSegment {
  segmentId: string
  text: string
  createdAtMs: number
  provider: 'openai-async'
}

export type MeetingStatus = 'live' | 'completed' | 'failed'

export interface Meeting {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  sourceLanguage: string | null
  targetLanguage: string | null
  status: MeetingStatus
  segmentCount: number
  durationMs: number | null
}

export interface Segment {
  id: string
  meetingId: string
  seq: number
  createdAt: number
  speakerId: string | null
  speakerLabel: string | null
  sourceText: string
  translatedText: string | null
  sourceLanguage: string | null
}

export interface SummaryActionItem {
  text: string
  owner?: string
  due?: string
}

export interface SummaryJSON {
  shortSummary: string
  detailedSummary: string
  keyPoints: string[]
  actionItems: SummaryActionItem[]
}

export interface Summary extends SummaryJSON {
  meetingId: string
  generatedAt: number
  model: string
  promptVersion: string
  status: 'ok' | 'failed'
}

export interface MeetingSummary {
  meeting: Meeting
  shortSummary: string | null
}

export interface MeetingDetail {
  meeting: Meeting
  summary: Summary | null
  segments: Segment[]
}

export type SearchHitKind = 'segment' | 'summary' | 'title'

export interface SearchHit {
  kind: SearchHitKind
  meetingId: string
  meetingTitle: string
  startedAt: number
  segmentId: string | null
  seq: number
  speakerLabel: string | null
  sourceText: string
  translatedText: string | null
  score: number
}

export interface SegmentEmbedding {
  segmentId: string
  vector: Float32Array
  model: string
}

export type MeetingUpdatedKind =
  | 'began'
  | 'segment-added'
  | 'ended'
  | 'summary-ready'
  | 'summary-failed'
  | 'renamed'
  | 'deleted'

export interface MeetingUpdatedEvent {
  meetingId: string
  kind: MeetingUpdatedKind
}

export interface GlossaryEntry {
  id: string
  scope: 'global' | 'meeting'
  meetingId: string | null
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface GlossaryEntryInput {
  id?: string
  scope: 'global' | 'meeting'
  meetingId: string | null
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  note: string | null
}

export interface GlossarySuggestion {
  id: string
  meetingId: string
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  confidence: number
  reason: string | null
  frequency: number | null
  variants: string[]
  createdAt: number
}

export interface GlossarySuggestionInput {
  id?: string
  meetingId: string
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  confidence: number
  reason: string | null
  frequency: number | null
  variants: string[]
}

export interface ChatSource {
  marker: number
  kind: 'segment' | 'meeting-title' | 'meeting-summary'
  meetingId: string
  meetingTitle: string
  segmentId?: string
  segmentText: string
  timestampMs: number
  meetingStartedAt: number
  score: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  createdAt: number
  error?: string
}

export interface ChatHistoryStored {
  version: 1
  messages: ChatMessage[]
}

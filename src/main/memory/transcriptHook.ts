import type { EmbeddingQueue } from './embeddingQueue'
import type { MemoryRepository } from './repository'

export interface TurnPayload {
  id: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
  speakerId: string
  speakerLabel: string
}

type Repo = Pick<MemoryRepository, 'insertSegment' | 'incrementSegmentCount' | 'nextSeq' | 'updateTranslation'>
type Queue = Pick<EmbeddingQueue, 'enqueue'>

let repo: Repo | null = null
let queue: Queue | null = null
let getCurrentMeetingId: (() => string | null) | null = null

export function attachTranscriptHook(r: Repo, q: Queue, getCurrent: () => string | null): void {
  repo = r
  queue = q
  getCurrentMeetingId = getCurrent
}

export function detachTranscriptHook(): void {
  repo = null
  queue = null
  getCurrentMeetingId = null
}

export function notifyTurnFinalized(turn: TurnPayload): void {
  if (!repo || !queue || !getCurrentMeetingId) return
  const meetingId = getCurrentMeetingId()
  if (!meetingId) return
  const seq = repo.nextSeq(meetingId)
  repo.insertSegment({
    id: turn.id,
    meetingId,
    seq,
    createdAt: turn.createdAtMs,
    speakerId: turn.speakerId,
    speakerLabel: turn.speakerLabel,
    sourceText: turn.text,
    translatedText: null,
    sourceLanguage: turn.sourceLanguage,
  })
  repo.incrementSegmentCount(meetingId)
  queue.enqueue({ segmentId: turn.id, text: turn.text })
}

export function notifyTranslation(turnId: string, translation: string): void {
  if (!repo) return
  repo.updateTranslation(turnId, translation)
}

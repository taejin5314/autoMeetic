import type { ProcessedTurnsEvent } from '../main/stt/types'
import type {
  GlossaryEntry,
  GlossaryEntryInput,
  MeetingDetail,
  MeetingSummary,
  MeetingUpdatedEvent,
  SearchHit,
} from '../main/memory/types'

export interface TranslationPatchEvent {
  id: string
  translation: string
}

export interface SourcePatchEvent {
  id: string
  text: string
}

export interface MemoryAPI {
  listMeetings(args?: { limit?: number; offset?: number }): Promise<MeetingSummary[]>
  getMeeting(id: string): Promise<MeetingDetail | null>
  search(query: string, limit?: number): Promise<SearchHit[]>
  renameMeeting(id: string, title: string): Promise<void>
  deleteMeeting(id: string): Promise<void>
  exportMeeting(id: string, format?: 'markdown'): Promise<string>
  regenerateSummary(id: string): Promise<void>
  onMeetingUpdated(callback: (event: MeetingUpdatedEvent) => void): () => void
}

export interface GlossaryAPI {
  list(scope: 'global' | 'meeting', meetingId?: string): Promise<GlossaryEntry[]>
  upsert(entry: GlossaryEntryInput): Promise<GlossaryEntry>
  delete(id: string): Promise<void>
  active(meetingId?: string): Promise<GlossaryEntry[]>
  onChanged(handler: () => void): () => void
}

export interface ElectronAPI {
  memory: MemoryAPI
  glossary: GlossaryAPI

  // Actions
  translate(text: string, targetLang: string): Promise<{ translation: string }>
  startAnswerAssist(transcript: string, sourceLang: string, targetLang: string): Promise<void>
  resetActionItems(): Promise<void>
  resetWhiteboard(): Promise<void>
  resetTranscriptPostProcessor(): Promise<void>
  updateVocabulary(keywords: string[]): Promise<{ count: number }>
  checkHealth(): Promise<{ status: string; ts: number }>
  setTranscriptLanguages(args: { sourceLanguage: string; targetLanguage: string }): Promise<void>

  // Audio/STT
  startTranscription(language: string): Promise<void>
  stopTranscription(): Promise<void>
  sendAudio(base64Chunk: string): void

  // Whiteboard
  sendWhiteboardElements(elements: unknown[]): void
  sendWhiteboardScreenshot(imageDataUrl: string): void

  // Events (main → renderer)
  onSttReady(callback: () => void): () => void
  onSttPartial(callback: (text: string) => void): () => void
  onSttCommitted(callback: (text: string) => void): () => void
  onSttProcessed(callback: (event: ProcessedTurnsEvent) => void): () => void
  onSttSourcePatch(callback: (event: SourcePatchEvent) => void): () => void
  onSttTranslationPatch(callback: (event: TranslationPatchEvent) => void): () => void
  onSttError(callback: (message: string) => void): () => void
  onWhiteboardUpdate(callback: (elements: unknown[]) => void): () => void
  onWhiteboardViewport(callback: (cmd: unknown) => void): () => void
  onWhiteboardAgentStatus(callback: (status: string) => void): () => void
  onAnswerAssistEvent(callback: (event: unknown) => void): () => void
  onActionItemsSuggested(callback: (event: unknown) => void): () => void
  onActionItemsReset(callback: () => void): () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

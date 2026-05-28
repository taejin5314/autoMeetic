import type { ProcessedTurnsEvent } from '../main/stt/types'
import type {
  GlossaryEntry,
  GlossaryEntryInput,
  GlossarySuggestion,
  ChatMessage,
  MeetingDetail,
  MeetingSummary,
  MeetingUpdatedEvent,
  SearchHit,
  VariantCandidate,
} from '../main/memory/types'
import type { DeepAskEvent } from '../main/memory/agents/types'
import type { ExportLanguageMode } from '../main/memory/markdownExporter'
import type { AskMindMapPayload, AskMindMapResult } from '../main/whiteboard/askMindMap'
import type { SlackStatus, SlackTokens } from '../main/slack/types'

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
  exportMeeting(id: string, format?: 'markdown', language?: ExportLanguageMode): Promise<string>
  regenerateSummary(id: string): Promise<void>
  chat(args: { question: string; history: ChatMessage[] }): Promise<void>
  deepAsk(args: { question: string; history: ChatMessage[] }): Promise<void>
  onMeetingUpdated(callback: (event: MeetingUpdatedEvent) => void): () => void
  onChatEvent(handler: (event: unknown) => void): () => void
  onDeepAskEvent(handler: (event: DeepAskEvent) => void): () => void
}

export interface GlossaryAPI {
  list(scope: 'global' | 'meeting', meetingId?: string): Promise<GlossaryEntry[]>
  upsert(entry: GlossaryEntryInput): Promise<GlossaryEntry>
  delete(id: string): Promise<void>
  active(meetingId?: string): Promise<GlossaryEntry[]>
  findVariants(canonical: string): Promise<VariantCandidate[]>
  onChanged(handler: () => void): () => void
  onEntriesUpdated(handler: () => void): () => void
  suggestions: {
    list(meetingId?: string): Promise<GlossarySuggestion[]>
    accept(id: string): Promise<GlossaryEntry>
    dismiss(id: string): Promise<void>
    bulkAccept(ids: string[]): Promise<{
      accepted: string[]
      failed: Array<{ id: string; error: string }>
    }>
    count(): Promise<number>
    onUpdated(handler: () => void): () => void
  }
}

export interface SlackLoadStatus {
  hasTokens: boolean
  memberId: string | null
}

export interface SlackTestResult {
  ok: boolean
  team?: string
  user?: string
  error?: string
}

export interface SlackAPI {
  saveTokens(tokens: SlackTokens): Promise<void>
  loadStatus(): Promise<SlackLoadStatus>
  test(botToken: string): Promise<SlackTestResult>
  clearTokens(): Promise<void>
  arm(): Promise<void>
  disarm(): Promise<void>
  onHuddleStarted(callback: (event: { callId?: string }) => void): () => void
  onHuddleEnded(callback: () => void): () => void
  onStatus(callback: (status: SlackStatus) => void): () => void
}

export interface ElectronAPI {
  system: {
    getLocale(): Promise<string>
  }
  memory: MemoryAPI
  glossary: GlossaryAPI
  slack: SlackAPI

  // Actions
  translate(text: string, targetLang: string): Promise<{ translation: string }>
  startAnswerAssist(
    transcript: string,
    sourceLang: string,
    targetLang: string,
    glossary?: Array<{
      sourceTerm: string
      translations: Record<string, string>
      preserve: boolean
    }>
  ): Promise<void>
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
  whiteboard: {
    setLabelLanguage(code: string | null): Promise<void>
    setMode(mode: 'freeform' | 'mindmap'): Promise<void>
    createMindMapFromAsk(payload: AskMindMapPayload): Promise<AskMindMapResult>
  }

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

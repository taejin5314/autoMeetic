import type { ProcessedTurnsEvent } from '../main/stt/types'

export interface ElectronAPI {
  // Actions
  translate(text: string, targetLang: string): Promise<{ translation: string }>
  startAnswerAssist(transcript: string, lang: string): Promise<void>
  resetActionItems(): Promise<void>
  resetTranscriptPostProcessor(): Promise<void>
  updateVocabulary(keywords: string[]): Promise<{ count: number }>
  checkHealth(): Promise<{ status: string; ts: number }>

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

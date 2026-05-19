import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyTurnFinalized } from '../main/memory/transcriptHook'
import {
  enqueueRoughTranscript,
  flushPendingTranscript,
  resetTranscriptPostProcessor,
} from '../main/transcriptPostProcessor'

vi.mock('../main/memory/transcriptHook', () => ({
  notifyTurnFinalized: vi.fn(),
  notifyTranslation: vi.fn(),
}))

vi.mock('../main/actionItemService', () => ({
  enqueueTranscript: vi.fn(),
}))

vi.mock('../main/whiteboardService', () => ({
  enqueueTranscript: vi.fn(),
}))

describe('transcript postprocessor memory bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTranscriptPostProcessor()
  })

  it('notifies memory when a source turn is finalized', async () => {
    enqueueRoughTranscript('hello from the meeting', {
      sourceLanguageHint: 'en',
      targetLanguage: 'ko',
    })

    await flushPendingTranscript({ force: true })

    expect(notifyTurnFinalized).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello from the meeting',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        speakerId: 'unknown',
        speakerLabel: 'Unknown',
      })
    )
  })
})

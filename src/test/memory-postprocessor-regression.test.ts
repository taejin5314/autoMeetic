import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyTranslation, notifyTurnFinalized } from '../main/memory/transcriptHook'
import {
  enqueueRoughTranscript,
  flushPendingTranscript,
  init,
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

  it('injects active glossary entries into translation prompts and normalizes preserve terms', async () => {
    vi.useFakeTimers()
    const previousApiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'test-key'
    try {
      const send = vi.fn()
      const activeGlossary = vi.fn().mockReturnValue([
        {
          id: 'glossary_1',
          scope: 'global',
          meetingId: null,
          sourceTerm: 'GPU',
          translations: {},
          preserve: true,
          note: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      init(
        { webContents: { send } } as never,
        Promise.resolve({
          getCurrentMeetingId: () => 'mtg_live',
          activeGlossary,
        } as never)
      )
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            messages: Array<{ role: string; content: string }>
          }
          const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
          expect(system).toContain('GLOSSARY')
          expect(system).toContain('"GPU"')
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      translation: 'gpu 벤치마크',
                      sourceLanguage: 'en',
                    }),
                  },
                },
              ],
            }),
          } as Response
        })
      )

      enqueueRoughTranscript('GPU benchmarks today.', {
        sourceLanguageHint: 'en',
        targetLanguage: 'ko',
      })
      await vi.runAllTimersAsync()

      expect(activeGlossary).toHaveBeenCalledWith('mtg_live')
      expect(notifyTranslation).toHaveBeenCalledWith(expect.any(String), 'GPU 벤치마크')
    } finally {
      if (typeof previousApiKey === 'undefined') {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousApiKey
      }
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

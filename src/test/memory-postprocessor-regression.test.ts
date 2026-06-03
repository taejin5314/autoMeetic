import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineBus } from '../main/pipeline/pipelineBus'
import { makeMemorySubscriber } from '../main/pipeline/subscribers/memorySubscriber'
import type { PipelineEvent } from '../main/pipeline/types'
import {
  enqueueRoughTranscript,
  flushPendingTranscript,
  init,
  resetTranscriptPostProcessor,
} from '../main/transcriptPostProcessor'

describe('transcript postprocessor memory bridge', () => {
  function makeBusCapture(): {
    bus: PipelineBus
    events: PipelineEvent[]
    memoryDeps: {
      notifyTurnFinalized: ReturnType<typeof vi.fn>
      notifyTranslation: ReturnType<typeof vi.fn>
      notifySourceTextUpdate: ReturnType<typeof vi.fn>
    }
  } {
    const bus = new PipelineBus()
    const events: PipelineEvent[] = []
    const memoryDeps = {
      notifyTurnFinalized: vi.fn(),
      notifyTranslation: vi.fn(),
      notifySourceTextUpdate: vi.fn(),
    }
    bus.register({ name: 'capture', onEvent: (event) => void events.push(event) })
    bus.register(makeMemorySubscriber(memoryDeps))
    return { bus, events, memoryDeps }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetTranscriptPostProcessor()
  })

  it('emits a turn-finalized event that preserves the memory payload', async () => {
    const { bus, events, memoryDeps } = makeBusCapture()
    init({ webContents: { send: vi.fn() } } as never, undefined, bus)

    enqueueRoughTranscript('hello from the meeting', {
      sourceLanguageHint: 'en',
      targetLanguage: 'ko',
    })

    await flushPendingTranscript({ force: true })

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn-finalized',
        turn: expect.objectContaining({
          text: 'hello from the meeting',
          sourceLanguage: 'en',
          targetLanguage: 'ko',
          speakerId: 'unknown',
          speakerLabel: 'Unknown',
        }),
      })
    )
    expect(memoryDeps.notifyTurnFinalized).toHaveBeenCalledWith(
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
      const { bus, events, memoryDeps } = makeBusCapture()
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
          variants: ['graphics processor'],
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      init(
        { webContents: { send } } as never,
        Promise.resolve({
          getCurrentMeetingId: () => 'mtg_live',
          activeGlossary,
        } as never),
        bus
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
                      translation: 'graphics processor benchmark',
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
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'translation-updated',
          translation: 'GPU benchmark',
        })
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'glossary-normalize-applied',
          pairs: [{ variant: 'graphics processor', canonical: 'GPU' }],
        })
      )
      expect(memoryDeps.notifyTranslation).toHaveBeenCalledWith(expect.any(String), 'GPU benchmark')
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

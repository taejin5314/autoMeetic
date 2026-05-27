import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifySentenceEnd,
  enqueueRoughTranscript,
  init,
  resetTranscriptPostProcessor,
} from '../main/transcriptPostProcessor'
import { notifySourceTextUpdate, notifyTranslation } from '../main/memory/transcriptHook'

vi.mock('../main/memory/transcriptHook', () => ({
  notifyTurnFinalized: vi.fn(),
  notifyTranslation: vi.fn(),
  notifySourceTextUpdate: vi.fn(),
}))

vi.mock('../main/actionItemService', () => ({
  enqueueTranscript: vi.fn(),
}))

vi.mock('../main/whiteboardService', () => ({
  enqueueTranscript: vi.fn(),
}))

type SentMessage = {
  channel: string
  payload: {
    turns?: Array<{ id: string; text: string }>
    id?: string
    text?: string
    translation?: string
  }
}

function initCapture(): SentMessage[] {
  const messages: SentMessage[] = []
  init({
    webContents: {
      send: (channel: string, payload: SentMessage['payload']) => {
        messages.push({ channel, payload })
      },
    },
  } as never)
  return messages
}

function processedTexts(messages: SentMessage[]): string[] {
  return messages
    .filter((message) => message.channel === 'stt:processed')
    .flatMap((message) => message.payload.turns?.map((turn) => turn.text) ?? [])
}

function sourcePatchTexts(messages: SentMessage[]): string[] {
  return messages
    .filter((message) => message.channel === 'stt:source-patch')
    .map((message) => message.payload.text)
    .filter((text): text is string => typeof text === 'string')
}

function translationPatchTexts(messages: SentMessage[]): string[] {
  return messages
    .filter((message) => message.channel === 'stt:translation-patch')
    .map((message) => message.payload.translation)
    .filter((translation): translation is string => typeof translation === 'string')
}

describe('classifySentenceEnd', () => {
  it('returns none when no terminal punctuation', () => {
    expect(classifySentenceEnd('we use Opus 4')).toBe('none')
    expect(classifySentenceEnd('hello world')).toBe('none')
    expect(classifySentenceEnd('')).toBe('none')
  })

  it('returns hard for ? ! and CJK enders', () => {
    expect(classifySentenceEnd('what is this?')).toBe('hard')
    expect(classifySentenceEnd('amazing!')).toBe('hard')
    expect(classifySentenceEnd('맞아요。')).toBe('hard')
    expect(classifySentenceEnd('そうですか？')).toBe('hard')
    expect(classifySentenceEnd('すごい！')).toBe('hard')
  })

  it('returns hard for ordinary sentence-ending period', () => {
    expect(classifySentenceEnd('I agree.')).toBe('hard')
    expect(classifySentenceEnd('이것은 문장입니다.')).toBe('hard')
    expect(classifySentenceEnd('Let us begin.')).toBe('hard')
  })

  it('returns soft for digit-before-period (decimal/version)', () => {
    expect(classifySentenceEnd('we use Opus 4.')).toBe('soft')
    expect(classifySentenceEnd('pi is 3.')).toBe('soft')
    expect(classifySentenceEnd('version 3.14.')).toBe('soft')
  })

  it('returns soft for ellipsis', () => {
    expect(classifySentenceEnd('well...')).toBe('soft')
    expect(classifySentenceEnd('hmm..')).toBe('soft')
  })

  it('returns soft for common abbreviations', () => {
    expect(classifySentenceEnd('I met Dr.')).toBe('soft')
    expect(classifySentenceEnd('the U.S.')).toBe('soft')
    expect(classifySentenceEnd('e.g.')).toBe('soft')
    expect(classifySentenceEnd('etc.')).toBe('soft')
    expect(classifySentenceEnd('Mr.')).toBe('soft')
  })

  it('returns soft for single-letter-before-period (initialism in progress)', () => {
    expect(classifySentenceEnd('U.')).toBe('soft')
    expect(classifySentenceEnd('the A.')).toBe('soft')
  })

  it('ignores trailing whitespace', () => {
    expect(classifySentenceEnd('Opus 4.   ')).toBe('soft')
    expect(classifySentenceEnd('done.  ')).toBe('hard')
  })
})

describe('soft-grace finalization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetTranscriptPostProcessor()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetTranscriptPostProcessor()
  })

  it('does not split a decimal: "Opus 4" + "." + "7" stays one turn', () => {
    const messages = initCapture()
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }

    enqueueRoughTranscript('we use Opus 4', hints)
    enqueueRoughTranscript('.', hints)
    vi.advanceTimersByTime(300)
    enqueueRoughTranscript('7 in production.', hints)
    vi.advanceTimersByTime(700)

    expect(processedTexts(messages)).toEqual(['we use Opus 4'])
    expect(sourcePatchTexts(messages)).toContain('we use Opus 4.7 in production.')
  })

  it('finalizes a real numeric sentence after the grace window', () => {
    const messages = initCapture()
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }

    enqueueRoughTranscript('I scored 95.', hints)

    expect(sourcePatchTexts(messages)).toEqual([])
    vi.advanceTimersByTime(750)
    expect(sourcePatchTexts(messages)).toEqual(['I scored 95.'])
  })
})

describe('standalone punctuation merge-back', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetTranscriptPostProcessor()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetTranscriptPostProcessor()
  })

  it('merges a late "?" into the just-finalized turn and retranslates it', async () => {
    const previousApiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'test-key'
    try {
      const messages = initCapture()
      const hints = { sourceLanguageHint: 'en', targetLanguage: 'ko' }
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>
        }
        const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translation: user.includes('what is this?') ? '무엇인가요?' : '무엇인가',
                    sourceLanguage: 'en',
                  }),
                },
              },
            ],
          }),
        } as Response
      })
      vi.stubGlobal('fetch', fetchMock)

      enqueueRoughTranscript('what is this', hints)
      await vi.advanceTimersByTimeAsync(6000)
      fetchMock.mockClear()
      vi.mocked(notifyTranslation).mockClear()

      enqueueRoughTranscript('?', hints)
      await vi.runAllTimersAsync()

      expect(processedTexts(messages)).toEqual(['what is this'])
      expect(sourcePatchTexts(messages)).toContain('what is this?')
      expect(notifySourceTextUpdate).toHaveBeenCalledWith(expect.any(String), 'what is this?')
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('what is this?'),
        })
      )
      expect(translationPatchTexts(messages)).toContain('무엇인가요?')
      expect(notifyTranslation).toHaveBeenCalledWith(expect.any(String), '무엇인가요?')
    } finally {
      if (typeof previousApiKey === 'undefined') {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousApiKey
      }
    }
  })

  it('discards a stray "?" with no recent finalized turn', () => {
    const messages = initCapture()
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }

    enqueueRoughTranscript('?', hints)

    expect(processedTexts(messages)).toEqual([])
    expect(sourcePatchTexts(messages)).toEqual([])
    expect(notifySourceTextUpdate).not.toHaveBeenCalled()
  })

  it('does not merge "?" when an active turn is in progress', () => {
    const messages = initCapture()
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }

    enqueueRoughTranscript('hello', hints)
    enqueueRoughTranscript('?', hints)

    expect(processedTexts(messages)).toEqual(['hello'])
    expect(sourcePatchTexts(messages)).toContain('hello?')
    expect(notifySourceTextUpdate).not.toHaveBeenCalled()
  })

  it('clears the last finalized turn on reset', () => {
    const messages = initCapture()
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }

    enqueueRoughTranscript('previous sentence', hints)
    vi.advanceTimersByTime(6000)
    resetTranscriptPostProcessor()
    enqueueRoughTranscript('?', hints)

    expect(processedTexts(messages)).toEqual(['previous sentence'])
    expect(sourcePatchTexts(messages)).not.toContain('previous sentence?')
    expect(notifySourceTextUpdate).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifySentenceEnd,
  enqueueRoughTranscript,
  init,
  resetTranscriptPostProcessor,
} from '../main/transcriptPostProcessor'

vi.mock('../main/actionItemService', () => ({
  enqueueTranscript: vi.fn(),
}))

vi.mock('../main/whiteboardService', () => ({
  enqueueTranscript: vi.fn(),
}))

type SentMessage = {
  channel: string
  payload: { turns?: Array<{ id: string; text: string }>; id?: string; text?: string }
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

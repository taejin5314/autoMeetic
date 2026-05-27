import { describe, expect, it } from 'vitest'
import { classifySentenceEnd } from '../main/transcriptPostProcessor'

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

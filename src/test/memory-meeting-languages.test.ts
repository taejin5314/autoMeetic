import { describe, expect, it } from 'vitest'
import { resolveMeetingLanguages } from '../main/memory/meetingLanguages'

describe('resolveMeetingLanguages', () => {
  it('uses the renderer transcript language state for meeting metadata', () => {
    expect(
      resolveMeetingLanguages('auto', {
        sourceLanguage: 'en',
        targetLanguage: 'ko',
      })
    ).toEqual({ sourceLanguage: 'en', targetLanguage: 'ko' })
  })

  it('falls back to start language and translation off when state is empty', () => {
    expect(resolveMeetingLanguages('ja', { sourceLanguage: '', targetLanguage: '' })).toEqual({
      sourceLanguage: 'ja',
      targetLanguage: 'off',
    })
  })
})

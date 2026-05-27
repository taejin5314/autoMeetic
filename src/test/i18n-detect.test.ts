import { describe, expect, it, vi } from 'vitest'
import {
  detectSystemLanguage,
  resolveLanguagePreference,
} from '../renderer/i18n/detectSystemLanguage'

describe('detectSystemLanguage', () => {
  it('maps full locale to supported language code', async () => {
    expect(await detectSystemLanguage(() => Promise.resolve('ko-KR'))).toBe('ko')
    expect(await detectSystemLanguage(() => Promise.resolve('en-US'))).toBe('en')
    expect(await detectSystemLanguage(() => Promise.resolve('ja-JP'))).toBe('ja')
    expect(await detectSystemLanguage(() => Promise.resolve('zh-CN'))).toBe('zh')
    expect(await detectSystemLanguage(() => Promise.resolve('zh-TW'))).toBe('zh')
  })

  it('falls back to en for unsupported locale', async () => {
    expect(await detectSystemLanguage(() => Promise.resolve('fr-FR'))).toBe('en')
    expect(await detectSystemLanguage(() => Promise.resolve('de'))).toBe('en')
  })

  it('falls back to en when IPC throws', async () => {
    expect(await detectSystemLanguage(() => Promise.reject(new Error('boom')))).toBe('en')
  })
})

describe('resolveLanguagePreference', () => {
  it('returns stored value when valid', async () => {
    const r = await resolveLanguagePreference({
      readStorage: () => 'ko',
      detectFn: vi.fn(),
    })
    expect(r).toBe('ko')
  })

  it('calls detect when stored value is "system"', async () => {
    const detect = vi.fn().mockResolvedValue('ja')
    const r = await resolveLanguagePreference({
      readStorage: () => 'system',
      detectFn: detect,
    })
    expect(r).toBe('ja')
    expect(detect).toHaveBeenCalled()
  })

  it('calls detect when no stored value', async () => {
    const detect = vi.fn().mockResolvedValue('zh')
    const r = await resolveLanguagePreference({
      readStorage: () => null,
      detectFn: detect,
    })
    expect(r).toBe('zh')
  })

  it('falls back to en when stored value is corrupted', async () => {
    const r = await resolveLanguagePreference({
      readStorage: () => 'klingon',
      detectFn: vi.fn().mockResolvedValue('en'),
    })
    // Treat invalid stored as if no preference set
    expect(r).toBe('en')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildExtractionSystemPrompt,
  parseExtractionResponse,
} from '../main/glossary/extractionPrompt'

describe('buildExtractionSystemPrompt', () => {
  it('embeds the target language name and existing terms', () => {
    const out = buildExtractionSystemPrompt({
      targetLang: 'ko',
      existingTerms: ['autoMeetic', 'GPU'],
      dismissedTerms: ['ignore'],
    })
    expect(out).toContain('Active target language: ko')
    expect(out).toContain('autoMeetic')
    expect(out).toContain('GPU')
    expect(out).toContain('ignore')
  })

  it('uses (empty) marker when lists are empty', () => {
    const out = buildExtractionSystemPrompt({
      targetLang: 'off',
      existingTerms: [],
      dismissedTerms: [],
    })
    expect(out).toContain('(empty)')
    expect(out).toContain('Active target language: off')
  })

  it('truncates long term lists to 200 entries each', () => {
    const big = Array.from({ length: 500 }, (_, i) => `term${i}`)
    const out = buildExtractionSystemPrompt({
      targetLang: 'ko',
      existingTerms: big,
      dismissedTerms: big,
    })
    expect(out).not.toContain('term499')
    expect(out).toContain('term0')
    expect(out).toContain('term199')
  })
})

describe('parseExtractionResponse', () => {
  it('returns [] for non-JSON content', () => {
    expect(parseExtractionResponse('not json')).toEqual([])
  })

  it('returns [] when candidates is missing', () => {
    expect(parseExtractionResponse('{"foo": "bar"}')).toEqual([])
  })

  it('parses valid candidates', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          sourceTerm: 'kunchen',
          variants: ['Kun Chen'],
          translations: { ko: '쿤 첸' },
          preserve: false,
          confidence: 0.85,
          reason: 'Personal name',
          frequency: 4,
        },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out).toHaveLength(1)
    expect(out[0].sourceTerm).toBe('kunchen')
    expect(out[0].translations).toEqual({ ko: '쿤 첸' })
  })

  it('drops candidates with confidence < 0.5', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          sourceTerm: 'low',
          variants: [],
          translations: {},
          preserve: true,
          confidence: 0.3,
          reason: 'x',
          frequency: 1,
        },
        {
          sourceTerm: 'ok',
          variants: [],
          translations: {},
          preserve: true,
          confidence: 0.6,
          reason: 'y',
          frequency: 2,
        },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out.map((c) => c.sourceTerm)).toEqual(['ok'])
  })

  it('drops candidates with invalid types', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          sourceTerm: '',
          variants: [],
          translations: {},
          preserve: false,
          confidence: 0.9,
          reason: '',
          frequency: 1,
        },
        {
          sourceTerm: 123,
          variants: [],
          translations: {},
          preserve: true,
          confidence: 0.9,
          reason: 'y',
          frequency: 1,
        },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out).toEqual([])
  })

  it('truncates reason to 200 chars and clamps variants to non-empty strings', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          sourceTerm: 'X',
          variants: ['valid', '', '   ', 42],
          translations: {},
          preserve: true,
          confidence: 0.9,
          reason: 'r'.repeat(300),
          frequency: 1,
        },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out).toHaveLength(1)
    expect(out[0].variants).toEqual(['valid'])
    expect((out[0].reason ?? '').length).toBeLessThanOrEqual(200)
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildLabelLanguageBlock,
  formatGlossaryPromptSection,
  normalizePreserveTerms,
} from '../main/glossary/promptInjection'
import type { GlossaryEntry } from '../main/memory/types'

function entry(over: Partial<GlossaryEntry>): GlossaryEntry {
  return {
    id: 'x',
    scope: 'global',
    meetingId: null,
    sourceTerm: 'autoMeetic',
    translations: {},
    preserve: false,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('formatGlossaryPromptSection', () => {
  it('returns empty string for empty entries', () => {
    expect(formatGlossaryPromptSection([], 'ko')).toBe('')
  })

  it('returns empty string when entries exist but none match target', () => {
    const entries = [entry({ translations: { ja: 'auto' }, preserve: false })]
    expect(formatGlossaryPromptSection(entries, 'ko')).toBe('')
  })

  it('lists verbatim terms when preserve=true and no target translation', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    const out = formatGlossaryPromptSection(entries, 'ko')
    expect(out).toContain('GLOSSARY')
    expect(out).toContain('GPU')
    expect(out).toContain('verbatim')
  })

  it('emits mapped translation when target translation exists', () => {
    const entries = [
      entry({ sourceTerm: 'kunchen', translations: { ko: '쿤 첸' } }),
    ]
    const out = formatGlossaryPromptSection(entries, 'ko')
    expect(out).toContain('kunchen')
    expect(out).toContain('쿤 첸')
    expect(out).toContain('Korean')
  })

  it('lets target translation win over preserve when both apply for that lang', () => {
    const entries = [
      entry({
        sourceTerm: 'Anthropic',
        preserve: true,
        translations: { ko: '앤트로픽' },
      }),
    ]
    const out = formatGlossaryPromptSection(entries, 'ko')
    expect(out).toContain('앤트로픽')
    expect(out).not.toMatch(/verbatim[\s\S]*Anthropic/)
  })

  it('falls back to verbatim list when target is null', () => {
    const entries = [
      entry({ sourceTerm: 'GPU', preserve: true }),
      entry({ sourceTerm: 'kunchen', translations: { ko: '쿤 첸' } }),
    ]
    const out = formatGlossaryPromptSection(entries, null)
    expect(out).toContain('GPU')
    expect(out).not.toContain('쿤 첸')
  })
})

describe('normalizePreserveTerms', () => {
  it('normalizes casing for preserve=true terms', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    expect(normalizePreserveTerms('uses gpu and Gpu daily', entries)).toBe(
      'uses GPU and GPU daily'
    )
  })

  it('respects word boundaries (does not touch GPUS)', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    expect(normalizePreserveTerms('multiple GPUS at once', entries)).toBe(
      'multiple GPUS at once'
    )
  })

  it('leaves non-preserve entries untouched', () => {
    const entries = [
      entry({ sourceTerm: 'kunchen', preserve: false, translations: { ko: '쿤 첸' } }),
    ]
    expect(normalizePreserveTerms('Kunchen said hi', entries)).toBe('Kunchen said hi')
  })

  it('returns input unchanged when entries is empty', () => {
    expect(normalizePreserveTerms('anything goes', [])).toBe('anything goes')
  })
})

describe('buildLabelLanguageBlock', () => {
  it('renders the language name for a known code', () => {
    const out = buildLabelLanguageBlock('ko')
    expect(out).toContain('Korean')
    expect(out).toContain('LABEL LANGUAGE')
  })

  it('falls back to the raw code when unknown', () => {
    const out = buildLabelLanguageBlock('xx')
    expect(out).toContain('xx')
  })
})

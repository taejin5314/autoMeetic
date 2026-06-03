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
    variants: [],
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
    expect(normalizePreserveTerms('uses gpu and Gpu daily', entries).text).toBe(
      'uses GPU and GPU daily'
    )
  })

  it('respects word boundaries (does not touch GPUS)', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    expect(normalizePreserveTerms('multiple GPUS at once', entries).text).toBe(
      'multiple GPUS at once'
    )
  })

  it('leaves non-preserve entries untouched', () => {
    const entries = [
      entry({ sourceTerm: 'kunchen', preserve: false, translations: { ko: '쿤 첸' } }),
    ]
    expect(normalizePreserveTerms('Kunchen said hi', entries).text).toBe('Kunchen said hi')
  })

  it('returns input unchanged when entries is empty', () => {
    expect(normalizePreserveTerms('anything goes', []).text).toBe('anything goes')
  })
})

describe('formatGlossaryPromptSection — variants', () => {
  it('mentions variants alongside the canonical for verbatim terms', () => {
    const section = formatGlossaryPromptSection(
      [
        {
          id: 'e1', scope: 'global', meetingId: null,
          sourceTerm: 'RealtimeOrchestrator',
          translations: {}, preserve: true, note: null,
          variants: ['real time orchestrator', 'realtime orchestrator'],
          createdAt: 0, updatedAt: 0,
        },
      ],
      null
    )
    expect(section).toContain('RealtimeOrchestrator')
    expect(section).toContain('real time orchestrator')
    expect(section).toContain('realtime orchestrator')
  })

  it('caps variants per entry in the prompt at 10 with an etc note', () => {
    const variants = Array.from({ length: 15 }, (_, i) => `variant${i}`)
    const section = formatGlossaryPromptSection(
      [
        {
          id: 'e1', scope: 'global', meetingId: null,
          sourceTerm: 'Foo', translations: {},
          preserve: true, note: null, variants,
          createdAt: 0, updatedAt: 0,
        },
      ],
      null
    )
    expect(section).toContain('variant0')
    expect(section).toContain('variant9')
    expect(section).not.toContain('variant10')
    expect(section.toLowerCase()).toMatch(/etc|more/)
  })
})

describe('normalizePreserveTerms — variants', () => {
  const entry = {
    id: 'e1', scope: 'global' as const, meetingId: null,
    sourceTerm: 'RealtimeOrchestrator',
    translations: {}, preserve: true, note: null,
    variants: ['real time orchestrator', 'realtime orchestrator'],
    createdAt: 0, updatedAt: 0,
  }

  it('rewrites variants to the canonical form', () => {
    expect(
      normalizePreserveTerms('the real time orchestrator runs', [entry]).text
    ).toBe('the RealtimeOrchestrator runs')
  })

  it('is case-insensitive across variants', () => {
    expect(
      normalizePreserveTerms('REAL TIME ORCHESTRATOR', [entry]).text
    ).toBe('RealtimeOrchestrator')
  })

  it('leaves unrelated text alone', () => {
    expect(
      normalizePreserveTerms('the architect went home', [entry]).text
    ).toBe('the architect went home')
  })

  it('dedupes variants identical to the canonical (no-op)', () => {
    const dup = { ...entry, variants: ['RealtimeOrchestrator'] }
    expect(
      normalizePreserveTerms('the RealtimeOrchestrator runs', [dup]).text
    ).toBe('the RealtimeOrchestrator runs')
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

import { describe, expect, it } from 'vitest'
import { normalizePreserveTerms } from '../main/glossary/promptInjection'
import type { GlossaryEntry } from '../main/memory/types'

function entry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id: 'g1',
    scope: 'global',
    meetingId: null,
    sourceTerm: 'RealtimeOrchestrator',
    translations: {},
    preserve: true,
    note: null,
    variants: ['real time orchestrator', 'realtime orchestrator'],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('Coach glossary normalization extension', () => {
  it('preserves normalized text while reporting variant to canonical pairs', () => {
    const result = normalizePreserveTerms(
      'real time orchestrator and realtime orchestrator',
      [entry()]
    )

    expect(result.text).toBe('RealtimeOrchestrator and RealtimeOrchestrator')
    expect(result.pairs).toEqual([
      { variant: 'real time orchestrator', canonical: 'RealtimeOrchestrator' },
      { variant: 'realtime orchestrator', canonical: 'RealtimeOrchestrator' },
    ])
  })

  it('dedupes identical pairs within one normalization call', () => {
    const result = normalizePreserveTerms(
      'real time orchestrator, real time orchestrator',
      [entry()]
    )

    expect(result.text).toBe('RealtimeOrchestrator, RealtimeOrchestrator')
    expect(result.pairs).toEqual([
      { variant: 'real time orchestrator', canonical: 'RealtimeOrchestrator' },
    ])
  })

  it('returns empty pairs when nothing is normalized', () => {
    const result = normalizePreserveTerms('plain text', [entry()])

    expect(result.text).toBe('plain text')
    expect(result.pairs).toEqual([])
  })
})

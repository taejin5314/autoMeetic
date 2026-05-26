import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../main/memory/types'
import { applyHighlights, buildMatcher } from '../renderer/glossary/glossaryMatcher'

const entry = (over: Partial<GlossaryEntry>): GlossaryEntry => ({
  id: 'e1',
  scope: 'global',
  meetingId: null,
  sourceTerm: 'RealtimeOrchestrator',
  translations: {},
  preserve: true,
  note: null,
  variants: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

describe('glossaryMatcher', () => {
  it('matches the canonical sourceTerm with word boundaries', () => {
    const m = buildMatcher([entry({})])
    const parts = applyHighlights('the RealtimeOrchestrator runs', m)
    expect(parts.map((p) => p.kind)).toEqual(['text', 'match', 'text'])
    expect(parts[1].value).toBe('RealtimeOrchestrator')
  })

  it('matches variants alongside canonical', () => {
    const m = buildMatcher([entry({ variants: ['real time orchestrator'] })])
    const parts = applyHighlights('the real time orchestrator runs', m)
    const matches = parts.filter((p) => p.kind === 'match').map((p) => p.value)
    expect(matches).toEqual(['real time orchestrator'])
  })

  it('does not match substrings inside larger words', () => {
    const m = buildMatcher([entry({ sourceTerm: 'AI' })])
    const parts = applyHighlights('he said again', m)
    expect(parts.filter((p) => p.kind === 'match')).toHaveLength(0)
  })

  it('excludes entries whose normalized canonical is <= 2 chars', () => {
    const m = buildMatcher([entry({ sourceTerm: 'AI' })])
    const parts = applyHighlights('AI is here', m)
    expect(parts.filter((p) => p.kind === 'match')).toHaveLength(0)
  })

  it('handles Hangul matches using lookarounds', () => {
    const m = buildMatcher([entry({ sourceTerm: '에이전트', variants: [] })])
    const parts = applyHighlights('이 에이전트는 빠르다', m)
    const matches = parts.filter((p) => p.kind === 'match').map((p) => p.value)
    expect(matches).toEqual(['에이전트'])
  })

  it('returns plain text when entries list is empty', () => {
    const m = buildMatcher([])
    const parts = applyHighlights('anything', m)
    expect(parts).toEqual([{ kind: 'text', value: 'anything' }])
  })
})

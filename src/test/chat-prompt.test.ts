import { describe, expect, it } from 'vitest'
import {
  buildChatSystemPrompt,
  enforceContextBudget,
  formatSourcesBlock,
  stripCitations,
} from '../main/memory/prompts/chat.v1'
import type { ChatSource } from '../main/memory/types'

function src(over: Partial<ChatSource>): ChatSource {
  return {
    marker: 1,
    kind: 'segment',
    meetingId: 'mtg_1',
    meetingTitle: 'Meeting',
    segmentId: 's1',
    segmentText: 'hello world',
    timestampMs: 0,
    meetingStartedAt: 1_700_000_000_000,
    score: 0.9,
    ...over,
  }
}

describe('formatSourcesBlock', () => {
  it('renders each source with marker, title, timestamp, preview', () => {
    const block = formatSourcesBlock([
      src({ marker: 1, meetingTitle: 'Q4 OKR', segmentText: 'defer mobile' }),
      src({ marker: 2, meetingTitle: '1:1 with Sarah', segmentText: 'migration risk' }),
    ])
    expect(block).toMatch(/\[1\] Meeting "Q4 OKR"/)
    expect(block).toContain('defer mobile')
    expect(block).toMatch(/\[2\] Meeting "1:1 with Sarah"/)
    expect(block).toContain('migration risk')
  })

  it('marks meeting-summary kind explicitly', () => {
    const block = formatSourcesBlock([src({ kind: 'meeting-summary' })])
    expect(block).toContain('[summary]')
  })
})

describe('buildChatSystemPrompt', () => {
  it('includes sources block and rules', () => {
    const out = buildChatSystemPrompt({
      sources: [src({ segmentText: 'foo' })],
      glossaryBlock: '',
    })
    expect(out).toContain('SOURCES')
    expect(out).toContain('Use ONLY information from the SOURCES')
    expect(out).toContain('foo')
  })

  it('appends glossary block when present', () => {
    const out = buildChatSystemPrompt({
      sources: [src({})],
      glossaryBlock: 'GLOSSARY: keep GPU verbatim',
    })
    expect(out).toContain('GLOSSARY: keep GPU verbatim')
  })

  it('omits glossary section when empty', () => {
    const out = buildChatSystemPrompt({ sources: [src({})], glossaryBlock: '' })
    expect(out).not.toContain('GLOSSARY')
  })
})

describe('enforceContextBudget', () => {
  it('keeps every source when under budget', () => {
    const list = [src({ segmentText: 'a'.repeat(50) }), src({ segmentText: 'b'.repeat(50) })]
    expect(enforceContextBudget(list, 1000)).toHaveLength(2)
  })

  it('stops at the first source that would exceed budget', () => {
    const list = [
      src({ marker: 1, segmentText: 'a'.repeat(900) }),
      src({ marker: 2, segmentText: 'b'.repeat(900) }),
      src({ marker: 3, segmentText: 'c'.repeat(900) }),
    ]
    const out = enforceContextBudget(list, 1500)
    expect(out.map((s) => s.marker)).toEqual([1])
  })
})

describe('stripCitations', () => {
  it('removes single [^N] markers', () => {
    expect(stripCitations('mobile defer [^1] confirmed')).toBe('mobile defer confirmed')
  })

  it('removes multiple markers including multi-digit', () => {
    expect(stripCitations('foo [^1] bar [^23] baz [^4]')).toBe('foo bar baz')
  })

  it('collapses extra whitespace after removal', () => {
    expect(stripCitations('foo   [^1]    bar')).toBe('foo bar')
  })
})

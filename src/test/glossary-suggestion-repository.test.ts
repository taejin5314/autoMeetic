import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossarySuggestionInput, Meeting } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function sampleMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_test_1',
    title: 'Meeting',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    sourceLanguage: 'auto',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
    ...overrides,
  }
}

function sampleSuggestion(over: Partial<GlossarySuggestionInput> = {}): GlossarySuggestionInput {
  return {
    meetingId: 'mtg_test_1',
    sourceTerm: 'kunchen',
    translations: { ko: '쿤 첸' },
    preserve: false,
    confidence: 0.85,
    reason: 'Personal name',
    frequency: 4,
    variants: ['Kun Chen', 'Kunchen'],
    ...over,
  }
}

describe('MemoryRepository suggestion CRUD', () => {
  it('inserts a suggestion and returns it with generated id', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const s = repo.upsertSuggestion(sampleSuggestion())
    expect(s.id).toMatch(/^sugg_/)
    expect(s.sourceTerm).toBe('kunchen')
    expect(s.translations).toEqual({ ko: '쿤 첸' })
    expect(s.variants).toEqual(['Kun Chen', 'Kunchen'])
    expect(s.createdAt).toBeGreaterThan(0)
    repo.close()
  })

  it('lists suggestions by meeting in createdAt DESC order', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const a = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'a' }))
    const b = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'b' }))
    const list = repo.listSuggestionsByMeeting('mtg_test_1')
    expect(list.map((s) => s.id)).toEqual([b.id, a.id])
    repo.close()
  })

  it('listAllPendingSuggestions returns across meetings, newest first', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting({ id: 'mtg_a', startedAt: 1 }))
    repo.insertMeeting(sampleMeeting({ id: 'mtg_b', startedAt: 2 }))
    repo.upsertSuggestion(sampleSuggestion({ meetingId: 'mtg_a', sourceTerm: 'x' }))
    repo.upsertSuggestion(sampleSuggestion({ meetingId: 'mtg_b', sourceTerm: 'y' }))
    const list = repo.listAllPendingSuggestions()
    expect(list.length).toBe(2)
    expect(list[0].sourceTerm).toBe('y')
    repo.close()
  })

  it('countPendingSuggestions returns the number of pending rows', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    expect(repo.countPendingSuggestions()).toBe(0)
    repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'a' }))
    repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'b' }))
    expect(repo.countPendingSuggestions()).toBe(2)
    repo.close()
  })

  it('rejects empty sourceTerm', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    expect(() => repo.upsertSuggestion(sampleSuggestion({ sourceTerm: '   ' }))).toThrow(
      /sourceTerm/i
    )
    repo.close()
  })

  it('rejects confidence outside [0, 1]', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    expect(() => repo.upsertSuggestion(sampleSuggestion({ confidence: 1.5 }))).toThrow(/confidence/i)
    expect(() => repo.upsertSuggestion(sampleSuggestion({ confidence: -0.1 }))).toThrow(/confidence/i)
    repo.close()
  })

  it('cascades on meeting delete', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.upsertSuggestion(sampleSuggestion())
    repo.deleteMeeting('mtg_test_1')
    expect(repo.countPendingSuggestions()).toBe(0)
    repo.close()
  })
})

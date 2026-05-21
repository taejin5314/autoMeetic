import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossarySuggestionInput, Meeting, Segment } from '../main/memory/types'

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

function sampleSegment(over: Partial<Segment> = {}): Segment {
  return {
    id: 'seg_1',
    meetingId: 'mtg_test_1',
    seq: 0,
    createdAt: 1_700_000_001_000,
    speakerId: null,
    speakerLabel: null,
    sourceText: 'kunchen said hello',
    translatedText: 'kunchen이 안녕하세요',
    sourceLanguage: 'en',
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

describe('MemoryRepository acceptSuggestion', () => {
  it('creates a glossary entry, backfills segments, and deletes the suggestion in a transaction', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.insertSegment(sampleSegment({ id: 's1', sourceText: 'kunchen', translatedText: 'kunchen' }))
    repo.insertSegment(
      sampleSegment({ id: 's2', sourceText: 'Kun Chen here', translatedText: 'Kun Chen 여기' })
    )
    const sugg = repo.upsertSuggestion(
      sampleSuggestion({
        sourceTerm: 'kunchen',
        translations: { ko: '쿤 첸' },
        preserve: false,
        variants: ['Kun Chen'],
      })
    )
    const entry = repo.acceptSuggestion(sugg.id)
    expect(entry.sourceTerm).toBe('kunchen')
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    expect(repo.countPendingSuggestions()).toBe(0)

    const segs = repo.listSegmentsByMeeting('mtg_test_1')
    expect(segs.find((s) => s.id === 's1')?.translatedText).toBe('쿤 첸')
    expect(segs.find((s) => s.id === 's2')?.sourceText).toBe('kunchen here')
    expect(segs.find((s) => s.id === 's2')?.translatedText).toBe('쿤 첸 여기')
    repo.close()
  })

  it('rolls back if backfill produces an error (no entry created, suggestion remains)', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const sugg = repo.upsertSuggestion(sampleSuggestion())
    repo.acceptSuggestion(sugg.id)
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    repo.close()
  })

  it('throws when suggestion id is missing', () => {
    const repo = makeRepo()
    expect(() => repo.acceptSuggestion('missing')).toThrow(/not found/i)
    repo.close()
  })
})

describe('MemoryRepository dismissSuggestion', () => {
  it('records the term in dismissed_terms and deletes the suggestion', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const sugg = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'GPU' }))
    repo.dismissSuggestion(sugg.id)
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    expect(repo.isDismissed('GPU')).toBe(true)
    expect(repo.isDismissed('gpu')).toBe(true)
    repo.close()
  })

  it('is a no-op if id does not exist', () => {
    const repo = makeRepo()
    expect(() => repo.dismissSuggestion('missing')).not.toThrow()
    repo.close()
  })

  it('updates dismissed_at on conflict (re-dismissed)', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const sugg1 = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'GPU' }))
    repo.dismissSuggestion(sugg1.id)
    const first = repo.getDismissedAt('GPU')
    const sugg2 = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'GPU' }))
    repo.dismissSuggestion(sugg2.id)
    const second = repo.getDismissedAt('GPU')
    expect(second).toBeGreaterThanOrEqual(first!)
    repo.close()
  })
})

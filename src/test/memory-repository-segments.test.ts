import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting, Segment } from '../main/memory/types'

function makeRepoWithMeeting(): { repo: MemoryRepository; meeting: Meeting } {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_1',
    title: 't',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
  }
  repo.insertMeeting(meeting)
  return { repo, meeting }
}

function sampleSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'turn_a',
    meetingId: 'mtg_1',
    seq: 0,
    createdAt: 1000,
    speakerId: 'speaker_a',
    speakerLabel: 'Speaker A',
    sourceText: 'hello',
    translatedText: null,
    sourceLanguage: 'en',
    ...overrides,
  }
}

describe('MemoryRepository segments', () => {
  it('inserts and retrieves segments ordered by seq', () => {
    const { repo } = makeRepoWithMeeting()
    repo.insertSegment(sampleSegment({ id: 'a', seq: 0 }))
    repo.insertSegment(sampleSegment({ id: 'b', seq: 2 }))
    repo.insertSegment(sampleSegment({ id: 'c', seq: 1 }))
    expect(repo.getSegments('mtg_1').map((s) => s.id)).toEqual(['a', 'c', 'b'])
    repo.close()
  })

  it('nextSeq returns monotonically increasing seq per meeting', () => {
    const { repo } = makeRepoWithMeeting()
    expect(repo.nextSeq('mtg_1')).toBe(0)
    repo.insertSegment(sampleSegment({ id: 'a', seq: 0 }))
    expect(repo.nextSeq('mtg_1')).toBe(1)
    repo.insertSegment(sampleSegment({ id: 'b', seq: 1 }))
    expect(repo.nextSeq('mtg_1')).toBe(2)
    repo.close()
  })

  it('incrementSegmentCount bumps meeting count', () => {
    const { repo } = makeRepoWithMeeting()
    repo.incrementSegmentCount('mtg_1')
    repo.incrementSegmentCount('mtg_1')
    expect(repo.getMeeting('mtg_1')?.segmentCount).toBe(2)
    repo.close()
  })

  it('updateTranslation sets translated_text', () => {
    const { repo } = makeRepoWithMeeting()
    repo.insertSegment(sampleSegment({ id: 'a' }))
    repo.updateTranslation('a', 'hello translated')
    const [seg] = repo.getSegments('mtg_1')
    expect(seg.translatedText).toBe('hello translated')
    repo.close()
  })

  it('updateTranslation on unknown id is a silent no-op', () => {
    const { repo } = makeRepoWithMeeting()
    expect(() => repo.updateTranslation('does-not-exist', 'x')).not.toThrow()
    repo.close()
  })
})

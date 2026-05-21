import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossaryEntry, Meeting, Segment } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_1',
    title: 'm',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
    ...overrides,
  }
}

function seg(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    meetingId: 'mtg_1',
    seq: 0,
    createdAt: 2,
    speakerId: null,
    speakerLabel: null,
    sourceText: '',
    translatedText: '',
    sourceLanguage: 'en',
    ...overrides,
  }
}

function entry(overrides: Partial<GlossaryEntry>): GlossaryEntry {
  return {
    id: 'g1',
    scope: 'global',
    meetingId: null,
    sourceTerm: 'kunchen',
    translations: {},
    preserve: false,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('backfillSegments - preserve=true', () => {
  it('canonicalizes source and translated text for verbatim terms', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'GPU helps', translatedText: 'gpu helps' }))
    repo.insertSegment(seg({ id: 's2', sourceText: 'gpu power', translatedText: 'GPU 파워' }))
    const e = entry({ sourceTerm: 'GPU', preserve: true })
    const n = repo.backfillSegments('mtg_1', e, [])
    expect(n).toBe(2)
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs.find((s) => s.id === 's1')?.translatedText).toBe('GPU helps')
    expect(segs.find((s) => s.id === 's2')?.sourceText).toBe('GPU power')
    repo.close()
  })

  it('respects word boundaries (does not touch GPUS)', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'multiple GPUS here', translatedText: 'gpus here' }))
    const e = entry({ sourceTerm: 'GPU', preserve: true })
    const n = repo.backfillSegments('mtg_1', e, [])
    expect(n).toBe(0)
    repo.close()
  })

  it('uses variants too', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'Kun Chen joined', translatedText: 'Kun Chen 합류' }))
    const e = entry({ sourceTerm: 'kunchen', preserve: true })
    repo.backfillSegments('mtg_1', e, ['Kun Chen'])
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs[0].sourceText).toBe('kunchen joined')
    expect(segs[0].translatedText).toBe('kunchen 합류')
    repo.close()
  })
})

describe('backfillSegments - preserve=false with translation mapping', () => {
  it('canonicalizes source and applies translation in target column', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting({ targetLanguage: 'ko' }))
    repo.insertSegment(
      seg({ id: 's1', sourceText: 'Kun Chen said', translatedText: 'Kun Chen이 말했다' })
    )
    const e = entry({
      sourceTerm: 'kunchen',
      preserve: false,
      translations: { ko: '쿤 첸' },
    })
    repo.backfillSegments('mtg_1', e, ['Kun Chen'])
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs[0].sourceText).toBe('kunchen said')
    expect(segs[0].translatedText).toBe('쿤 첸이 말했다')
    repo.close()
  })

  it('leaves translation alone when targetLanguage has no entry', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting({ targetLanguage: 'ja' }))
    repo.insertSegment(seg({ id: 's1', sourceText: 'Kun Chen', translatedText: 'Kun Chen' }))
    const e = entry({
      sourceTerm: 'kunchen',
      preserve: false,
      translations: { ko: '쿤 첸' },
    })
    repo.backfillSegments('mtg_1', e, ['Kun Chen'])
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs[0].sourceText).toBe('kunchen')
    expect(segs[0].translatedText).toBe('Kun Chen')
    repo.close()
  })
})

describe('backfillSegments - returns count of changed rows', () => {
  it('counts only segments that actually changed', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'no match here', translatedText: 'no match' }))
    const e = entry({ sourceTerm: 'kunchen', preserve: true })
    expect(repo.backfillSegments('mtg_1', e, [])).toBe(0)
    repo.close()
  })
})

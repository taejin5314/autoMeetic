import { describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { SearchService } from '../main/memory/searchService'
import type { Meeting, Segment } from '../main/memory/types'

function setup() {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_1',
    title: 'Test',
    startedAt: 1,
    endedAt: 2,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 1,
  }
  repo.insertMeeting(meeting)
  const segments: Segment[] = [
    {
      id: 's1',
      meetingId: 'mtg_1',
      seq: 0,
      createdAt: 10,
      speakerId: null,
      speakerLabel: 'Speaker A',
      sourceText: 'demand forecast prophet',
      translatedText: 'demand forecast translated',
      sourceLanguage: 'en',
    },
    {
      id: 's2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 11,
      speakerId: null,
      speakerLabel: 'Speaker B',
      sourceText: 'pizza party friday',
      translatedText: 'pizza translated',
      sourceLanguage: 'en',
    },
  ]
  for (const s of segments) repo.insertSegment(s)
  repo.saveEmbedding('s1', new Float32Array([1, 0]), 'm-test')
  repo.saveEmbedding('s2', new Float32Array([0, 1]), 'm-test')
  return repo
}

describe('SearchService', () => {
  it('returns segments ranked by cosine similarity descending', async () => {
    const repo = setup()
    const embedder = { embedQuery: vi.fn(async () => new Float32Array([1, 0])) }
    const svc = new SearchService(repo, embedder as never, { threshold: 0 })
    const hits = await svc.search('demand forecast', 10)
    expect(hits[0].segmentId).toBe('s1')
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
    expect(hits[0].meetingTitle).toBe('Test')
    expect(hits[0].translatedText).toBe('demand forecast translated')
    repo.close()
  })

  it('filters out scores below the threshold', async () => {
    const repo = setup()
    const embedder = { embedQuery: vi.fn(async () => new Float32Array([1, 0])) }
    const svc = new SearchService(repo, embedder as never, { threshold: 0.5 })
    const hits = await svc.search('demand forecast', 10)
    expect(hits.map((h) => h.segmentId)).toEqual(['s1'])
    repo.close()
  })

  it('respects the limit parameter', async () => {
    const repo = setup()
    const embedder = { embedQuery: vi.fn(async () => new Float32Array([0.7, 0.7])) }
    const svc = new SearchService(repo, embedder as never, { threshold: 0 })
    const hits = await svc.search('q', 1)
    expect(hits).toHaveLength(1)
    repo.close()
  })

  it('returns empty array when there are no embeddings', async () => {
    const repo = new MemoryRepository(':memory:')
    const embedder = { embedQuery: vi.fn(async () => new Float32Array([1, 0])) }
    const svc = new SearchService(repo, embedder as never, { threshold: 0 })
    expect(await svc.search('q', 10)).toEqual([])
    repo.close()
  })
})

import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting, Segment, Summary } from '../main/memory/types'

function setup() {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_1',
    title: 't',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: null,
  }
  repo.insertMeeting(meeting)
  const seg: Segment = {
    id: 'seg_1',
    meetingId: 'mtg_1',
    seq: 0,
    createdAt: 10,
    speakerId: null,
    speakerLabel: null,
    sourceText: 'hello world',
    translatedText: null,
    sourceLanguage: 'en',
  }
  repo.insertSegment(seg)
  return { repo, meeting, seg }
}

function sampleSummary(): Summary {
  return {
    meetingId: 'mtg_1',
    shortSummary: 'short summary',
    detailedSummary: '- a\n- b',
    keyPoints: ['k1', 'k2'],
    actionItems: [{ text: 'do it' }],
    generatedAt: 1234,
    model: 'gpt-4o-mini',
    promptVersion: 'v1',
    status: 'ok',
  }
}

describe('MemoryRepository summaries', () => {
  it('upserts and reads back a summary', () => {
    const { repo } = setup()
    const s = sampleSummary()
    repo.upsertSummary(s)
    expect(repo.getSummary('mtg_1')).toEqual(s)
    repo.close()
  })

  it('overwrites an existing summary on second upsert', () => {
    const { repo } = setup()
    repo.upsertSummary(sampleSummary())
    repo.upsertSummary({ ...sampleSummary(), shortSummary: 'changed' })
    expect(repo.getSummary('mtg_1')?.shortSummary).toBe('changed')
    repo.close()
  })

  it('returns null for missing summary', () => {
    const { repo } = setup()
    expect(repo.getSummary('mtg_1')).toBeNull()
    repo.close()
  })
})

describe('MemoryRepository embeddings', () => {
  it('saves and reads embeddings preserving float32 bytes', () => {
    const { repo } = setup()
    const vec = new Float32Array([0.1, 0.2, 0.3])
    repo.saveEmbedding('seg_1', vec, 'm1')
    const rows = repo.getAllEmbeddings()
    expect(rows).toHaveLength(1)
    expect(rows[0].segmentId).toBe('seg_1')
    expect(rows[0].model).toBe('m1')
    expect(Array.from(rows[0].vector)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ])
    repo.close()
  })

  it('saves a batch of embeddings in one transaction', () => {
    const { repo } = setup()
    repo.insertSegment({
      id: 'seg_2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 11,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'x',
      translatedText: null,
      sourceLanguage: null,
    })
    repo.saveEmbeddings([
      { segmentId: 'seg_1', vector: new Float32Array([1, 0]), model: 'm1' },
      { segmentId: 'seg_2', vector: new Float32Array([0, 1]), model: 'm1' },
    ])
    expect(repo.getAllEmbeddings()).toHaveLength(2)
    repo.close()
  })

  it('lists missing embeddings', () => {
    const { repo } = setup()
    repo.insertSegment({
      id: 'seg_2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 11,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'b',
      translatedText: null,
      sourceLanguage: null,
    })
    repo.saveEmbedding('seg_1', new Float32Array([1]), 'm1')
    const missing = repo.getMissingEmbeddings()
    expect(missing.map((m) => m.segmentId)).toEqual(['seg_2'])
    expect(missing[0].text).toBe('b')
    repo.close()
  })

  it('lists missing embeddings for one meeting without including stale rows from another meeting', () => {
    const { repo } = setup()
    repo.insertMeeting({
      id: 'mtg_2',
      title: 't2',
      startedAt: 2,
      endedAt: null,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      status: 'completed',
      segmentCount: 0,
      durationMs: null,
    })
    repo.insertSegment({
      id: 'seg_2',
      meetingId: 'mtg_2',
      seq: 0,
      createdAt: 20,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'other meeting',
      translatedText: null,
      sourceLanguage: 'en',
    })
    expect(repo.getMissingEmbeddings('mtg_1')).toEqual([
      { segmentId: 'seg_1', text: 'hello world' },
    ])
    repo.close()
  })
})

describe('MemoryRepository cascade delete', () => {
  it('deleting a meeting removes its segments, embeddings, and summary', () => {
    const { repo } = setup()
    repo.upsertSummary(sampleSummary())
    repo.saveEmbedding('seg_1', new Float32Array([1, 2]), 'm1')
    repo.deleteMeeting('mtg_1')
    expect(repo.getSegments('mtg_1')).toEqual([])
    expect(repo.getAllEmbeddings()).toEqual([])
    expect(repo.getSummary('mtg_1')).toBeNull()
    repo.close()
  })
})

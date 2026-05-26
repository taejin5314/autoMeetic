import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'

function freshRepo(): MemoryRepository {
  const dir = mkdtempSync(join(tmpdir(), 'autometic-emb-'))
  return new MemoryRepository(join(dir, 'memory.db'))
}

function seedMeeting(repo: MemoryRepository): void {
  repo.insertMeeting({
    id: 'mtg1',
    title: 'm',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
  })
}

function seedSegment(repo: MemoryRepository, id: string, text = 'hello', seq = 1): void {
  repo.insertSegment({
    id,
    meetingId: 'mtg1',
    seq,
    createdAt: seq,
    speakerId: null,
    speakerLabel: null,
    sourceText: text,
    translatedText: null,
    sourceLanguage: 'ko',
  })
}

describe('MemoryRepository — embedding_failures + backfill derivation', () => {
  let repo: MemoryRepository

  beforeEach(() => {
    repo = freshRepo()
    seedMeeting(repo)
  })

  it('schema version is 4 after fresh init', () => {
    expect(repo.getSchemaVersion()).toBe(4)
  })

  it('getSegmentsNeedingEmbedding returns segments without embedding or failure', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    const pending = repo.getSegmentsNeedingEmbedding()
    expect(pending.map((p) => p.segmentId).sort()).toEqual(['s1', 's2'])
    expect(pending[0].sourceText.length).toBeGreaterThan(0)
  })

  it('getSegmentsNeedingEmbedding excludes segments that already have an embedding', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    repo.saveEmbeddings([{ segmentId: 's1', vector: new Float32Array([1, 2]), model: 'm' }])
    const pending = repo.getSegmentsNeedingEmbedding()
    expect(pending.map((p) => p.segmentId)).toEqual(['s2'])
  })

  it('getSegmentsNeedingEmbedding excludes segments recorded in embedding_failures', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    repo.recordEmbeddingFailure('s1', 3, 'boom')
    const pending = repo.getSegmentsNeedingEmbedding()
    expect(pending.map((p) => p.segmentId)).toEqual(['s2'])
  })

  it('recordEmbeddingFailure inserts a row and is idempotent (REPLACE)', () => {
    seedSegment(repo, 's1')
    repo.recordEmbeddingFailure('s1', 3, 'first')
    repo.recordEmbeddingFailure('s1', 3, 'second')
    const failures = repo.listEmbeddingFailures(10)
    expect(failures).toHaveLength(1)
    expect(failures[0].lastError).toBe('second')
    expect(failures[0].attempts).toBe(3)
  })

  it('clearEmbeddingFailures([ids]) removes specified rows', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    repo.recordEmbeddingFailure('s1', 3, 'x')
    repo.recordEmbeddingFailure('s2', 3, 'y')
    repo.clearEmbeddingFailures(['s1'])
    const remaining = repo.listEmbeddingFailures(10).map((f) => f.segmentId)
    expect(remaining).toEqual(['s2'])
  })

  it('clearEmbeddingFailures() with no args removes all rows', () => {
    seedSegment(repo, 's1')
    repo.recordEmbeddingFailure('s1', 1, 'x')
    repo.clearEmbeddingFailures()
    expect(repo.listEmbeddingFailures(10)).toHaveLength(0)
  })

  it('cascade delete via segments removes orphan failures', () => {
    seedSegment(repo, 's1')
    repo.recordEmbeddingFailure('s1', 1, 'x')
    repo.deleteMeeting('mtg1')
    expect(repo.listEmbeddingFailures(10)).toHaveLength(0)
  })

  it('countSegmentsNeedingEmbedding matches getSegmentsNeedingEmbedding length', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    seedSegment(repo, 's3', 'c', 3)
    repo.saveEmbeddings([{ segmentId: 's1', vector: new Float32Array([1]), model: 'm' }])
    repo.recordEmbeddingFailure('s2', 3, 'x')
    expect(repo.countSegmentsNeedingEmbedding()).toBe(1)
    expect(repo.getSegmentsNeedingEmbedding().map((p) => p.segmentId)).toEqual(['s3'])
  })
})

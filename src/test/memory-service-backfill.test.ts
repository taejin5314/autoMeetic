import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryService } from '../main/memory/memoryService'
import type { MemoryRepository } from '../main/memory/repository'

/** A worker stub that immediately responds with one zero-vector per text. */
function stubWorker() {
  const handlers = {
    message: [] as Array<(m: { id: number; vectors?: Float32Array[]; error?: string }) => void>,
    error: [] as Array<(e: Error) => void>,
  }
  return {
    postMessage: (msg: { id: number; texts: string[] }) => {
      setImmediate(() => {
        for (const h of handlers.message)
          h({ id: msg.id, vectors: msg.texts.map(() => new Float32Array([0.1, 0.2, 0.3])) })
      })
    },
    on: (evt: 'message' | 'error', handler: never) => {
      handlers[evt].push(handler)
    },
    terminate: () => Promise.resolve(0),
  }
}

/** A worker stub that NEVER responds — used to prove endMeeting doesn't block. */
function silentWorker() {
  return {
    postMessage: () => {},
    on: () => {},
    terminate: () => Promise.resolve(0),
  }
}

function repoOf(svc: MemoryService): MemoryRepository {
  return (svc as unknown as { repo: MemoryRepository }).repo
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)))
}

describe('MemoryService — startup backfill', () => {
  it('on initialize, every segment without an embedding gets enqueued and processed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')

    // First boot: seed segments via repo (bypass transcript hook)
    const s1 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    const meetingId = s1.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    const repo1 = repoOf(s1)
    for (let i = 0; i < 3; i++) {
      repo1.insertSegment({
        id: `seg${i}`,
        meetingId,
        seq: i + 1,
        createdAt: Date.now() + i,
        speakerId: null,
        speakerLabel: null,
        sourceText: `text ${i}`,
        translatedText: null,
        sourceLanguage: 'ko',
      })
    }
    expect(repo1.countSegmentsNeedingEmbedding()).toBe(3)

    // Second boot: same DB, fresh service. Backfill should run.
    const s2 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    await flushMicrotasks()
    await flushMicrotasks()
    expect(repoOf(s2).countSegmentsNeedingEmbedding()).toBe(0)
  })

  it('endMeeting returns within 500ms even with a worker that never responds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')
    const svc = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: silentWorker,
    })
    svc.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    const repo = repoOf(svc)
    const meetingId = (svc as unknown as { lifecycle: { getCurrentMeetingId: () => string } }).lifecycle.getCurrentMeetingId()
    repo.insertSegment({
      id: 'seg-x',
      meetingId,
      seq: 1,
      createdAt: Date.now(),
      speakerId: null,
      speakerLabel: null,
      sourceText: 'hi',
      translatedText: null,
      sourceLanguage: 'ko',
    })
    const start = Date.now()
    await svc.endMeeting()
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('a second initialize on a DB with leftover work picks it up via backfill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')
    const s1 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: silentWorker, // never embeds
    })
    const meetingId = s1.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    repoOf(s1).insertSegment({
      id: 'segA',
      meetingId,
      seq: 1,
      createdAt: Date.now(),
      speakerId: null,
      speakerLabel: null,
      sourceText: 'a',
      translatedText: null,
      sourceLanguage: 'ko',
    })
    expect(repoOf(s1).countSegmentsNeedingEmbedding()).toBe(1)
    // Simulate restart with a working worker
    const s2 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    await flushMicrotasks()
    await flushMicrotasks()
    expect(repoOf(s2).countSegmentsNeedingEmbedding()).toBe(0)
  })

  it('segments recorded in embedding_failures are NOT re-tried within the same boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')
    const svc = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    const meetingId = svc.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    const repo = repoOf(svc)
    repo.insertSegment({
      id: 'segF',
      meetingId,
      seq: 1,
      createdAt: Date.now(),
      speakerId: null,
      speakerLabel: null,
      sourceText: 'x',
      translatedText: null,
      sourceLanguage: 'ko',
    })
    repo.recordEmbeddingFailure('segF', 3, 'prior')
    // enqueueAllMissingEmbeddings is called by initialize; segF should be skipped.
    expect(repo.countSegmentsNeedingEmbedding()).toBe(0)
    expect(repo.getSegmentsNeedingEmbedding()).toHaveLength(0)
  })
})

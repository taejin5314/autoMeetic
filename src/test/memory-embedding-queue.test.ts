import { describe, expect, it } from 'vitest'
import { EmbeddingQueue } from '../main/memory/embeddingQueue'

function fakeEmbedder() {
  const calls: string[][] = []
  return {
    calls,
    embedPassages: async (texts: string[]) => {
      calls.push(texts)
      return texts.map((_, i) => new Float32Array([i]))
    },
  }
}

function fakeRepo() {
  const saved: { segmentId: string; vector: Float32Array; model: string }[] = []
  const failures: { segmentId: string; attempts: number; error: string }[] = []
  return {
    saved,
    failures,
    saveEmbeddings: (rows: typeof saved) => {
      saved.push(...rows)
    },
    recordEmbeddingFailure: (segmentId: string, attempts: number, error: string) => {
      failures.push({ segmentId, attempts, error })
    },
  }
}

describe('EmbeddingQueue', () => {
  it('batches enqueued items up to 16 per worker call', async () => {
    const e = fakeEmbedder()
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm1', batchSize: 16 })
    for (let i = 0; i < 20; i++) queue.enqueue({ segmentId: 's' + i, text: 't' + i })
    await queue.drain()
    expect(e.calls).toHaveLength(2)
    expect(e.calls[0]).toHaveLength(16)
    expect(e.calls[1]).toHaveLength(4)
    expect(r.saved).toHaveLength(20)
    expect(r.saved.every((row) => row.model === 'm1')).toBe(true)
  })

  it('processes items in FIFO order', async () => {
    const e = fakeEmbedder()
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 4 })
    for (let i = 0; i < 4; i++) queue.enqueue({ segmentId: 's' + i, text: 't' + i })
    await queue.drain()
    expect(r.saved.map((row) => row.segmentId)).toEqual(['s0', 's1', 's2', 's3'])
  })

  it('drainPending resolves when the named segments have been processed', async () => {
    const e = {
      embedPassages: async (texts: string[]) => {
        await new Promise((r) => setTimeout(r, 5))
        return texts.map(() => new Float32Array([0]))
      },
    }
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 2 })
    queue.enqueue({ segmentId: 's1', text: 't' })
    queue.enqueue({ segmentId: 's2', text: 't' })
    queue.enqueue({ segmentId: 's3', text: 't' })
    await queue.drainPending(['s1', 's2', 's3'], 1000)
    expect(r.saved.map((row) => row.segmentId).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('drainPending times out and resolves false if items never complete', async () => {
    const e = {
      embedPassages: () => new Promise<Float32Array[]>(() => {}),
    }
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 4 })
    queue.enqueue({ segmentId: 's', text: 't' })
    const ok = await queue.drainPending(['s'], 30)
    expect(ok).toBe(false)
  })

  it('retries a transient embedding batch failure instead of dropping items', async () => {
    let count = 0
    const e = {
      embedPassages: async (texts: string[]) => {
        count++
        if (count === 1) throw new Error('fail once')
        return texts.map(() => new Float32Array([1]))
      },
    }
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 2 })
    queue.enqueue({ segmentId: 's1', text: 't' })
    queue.enqueue({ segmentId: 's2', text: 't' })
    queue.enqueue({ segmentId: 's3', text: 't' })
    queue.enqueue({ segmentId: 's4', text: 't' })
    await queue.drain()
    expect(r.saved.map((row) => row.segmentId)).toEqual(['s1', 's2', 's3', 's4'])
  })
})

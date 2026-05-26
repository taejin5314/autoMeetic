import { describe, expect, it } from 'vitest'
import { EmbeddingQueue } from '../main/memory/embeddingQueue'

interface FakeRepo {
  saved: { segmentId: string; vector: Float32Array; model: string }[]
  failures: { segmentId: string; attempts: number; error: string }[]
  saveEmbeddings: (rows: FakeRepo['saved']) => void
  recordEmbeddingFailure: (segmentId: string, attempts: number, error: string) => void
}

function fakeRepo(): FakeRepo {
  const saved: FakeRepo['saved'] = []
  const failures: FakeRepo['failures'] = []
  return {
    saved,
    failures,
    saveEmbeddings: (rows) => saved.push(...rows),
    recordEmbeddingFailure: (segmentId, attempts, error) =>
      failures.push({ segmentId, attempts, error }),
  }
}

describe('EmbeddingQueue — permanent-failure persistence', () => {
  it('does NOT record a failure on transient (retryable) batch failure', async () => {
    let n = 0
    const embedder = {
      embedPassages: async (texts: string[]) => {
        n++
        if (n === 1) throw new Error('transient')
        return texts.map(() => new Float32Array([1]))
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 2,
      maxAttempts: 3,
    })
    q.enqueue({ segmentId: 's1', text: 't' })
    q.enqueue({ segmentId: 's2', text: 't' })
    await q.drain()
    expect(r.saved.map((s) => s.segmentId).sort()).toEqual(['s1', 's2'])
    expect(r.failures).toHaveLength(0)
  })

  it('records a failure ONCE per segment when attempts reach maxAttempts', async () => {
    const embedder = {
      embedPassages: async () => {
        throw new Error('always')
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 1,
      maxAttempts: 3,
    })
    q.enqueue({ segmentId: 's1', text: 't' })
    await q.drain()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].segmentId).toBe('s1')
    expect(r.failures[0].attempts).toBe(3)
    expect(r.failures[0].error).toBe('always')
    expect(r.saved).toHaveLength(0)
  })

  it('records distinct failures for each segment in a failing batch', async () => {
    const embedder = {
      embedPassages: async () => {
        throw new Error('batch boom')
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 4,
      maxAttempts: 2,
    })
    q.enqueue({ segmentId: 'a', text: 'x' })
    q.enqueue({ segmentId: 'b', text: 'x' })
    await q.drain()
    const ids = r.failures.map((f) => f.segmentId).sort()
    expect(ids).toEqual(['a', 'b'])
    for (const f of r.failures) {
      expect(f.attempts).toBe(2)
      expect(f.error).toBe('batch boom')
    }
  })

  it('does not persist a failure for a segment that ultimately succeeds via retry', async () => {
    let n = 0
    const embedder = {
      embedPassages: async (texts: string[]) => {
        n++
        if (n < 3) throw new Error('transient')
        return texts.map(() => new Float32Array([1]))
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 1,
      maxAttempts: 5,
    })
    q.enqueue({ segmentId: 's1', text: 't' })
    await q.drain()
    expect(r.saved.map((s) => s.segmentId)).toEqual(['s1'])
    expect(r.failures).toHaveLength(0)
  })
})

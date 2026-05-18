import { describe, expect, it } from 'vitest'
import { EmbeddingService, type EmbeddingWorkerLike } from '../main/memory/embeddingService'

function makeFakeWorker(): EmbeddingWorkerLike & {
  sent: { id: number; texts: string[] }[]
  reply: (id: number, vectors: Float32Array[]) => void
  fail: (id: number, error: string) => void
} {
  const listeners: ((msg: unknown) => void)[] = []
  const errorListeners: ((err: Error) => void)[] = []
  const sent: { id: number; texts: string[] }[] = []
  return {
    sent,
    postMessage(msg: { id: number; texts: string[] }) {
      sent.push(msg)
    },
    on(event: 'message' | 'error', handler: never) {
      if (event === 'message') listeners.push(handler)
      else errorListeners.push(handler)
    },
    terminate() {
      return Promise.resolve(0)
    },
    reply(id: number, vectors: Float32Array[]) {
      listeners.forEach((l) => l({ id, vectors }))
    },
    fail(id: number, error: string) {
      listeners.forEach((l) => l({ id, error }))
    },
  }
}

describe('EmbeddingService', () => {
  it('embedPassages prefixes texts with "passage: "', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const promise = svc.embedPassages(['hello', 'world'])
    expect(worker.sent[0].texts).toEqual(['passage: hello', 'passage: world'])
    worker.reply(worker.sent[0].id, [new Float32Array([1, 0]), new Float32Array([0, 1])])
    const result = await promise
    expect(result).toHaveLength(2)
    expect(Array.from(result[0])).toEqual([1, 0])
  })

  it('embedQuery prefixes with "query: "', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const promise = svc.embedQuery('foo')
    expect(worker.sent[0].texts).toEqual(['query: foo'])
    worker.reply(worker.sent[0].id, [new Float32Array([0.5])])
    const result = await promise
    expect(Array.from(result)).toEqual([0.5])
  })

  it('rejects when the worker replies with an error', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const promise = svc.embedQuery('x')
    worker.fail(worker.sent[0].id, 'boom')
    await expect(promise).rejects.toThrow('boom')
  })

  it('correlates concurrent requests by id', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const p1 = svc.embedQuery('a')
    const p2 = svc.embedQuery('b')
    expect(worker.sent).toHaveLength(2)
    worker.reply(worker.sent[1].id, [new Float32Array([2])])
    worker.reply(worker.sent[0].id, [new Float32Array([1])])
    expect(Array.from(await p1)).toEqual([1])
    expect(Array.from(await p2)).toEqual([2])
  })
})

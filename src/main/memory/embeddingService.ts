export interface EmbeddingWorkerLike {
  postMessage(msg: { id: number; texts: string[] }): void
  on(event: 'message', handler: (msg: { id: number; vectors?: Float32Array[]; error?: string }) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  terminate(): Promise<number> | number
}

const PASSAGE_PREFIX = 'passage: '
const QUERY_PREFIX = 'query: '

export class EmbeddingService {
  private nextId = 0
  private worker: EmbeddingWorkerLike
  private pending = new Map<
    number,
    { resolve: (vectors: Float32Array[]) => void; reject: (err: Error) => void }
  >()
  public readonly modelId = 'Xenova/multilingual-e5-small'

  constructor(worker: EmbeddingWorkerLike) {
    this.worker = worker
    this.worker.on('message', (msg: { id: number; vectors?: Float32Array[]; error?: string }) => {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error))
      else if (msg.vectors) pending.resolve(msg.vectors)
      else pending.reject(new Error('Embedding worker returned empty response'))
    })
    this.worker.on('error', (err: Error) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
  }

  embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embedRaw(texts.map((t) => PASSAGE_PREFIX + t))
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [v] = await this.embedRaw([QUERY_PREFIX + text])
    return v
  }

  private embedRaw(texts: string[]): Promise<Float32Array[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, texts })
    })
  }

  async dispose(): Promise<void> {
    await this.worker.terminate()
  }
}

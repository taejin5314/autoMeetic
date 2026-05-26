import type { EmbeddingService } from './embeddingService'
import type { MemoryRepository } from './repository'
import { log } from '../telemetry/logger'

interface QueueItem {
  segmentId: string
  text: string
  attempts?: number
}

interface QueueOptions {
  modelId: string
  batchSize?: number
  maxAttempts?: number
}

type RepoSurface = Pick<MemoryRepository, 'saveEmbeddings' | 'recordEmbeddingFailure'>

export class EmbeddingQueue {
  private items: QueueItem[] = []
  private processing: Promise<void> | null = null
  private scheduled = false
  private readonly batchSize: number
  private readonly maxAttempts: number
  private readonly completed = new Set<string>()
  private waiters: { segmentIds: Set<string>; resolve: () => void }[] = []
  private embedder: Pick<EmbeddingService, 'embedPassages'>
  private repo: RepoSurface
  private opts: QueueOptions

  constructor(
    embedder: Pick<EmbeddingService, 'embedPassages'>,
    repo: RepoSurface,
    opts: QueueOptions
  ) {
    this.embedder = embedder
    this.repo = repo
    this.opts = opts
    this.batchSize = opts.batchSize ?? 16
    this.maxAttempts = opts.maxAttempts ?? 3
  }

  enqueue(item: QueueItem): void {
    this.items.push(item)
    if (!this.scheduled) {
      this.scheduled = true
      queueMicrotask(() => {
        this.scheduled = false
        void this.kick()
      })
    }
  }

  size(): number {
    return this.items.length
  }

  async drain(): Promise<void> {
    while (this.items.length > 0 || this.processing || this.scheduled) {
      if (!this.processing) void this.kick()
      await this.processing
    }
  }

  async drainPending(segmentIds: string[], timeoutMs: number): Promise<boolean> {
    const pending = new Set(segmentIds.filter((id) => !this.completed.has(id)))
    if (pending.size === 0) return true
    if (!this.processing) void this.kick()
    return new Promise<boolean>((resolve) => {
      const waiter = { segmentIds: pending, resolve: () => resolve(true) }
      this.waiters.push(waiter)
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        resolve(false)
      }, timeoutMs)
      const origResolve = waiter.resolve
      waiter.resolve = () => {
        clearTimeout(t)
        origResolve()
      }
    })
  }

  private kick(): Promise<void> {
    if (this.processing) return this.processing
    this.processing = this.process().finally(() => {
      this.processing = null
    })
    return this.processing
  }

  private async process(): Promise<void> {
    while (this.items.length > 0) {
      const batch = this.items.splice(0, this.batchSize)
      const batchStart = Date.now()
      try {
        const vectors = await this.embedder.embedPassages(batch.map((item) => item.text))
        this.repo.saveEmbeddings(
          batch.map((item, i) => ({
            segmentId: item.segmentId,
            vector: vectors[i],
            model: this.opts.modelId,
          }))
        )
        for (const item of batch) this.completed.add(item.segmentId)
        log('info', 'memory-embedding', 'memory.embedding.batch.success', {
          batchSize: batch.length,
          durationMs: Date.now() - batchStart,
        })
        this.notifyWaiters()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[memory] embedding batch failed:', err)
        log('warn', 'memory-embedding', 'memory.embedding.batch.failure', {
          batchSize: batch.length,
          attempt: (batch[0]?.attempts ?? 0) + 1,
          error: message,
        })
        const retryable: QueueItem[] = []
        for (const item of batch) {
          const nextAttempts = (item.attempts ?? 0) + 1
          if (nextAttempts < this.maxAttempts) {
            retryable.push({ ...item, attempts: nextAttempts })
          } else {
            this.repo.recordEmbeddingFailure(item.segmentId, nextAttempts, message)
          }
        }
        if (retryable.length > 0) this.items.unshift(...retryable)
      }
    }
  }

  private notifyWaiters(): void {
    for (const waiter of [...this.waiters]) {
      const done = [...waiter.segmentIds].every((id) => this.completed.has(id))
      if (!done) continue
      this.waiters.splice(this.waiters.indexOf(waiter), 1)
      waiter.resolve()
    }
  }
}

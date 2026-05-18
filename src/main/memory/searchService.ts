import type { EmbeddingService } from './embeddingService'
import type { MemoryRepository } from './repository'
import type { SearchHit } from './types'

interface SearchOptions {
  threshold?: number
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i] * b[i]
  return sum
}

export class SearchService {
  private threshold: number

  constructor(
    private repo: MemoryRepository,
    private embedder: Pick<EmbeddingService, 'embedQuery'>,
    options: SearchOptions = {}
  ) {
    this.threshold = options.threshold ?? 0.5
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const all = this.repo.getAllEmbeddings()
    if (all.length === 0) return []
    const q = await this.embedder.embedQuery(query)
    const scored = all.map((row) => ({ segmentId: row.segmentId, score: dot(q, row.vector) }))
    scored.sort((a, b) => b.score - a.score)
    const top = scored.filter((s) => s.score >= this.threshold).slice(0, limit)
    return this.repo.lookupSearchHits(top)
  }
}

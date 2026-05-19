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
  private repo: MemoryRepository
  private embedder: Pick<EmbeddingService, 'embedQuery'>

  constructor(
    repo: MemoryRepository,
    embedder: Pick<EmbeddingService, 'embedQuery'>,
    options: SearchOptions = {}
  ) {
    this.repo = repo
    this.embedder = embedder
    this.threshold = options.threshold ?? 0.5
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const titleHits = this.repo.searchMeetingTitlesByText(trimmed, limit)
    let remaining = Math.max(0, limit - titleHits.length)

    const summaryHits = remaining > 0 ? this.repo.searchSummariesByText(trimmed, remaining) : []
    remaining = Math.max(0, remaining - summaryHits.length)

    const literal = remaining > 0 ? this.repo.searchByText(trimmed, remaining) : []
    const literalIds = new Set(literal.map((r) => r.segmentId))

    const all = this.repo.getAllEmbeddings().filter((row) => !literalIds.has(row.segmentId))
    let semantic: { segmentId: string; score: number }[] = []
    if (all.length > 0 && literal.length < remaining) {
      const q = await this.embedder.embedQuery(trimmed)
      semantic = all
        .map((row) => ({ segmentId: row.segmentId, score: dot(q, row.vector) }))
        .filter((s) => s.score >= this.threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, remaining - literal.length)
    }

    const segmentHits = this.repo.lookupSearchHits([...literal, ...semantic])
    console.log(
      `[memory] search query=${JSON.stringify(trimmed)} title=${titleHits.length} summary=${summaryHits.length} literal=${literal.length} semantic=${semantic.length}`
    )
    return [...titleHits, ...summaryHits, ...segmentHits]
  }
}

import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { EmbeddingQueue } from './embeddingQueue'
import { EmbeddingService } from './embeddingService'
import { attachTranscriptHook } from './transcriptHook'
import { exportMeetingMarkdown } from './markdownExporter'
import { MeetingLifecycle } from './meetingLifecycle'
import { MemoryRepository } from './repository'
import { SearchService } from './searchService'
import { SummaryService, type SummarizeCall } from './summaryService'
import type { MeetingDetail, MeetingSummary, MeetingUpdatedEvent, SearchHit } from './types'

interface MemoryServiceOptions {
  dbPath: string
  workerPath: string
  modelEnvCacheDir?: string
  summarize?: SummarizeCall
}

type Listener = (evt: MeetingUpdatedEvent) => void

export function defaultWorkerPath(): string {
  return path.join(__dirname, 'embeddingWorker.js')
}

export class MemoryService {
  private listeners = new Set<Listener>()
  private repo: MemoryRepository
  private lifecycle: MeetingLifecycle
  private embeddingService: EmbeddingService
  private embeddingQueue: EmbeddingQueue
  private summaryService: SummaryService
  private searchService: SearchService

  private constructor(
    repo: MemoryRepository,
    lifecycle: MeetingLifecycle,
    embeddingService: EmbeddingService,
    embeddingQueue: EmbeddingQueue,
    summaryService: SummaryService,
    searchService: SearchService
  ) {
    this.repo = repo
    this.lifecycle = lifecycle
    this.embeddingService = embeddingService
    this.embeddingQueue = embeddingQueue
    this.summaryService = summaryService
    this.searchService = searchService
  }

  static async initialize(opts: MemoryServiceOptions): Promise<MemoryService> {
    const repo = new MemoryRepository(opts.dbPath)
    const worker = new Worker(opts.workerPath, {
      env: {
        ...process.env,
        ...(opts.modelEnvCacheDir ? { MEMORY_EMBEDDING_CACHE_DIR: opts.modelEnvCacheDir } : {}),
      },
    })
    const embeddingService = new EmbeddingService(worker)
    const embeddingQueue = new EmbeddingQueue(embeddingService, repo, {
      modelId: embeddingService.modelId,
    })
    const lifecycle = new MeetingLifecycle(repo)
    const summarize =
      opts.summarize ??
      (async (args) => {
        const { summarizeMeeting } = await import('../proxyService')
        return summarizeMeeting(args)
      })
    const summaryService = new SummaryService(repo, summarize)
    const searchService = new SearchService(repo, embeddingService)
    const svc = new MemoryService(
      repo,
      lifecycle,
      embeddingService,
      embeddingQueue,
      summaryService,
      searchService
    )
    attachTranscriptHook(repo, embeddingQueue, () => lifecycle.getCurrentMeetingId())
    return svc
  }

  onMeetingUpdated(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  beginMeeting(args: { sourceLanguage: string; targetLanguage: string }): string {
    const meetingId = this.lifecycle.beginMeeting(args)
    this.emit({ meetingId, kind: 'began' })
    return meetingId
  }

  async endMeeting(timeoutMs = 3000): Promise<string | null> {
    const meetingId = this.lifecycle.endMeeting()
    if (!meetingId) return null
    this.emit({ meetingId, kind: 'ended' })
    const missing = this.repo.getMissingEmbeddings(meetingId)
    for (const row of missing) this.embeddingQueue.enqueue({ segmentId: row.segmentId, text: row.text })
    if (missing.length > 0)
      await this.embeddingQueue.drainPending(
        missing.map((m) => m.segmentId),
        timeoutMs
      )
    void this.summaryService
      .generateIfAutoEnabled(meetingId)
      .then(() => this.emitSummaryStatus(meetingId))
      .catch((err) => {
        console.warn('[memory] auto summary failed:', err)
        this.emit({ meetingId, kind: 'summary-failed' })
      })
    return meetingId
  }

  recoverInterruptedMeetings(): number {
    return this.lifecycle.recoverInterruptedMeetings()
  }

  listMeetings(limit = 30, offset = 0): MeetingSummary[] {
    return this.repo.listMeetings(limit, offset).map((meeting) => ({
      meeting,
      shortSummary: this.repo.getSummary(meeting.id)?.shortSummary ?? null,
    }))
  }

  getMeeting(id: string): MeetingDetail | null {
    const meeting = this.repo.getMeeting(id)
    if (!meeting) return null
    return {
      meeting,
      summary: this.repo.getSummary(id),
      segments: this.repo.getSegments(id),
    }
  }

  search(query: string, limit = 20): Promise<SearchHit[]> {
    return this.searchService.search(query, limit)
  }

  renameMeeting(id: string, title: string): void {
    this.repo.updateTitle(id, title)
    this.emit({ meetingId: id, kind: 'renamed' })
  }

  deleteMeeting(id: string): void {
    this.repo.deleteMeeting(id)
    this.emit({ meetingId: id, kind: 'deleted' })
  }

  exportMeeting(id: string, format: 'markdown'): string {
    if (format !== 'markdown') throw new Error('Unsupported export format')
    const md = exportMeetingMarkdown(this.repo, id)
    if (!md) throw new Error('Meeting not found')
    return md
  }

  async regenerateSummary(id: string): Promise<void> {
    await this.summaryService.generate(id)
    this.emitSummaryStatus(id)
  }

  async dispose(): Promise<void> {
    this.repo.close()
    await this.embeddingService.dispose()
  }

  private emit(evt: MeetingUpdatedEvent): void {
    for (const listener of this.listeners) listener(evt)
  }

  private emitSummaryStatus(meetingId: string): void {
    const summary = this.repo.getSummary(meetingId)
    this.emit({ meetingId, kind: summary?.status === 'failed' ? 'summary-failed' : 'summary-ready' })
  }
}

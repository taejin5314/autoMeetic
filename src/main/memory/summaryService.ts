import type { MemoryRepository } from './repository'
import {
  SUMMARY_PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildReduceUserPrompt,
  buildTranscriptUserPrompt,
} from './prompts/summary.v1'
import type { Segment, Summary, SummaryJSON } from './types'

const SHORT_MEETING_MS = 15 * 60 * 1000
const DEFAULT_MAX_INPUT_TOKENS = 200_000
const CHUNK_WINDOW_MS = 10 * 60 * 1000
const CHUNK_OVERLAP_MS = 30 * 1000

export type SummarizeCall = (args: { systemPrompt: string; userPrompt: string }) => Promise<string>

interface SummaryOptions {
  now?: () => number
  maxInputTokens?: number
  autoEnabled?: boolean
  model?: string
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function validateSummaryJson(raw: unknown): SummaryJSON {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')
  const obj = raw as Record<string, unknown>
  if (typeof obj.shortSummary !== 'string') throw new Error('shortSummary missing')
  if (typeof obj.detailedSummary !== 'string') throw new Error('detailedSummary missing')
  if (!Array.isArray(obj.keyPoints)) throw new Error('keyPoints missing')
  if (!Array.isArray(obj.actionItems)) throw new Error('actionItems missing')
  return {
    shortSummary: obj.shortSummary,
    detailedSummary: obj.detailedSummary,
    keyPoints: obj.keyPoints.filter((k): k is string => typeof k === 'string'),
    actionItems: obj.actionItems
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({
        text: typeof a.text === 'string' ? a.text : '',
        owner: typeof a.owner === 'string' ? a.owner : undefined,
        due: typeof a.due === 'string' ? a.due : undefined,
      }))
      .filter((a) => a.text.trim().length > 0),
  }
}

function failedSummary(meetingId: string, now: number, model: string, reason: string): Summary {
  return {
    meetingId,
    shortSummary: reason,
    detailedSummary: '',
    keyPoints: [],
    actionItems: [],
    generatedAt: now,
    model,
    promptVersion: SUMMARY_PROMPT_VERSION,
    status: 'failed',
  }
}

export function chunkByTime(segments: Segment[], windowMs: number, overlapMs: number): Segment[][] {
  if (segments.length === 0) return []
  const chunks: Segment[][] = []
  const first = segments[0].createdAt
  const last = segments[segments.length - 1].createdAt
  let cursor = first
  const step = windowMs - overlapMs
  if (step <= 0) throw new Error('windowMs must be greater than overlapMs')
  while (cursor <= last) {
    const end = cursor + windowMs
    const slice = segments.filter((s) => s.createdAt >= cursor && s.createdAt < end)
    if (slice.length > 0) chunks.push(slice)
    cursor += step
  }
  return chunks
}

export class SummaryService {
  private now: () => number
  private maxInputTokens: number
  private autoEnabled: boolean
  private model: string

  constructor(
    private repo: MemoryRepository,
    private call: SummarizeCall,
    opts: SummaryOptions = {}
  ) {
    this.now = opts.now ?? (() => Date.now())
    this.maxInputTokens = opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS
    this.autoEnabled = opts.autoEnabled ?? process.env.MEMORY_SUMMARY_AUTO !== 'false'
    this.model = opts.model ?? process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4o-mini'
  }

  async generateIfAutoEnabled(meetingId: string): Promise<void> {
    if (!this.autoEnabled) return
    await this.generate(meetingId)
  }

  async generate(meetingId: string): Promise<void> {
    const meeting = this.repo.getMeeting(meetingId)
    if (!meeting) return
    const segments = this.repo.getSegments(meetingId)
    if (segments.length === 0) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, 'Summary failed: no transcript.')
      )
      return
    }

    const userPrompt = buildTranscriptUserPrompt(meeting.startedAt, segments)
    if (estimateTokens(userPrompt) > this.maxInputTokens) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, 'Summary failed: meeting is too long.')
      )
      return
    }

    const duration = meeting.durationMs ?? 0
    if (duration > SHORT_MEETING_MS) {
      await this.generateMapReduce(meetingId, meeting.startedAt, segments)
      return
    }
    await this.generateSingleCall(meetingId, userPrompt)
  }

  private async generateSingleCall(meetingId: string, userPrompt: string): Promise<void> {
    const parsed = await this.tryParseCall(userPrompt)
    if (!parsed) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, 'Summary generation failed. Try again.')
      )
      return
    }
    this.saveOk(meetingId, parsed)
  }

  private async generateMapReduce(
    meetingId: string,
    meetingStartedAt: number,
    segments: Segment[]
  ): Promise<void> {
    const slices = chunkByTime(segments, CHUNK_WINDOW_MS, CHUNK_OVERLAP_MS)
    const chunkSummariesJson: string[] = []
    for (const slice of slices) {
      const parsed = await this.tryParseCall(buildTranscriptUserPrompt(meetingStartedAt, slice))
      if (!parsed) {
        this.repo.upsertSummary(
          failedSummary(meetingId, this.now(), this.model, 'Summary failed: chunk summary failed.')
        )
        return
      }
      chunkSummariesJson.push(JSON.stringify(parsed))
    }
    const parsed = await this.tryParseCall(buildReduceUserPrompt(chunkSummariesJson))
    if (!parsed) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, 'Summary failed: reduce step failed.')
      )
      return
    }
    this.saveOk(meetingId, parsed)
  }

  private async tryParseCall(userPrompt: string): Promise<SummaryJSON | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.call({ systemPrompt: SYSTEM_PROMPT, userPrompt })
        return validateSummaryJson(JSON.parse(raw))
      } catch (err) {
        console.warn('[summary] parse failed attempt', attempt, err)
      }
    }
    return null
  }

  private saveOk(meetingId: string, parsed: SummaryJSON): void {
    this.repo.upsertSummary({
      meetingId,
      ...parsed,
      generatedAt: this.now(),
      model: this.model,
      promptVersion: SUMMARY_PROMPT_VERSION,
      status: 'ok',
    })
  }
}

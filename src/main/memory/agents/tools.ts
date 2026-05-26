import type { MemoryService } from '../memoryService'
import type { Evidence } from './types'

export const TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_meetings',
      description:
        "Search the user's past meetings for relevant segments. Use SHORT broad queries (2-5 words) first; narrow only after a broad scan. Returns matched segments with meetingId, segmentId, snippet, and score.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_meeting_detail',
      description:
        'Fetch a meeting metadata + summary + a focused 40-segment window. Use ONLY after search reveals a meeting worth deep-reading. Each call costs ~3x a search call.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['meetingId'],
        properties: {
          meetingId: { type: 'string' },
          focusSegmentId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finalize_summary',
      description:
        'Call when you have enough evidence. Returns your compressed summary + structured evidence. After this call the subagent ends. Do NOT include raw transcripts - only summaries with short quotes (<=200 chars each).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'evidence'],
        properties: {
          summary: { type: 'string', maxLength: 2000 },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['meetingId', 'segmentId', 'quote'],
              properties: {
                meetingId: { type: 'string' },
                segmentId: { type: 'string' },
                quote: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
      },
    },
  },
] as const

export interface ToolDeps {
  memory: Pick<MemoryService, 'search' | 'getMeeting'>
}

export interface ToolResult {
  result: unknown
  countAs: 'search' | 'getDetail' | 'finalize'
}

export async function invokeTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps
): Promise<ToolResult> {
  switch (name) {
    case 'search_meetings': {
      const query = String(args.query ?? '')
      const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 20)
      const hits = await deps.memory.search(query, limit)
      return {
        countAs: 'search',
        result: hits.map((h) => ({
          meetingId: h.meetingId,
          segmentId: h.segmentId,
          meetingTitle: h.meetingTitle,
          snippet: h.sourceText.slice(0, 200),
          score: h.score,
          kind: h.kind,
        })),
      }
    }
    case 'get_meeting_detail': {
      const meetingId = String(args.meetingId ?? '')
      const detail = deps.memory.getMeeting(meetingId)
      if (!detail) return { countAs: 'getDetail', result: { error: 'meeting not found' } }
      const segments = detail.segments.slice(0, 40)
      return {
        countAs: 'getDetail',
        result: {
          title: detail.meeting.title,
          startedAt: detail.meeting.startedAt,
          shortSummary: detail.summary?.shortSummary ?? null,
          segments: segments.map((s) => ({
            id: s.id,
            seq: s.seq,
            speakerLabel: s.speakerLabel,
            sourceText: s.sourceText,
          })),
        },
      }
    }
    case 'finalize_summary': {
      return { countAs: 'finalize', result: args }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function isFinalizeCall(name: string): boolean {
  return name === 'finalize_summary'
}

export function parseFinalize(args: Record<string, unknown>): {
  summary: string
  evidence: Evidence[]
} {
  const summary = String(args.summary ?? '')
  const evidenceRaw = Array.isArray(args.evidence) ? args.evidence : []
  const evidence: Evidence[] = evidenceRaw
    .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object')
    .map((e) => ({
      meetingId: String(e.meetingId ?? ''),
      segmentId: String(e.segmentId ?? ''),
      quote: String(e.quote ?? '').slice(0, 200),
    }))
    .filter((e) => e.meetingId && e.segmentId)
  return { summary, evidence }
}

import type { ChatMessage } from '../../types'
import type { Plan, SubagentBrief, ToolName } from '../types'

const LEAD_SYSTEM_PROMPT = `You are the lead research agent for autoMeetic, a meeting-memory app.

A user has asked a question about their past meetings. Your job is to decide:
1. Is this trivial (one search will answer it)? Then emit a 1-subagent plan with a tight objective.
2. Is this multi-angle (comparison, trend, "what changed", multi-meeting synthesis)? Then decompose into 2-4 INDEPENDENT subagent briefs.

Scaling rules (hard):
- Simple fact-finding: 1 subagent, maxToolCalls 3-5
- Comparison or multi-angle: 2-4 subagents, maxToolCalls 5-10 each
- NEVER more than 4 subagents. If you need more, scope the question down to the 4 highest-leverage angles and note the trade-off in synthesisGuidance.

Each subagent brief MUST be self-contained: objective, outputFormat, toolsAllowed, boundaries. Subagents do NOT see each other - overlapping objectives waste tokens.

Tools available to subagents:
- search_meetings(query, limit): semantic + literal search across all past meetings
- get_meeting_detail(meetingId, focusSegmentId?): fetch full meeting metadata + 40-segment window (use sparingly, ~3x the cost of a search)

Output STRICT JSON matching the provided schema. No commentary, no markdown.`

export const PLAN_JSON_SCHEMA = {
  name: 'deep_ask_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reasoning', 'subagents', 'synthesisGuidance'],
    properties: {
      reasoning: { type: 'string' },
      synthesisGuidance: { type: 'string' },
      subagents: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['objective', 'outputFormat', 'toolsAllowed', 'boundaries'],
          properties: {
            objective: { type: 'string' },
            outputFormat: { type: 'string' },
            toolsAllowed: {
              type: 'array',
              items: { type: 'string', enum: ['search_meetings', 'get_meeting_detail'] },
            },
            boundaries: {
              type: 'object',
              additionalProperties: false,
              required: ['maxToolCalls'],
              properties: {
                maxToolCalls: { type: 'integer', minimum: 1, maximum: 10 },
                focusKeywords: { type: 'array', items: { type: 'string' } },
                meetingDateRange: {
                  type: 'array',
                  items: { type: 'integer' },
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          },
        },
      },
    },
  },
} as const

const HISTORY_LIMIT = 6

function stripCitations(text: string): string {
  return text.replace(/\[\^\d+\]/g, '').replace(/\s+/g, ' ').trim()
}

export function buildLeadMessages(args: {
  question: string
  history: ChatMessage[]
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: LEAD_SYSTEM_PROMPT },
    ...args.history.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripCitations(m.content) : m.content,
    })),
    { role: 'user', content: args.question },
  ]
}

interface RawSubagent {
  objective: string
  outputFormat: string
  toolsAllowed: ToolName[]
  boundaries: {
    maxToolCalls: number
    focusKeywords?: string[]
    meetingDateRange?: [number, number]
  }
}

interface RawPlan {
  reasoning: string
  subagents: RawSubagent[]
  synthesisGuidance: string
}

export function parsePlan(raw: string): Plan {
  const parsed = JSON.parse(raw) as RawPlan
  if (typeof parsed.reasoning !== 'string') throw new Error('Plan: missing reasoning')
  if (typeof parsed.synthesisGuidance !== 'string') throw new Error('Plan: missing synthesisGuidance')
  if (!Array.isArray(parsed.subagents) || parsed.subagents.length === 0) {
    throw new Error('Plan: subagents must be a non-empty array')
  }
  const subagents: SubagentBrief[] = parsed.subagents.slice(0, 4).map((s, idx) => ({
    idx,
    objective: s.objective,
    outputFormat: s.outputFormat,
    toolsAllowed: s.toolsAllowed,
    boundaries: {
      ...s.boundaries,
      maxToolCalls: Math.min(Math.max(1, s.boundaries.maxToolCalls), 10),
    },
  }))
  return {
    reasoning: parsed.reasoning,
    subagents,
    synthesisGuidance: parsed.synthesisGuidance,
  }
}

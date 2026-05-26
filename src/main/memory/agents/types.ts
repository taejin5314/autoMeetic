import type { ChatSource } from '../types'

export type ToolName = 'search_meetings' | 'get_meeting_detail'

export interface SubagentBrief {
  idx: number
  objective: string
  outputFormat: string
  toolsAllowed: ToolName[]
  boundaries: {
    maxToolCalls: number
    focusKeywords?: string[]
    meetingDateRange?: [number, number]
  }
}

export interface Plan {
  reasoning: string
  subagents: SubagentBrief[]
  synthesisGuidance: string
}

export interface Evidence {
  meetingId: string
  segmentId: string
  quote: string
}

export interface SubagentResult {
  idx: number
  status: 'ok' | 'failed' | 'capped'
  summary: string
  evidence: Evidence[]
  toolCallsUsed: number
  durationMs: number
  error?: string
  tokensIn: number
  tokensOut: number
}

export interface CostBreakdown {
  lead: { inputTokens: number; outputTokens: number; estimatedUsd: number }
  subagents: {
    totalInputTokens: number
    totalOutputTokens: number
    estimatedUsd: number
    perAgent: Array<{ idx: number; tokensIn: number; tokensOut: number; toolCalls: number }>
  }
  synthesizer: { inputTokens: number; outputTokens: number; estimatedUsd: number }
  toolCalls: { search: number; getDetail: number }
  total: { tokens: number; estimatedUsd: number }
}

export interface GateContext {
  question: string
  userId?: string
}

export interface GateResult {
  allowed: boolean
  reason?: string
}

export type DeepAskEvent =
  | { type: 'gate-denied'; reason: string }
  | { type: 'plan-created'; plan: Plan }
  | { type: 'subagent-started'; idx: number; brief: SubagentBrief }
  | { type: 'subagent-tool-call'; idx: number; toolName: ToolName | 'finalize_summary' }
  | {
      type: 'subagent-result'
      idx: number
      summary: string
      evidence: Evidence[]
      toolCallsUsed: number
      durationMs: number
    }
  | { type: 'subagent-failed'; idx: number; error: string }
  | { type: 'synthesizing'; sourceCount: number }
  | { type: 'delta'; content: string }
  | { type: 'done'; answer: string; sources: ChatSource[]; costBreakdown: CostBreakdown; durationMs: number }
  | { type: 'error'; message: string; phase: 'lead' | 'subagents' | 'synth' }

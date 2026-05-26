import { describe, expect, it } from 'vitest'
import {
  buildSynthesizerMessages,
  formatNumberedEvidence,
} from '../main/memory/agents/prompts/synthesizer.v1'
import type { Plan, SubagentResult } from '../main/memory/agents/types'

const r = (
  idx: number,
  summary: string,
  evidence: { meetingId: string; segmentId: string; quote: string }[]
): SubagentResult => ({
  idx,
  status: 'ok',
  summary,
  evidence,
  toolCallsUsed: 1,
  durationMs: 1,
  tokensIn: 0,
  tokensOut: 0,
})

const plan: Plan = {
  reasoning: 'multi-angle',
  synthesisGuidance: 'compare across quarters',
  subagents: [
    {
      idx: 0,
      objective: 'A',
      outputFormat: 'f',
      toolsAllowed: ['search_meetings'],
      boundaries: { maxToolCalls: 5 },
    },
    {
      idx: 1,
      objective: 'B',
      outputFormat: 'f',
      toolsAllowed: ['search_meetings'],
      boundaries: { maxToolCalls: 5 },
    },
  ],
}

describe('formatNumberedEvidence', () => {
  it('formats numbered evidence list', () => {
    const out = formatNumberedEvidence([
      { marker: 1, meetingId: 'm1', segmentId: 's1', quote: 'q1' },
      { marker: 2, meetingId: 'm2', segmentId: 's2', quote: 'q2' },
    ])
    expect(out).toContain('[^1]')
    expect(out).toContain('[^2]')
    expect(out).toContain('q1')
  })
})

describe('buildSynthesizerMessages', () => {
  it('includes question, reasoning, synthesis guidance, subagent summaries, and numbered evidence', () => {
    const msgs = buildSynthesizerMessages({
      question: 'How did OKRs change?',
      plan,
      results: [r(0, 'sum A', [{ meetingId: 'm1', segmentId: 's1', quote: 'q1' }])],
      numbered: [{ marker: 1, meetingId: 'm1', segmentId: 's1', quote: 'q1' }],
    })
    const text = msgs.map((m) => m.content).join('\n')
    expect(text).toContain('How did OKRs change?')
    expect(text).toContain('multi-angle')
    expect(text).toContain('compare across quarters')
    expect(text).toContain('sum A')
    expect(text).toContain('[^1]')
  })

  it('explicitly forbids inventing citation numbers', () => {
    const msgs = buildSynthesizerMessages({
      question: 'q',
      plan,
      results: [],
      numbered: [],
    })
    const sys = msgs.find((m) => m.role === 'system')?.content ?? ''
    expect(sys.toLowerCase()).toContain('do not invent')
  })

  it('notes partial coverage when some subagents failed', () => {
    const failed: SubagentResult = {
      idx: 0,
      status: 'failed',
      summary: 'agent failed',
      evidence: [],
      toolCallsUsed: 0,
      durationMs: 1,
      tokensIn: 0,
      tokensOut: 0,
      error: 'timeout',
    }
    const ok = r(1, 'sum', [{ meetingId: 'm', segmentId: 's', quote: 'q' }])
    const msgs = buildSynthesizerMessages({
      question: 'q',
      plan,
      results: [failed, ok],
      numbered: [{ marker: 1, meetingId: 'm', segmentId: 's', quote: 'q' }],
    })
    const text = msgs.map((m) => m.content).join('\n')
    expect(text.toLowerCase()).toContain('partial')
  })
})

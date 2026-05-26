import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkDeepAskGate } from '../main/memory/agents/gate'
import { callLeadAgent } from '../main/memory/agents/leadAgent'
import { runSubagent } from '../main/memory/agents/subagent'
import { runSynthesizer } from '../main/memory/agents/synthesizer'
import type { Plan, SubagentResult } from '../main/memory/agents/types'
import { runDeepAsk } from '../main/memory/deepAskService'

vi.mock('../main/memory/agents/gate', () => ({ checkDeepAskGate: vi.fn() }))
vi.mock('../main/memory/agents/leadAgent', () => ({ callLeadAgent: vi.fn() }))
vi.mock('../main/memory/agents/subagent', () => ({ runSubagent: vi.fn() }))
vi.mock('../main/memory/agents/synthesizer', () => ({ runSynthesizer: vi.fn() }))

const plan: Plan = {
  reasoning: 'compare two angles',
  synthesisGuidance: 'be concise',
  subagents: [
    {
      idx: 0,
      objective: 'angle A',
      outputFormat: 'summary',
      toolsAllowed: ['search_meetings'],
      boundaries: { maxToolCalls: 3 },
    },
    {
      idx: 1,
      objective: 'angle B',
      outputFormat: 'summary',
      toolsAllowed: ['search_meetings'],
      boundaries: { maxToolCalls: 3 },
    },
  ],
}

const result = (idx: number, segmentId: string, status: SubagentResult['status'] = 'ok'): SubagentResult => ({
  idx,
  status,
  summary: status === 'failed' ? `failed ${idx}` : `summary ${idx}`,
  evidence:
    status === 'failed'
      ? []
      : [{ meetingId: 'm1', segmentId, quote: `quote ${segmentId}` }],
  toolCallsUsed: status === 'failed' ? 0 : 2,
  durationMs: 10,
  error: status === 'failed' ? 'timeout' : undefined,
  tokensIn: 100,
  tokensOut: 50,
})

const memory = {
  search: vi.fn(),
  activeGlossary: vi.fn(() => []),
  getMeeting: vi.fn(() => ({
    meeting: {
      id: 'm1',
      title: 'Roadmap',
      startedAt: 1000,
      endedAt: 2000,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      status: 'completed' as const,
      segmentCount: 2,
      durationMs: 1000,
    },
    summary: null,
    segments: [
      {
        id: 's1',
        meetingId: 'm1',
        seq: 0,
        createdAt: 1500,
        speakerId: null,
        speakerLabel: null,
        sourceText: 'quote s1',
        translatedText: null,
        sourceLanguage: 'en',
      },
      {
        id: 's2',
        meetingId: 'm1',
        seq: 1,
        createdAt: 1700,
        speakerId: null,
        speakerLabel: null,
        sourceText: 'quote s2',
        translatedText: null,
        sourceLanguage: 'en',
      },
    ],
  })),
}

describe('runDeepAsk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkDeepAskGate).mockResolvedValue({ allowed: true })
    vi.mocked(callLeadAgent).mockResolvedValue({ plan, inputTokens: 10, outputTokens: 20 })
    vi.mocked(runSubagent).mockImplementation(async (brief) => result(brief.idx, brief.idx === 0 ? 's1' : 's2'))
    vi.mocked(runSynthesizer).mockImplementation(async (args) => {
      args.sendEvent({ type: 'delta', content: 'final' })
      return { answer: 'final answer', inputTokens: 30, outputTokens: 40 }
    })
  })

  it('runs happy path and emits done with sources + costBreakdown', async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = []
    await runDeepAsk(
      { question: 'How did OKRs change?', history: [] },
      (event) => events.push(event),
      { memory: memory as never }
    )
    expect(events.map((e) => e.type)).toContain('plan-created')
    const done = events.find((e) => e.type === 'done')
    expect(done?.sources).toHaveLength(2)
    expect(done?.costBreakdown).toMatchObject({ total: { tokens: 400 } })
  })

  it('continues synthesis with partial coverage when one subagent fails', async () => {
    vi.mocked(runSubagent).mockImplementation(async (brief) =>
      brief.idx === 0 ? result(0, 's1', 'failed') : result(1, 's2')
    )
    const events: Array<{ type: string; [key: string]: unknown }> = []
    await runDeepAsk({ question: 'q', history: [] }, (event) => events.push(event), {
      memory: memory as never,
    })
    expect(runSynthesizer).toHaveBeenCalled()
    expect(events.find((e) => e.type === 'done')?.sources).toHaveLength(1)
  })

  it('still synthesizes when all subagents fail', async () => {
    vi.mocked(runSubagent).mockImplementation(async (brief) => result(brief.idx, 'none', 'failed'))
    const events: Array<{ type: string; [key: string]: unknown }> = []
    await runDeepAsk({ question: 'q', history: [] }, (event) => events.push(event), {
      memory: memory as never,
    })
    expect(runSynthesizer).toHaveBeenCalled()
    expect(events.find((e) => e.type === 'done')?.sources).toHaveLength(0)
  })

  it('emits gate-denied and does not call lead when gate denies', async () => {
    vi.mocked(checkDeepAskGate).mockResolvedValue({ allowed: false, reason: 'nope' })
    const events: Array<{ type: string; [key: string]: unknown }> = []
    await runDeepAsk({ question: 'q', history: [] }, (event) => events.push(event), {
      memory: memory as never,
    })
    expect(callLeadAgent).not.toHaveBeenCalled()
    expect(events).toEqual([{ type: 'gate-denied', reason: 'nope' }])
  })

  it('emits lead phase error when lead fails', async () => {
    vi.mocked(callLeadAgent).mockRejectedValue(new Error('bad json'))
    const events: Array<{ type: string; [key: string]: unknown }> = []
    await runDeepAsk({ question: 'q', history: [] }, (event) => events.push(event), {
      memory: memory as never,
    })
    expect(events).toContainEqual({ type: 'error', message: 'bad json', phase: 'lead' })
    expect(runSubagent).not.toHaveBeenCalled()
  })
})

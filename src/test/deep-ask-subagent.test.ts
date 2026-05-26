import { describe, expect, it, vi } from 'vitest'
import { runSubagent } from '../main/memory/agents/subagent'
import type { SubagentBrief } from '../main/memory/agents/types'

const baseBrief = (over: Partial<SubagentBrief> = {}): SubagentBrief => ({
  idx: 0,
  objective: 'find foo',
  outputFormat: 'summary',
  toolsAllowed: ['search_meetings'],
  boundaries: { maxToolCalls: 3 },
  ...over,
})

function fakeOpenAI(steps: Array<{ tool_calls?: Array<{ name: string; arguments: string }>; content?: string }>) {
  let idx = 0
  return vi.fn(async () => {
    const step = steps[idx++]
    if (!step) throw new Error('No more steps in fake OpenAI')
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: step.content ?? null,
              tool_calls: step.tool_calls?.map((t, i) => ({
                id: `c${idx}_${i}`,
                type: 'function',
                function: { name: t.name, arguments: t.arguments },
              })),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as never
  })
}

const fakeMemory = {
  search: async () => [
    {
      meetingId: 'm1',
      segmentId: 's1',
      meetingTitle: 'M',
      sourceText: 'foo bar',
      score: 1,
      kind: 'segment' as const,
      createdAt: 0,
      startedAt: 0,
      seq: 0,
      speakerLabel: null,
      translatedText: null,
    },
  ],
  getMeeting: () => null,
}

describe('runSubagent', () => {
  it('completes after one search + finalize', async () => {
    const fetchFn = fakeOpenAI([
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"foo"}' }] },
      {
        tool_calls: [
          {
            name: 'finalize_summary',
            arguments: JSON.stringify({
              summary: 'all done',
              evidence: [{ meetingId: 'm1', segmentId: 's1', quote: 'foo bar' }],
            }),
          },
        ],
      },
    ])
    const events: unknown[] = []
    const result = await runSubagent(
      baseBrief(),
      { memory: fakeMemory as never, fetchFn },
      (e) => events.push(e)
    )
    expect(result.status).toBe('ok')
    expect(result.summary).toBe('all done')
    expect(result.evidence).toHaveLength(1)
    expect(result.toolCallsUsed).toBe(1)
  })

  it('forces finalize when tool-call cap reached', async () => {
    const fetchFn = fakeOpenAI([
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"a"}' }] },
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"b"}' }] },
      {
        tool_calls: [
          {
            name: 'finalize_summary',
            arguments: JSON.stringify({ summary: 'capped', evidence: [] }),
          },
        ],
      },
    ])
    const result = await runSubagent(
      baseBrief({ boundaries: { maxToolCalls: 2 } }),
      { memory: fakeMemory as never, fetchFn },
      () => {}
    )
    expect(result.status).toBe('capped')
    expect(result.toolCallsUsed).toBe(2)
    expect(result.summary).toBe('capped')
  })

  it('returns failed when LLM never calls finalize and never makes a tool call', async () => {
    const fetchFn = fakeOpenAI([{ content: 'wandering off' }])
    const result = await runSubagent(
      baseBrief(),
      { memory: fakeMemory as never, fetchFn },
      () => {}
    )
    expect(result.status).toBe('failed')
  })

  it('emits subagent-started + subagent-tool-call + subagent-result events', async () => {
    const fetchFn = fakeOpenAI([
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"x"}' }] },
      {
        tool_calls: [
          {
            name: 'finalize_summary',
            arguments: JSON.stringify({ summary: 'done', evidence: [] }),
          },
        ],
      },
    ])
    const types: string[] = []
    await runSubagent(
      baseBrief(),
      { memory: fakeMemory as never, fetchFn },
      (e) => types.push((e as { type: string }).type)
    )
    expect(types[0]).toBe('subagent-started')
    expect(types).toContain('subagent-tool-call')
    expect(types.at(-1)).toBe('subagent-result')
  })
})

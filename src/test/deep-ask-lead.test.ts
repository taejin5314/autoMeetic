import { describe, expect, it } from 'vitest'
import {
  PLAN_JSON_SCHEMA,
  buildLeadMessages,
  parsePlan,
} from '../main/memory/agents/prompts/lead.v1'

describe('buildLeadMessages', () => {
  it('includes question and last-N history with citations stripped', () => {
    const msgs = buildLeadMessages({
      question: 'How did OKRs change between Q3 and Q4?',
      history: [
        { id: 'u1', role: 'user', content: 'previous', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'a [^1] then b [^2]', createdAt: 2 },
      ],
    })
    expect(msgs[0].role).toBe('system')
    expect(msgs.at(-1)!.content).toContain('How did OKRs change')
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('a then b')
  })

  it('clamps history to last 6 messages', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `msg ${i}`,
      createdAt: i,
    }))
    const msgs = buildLeadMessages({ question: 'q', history })
    expect(msgs).toHaveLength(8)
  })
})

describe('PLAN_JSON_SCHEMA', () => {
  it('has required top-level fields', () => {
    expect(PLAN_JSON_SCHEMA.schema.required).toContain('reasoning')
    expect(PLAN_JSON_SCHEMA.schema.required).toContain('subagents')
    expect(PLAN_JSON_SCHEMA.schema.required).toContain('synthesisGuidance')
  })

  it('caps subagents array at 4 items', () => {
    expect(PLAN_JSON_SCHEMA.schema.properties.subagents.maxItems).toBe(4)
  })
})

describe('parsePlan', () => {
  it('parses a valid plan and indexes subagents 0..N-1', () => {
    const raw = JSON.stringify({
      reasoning: 'multi-angle',
      subagents: [
        {
          objective: 'A',
          outputFormat: 'summary',
          toolsAllowed: ['search_meetings'],
          boundaries: { maxToolCalls: 10 },
        },
        {
          objective: 'B',
          outputFormat: 'summary',
          toolsAllowed: ['search_meetings', 'get_meeting_detail'],
          boundaries: { maxToolCalls: 8 },
        },
      ],
      synthesisGuidance: 'compare',
    })
    const plan = parsePlan(raw)
    expect(plan.subagents).toHaveLength(2)
    expect(plan.subagents[0].idx).toBe(0)
    expect(plan.subagents[1].idx).toBe(1)
  })

  it('truncates >4 subagents to first 4', () => {
    const raw = JSON.stringify({
      reasoning: 'r',
      synthesisGuidance: 'g',
      subagents: Array.from({ length: 7 }, () => ({
        objective: 'o',
        outputFormat: 'f',
        toolsAllowed: ['search_meetings'],
        boundaries: { maxToolCalls: 10 },
      })),
    })
    const plan = parsePlan(raw)
    expect(plan.subagents).toHaveLength(4)
  })

  it('clamps maxToolCalls to 10', () => {
    const raw = JSON.stringify({
      reasoning: 'r',
      synthesisGuidance: 'g',
      subagents: [
        {
          objective: 'o',
          outputFormat: 'f',
          toolsAllowed: ['search_meetings'],
          boundaries: { maxToolCalls: 50 },
        },
      ],
    })
    const plan = parsePlan(raw)
    expect(plan.subagents[0].boundaries.maxToolCalls).toBe(10)
  })

  it('throws on malformed JSON', () => {
    expect(() => parsePlan('not json')).toThrow()
  })

  it('throws on missing required fields', () => {
    expect(() => parsePlan('{"reasoning":"x"}')).toThrow()
  })
})

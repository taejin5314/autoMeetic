import { describe, expect, it } from 'vitest'
import { mergeCitations } from '../main/memory/agents/citationMerger'
import type { SubagentResult } from '../main/memory/agents/types'

const r = (
  idx: number,
  evidence: { meetingId: string; segmentId: string; quote: string }[]
): SubagentResult => ({
  idx,
  status: 'ok',
  summary: 's',
  evidence,
  toolCallsUsed: 1,
  durationMs: 100,
  tokensIn: 0,
  tokensOut: 0,
})

describe('mergeCitations', () => {
  it('assigns 1-based numbers in order of first appearance', () => {
    const out = mergeCitations([
      r(0, [
        { meetingId: 'm1', segmentId: 's1', quote: 'q1' },
        { meetingId: 'm1', segmentId: 's2', quote: 'q2' },
      ]),
      r(1, [{ meetingId: 'm2', segmentId: 's3', quote: 'q3' }]),
    ])
    expect(out.numbered.map((c) => c.marker)).toEqual([1, 2, 3])
    expect(out.numbered[0].segmentId).toBe('s1')
    expect(out.numbered[2].segmentId).toBe('s3')
  })

  it('dedupes by segmentId (later occurrences merged into first marker)', () => {
    const out = mergeCitations([
      r(0, [{ meetingId: 'm1', segmentId: 's1', quote: 'q1' }]),
      r(1, [{ meetingId: 'm1', segmentId: 's1', quote: 'q1 again' }]),
    ])
    expect(out.numbered).toHaveLength(1)
    expect(out.numbered[0].marker).toBe(1)
  })

  it('returns empty when no evidence', () => {
    const out = mergeCitations([r(0, []), r(1, [])])
    expect(out.numbered).toEqual([])
  })

  it('handles a mix of failed and ok subagents', () => {
    const failed: SubagentResult = {
      idx: 0,
      status: 'failed',
      summary: 'failed',
      evidence: [],
      toolCallsUsed: 0,
      durationMs: 10,
      tokensIn: 0,
      tokensOut: 0,
      error: 'x',
    }
    const out = mergeCitations([failed, r(1, [{ meetingId: 'm', segmentId: 's', quote: 'q' }])])
    expect(out.numbered).toHaveLength(1)
  })

  it('returns an indexable subagentToMarkers map for synthesizer formatting', () => {
    const out = mergeCitations([
      r(0, [
        { meetingId: 'm', segmentId: 'a', quote: 'qa' },
        { meetingId: 'm', segmentId: 'b', quote: 'qb' },
      ]),
      r(1, [{ meetingId: 'm', segmentId: 'c', quote: 'qc' }]),
    ])
    expect(out.subagentToMarkers[0]).toEqual([1, 2])
    expect(out.subagentToMarkers[1]).toEqual([3])
  })
})

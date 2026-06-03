import { describe, expect, it, vi } from 'vitest'
import { createCoachService } from '../main/coach/coachService'
import type { CoachEvent } from '../main/coach/types'
import type { FinalizedTurn } from '../main/pipeline/types'
import type { MeetingCluster } from '../main/memory/types'

function turn(text: string, id = 'turn_1'): FinalizedTurn {
  return {
    id,
    text,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    createdAtMs: 1,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
  }
}

function cluster(id: string): MeetingCluster {
  return {
    id,
    title: `Cluster ${id}`,
    summary: `Summary for ${id}`.repeat(20),
    centroid: new Float32Array([1, 0]),
    memberCount: 2,
    createdAt: 1,
    updatedAt: 2,
  }
}

function setup(options: {
  now?: () => number
  nearest?: { cluster: MeetingCluster; similarity: number } | null
  currentClusterId?: string | null
} = {}) {
  const events: CoachEvent[] = []
  const embedQuery = vi.fn(async () => new Float32Array([1, 0]))
  const repo = {
    findNearestClusterToCentroid: vi.fn(() => options.nearest ?? { cluster: cluster('c1'), similarity: 0.9 }),
  }
  const service = createCoachService({
    repo,
    embedder: { embedQuery },
    currentMeetingClusterId: () => options.currentClusterId ?? null,
    emit: (event) => events.push(event),
    now: options.now ?? (() => 1000),
  })
  return { service, events, embedQuery, repo }
}

describe('coachService', () => {
  it('past-context regex filters out turns without a past-reference keyword', async () => {
    const { service, events, embedQuery } = setup()

    await service.onTurnFinalized(turn('we should discuss the roadmap'))

    expect(events).toEqual([])
    expect(embedQuery).not.toHaveBeenCalled()
  })

  it('emits past-context only for a matching cluster above threshold that is not current meeting cluster', async () => {
    const { service, events, embedQuery, repo } = setup({
      nearest: { cluster: cluster('past_cluster'), similarity: 0.7 },
    })

    await service.onTurnFinalized(turn('last time we discussed onboarding'))

    expect(embedQuery).toHaveBeenCalledWith('last time we discussed onboarding')
    expect(repo.findNearestClusterToCentroid).toHaveBeenCalledWith(expect.any(Float32Array), 0.6)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'past-context',
        clusterId: 'past_cluster',
        clusterTitle: 'Cluster past_cluster',
        turnId: 'turn_1',
        emittedAtMs: 1000,
      }),
    ])
    expect(events[0].type === 'past-context' ? events[0].snippet.length : 0).toBeLessThanOrEqual(200)
  })

  it('does not emit past-context for the current meeting cluster', async () => {
    const { service, events } = setup({
      nearest: { cluster: cluster('current_cluster'), similarity: 0.9 },
      currentClusterId: 'current_cluster',
    })

    await service.onTurnFinalized(turn('previously we agreed on this'))

    expect(events).toEqual([])
  })

  it('rate limits past-context to one per minute', async () => {
    let now = 1000
    const { service, events, repo } = setup({ now: () => now })
    repo.findNearestClusterToCentroid
      .mockReturnValueOnce({ cluster: cluster('c1'), similarity: 0.9 })
      .mockReturnValueOnce({ cluster: cluster('c2'), similarity: 0.9 })
      .mockReturnValueOnce({ cluster: cluster('c3'), similarity: 0.9 })

    await service.onTurnFinalized(turn('last time we discussed A', 't1'))
    now += 30_000
    await service.onTurnFinalized(turn('last time we discussed B', 't2'))
    now += 61_000
    await service.onTurnFinalized(turn('last time we discussed C', 't3'))

    expect(events.map((event) => event.turnId)).toEqual(['t1', 't3'])
  })

  it('dedupes the same past-context cluster for five minutes', async () => {
    let now = 1000
    const { service, events } = setup({ now: () => now })

    await service.onTurnFinalized(turn('last time we discussed A', 't1'))
    now += 61_000
    await service.onTurnFinalized(turn('last time we discussed B', 't2'))
    now += 5 * 60_000
    await service.onTurnFinalized(turn('last time we discussed C', 't3'))

    expect(events.map((event) => event.turnId)).toEqual(['t1', 't3'])
  })

  it('dedupes glossary mismatch by canonical term for one minute', () => {
    let now = 1000
    const { service, events } = setup({ now: () => now })

    service.onGlossaryNormalize({
      type: 'glossary-normalize-applied',
      id: 't1',
      pairs: [{ variant: 'real time orchestrator', canonical: 'RealtimeOrchestrator' }],
    })
    now += 30_000
    service.onGlossaryNormalize({
      type: 'glossary-normalize-applied',
      id: 't2',
      pairs: [{ variant: 'realtime orchestrator', canonical: 'RealtimeOrchestrator' }],
    })
    now += 61_000
    service.onGlossaryNormalize({
      type: 'glossary-normalize-applied',
      id: 't3',
      pairs: [{ variant: 'realtime orchestrator', canonical: 'RealtimeOrchestrator' }],
    })

    expect(events.map((event) => event.turnId)).toEqual(['t1', 't3'])
  })

  it('caps total coach cards at five per minute across event types', () => {
    const { service, events } = setup()

    for (let i = 0; i < 6; i += 1) {
      service.onGlossaryNormalize({
        type: 'glossary-normalize-applied',
        id: `t${i}`,
        pairs: [{ variant: `variant ${i}`, canonical: `Canonical ${i}` }],
      })
    }

    expect(events).toHaveLength(5)
  })

  it('meeting-ended clears rate-limit and dedup state', async () => {
    const { service, events } = setup()

    await service.onTurnFinalized(turn('last time we discussed A', 't1'))
    service.onGlossaryNormalize({
      type: 'glossary-normalize-applied',
      id: 't2',
      pairs: [{ variant: 'variant', canonical: 'Canonical' }],
    })
    service.onMeetingEnded()
    await service.onTurnFinalized(turn('last time we discussed B', 't3'))
    service.onGlossaryNormalize({
      type: 'glossary-normalize-applied',
      id: 't4',
      pairs: [{ variant: 'variant', canonical: 'Canonical' }],
    })

    expect(events.map((event) => event.turnId)).toEqual(['t1', 't2', 't3', 't4'])
  })
})

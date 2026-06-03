import { describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { MemoryTreeBuilder, type ClusterSummaryCall } from '../main/memory/memoryTreeBuilder'
import type { Meeting, Segment, Summary } from '../main/memory/types'

function meeting(id: string, title: string, startedAt: number): Meeting {
  return {
    id,
    title,
    startedAt,
    endedAt: startedAt + 1000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 1000,
  }
}

function summary(meetingId: string, shortSummary: string): Summary {
  return {
    meetingId,
    shortSummary,
    detailedSummary: shortSummary,
    keyPoints: [],
    actionItems: [],
    generatedAt: 1000,
    model: 'gpt-4o-mini',
    promptVersion: 'v1',
    status: 'ok',
  }
}

function segment(meetingId: string, id: string, seq: number): Segment {
  return {
    id,
    meetingId,
    seq,
    createdAt: seq,
    speakerId: null,
    speakerLabel: null,
    sourceText: `segment ${id}`,
    translatedText: null,
    sourceLanguage: 'en',
  }
}

function addMeeting(
  repo: MemoryRepository,
  id: string,
  vectors: Float32Array[],
  title = `Title ${id}`,
  shortSummary = `Summary ${id}`
): void {
  repo.insertMeeting(meeting(id, title, vectors.length))
  repo.upsertSummary(summary(id, shortSummary))
  vectors.forEach((vector, index) => {
    const seg = segment(id, `${id}_seg_${index}`, index)
    repo.insertSegment(seg)
    repo.saveEmbedding(seg.id, vector, 'text-embedding-3-small')
  })
}

function makeSummaryCall(): ClusterSummaryCall {
  return vi.fn(async () => 'Cluster Title\n\nCluster summary sentence one. Cluster summary sentence two.')
}

describe('MemoryTreeBuilder', () => {
  it('creates a new singleton cluster for a meeting when no clusters exist', async () => {
    const repo = new MemoryRepository(':memory:')
    addMeeting(repo, 'mtg_a', [new Float32Array([1, 0])], 'Roadmap', 'Roadmap decisions')
    const summarizeCluster = makeSummaryCall()
    const builder = new MemoryTreeBuilder({ repo, summarizeCluster, now: () => 1234 })

    await builder.rebuildForMeeting('mtg_a')

    const cluster = repo.getClusterByMeeting('mtg_a')
    expect(cluster).toMatchObject({
      title: 'Cluster Title',
      summary: 'Cluster summary sentence one. Cluster summary sentence two.',
      memberCount: 1,
      createdAt: 1234,
      updatedAt: 1234,
    })
    expect(summarizeCluster).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        userPrompt: expect.stringContaining('Roadmap'),
      })
    )
    repo.close()
  })

  it('adds a meeting to an existing cluster above threshold and regenerates the cluster summary', async () => {
    const repo = new MemoryRepository(':memory:')
    addMeeting(repo, 'mtg_a', [new Float32Array([1, 0])], 'Alpha', 'Alpha summary')
    addMeeting(repo, 'mtg_b', [new Float32Array([0.9, 0.1])], 'Beta', 'Beta summary')
    repo.insertCluster({
      id: 'cluster_a',
      title: 'Old title',
      summary: 'Old summary',
      centroid: new Float32Array([1, 0]),
      memberCount: 0,
      createdAt: 100,
    })
    repo.addClusterMember('cluster_a', 'mtg_a')
    const summarizeCluster = makeSummaryCall()
    const builder = new MemoryTreeBuilder({ repo, summarizeCluster, now: () => 2000 })

    await builder.rebuildForMeeting('mtg_b')

    const cluster = repo.getClusterByMeeting('mtg_b')
    expect(cluster?.id).toBe('cluster_a')
    expect(cluster?.memberCount).toBe(2)
    expect(cluster?.title).toBe('Cluster Title')
    expect(Array.from(cluster?.centroid ?? [])).toEqual([Math.fround(0.95), Math.fround(0.05)])
    expect(summarizeCluster).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        userPrompt: expect.stringContaining('Alpha'),
      })
    )
    expect(summarizeCluster).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Beta summary'),
      })
    )
    repo.close()
  })

  it('creates a new cluster when all existing clusters are below threshold', async () => {
    const repo = new MemoryRepository(':memory:')
    addMeeting(repo, 'mtg_a', [new Float32Array([1, 0])])
    addMeeting(repo, 'mtg_b', [new Float32Array([0, 1])])
    repo.insertCluster({
      id: 'cluster_a',
      title: 'Alpha',
      summary: 'Alpha summary',
      centroid: new Float32Array([1, 0]),
      memberCount: 0,
      createdAt: 100,
    })
    repo.addClusterMember('cluster_a', 'mtg_a')
    const builder = new MemoryTreeBuilder({
      repo,
      summarizeCluster: makeSummaryCall(),
      threshold: 0.6,
      now: () => 3000,
    })

    await builder.rebuildForMeeting('mtg_b')

    expect(repo.getClusterByMeeting('mtg_b')?.id).not.toBe('cluster_a')
    expect(repo.listClusters()).toHaveLength(2)
    repo.close()
  })

  it('skips a meeting with no segment embeddings and logs the no-op', async () => {
    const repo = new MemoryRepository(':memory:')
    repo.insertMeeting(meeting('mtg_no_embeddings', 'No embeddings', 1))
    repo.insertSegment(segment('mtg_no_embeddings', 'seg_1', 0))
    const summarizeCluster = makeSummaryCall()
    const log = vi.fn()
    const builder = new MemoryTreeBuilder({ repo, summarizeCluster, log })

    await builder.rebuildForMeeting('mtg_no_embeddings')

    expect(repo.listClusters()).toEqual([])
    expect(summarizeCluster).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('warn', 'memory-tree', 'Skipping cluster rebuild; meeting has no embeddings', {
      meetingId: 'mtg_no_embeddings',
    })
    repo.close()
  })
})

import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting, Segment } from '../main/memory/types'

function meeting(id: string, startedAt: number): Meeting {
  return {
    id,
    title: `Meeting ${id}`,
    startedAt,
    endedAt: startedAt + 1000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 1000,
  }
}

function segment(meetingId: string, id: string, seq: number): Segment {
  return {
    id,
    meetingId,
    seq,
    createdAt: 1000 + seq,
    speakerId: null,
    speakerLabel: null,
    sourceText: `segment ${id}`,
    translatedText: null,
    sourceLanguage: 'en',
  }
}

function addMeetingWithEmbeddings(
  repo: MemoryRepository,
  meetingId: string,
  vectors: Float32Array[]
): void {
  repo.insertMeeting(meeting(meetingId, vectors.length))
  vectors.forEach((vector, index) => {
    const seg = segment(meetingId, `${meetingId}_seg_${index}`, index)
    repo.insertSegment(seg)
    repo.saveEmbedding(seg.id, vector, 'text-embedding-3-small')
  })
}

describe('MemoryRepository meeting clusters', () => {
  it('inserts and lists clusters with centroid round-trip', () => {
    const repo = new MemoryRepository(':memory:')
    const createdAt = 100
    repo.insertCluster({
      id: 'cluster_a',
      title: 'Alpha',
      summary: 'Alpha summary',
      centroid: new Float32Array([0.1, 0.2, 0.3]),
      memberCount: 1,
      createdAt,
    })

    const [cluster] = repo.listClusters()

    expect(cluster).toMatchObject({
      id: 'cluster_a',
      title: 'Alpha',
      summary: 'Alpha summary',
      memberCount: 1,
      createdAt,
      updatedAt: createdAt,
    })
    expect(Array.from(cluster.centroid)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ])
    repo.close()
  })

  it('adds cluster members and finds a cluster by meeting', () => {
    const repo = new MemoryRepository(':memory:')
    addMeetingWithEmbeddings(repo, 'mtg_a', [new Float32Array([1, 0])])
    repo.insertCluster({
      id: 'cluster_a',
      title: 'Alpha',
      summary: 'Alpha summary',
      centroid: new Float32Array([1, 0]),
      memberCount: 0,
      createdAt: 100,
    })

    repo.addClusterMember('cluster_a', 'mtg_a')

    expect(repo.getClusterByMeeting('mtg_a')?.id).toBe('cluster_a')
    expect(repo.listClusters()[0].memberCount).toBe(1)
    repo.close()
  })

  it('finds the nearest cluster above a cosine threshold and returns null below it', () => {
    const repo = new MemoryRepository(':memory:')
    repo.insertCluster({
      id: 'cluster_x',
      title: 'X',
      summary: 'X summary',
      centroid: new Float32Array([1, 0]),
      memberCount: 1,
      createdAt: 100,
    })
    repo.insertCluster({
      id: 'cluster_y',
      title: 'Y',
      summary: 'Y summary',
      centroid: new Float32Array([0, 1]),
      memberCount: 1,
      createdAt: 200,
    })

    const hit = repo.findNearestClusterToCentroid(new Float32Array([0.9, 0.1]), 0.6)

    expect(hit?.cluster.id).toBe('cluster_x')
    expect(hit?.similarity).toBeGreaterThan(0.99)
    expect(repo.findNearestClusterToCentroid(new Float32Array([1, 0]), 1.01)).toBeNull()
    repo.close()
  })

  it('cascades member rows when a meeting or cluster is deleted', () => {
    const repo = new MemoryRepository(':memory:')
    addMeetingWithEmbeddings(repo, 'mtg_a', [new Float32Array([1, 0])])
    addMeetingWithEmbeddings(repo, 'mtg_b', [new Float32Array([0, 1])])
    repo.insertCluster({
      id: 'cluster_a',
      title: 'Alpha',
      summary: 'Alpha summary',
      centroid: new Float32Array([1, 0]),
      memberCount: 0,
      createdAt: 100,
    })
    repo.insertCluster({
      id: 'cluster_b',
      title: 'Beta',
      summary: 'Beta summary',
      centroid: new Float32Array([0, 1]),
      memberCount: 0,
      createdAt: 100,
    })
    repo.addClusterMember('cluster_a', 'mtg_a')
    repo.addClusterMember('cluster_b', 'mtg_b')

    repo.deleteMeeting('mtg_a')
    repo.raw.prepare('DELETE FROM meeting_clusters WHERE id = ?').run('cluster_b')

    expect(repo.getClusterByMeeting('mtg_a')).toBeNull()
    expect(repo.getClusterByMeeting('mtg_b')).toBeNull()
    repo.close()
  })

  it('recalculates a cluster centroid from averaged member meeting embeddings', () => {
    const repo = new MemoryRepository(':memory:')
    addMeetingWithEmbeddings(repo, 'mtg_a', [
      new Float32Array([1, 0]),
      new Float32Array([0, 1]),
    ])
    addMeetingWithEmbeddings(repo, 'mtg_b', [
      new Float32Array([1, 1]),
      new Float32Array([1, 1]),
    ])
    repo.insertCluster({
      id: 'cluster_a',
      title: 'Alpha',
      summary: 'Alpha summary',
      centroid: new Float32Array([0, 0]),
      memberCount: 0,
      createdAt: 100,
    })
    repo.addClusterMember('cluster_a', 'mtg_a')
    repo.addClusterMember('cluster_a', 'mtg_b')

    const centroid = repo.recalcClusterCentroid('cluster_a')

    expect(Array.from(centroid ?? [])).toEqual([0.75, 0.75])
    expect(Array.from(repo.listClusters()[0].centroid)).toEqual([0.75, 0.75])
    expect(repo.listClusters()[0].memberCount).toBe(2)
    repo.close()
  })
})

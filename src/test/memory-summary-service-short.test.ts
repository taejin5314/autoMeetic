import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { SummaryService } from '../main/memory/summaryService'
import type { Meeting, Segment, SummaryJSON } from '../main/memory/types'

function setupRepoWithShortMeeting(): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_short',
    title: 't',
    startedAt: 0,
    endedAt: 5 * 60 * 1000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 5 * 60 * 1000,
  }
  repo.insertMeeting(meeting)
  for (let i = 0; i < 3; i++) {
    const s: Segment = {
      id: 'seg_' + i,
      meetingId: 'mtg_short',
      seq: i,
      createdAt: i * 1000,
      speakerId: 'speaker_a',
      speakerLabel: 'Speaker A',
      sourceText: 'line ' + i,
      translatedText: null,
      sourceLanguage: 'en',
    }
    repo.insertSegment(s)
  }
  return repo
}

function happyJson(): SummaryJSON {
  return {
    shortSummary: 'short',
    detailedSummary: '- a\n- b',
    keyPoints: ['k'],
    actionItems: [{ text: 'do it', owner: 'Speaker A' }],
  }
}

describe('SummaryService short meeting', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('calls summarizeMeeting once for meetings under 15 minutes', async () => {
    const repo = setupRepoWithShortMeeting()
    const callImpl = vi.fn(async () => JSON.stringify(happyJson()))
    const svc = new SummaryService(repo, callImpl, { now: () => 1234 })
    await svc.generate('mtg_short')
    expect(callImpl).toHaveBeenCalledTimes(1)
    expect(repo.getSummary('mtg_short')).toMatchObject({
      meetingId: 'mtg_short',
      shortSummary: 'short',
      status: 'ok',
      promptVersion: 'v1',
    })
    repo.close()
  })

  it('retries once on JSON parse failure, then succeeds', async () => {
    const repo = setupRepoWithShortMeeting()
    const calls: string[] = ['not-json', JSON.stringify(happyJson())]
    const callImpl = vi.fn(async () => calls.shift()!)
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_short')
    expect(callImpl).toHaveBeenCalledTimes(2)
    expect(repo.getSummary('mtg_short')?.status).toBe('ok')
    repo.close()
  })

  it('saves a failed row when JSON parse fails twice', async () => {
    const repo = setupRepoWithShortMeeting()
    const callImpl = vi.fn(async () => 'still not json')
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_short')
    const s = repo.getSummary('mtg_short')!
    expect(s.status).toBe('failed')
    expect(s.shortSummary).toMatch(/failed/i)
    repo.close()
  })

  it('rejects when token estimate exceeds limit', async () => {
    const repo = setupRepoWithShortMeeting()
    repo.insertSegment({
      id: 'seg_huge',
      meetingId: 'mtg_short',
      seq: 99,
      createdAt: 0,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'x'.repeat(2_000_000),
      translatedText: null,
      sourceLanguage: 'en',
    })
    const callImpl = vi.fn(async () => JSON.stringify(happyJson()))
    const svc = new SummaryService(repo, callImpl, { now: () => 1, maxInputTokens: 1000 })
    await svc.generate('mtg_short')
    expect(callImpl).not.toHaveBeenCalled()
    const s = repo.getSummary('mtg_short')!
    expect(s.status).toBe('failed')
    expect(s.shortSummary).toMatch(/too long/i)
    repo.close()
  })

  it('respects autoEnabled=false by skipping generateIfAutoEnabled', async () => {
    const repo = setupRepoWithShortMeeting()
    const callImpl = vi.fn(async () => JSON.stringify(happyJson()))
    const svc = new SummaryService(repo, callImpl, { now: () => 1, autoEnabled: false })
    await svc.generateIfAutoEnabled('mtg_short')
    expect(callImpl).not.toHaveBeenCalled()
    expect(repo.getSummary('mtg_short')).toBeNull()
    repo.close()
  })
})

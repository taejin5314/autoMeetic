import { describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { SummaryService } from '../main/memory/summaryService'
import type { Meeting, Segment } from '../main/memory/types'

function setupLongMeeting(durationMin: number): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_long',
    title: 't',
    startedAt: 0,
    endedAt: durationMin * 60_000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: durationMin * 60_000,
  }
  repo.insertMeeting(meeting)
  for (let i = 0; i < durationMin; i++) {
    const s: Segment = {
      id: 's' + i,
      meetingId: 'mtg_long',
      seq: i,
      createdAt: i * 60_000,
      speakerId: null,
      speakerLabel: 'Speaker A',
      sourceText: 'minute ' + i,
      translatedText: null,
      sourceLanguage: 'en',
    }
    repo.insertSegment(s)
  }
  return repo
}

const validJson = JSON.stringify({
  shortSummary: 's',
  detailedSummary: 'd',
  keyPoints: ['k'],
  actionItems: [{ text: 'a' }],
})

describe('SummaryService long meeting', () => {
  it('splits a 30-min meeting into multiple chunks and runs a reduce call', async () => {
    const repo = setupLongMeeting(30)
    const calls: { userPrompt: string }[] = []
    const callImpl = vi.fn(async (args: { systemPrompt: string; userPrompt: string }) => {
      calls.push(args)
      return validJson
    })
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_long')
    expect(callImpl.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(calls[calls.length - 1].userPrompt).toMatch(/Chunk/)
    expect(repo.getSummary('mtg_long')?.status).toBe('ok')
    repo.close()
  })

  it('map-reduces long meetings even when the full transcript exceeds the single-call token guard', async () => {
    const repo = setupLongMeeting(30)
    const callImpl = vi.fn(async () => validJson)
    const svc = new SummaryService(repo, callImpl, { now: () => 1, maxInputTokens: 20 })
    await svc.generate('mtg_long')
    expect(callImpl.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(repo.getSummary('mtg_long')?.status).toBe('ok')
    repo.close()
  })

  it('falls back to failed if reduce JSON cannot be parsed twice', async () => {
    const repo = setupLongMeeting(20)
    let n = 0
    const callImpl = vi.fn(async () => {
      n++
      return n <= 3 ? validJson : 'garbage'
    })
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_long')
    expect(repo.getSummary('mtg_long')?.status).toBe('failed')
    repo.close()
  })
})

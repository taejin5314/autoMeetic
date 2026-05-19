import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function sampleMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_test_1',
    title: 'Meeting 2026-05-17 14:30',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    sourceLanguage: 'auto',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
    ...overrides,
  }
}

describe('MemoryRepository meetings CRUD', () => {
  it('inserts and retrieves a meeting', () => {
    const repo = makeRepo()
    const m = sampleMeeting()
    repo.insertMeeting(m)
    expect(repo.getMeeting(m.id)).toEqual(m)
    repo.close()
  })

  it('lists meetings sorted by started_at DESC', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting({ id: 'a', startedAt: 1 }))
    repo.insertMeeting(sampleMeeting({ id: 'b', startedAt: 3 }))
    repo.insertMeeting(sampleMeeting({ id: 'c', startedAt: 2 }))
    const list = repo.listMeetings(10, 0)
    expect(list.map((m) => m.id)).toEqual(['b', 'c', 'a'])
    repo.close()
  })

  it('updates title', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.updateTitle('mtg_test_1', 'New title')
    expect(repo.getMeeting('mtg_test_1')?.title).toBe('New title')
    repo.close()
  })

  it('marks status and ended_at', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.markMeetingEnded('mtg_test_1', 1_700_000_010_000, 'completed')
    const m = repo.getMeeting('mtg_test_1')!
    expect(m.endedAt).toBe(1_700_000_010_000)
    expect(m.durationMs).toBe(10_000)
    expect(m.status).toBe('completed')
    repo.close()
  })

  it('finds meetings by status', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting({ id: 'a', status: 'live' }))
    repo.insertMeeting(sampleMeeting({ id: 'b', status: 'completed' }))
    repo.insertMeeting(sampleMeeting({ id: 'c', status: 'live' }))
    expect(repo.findMeetingsByStatus('live').map((m) => m.id).sort()).toEqual(['a', 'c'])
    repo.close()
  })

  it('marks a meeting failed', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.markMeetingStatus('mtg_test_1', 'failed')
    expect(repo.getMeeting('mtg_test_1')?.status).toBe('failed')
    repo.close()
  })

  it('deletes a meeting', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.deleteMeeting('mtg_test_1')
    expect(repo.getMeeting('mtg_test_1')).toBeNull()
    repo.close()
  })
})

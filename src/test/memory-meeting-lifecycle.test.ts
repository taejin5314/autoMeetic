import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { MeetingLifecycle } from '../main/memory/meetingLifecycle'

function makeLifecycle() {
  const repo = new MemoryRepository(':memory:')
  const lifecycle = new MeetingLifecycle(repo, { now: () => 1_000_000 })
  return { repo, lifecycle }
}

describe('MeetingLifecycle', () => {
  it('begin creates a live meeting and sets currentMeetingId', () => {
    const { repo, lifecycle } = makeLifecycle()
    const id = lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    expect(id).toMatch(/^mtg_/)
    expect(lifecycle.getCurrentMeetingId()).toBe(id)
    const m = repo.getMeeting(id)
    expect(m?.status).toBe('live')
    expect(m?.sourceLanguage).toBe('en')
    expect(m?.targetLanguage).toBe('ko')
    expect(m?.startedAt).toBe(1_000_000)
    repo.close()
  })

  it('beginMeeting throws when a meeting is already live', () => {
    const { repo, lifecycle } = makeLifecycle()
    lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    expect(() => lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })).toThrow(
      /already live/i
    )
    repo.close()
  })

  it('endMeeting marks completed, computes duration, and clears currentMeetingId', () => {
    const repo = new MemoryRepository(':memory:')
    let t = 1_000_000
    const lifecycle = new MeetingLifecycle(repo, { now: () => t })
    const id = lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    t = 1_005_000
    lifecycle.endMeeting()
    expect(lifecycle.getCurrentMeetingId()).toBeNull()
    const m = repo.getMeeting(id)!
    expect(m.status).toBe('completed')
    expect(m.durationMs).toBe(5_000)
    repo.close()
  })

  it('endMeeting is a no-op when no meeting is live', () => {
    const { lifecycle, repo } = makeLifecycle()
    expect(() => lifecycle.endMeeting()).not.toThrow()
    repo.close()
  })

  it('recoverInterruptedMeetings marks all live meetings failed', () => {
    const repo = new MemoryRepository(':memory:')
    const lifecycle = new MeetingLifecycle(repo, { now: () => 1 })
    lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    const lifecycle2 = new MeetingLifecycle(repo, { now: () => 2 })
    const recovered = lifecycle2.recoverInterruptedMeetings()
    expect(recovered).toBe(1)
    expect(repo.findMeetingsByStatus('live')).toHaveLength(0)
    expect(repo.findMeetingsByStatus('failed')).toHaveLength(1)
    repo.close()
  })

  it('default title is "Meeting YYYY-MM-DD HH:mm" derived from startedAt', () => {
    const repo = new MemoryRepository(':memory:')
    const fixed = new Date('2026-05-17T14:30:00+09:00').getTime()
    const lifecycle = new MeetingLifecycle(repo, { now: () => fixed })
    const id = lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    const m = repo.getMeeting(id)!
    expect(m.title).toMatch(/^Meeting \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    repo.close()
  })
})

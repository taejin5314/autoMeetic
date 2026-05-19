import type { MemoryRepository } from './repository'

interface BeginArgs {
  sourceLanguage: string
  targetLanguage: string
}

interface LifecycleOptions {
  now?: () => number
}

function makeMeetingId(now: number): string {
  const ts = now.toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `mtg_${ts}_${rand}`
}

function defaultTitle(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Meeting ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

export class MeetingLifecycle {
  private currentMeetingId: string | null = null
  private repo: MemoryRepository
  private now: () => number

  constructor(repo: MemoryRepository, options: LifecycleOptions = {}) {
    this.repo = repo
    this.now = options.now ?? (() => Date.now())
  }

  beginMeeting(args: BeginArgs): string {
    if (this.currentMeetingId) {
      throw new Error('Meeting already live; call endMeeting first')
    }
    const startedAt = this.now()
    const id = makeMeetingId(startedAt)
    this.repo.insertMeeting({
      id,
      title: defaultTitle(startedAt),
      startedAt,
      endedAt: null,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      status: 'live',
      segmentCount: 0,
      durationMs: null,
    })
    this.currentMeetingId = id
    return id
  }

  endMeeting(): string | null {
    const id = this.currentMeetingId
    if (!id) return null
    this.repo.markMeetingEnded(id, this.now(), 'completed')
    this.currentMeetingId = null
    return id
  }

  getCurrentMeetingId(): string | null {
    return this.currentMeetingId
  }

  recoverInterruptedMeetings(): number {
    const live = this.repo.findMeetingsByStatus('live')
    for (const m of live) {
      this.repo.markMeetingStatus(m.id, 'failed')
    }
    return live.length
  }
}

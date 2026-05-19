import type { MemoryRepository } from '../memory/repository'
import type { GlossaryEntry } from '../memory/types'

let cachedGlossary: GlossaryEntry[] = []
let cachedMeetingId: string | null = null
let glossaryEpoch = 0
let cachedEpoch = -1

export function ensureFreshGlossary(repo: MemoryRepository, meetingId: string | null): void {
  if (meetingId === cachedMeetingId && cachedEpoch === glossaryEpoch) return
  cachedGlossary = repo.activeGlossary(meetingId)
  cachedMeetingId = meetingId
  cachedEpoch = glossaryEpoch
}

export function getCachedGlossary(): GlossaryEntry[] {
  return cachedGlossary
}

export function bumpGlossaryEpoch(): void {
  glossaryEpoch += 1
}

/** Test-only: reset module state between tests. */
export function __resetGlossaryCacheForTesting(): void {
  cachedGlossary = []
  cachedMeetingId = null
  glossaryEpoch = 0
  cachedEpoch = -1
}

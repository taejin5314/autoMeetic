import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossarySuggestionInput, Meeting, Segment } from '../main/memory/types'

const send = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send } }],
  },
}))

import { buildGlossaryHandlers } from '../main/ipc-glossary-handlers'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_test_1',
    title: 'Meeting',
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

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg_1',
    meetingId: 'mtg_test_1',
    seq: 0,
    createdAt: 1_700_000_001_000,
    speakerId: null,
    speakerLabel: null,
    sourceText: 'Kun Chen joined',
    translatedText: 'Kun Chen 합류',
    sourceLanguage: 'en',
    ...overrides,
  }
}

function suggestion(overrides: Partial<GlossarySuggestionInput> = {}): GlossarySuggestionInput {
  return {
    meetingId: 'mtg_test_1',
    sourceTerm: 'kunchen',
    translations: { ko: '쿤 첸' },
    preserve: false,
    confidence: 0.85,
    reason: 'Personal name',
    frequency: 4,
    variants: ['Kun Chen'],
    ...overrides,
  }
}

function setupRepo(): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  repo.insertMeeting(meeting())
  repo.insertSegment(segment())
  return repo
}

beforeEach(() => {
  send.mockReset()
})

describe('buildGlossaryHandlers suggestion IPC', () => {
  it('lists all pending suggestions when meetingId is omitted', async () => {
    const repo = setupRepo()
    repo.insertMeeting(meeting({ id: 'mtg_test_2', startedAt: 1_700_000_010_000 }))
    repo.upsertSuggestion(suggestion({ sourceTerm: 'alpha' }))
    repo.upsertSuggestion(suggestion({ meetingId: 'mtg_test_2', sourceTerm: 'beta' }))
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    const result = await handlers['glossary:suggestions:list']({})

    expect(result.map((s) => s.sourceTerm)).toEqual(['beta', 'alpha'])
    repo.close()
  })

  it('lists pending suggestions for one meeting', async () => {
    const repo = setupRepo()
    repo.insertMeeting(meeting({ id: 'mtg_other', startedAt: 1_700_000_010_000 }))
    repo.upsertSuggestion(suggestion({ sourceTerm: 'mine' }))
    repo.upsertSuggestion(suggestion({ meetingId: 'mtg_other', sourceTerm: 'other' }))
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    const result = await handlers['glossary:suggestions:list']({ meetingId: 'mtg_test_1' })

    expect(result.map((s) => s.sourceTerm)).toEqual(['mine'])
    repo.close()
  })

  it('counts pending suggestions', async () => {
    const repo = setupRepo()
    repo.upsertSuggestion(suggestion({ sourceTerm: 'a' }))
    repo.upsertSuggestion(suggestion({ sourceTerm: 'b' }))
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    await expect(handlers['glossary:suggestions:count']()).resolves.toBe(2)
    repo.close()
  })

  it('accepts a suggestion and broadcasts glossary, suggestion, and meeting updates', async () => {
    const repo = setupRepo()
    const sugg = repo.upsertSuggestion(suggestion())
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    const entry = await handlers['glossary:suggestions:accept']({ id: sugg.id })

    expect(entry.sourceTerm).toBe('kunchen')
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    expect(repo.countPendingSuggestions()).toBe(0)
    expect(send).toHaveBeenCalledWith('glossary:changed')
    expect(send).toHaveBeenCalledWith('glossary:suggestions-updated')
    expect(send).toHaveBeenCalledWith('memory:meeting-updated')
    repo.close()
  })

  it('dismisses a suggestion and broadcasts suggestion updates', async () => {
    const repo = setupRepo()
    const sugg = repo.upsertSuggestion(suggestion({ sourceTerm: 'GPU' }))
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    await handlers['glossary:suggestions:dismiss']({ id: sugg.id })

    expect(repo.isDismissed('gpu')).toBe(true)
    expect(send).toHaveBeenCalledWith('glossary:suggestions-updated')
    repo.close()
  })

  it('bulk accepts suggestions and reports mixed success', async () => {
    const repo = setupRepo()
    const good = repo.upsertSuggestion(suggestion({ sourceTerm: 'kunchen' }))
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    const result = await handlers['glossary:suggestions:bulk-accept']({
      ids: [good.id, 'missing'],
    })

    expect(result.accepted).toEqual([good.id])
    expect(result.failed).toEqual([{ id: 'missing', error: 'suggestion not found: missing' }])
    expect(send).toHaveBeenCalledWith('glossary:changed')
    expect(send).toHaveBeenCalledWith('glossary:suggestions-updated')
    expect(send).toHaveBeenCalledWith('memory:meeting-updated')
    repo.close()
  })
})

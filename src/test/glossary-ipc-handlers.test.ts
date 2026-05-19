import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry, GlossaryEntryInput } from '../main/memory/types'

const send = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send } }],
  },
}))

import { buildGlossaryHandlers } from '../main/ipc-glossary-handlers'

function makeEntry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id: 'glossary_1',
    scope: 'global',
    meetingId: null,
    sourceTerm: 'AutoMeetic',
    translations: { ko: '오토미틱' },
    preserve: true,
    note: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeInput(overrides: Partial<GlossaryEntryInput> = {}): GlossaryEntryInput {
  return {
    scope: 'global',
    meetingId: null,
    sourceTerm: 'AutoMeetic',
    translations: { ko: '오토미틱' },
    preserve: true,
    note: null,
    ...overrides,
  }
}

beforeEach(() => {
  send.mockReset()
})

describe('buildGlossaryHandlers', () => {
  it('delegates list requests to the glossary repo', async () => {
    const entry = makeEntry()
    const repo = {
      listGlossary: vi.fn().mockReturnValue([entry]),
      upsertGlossary: vi.fn(),
      deleteGlossary: vi.fn(),
      activeGlossary: vi.fn(),
    }
    const handlers = buildGlossaryHandlers(async () => repo, () => null)

    await expect(handlers['glossary:list']({ scope: 'meeting', meetingId: 'mtg_a' })).resolves.toEqual([
      entry,
    ])
    expect(repo.listGlossary).toHaveBeenCalledWith('meeting', 'mtg_a')
  })

  it('broadcasts glossary changes after upsert', async () => {
    const entry = makeEntry()
    const repo = {
      listGlossary: vi.fn(),
      upsertGlossary: vi.fn().mockReturnValue(entry),
      deleteGlossary: vi.fn(),
      activeGlossary: vi.fn(),
    }
    const handlers = buildGlossaryHandlers(async () => repo, () => null)
    const input = makeInput()

    await expect(handlers['glossary:upsert']({ entry: input })).resolves.toEqual(entry)
    expect(repo.upsertGlossary).toHaveBeenCalledWith(input)
    expect(send).toHaveBeenCalledWith('glossary:changed')
  })

  it('uses the current meeting id for active glossary requests without an explicit meeting id', async () => {
    const entry = makeEntry({ scope: 'meeting', meetingId: 'mtg_live' })
    const repo = {
      listGlossary: vi.fn(),
      upsertGlossary: vi.fn(),
      deleteGlossary: vi.fn(),
      activeGlossary: vi.fn().mockReturnValue([entry]),
    }
    const handlers = buildGlossaryHandlers(async () => repo, () => 'mtg_live')

    await expect(handlers['glossary:active']({})).resolves.toEqual([entry])
    expect(repo.activeGlossary).toHaveBeenCalledWith('mtg_live')
  })

  it('wraps initialization failures with glossary context', async () => {
    const handlers = buildGlossaryHandlers(
      async () => {
        throw new Error('db locked')
      },
      () => null
    )

    await expect(handlers['glossary:list']({ scope: 'global' })).rejects.toThrow(
      'Glossary repo failed to initialize: db locked'
    )
  })
})

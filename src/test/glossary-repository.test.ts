import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossaryEntryInput } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function sampleInput(overrides: Partial<GlossaryEntryInput> = {}): GlossaryEntryInput {
  return {
    scope: 'global',
    meetingId: null,
    sourceTerm: 'autoMeetic',
    translations: { ko: '오토미틱' },
    preserve: true,
    note: null,
    ...overrides,
  }
}

describe('MemoryRepository upsertGlossary', () => {
  it('inserts a new entry and returns it with generated id and timestamps', () => {
    const repo = makeRepo()
    const entry = repo.upsertGlossary(sampleInput())
    expect(entry.id).toMatch(/^gloss_/)
    expect(entry.sourceTerm).toBe('autoMeetic')
    expect(entry.translations).toEqual({ ko: '오토미틱' })
    expect(entry.preserve).toBe(true)
    expect(entry.createdAt).toBeGreaterThan(0)
    expect(entry.updatedAt).toBe(entry.createdAt)
    repo.close()
  })

  it('updates an existing entry when id is provided', () => {
    const repo = makeRepo()
    const a = repo.upsertGlossary(sampleInput())
    const b = repo.upsertGlossary({ ...sampleInput(), id: a.id, note: 'updated' })
    expect(b.id).toBe(a.id)
    expect(b.note).toBe('updated')
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt)
    repo.close()
  })

  it('rejects empty source_term', () => {
    const repo = makeRepo()
    expect(() => repo.upsertGlossary(sampleInput({ sourceTerm: '   ' }))).toThrow(
      /source_term|sourceTerm/i
    )
    repo.close()
  })

  it('rejects source_term over 100 chars', () => {
    const repo = makeRepo()
    expect(() =>
      repo.upsertGlossary(sampleInput({ sourceTerm: 'x'.repeat(101) }))
    ).toThrow(/100/)
    repo.close()
  })

  it('rejects meeting scope without meetingId', () => {
    const repo = makeRepo()
    expect(() =>
      repo.upsertGlossary(sampleInput({ scope: 'meeting', meetingId: null }))
    ).toThrow(/meeting/i)
    repo.close()
  })

  it('rejects global scope with a meetingId', () => {
    const repo = makeRepo()
    expect(() =>
      repo.upsertGlossary(sampleInput({ scope: 'global', meetingId: 'mtg_x' }))
    ).toThrow(/global/i)
    repo.close()
  })

  it('rejects duplicate (scope, meeting_id, lowercase sourceTerm)', () => {
    const repo = makeRepo()
    repo.upsertGlossary(sampleInput({ sourceTerm: 'GPU' }))
    expect(() => repo.upsertGlossary(sampleInput({ sourceTerm: 'gpu' }))).toThrow(
      /duplicate|exists/i
    )
    repo.close()
  })
})

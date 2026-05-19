import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import {
  __resetGlossaryCacheForTesting,
  bumpGlossaryEpoch,
  ensureFreshGlossary,
  getCachedGlossary,
} from '../main/glossary/cache'

function makeRepo() {
  const repo = new MemoryRepository(':memory:')
  return repo
}

afterEach(() => __resetGlossaryCacheForTesting())

describe('glossary cache', () => {
  it('loads on first call', () => {
    const repo = makeRepo()
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'a',
      translations: {},
      preserve: true,
      note: null,
    })
    ensureFreshGlossary(repo, null)
    expect(getCachedGlossary().map((e) => e.sourceTerm)).toEqual(['a'])
    repo.close()
  })

  it('does not reload on subsequent call with same meetingId and no epoch bump', () => {
    const repo = makeRepo()
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'a',
      translations: {},
      preserve: true,
      note: null,
    })
    ensureFreshGlossary(repo, null)
    const spy = vi.spyOn(repo, 'activeGlossary')
    ensureFreshGlossary(repo, null)
    expect(spy).not.toHaveBeenCalled()
    repo.close()
  })

  it('reloads after bumpGlossaryEpoch', () => {
    const repo = makeRepo()
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'a',
      translations: {},
      preserve: true,
      note: null,
    })
    ensureFreshGlossary(repo, null)
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'b',
      translations: {},
      preserve: true,
      note: null,
    })
    bumpGlossaryEpoch()
    ensureFreshGlossary(repo, null)
    expect(getCachedGlossary().map((e) => e.sourceTerm).sort()).toEqual(['a', 'b'])
    repo.close()
  })

  it('reloads when meetingId changes', () => {
    const repo = makeRepo()
    repo.insertMeeting({
      id: 'mtg_a',
      title: 't',
      startedAt: 1,
      endedAt: null,
      sourceLanguage: 'auto',
      targetLanguage: 'ko',
      status: 'live',
      segmentCount: 0,
      durationMs: null,
    })
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'g',
      translations: {},
      preserve: true,
      note: null,
    })
    repo.upsertGlossary({
      scope: 'meeting',
      meetingId: 'mtg_a',
      sourceTerm: 'm',
      translations: {},
      preserve: true,
      note: null,
    })
    ensureFreshGlossary(repo, null)
    expect(getCachedGlossary().map((e) => e.sourceTerm)).toEqual(['g'])
    ensureFreshGlossary(repo, 'mtg_a')
    expect(getCachedGlossary().map((e) => e.sourceTerm).sort()).toEqual(['g', 'm'])
    repo.close()
  })
})

import { describe, expect, it } from 'vitest'
import { buildMemoryHandlers, type MemoryHandlerApi } from '../main/ipc-memory-handlers'

function delayedMemory() {
  let resolve!: (value: MemoryHandlerApi) => void
  const promise = new Promise<MemoryHandlerApi>((r) => {
    resolve = r
  })

  return { promise, resolve }
}

function memoryFixture(overrides: Partial<MemoryHandlerApi> = {}): MemoryHandlerApi {
  return {
    listMeetings: () => [],
    getMeeting: () => null,
    search: async () => [],
    renameMeeting: () => undefined,
    deleteMeeting: () => undefined,
    exportMeeting: () => '# export',
    regenerateSummary: async () => undefined,
    ...overrides,
  }
}

describe('memory IPC readiness', () => {
  it('waits for memory initialization instead of throwing while it is still starting', async () => {
    const ready = delayedMemory()
    const handlers = buildMemoryHandlers(() => ready.promise)
    const pending = handlers['memory:list-meetings']({})

    ready.resolve(memoryFixture({ listMeetings: () => ['ready'] as never }))

    await expect(pending).resolves.toEqual(['ready'])
  })

  it('reports the real initialization failure if memory cannot start', async () => {
    const handlers = buildMemoryHandlers(() => Promise.reject(new Error('sqlite failed')))

    await expect(handlers['memory:list-meetings']({})).rejects.toThrow(
      /Memory service failed to initialize: sqlite failed/
    )
  })
})

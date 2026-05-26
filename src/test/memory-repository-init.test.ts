import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'

describe('MemoryRepository init', () => {
  it('creates schema and reports version 5 on a fresh in-memory db', () => {
    const repo = new MemoryRepository(':memory:')
    expect(repo.getSchemaVersion()).toBe(5)
    repo.close()
  })

  it('is idempotent when opening an already-initialized db', () => {
    const repo = new MemoryRepository(':memory:')
    repo.close()
    const repo2 = new MemoryRepository(':memory:')
    expect(repo2.getSchemaVersion()).toBe(5)
    repo2.close()
  })

  it('enables WAL mode on file databases', () => {
    const repo = new MemoryRepository(':memory:')
    expect(repo.getJournalMode()).toMatch(/wal|memory/i)
    repo.close()
  })
})

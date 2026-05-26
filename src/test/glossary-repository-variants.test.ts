import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'

function freshRepo(): MemoryRepository {
  const dir = mkdtempSync(join(tmpdir(), 'autometic-gv-'))
  return new MemoryRepository(join(dir, 'memory.db'))
}

describe('MemoryRepository — glossary variants', () => {
  let repo: MemoryRepository

  beforeEach(() => {
    repo = freshRepo()
  })

  it('schema version is 5 after fresh init', () => {
    expect(repo.getSchemaVersion()).toBe(5)
  })

  it('upsert + list round-trips variants', () => {
    const entry = repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'RealtimeOrchestrator',
      translations: {},
      preserve: true,
      note: null,
      variants: ['real time orchestrator', 'realtime orchestrator'],
    })
    expect(entry.variants).toEqual(['real time orchestrator', 'realtime orchestrator'])

    const listed = repo.listGlossary('global')
    expect(listed[0].variants).toEqual(['real time orchestrator', 'realtime orchestrator'])
  })

  it('default variants is an empty array when not supplied', () => {
    const entry = repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'X',
      translations: {},
      preserve: false,
      note: null,
    })
    expect(entry.variants).toEqual([])
  })

  it('activeGlossary includes variants', () => {
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'Term',
      translations: {},
      preserve: true,
      note: null,
      variants: ['term'],
    })
    const active = repo.activeGlossary(null)
    expect(active[0].variants).toEqual(['term'])
  })

  it('acceptSuggestion copies variants from the suggestion', () => {
    repo.insertMeeting({
      id: 'mtg1',
      title: 'm',
      startedAt: 1,
      endedAt: null,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      status: 'completed',
      segmentCount: 0,
      durationMs: null,
    })
    const sugg = repo.upsertSuggestion({
      meetingId: 'mtg1',
      sourceTerm: 'CanonicalForm',
      translations: { ko: '캐노니컬' },
      preserve: true,
      confidence: 0.9,
      reason: 'extracted',
      frequency: 5,
      variants: ['canonical form', 'canonicalform'],
    })
    const entry = repo.acceptSuggestion(sugg.id)
    expect(entry.variants.sort()).toEqual(['canonical form', 'canonicalform'])
  })

  it('listRecentSegmentsForScan returns up to limit segments, newest first', () => {
    repo.insertMeeting({
      id: 'mtg1',
      title: 'm',
      startedAt: 1,
      endedAt: null,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      status: 'completed',
      segmentCount: 0,
      durationMs: null,
    })
    for (let i = 0; i < 5; i++) {
      repo.insertSegment({
        id: `s${i}`,
        meetingId: 'mtg1',
        seq: i + 1,
        createdAt: 1000 + i,
        speakerId: null,
        speakerLabel: null,
        sourceText: `text ${i}`,
        translatedText: null,
        sourceLanguage: 'en',
      })
    }
    const rows = repo.listRecentSegmentsForScan(3)
    expect(rows).toHaveLength(3)
    expect(rows[0].sourceText).toBe('text 4')
  })

  it('migrateToV5 is idempotent: ALTER does not throw when re-applied via fresh init', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-gv2-'))
    const dbPath = join(dir, 'memory.db')
    const r1 = new MemoryRepository(dbPath)
    expect(r1.getSchemaVersion()).toBe(5)
    r1.close()
    // Re-init same DB; migrate should be a no-op
    const r2 = new MemoryRepository(dbPath)
    expect(r2.getSchemaVersion()).toBe(5)
  })

  it('migrateToV5 adds the column to a pre-v5 DB without data loss', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-gv3-'))
    const dbPath = join(dir, 'memory.db')
    // Manually create a v4-shaped DB with a glossary_entries row that has no variants column
    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version(version) VALUES (4);
      CREATE TABLE glossary_entries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('global','meeting')),
        meeting_id TEXT,
        source_term TEXT NOT NULL,
        translations TEXT NOT NULL DEFAULT '{}',
        preserve INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO glossary_entries(id, scope, meeting_id, source_term, translations, preserve, note, created_at, updated_at)
      VALUES ('legacy', 'global', NULL, 'OldTerm', '{}', 1, NULL, 1, 1);
    `)
    raw.close()
    // Re-open with the production repo — migration should run
    const repo = new MemoryRepository(dbPath)
    expect(repo.getSchemaVersion()).toBe(5)
    const entries = repo.listGlossary('global')
    expect(entries).toHaveLength(1)
    expect(entries[0].sourceTerm).toBe('OldTerm')
    expect(entries[0].variants).toEqual([])
  })
})

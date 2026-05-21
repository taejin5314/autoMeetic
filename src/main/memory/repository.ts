import Database from 'better-sqlite3'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import type {
  GlossaryEntry,
  GlossaryEntryInput,
  GlossarySuggestion,
  GlossarySuggestionInput,
  Meeting,
  MeetingStatus,
  SearchHit,
  Segment,
  SegmentEmbedding,
  Summary,
} from './types'

export class MemoryRepository {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')
    this.initialize()
  }

  private initialize(): void {
    this.db.exec(SCHEMA_SQL)
    const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined
    if (!row) {
      this.db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION)
    }
  }

  getSchemaVersion(): number {
    const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined
    return row?.version ?? 0
  }

  getJournalMode(): string {
    const row = this.db.pragma('journal_mode', { simple: true }) as string
    return row
  }

  insertMeeting(m: Meeting): void {
    this.db
      .prepare(
        `INSERT INTO meetings(id, title, started_at, ended_at, source_language, target_language, status, segment_count, duration_ms)
         VALUES (@id, @title, @startedAt, @endedAt, @sourceLanguage, @targetLanguage, @status, @segmentCount, @durationMs)`
      )
      .run(m)
  }

  getMeeting(id: string): Meeting | null {
    const row = this.db
      .prepare(
        `SELECT id, title, started_at AS startedAt, ended_at AS endedAt,
                source_language AS sourceLanguage, target_language AS targetLanguage,
                status, segment_count AS segmentCount, duration_ms AS durationMs
         FROM meetings WHERE id = ?`
      )
      .get(id) as Meeting | undefined
    return row ?? null
  }

  listMeetings(limit: number, offset: number): Meeting[] {
    return this.db
      .prepare(
        `SELECT id, title, started_at AS startedAt, ended_at AS endedAt,
                source_language AS sourceLanguage, target_language AS targetLanguage,
                status, segment_count AS segmentCount, duration_ms AS durationMs
         FROM meetings ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Meeting[]
  }

  updateTitle(id: string, title: string): void {
    this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?').run(title, id)
  }

  markMeetingEnded(id: string, endedAt: number, status: MeetingStatus): void {
    const row = this.db.prepare('SELECT started_at AS startedAt FROM meetings WHERE id = ?').get(id) as
      | { startedAt: number }
      | undefined
    if (!row) return
    const duration = endedAt - row.startedAt
    this.db
      .prepare('UPDATE meetings SET ended_at = ?, duration_ms = ?, status = ? WHERE id = ?')
      .run(endedAt, duration, status, id)
  }

  markMeetingStatus(id: string, status: MeetingStatus): void {
    this.db.prepare('UPDATE meetings SET status = ? WHERE id = ?').run(status, id)
  }

  findMeetingsByStatus(status: MeetingStatus): Meeting[] {
    return this.db
      .prepare(
        `SELECT id, title, started_at AS startedAt, ended_at AS endedAt,
                source_language AS sourceLanguage, target_language AS targetLanguage,
                status, segment_count AS segmentCount, duration_ms AS durationMs
         FROM meetings WHERE status = ? ORDER BY started_at DESC`
      )
      .all(status) as Meeting[]
  }

  deleteMeeting(id: string): void {
    this.db.prepare('DELETE FROM meetings WHERE id = ?').run(id)
  }

  insertSegment(s: Segment): void {
    this.db
      .prepare(
        `INSERT INTO segments(id, meeting_id, seq, created_at, speaker_id, speaker_label, source_text, translated_text, source_language)
         VALUES (@id, @meetingId, @seq, @createdAt, @speakerId, @speakerLabel, @sourceText, @translatedText, @sourceLanguage)`
      )
      .run(s)
  }

  getSegments(meetingId: string): Segment[] {
    return this.db
      .prepare(
        `SELECT id, meeting_id AS meetingId, seq, created_at AS createdAt,
                speaker_id AS speakerId, speaker_label AS speakerLabel,
                source_text AS sourceText, translated_text AS translatedText,
                source_language AS sourceLanguage
         FROM segments WHERE meeting_id = ? ORDER BY seq ASC`
      )
      .all(meetingId) as Segment[]
  }

  listSegmentsByMeeting(meetingId: string): Segment[] {
    return this.db
      .prepare(
        `SELECT id, meeting_id AS meetingId, seq, created_at AS createdAt,
                speaker_id AS speakerId, speaker_label AS speakerLabel,
                source_text AS sourceText, translated_text AS translatedText,
                source_language AS sourceLanguage
         FROM segments WHERE meeting_id = ?
         ORDER BY seq ASC, rowid ASC`
      )
      .all(meetingId) as Segment[]
  }

  nextSeq(meetingId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM segments WHERE meeting_id = ?')
      .get(meetingId) as { next: number }
    return row.next
  }

  incrementSegmentCount(meetingId: string): void {
    this.db.prepare('UPDATE meetings SET segment_count = segment_count + 1 WHERE id = ?').run(meetingId)
  }

  updateTranslation(segmentId: string, translated: string): void {
    this.db.prepare('UPDATE segments SET translated_text = ? WHERE id = ?').run(translated, segmentId)
  }

  upsertSummary(s: Summary): void {
    this.db
      .prepare(
        `INSERT INTO summaries(meeting_id, short_summary, detailed_summary, key_points,
                               action_items, generated_at, model, prompt_version, status)
         VALUES (@meetingId, @shortSummary, @detailedSummary, @keyPointsJson,
                 @actionItemsJson, @generatedAt, @model, @promptVersion, @status)
         ON CONFLICT(meeting_id) DO UPDATE SET
           short_summary = excluded.short_summary,
           detailed_summary = excluded.detailed_summary,
           key_points = excluded.key_points,
           action_items = excluded.action_items,
           generated_at = excluded.generated_at,
           model = excluded.model,
           prompt_version = excluded.prompt_version,
           status = excluded.status`
      )
      .run({
        ...s,
        keyPointsJson: JSON.stringify(s.keyPoints),
        actionItemsJson: JSON.stringify(s.actionItems),
      })
  }

  getSummary(meetingId: string): Summary | null {
    const row = this.db
      .prepare(
        `SELECT meeting_id AS meetingId, short_summary AS shortSummary, detailed_summary AS detailedSummary,
                key_points AS keyPointsJson, action_items AS actionItemsJson,
                generated_at AS generatedAt, model, prompt_version AS promptVersion, status
         FROM summaries WHERE meeting_id = ?`
      )
      .get(meetingId) as
      | (Omit<Summary, 'keyPoints' | 'actionItems'> & {
          keyPointsJson: string
          actionItemsJson: string
        })
      | undefined
    if (!row) return null
    return {
      meetingId: row.meetingId,
      shortSummary: row.shortSummary,
      detailedSummary: row.detailedSummary,
      keyPoints: JSON.parse(row.keyPointsJson) as string[],
      actionItems: JSON.parse(row.actionItemsJson) as Summary['actionItems'],
      generatedAt: row.generatedAt,
      model: row.model,
      promptVersion: row.promptVersion,
      status: row.status,
    }
  }

  saveEmbedding(segmentId: string, vector: Float32Array, model: string): void {
    const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
    this.db
      .prepare(
        `INSERT INTO segment_embeddings(segment_id, vector, model) VALUES (?, ?, ?)
         ON CONFLICT(segment_id) DO UPDATE SET vector = excluded.vector, model = excluded.model`
      )
      .run(segmentId, buf, model)
  }

  saveEmbeddings(rows: { segmentId: string; vector: Float32Array; model: string }[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO segment_embeddings(segment_id, vector, model) VALUES (?, ?, ?)
       ON CONFLICT(segment_id) DO UPDATE SET vector = excluded.vector, model = excluded.model`
    )
    const tx = this.db.transaction((items: typeof rows) => {
      for (const r of items) {
        stmt.run(r.segmentId, Buffer.from(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength), r.model)
      }
    })
    tx(rows)
  }

  getAllEmbeddings(): SegmentEmbedding[] {
    const rows = this.db
      .prepare('SELECT segment_id AS segmentId, vector, model FROM segment_embeddings')
      .all() as { segmentId: string; vector: Buffer; model: string }[]
    return rows.map((r) => ({
      segmentId: r.segmentId,
      vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4).slice(),
      model: r.model,
    }))
  }

  getMissingEmbeddings(meetingId?: string): { segmentId: string; text: string }[] {
    const meetingFilter = meetingId ? ' AND s.meeting_id = ?' : ''
    const stmt = this.db.prepare(
      `SELECT s.id AS segmentId, s.source_text AS text
       FROM segments s LEFT JOIN segment_embeddings e ON e.segment_id = s.id
       WHERE e.segment_id IS NULL${meetingFilter}
       ORDER BY s.created_at ASC, s.seq ASC`
    )
    return (meetingId ? stmt.all(meetingId) : stmt.all()) as { segmentId: string; text: string }[]
  }

  searchByText(query: string, limit: number): { segmentId: string; score: number }[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const escaped = trimmed.replace(/[\\%_]/g, (c) => '\\' + c)
    const pattern = `%${escaped}%`
    const rows = this.db
      .prepare(
        `SELECT id AS segmentId FROM segments
         WHERE source_text LIKE ? ESCAPE '\\'
            OR translated_text LIKE ? ESCAPE '\\'
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(pattern, pattern, limit) as { segmentId: string }[]
    return rows.map((r) => ({ segmentId: r.segmentId, score: 1 }))
  }

  searchMeetingTitlesByText(query: string, limit: number): SearchHit[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const escaped = trimmed.replace(/[\\%_]/g, (c) => '\\' + c)
    const pattern = `%${escaped}%`
    const rows = this.db
      .prepare(
        `SELECT id AS meetingId, title AS meetingTitle, started_at AS startedAt
         FROM meetings
         WHERE title LIKE ? ESCAPE '\\'
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(pattern, limit) as Array<{
      meetingId: string
      meetingTitle: string
      startedAt: number
    }>
    return rows.map(
      (r): SearchHit => ({
        kind: 'title',
        meetingId: r.meetingId,
        meetingTitle: r.meetingTitle,
        startedAt: r.startedAt,
        segmentId: null,
        seq: -1,
        speakerLabel: null,
        sourceText: r.meetingTitle,
        translatedText: null,
        score: 1,
      })
    )
  }

  searchSummariesByText(query: string, limit: number): SearchHit[] {
    const trimmed = query.trim()
    if (!trimmed) return []
    const escaped = trimmed.replace(/[\\%_]/g, (c) => '\\' + c)
    const pattern = `%${escaped}%`
    const lower = trimmed.toLowerCase()
    const rows = this.db
      .prepare(
        `SELECT m.id AS meetingId, m.title AS meetingTitle, m.started_at AS startedAt,
                s.short_summary AS shortSummary, s.detailed_summary AS detailedSummary,
                s.key_points AS keyPointsJson, s.action_items AS actionItemsJson
         FROM summaries s JOIN meetings m ON m.id = s.meeting_id
         WHERE s.status = 'ok' AND (
              s.short_summary LIKE ? ESCAPE '\\'
           OR s.detailed_summary LIKE ? ESCAPE '\\'
           OR s.key_points LIKE ? ESCAPE '\\'
           OR s.action_items LIKE ? ESCAPE '\\'
         )
         ORDER BY m.started_at DESC
         LIMIT ?`
      )
      .all(pattern, pattern, pattern, pattern, limit) as Array<{
      meetingId: string
      meetingTitle: string
      startedAt: number
      shortSummary: string
      detailedSummary: string
      keyPointsJson: string
      actionItemsJson: string
    }>

    return rows.map((r): SearchHit => {
      let matchedText = r.shortSummary
      const candidates: string[] = [r.shortSummary, r.detailedSummary]
      try {
        const kps = JSON.parse(r.keyPointsJson) as string[]
        candidates.push(...kps.filter((v): v is string => typeof v === 'string'))
      } catch {
        // ignore malformed JSON; fall back to summary candidates
      }
      try {
        const items = JSON.parse(r.actionItemsJson) as Array<{ text?: unknown }>
        for (const item of items) {
          if (item && typeof item.text === 'string') candidates.push(item.text)
        }
      } catch {
        // ignore malformed JSON
      }
      const hit = candidates.find((c) => c.toLowerCase().includes(lower))
      if (hit) matchedText = hit
      return {
        kind: 'summary',
        meetingId: r.meetingId,
        meetingTitle: r.meetingTitle,
        startedAt: r.startedAt,
        segmentId: null,
        seq: -1,
        speakerLabel: null,
        sourceText: matchedText,
        translatedText: null,
        score: 1,
      }
    })
  }

  lookupSearchHits(rows: { segmentId: string; score: number }[]): SearchHit[] {
    if (rows.length === 0) return []
    const placeholders = rows.map(() => '?').join(',')
    const found = this.db
      .prepare(
        `SELECT s.id AS segmentId, s.seq AS seq, s.speaker_label AS speakerLabel,
                s.source_text AS sourceText, s.translated_text AS translatedText,
                m.id AS meetingId, m.title AS meetingTitle, m.started_at AS startedAt
         FROM segments s JOIN meetings m ON m.id = s.meeting_id
         WHERE s.id IN (${placeholders})`
      )
      .all(...rows.map((r) => r.segmentId)) as Array<{
      segmentId: string
      seq: number
      speakerLabel: string | null
      sourceText: string
      translatedText: string | null
      meetingId: string
      meetingTitle: string
      startedAt: number
    }>
    const byId = new Map(found.map((f) => [f.segmentId, f]))
    const hits: SearchHit[] = []
    for (const row of rows) {
      const foundRow = byId.get(row.segmentId)
      if (!foundRow) continue
      hits.push({
        kind: 'segment',
        meetingId: foundRow.meetingId,
        meetingTitle: foundRow.meetingTitle,
        startedAt: foundRow.startedAt,
        segmentId: foundRow.segmentId,
        seq: foundRow.seq,
        speakerLabel: foundRow.speakerLabel,
        sourceText: foundRow.sourceText,
        translatedText: foundRow.translatedText,
        score: row.score,
      })
    }
    return hits
  }

  upsertGlossary(input: GlossaryEntryInput): GlossaryEntry {
    const term = input.sourceTerm.trim()
    if (!term) throw new Error('sourceTerm must not be empty')
    if (term.length > 100) throw new Error('sourceTerm must be <= 100 chars')
    for (const [lang, val] of Object.entries(input.translations)) {
      if (!lang || lang.length > 20) {
        throw new Error(`translations key must be a non-empty string <= 20 chars`)
      }
      if (typeof val !== 'string' || val.length > 100) {
        throw new Error(`translations[${lang}] must be a string <= 100 chars`)
      }
    }
    if (input.note != null && input.note.length > 500) {
      throw new Error('note must be <= 500 chars')
    }
    if (input.scope === 'meeting' && !input.meetingId) {
      throw new Error('meeting-scope entries require a meetingId')
    }
    if (input.scope === 'global' && input.meetingId) {
      throw new Error('global-scope entries must not have a meetingId')
    }

    const now = Date.now()

    if (input.id) {
      const existing = this.db
        .prepare('SELECT created_at AS createdAt FROM glossary_entries WHERE id = ?')
        .get(input.id) as { createdAt: number } | undefined
      if (!existing) throw new Error(`glossary entry not found: ${input.id}`)
      this.db
        .prepare(
          `UPDATE glossary_entries
           SET scope = ?, meeting_id = ?, source_term = ?,
               translations = ?, preserve = ?, note = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.scope,
          input.meetingId,
          term,
          JSON.stringify(input.translations),
          input.preserve ? 1 : 0,
          input.note,
          now,
          input.id
        )
      return this.getGlossaryEntry(input.id)!
    }

    const dup = this.db
      .prepare(
        `SELECT id FROM glossary_entries
         WHERE scope = ?
           AND (meeting_id IS ? OR meeting_id = ?)
           AND LOWER(source_term) = LOWER(?)
         LIMIT 1`
      )
      .get(input.scope, input.meetingId, input.meetingId, term) as { id: string } | undefined
    if (dup) throw new Error(`duplicate glossary entry exists for "${term}"`)

    const id = `gloss_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare(
        `INSERT INTO glossary_entries
         (id, scope, meeting_id, source_term, translations, preserve, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.scope,
        input.meetingId,
        term,
        JSON.stringify(input.translations),
        input.preserve ? 1 : 0,
        input.note,
        now,
        now
      )
    return this.getGlossaryEntry(id)!
  }

  listGlossary(scope: 'global' | 'meeting', meetingId?: string): GlossaryEntry[] {
    let rows: Array<
      Omit<GlossaryEntry, 'translations' | 'preserve'> & {
        translations: string
        preserve: number
      }
    >
    if (scope === 'global') {
      rows = this.db
        .prepare(
          `SELECT id, scope, meeting_id AS meetingId, source_term AS sourceTerm,
                  translations, preserve, note,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM glossary_entries
           WHERE scope = 'global'
           ORDER BY updated_at DESC, rowid DESC`
        )
        .all() as typeof rows
    } else {
      if (!meetingId) return []
      rows = this.db
        .prepare(
          `SELECT id, scope, meeting_id AS meetingId, source_term AS sourceTerm,
                  translations, preserve, note,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM glossary_entries
           WHERE scope = 'meeting' AND meeting_id = ?
           ORDER BY updated_at DESC, rowid DESC`
        )
        .all(meetingId) as typeof rows
    }
    return rows.map((r) => ({
      ...r,
      translations: JSON.parse(r.translations) as Record<string, string>,
      preserve: r.preserve === 1,
    }))
  }

  deleteGlossary(id: string): void {
    this.db.prepare('DELETE FROM glossary_entries WHERE id = ?').run(id)
  }

  activeGlossary(meetingId: string | null): GlossaryEntry[] {
    let rows: Array<
      Omit<GlossaryEntry, 'translations' | 'preserve'> & {
        translations: string
        preserve: number
      }
    >
    if (meetingId) {
      rows = this.db
        .prepare(
          `SELECT id, scope, meeting_id AS meetingId, source_term AS sourceTerm,
                  translations, preserve, note,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM glossary_entries
           WHERE scope = 'global'
              OR (scope = 'meeting' AND meeting_id = ?)
           ORDER BY scope ASC, updated_at DESC, rowid DESC`
        )
        .all(meetingId) as typeof rows
    } else {
      rows = this.db
        .prepare(
          `SELECT id, scope, meeting_id AS meetingId, source_term AS sourceTerm,
                  translations, preserve, note,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM glossary_entries
           WHERE scope = 'global'
           ORDER BY updated_at DESC, rowid DESC`
        )
        .all() as typeof rows
    }
    const parsed: GlossaryEntry[] = rows.map((r) => ({
      ...r,
      translations: JSON.parse(r.translations) as Record<string, string>,
      preserve: r.preserve === 1,
    }))
    // 'global' < 'meeting' alphabetically, so meeting rows come last and overwrite globals.
    const byKey = new Map<string, GlossaryEntry>()
    for (const e of parsed) byKey.set(e.sourceTerm.toLowerCase(), e)
    return Array.from(byKey.values())
  }

  getGlossaryEntry(id: string): GlossaryEntry | null {
    const row = this.db
      .prepare(
        `SELECT id, scope, meeting_id AS meetingId, source_term AS sourceTerm,
                translations, preserve, note,
                created_at AS createdAt, updated_at AS updatedAt
         FROM glossary_entries WHERE id = ?`
      )
      .get(id) as
      | (Omit<GlossaryEntry, 'translations' | 'preserve'> & {
          translations: string
          preserve: number
        })
      | undefined
    if (!row) return null
    return {
      ...row,
      translations: JSON.parse(row.translations) as Record<string, string>,
      preserve: row.preserve === 1,
    }
  }

  upsertSuggestion(input: GlossarySuggestionInput): GlossarySuggestion {
    const term = input.sourceTerm.trim()
    if (!term) throw new Error('sourceTerm must not be empty')
    if (term.length > 100) throw new Error('sourceTerm must be <= 100 chars')
    if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) {
      throw new Error('confidence must be in [0, 1]')
    }
    for (const v of input.variants) {
      if (typeof v !== 'string' || v.length === 0 || v.length > 100) {
        throw new Error('variants entries must be non-empty strings <= 100 chars')
      }
    }
    for (const [lang, val] of Object.entries(input.translations)) {
      if (!lang || lang.length > 20) {
        throw new Error('translations key must be non-empty <= 20 chars')
      }
      if (typeof val !== 'string' || val.length > 100) {
        throw new Error(`translations[${lang}] must be a string <= 100 chars`)
      }
    }
    const now = Date.now()
    const id = input.id ?? `sugg_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare(
        `INSERT OR REPLACE INTO glossary_suggestions
         (id, meeting_id, source_term, translations, preserve, confidence, reason, frequency, variants, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.meetingId,
        term,
        JSON.stringify(input.translations),
        input.preserve ? 1 : 0,
        input.confidence,
        input.reason,
        input.frequency,
        JSON.stringify(input.variants),
        now
      )
    return this.getSuggestion(id)!
  }

  getSuggestion(id: string): GlossarySuggestion | null {
    const row = this.db
      .prepare(
        `SELECT id, meeting_id AS meetingId, source_term AS sourceTerm,
                translations, preserve, confidence, reason, frequency, variants,
                created_at AS createdAt
         FROM glossary_suggestions WHERE id = ?`
      )
      .get(id) as
      | (Omit<GlossarySuggestion, 'translations' | 'preserve' | 'variants'> & {
          translations: string
          preserve: number
          variants: string
        })
      | undefined
    if (!row) return null
    return {
      ...row,
      translations: JSON.parse(row.translations) as Record<string, string>,
      preserve: row.preserve === 1,
      variants: JSON.parse(row.variants) as string[],
    }
  }

  listSuggestionsByMeeting(meetingId: string): GlossarySuggestion[] {
    const rows = this.db
      .prepare(
        `SELECT id, meeting_id AS meetingId, source_term AS sourceTerm,
                translations, preserve, confidence, reason, frequency, variants,
                created_at AS createdAt
         FROM glossary_suggestions WHERE meeting_id = ?
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(meetingId) as Array<
      Omit<GlossarySuggestion, 'translations' | 'preserve' | 'variants'> & {
        translations: string
        preserve: number
        variants: string
      }
    >
    return rows.map((r) => ({
      ...r,
      translations: JSON.parse(r.translations) as Record<string, string>,
      preserve: r.preserve === 1,
      variants: JSON.parse(r.variants) as string[],
    }))
  }

  listAllPendingSuggestions(): GlossarySuggestion[] {
    const rows = this.db
      .prepare(
        `SELECT id, meeting_id AS meetingId, source_term AS sourceTerm,
                translations, preserve, confidence, reason, frequency, variants,
                created_at AS createdAt
         FROM glossary_suggestions
         ORDER BY created_at DESC, rowid DESC`
      )
      .all() as Array<
      Omit<GlossarySuggestion, 'translations' | 'preserve' | 'variants'> & {
        translations: string
        preserve: number
        variants: string
      }
    >
    return rows.map((r) => ({
      ...r,
      translations: JSON.parse(r.translations) as Record<string, string>,
      preserve: r.preserve === 1,
      variants: JSON.parse(r.variants) as string[],
    }))
  }

  countPendingSuggestions(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM glossary_suggestions')
      .get() as { n: number }
    return row.n
  }

  acceptSuggestion(id: string): GlossaryEntry {
    return this.db.transaction((suggestionId: string): GlossaryEntry => {
      const sugg = this.getSuggestion(suggestionId)
      if (!sugg) throw new Error(`suggestion not found: ${suggestionId}`)
      const entry = this.upsertGlossary({
        scope: 'global',
        meetingId: null,
        sourceTerm: sugg.sourceTerm,
        translations: sugg.translations,
        preserve: sugg.preserve,
        note: null,
      })
      this.backfillSegments(sugg.meetingId, entry, sugg.variants)
      this.db.prepare('DELETE FROM glossary_suggestions WHERE id = ?').run(suggestionId)
      return entry
    })(id)
  }

  dismissSuggestion(id: string): void {
    this.db.transaction((suggestionId: string) => {
      const sugg = this.getSuggestion(suggestionId)
      if (!sugg) return
      this.db
        .prepare(
          `INSERT INTO glossary_dismissed_terms (source_term, dismissed_at)
           VALUES (?, ?)
           ON CONFLICT(source_term) DO UPDATE SET dismissed_at = excluded.dismissed_at`
        )
        .run(sugg.sourceTerm, Date.now())
      this.db.prepare('DELETE FROM glossary_suggestions WHERE id = ?').run(suggestionId)
    })(id)
  }

  isDismissed(sourceTerm: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM glossary_dismissed_terms WHERE LOWER(source_term) = LOWER(?)')
      .get(sourceTerm)
    return row !== undefined
  }

  getDismissedAt(sourceTerm: string): number | null {
    const row = this.db
      .prepare(
        'SELECT dismissed_at AS dismissedAt FROM glossary_dismissed_terms WHERE LOWER(source_term) = LOWER(?)'
      )
      .get(sourceTerm) as { dismissedAt: number } | undefined
    return row?.dismissedAt ?? null
  }

  listDismissedTerms(limit = 200): string[] {
    const rows = this.db
      .prepare(
        'SELECT source_term AS sourceTerm FROM glossary_dismissed_terms ORDER BY dismissed_at DESC LIMIT ?'
      )
      .all(limit) as Array<{ sourceTerm: string }>
    return rows.map((r) => r.sourceTerm)
  }

  backfillSegments(meetingId: string, entry: GlossaryEntry, variants: string[]): number {
    void meetingId
    void entry
    void variants
    return 0
  }

  close(): void {
    this.db.close()
  }

  /** @internal exposed for sibling memory modules; do not use from outside src/main/memory */
  get raw(): Database.Database {
    return this.db
  }
}

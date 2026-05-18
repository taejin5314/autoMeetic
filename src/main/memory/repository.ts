import Database from 'better-sqlite3'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import type { Meeting, MeetingStatus, SearchHit, Segment, SegmentEmbedding, Summary } from './types'

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

  getMissingEmbeddings(): { segmentId: string; text: string }[] {
    return this.db
      .prepare(
        `SELECT s.id AS segmentId, s.source_text AS text
         FROM segments s LEFT JOIN segment_embeddings e ON e.segment_id = s.id
         WHERE e.segment_id IS NULL`
      )
      .all() as { segmentId: string; text: string }[]
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
    return rows
      .map((r) => {
        const f = byId.get(r.segmentId)
        if (!f) return null
        return {
          meetingId: f.meetingId,
          meetingTitle: f.meetingTitle,
          startedAt: f.startedAt,
          segmentId: f.segmentId,
          seq: f.seq,
          speakerLabel: f.speakerLabel,
          sourceText: f.sourceText,
          translatedText: f.translatedText,
          score: r.score,
        } satisfies SearchHit
      })
      .filter((h): h is SearchHit => h !== null)
  }

  close(): void {
    this.db.close()
  }

  /** @internal exposed for sibling memory modules; do not use from outside src/main/memory */
  get raw(): Database.Database {
    return this.db
  }
}

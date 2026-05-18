import Database from 'better-sqlite3'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import type { Meeting, MeetingStatus, Segment } from './types'

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

  close(): void {
    this.db.close()
  }

  /** @internal exposed for sibling memory modules; do not use from outside src/main/memory */
  get raw(): Database.Database {
    return this.db
  }
}

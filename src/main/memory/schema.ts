export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

CREATE TABLE IF NOT EXISTS meetings (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  source_language TEXT,
  target_language TEXT,
  status          TEXT NOT NULL CHECK (status IN ('live','completed','failed')),
  segment_count   INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);

CREATE TABLE IF NOT EXISTS segments (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  speaker_id      TEXT,
  speaker_label   TEXT,
  source_text     TEXT NOT NULL,
  translated_text TEXT,
  source_language TEXT
);
CREATE INDEX IF NOT EXISTS idx_segments_meeting_seq ON segments(meeting_id, seq);

CREATE TABLE IF NOT EXISTS summaries (
  meeting_id        TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  short_summary     TEXT NOT NULL,
  detailed_summary  TEXT NOT NULL,
  key_points        TEXT NOT NULL,
  action_items      TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ok','failed')) DEFAULT 'ok'
);

CREATE TABLE IF NOT EXISTS segment_embeddings (
  segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  vector     BLOB NOT NULL,
  model      TEXT NOT NULL
);
`

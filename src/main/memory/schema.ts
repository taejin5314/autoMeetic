export const SCHEMA_VERSION = 5

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

CREATE TABLE IF NOT EXISTS glossary_entries (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL CHECK (scope IN ('global', 'meeting')),
  meeting_id      TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  source_term     TEXT NOT NULL,
  translations    TEXT NOT NULL DEFAULT '{}',
  preserve        INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  variants        TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glossary_scope_meeting
  ON glossary_entries(scope, meeting_id);
CREATE INDEX IF NOT EXISTS idx_glossary_source
  ON glossary_entries(source_term COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS glossary_suggestions (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source_term     TEXT NOT NULL,
  translations    TEXT NOT NULL DEFAULT '{}',
  preserve        INTEGER NOT NULL DEFAULT 0,
  confidence      REAL NOT NULL,
  reason          TEXT,
  frequency       INTEGER,
  variants        TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glossary_suggestions_meeting
  ON glossary_suggestions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_glossary_suggestions_term
  ON glossary_suggestions(source_term COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS glossary_dismissed_terms (
  source_term     TEXT PRIMARY KEY COLLATE NOCASE,
  dismissed_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_failures (
  segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  attempts   INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  failed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embedding_failures_failed_at
  ON embedding_failures(failed_at DESC);
`

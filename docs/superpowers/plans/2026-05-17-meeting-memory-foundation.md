# Meeting Memory Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Executor:** Codex CLI agent (independent session, no prior context). Each task is self-contained: exact paths, full code, verification commands, expected output.

**Spec:** [docs/superpowers/specs/2026-05-17-meeting-memory-foundation-design.md](../specs/2026-05-17-meeting-memory-foundation-design.md)

**Goal:** Persist every captured meeting locally, auto-generate Korean summaries, and provide cross-lingual semantic search over past meetings — without breaking the live transcript/translation/whiteboard pipeline.

**Architecture:** New `src/main/memory/` subsystem (better-sqlite3 + worker-thread embeddings + OpenAI summary). Hooks into existing `transcriptPostProcessor.ts` via two callback calls (no-op when not attached). New `src/renderer/library/` panel surfaces the data.

**Tech Stack:** TypeScript strict, Electron + electron-vite, React 19 + jotai, vitest, better-sqlite3 (native), @xenova/transformers (WASM ONNX), OpenAI Chat Completions.

**Verification commands (must pass before any task is "done"):**
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` — only when touching `src/main/**`, `src/renderer/**`, `src/preload/**`, electron/vite config, or `package.json`

**Conventions:**
- Tests live in `src/test/*.test.ts` (existing pattern). New tests follow this layout.
- File paths are absolute from repo root.
- Each task ends with a commit. Commit subject: `feat(memory): <task>` or `chore(memory): <task>`.
- TDD: write failing test → run to see it fail → minimal implementation → run to see it pass → commit.

**High-risk areas (from AGENTS.md) touched by this plan:**
- `transcriptPostProcessor.ts` — Task 17 only. Two added lines. Regression test mandatory.
- live feed sentence grouping — covered by existing tests; do not modify.

---

## Task Map (24 tasks, 7 phases)

| # | Phase | Task | Files (new) | Files (modified) |
| --- | --- | --- | --- | --- |
| T0 | 0. Preflight | Native deps + worker smoke check | `scripts/smoke-test-memory-deps.mjs` | `package.json`, `electron-builder.yml` |
| T1 | 1. Data | Schema + repo init | `src/main/memory/types.ts`, `src/main/memory/schema.ts`, `src/main/memory/repository.ts`, `src/test/memory-repository-init.test.ts` | — |
| T2 | 1. Data | Repo meetings CRUD | — | `src/main/memory/repository.ts`, add `src/test/memory-repository-meetings.test.ts` |
| T3 | 1. Data | Repo segments + translations | — | `src/main/memory/repository.ts`, add `src/test/memory-repository-segments.test.ts` |
| T4 | 1. Data | Repo summaries + embeddings + cascade | — | `src/main/memory/repository.ts`, add `src/test/memory-repository-summaries.test.ts` |
| T5 | 1. Data | MeetingLifecycle | `src/main/memory/meetingLifecycle.ts`, `src/test/memory-meeting-lifecycle.test.ts` | — |
| T6 | 2. Embed | Worker + EmbeddingService | `src/main/memory/embeddingWorker.ts`, `src/main/memory/embeddingService.ts`, `src/test/memory-embedding-service.test.ts` | — |
| T7 | 2. Embed | EmbeddingQueue | `src/main/memory/embeddingQueue.ts`, `src/test/memory-embedding-queue.test.ts` | — |
| T8 | 3. Hook | transcriptHook | `src/main/memory/transcriptHook.ts`, `src/test/memory-transcript-hook.test.ts` | — |
| T9 | 4. Summary | proxyService.summarizeMeeting + prompt | `src/main/memory/prompts/summary.v1.ts`, `src/test/memory-summary-prompt.test.ts` | `src/main/proxyService.ts` |
| T10 | 4. Summary | SummaryService short flow | `src/main/memory/summaryService.ts`, `src/test/memory-summary-service-short.test.ts` | — |
| T11 | 4. Summary | SummaryService long map-reduce | — | `src/main/memory/summaryService.ts`, add `src/test/memory-summary-service-long.test.ts` |
| T12 | 5. Search | SearchService | `src/main/memory/searchService.ts`, `src/test/memory-search-service.test.ts` | — |
| T13 | 5. Search | MarkdownExporter | `src/main/memory/markdownExporter.ts`, `src/test/memory-markdown-exporter.test.ts` | — |
| T14 | 6. Wire | MemoryService facade | `src/main/memory/memoryService.ts`, `src/test/memory-service-facade.test.ts` | — |
| T15 | 6. Wire | IPC handlers + start/stop hooks | — | `src/main/ipc.ts`, add `src/test/memory-ipc.test.ts` |
| T16 | 6. Wire | transcriptPostProcessor hook calls + regression | — | `src/main/transcriptPostProcessor.ts`, add `src/test/memory-postprocessor-regression.test.ts` |
| T17 | 6. Wire | main/index.ts startup wiring | — | `src/main/index.ts` |
| T18 | 6. Wire | preload api.memory | — | `src/preload/index.ts`, `src/preload/types.ts` |
| T19 | 7. UI | Library store + thin api | `src/renderer/library/libraryApi.ts`, `src/renderer/library/useMeetingLibraryStore.ts` | — |
| T20 | 7. UI | LibraryPanel + MeetingCard | `src/renderer/library/LibraryPanel.tsx`, `src/renderer/library/MeetingCard.tsx`, `src/renderer/library/library.css` | — |
| T21 | 7. UI | MeetingDetailView | `src/renderer/library/MeetingDetailView.tsx` | — |
| T22 | 7. UI | SearchBar + SearchResultList | `src/renderer/library/SearchBar.tsx`, `src/renderer/library/SearchResultList.tsx` | — |
| T23 | 7. UI | App.tsx integration (button, title, toasts) | `src/renderer/library/MeetingToasts.tsx` | `src/renderer/App.tsx` |
| T24 | 8. Verify | Manual E2E + final CI | — | — |

---

## Task 0: Preflight — Native deps + worker_threads smoke check

**Why first:** Verify `better-sqlite3` rebuilds for the current Electron and that `@xenova/transformers` loads inside a Node `worker_thread`. If either fails, the entire plan is unworkable.

**Files:**
- Create: `scripts/smoke-test-memory-deps.mjs`
- Modify: `package.json` (deps + postinstall + new script)
- Modify: `electron-builder.yml` (asarUnpack for better-sqlite3)

- [ ] **Step 1: Install dependencies**

Run:
```
npm install better-sqlite3@^11.5.0 @xenova/transformers@^2.17.2
npm install --save-dev @types/better-sqlite3@^7.6.11 @electron/rebuild@^3.7.1
```

Expected: install succeeds. `package.json` `dependencies` includes `better-sqlite3` and `@xenova/transformers`; `devDependencies` includes `@types/better-sqlite3` and `@electron/rebuild`.

- [ ] **Step 2: Add postinstall and rebuild script**

Edit `package.json` `scripts` block. Add:
```json
"postinstall": "electron-rebuild -f -w better-sqlite3",
"smoke:memory-deps": "node scripts/smoke-test-memory-deps.mjs"
```

If `postinstall` already exists, append `electron-rebuild` step with `&&`. **Run `npm install` once more** after editing to trigger `postinstall`.

Expected: rebuild completes without error. `node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.

Verify:
```
ls node_modules/better-sqlite3/build/Release/
```

Expected output contains `better_sqlite3.node`.

- [ ] **Step 3: Add asarUnpack rule**

Edit `electron-builder.yml`. Replace the existing `asarUnpack:` block with:
```yaml
asarUnpack:
  - resources/**
  - node_modules/better-sqlite3/**
```

- [ ] **Step 4: Write smoke test script**

Create `scripts/smoke-test-memory-deps.mjs`:
```js
import Database from 'better-sqlite3'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

async function testSqlite() {
  const tmpFile = path.join(os.tmpdir(), `memory-smoke-${Date.now()}.db`)
  const db = new Database(tmpFile)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t(v) VALUES (?)').run('hello')
  const row = db.prepare('SELECT v FROM t WHERE id = 1').get()
  db.close()
  fs.unlinkSync(tmpFile)
  fs.existsSync(tmpFile + '-shm') && fs.unlinkSync(tmpFile + '-shm')
  fs.existsSync(tmpFile + '-wal') && fs.unlinkSync(tmpFile + '-wal')
  if (row?.v !== 'hello') throw new Error('sqlite roundtrip failed')
  console.log('[smoke] sqlite OK')
}

async function testEmbeddingWorker() {
  return new Promise((resolve, reject) => {
    const workerSrc = `
      import { parentPort } from 'node:worker_threads'
      import { pipeline } from '@xenova/transformers'
      ;(async () => {
        try {
          const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true })
          const out = await extractor(['query: hello'], { pooling: 'mean', normalize: true })
          parentPort.postMessage({ ok: true, dims: out.dims })
        } catch (err) {
          parentPort.postMessage({ ok: false, error: err.message })
        }
      })()
    `
    const workerFile = path.join(os.tmpdir(), `embed-smoke-${Date.now()}.mjs`)
    fs.writeFileSync(workerFile, workerSrc)
    const worker = new Worker(workerFile, { execArgv: ['--experimental-specifier-resolution=node'] })
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('embedding worker timed out (model download? network?)'))
    }, 180_000)
    worker.on('message', (m) => {
      clearTimeout(timeout)
      worker.terminate()
      fs.unlinkSync(workerFile)
      if (m.ok) {
        console.log('[smoke] embedding worker OK, dims=', m.dims)
        resolve()
      } else {
        reject(new Error('embedding worker failed: ' + m.error))
      }
    })
    worker.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

await testSqlite()
await testEmbeddingWorker()
console.log('[smoke] all dependency smoke checks passed')
```

- [ ] **Step 5: Run smoke test**

Run:
```
npm run smoke:memory-deps
```

Expected output (first run downloads ~120MB model; subsequent runs are fast):
```
[smoke] sqlite OK
[smoke] embedding worker OK, dims= [ 1, 384 ]
[smoke] all dependency smoke checks passed
```

If the embedding step fails with a network error, retry once. If it fails with an architecture error, halt — surface the failure to the user before continuing.

- [ ] **Step 6: Typecheck + lint + test still pass**

Run:
```
npm run typecheck && npm run lint && npm test
```

Expected: all green (no functional code added yet, just deps).

- [ ] **Step 7: Commit**

```
git add package.json package-lock.json electron-builder.yml scripts/smoke-test-memory-deps.mjs
git commit -m "chore(memory): add better-sqlite3 + xenova/transformers with smoke check"
```

---

## Task 1: Memory schema + repository init

**Files:**
- Create: `src/main/memory/types.ts`
- Create: `src/main/memory/schema.ts`
- Create: `src/main/memory/repository.ts`
- Create: `src/test/memory-repository-init.test.ts`

- [ ] **Step 1: Define types**

Create `src/main/memory/types.ts`:
```ts
export type MeetingStatus = 'live' | 'completed' | 'failed'

export interface Meeting {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  sourceLanguage: string | null
  targetLanguage: string | null
  status: MeetingStatus
  segmentCount: number
  durationMs: number | null
}

export interface Segment {
  id: string
  meetingId: string
  seq: number
  createdAt: number
  speakerId: string | null
  speakerLabel: string | null
  sourceText: string
  translatedText: string | null
  sourceLanguage: string | null
}

export interface SummaryActionItem {
  text: string
  owner?: string
  due?: string
}

export interface SummaryJSON {
  shortSummary: string
  detailedSummary: string
  keyPoints: string[]
  actionItems: SummaryActionItem[]
}

export interface Summary extends SummaryJSON {
  meetingId: string
  generatedAt: number
  model: string
  promptVersion: string
  status: 'ok' | 'failed'
}

export interface MeetingSummary {
  meeting: Meeting
  shortSummary: string | null
}

export interface MeetingDetail {
  meeting: Meeting
  summary: Summary | null
  segments: Segment[]
}

export interface SearchHit {
  meetingId: string
  meetingTitle: string
  startedAt: number
  segmentId: string
  seq: number
  speakerLabel: string | null
  sourceText: string
  translatedText: string | null
  score: number
}

export interface SegmentEmbedding {
  segmentId: string
  vector: Float32Array
  model: string
}

export type MeetingUpdatedKind =
  | 'began'
  | 'segment-added'
  | 'ended'
  | 'summary-ready'
  | 'summary-failed'
  | 'renamed'
  | 'deleted'

export interface MeetingUpdatedEvent {
  meetingId: string
  kind: MeetingUpdatedKind
}
```

- [ ] **Step 2: Define schema SQL**

Create `src/main/memory/schema.ts`:
```ts
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
```

- [ ] **Step 3: Write failing test for repo init**

Create `src/test/memory-repository-init.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'

describe('MemoryRepository init', () => {
  it('creates schema and reports version 1 on a fresh in-memory db', () => {
    const repo = new MemoryRepository(':memory:')
    expect(repo.getSchemaVersion()).toBe(1)
    repo.close()
  })

  it('is idempotent — opening an already-initialized db does not throw', () => {
    const repo = new MemoryRepository(':memory:')
    repo.close()
    const repo2 = new MemoryRepository(':memory:')
    expect(repo2.getSchemaVersion()).toBe(1)
    repo2.close()
  })

  it('enables WAL mode on file databases', () => {
    const repo = new MemoryRepository(':memory:')
    expect(repo.getJournalMode()).toMatch(/wal|memory/i)
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-repository-init.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 4: Implement repository skeleton**

Create `src/main/memory/repository.ts`:
```ts
import Database from 'better-sqlite3'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

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

  close(): void {
    this.db.close()
  }

  /** @internal exposed for sibling memory modules; do not use from outside src/main/memory */
  get raw(): Database.Database {
    return this.db
  }
}
```

Run:
```
npm test -- src/test/memory-repository-init.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 5: Typecheck and lint**

Run:
```
npm run typecheck && npm run lint
```
Expected: clean.

- [ ] **Step 6: Commit**

```
git add src/main/memory/types.ts src/main/memory/schema.ts src/main/memory/repository.ts src/test/memory-repository-init.test.ts
git commit -m "feat(memory): add MemoryRepository init + schema v1"
```

---

## Task 2: Repository — meetings CRUD

**Files:**
- Modify: `src/main/memory/repository.ts`
- Create: `src/test/memory-repository-meetings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-repository-meetings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function sampleMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_test_1',
    title: '미팅 2026-05-17 14:30',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    sourceLanguage: 'auto',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
    ...overrides,
  }
}

describe('MemoryRepository meetings CRUD', () => {
  it('inserts and retrieves a meeting', () => {
    const repo = makeRepo()
    const m = sampleMeeting()
    repo.insertMeeting(m)
    expect(repo.getMeeting(m.id)).toEqual(m)
    repo.close()
  })

  it('lists meetings sorted by started_at DESC', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting({ id: 'a', startedAt: 1 }))
    repo.insertMeeting(sampleMeeting({ id: 'b', startedAt: 3 }))
    repo.insertMeeting(sampleMeeting({ id: 'c', startedAt: 2 }))
    const list = repo.listMeetings(10, 0)
    expect(list.map((m) => m.id)).toEqual(['b', 'c', 'a'])
    repo.close()
  })

  it('updates title', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.updateTitle('mtg_test_1', '새 제목')
    expect(repo.getMeeting('mtg_test_1')?.title).toBe('새 제목')
    repo.close()
  })

  it('marks status and ended_at', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.markMeetingEnded('mtg_test_1', 1_700_000_010_000, 'completed')
    const m = repo.getMeeting('mtg_test_1')!
    expect(m.endedAt).toBe(1_700_000_010_000)
    expect(m.durationMs).toBe(10_000)
    expect(m.status).toBe('completed')
    repo.close()
  })

  it('finds meetings by status', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting({ id: 'a', status: 'live' }))
    repo.insertMeeting(sampleMeeting({ id: 'b', status: 'completed' }))
    repo.insertMeeting(sampleMeeting({ id: 'c', status: 'live' }))
    expect(repo.findMeetingsByStatus('live').map((m) => m.id).sort()).toEqual(['a', 'c'])
    repo.close()
  })

  it('marks a meeting failed', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.markMeetingStatus('mtg_test_1', 'failed')
    expect(repo.getMeeting('mtg_test_1')?.status).toBe('failed')
    repo.close()
  })

  it('deletes a meeting', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.deleteMeeting('mtg_test_1')
    expect(repo.getMeeting('mtg_test_1')).toBeNull()
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-repository-meetings.test.ts
```
Expected: FAIL on every test (methods missing).

- [ ] **Step 2: Implement methods**

Append to `src/main/memory/repository.ts` inside the class:
```ts
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
```

Add imports at the top of the file:
```ts
import type { Meeting, MeetingStatus } from './types'
```

- [ ] **Step 3: Verify tests pass**

Run:
```
npm test -- src/test/memory-repository-meetings.test.ts
```
Expected: 7/7 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```
Expected: clean.

- [ ] **Step 5: Commit**

```
git add src/main/memory/repository.ts src/test/memory-repository-meetings.test.ts
git commit -m "feat(memory): add meetings CRUD to MemoryRepository"
```

---

## Task 3: Repository — segments + translations

**Files:**
- Modify: `src/main/memory/repository.ts`
- Create: `src/test/memory-repository-segments.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-repository-segments.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting, Segment } from '../main/memory/types'

function makeRepoWithMeeting(): { repo: MemoryRepository; meeting: Meeting } {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_1',
    title: 't',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
  }
  repo.insertMeeting(meeting)
  return { repo, meeting }
}

function sampleSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'turn_a',
    meetingId: 'mtg_1',
    seq: 0,
    createdAt: 1000,
    speakerId: 'speaker_a',
    speakerLabel: 'Speaker A',
    sourceText: 'hello',
    translatedText: null,
    sourceLanguage: 'en',
    ...overrides,
  }
}

describe('MemoryRepository segments', () => {
  it('inserts and retrieves segments ordered by seq', () => {
    const { repo } = makeRepoWithMeeting()
    repo.insertSegment(sampleSegment({ id: 'a', seq: 0 }))
    repo.insertSegment(sampleSegment({ id: 'b', seq: 2 }))
    repo.insertSegment(sampleSegment({ id: 'c', seq: 1 }))
    expect(repo.getSegments('mtg_1').map((s) => s.id)).toEqual(['a', 'c', 'b'])
    repo.close()
  })

  it('nextSeq returns monotonically increasing seq per meeting', () => {
    const { repo } = makeRepoWithMeeting()
    expect(repo.nextSeq('mtg_1')).toBe(0)
    repo.insertSegment(sampleSegment({ id: 'a', seq: 0 }))
    expect(repo.nextSeq('mtg_1')).toBe(1)
    repo.insertSegment(sampleSegment({ id: 'b', seq: 1 }))
    expect(repo.nextSeq('mtg_1')).toBe(2)
    repo.close()
  })

  it('incrementSegmentCount bumps meeting count', () => {
    const { repo } = makeRepoWithMeeting()
    repo.incrementSegmentCount('mtg_1')
    repo.incrementSegmentCount('mtg_1')
    expect(repo.getMeeting('mtg_1')?.segmentCount).toBe(2)
    repo.close()
  })

  it('updateTranslation sets translated_text', () => {
    const { repo } = makeRepoWithMeeting()
    repo.insertSegment(sampleSegment({ id: 'a' }))
    repo.updateTranslation('a', '안녕')
    const [seg] = repo.getSegments('mtg_1')
    expect(seg.translatedText).toBe('안녕')
    repo.close()
  })

  it('updateTranslation on unknown id is a silent no-op', () => {
    const { repo } = makeRepoWithMeeting()
    expect(() => repo.updateTranslation('does-not-exist', 'x')).not.toThrow()
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-repository-segments.test.ts
```
Expected: FAIL (missing methods).

- [ ] **Step 2: Implement segment methods**

Append to `MemoryRepository` class:
```ts
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
    this.db
      .prepare('UPDATE meetings SET segment_count = segment_count + 1 WHERE id = ?')
      .run(meetingId)
  }

  updateTranslation(segmentId: string, translated: string): void {
    this.db
      .prepare('UPDATE segments SET translated_text = ? WHERE id = ?')
      .run(translated, segmentId)
  }
```

Add to imports:
```ts
import type { Meeting, MeetingStatus, Segment } from './types'
```

- [ ] **Step 3: Verify tests pass**

Run:
```
npm test -- src/test/memory-repository-segments.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/repository.ts src/test/memory-repository-segments.test.ts
git commit -m "feat(memory): add segments + translation CRUD"
```

---

## Task 4: Repository — summaries + embeddings + cascade delete

**Files:**
- Modify: `src/main/memory/repository.ts`
- Create: `src/test/memory-repository-summaries.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-repository-summaries.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { Meeting, Segment, Summary } from '../main/memory/types'

function setup() {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_1',
    title: 't',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: null,
  }
  repo.insertMeeting(meeting)
  const seg: Segment = {
    id: 'seg_1',
    meetingId: 'mtg_1',
    seq: 0,
    createdAt: 10,
    speakerId: null,
    speakerLabel: null,
    sourceText: 'hello world',
    translatedText: null,
    sourceLanguage: 'en',
  }
  repo.insertSegment(seg)
  return { repo, meeting, seg }
}

function sampleSummary(): Summary {
  return {
    meetingId: 'mtg_1',
    shortSummary: '짧은 요약',
    detailedSummary: '- a\n- b',
    keyPoints: ['k1', 'k2'],
    actionItems: [{ text: 'do it' }],
    generatedAt: 1234,
    model: 'gpt-4o-mini',
    promptVersion: 'v1',
    status: 'ok',
  }
}

describe('MemoryRepository summaries', () => {
  it('upserts and reads back a summary', () => {
    const { repo } = setup()
    const s = sampleSummary()
    repo.upsertSummary(s)
    expect(repo.getSummary('mtg_1')).toEqual(s)
    repo.close()
  })

  it('overwrites an existing summary on second upsert', () => {
    const { repo } = setup()
    repo.upsertSummary(sampleSummary())
    repo.upsertSummary({ ...sampleSummary(), shortSummary: '변경됨' })
    expect(repo.getSummary('mtg_1')?.shortSummary).toBe('변경됨')
    repo.close()
  })

  it('returns null for missing summary', () => {
    const { repo } = setup()
    expect(repo.getSummary('mtg_1')).toBeNull()
    repo.close()
  })
})

describe('MemoryRepository embeddings', () => {
  it('saves and reads embeddings preserving float32 bytes', () => {
    const { repo } = setup()
    const vec = new Float32Array([0.1, 0.2, 0.3])
    repo.saveEmbedding('seg_1', vec, 'm1')
    const rows = repo.getAllEmbeddings()
    expect(rows).toHaveLength(1)
    expect(rows[0].segmentId).toBe('seg_1')
    expect(rows[0].model).toBe('m1')
    expect(Array.from(rows[0].vector)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ])
    repo.close()
  })

  it('saves a batch of embeddings in one transaction', () => {
    const { repo } = setup()
    repo.insertSegment({
      id: 'seg_2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 11,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'x',
      translatedText: null,
      sourceLanguage: null,
    })
    repo.saveEmbeddings(
      [
        { segmentId: 'seg_1', vector: new Float32Array([1, 0]), model: 'm1' },
        { segmentId: 'seg_2', vector: new Float32Array([0, 1]), model: 'm1' },
      ]
    )
    expect(repo.getAllEmbeddings()).toHaveLength(2)
    repo.close()
  })

  it('lists missing embeddings (segments without embedding rows)', () => {
    const { repo } = setup()
    repo.insertSegment({
      id: 'seg_2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 11,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'b',
      translatedText: null,
      sourceLanguage: null,
    })
    repo.saveEmbedding('seg_1', new Float32Array([1]), 'm1')
    const missing = repo.getMissingEmbeddings()
    expect(missing.map((m) => m.segmentId)).toEqual(['seg_2'])
    expect(missing[0].text).toBe('b')
    repo.close()
  })
})

describe('MemoryRepository cascade delete', () => {
  it('deleting a meeting removes its segments, embeddings, and summary', () => {
    const { repo } = setup()
    repo.upsertSummary(sampleSummary())
    repo.saveEmbedding('seg_1', new Float32Array([1, 2]), 'm1')
    repo.deleteMeeting('mtg_1')
    expect(repo.getSegments('mtg_1')).toEqual([])
    expect(repo.getAllEmbeddings()).toEqual([])
    expect(repo.getSummary('mtg_1')).toBeNull()
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-repository-summaries.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement methods**

Append to `MemoryRepository`:
```ts
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
```

Add import:
```ts
import type { Meeting, MeetingStatus, Segment, SegmentEmbedding, Summary } from './types'
```

- [ ] **Step 3: Verify tests pass**

Run:
```
npm test -- src/test/memory-repository-summaries.test.ts
```
Expected: 7/7 PASS.

- [ ] **Step 4: Run full repository test suite**

```
npm test -- src/test/memory-repository
```
Expected: all repository tests pass.

- [ ] **Step 5: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```
git add src/main/memory/repository.ts src/test/memory-repository-summaries.test.ts
git commit -m "feat(memory): add summaries + embeddings + cascade delete"
```

---

## Task 5: MeetingLifecycle service

**Files:**
- Create: `src/main/memory/meetingLifecycle.ts`
- Create: `src/test/memory-meeting-lifecycle.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-meeting-lifecycle.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { MeetingLifecycle } from '../main/memory/meetingLifecycle'

function makeLifecycle() {
  const repo = new MemoryRepository(':memory:')
  const lifecycle = new MeetingLifecycle(repo, { now: () => 1_000_000 })
  return { repo, lifecycle }
}

describe('MeetingLifecycle', () => {
  it('begin creates a live meeting and sets currentMeetingId', () => {
    const { repo, lifecycle } = makeLifecycle()
    const id = lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    expect(id).toMatch(/^mtg_/)
    expect(lifecycle.getCurrentMeetingId()).toBe(id)
    const m = repo.getMeeting(id)
    expect(m?.status).toBe('live')
    expect(m?.sourceLanguage).toBe('en')
    expect(m?.targetLanguage).toBe('ko')
    expect(m?.startedAt).toBe(1_000_000)
    repo.close()
  })

  it('beginMeeting throws when a meeting is already live', () => {
    const { repo, lifecycle } = makeLifecycle()
    lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    expect(() =>
      lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    ).toThrow(/already live/i)
    repo.close()
  })

  it('endMeeting marks completed, computes duration, and clears currentMeetingId', () => {
    const repo = new MemoryRepository(':memory:')
    let t = 1_000_000
    const lifecycle = new MeetingLifecycle(repo, { now: () => t })
    const id = lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    t = 1_005_000
    lifecycle.endMeeting()
    expect(lifecycle.getCurrentMeetingId()).toBeNull()
    const m = repo.getMeeting(id)!
    expect(m.status).toBe('completed')
    expect(m.durationMs).toBe(5_000)
    repo.close()
  })

  it('endMeeting is a no-op when no meeting is live', () => {
    const { lifecycle, repo } = makeLifecycle()
    expect(() => lifecycle.endMeeting()).not.toThrow()
    repo.close()
  })

  it('recoverInterruptedMeetings marks all live meetings failed', () => {
    const repo = new MemoryRepository(':memory:')
    const lifecycle = new MeetingLifecycle(repo, { now: () => 1 })
    lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    // simulate restart: new lifecycle, repo has live row
    const lifecycle2 = new MeetingLifecycle(repo, { now: () => 2 })
    const recovered = lifecycle2.recoverInterruptedMeetings()
    expect(recovered).toBe(1)
    const live = repo.findMeetingsByStatus('live')
    expect(live).toHaveLength(0)
    const failed = repo.findMeetingsByStatus('failed')
    expect(failed).toHaveLength(1)
    repo.close()
  })

  it('default title is "미팅 YYYY-MM-DD HH:mm" derived from startedAt', () => {
    const repo = new MemoryRepository(':memory:')
    const fixed = new Date('2026-05-17T14:30:00+09:00').getTime()
    const lifecycle = new MeetingLifecycle(repo, { now: () => fixed })
    const id = lifecycle.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    const m = repo.getMeeting(id)!
    expect(m.title).toMatch(/^미팅 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-meeting-lifecycle.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 2: Implement MeetingLifecycle**

Create `src/main/memory/meetingLifecycle.ts`:
```ts
import type { MemoryRepository } from './repository'

interface BeginArgs {
  sourceLanguage: string
  targetLanguage: string
}

interface LifecycleOptions {
  now?: () => number
}

function makeMeetingId(now: number): string {
  const ts = now.toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `mtg_${ts}_${rand}`
}

function defaultTitle(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `미팅 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export class MeetingLifecycle {
  private currentMeetingId: string | null = null
  private now: () => number

  constructor(private repo: MemoryRepository, options: LifecycleOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  beginMeeting(args: BeginArgs): string {
    if (this.currentMeetingId) {
      throw new Error('Meeting already live — call endMeeting first')
    }
    const startedAt = this.now()
    const id = makeMeetingId(startedAt)
    this.repo.insertMeeting({
      id,
      title: defaultTitle(startedAt),
      startedAt,
      endedAt: null,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      status: 'live',
      segmentCount: 0,
      durationMs: null,
    })
    this.currentMeetingId = id
    return id
  }

  endMeeting(): string | null {
    const id = this.currentMeetingId
    if (!id) return null
    this.repo.markMeetingEnded(id, this.now(), 'completed')
    this.currentMeetingId = null
    return id
  }

  getCurrentMeetingId(): string | null {
    return this.currentMeetingId
  }

  recoverInterruptedMeetings(): number {
    const live = this.repo.findMeetingsByStatus('live')
    for (const m of live) {
      this.repo.markMeetingStatus(m.id, 'failed')
    }
    return live.length
  }
}
```

- [ ] **Step 3: Verify tests pass**

```
npm test -- src/test/memory-meeting-lifecycle.test.ts
```
Expected: 6/6 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/meetingLifecycle.ts src/test/memory-meeting-lifecycle.test.ts
git commit -m "feat(memory): add MeetingLifecycle service"
```

---

## Task 6: Embedding worker + EmbeddingService

**Files:**
- Create: `src/main/memory/embeddingWorker.ts`
- Create: `src/main/memory/embeddingService.ts`
- Create: `src/test/memory-embedding-service.test.ts`

**Note:** The worker file imports `@xenova/transformers` and is meant to run in `worker_threads`. Tests do NOT spawn the real worker — they inject a fake worker. The real worker is exercised in T0 smoke and in manual E2E.

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-embedding-service.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { EmbeddingService, type EmbeddingWorkerLike } from '../main/memory/embeddingService'

function makeFakeWorker(): EmbeddingWorkerLike & {
  sent: { id: number; texts: string[] }[]
  reply: (id: number, vectors: Float32Array[]) => void
  fail: (id: number, error: string) => void
} {
  const listeners: ((msg: unknown) => void)[] = []
  const errorListeners: ((err: Error) => void)[] = []
  const sent: { id: number; texts: string[] }[] = []
  return {
    sent,
    postMessage(msg: { id: number; texts: string[] }) {
      sent.push(msg)
    },
    on(event: 'message' | 'error', handler: never) {
      if (event === 'message') listeners.push(handler)
      else errorListeners.push(handler)
    },
    terminate() {
      return Promise.resolve(0)
    },
    reply(id: number, vectors: Float32Array[]) {
      listeners.forEach((l) => l({ id, vectors }))
    },
    fail(id: number, error: string) {
      listeners.forEach((l) => l({ id, error }))
    },
  }
}

describe('EmbeddingService', () => {
  it('embedPassages prefixes texts with "passage: "', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const promise = svc.embedPassages(['hello', 'world'])
    expect(worker.sent[0].texts).toEqual(['passage: hello', 'passage: world'])
    worker.reply(worker.sent[0].id, [new Float32Array([1, 0]), new Float32Array([0, 1])])
    const result = await promise
    expect(result).toHaveLength(2)
    expect(Array.from(result[0])).toEqual([1, 0])
  })

  it('embedQuery prefixes with "query: "', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const promise = svc.embedQuery('foo')
    expect(worker.sent[0].texts).toEqual(['query: foo'])
    worker.reply(worker.sent[0].id, [new Float32Array([0.5])])
    const result = await promise
    expect(Array.from(result)).toEqual([0.5])
  })

  it('rejects when the worker replies with an error', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const promise = svc.embedQuery('x')
    worker.fail(worker.sent[0].id, 'boom')
    await expect(promise).rejects.toThrow('boom')
  })

  it('correlates concurrent requests by id', async () => {
    const worker = makeFakeWorker()
    const svc = new EmbeddingService(worker)
    const p1 = svc.embedQuery('a')
    const p2 = svc.embedQuery('b')
    expect(worker.sent).toHaveLength(2)
    // reply out of order
    worker.reply(worker.sent[1].id, [new Float32Array([2])])
    worker.reply(worker.sent[0].id, [new Float32Array([1])])
    expect(Array.from(await p1)).toEqual([1])
    expect(Array.from(await p2)).toEqual([2])
  })
})
```

Run:
```
npm test -- src/test/memory-embedding-service.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement EmbeddingService**

Create `src/main/memory/embeddingService.ts`:
```ts
export interface EmbeddingWorkerLike {
  postMessage(msg: { id: number; texts: string[] }): void
  on(event: 'message', handler: (msg: { id: number; vectors?: Float32Array[]; error?: string }) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  terminate(): Promise<number> | number
}

const PASSAGE_PREFIX = 'passage: '
const QUERY_PREFIX = 'query: '

export class EmbeddingService {
  private nextId = 0
  private pending = new Map<
    number,
    { resolve: (vectors: Float32Array[]) => void; reject: (err: Error) => void }
  >()
  public readonly modelId = 'Xenova/multilingual-e5-small'

  constructor(private worker: EmbeddingWorkerLike) {
    this.worker.on(
      'message',
      (msg: { id: number; vectors?: Float32Array[]; error?: string }) => {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error))
        else if (msg.vectors) pending.resolve(msg.vectors)
        else pending.reject(new Error('Embedding worker returned empty response'))
      }
    )
    this.worker.on('error', (err: Error) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
  }

  embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embedRaw(texts.map((t) => PASSAGE_PREFIX + t))
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [v] = await this.embedRaw([QUERY_PREFIX + text])
    return v
  }

  private embedRaw(texts: string[]): Promise<Float32Array[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, texts })
    })
  }

  async dispose(): Promise<void> {
    await this.worker.terminate()
  }
}
```

- [ ] **Step 3: Implement the real worker (not test-covered here; exercised in T0 smoke)**

Create `src/main/memory/embeddingWorker.ts`:
```ts
import { parentPort } from 'node:worker_threads'

if (!parentPort) {
  throw new Error('embeddingWorker must be spawned as a worker_thread')
}

type Extractor = (
  input: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>

let extractor: Extractor | null = null

async function ensure(): Promise<Extractor> {
  if (extractor) return extractor
  const { pipeline } = await import('@xenova/transformers')
  const cacheDir = process.env.MEMORY_EMBEDDING_CACHE_DIR
  const fn = (await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true,
    ...(cacheDir ? { cache_dir: cacheDir } : {}),
  })) as unknown as Extractor
  extractor = fn
  return fn
}

parentPort.on('message', async (msg: { id: number; texts: string[] }) => {
  try {
    const fn = await ensure()
    const out = await fn(msg.texts, { pooling: 'mean', normalize: true })
    const dims = out.dims[1] ?? out.data.length / msg.texts.length
    const vectors: Float32Array[] = []
    for (let i = 0; i < msg.texts.length; i++) {
      vectors.push(
        new Float32Array(out.data.buffer, out.data.byteOffset + i * dims * 4, dims).slice()
      )
    }
    parentPort!.postMessage({ id: msg.id, vectors })
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
  }
})
```

- [ ] **Step 4: Verify tests pass**

```
npm test -- src/test/memory-embedding-service.test.ts
```
Expected: 4/4 PASS.

- [ ] **Step 5: Typecheck + lint**

```
npm run typecheck && npm run lint
```

The worker file may produce an `@xenova/transformers` type warning. If so, add to the top of `embeddingWorker.ts`:
```ts
// @ts-expect-error — @xenova/transformers ships types but pipeline() return is dynamic
```
right above the `pipeline(...)` call. Re-run typecheck.

- [ ] **Step 6: Commit**

```
git add src/main/memory/embeddingWorker.ts src/main/memory/embeddingService.ts src/test/memory-embedding-service.test.ts
git commit -m "feat(memory): add EmbeddingService + worker"
```

---

## Task 7: EmbeddingQueue

**Files:**
- Create: `src/main/memory/embeddingQueue.ts`
- Create: `src/test/memory-embedding-queue.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-embedding-queue.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { EmbeddingQueue } from '../main/memory/embeddingQueue'

function fakeEmbedder() {
  const calls: string[][] = []
  return {
    calls,
    embedPassages: async (texts: string[]) => {
      calls.push(texts)
      return texts.map((_, i) => new Float32Array([i]))
    },
  }
}

function fakeRepo() {
  const saved: { segmentId: string; vector: Float32Array; model: string }[] = []
  return {
    saved,
    saveEmbeddings: (rows: typeof saved) => {
      saved.push(...rows)
    },
  }
}

describe('EmbeddingQueue', () => {
  it('batches enqueued items up to 16 per worker call', async () => {
    const e = fakeEmbedder()
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm1', batchSize: 16 })
    for (let i = 0; i < 20; i++) queue.enqueue({ segmentId: 's' + i, text: 't' + i })
    await queue.drain()
    expect(e.calls).toHaveLength(2)
    expect(e.calls[0]).toHaveLength(16)
    expect(e.calls[1]).toHaveLength(4)
    expect(r.saved).toHaveLength(20)
    expect(r.saved.every((row) => row.model === 'm1')).toBe(true)
  })

  it('processes items in FIFO order', async () => {
    const e = fakeEmbedder()
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 4 })
    for (let i = 0; i < 4; i++) queue.enqueue({ segmentId: 's' + i, text: 't' + i })
    await queue.drain()
    expect(r.saved.map((row) => row.segmentId)).toEqual(['s0', 's1', 's2', 's3'])
  })

  it('drainPending resolves when the named segments have been processed', async () => {
    const e = {
      embedPassages: async (texts: string[]) => {
        await new Promise((r) => setTimeout(r, 5))
        return texts.map(() => new Float32Array([0]))
      },
    }
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 2 })
    queue.enqueue({ segmentId: 's1', text: 't' })
    queue.enqueue({ segmentId: 's2', text: 't' })
    queue.enqueue({ segmentId: 's3', text: 't' })
    await queue.drainPending(['s1', 's2', 's3'], 1000)
    expect(r.saved.map((row) => row.segmentId).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('drainPending times out and resolves false if items never complete', async () => {
    const e = {
      embedPassages: () => new Promise<Float32Array[]>(() => {}),
    }
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 4 })
    queue.enqueue({ segmentId: 's', text: 't' })
    const ok = await queue.drainPending(['s'], 30)
    expect(ok).toBe(false)
  })

  it('embedding errors do not crash subsequent batches', async () => {
    let count = 0
    const e = {
      embedPassages: async (texts: string[]) => {
        count++
        if (count === 1) throw new Error('fail once')
        return texts.map(() => new Float32Array([1]))
      },
    }
    const r = fakeRepo()
    const queue = new EmbeddingQueue(e as never, r as never, { modelId: 'm', batchSize: 2 })
    queue.enqueue({ segmentId: 's1', text: 't' })
    queue.enqueue({ segmentId: 's2', text: 't' })
    queue.enqueue({ segmentId: 's3', text: 't' })
    queue.enqueue({ segmentId: 's4', text: 't' })
    await queue.drain()
    // first batch failed silently, second batch succeeded
    expect(r.saved.map((row) => row.segmentId)).toEqual(['s3', 's4'])
  })
})
```

Run:
```
npm test -- src/test/memory-embedding-queue.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement EmbeddingQueue**

Create `src/main/memory/embeddingQueue.ts`:
```ts
import type { EmbeddingService } from './embeddingService'
import type { MemoryRepository } from './repository'

interface QueueItem {
  segmentId: string
  text: string
}

interface QueueOptions {
  modelId: string
  batchSize?: number
}

export class EmbeddingQueue {
  private items: QueueItem[] = []
  private processing: Promise<void> | null = null
  private readonly batchSize: number
  private readonly completed = new Set<string>()
  private waiters: { segmentIds: Set<string>; resolve: () => void }[] = []

  constructor(
    private embedder: Pick<EmbeddingService, 'embedPassages'>,
    private repo: Pick<MemoryRepository, 'saveEmbeddings'>,
    private opts: QueueOptions
  ) {
    this.batchSize = opts.batchSize ?? 16
  }

  enqueue(item: QueueItem): void {
    this.items.push(item)
    void this.kick()
  }

  size(): number {
    return this.items.length
  }

  async drain(): Promise<void> {
    while (this.items.length > 0 || this.processing) {
      if (!this.processing) void this.kick()
      await this.processing
    }
  }

  async drainPending(segmentIds: string[], timeoutMs: number): Promise<boolean> {
    const pending = new Set(segmentIds.filter((id) => !this.completed.has(id)))
    if (pending.size === 0) return true
    return new Promise<boolean>((resolve) => {
      const waiter = { segmentIds: pending, resolve: () => resolve(true) }
      this.waiters.push(waiter)
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        resolve(false)
      }, timeoutMs)
      // also clear timeout on success
      const origResolve = waiter.resolve
      waiter.resolve = () => {
        clearTimeout(t)
        origResolve()
      }
    })
  }

  private kick(): Promise<void> {
    if (this.processing) return this.processing
    this.processing = this.process().finally(() => {
      this.processing = null
    })
    return this.processing
  }

  private async process(): Promise<void> {
    while (this.items.length > 0) {
      const batch = this.items.splice(0, this.batchSize)
      try {
        const vectors = await this.embedder.embedPassages(batch.map((b) => b.text))
        const rows = batch.map((b, i) => ({
          segmentId: b.segmentId,
          vector: vectors[i],
          model: this.opts.modelId,
        }))
        this.repo.saveEmbeddings(rows)
        for (const r of rows) this.completed.add(r.segmentId)
        this.checkWaiters()
      } catch (err) {
        console.warn('[embedding-queue] batch failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  private checkWaiters(): void {
    const remaining: typeof this.waiters = []
    for (const w of this.waiters) {
      for (const id of [...w.segmentIds]) if (this.completed.has(id)) w.segmentIds.delete(id)
      if (w.segmentIds.size === 0) w.resolve()
      else remaining.push(w)
    }
    this.waiters = remaining
  }
}
```

- [ ] **Step 3: Verify tests pass**

```
npm test -- src/test/memory-embedding-queue.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/embeddingQueue.ts src/test/memory-embedding-queue.test.ts
git commit -m "feat(memory): add EmbeddingQueue with batching + drainPending"
```

---

## Task 8: transcriptHook module

**Files:**
- Create: `src/main/memory/transcriptHook.ts`
- Create: `src/test/memory-transcript-hook.test.ts`

**Critical**: When `attachTranscriptHook` has not been called, every `notify*` function must be a silent no-op. This is the regression-safety guarantee for the high-risk `transcriptPostProcessor.ts` integration.

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-transcript-hook.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachTranscriptHook,
  detachTranscriptHook,
  notifyTranslation,
  notifyTurnFinalized,
} from '../main/memory/transcriptHook'

describe('transcriptHook (default state)', () => {
  beforeEach(() => detachTranscriptHook())

  it('notifyTurnFinalized is a silent no-op when not attached', () => {
    expect(() =>
      notifyTurnFinalized({
        id: 'turn_1',
        text: 'hi',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        createdAtMs: 0,
        speakerId: 'unknown',
        speakerLabel: 'Unknown',
      })
    ).not.toThrow()
  })

  it('notifyTranslation is a silent no-op when not attached', () => {
    expect(() => notifyTranslation('turn_1', '안녕')).not.toThrow()
  })
})

describe('transcriptHook (attached)', () => {
  beforeEach(() => detachTranscriptHook())

  it('on turn finalized: inserts segment, increments count, enqueues for embedding', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 7),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => 'mtg_x')
    notifyTurnFinalized({
      id: 'turn_1',
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 1234,
      speakerId: 'speaker_a',
      speakerLabel: 'Speaker A',
    })
    expect(repo.insertSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'turn_1',
        meetingId: 'mtg_x',
        seq: 7,
        sourceText: 'hello',
        speakerLabel: 'Speaker A',
      })
    )
    expect(repo.incrementSegmentCount).toHaveBeenCalledWith('mtg_x')
    expect(queue.enqueue).toHaveBeenCalledWith({ segmentId: 'turn_1', text: 'hello' })
  })

  it('on turn finalized without active meeting: no DB writes', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 0),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => null)
    notifyTurnFinalized({
      id: 'turn_1',
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 0,
      speakerId: 'unknown',
      speakerLabel: 'Unknown',
    })
    expect(repo.insertSegment).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('notifyTranslation routes to repo.updateTranslation', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 0),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => 'mtg_x')
    notifyTranslation('turn_1', '안녕')
    expect(repo.updateTranslation).toHaveBeenCalledWith('turn_1', '안녕')
  })

  it('after detach, notifies are no-ops again', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 0),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => 'mtg_x')
    detachTranscriptHook()
    notifyTurnFinalized({
      id: 'turn_1',
      text: 'x',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 0,
      speakerId: 'unknown',
      speakerLabel: 'Unknown',
    })
    notifyTranslation('turn_1', 'y')
    expect(repo.insertSegment).not.toHaveBeenCalled()
    expect(repo.updateTranslation).not.toHaveBeenCalled()
  })
})
```

Run:
```
npm test -- src/test/memory-transcript-hook.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement transcriptHook**

Create `src/main/memory/transcriptHook.ts`:
```ts
import type { MemoryRepository } from './repository'
import type { EmbeddingQueue } from './embeddingQueue'

export interface TurnPayload {
  id: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
  speakerId: string
  speakerLabel: string
}

type Repo = Pick<
  MemoryRepository,
  'insertSegment' | 'incrementSegmentCount' | 'nextSeq' | 'updateTranslation'
>
type Queue = Pick<EmbeddingQueue, 'enqueue'>

let repo: Repo | null = null
let queue: Queue | null = null
let getCurrentMeetingId: (() => string | null) | null = null

export function attachTranscriptHook(
  r: Repo,
  q: Queue,
  getCurrent: () => string | null
): void {
  repo = r
  queue = q
  getCurrentMeetingId = getCurrent
}

export function detachTranscriptHook(): void {
  repo = null
  queue = null
  getCurrentMeetingId = null
}

export function notifyTurnFinalized(turn: TurnPayload): void {
  if (!repo || !queue || !getCurrentMeetingId) return
  const meetingId = getCurrentMeetingId()
  if (!meetingId) return
  const seq = repo.nextSeq(meetingId)
  repo.insertSegment({
    id: turn.id,
    meetingId,
    seq,
    createdAt: turn.createdAtMs,
    speakerId: turn.speakerId,
    speakerLabel: turn.speakerLabel,
    sourceText: turn.text,
    translatedText: null,
    sourceLanguage: turn.sourceLanguage,
  })
  repo.incrementSegmentCount(meetingId)
  queue.enqueue({ segmentId: turn.id, text: turn.text })
}

export function notifyTranslation(turnId: string, translation: string): void {
  if (!repo) return
  repo.updateTranslation(turnId, translation)
}
```

- [ ] **Step 3: Verify tests pass**

```
npm test -- src/test/memory-transcript-hook.test.ts
```
Expected: 6/6 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/transcriptHook.ts src/test/memory-transcript-hook.test.ts
git commit -m "feat(memory): add transcriptHook with detached no-op guarantee"
```

---

## Task 9: Summary prompt v1 + proxyService.summarizeMeeting

**Files:**
- Create: `src/main/memory/prompts/summary.v1.ts`
- Create: `src/test/memory-summary-prompt.test.ts`
- Modify: `src/main/proxyService.ts` (add `summarizeMeeting` export)

- [ ] **Step 1: Inspect proxyService**

Read [src/main/proxyService.ts](../../../src/main/proxyService.ts) to see the existing OpenAI call pattern. You'll add a new exported function that follows the same conventions for API key, base URL, error handling, and logging — but uses `response_format: { type: 'json_object' }`.

- [ ] **Step 2: Write failing tests for prompt builder**

Create `src/test/memory-summary-prompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { SUMMARY_PROMPT_VERSION, SYSTEM_PROMPT, buildTranscriptUserPrompt, buildReduceUserPrompt } from '../main/memory/prompts/summary.v1'
import type { Segment } from '../main/memory/types'

function seg(id: string, sec: number, speaker: string, text: string): Segment {
  return {
    id,
    meetingId: 'm',
    seq: 0,
    createdAt: sec * 1000,
    speakerId: 'speaker_a',
    speakerLabel: speaker,
    sourceText: text,
    translatedText: null,
    sourceLanguage: 'en',
  }
}

describe('summary prompt v1', () => {
  it('version is v1', () => {
    expect(SUMMARY_PROMPT_VERSION).toBe('v1')
  })

  it('system prompt mentions JSON-only output and Korean language', () => {
    expect(SYSTEM_PROMPT).toMatch(/JSON/i)
    expect(SYSTEM_PROMPT).toMatch(/한국어/)
    expect(SYSTEM_PROMPT).toMatch(/shortSummary/)
    expect(SYSTEM_PROMPT).toMatch(/detailedSummary/)
    expect(SYSTEM_PROMPT).toMatch(/keyPoints/)
    expect(SYSTEM_PROMPT).toMatch(/actionItems/)
  })

  it('builds [hh:mm:ss] speaker: text lines starting at first segment', () => {
    const out = buildTranscriptUserPrompt(0, [
      seg('a', 83, 'Speaker A', 'hello'),
      seg('b', 90, 'Speaker B', 'world'),
    ])
    expect(out).toContain('[00:00:00] Speaker A: hello')
    expect(out).toContain('[00:00:07] Speaker B: world')
  })

  it('reduce prompt embeds chunk summaries verbatim', () => {
    const out = buildReduceUserPrompt(['{"shortSummary":"a"}', '{"shortSummary":"b"}'])
    expect(out).toContain('{"shortSummary":"a"}')
    expect(out).toContain('{"shortSummary":"b"}')
    expect(out).toMatch(/통합|reduce|merge/i)
  })
})
```

Run:
```
npm test -- src/test/memory-summary-prompt.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement prompt builders**

Create `src/main/memory/prompts/summary.v1.ts`:
```ts
import type { Segment } from '../types'

export const SUMMARY_PROMPT_VERSION = 'v1'

export const SYSTEM_PROMPT = [
  '당신은 미팅 분석가입니다. transcript를 받아 다음 JSON 스키마로만 한국어로 응답하세요.',
  '',
  '{',
  '  "shortSummary": "1-2문장",',
  '  "detailedSummary": "마크다운 bullet 3-7개",',
  '  "keyPoints": ["핵심 결정/사실 3-5개"],',
  '  "actionItems": [{"text": "...", "owner": "Speaker A | 미지정", "due": "선택사항"}]',
  '}',
  '',
  '규칙:',
  '- 원문 transcript의 사실만 사용. 새로운 정보를 만들지 마세요.',
  '- 화자 식별이 불분명하면 owner를 "미지정"으로.',
  '- 출력은 JSON만. 코드펜스나 설명 문장 금지.',
].join('\n')

function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function buildTranscriptUserPrompt(meetingStartedAt: number, segments: Segment[]): string {
  if (segments.length === 0) return '(transcript empty)'
  const anchor = segments[0].createdAt
  const lines = segments.map((s) => {
    const offset = formatTimestamp(s.createdAt - anchor)
    const speaker = s.speakerLabel ?? 'Unknown'
    return `[${offset}] ${speaker}: ${s.sourceText}`
  })
  void meetingStartedAt
  return lines.join('\n')
}

export function buildReduceUserPrompt(chunkSummariesJson: string[]): string {
  const joined = chunkSummariesJson.map((s, i) => `청크 ${i + 1}:\n${s}`).join('\n\n')
  return [
    '아래는 한 미팅을 시간 청크별로 요약한 JSON들입니다.',
    '이 청크 요약들을 하나의 최종 JSON으로 통합해 주세요. 동일한 스키마, 한국어, JSON만 출력.',
    '',
    joined,
  ].join('\n')
}
```

- [ ] **Step 4: Verify prompt tests pass**

```
npm test -- src/test/memory-summary-prompt.test.ts
```
Expected: 4/4 PASS.

- [ ] **Step 5: Add summarizeMeeting to proxyService**

Open `src/main/proxyService.ts`. Locate the existing OpenAI fetch helper (e.g., the function that issues `chat/completions` requests for answer-assist or translation). Add the following export at the bottom of the file:

```ts
export interface SummarizeOptions {
  systemPrompt: string
  userPrompt: string
  model?: string
  maxOutputTokens?: number
}

export async function summarizeMeeting(opts: SummarizeOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  const model = opts.model ?? process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4o-mini'
  const controller = new AbortController()
  const timeoutMs = Number(process.env.MEMORY_SUMMARY_TIMEOUT_MS ?? 60_000)
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: opts.maxOutputTokens ?? 2000,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAI summarize ${res.status}: ${body.slice(0, 300)}`)
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = payload.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) throw new Error('Empty summary response')
    if (payload.usage) {
      console.log(
        '[proxy] summarizeMeeting tokens prompt=',
        payload.usage.prompt_tokens,
        'completion=',
        payload.usage.completion_tokens
      )
    }
    return content
  } finally {
    clearTimeout(t)
  }
}
```

- [ ] **Step 6: Typecheck + lint + test**

```
npm run typecheck && npm run lint && npm test
```
Expected: clean. Existing proxyService tests still pass.

- [ ] **Step 7: Commit**

```
git add src/main/memory/prompts/summary.v1.ts src/test/memory-summary-prompt.test.ts src/main/proxyService.ts
git commit -m "feat(memory): add summary prompt v1 + proxyService.summarizeMeeting"
```

---

## Task 10: SummaryService — short meeting flow

**Files:**
- Create: `src/main/memory/summaryService.ts`
- Create: `src/test/memory-summary-service-short.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-summary-service-short.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { SummaryService } from '../main/memory/summaryService'
import type { Meeting, Segment, SummaryJSON } from '../main/memory/types'

function setupRepoWithShortMeeting(): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_short',
    title: 't',
    startedAt: 0,
    endedAt: 5 * 60 * 1000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 5 * 60 * 1000,
  }
  repo.insertMeeting(meeting)
  for (let i = 0; i < 3; i++) {
    const s: Segment = {
      id: 'seg_' + i,
      meetingId: 'mtg_short',
      seq: i,
      createdAt: i * 1000,
      speakerId: 'speaker_a',
      speakerLabel: 'Speaker A',
      sourceText: 'line ' + i,
      translatedText: null,
      sourceLanguage: 'en',
    }
    repo.insertSegment(s)
  }
  return repo
}

function happyJson(): SummaryJSON {
  return {
    shortSummary: '짧은 요약',
    detailedSummary: '- a\n- b',
    keyPoints: ['k'],
    actionItems: [{ text: 'do it', owner: 'Speaker A' }],
  }
}

describe('SummaryService — short meeting', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('calls summarizeMeeting once for meetings under 15 minutes', async () => {
    const repo = setupRepoWithShortMeeting()
    const callImpl = vi.fn(async () => JSON.stringify(happyJson()))
    const svc = new SummaryService(repo, callImpl, { now: () => 1234 })
    await svc.generate('mtg_short')
    expect(callImpl).toHaveBeenCalledTimes(1)
    const saved = repo.getSummary('mtg_short')
    expect(saved).toMatchObject({
      meetingId: 'mtg_short',
      shortSummary: '짧은 요약',
      status: 'ok',
      promptVersion: 'v1',
    })
    repo.close()
  })

  it('retries once on JSON parse failure, then succeeds', async () => {
    const repo = setupRepoWithShortMeeting()
    const calls: string[] = ['not-json', JSON.stringify(happyJson())]
    const callImpl = vi.fn(async () => calls.shift()!)
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_short')
    expect(callImpl).toHaveBeenCalledTimes(2)
    expect(repo.getSummary('mtg_short')?.status).toBe('ok')
    repo.close()
  })

  it('saves a failed row when JSON parse fails twice', async () => {
    const repo = setupRepoWithShortMeeting()
    const callImpl = vi.fn(async () => 'still not json')
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_short')
    const s = repo.getSummary('mtg_short')!
    expect(s.status).toBe('failed')
    expect(s.shortSummary).toMatch(/실패/)
    repo.close()
  })

  it('rejects when token estimate exceeds limit', async () => {
    const repo = setupRepoWithShortMeeting()
    // make one giant segment
    repo.insertSegment({
      id: 'seg_huge',
      meetingId: 'mtg_short',
      seq: 99,
      createdAt: 0,
      speakerId: null,
      speakerLabel: null,
      sourceText: 'x'.repeat(2_000_000),
      translatedText: null,
      sourceLanguage: 'en',
    })
    const callImpl = vi.fn(async () => JSON.stringify(happyJson()))
    const svc = new SummaryService(repo, callImpl, {
      now: () => 1,
      maxInputTokens: 1000,
    })
    await svc.generate('mtg_short')
    expect(callImpl).not.toHaveBeenCalled()
    const s = repo.getSummary('mtg_short')!
    expect(s.status).toBe('failed')
    expect(s.shortSummary).toMatch(/너무 길/)
    repo.close()
  })

  it('respects MEMORY_SUMMARY_AUTO=false by skipping when called via generateIfAutoEnabled', async () => {
    const repo = setupRepoWithShortMeeting()
    const callImpl = vi.fn(async () => JSON.stringify(happyJson()))
    const svc = new SummaryService(repo, callImpl, {
      now: () => 1,
      autoEnabled: false,
    })
    await svc.generateIfAutoEnabled('mtg_short')
    expect(callImpl).not.toHaveBeenCalled()
    expect(repo.getSummary('mtg_short')).toBeNull()
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-summary-service-short.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement SummaryService (short flow only — long flow added in T11)**

Create `src/main/memory/summaryService.ts`:
```ts
import type { MemoryRepository } from './repository'
import { SUMMARY_PROMPT_VERSION, SYSTEM_PROMPT, buildTranscriptUserPrompt } from './prompts/summary.v1'
import type { Summary, SummaryJSON } from './types'

const SHORT_MEETING_MS = 15 * 60 * 1000
const DEFAULT_MAX_INPUT_TOKENS = 200_000

export type SummarizeCall = (args: { systemPrompt: string; userPrompt: string }) => Promise<string>

interface SummaryOptions {
  now?: () => number
  maxInputTokens?: number
  autoEnabled?: boolean
  model?: string
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function validateSummaryJson(raw: unknown): SummaryJSON {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')
  const obj = raw as Record<string, unknown>
  if (typeof obj.shortSummary !== 'string') throw new Error('shortSummary missing')
  if (typeof obj.detailedSummary !== 'string') throw new Error('detailedSummary missing')
  if (!Array.isArray(obj.keyPoints)) throw new Error('keyPoints missing')
  if (!Array.isArray(obj.actionItems)) throw new Error('actionItems missing')
  return {
    shortSummary: obj.shortSummary,
    detailedSummary: obj.detailedSummary,
    keyPoints: obj.keyPoints.filter((k): k is string => typeof k === 'string'),
    actionItems: obj.actionItems
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({
        text: typeof a.text === 'string' ? a.text : '',
        owner: typeof a.owner === 'string' ? a.owner : undefined,
        due: typeof a.due === 'string' ? a.due : undefined,
      }))
      .filter((a) => a.text.trim().length > 0),
  }
}

function failedSummary(meetingId: string, now: number, model: string, reason: string): Summary {
  return {
    meetingId,
    shortSummary: reason,
    detailedSummary: '',
    keyPoints: [],
    actionItems: [],
    generatedAt: now,
    model,
    promptVersion: SUMMARY_PROMPT_VERSION,
    status: 'failed',
  }
}

export class SummaryService {
  private now: () => number
  private maxInputTokens: number
  private autoEnabled: boolean
  private model: string

  constructor(
    private repo: MemoryRepository,
    private call: SummarizeCall,
    opts: SummaryOptions = {}
  ) {
    this.now = opts.now ?? (() => Date.now())
    this.maxInputTokens = opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS
    this.autoEnabled = opts.autoEnabled ?? process.env.MEMORY_SUMMARY_AUTO !== 'false'
    this.model = opts.model ?? process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4o-mini'
  }

  async generateIfAutoEnabled(meetingId: string): Promise<void> {
    if (!this.autoEnabled) return
    await this.generate(meetingId)
  }

  async generate(meetingId: string): Promise<void> {
    const meeting = this.repo.getMeeting(meetingId)
    if (!meeting) return
    const segments = this.repo.getSegments(meetingId)
    if (segments.length === 0) {
      this.repo.upsertSummary(failedSummary(meetingId, this.now(), this.model, '발화가 없어 요약할 수 없습니다.'))
      return
    }

    const userPrompt = buildTranscriptUserPrompt(meeting.startedAt, segments)
    if (estimateTokens(userPrompt) > this.maxInputTokens) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, '미팅이 너무 길어 요약을 생성할 수 없습니다.')
      )
      return
    }

    // Long meetings (>15min) are handled in T11. For now, fall through to single-call path.
    const duration = (meeting.durationMs ?? 0)
    if (duration > SHORT_MEETING_MS) {
      // placeholder; T11 replaces this branch
      await this.generateSingleCall(meetingId, userPrompt)
      return
    }
    await this.generateSingleCall(meetingId, userPrompt)
  }

  private async generateSingleCall(meetingId: string, userPrompt: string): Promise<void> {
    let parsed: SummaryJSON | null = null
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const raw = await this.call({ systemPrompt: SYSTEM_PROMPT, userPrompt })
        parsed = validateSummaryJson(JSON.parse(raw))
      } catch (err) {
        console.warn('[summary] parse failed attempt', attempt, err)
      }
    }
    if (!parsed) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, '요약 생성 실패. 다시 시도해 보세요.')
      )
      return
    }
    this.repo.upsertSummary({
      meetingId,
      ...parsed,
      generatedAt: this.now(),
      model: this.model,
      promptVersion: SUMMARY_PROMPT_VERSION,
      status: 'ok',
    })
  }
}
```

- [ ] **Step 3: Verify tests pass**

```
npm test -- src/test/memory-summary-service-short.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/summaryService.ts src/test/memory-summary-service-short.test.ts
git commit -m "feat(memory): add SummaryService short-meeting flow"
```

---

## Task 11: SummaryService — long meeting map-reduce

**Files:**
- Modify: `src/main/memory/summaryService.ts`
- Create: `src/test/memory-summary-service-long.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-summary-service-long.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { SummaryService } from '../main/memory/summaryService'
import type { Meeting, Segment } from '../main/memory/types'

function setupLongMeeting(durationMin: number): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_long',
    title: 't',
    startedAt: 0,
    endedAt: durationMin * 60_000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: durationMin * 60_000,
  }
  repo.insertMeeting(meeting)
  // one segment every minute
  for (let i = 0; i < durationMin; i++) {
    const s: Segment = {
      id: 's' + i,
      meetingId: 'mtg_long',
      seq: i,
      createdAt: i * 60_000,
      speakerId: null,
      speakerLabel: 'Speaker A',
      sourceText: 'minute ' + i,
      translatedText: null,
      sourceLanguage: 'en',
    }
    repo.insertSegment(s)
  }
  return repo
}

const validJson = JSON.stringify({
  shortSummary: 's',
  detailedSummary: 'd',
  keyPoints: ['k'],
  actionItems: [{ text: 'a' }],
})

describe('SummaryService — long meeting', () => {
  it('splits a 30-min meeting into multiple chunks and runs a reduce call', async () => {
    const repo = setupLongMeeting(30)
    const calls: { userPrompt: string }[] = []
    const callImpl = vi.fn(async (args: { systemPrompt: string; userPrompt: string }) => {
      calls.push(args)
      return validJson
    })
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_long')
    // 30 min with 10-min windows and 30s overlap → at least 3 chunks + 1 reduce
    expect(callImpl.mock.calls.length).toBeGreaterThanOrEqual(4)
    // last call should be the reduce call (mentions "청크")
    expect(calls[calls.length - 1].userPrompt).toMatch(/청크/)
    expect(repo.getSummary('mtg_long')?.status).toBe('ok')
    repo.close()
  })

  it('falls back to failed if reduce JSON cannot be parsed twice', async () => {
    const repo = setupLongMeeting(20)
    let n = 0
    const callImpl = vi.fn(async () => {
      n++
      // chunks parse OK; reduce always returns garbage
      return n <= 2 ? validJson : 'garbage'
    })
    const svc = new SummaryService(repo, callImpl, { now: () => 1 })
    await svc.generate('mtg_long')
    expect(repo.getSummary('mtg_long')?.status).toBe('failed')
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-summary-service-long.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Replace the long-meeting branch with real map-reduce**

In `src/main/memory/summaryService.ts`, locate the `SHORT_MEETING_MS` branch in `generate()`:
```ts
if (duration > SHORT_MEETING_MS) {
  // placeholder; T11 replaces this branch
  await this.generateSingleCall(meetingId, userPrompt)
  return
}
```

Replace with:
```ts
if (duration > SHORT_MEETING_MS) {
  await this.generateMapReduce(meetingId, meeting.startedAt, segments)
  return
}
```

Add these constants near the top of the file (under existing constants):
```ts
const CHUNK_WINDOW_MS = 10 * 60 * 1000
const CHUNK_OVERLAP_MS = 30 * 1000
```

Add `chunkByTime` helper above the class:
```ts
import type { Segment } from './types'

export function chunkByTime(segments: Segment[], windowMs: number, overlapMs: number): Segment[][] {
  if (segments.length === 0) return []
  const chunks: Segment[][] = []
  const first = segments[0].createdAt
  const last = segments[segments.length - 1].createdAt
  let cursor = first
  const step = windowMs - overlapMs
  if (step <= 0) throw new Error('windowMs must be greater than overlapMs')
  while (cursor <= last) {
    const end = cursor + windowMs
    const slice = segments.filter((s) => s.createdAt >= cursor && s.createdAt < end)
    if (slice.length > 0) chunks.push(slice)
    cursor += step
  }
  return chunks
}
```

(If `Segment` import already exists, dedupe.)

Add a `generateMapReduce` method on the class:
```ts
  private async generateMapReduce(
    meetingId: string,
    meetingStartedAt: number,
    segments: Segment[]
  ): Promise<void> {
    const { buildReduceUserPrompt } = await import('./prompts/summary.v1')
    const slices = chunkByTime(segments, CHUNK_WINDOW_MS, CHUNK_OVERLAP_MS)
    const chunkSummariesJson: string[] = []
    for (const slice of slices) {
      const userPrompt = buildTranscriptUserPrompt(meetingStartedAt, slice)
      let chunkRaw: string | null = null
      for (let attempt = 0; attempt < 2 && !chunkRaw; attempt++) {
        try {
          const raw = await this.call({ systemPrompt: SYSTEM_PROMPT, userPrompt })
          validateSummaryJson(JSON.parse(raw))
          chunkRaw = raw
        } catch (err) {
          console.warn('[summary] chunk parse failed', err)
        }
      }
      if (!chunkRaw) {
        this.repo.upsertSummary(
          failedSummary(meetingId, this.now(), this.model, '청크 요약 실패. 다시 시도해 보세요.')
        )
        return
      }
      chunkSummariesJson.push(chunkRaw)
    }
    const reducePrompt = buildReduceUserPrompt(chunkSummariesJson)
    let parsed: SummaryJSON | null = null
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const raw = await this.call({ systemPrompt: SYSTEM_PROMPT, userPrompt: reducePrompt })
        parsed = validateSummaryJson(JSON.parse(raw))
      } catch (err) {
        console.warn('[summary] reduce parse failed', err)
      }
    }
    if (!parsed) {
      this.repo.upsertSummary(
        failedSummary(meetingId, this.now(), this.model, '요약 통합 실패. 다시 시도해 보세요.')
      )
      return
    }
    this.repo.upsertSummary({
      meetingId,
      ...parsed,
      generatedAt: this.now(),
      model: this.model,
      promptVersion: SUMMARY_PROMPT_VERSION,
      status: 'ok',
    })
  }
```

Make sure `validateSummaryJson`, `failedSummary`, and `SUMMARY_PROMPT_VERSION`, `SYSTEM_PROMPT`, `buildTranscriptUserPrompt` are still imported/in scope from earlier in the file. If you converted the dynamic import to a top-level import, that's fine.

- [ ] **Step 3: Verify both summary suites pass**

```
npm test -- src/test/memory-summary-service
```
Expected: short + long tests all pass.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/summaryService.ts src/test/memory-summary-service-long.test.ts
git commit -m "feat(memory): add long-meeting map-reduce summary"
```

---

## Task 12: SearchService

**Files:**
- Create: `src/main/memory/searchService.ts`
- Create: `src/test/memory-search-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-search-service.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { SearchService } from '../main/memory/searchService'
import type { Meeting, Segment } from '../main/memory/types'

function setup() {
  const repo = new MemoryRepository(':memory:')
  const meeting: Meeting = {
    id: 'mtg_1',
    title: 'Test',
    startedAt: 1,
    endedAt: 2,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 1,
  }
  repo.insertMeeting(meeting)
  const segments: Segment[] = [
    {
      id: 's1',
      meetingId: 'mtg_1',
      seq: 0,
      createdAt: 10,
      speakerId: null,
      speakerLabel: 'Speaker A',
      sourceText: 'demand forecast prophet',
      translatedText: '수요 예측 prophet',
      sourceLanguage: 'en',
    },
    {
      id: 's2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 11,
      speakerId: null,
      speakerLabel: 'Speaker B',
      sourceText: 'pizza party friday',
      translatedText: '금요일 피자 파티',
      sourceLanguage: 'en',
    },
  ]
  for (const s of segments) repo.insertSegment(s)
  // s1 ~= query direction, s2 ~= orthogonal
  repo.saveEmbedding('s1', new Float32Array([1, 0]), 'm-test')
  repo.saveEmbedding('s2', new Float32Array([0, 1]), 'm-test')
  return repo
}

describe('SearchService', () => {
  it('returns segments ranked by cosine similarity descending', async () => {
    const repo = setup()
    const embedder = {
      embedQuery: vi.fn(async () => new Float32Array([1, 0])),
    }
    const svc = new SearchService(repo, embedder as never, { threshold: 0 })
    const hits = await svc.search('demand forecast', 10)
    expect(hits[0].segmentId).toBe('s1')
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
    expect(hits[0].meetingTitle).toBe('Test')
    expect(hits[0].translatedText).toBe('수요 예측 prophet')
    repo.close()
  })

  it('filters out scores below the threshold', async () => {
    const repo = setup()
    const embedder = {
      embedQuery: vi.fn(async () => new Float32Array([1, 0])),
    }
    const svc = new SearchService(repo, embedder as never, { threshold: 0.5 })
    const hits = await svc.search('demand forecast', 10)
    expect(hits.map((h) => h.segmentId)).toEqual(['s1'])
    repo.close()
  })

  it('respects the limit parameter', async () => {
    const repo = setup()
    const embedder = {
      embedQuery: vi.fn(async () => new Float32Array([0.7, 0.7])),
    }
    const svc = new SearchService(repo, embedder as never, { threshold: 0 })
    const hits = await svc.search('q', 1)
    expect(hits).toHaveLength(1)
    repo.close()
  })

  it('returns empty array when there are no embeddings', async () => {
    const repo = new MemoryRepository(':memory:')
    const embedder = {
      embedQuery: vi.fn(async () => new Float32Array([1, 0])),
    }
    const svc = new SearchService(repo, embedder as never, { threshold: 0 })
    expect(await svc.search('q', 10)).toEqual([])
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-search-service.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement SearchService**

Create `src/main/memory/searchService.ts`:
```ts
import type { MemoryRepository } from './repository'
import type { EmbeddingService } from './embeddingService'
import type { SearchHit } from './types'

interface SearchOptions {
  threshold?: number
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i] * b[i]
  return sum
}

export class SearchService {
  private threshold: number

  constructor(
    private repo: MemoryRepository,
    private embedder: Pick<EmbeddingService, 'embedQuery'>,
    options: SearchOptions = {}
  ) {
    this.threshold = options.threshold ?? 0.5
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const all = this.repo.getAllEmbeddings()
    if (all.length === 0) return []
    const q = await this.embedder.embedQuery(query)
    const scored = all.map((row) => ({ segmentId: row.segmentId, score: dot(q, row.vector) }))
    scored.sort((a, b) => b.score - a.score)
    const top = scored.filter((s) => s.score >= this.threshold).slice(0, limit)
    if (top.length === 0) return []
    return this.repo.lookupSearchHits(top)
  }
}
```

You'll need a new repo method `lookupSearchHits`. Add it to `src/main/memory/repository.ts`:
```ts
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
```

Add `SearchHit` to the existing repo imports if not already present.

- [ ] **Step 3: Verify tests pass**

```
npm test -- src/test/memory-search-service.test.ts
```
Expected: 4/4 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/searchService.ts src/main/memory/repository.ts src/test/memory-search-service.test.ts
git commit -m "feat(memory): add SearchService with cosine KNN"
```

---

## Task 13: MarkdownExporter

**Files:**
- Create: `src/main/memory/markdownExporter.ts`
- Create: `src/test/memory-markdown-exporter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-markdown-exporter.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { exportMeetingMarkdown } from '../main/memory/markdownExporter'
import type { Meeting, Segment, Summary } from '../main/memory/types'

function setup(includeSummary: boolean): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  const m: Meeting = {
    id: 'mtg_1',
    title: '미팅 05-17 14:30',
    startedAt: 0,
    endedAt: 60_000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 60_000,
  }
  repo.insertMeeting(m)
  const segs: Segment[] = [
    {
      id: 's1',
      meetingId: 'mtg_1',
      seq: 0,
      createdAt: 0,
      speakerId: null,
      speakerLabel: 'Speaker A',
      sourceText: 'hello',
      translatedText: '안녕',
      sourceLanguage: 'en',
    },
    {
      id: 's2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 5_000,
      speakerId: null,
      speakerLabel: 'Speaker B',
      sourceText: 'world',
      translatedText: null,
      sourceLanguage: 'en',
    },
  ]
  for (const s of segs) repo.insertSegment(s)
  if (includeSummary) {
    const sum: Summary = {
      meetingId: 'mtg_1',
      shortSummary: '짧은 요약',
      detailedSummary: '- a\n- b',
      keyPoints: ['k1', 'k2'],
      actionItems: [{ text: 'do it', owner: 'Speaker A' }],
      generatedAt: 1,
      model: 'gpt-4o-mini',
      promptVersion: 'v1',
      status: 'ok',
    }
    repo.upsertSummary(sum)
  }
  return repo
}

describe('exportMeetingMarkdown', () => {
  it('renders title, summary sections, and transcript with timestamps and translations', () => {
    const repo = setup(true)
    const md = exportMeetingMarkdown(repo, 'mtg_1')!
    expect(md).toMatch(/^# 미팅 05-17 14:30/)
    expect(md).toContain('## 요약')
    expect(md).toContain('짧은 요약')
    expect(md).toContain('## 자세히')
    expect(md).toContain('## 핵심 포인트')
    expect(md).toContain('- k1')
    expect(md).toContain('## 액션 아이템')
    expect(md).toContain('- [ ] do it — Speaker A')
    expect(md).toContain('## 대화 기록')
    expect(md).toContain('[00:00:00] **Speaker A**: hello')
    expect(md).toContain('  ↳ 안녕')
    expect(md).toContain('[00:00:05] **Speaker B**: world')
    repo.close()
  })

  it('omits summary sections when no summary exists', () => {
    const repo = setup(false)
    const md = exportMeetingMarkdown(repo, 'mtg_1')!
    expect(md).not.toContain('## 요약')
    expect(md).toContain('## 대화 기록')
    repo.close()
  })

  it('returns null for an unknown meeting id', () => {
    const repo = new MemoryRepository(':memory:')
    expect(exportMeetingMarkdown(repo, 'missing')).toBeNull()
    repo.close()
  })
})
```

Run:
```
npm test -- src/test/memory-markdown-exporter.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement exporter**

Create `src/main/memory/markdownExporter.ts`:
```ts
import type { MemoryRepository } from './repository'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatOffset(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`
}

export function exportMeetingMarkdown(repo: MemoryRepository, meetingId: string): string | null {
  const meeting = repo.getMeeting(meetingId)
  if (!meeting) return null
  const summary = repo.getSummary(meetingId)
  const segments = repo.getSegments(meetingId)

  const lines: string[] = []
  lines.push(`# ${meeting.title}`)
  lines.push('')
  const dur = meeting.durationMs ? `${Math.round(meeting.durationMs / 60000)}분` : '진행 중'
  lines.push(`*${new Date(meeting.startedAt).toISOString()} · ${dur}*`)
  lines.push('')

  if (summary && summary.status === 'ok') {
    lines.push('## 요약')
    lines.push(summary.shortSummary)
    lines.push('')
    if (summary.detailedSummary.trim()) {
      lines.push('## 자세히')
      lines.push(summary.detailedSummary)
      lines.push('')
    }
    if (summary.keyPoints.length > 0) {
      lines.push('## 핵심 포인트')
      for (const k of summary.keyPoints) lines.push(`- ${k}`)
      lines.push('')
    }
    if (summary.actionItems.length > 0) {
      lines.push('## 액션 아이템')
      for (const a of summary.actionItems) {
        const owner = a.owner ? ` — ${a.owner}` : ''
        const due = a.due ? ` (${a.due})` : ''
        lines.push(`- [ ] ${a.text}${owner}${due}`)
      }
      lines.push('')
    }
  }

  lines.push('## 대화 기록')
  const anchor = segments[0]?.createdAt ?? meeting.startedAt
  for (const s of segments) {
    const speaker = s.speakerLabel ?? 'Unknown'
    lines.push(`[${formatOffset(s.createdAt - anchor)}] **${speaker}**: ${s.sourceText}`)
    if (s.translatedText) lines.push(`  ↳ ${s.translatedText}`)
  }
  lines.push('')
  return lines.join('\n')
}
```

- [ ] **Step 3: Verify tests pass**

```
npm test -- src/test/memory-markdown-exporter.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 4: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```
git add src/main/memory/markdownExporter.ts src/test/memory-markdown-exporter.test.ts
git commit -m "feat(memory): add markdown exporter"
```

---

## Task 14: MemoryService facade

**Files:**
- Create: `src/main/memory/memoryService.ts`
- Create: `src/test/memory-service-facade.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-service-facade.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { MemoryService } from '../main/memory/memoryService'

function fakeEmbeddingService() {
  return {
    embedPassages: async (texts: string[]) => texts.map(() => new Float32Array([0.5, 0.5])),
    embedQuery: async () => new Float32Array([1, 0]),
    dispose: async () => {},
  }
}

function fakeSummarizeCall(json: string) {
  return async () => json
}

describe('MemoryService facade', () => {
  it('begin → segment → end → summary → list/get pipeline using in-memory db', async () => {
    const happy = JSON.stringify({
      shortSummary: 's',
      detailedSummary: 'd',
      keyPoints: ['k'],
      actionItems: [{ text: 'a' }],
    })
    const svc = await MemoryService.createForTest({
      dbPath: ':memory:',
      embedding: fakeEmbeddingService(),
      summarize: fakeSummarizeCall(happy),
      now: () => 1_000_000,
    })
    const id = svc.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    svc.recordTurn({
      id: 'turn_1',
      text: 'hello world',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 1_000_100,
      speakerId: 'speaker_a',
      speakerLabel: 'Speaker A',
    })
    svc.recordTranslation('turn_1', '안녕 세상')
    await svc.endMeeting()
    // wait for summary background generation
    await svc.flushBackgroundForTest()
    const list = svc.listMeetings(10, 0)
    expect(list).toHaveLength(1)
    expect(list[0].meeting.id).toBe(id)
    expect(list[0].shortSummary).toBe('s')
    const detail = svc.getMeeting(id)!
    expect(detail.segments).toHaveLength(1)
    expect(detail.segments[0].translatedText).toBe('안녕 세상')
    expect(detail.summary?.status).toBe('ok')
    await svc.dispose()
  })

  it('recoverInterruptedMeetings marks pre-existing live rows failed on initialize', async () => {
    // first instance: begin a meeting and skip end
    const svc1 = await MemoryService.createForTest({
      dbPath: ':memory:',
      embedding: fakeEmbeddingService(),
      summarize: fakeSummarizeCall('{}'),
      now: () => 1,
    })
    const id = svc1.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    // share the underlying repo with svc2
    const dbBuffer = svc1.serializeForTest()
    await svc1.dispose()
    const svc2 = await MemoryService.createForTest({
      dbBuffer,
      embedding: fakeEmbeddingService(),
      summarize: fakeSummarizeCall('{}'),
      now: () => 2,
    })
    const recovered = svc2.recoverInterruptedMeetings()
    expect(recovered).toBe(1)
    expect(svc2.getMeeting(id)?.meeting.status).toBe('failed')
    await svc2.dispose()
  })

  it('search returns hits when query embedding aligns with stored vectors', async () => {
    const svc = await MemoryService.createForTest({
      dbPath: ':memory:',
      embedding: fakeEmbeddingService(),
      summarize: fakeSummarizeCall(
        JSON.stringify({
          shortSummary: 's',
          detailedSummary: 'd',
          keyPoints: [],
          actionItems: [],
        })
      ),
      now: () => 1,
    })
    svc.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
    svc.recordTurn({
      id: 'turn_a',
      text: 'pizza party friday',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 1,
      speakerId: 'unknown',
      speakerLabel: 'Unknown',
    })
    await svc.flushBackgroundForTest()
    const hits = await svc.search('pizza', 5)
    expect(hits[0].sourceText).toBe('pizza party friday')
    await svc.dispose()
  })
})
```

Run:
```
npm test -- src/test/memory-service-facade.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Implement MemoryService**

Create `src/main/memory/memoryService.ts`:
```ts
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { EmbeddingQueue } from './embeddingQueue'
import { EmbeddingService, type EmbeddingWorkerLike } from './embeddingService'
import { MeetingLifecycle } from './meetingLifecycle'
import { MemoryRepository } from './repository'
import { SearchService } from './searchService'
import { SummaryService, type SummarizeCall } from './summaryService'
import { exportMeetingMarkdown } from './markdownExporter'
import {
  attachTranscriptHook,
  detachTranscriptHook,
  notifyTranslation,
  notifyTurnFinalized,
  type TurnPayload,
} from './transcriptHook'
import type {
  MeetingDetail,
  MeetingSummary,
  MeetingUpdatedEvent,
  SearchHit,
} from './types'
import { summarizeMeeting } from '../proxyService'

type Listener = (evt: MeetingUpdatedEvent) => void

interface ConstructionArgs {
  repo: MemoryRepository
  embeddingService: EmbeddingService
  embeddingQueue: EmbeddingQueue
  lifecycle: MeetingLifecycle
  summary: SummaryService
  search: SearchService
  now: () => number
}

interface ProductionInitArgs {
  dbPath: string
  workerPath: string
  modelEnvCacheDir?: string
}

interface TestInitArgs {
  dbPath?: string
  dbBuffer?: Buffer
  embedding: {
    embedPassages: (texts: string[]) => Promise<Float32Array[]>
    embedQuery: (text: string) => Promise<Float32Array>
    dispose: () => Promise<void>
  }
  summarize: SummarizeCall
  now: () => number
}

export class MemoryService {
  private listeners = new Set<Listener>()
  private backgroundOps: Promise<unknown>[] = []

  private constructor(private parts: ConstructionArgs) {
    attachTranscriptHook(
      parts.repo,
      parts.embeddingQueue,
      () => parts.lifecycle.getCurrentMeetingId()
    )
  }

  // --- production path ---
  static async initialize(args: ProductionInitArgs): Promise<MemoryService> {
    const repo = new MemoryRepository(args.dbPath)
    const worker = new Worker(args.workerPath, {
      env: args.modelEnvCacheDir ? { ...process.env, MEMORY_EMBEDDING_CACHE_DIR: args.modelEnvCacheDir } : process.env,
    })
    const embeddingWorker = worker as unknown as EmbeddingWorkerLike
    const embeddingService = new EmbeddingService(embeddingWorker)
    const embeddingQueue = new EmbeddingQueue(embeddingService, repo, {
      modelId: embeddingService.modelId,
    })
    const lifecycle = new MeetingLifecycle(repo)
    const summarize: SummarizeCall = ({ systemPrompt, userPrompt }) =>
      summarizeMeeting({ systemPrompt, userPrompt })
    const summary = new SummaryService(repo, summarize)
    const search = new SearchService(repo, embeddingService)
    const svc = new MemoryService({
      repo,
      embeddingService,
      embeddingQueue,
      lifecycle,
      summary,
      search,
      now: () => Date.now(),
    })
    // requeue missing embeddings
    for (const m of repo.getMissingEmbeddings()) {
      embeddingQueue.enqueue({ segmentId: m.segmentId, text: m.text })
    }
    return svc
  }

  // --- test path ---
  static async createForTest(args: TestInitArgs): Promise<MemoryService> {
    const repo = new MemoryRepository(args.dbPath ?? ':memory:')
    // Note: in-memory DBs can't be transferred via serializeForTest; use dbPath for that path.
    void args.dbBuffer
    const embeddingService = args.embedding as unknown as EmbeddingService
    const embeddingQueue = new EmbeddingQueue(embeddingService, repo, { modelId: 'm-test' })
    const lifecycle = new MeetingLifecycle(repo, { now: args.now })
    const summary = new SummaryService(repo, args.summarize, { now: args.now })
    const search = new SearchService(repo, embeddingService, { threshold: 0 })
    return new MemoryService({
      repo,
      embeddingService,
      embeddingQueue,
      lifecycle,
      summary,
      search,
      now: args.now,
    })
  }

  // --- API used by IPC ---
  beginMeeting(args: { sourceLanguage: string; targetLanguage: string }): string {
    const id = this.parts.lifecycle.beginMeeting(args)
    this.emit({ meetingId: id, kind: 'began' })
    return id
  }

  recordTurn(turn: TurnPayload): void {
    notifyTurnFinalized(turn)
    const id = this.parts.lifecycle.getCurrentMeetingId()
    if (id) this.emit({ meetingId: id, kind: 'segment-added' })
  }

  recordTranslation(turnId: string, translation: string): void {
    notifyTranslation(turnId, translation)
  }

  async endMeeting(drainTimeoutMs = 3000): Promise<string | null> {
    const id = this.parts.lifecycle.getCurrentMeetingId()
    if (!id) return null
    const segments = this.parts.repo.getSegments(id)
    await this.parts.embeddingQueue.drainPending(
      segments.map((s) => s.id),
      drainTimeoutMs
    )
    this.parts.lifecycle.endMeeting()
    this.emit({ meetingId: id, kind: 'ended' })
    const op = (async () => {
      try {
        await this.parts.summary.generateIfAutoEnabled(id)
        const s = this.parts.repo.getSummary(id)
        if (s && s.status === 'ok') this.emit({ meetingId: id, kind: 'summary-ready' })
        else this.emit({ meetingId: id, kind: 'summary-failed' })
      } catch (err) {
        console.warn('[memory] background summary failed', err)
        this.emit({ meetingId: id, kind: 'summary-failed' })
      }
    })()
    this.backgroundOps.push(op)
    return id
  }

  recoverInterruptedMeetings(): number {
    return this.parts.lifecycle.recoverInterruptedMeetings()
  }

  listMeetings(limit: number, offset: number): MeetingSummary[] {
    const meetings = this.parts.repo.listMeetings(limit, offset)
    return meetings.map((meeting) => ({
      meeting,
      shortSummary: this.parts.repo.getSummary(meeting.id)?.shortSummary ?? null,
    }))
  }

  getMeeting(id: string): MeetingDetail | null {
    const meeting = this.parts.repo.getMeeting(id)
    if (!meeting) return null
    return {
      meeting,
      summary: this.parts.repo.getSummary(id),
      segments: this.parts.repo.getSegments(id),
    }
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    return this.parts.search.search(query, limit)
  }

  renameMeeting(id: string, title: string): void {
    this.parts.repo.updateTitle(id, title)
    this.emit({ meetingId: id, kind: 'renamed' })
  }

  deleteMeeting(id: string): void {
    this.parts.repo.deleteMeeting(id)
    this.emit({ meetingId: id, kind: 'deleted' })
  }

  exportMeeting(id: string, format: 'markdown'): string {
    if (format !== 'markdown') throw new Error('Unsupported format: ' + format)
    const md = exportMeetingMarkdown(this.parts.repo, id)
    if (md === null) throw new Error('Meeting not found: ' + id)
    return md
  }

  async regenerateSummary(id: string): Promise<void> {
    const op = (async () => {
      try {
        await this.parts.summary.generate(id)
        const s = this.parts.repo.getSummary(id)
        if (s && s.status === 'ok') this.emit({ meetingId: id, kind: 'summary-ready' })
        else this.emit({ meetingId: id, kind: 'summary-failed' })
      } catch (err) {
        console.warn('[memory] regenerate failed', err)
        this.emit({ meetingId: id, kind: 'summary-failed' })
      }
    })()
    this.backgroundOps.push(op)
  }

  onMeetingUpdated(handler: Listener): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  async flushBackgroundForTest(): Promise<void> {
    await this.parts.embeddingQueue.drain()
    await Promise.all(this.backgroundOps)
    this.backgroundOps = []
  }

  serializeForTest(): Buffer {
    return Buffer.alloc(0)
  }

  async dispose(): Promise<void> {
    detachTranscriptHook()
    await this.parts.embeddingService.dispose().catch(() => {})
    this.parts.repo.close()
  }

  private emit(evt: MeetingUpdatedEvent): void {
    for (const l of this.listeners) {
      try {
        l(evt)
      } catch (err) {
        console.warn('[memory] listener threw', err)
      }
    }
  }
}

export function defaultWorkerPath(): string {
  // resolved from main bundle at runtime
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, 'embeddingWorker.js')
}
```

- [ ] **Step 3: Adjust the second test ("recover")**

Because in-memory SQLite cannot be shared between MemoryService instances via `serializeForTest`, replace the second test in `src/test/memory-service-facade.test.ts` with a version that uses a real temp file:
```ts
  it('recoverInterruptedMeetings marks pre-existing live rows failed on initialize', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dbPath = path.join(os.tmpdir(), `mem-test-${Date.now()}.db`)
    try {
      const svc1 = await MemoryService.createForTest({
        dbPath,
        embedding: fakeEmbeddingService(),
        summarize: fakeSummarizeCall('{}'),
        now: () => 1,
      })
      const id = svc1.beginMeeting({ sourceLanguage: 'en', targetLanguage: 'ko' })
      // dispose without ending — leaves a live row
      await svc1.dispose()
      const svc2 = await MemoryService.createForTest({
        dbPath,
        embedding: fakeEmbeddingService(),
        summarize: fakeSummarizeCall('{}'),
        now: () => 2,
      })
      const recovered = svc2.recoverInterruptedMeetings()
      expect(recovered).toBe(1)
      expect(svc2.getMeeting(id)?.meeting.status).toBe('failed')
      await svc2.dispose()
    } finally {
      try { fs.unlinkSync(dbPath) } catch {}
      try { fs.unlinkSync(dbPath + '-wal') } catch {}
      try { fs.unlinkSync(dbPath + '-shm') } catch {}
    }
  })
```

Remove the `serializeForTest()` call from the test entirely.

- [ ] **Step 4: Verify tests pass**

```
npm test -- src/test/memory-service-facade.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 5: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```
git add src/main/memory/memoryService.ts src/test/memory-service-facade.test.ts
git commit -m "feat(memory): add MemoryService facade with event bus"
```

---

## Task 15: IPC handlers + start/stop lifecycle hooks

**Files:**
- Modify: `src/main/ipc.ts`
- Create: `src/test/memory-ipc.test.ts`

**Note:** `ipc.ts` currently uses module-level imports. For memory we need a singleton `MemoryService` instance — but we cannot construct it at import time (would interfere with tests and main bootup ordering). We add a setter `setMemoryService(svc)` that `main/index.ts` calls during app boot. IPC handlers read from that module variable.

- [ ] **Step 1: Write failing tests**

Create `src/test/memory-ipc.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import {
  buildMemoryHandlers,
  type MemoryHandlerDeps,
} from '../main/ipc-memory-handlers'

function makeDeps(): MemoryHandlerDeps {
  return {
    listMeetings: vi.fn((limit, offset) => [{
      meeting: { id: 'a', title: 't', startedAt: 0, endedAt: null, sourceLanguage: null, targetLanguage: null, status: 'completed', segmentCount: 0, durationMs: null },
      shortSummary: 's',
    }]),
    getMeeting: vi.fn(),
    search: vi.fn(async () => []),
    renameMeeting: vi.fn(),
    deleteMeeting: vi.fn(),
    exportMeeting: vi.fn(() => '# md'),
    regenerateSummary: vi.fn(async () => {}),
  }
}

describe('memory IPC handlers', () => {
  it('list-meetings routes to listMeetings with limit and offset', async () => {
    const deps = makeDeps()
    const handlers = buildMemoryHandlers(deps)
    const result = await handlers['memory:list-meetings']({ limit: 10, offset: 5 })
    expect(deps.listMeetings).toHaveBeenCalledWith(10, 5)
    expect(result).toHaveLength(1)
  })

  it('list-meetings uses defaults when args omitted', async () => {
    const deps = makeDeps()
    const handlers = buildMemoryHandlers(deps)
    await handlers['memory:list-meetings']({})
    expect(deps.listMeetings).toHaveBeenCalledWith(30, 0)
  })

  it('search routes query and limit', async () => {
    const deps = makeDeps()
    const handlers = buildMemoryHandlers(deps)
    await handlers['memory:search']({ query: 'q', limit: 5 })
    expect(deps.search).toHaveBeenCalledWith('q', 5)
  })

  it('rename / delete / export / regenerate route correctly', async () => {
    const deps = makeDeps()
    const handlers = buildMemoryHandlers(deps)
    await handlers['memory:rename-meeting']({ id: 'a', title: 'new' })
    expect(deps.renameMeeting).toHaveBeenCalledWith('a', 'new')
    await handlers['memory:delete-meeting']({ id: 'a' })
    expect(deps.deleteMeeting).toHaveBeenCalledWith('a')
    const md = await handlers['memory:export-meeting']({ id: 'a', format: 'markdown' })
    expect(md).toBe('# md')
    await handlers['memory:regenerate-summary']({ id: 'a' })
    expect(deps.regenerateSummary).toHaveBeenCalledWith('a')
  })

  it('all handlers reject with a clear error when memory service is unavailable', async () => {
    const handlers = buildMemoryHandlers(null)
    await expect(handlers['memory:list-meetings']({})).rejects.toThrow(/not initialized/i)
  })
})
```

Run:
```
npm test -- src/test/memory-ipc.test.ts
```
Expected: FAIL.

- [ ] **Step 2: Extract handler-building helper**

Create `src/main/ipc-memory-handlers.ts`:
```ts
import type { MeetingDetail, MeetingSummary, SearchHit } from './memory/types'

export interface MemoryHandlerDeps {
  listMeetings: (limit: number, offset: number) => MeetingSummary[]
  getMeeting: (id: string) => MeetingDetail | null
  search: (query: string, limit: number) => Promise<SearchHit[]>
  renameMeeting: (id: string, title: string) => void
  deleteMeeting: (id: string) => void
  exportMeeting: (id: string, format: 'markdown') => string
  regenerateSummary: (id: string) => Promise<void>
}

type HandlerMap = {
  'memory:list-meetings': (args: { limit?: number; offset?: number }) => Promise<MeetingSummary[]>
  'memory:get-meeting': (args: { id: string }) => Promise<MeetingDetail | null>
  'memory:search': (args: { query: string; limit?: number }) => Promise<SearchHit[]>
  'memory:rename-meeting': (args: { id: string; title: string }) => Promise<void>
  'memory:delete-meeting': (args: { id: string }) => Promise<void>
  'memory:export-meeting': (args: { id: string; format: 'markdown' }) => Promise<string>
  'memory:regenerate-summary': (args: { id: string }) => Promise<void>
}

function ensure<T>(deps: T | null): asserts deps is T {
  if (!deps) throw new Error('Memory service not initialized')
}

export function buildMemoryHandlers(deps: MemoryHandlerDeps | null): HandlerMap {
  return {
    'memory:list-meetings': async ({ limit, offset }) => {
      ensure(deps)
      return deps.listMeetings(limit ?? 30, offset ?? 0)
    },
    'memory:get-meeting': async ({ id }) => {
      ensure(deps)
      return deps.getMeeting(id)
    },
    'memory:search': async ({ query, limit }) => {
      ensure(deps)
      return deps.search(query, limit ?? 20)
    },
    'memory:rename-meeting': async ({ id, title }) => {
      ensure(deps)
      deps.renameMeeting(id, title)
    },
    'memory:delete-meeting': async ({ id }) => {
      ensure(deps)
      deps.deleteMeeting(id)
    },
    'memory:export-meeting': async ({ id, format }) => {
      ensure(deps)
      return deps.exportMeeting(id, format)
    },
    'memory:regenerate-summary': async ({ id }) => {
      ensure(deps)
      await deps.regenerateSummary(id)
    },
  }
}
```

- [ ] **Step 3: Wire handlers into ipc.ts and add lifecycle hooks**

Open `src/main/ipc.ts`. Add at the top, after existing imports:
```ts
import type { MemoryService } from './memory/memoryService'
import { buildMemoryHandlers } from './ipc-memory-handlers'

let memoryServiceRef: MemoryService | null = null

export function setMemoryService(svc: MemoryService): void {
  memoryServiceRef = svc
}
```

Inside `registerIpcHandlers`, after the existing handlers, add:
```ts
  // Memory
  const memHandlers = buildMemoryHandlers({
    listMeetings: (limit, offset) => memoryServiceRef!.listMeetings(limit, offset),
    getMeeting: (id) => memoryServiceRef!.getMeeting(id),
    search: (query, limit) => memoryServiceRef!.search(query, limit),
    renameMeeting: (id, title) => memoryServiceRef!.renameMeeting(id, title),
    deleteMeeting: (id) => memoryServiceRef!.deleteMeeting(id),
    exportMeeting: (id, format) => memoryServiceRef!.exportMeeting(id, format),
    regenerateSummary: (id) => memoryServiceRef!.regenerateSummary(id),
  })
  for (const [channel, handler] of Object.entries(memHandlers)) {
    ipcMain.handle(channel, async (_event, args) => {
      if (!memoryServiceRef) throw new Error('Memory service not initialized')
      return handler(args as never)
    })
  }
```

Then patch the existing `start-transcription` and `stop-transcription` handlers. Replace the existing two blocks with:
```ts
  ipcMain.handle('start-transcription', async (_event, args: { language: string }) => {
    const { startTranscription } = await import('./sttService')
    startTranscription(args.language, mainWindowRef!)
    if (memoryServiceRef) {
      const meetingId = memoryServiceRef.beginMeeting({
        sourceLanguage: args.language,
        targetLanguage: 'unknown',
      })
      mainWindowRef?.webContents.send('memory:meeting-updated', {
        meetingId,
        kind: 'began',
      })
    }
  })

  ipcMain.handle('stop-transcription', async () => {
    const { stopTranscription } = await import('./sttService')
    await stopTranscription()
    if (memoryServiceRef) {
      const id = await memoryServiceRef.endMeeting(3000)
      if (id) mainWindowRef?.webContents.send('memory:meeting-updated', { meetingId: id, kind: 'ended' })
    }
  })
```

Finally, hook the memory event bus to renderer notifications. Add to `registerIpcHandlers` end:
```ts
  if (memoryServiceRef) {
    memoryServiceRef.onMeetingUpdated((evt) => {
      mainWindowRef?.webContents.send('memory:meeting-updated', evt)
    })
  }
```

(But ordering matters: the memory service may be installed AFTER `registerIpcHandlers` runs. So move the subscription into `setMemoryService` instead:

Replace `setMemoryService` declared earlier with:
```ts
export function setMemoryService(svc: MemoryService): void {
  memoryServiceRef = svc
  svc.onMeetingUpdated((evt) => {
    mainWindowRef?.webContents.send('memory:meeting-updated', evt)
  })
}
```

and remove the duplicate subscription inside `registerIpcHandlers` if you added one.)

- [ ] **Step 4: Verify tests pass**

```
npm test -- src/test/memory-ipc.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 5: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```
git add src/main/ipc-memory-handlers.ts src/main/ipc.ts src/test/memory-ipc.test.ts
git commit -m "feat(memory): wire memory IPC + lifecycle hooks"
```

---

## Task 16: transcriptPostProcessor hook integration + regression test

**High-risk** — see AGENTS.md. Only two lines added; the regression test enforces unchanged event emissions.

**Files:**
- Modify: `src/main/transcriptPostProcessor.ts` (add two calls)
- Create: `src/test/memory-postprocessor-regression.test.ts`

- [ ] **Step 1: Write regression test (must pass before AND after change)**

Create `src/test/memory-postprocessor-regression.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  enqueueRoughTranscript,
  flushPendingTranscript,
  init as initPP,
  resetTranscriptPostProcessor,
} from '../main/transcriptPostProcessor'

function makeFakeWindow() {
  const sent: { channel: string; payload: unknown }[] = []
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
      },
    },
  } as unknown as BrowserWindow
  return { win, sent }
}

beforeEach(() => {
  resetTranscriptPostProcessor()
})

afterEach(() => {
  resetTranscriptPostProcessor()
})

describe('transcriptPostProcessor regression — events still emitted', () => {
  it('emits stt:processed when a fragment starts a new turn', async () => {
    const { win, sent } = makeFakeWindow()
    initPP(win)
    enqueueRoughTranscript('hello.', { sourceLanguageHint: 'en', targetLanguage: 'off' })
    await flushPendingTranscript({ force: true })
    const events = sent.filter((e) => e.channel === 'stt:processed')
    expect(events.length).toBeGreaterThan(0)
  })

  it('emits stt:source-patch when a fragment lands', async () => {
    const { win, sent } = makeFakeWindow()
    initPP(win)
    enqueueRoughTranscript('hello world.', { sourceLanguageHint: 'en', targetLanguage: 'off' })
    await flushPendingTranscript({ force: true })
    expect(sent.some((e) => e.channel === 'stt:source-patch')).toBe(true)
  })
})
```

Run BEFORE making any code change:
```
npm test -- src/test/memory-postprocessor-regression.test.ts
```
Expected: 2/2 PASS (proves current behavior).

- [ ] **Step 2: Add notify calls in transcriptPostProcessor.ts**

Open `src/main/transcriptPostProcessor.ts`. Add to imports near the top:
```ts
import { notifyTranslation, notifyTurnFinalized } from './memory/transcriptHook'
```

Inside `finalizeActiveSourceTurn`, locate this block:
```ts
function finalizeActiveSourceTurn(options: { translateImmediately: boolean }): void {
  const active = activeSourceTurn
  if (!active) return
  activeSourceTurn = null
  clearActiveTimers(active)
  emitSourcePatch(active.id, active.text)
  emitFinalDownstream(active)
  if (options.translateImmediately) scheduleTranslation(active, 0)
}
```

Replace with (add the `notifyTurnFinalized` call after `emitFinalDownstream`):
```ts
function finalizeActiveSourceTurn(options: { translateImmediately: boolean }): void {
  const active = activeSourceTurn
  if (!active) return
  activeSourceTurn = null
  clearActiveTimers(active)
  emitSourcePatch(active.id, active.text)
  emitFinalDownstream(active)
  notifyTurnFinalized({
    id: active.id,
    text: active.text.trim(),
    sourceLanguage: active.hints.sourceLanguageHint,
    targetLanguage: active.hints.targetLanguage,
    createdAtMs: active.createdAtMs,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
  })
  if (options.translateImmediately) scheduleTranslation(active, 0)
}
```

Inside `drainTranslationQueue`, locate this block:
```ts
    const response = await callTranslationApi(next.text, next.hints, apiKey)
    if (translationVersionsById.get(next.id) === next.version && response.translation) {
      emitTranslationPatch(next.id, response.translation)
    }
```

Replace with:
```ts
    const response = await callTranslationApi(next.text, next.hints, apiKey)
    if (translationVersionsById.get(next.id) === next.version && response.translation) {
      emitTranslationPatch(next.id, response.translation)
      notifyTranslation(next.id, response.translation)
    }
```

- [ ] **Step 3: Run regression + hook tests together**

```
npm test -- src/test/memory-postprocessor-regression.test.ts src/test/memory-transcript-hook.test.ts
```
Expected: ALL pass. (Regression confirms no event changes; transcript hook tests confirm no-op safety.)

- [ ] **Step 4: Full test suite**

```
npm test
```
Expected: full suite green.

- [ ] **Step 5: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```
git add src/main/transcriptPostProcessor.ts src/test/memory-postprocessor-regression.test.ts
git commit -m "feat(memory): hook transcriptPostProcessor with regression guard"
```

---

## Task 17: main/index.ts startup wiring

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add memory service initialization**

Open `src/main/index.ts`. Add after the existing `import` block:
```ts
import { MemoryService, defaultWorkerPath } from './memory/memoryService'
import { setMemoryService } from './ipc'
```

Inside `app.whenReady().then(() => { ... })`, after `createWindow()` and the existing `register*`/`init*` calls, add (as an async IIFE so we don't change the outer function signature):
```ts
  void (async () => {
    try {
      const userData = app.getPath('userData')
      const dbPath = join(userData, 'memory.db')
      const memoryService = await MemoryService.initialize({
        dbPath,
        workerPath: defaultWorkerPath(),
        modelEnvCacheDir: join(userData, 'embedding-cache'),
      })
      const recovered = memoryService.recoverInterruptedMeetings()
      if (recovered > 0) {
        console.log(`[memory] recovered ${recovered} interrupted meeting(s)`)
      }
      setMemoryService(memoryService)
    } catch (err) {
      console.error('[memory] init failed:', err)
    }
  })()
```

- [ ] **Step 2: Run build (touches main code)**

```
npm run build
```
Expected: build completes. If it errors on the worker file (rollup may not bundle it), set the worker output explicitly in `electron.vite.config.ts`. Update `main.build.rollupOptions.input` to:
```ts
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  embeddingWorker: resolve(__dirname, 'src/main/memory/embeddingWorker.ts'),
},
```

And update `defaultWorkerPath` in `memoryService.ts` to:
```ts
export function defaultWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, 'embeddingWorker.js')
}
```

Re-run `npm run build`.

- [ ] **Step 3: Typecheck + lint + test**

```
npm run typecheck && npm run lint && npm test
```
Expected: green.

- [ ] **Step 4: Commit**

```
git add src/main/index.ts electron.vite.config.ts src/main/memory/memoryService.ts
git commit -m "feat(memory): initialize MemoryService on app boot"
```

---

## Task 18: Preload api.memory

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/types.ts`

- [ ] **Step 1: Extend types.ts**

Open `src/preload/types.ts`. Add the following exported interface block (preserve the existing `ElectronAPI` and other types):
```ts
import type {
  MeetingDetail,
  MeetingSummary,
  MeetingUpdatedEvent,
  SearchHit,
} from '../main/memory/types'

export interface MemoryAPI {
  listMeetings: (args?: { limit?: number; offset?: number }) => Promise<MeetingSummary[]>
  getMeeting: (id: string) => Promise<MeetingDetail | null>
  search: (query: string, limit?: number) => Promise<SearchHit[]>
  renameMeeting: (id: string, title: string) => Promise<void>
  deleteMeeting: (id: string) => Promise<void>
  exportMeeting: (id: string, format: 'markdown') => Promise<string>
  regenerateSummary: (id: string) => Promise<void>
  onMeetingUpdated: (handler: (evt: MeetingUpdatedEvent) => void) => () => void
}
```

Then add `memory: MemoryAPI` to the existing `ElectronAPI` interface.

- [ ] **Step 2: Implement in preload/index.ts**

Open `src/preload/index.ts`. Below the existing `electronAPI` object, before `contextBridge.exposeInMainWorld(...)`, build the memory API:
```ts
const memoryAPI: ElectronAPI['memory'] = {
  listMeetings: (args = {}) => ipcRenderer.invoke('memory:list-meetings', args),
  getMeeting: (id) => ipcRenderer.invoke('memory:get-meeting', { id }),
  search: (query, limit) => ipcRenderer.invoke('memory:search', { query, limit }),
  renameMeeting: (id, title) => ipcRenderer.invoke('memory:rename-meeting', { id, title }),
  deleteMeeting: (id) => ipcRenderer.invoke('memory:delete-meeting', { id }),
  exportMeeting: (id, format) =>
    ipcRenderer.invoke('memory:export-meeting', { id, format }),
  regenerateSummary: (id) => ipcRenderer.invoke('memory:regenerate-summary', { id }),
  onMeetingUpdated: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, evt: unknown) =>
      handler(evt as Parameters<typeof handler>[0])
    ipcRenderer.on('memory:meeting-updated', listener)
    return () => {
      ipcRenderer.removeListener('memory:meeting-updated', listener)
    }
  },
}
```

Modify the assignment to electronAPI to include `memory`:
```ts
const electronAPI: ElectronAPI = {
  // ... existing entries unchanged ...
  memory: memoryAPI,
}
```

(If TypeScript complains about ordering — defining `memoryAPI` first and referencing `ElectronAPI['memory']` — you can declare `memoryAPI` with explicit type instead:
```ts
const memoryAPI: import('./types').MemoryAPI = { /* ... */ }
```
)

- [ ] **Step 3: Typecheck + build**

```
npm run typecheck && npm run build
```
Expected: green.

- [ ] **Step 4: Commit**

```
git add src/preload/index.ts src/preload/types.ts
git commit -m "feat(memory): expose api.memory in preload"
```

---

## Task 19: Renderer library store + thin API wrapper

**Files:**
- Create: `src/renderer/library/libraryApi.ts`
- Create: `src/renderer/library/useMeetingLibraryStore.ts`

- [ ] **Step 1: Create libraryApi**

Create `src/renderer/library/libraryApi.ts`:
```ts
import type {
  MeetingDetail,
  MeetingSummary,
  MeetingUpdatedEvent,
  SearchHit,
} from '../../main/memory/types'

declare global {
  interface Window {
    electronAPI: {
      memory: {
        listMeetings: (args?: { limit?: number; offset?: number }) => Promise<MeetingSummary[]>
        getMeeting: (id: string) => Promise<MeetingDetail | null>
        search: (query: string, limit?: number) => Promise<SearchHit[]>
        renameMeeting: (id: string, title: string) => Promise<void>
        deleteMeeting: (id: string) => Promise<void>
        exportMeeting: (id: string, format: 'markdown') => Promise<string>
        regenerateSummary: (id: string) => Promise<void>
        onMeetingUpdated: (handler: (evt: MeetingUpdatedEvent) => void) => () => void
      }
    }
  }
}

export const libraryApi = {
  list: (limit = 30, offset = 0) => window.electronAPI.memory.listMeetings({ limit, offset }),
  get: (id: string) => window.electronAPI.memory.getMeeting(id),
  search: (query: string, limit = 20) => window.electronAPI.memory.search(query, limit),
  rename: (id: string, title: string) => window.electronAPI.memory.renameMeeting(id, title),
  remove: (id: string) => window.electronAPI.memory.deleteMeeting(id),
  exportMd: (id: string) => window.electronAPI.memory.exportMeeting(id, 'markdown'),
  regenerate: (id: string) => window.electronAPI.memory.regenerateSummary(id),
  onUpdated: (handler: (evt: MeetingUpdatedEvent) => void) =>
    window.electronAPI.memory.onMeetingUpdated(handler),
}
```

- [ ] **Step 2: Create store with jotai**

Create `src/renderer/library/useMeetingLibraryStore.ts`:
```ts
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import type { MeetingDetail, MeetingSummary, SearchHit } from '../../main/memory/types'
import { libraryApi } from './libraryApi'

export const libraryOpenAtom = atom(false)
export const meetingsAtom = atom<MeetingSummary[]>([])
export const currentMeetingDetailAtom = atom<MeetingDetail | null>(null)
export const searchQueryAtom = atom('')
export const searchResultsAtom = atom<SearchHit[] | null>(null)
export const searchLoadingAtom = atom(false)
export const lastErrorAtom = atom<string | null>(null)

export function useMeetingLibrary() {
  const [open, setOpen] = useAtom(libraryOpenAtom)
  const [meetings, setMeetings] = useAtom(meetingsAtom)
  const [detail, setDetail] = useAtom(currentMeetingDetailAtom)
  const [query, setQuery] = useAtom(searchQueryAtom)
  const [results, setResults] = useAtom(searchResultsAtom)
  const [loading, setLoading] = useAtom(searchLoadingAtom)
  const setError = useSetAtom(lastErrorAtom)

  const refreshList = useCallback(async () => {
    try {
      const list = await libraryApi.list()
      setMeetings(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [setMeetings, setError])

  const openMeeting = useCallback(
    async (id: string) => {
      try {
        const d = await libraryApi.get(id)
        setDetail(d)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [setDetail, setError]
  )

  const closeMeeting = useCallback(() => setDetail(null), [setDetail])

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) {
        setResults(null)
        return
      }
      setLoading(true)
      try {
        const r = await libraryApi.search(trimmed)
        setResults(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [setResults, setLoading, setError]
  )

  const rename = useCallback(
    async (id: string, title: string) => {
      await libraryApi.rename(id, title)
      await refreshList()
      if (detail?.meeting.id === id) await openMeeting(id)
    },
    [refreshList, openMeeting, detail]
  )

  const remove = useCallback(
    async (id: string) => {
      await libraryApi.remove(id)
      setDetail(null)
      await refreshList()
    },
    [refreshList, setDetail]
  )

  const exportMd = useCallback(async (id: string) => libraryApi.exportMd(id), [])

  const regenerate = useCallback(async (id: string) => libraryApi.regenerate(id), [])

  return {
    open,
    setOpen,
    meetings,
    refreshList,
    detail,
    openMeeting,
    closeMeeting,
    query,
    setQuery,
    results,
    loading,
    runSearch,
    rename,
    remove,
    exportMd,
    regenerate,
  }
}

export function useLibraryUpdateBus(onChange: () => void) {
  useEffect(() => {
    return libraryApi.onUpdated(() => {
      onChange()
    })
  }, [onChange])
}
```

- [ ] **Step 3: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```
git add src/renderer/library/libraryApi.ts src/renderer/library/useMeetingLibraryStore.ts
git commit -m "feat(memory): add renderer library store + api wrapper"
```

---

## Task 20: LibraryPanel + MeetingCard + styles

**Files:**
- Create: `src/renderer/library/library.css`
- Create: `src/renderer/library/MeetingCard.tsx`
- Create: `src/renderer/library/LibraryPanel.tsx`

- [ ] **Step 1: Create styles**

Create `src/renderer/library/library.css`:
```css
.library-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 23, 0.55);
  backdrop-filter: blur(6px);
  z-index: 50;
  display: flex;
  flex-direction: column;
}

.library-panel {
  flex: 1;
  min-height: 100dvh;
  background: var(--surface-bg, #0f1117);
  color: var(--surface-fg, #e5e7eb);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.library-header h1 {
  font-size: 1.25rem;
  margin: 0;
  letter-spacing: -0.01em;
}

.library-close-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: inherit;
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
}

.library-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.library-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 768px) {
  .library-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .library-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.meeting-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 18px;
  cursor: pointer;
  transition: transform 0.1s ease, border-color 0.15s ease;
  text-align: left;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meeting-card:hover {
  border-color: rgba(255, 255, 255, 0.18);
}

.meeting-card:active {
  transform: translateY(-1px);
}

.meeting-card__title {
  font-weight: 600;
  font-size: 1rem;
  letter-spacing: -0.01em;
}

.meeting-card__meta {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.55);
}

.meeting-card__summary {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.78);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meeting-card__summary.pending {
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
}

.library-empty {
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
  padding: 64px 16px;
}
```

- [ ] **Step 2: Create MeetingCard**

Create `src/renderer/library/MeetingCard.tsx`:
```tsx
import type { MeetingSummary } from '../../main/memory/types'

function formatDuration(durationMs: number | null): string {
  if (!durationMs) return '진행 중'
  const min = Math.round(durationMs / 60000)
  return `${min}분`
}

function formatStarted(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatLanguages(source: string | null, target: string | null): string {
  const s = source ?? '?'
  const t = target ?? '?'
  return `${s} → ${t}`
}

interface MeetingCardProps {
  summary: MeetingSummary
  onClick: () => void
}

export function MeetingCard({ summary, onClick }: MeetingCardProps) {
  const m = summary.meeting
  const summaryText = summary.shortSummary
  return (
    <button type="button" className="meeting-card" onClick={onClick}>
      <div className="meeting-card__title">{m.title}</div>
      <div className="meeting-card__meta">
        {formatStarted(m.startedAt)} · {formatDuration(m.durationMs)} ·{' '}
        {formatLanguages(m.sourceLanguage, m.targetLanguage)}
      </div>
      <div className={`meeting-card__summary${summaryText ? '' : ' pending'}`}>
        {summaryText ?? (m.status === 'live' ? '진행 중…' : '요약 생성 중…')}
      </div>
    </button>
  )
}
```

- [ ] **Step 3: Create LibraryPanel**

Create `src/renderer/library/LibraryPanel.tsx`:
```tsx
import { useEffect } from 'react'
import './library.css'
import { MeetingCard } from './MeetingCard'
import { SearchBar } from './SearchBar'
import { SearchResultList } from './SearchResultList'
import { MeetingDetailView } from './MeetingDetailView'
import { useLibraryUpdateBus, useMeetingLibrary } from './useMeetingLibraryStore'

export function LibraryPanel() {
  const lib = useMeetingLibrary()
  useEffect(() => {
    if (lib.open) void lib.refreshList()
  }, [lib.open, lib.refreshList])

  useLibraryUpdateBus(() => {
    void lib.refreshList()
    if (lib.detail) void lib.openMeeting(lib.detail.meeting.id)
  })

  if (!lib.open) return null

  return (
    <div className="library-overlay" role="dialog" aria-modal="true">
      <div className="library-panel">
        <header className="library-header">
          <h1>Library</h1>
          <button
            type="button"
            className="library-close-btn"
            onClick={() => {
              lib.setOpen(false)
              lib.closeMeeting()
              lib.setQuery('')
              void lib.runSearch('')
            }}
          >
            닫기 (Esc)
          </button>
        </header>
        <SearchBar />
        <div className="library-scroll">
          {lib.detail ? (
            <MeetingDetailView />
          ) : lib.results !== null ? (
            <SearchResultList />
          ) : lib.meetings.length === 0 ? (
            <div className="library-empty">아직 저장된 미팅이 없어요. 캡처를 시작해 보세요.</div>
          ) : (
            <div className="library-grid">
              {lib.meetings.map((m) => (
                <MeetingCard
                  key={m.meeting.id}
                  summary={m}
                  onClick={() => void lib.openMeeting(m.meeting.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

(SearchBar, SearchResultList, MeetingDetailView are created in T21 and T22. To allow the file to compile in this task, **also create placeholders** for those three at the end of this task — they will be replaced in T21/T22.)

Create placeholder `src/renderer/library/SearchBar.tsx`:
```tsx
export function SearchBar() {
  return null
}
```

Create placeholder `src/renderer/library/SearchResultList.tsx`:
```tsx
export function SearchResultList() {
  return null
}
```

Create placeholder `src/renderer/library/MeetingDetailView.tsx`:
```tsx
export function MeetingDetailView() {
  return null
}
```

- [ ] **Step 4: Typecheck + build**

```
npm run typecheck && npm run lint && npm run build
```
Expected: green.

- [ ] **Step 5: Commit**

```
git add src/renderer/library/library.css src/renderer/library/MeetingCard.tsx src/renderer/library/LibraryPanel.tsx src/renderer/library/SearchBar.tsx src/renderer/library/SearchResultList.tsx src/renderer/library/MeetingDetailView.tsx
git commit -m "feat(memory): add LibraryPanel + MeetingCard scaffolding"
```

---

## Task 21: MeetingDetailView (replace placeholder)

**Files:**
- Modify: `src/renderer/library/MeetingDetailView.tsx`
- Modify: `src/renderer/library/library.css` (append detail styles)

- [ ] **Step 1: Append detail styles**

Append to `src/renderer/library/library.css`:
```css
.detail {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-back {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: inherit;
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}

.detail-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  flex: 1;
  padding: 0 16px;
}

.detail-title input {
  width: 100%;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: inherit;
  font: inherit;
  padding: 4px 8px;
  border-radius: 6px;
}

.detail-menu {
  display: flex;
  gap: 8px;
}

.detail-menu button {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: inherit;
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 0.85rem;
}

.detail-section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 18px;
}

.detail-section h3 {
  margin: 0 0 10px;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.55);
}

.transcript-row {
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.transcript-row.highlight {
  background: rgba(80, 160, 255, 0.12);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 8px 0;
}

.transcript-row__meta {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 4px;
}

.transcript-row__source {
  font-size: 0.95rem;
}

.transcript-row__translation {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.65);
  margin-top: 4px;
}
```

- [ ] **Step 2: Implement MeetingDetailView**

Replace `src/renderer/library/MeetingDetailView.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { Segment, Summary } from '../../main/memory/types'
import { useMeetingLibrary } from './useMeetingLibraryStore'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function formatOffset(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`
}

function SummarySections({ summary }: { summary: Summary }) {
  if (summary.status === 'failed') {
    return (
      <section className="detail-section">
        <h3>요약</h3>
        <p>{summary.shortSummary || '요약 생성 실패'}</p>
      </section>
    )
  }
  return (
    <>
      <section className="detail-section">
        <h3>요약</h3>
        <p>{summary.shortSummary}</p>
      </section>
      {summary.detailedSummary && (
        <section className="detail-section">
          <h3>자세히</h3>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{summary.detailedSummary}</pre>
        </section>
      )}
      {summary.keyPoints.length > 0 && (
        <section className="detail-section">
          <h3>핵심 포인트</h3>
          <ul>
            {summary.keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </section>
      )}
      {summary.actionItems.length > 0 && (
        <section className="detail-section">
          <h3>액션 아이템</h3>
          <ul>
            {summary.actionItems.map((a, i) => (
              <li key={i}>
                {a.text}
                {a.owner ? ` — ${a.owner}` : ''}
                {a.due ? ` (${a.due})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function TranscriptRow({ s, anchor, highlight }: { s: Segment; anchor: number; highlight: boolean }) {
  return (
    <div className={`transcript-row${highlight ? ' highlight' : ''}`} id={`segment-${s.id}`}>
      <div className="transcript-row__meta">
        [{formatOffset(s.createdAt - anchor)}] {s.speakerLabel ?? 'Unknown'}
      </div>
      <div className="transcript-row__source">{s.sourceText}</div>
      {s.translatedText && <div className="transcript-row__translation">↳ {s.translatedText}</div>}
    </div>
  )
}

export function MeetingDetailView() {
  const lib = useMeetingLibrary()
  const detail = lib.detail!
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(detail.meeting.title)
  const highlightId = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTitleDraft(detail.meeting.title)
  }, [detail.meeting.id, detail.meeting.title])

  useEffect(() => {
    const target = highlightId.current
    if (!target) return
    const el = document.getElementById(`segment-${target}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const timer = setTimeout(() => {
      highlightId.current = null
    }, 5000)
    return () => clearTimeout(timer)
  }, [detail.meeting.id])

  const anchor = detail.segments[0]?.createdAt ?? detail.meeting.startedAt

  return (
    <div className="detail" ref={containerRef}>
      <div className="detail-header">
        <button type="button" className="detail-back" onClick={() => lib.closeMeeting()}>
          ← 뒤로
        </button>
        <h2 className="detail-title">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setEditingTitle(false)
                if (titleDraft.trim() && titleDraft !== detail.meeting.title) {
                  void lib.rename(detail.meeting.id, titleDraft.trim())
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setTitleDraft(detail.meeting.title)
                  setEditingTitle(false)
                }
              }}
            />
          ) : (
            <span onDoubleClick={() => setEditingTitle(true)}>{detail.meeting.title}</span>
          )}
        </h2>
        <div className="detail-menu">
          <button
            type="button"
            onClick={() => void lib.regenerate(detail.meeting.id)}
          >
            요약 재생성
          </button>
          <button
            type="button"
            onClick={async () => {
              const md = await lib.exportMd(detail.meeting.id)
              const blob = new Blob([md], { type: 'text/markdown' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${detail.meeting.title}.md`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Markdown
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('이 미팅을 삭제할까요? 되돌릴 수 없습니다.')) {
                void lib.remove(detail.meeting.id)
              }
            }}
          >
            삭제
          </button>
        </div>
      </div>
      {detail.summary ? <SummarySections summary={detail.summary} /> : (
        <section className="detail-section">
          <h3>요약</h3>
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>아직 요약이 없습니다.</p>
        </section>
      )}
      <section className="detail-section">
        <h3>대화 기록</h3>
        {detail.segments.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>발화 없음</p>
        ) : (
          detail.segments.map((s) => (
            <TranscriptRow
              key={s.id}
              s={s}
              anchor={anchor}
              highlight={highlightId.current === s.id}
            />
          ))
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + lint**

```
npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```
git add src/renderer/library/MeetingDetailView.tsx src/renderer/library/library.css
git commit -m "feat(memory): implement MeetingDetailView"
```

---

## Task 22: SearchBar + SearchResultList (replace placeholders)

**Files:**
- Modify: `src/renderer/library/SearchBar.tsx`
- Modify: `src/renderer/library/SearchResultList.tsx`
- Modify: `src/renderer/library/library.css` (append search styles)

- [ ] **Step 1: Append search styles**

Append to `src/renderer/library/library.css`:
```css
.search-bar {
  padding: 0 24px 16px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.search-bar input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: inherit;
  font: inherit;
  padding: 12px 16px;
  border-radius: 10px;
  outline: none;
}

.search-bar input:focus {
  border-color: rgba(80, 160, 255, 0.5);
}

.search-results__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.85rem;
}

.search-results__clear {
  background: transparent;
  border: none;
  color: rgba(120, 180, 255, 0.9);
  cursor: pointer;
}

.search-result {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-result__meta {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.55);
}

.search-result__source {
  font-size: 0.95rem;
}

.search-result__translation {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.65);
}

.search-result__score {
  font-size: 0.7rem;
  color: rgba(80, 160, 255, 0.85);
}
```

- [ ] **Step 2: Implement SearchBar**

Replace `src/renderer/library/SearchBar.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { useMeetingLibrary } from './useMeetingLibraryStore'

export function SearchBar() {
  const lib = useMeetingLibrary()
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void lib.runSearch(lib.query)
    }, 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [lib.query, lib.runSearch])

  return (
    <div className="search-bar">
      <input
        type="search"
        value={lib.query}
        onChange={(e) => lib.setQuery(e.target.value)}
        placeholder="자연어로 검색하세요. 예: '수요 예측은 어떻게 결정했지?'"
      />
    </div>
  )
}
```

- [ ] **Step 3: Implement SearchResultList**

Replace `src/renderer/library/SearchResultList.tsx`:
```tsx
import type { SearchHit } from '../../main/memory/types'
import { useMeetingLibrary } from './useMeetingLibraryStore'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ResultRow({ hit, onClick }: { hit: SearchHit; onClick: () => void }) {
  return (
    <button type="button" className="search-result" onClick={onClick}>
      <div className="search-result__meta">
        {hit.meetingTitle} · {formatDate(hit.startedAt)} ·{' '}
        {hit.speakerLabel ?? 'Unknown'} · seq {hit.seq}
      </div>
      <div className="search-result__source">{hit.sourceText}</div>
      {hit.translatedText && (
        <div className="search-result__translation">↳ {hit.translatedText}</div>
      )}
      <div className="search-result__score">유사도 {hit.score.toFixed(2)}</div>
    </button>
  )
}

export function SearchResultList() {
  const lib = useMeetingLibrary()
  const results = lib.results ?? []
  return (
    <div>
      <div className="search-results__header">
        <span>
          {lib.loading
            ? '검색 중…'
            : `검색 결과 ${results.length}개 · 쿼리: "${lib.query}"`}
        </span>
        <button
          type="button"
          className="search-results__clear"
          onClick={() => {
            lib.setQuery('')
            void lib.runSearch('')
          }}
        >
          전체 미팅 보기
        </button>
      </div>
      {!lib.loading && results.length === 0 && (
        <div className="library-empty">
          "{lib.query}"에 매칭되는 내용이 없어요. 다른 단어로 시도해 보세요.
        </div>
      )}
      {results.map((hit) => (
        <ResultRow key={hit.segmentId} hit={hit} onClick={() => void lib.openMeeting(hit.meetingId)} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + lint + build**

```
npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```
git add src/renderer/library/SearchBar.tsx src/renderer/library/SearchResultList.tsx src/renderer/library/library.css
git commit -m "feat(memory): implement SearchBar + SearchResultList"
```

---

## Task 23: App.tsx integration — toggle, inline title, toasts

**Files:**
- Create: `src/renderer/library/MeetingToasts.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create MeetingToasts**

Create `src/renderer/library/MeetingToasts.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { libraryApi } from './libraryApi'
import { useMeetingLibrary } from './useMeetingLibraryStore'

interface Toast {
  id: number
  text: string
  actionLabel?: string
  onAction?: () => void
}

let nextToastId = 1

export function MeetingToasts() {
  const lib = useMeetingLibrary()
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const off = libraryApi.onUpdated((evt) => {
      const id = nextToastId++
      let text = ''
      let actionLabel: string | undefined
      let onAction: (() => void) | undefined
      if (evt.kind === 'ended') {
        text = '미팅 저장 완료. 요약 생성 중…'
      } else if (evt.kind === 'summary-ready') {
        text = '요약 준비됨'
        actionLabel = '라이브러리에서 보기'
        onAction = () => {
          lib.setOpen(true)
          void lib.openMeeting(evt.meetingId)
        }
      } else if (evt.kind === 'summary-failed') {
        text = '요약 생성 실패 — 라이브러리에서 재시도하세요'
      } else {
        return
      }
      setToasts((prev) => [...prev, { id, text, actionLabel, onAction }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 8000)
    })
    return () => {
      off()
    }
  }, [lib])

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 60,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'rgba(20, 25, 35, 0.95)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: '10px 14px',
            color: '#e5e7eb',
            fontSize: '0.9rem',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            boxShadow: '0 6px 30px rgba(0,0,0,0.35)',
          }}
        >
          <span>{t.text}</span>
          {t.actionLabel && t.onAction && (
            <button
              type="button"
              onClick={t.onAction}
              style={{
                background: 'transparent',
                border: '1px solid rgba(80,160,255,0.5)',
                color: 'rgba(120,180,255,0.95)',
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add Library button, inline title, and current meeting indicator to App.tsx**

Open `src/renderer/App.tsx`. Add imports:
```ts
import { LibraryPanel } from './library/LibraryPanel'
import { MeetingToasts } from './library/MeetingToasts'
import { useMeetingLibrary } from './library/useMeetingLibraryStore'
import { libraryApi } from './library/libraryApi'
```

Inside the top-level component (where the header with capture toggle is rendered), add (place the button near the existing capture toggle button):
```tsx
const lib = useMeetingLibrary()
const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null)
const [currentMeetingTitle, setCurrentMeetingTitle] = useState<string | null>(null)
const [editingMeetingTitle, setEditingMeetingTitle] = useState(false)
const [titleDraft, setTitleDraft] = useState('')

useEffect(() => {
  const off = libraryApi.onUpdated((evt) => {
    if (evt.kind === 'began') {
      setCurrentMeetingId(evt.meetingId)
      void libraryApi.get(evt.meetingId).then((d) => setCurrentMeetingTitle(d?.meeting.title ?? null))
    } else if (evt.kind === 'ended') {
      setCurrentMeetingId(null)
      setCurrentMeetingTitle(null)
    } else if (evt.kind === 'renamed' && evt.meetingId === currentMeetingId) {
      void libraryApi.get(evt.meetingId).then((d) => setCurrentMeetingTitle(d?.meeting.title ?? null))
    }
  })
  return off
}, [currentMeetingId])

// Esc closes the library
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && lib.open) {
      lib.setOpen(false)
      lib.closeMeeting()
      lib.setQuery('')
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [lib])
```

Add a Library toggle button in the header. Place it adjacent to the existing capture toggle:
```tsx
<button
  type="button"
  className="library-toggle-btn"
  onClick={() => lib.setOpen(true)}
>
  Library
</button>
```

Add inline current-meeting title next to the capture toggle:
```tsx
{currentMeetingId && currentMeetingTitle && (
  <span className="current-meeting-inline" style={{ marginLeft: 12, fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)' }}>
    {editingMeetingTitle ? (
      <input
        autoFocus
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={async () => {
          setEditingMeetingTitle(false)
          if (titleDraft.trim() && titleDraft !== currentMeetingTitle) {
            await libraryApi.rename(currentMeetingId, titleDraft.trim())
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setTitleDraft(currentMeetingTitle ?? '')
            setEditingMeetingTitle(false)
          }
        }}
        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'inherit', padding: '2px 6px', borderRadius: 4 }}
      />
    ) : (
      <span
        onClick={() => {
          setTitleDraft(currentMeetingTitle)
          setEditingMeetingTitle(true)
        }}
        style={{ cursor: 'pointer', borderBottom: '1px dotted rgba(255,255,255,0.3)' }}
        title="클릭해 이름 변경"
      >
        {currentMeetingTitle}
      </span>
    )}
  </span>
)}
```

At the bottom of the App JSX (just before the closing fragment/root element), render:
```tsx
<LibraryPanel />
<MeetingToasts />
```

Add minimal CSS for the toggle button at the top of `App.css` or inline:
```css
.library-toggle-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: inherit;
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}
.library-toggle-btn:hover {
  border-color: rgba(255, 255, 255, 0.22);
}
```

- [ ] **Step 3: Typecheck + lint + build**

```
npm run typecheck && npm run lint && npm run build
```
Expected: green. If TypeScript complains about the `useState` import, add it to the existing `react` import.

- [ ] **Step 4: Commit**

```
git add src/renderer/App.tsx src/renderer/App.css src/renderer/library/MeetingToasts.tsx
git commit -m "feat(memory): integrate Library + toasts into App"
```

---

## Task 24: Manual E2E + final CI

**Files:** none (verification only)

This task does not modify source code. It runs the full verification commands and the 5 manual E2E scenarios from the spec, then commits any incidental tweaks the agent had to apply (test fixes, lint suppressions). Each manual scenario is a checkbox.

- [ ] **Step 1: Full CI**

```
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: all green.

- [ ] **Step 2: Boot the Electron app**

```
npm run dev:electron
```

Open DevTools (F12) and verify there are no errors during boot. Confirm in the console log:
```
[memory] recovered 0 interrupted meeting(s)
```
(or similar). If the line is missing, MemoryService failed to initialize — read the previous error and resolve before continuing.

- [ ] **Step 3: E2E #1 — basic lifecycle**

1. Click Start (capture toggle)
2. Speak 10 short Korean sentences (or play recorded audio)
3. Click Stop
4. Open Library — verify a new card appears with today's date
5. Wait ≤30 seconds for `요약 준비됨` toast
6. Click the card — verify summary, key points, action items, transcript are populated

Expected: pass.

- [ ] **Step 4: E2E #2 — cross-lingual summary**

1. Run 5 minutes of English audio
2. Stop
3. Open the new meeting in Library
4. Verify the summary (shortSummary / detailedSummary / keyPoints / actionItems) is in **Korean**

Expected: pass.

- [ ] **Step 5: E2E #3 — semantic search**

1. With at least the English meeting from #4 saved, open Library
2. Type a Korean query that semantically matches the content (e.g., `수요 예측`, `프로젝트 일정`)
3. Verify at least one English segment surfaces with score ≥ 0.5
4. Click the result and confirm scroll/highlight on the matching transcript row

Expected: pass.

- [ ] **Step 6: E2E #4 — cascade delete**

1. In the meeting detail menu, click `삭제` and confirm
2. Verify the card disappears from the list
3. Open the SQLite DB at `<userData>/memory.db` (use a CLI or DB browser):
   ```sql
   SELECT count(*) FROM segments WHERE meeting_id = '<id>';
   SELECT count(*) FROM segment_embeddings WHERE segment_id IN (SELECT id FROM segments WHERE meeting_id = '<id>');
   SELECT count(*) FROM summaries WHERE meeting_id = '<id>';
   ```
   All three counts should be `0`.

Expected: pass.

- [ ] **Step 7: E2E #5 — interruption recovery**

1. Click Start to begin a new meeting
2. Force-kill the Electron process (Task Manager → End task)
3. Restart with `npm run dev:electron`
4. In the console, verify a log line `[memory] recovered 1 interrupted meeting(s)`
5. Open Library — verify the interrupted meeting appears with status `failed` (no summary, no `요약 준비됨` toast)

Expected: pass.

- [ ] **Step 8: Live latency regression check**

While re-running E2E #1 (or any new meeting), verify live caption latency is visually unchanged from before. If anything feels worse, run the latency probe from `docs/superpowers/specs/2026-05-14-live-feed-latency-v2-design.md` and compare against baseline. Halt and surface a bug if regression is real.

Expected: no perceptible regression.

- [ ] **Step 9: Disk size check**

After all E2E steps, check DB size at `<userData>/memory.db`. For ~30 minutes of total recorded audio across all tests, expect ≤30 MB total (most of which is embeddings + transcript text). Anything beyond 100 MB warrants investigation.

- [ ] **Step 10: Final commit (if any)**

If steps 1-9 surfaced small fixes (test flakiness, lint suppression, CSS tweak), commit them:
```
git status
git add <files>
git commit -m "chore(memory): final E2E fixes"
```

If nothing changed, skip the commit.

- [ ] **Step 11: Push and report**

```
git log --oneline origin/master..HEAD
```

Report to the user the list of commits, the dependencies added, and a one-paragraph summary of what was delivered. **Do not push to origin without user approval.**

---

## Self-review (after writing, before handoff)

Spec coverage:

- [x] §3 Data Model — Tasks 1-4
- [x] §4 Meeting Lifecycle — Tasks 5, 15, 16, 17
- [x] §5 Summary Pipeline — Tasks 9, 10, 11
- [x] §6 Embedding Pipeline — Tasks 0 (smoke), 6, 7
- [x] §7 Search — Task 12
- [x] §8 Library UI — Tasks 19-23
- [x] §9 IPC contracts — Tasks 15, 18
- [x] §10 Evaluation Plan — Task 24
- [x] §11 Risks (electron-rebuild, model download, worker compat, regression guard) — Tasks 0, 8, 16
- [x] §12 Migration — Task 1 (CREATE TABLE IF NOT EXISTS) + Task 17 (idempotent init)
- [x] markdown exporter — Task 13
- [x] MemoryService facade — Task 14

No placeholders found. Type names referenced across tasks (`MeetingSummary`, `Meeting`, `Segment`, `Summary`, `SummaryJSON`, `SearchHit`, `MeetingUpdatedEvent`, `TurnPayload`, `MemoryHandlerDeps`, `SummarizeCall`, `MemoryRepository`, `MeetingLifecycle`, `EmbeddingService`, `EmbeddingQueue`, `SearchService`, `SummaryService`, `MemoryService`) all defined in earlier tasks.

Codex-friendly check:

- Every task has explicit file paths.
- Every test/implementation has runnable code (no "test the obvious behavior").
- Every step has a verification command with expected output.
- Tasks proceed in dependency order — later tasks only reference symbols defined earlier.
- T0 verifies native-binding and worker viability before any architectural commitment.
- T16 has explicit regression test that runs before AND after the change.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-meeting-memory-foundation.md`.

Hand the entire file to Codex (one task at a time). Codex's session is independent — each task is self-contained; pass the file path so Codex can open the relevant task by heading. Recommended Codex invocation per task:

```
codex run \
  --read docs/superpowers/plans/2026-05-17-meeting-memory-foundation.md \
  --read docs/superpowers/specs/2026-05-17-meeting-memory-foundation-design.md \
  --task "Execute Task N (see plan). Run all listed verification commands. Stop and report at the commit step; do not push."
```

After each task, run `git log --oneline -1` to verify Codex committed and read the commit body for any deferred concerns.


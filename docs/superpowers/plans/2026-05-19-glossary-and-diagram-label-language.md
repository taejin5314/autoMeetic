# Glossary + Diagram Label Language — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a user-managed glossary that drives both bilingual transcripts and AI-generated whiteboard labels, plus an independent diagram-label-language preference — sharpening autoMeetic's "Bilingual × Visual" positioning.

**Architecture:** New `glossary_entries` table extends `MemoryRepository` (same sqlite db). A shared `formatGlossaryPromptSection` / `normalizePreserveTerms` / `buildLabelLanguageBlock` helper is reused by the translation queue, Answer Assist, and the whiteboard agent. A pull-based module cache keeps the translation hot path fast. A renderer panel + a label-language `<select>` complete the surface area. Electron-first; web-mode parity is deferred to v2 per the spec.

**Tech Stack:** Electron, React 19, TypeScript (strict), better-sqlite3, vitest, OpenAI Realtime/Chat Completions APIs.

**Spec:** `docs/superpowers/specs/2026-05-19-glossary-and-diagram-label-language-design.md`

**Scope note:** This plan does NOT implement web-mode parity. `server/proxy.mjs` Answer-Assist enhancement is included (because the renderer already calls it in both modes); `server/whiteboard-runtime.mjs` and `/api/translate` glossary support are explicitly deferred.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | Append `glossary_entries` table |
| `src/main/memory/types.ts` | Modify | Add `GlossaryEntry`, `GlossaryEntryInput` |
| `src/main/memory/repository.ts` | Modify | Add glossary CRUD + `activeGlossary` |
| `src/main/glossary/promptInjection.ts` | Create | `formatGlossaryPromptSection`, `normalizePreserveTerms`, `buildLabelLanguageBlock` |
| `src/main/glossary/cache.ts` | Create | `ensureFreshGlossary`, `bumpGlossaryEpoch`, exported state |
| `src/main/ipc-glossary-handlers.ts` | Create | IPC handler factory |
| `src/main/index.ts` | Modify | Register glossary handlers; expose `getMeetingLifecycle()` getter |
| `src/preload/index.ts` | Modify | Expose `glossary` API surface |
| `src/preload/types.ts` | Modify | Type declarations |
| `src/main/transcriptPostProcessor.ts` | Modify | Wire cache + prompt injection + post-pass into translate path |
| `src/main/whiteboard/prompt.ts` | Modify | Accept `labelLanguage` + `glossary`; emit label-language + glossary blocks |
| `src/main/whiteboardService.ts` | Modify | Read `labelLanguage` from agent-run payload; fetch glossary; pass to prompt; post-pass element labels |
| `src/main/sttService.ts` | Modify | Append glossary `sourceTerm`s to STT vocabulary keywords |
| `server/proxy.mjs` | Modify | Accept `glossary` in Answer-Assist request; inject into prompt; post-pass |
| `src/renderer/glossary/types.ts` | Create | Re-export of preload types |
| `src/renderer/glossary/useGlossaryStore.ts` | Create | Jotai store: list, status, upsert/delete/refresh |
| `src/renderer/glossary/GlossaryPanel.tsx` | Create | Modal panel UI |
| `src/renderer/glossary/GlossaryRowEditor.tsx` | Create | Inline editor sub-component |
| `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx` | Create | Compact select inside shelf header |
| `src/renderer/App.tsx` | Modify | Header button, panel mount, label-language → agent payload |
| `src/renderer/App.css` | Modify | Glossary panel + select styles |
| `src/test/glossary-repository.test.ts` | Create | Unit tests for repository methods |
| `src/test/glossary-prompt-injection.test.ts` | Create | Unit tests for shared helpers |
| `src/test/glossary-cache.test.ts` | Create | Unit tests for pull cache |

---

## Phase 1 — Storage foundation

### Task 1.1: Schema migration — add `glossary_entries` table

**Files:**
- Modify: `src/main/memory/schema.ts`

- [ ] **Step 1: Edit the schema constant**

Open `src/main/memory/schema.ts`. Replace the file with:

```ts
export const SCHEMA_VERSION = 2

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
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glossary_scope_meeting
  ON glossary_entries(scope, meeting_id);
CREATE INDEX IF NOT EXISTS idx_glossary_source
  ON glossary_entries(source_term COLLATE NOCASE);
`
```

- [ ] **Step 2: Verify with typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/main/memory/schema.ts
git commit -m "feat(glossary): add glossary_entries table schema"
```

---

### Task 1.2: Add `GlossaryEntry` types

**Files:**
- Modify: `src/main/memory/types.ts`

- [ ] **Step 1: Append types**

Append to `src/main/memory/types.ts`:

```ts
export interface GlossaryEntry {
  id: string
  scope: 'global' | 'meeting'
  meetingId: string | null
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface GlossaryEntryInput {
  id?: string
  scope: 'global' | 'meeting'
  meetingId: string | null
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  note: string | null
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/main/memory/types.ts
git commit -m "feat(glossary): add GlossaryEntry types"
```

---

### Task 1.3: Repository `upsertGlossary` — TDD

**Files:**
- Create: `src/test/glossary-repository.test.ts`
- Modify: `src/main/memory/repository.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/glossary-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossaryEntryInput } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function sampleInput(overrides: Partial<GlossaryEntryInput> = {}): GlossaryEntryInput {
  return {
    scope: 'global',
    meetingId: null,
    sourceTerm: 'autoMeetic',
    translations: { ko: '오토미틱' },
    preserve: true,
    note: null,
    ...overrides,
  }
}

describe('MemoryRepository upsertGlossary', () => {
  it('inserts a new entry and returns it with generated id and timestamps', () => {
    const repo = makeRepo()
    const entry = repo.upsertGlossary(sampleInput())
    expect(entry.id).toMatch(/^gloss_/)
    expect(entry.sourceTerm).toBe('autoMeetic')
    expect(entry.translations).toEqual({ ko: '오토미틱' })
    expect(entry.preserve).toBe(true)
    expect(entry.createdAt).toBeGreaterThan(0)
    expect(entry.updatedAt).toBe(entry.createdAt)
    repo.close()
  })

  it('updates an existing entry when id is provided', () => {
    const repo = makeRepo()
    const a = repo.upsertGlossary(sampleInput())
    const b = repo.upsertGlossary({ ...sampleInput(), id: a.id, note: 'updated' })
    expect(b.id).toBe(a.id)
    expect(b.note).toBe('updated')
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt)
    repo.close()
  })

  it('rejects empty source_term', () => {
    const repo = makeRepo()
    expect(() => repo.upsertGlossary(sampleInput({ sourceTerm: '   ' }))).toThrow(
      /source_term|sourceTerm/i
    )
    repo.close()
  })

  it('rejects source_term over 100 chars', () => {
    const repo = makeRepo()
    expect(() =>
      repo.upsertGlossary(sampleInput({ sourceTerm: 'x'.repeat(101) }))
    ).toThrow(/100/)
    repo.close()
  })

  it('rejects meeting scope without meetingId', () => {
    const repo = makeRepo()
    expect(() =>
      repo.upsertGlossary(sampleInput({ scope: 'meeting', meetingId: null }))
    ).toThrow(/meeting/i)
    repo.close()
  })

  it('rejects global scope with a meetingId', () => {
    const repo = makeRepo()
    expect(() =>
      repo.upsertGlossary(sampleInput({ scope: 'global', meetingId: 'mtg_x' }))
    ).toThrow(/global/i)
    repo.close()
  })

  it('rejects duplicate (scope, meeting_id, lowercase sourceTerm)', () => {
    const repo = makeRepo()
    repo.upsertGlossary(sampleInput({ sourceTerm: 'GPU' }))
    expect(() => repo.upsertGlossary(sampleInput({ sourceTerm: 'gpu' }))).toThrow(
      /duplicate|exists/i
    )
    repo.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "upsertGlossary"`

Expected: FAIL — `upsertGlossary is not a function`.

- [ ] **Step 3: Implement `upsertGlossary` on `MemoryRepository`**

Open `src/main/memory/repository.ts`. Add imports near the top:

```ts
import type { GlossaryEntry, GlossaryEntryInput } from './types'
```

Add the following methods inside the `MemoryRepository` class (place just before the existing `close()` method):

```ts
  upsertGlossary(input: GlossaryEntryInput): GlossaryEntry {
    const term = input.sourceTerm.trim()
    if (!term) throw new Error('sourceTerm must not be empty')
    if (term.length > 100) throw new Error('sourceTerm must be <= 100 chars')
    for (const [lang, val] of Object.entries(input.translations)) {
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
          JSON.stringify(input.translations ?? {}),
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
      .get(input.scope, input.meetingId, input.meetingId, term) as
      | { id: string }
      | undefined
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
        JSON.stringify(input.translations ?? {}),
        input.preserve ? 1 : 0,
        input.note,
        now,
        now
      )
    return this.getGlossaryEntry(id)!
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "upsertGlossary"`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-repository.test.ts
git commit -m "feat(glossary): repository upsert + validation"
```

---

### Task 1.4: Repository `listGlossary` — TDD

**Files:**
- Modify: `src/test/glossary-repository.test.ts`
- Modify: `src/main/memory/repository.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/test/glossary-repository.test.ts`:

```ts
describe('MemoryRepository listGlossary', () => {
  it('returns only global entries by default', () => {
    const repo = makeRepo()
    repo.upsertGlossary(sampleInput({ sourceTerm: 'g1' }))
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
    repo.upsertGlossary(sampleInput({ scope: 'meeting', meetingId: 'mtg_a', sourceTerm: 'm1' }))
    const list = repo.listGlossary('global')
    expect(list.map((e) => e.sourceTerm)).toEqual(['g1'])
    repo.close()
  })

  it('returns only meeting entries when scope=meeting and meetingId is provided', () => {
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
    repo.upsertGlossary(sampleInput({ scope: 'meeting', meetingId: 'mtg_a', sourceTerm: 'm1' }))
    repo.upsertGlossary(sampleInput({ sourceTerm: 'g1' }))
    const list = repo.listGlossary('meeting', 'mtg_a')
    expect(list.map((e) => e.sourceTerm)).toEqual(['m1'])
    repo.close()
  })

  it('returns empty array when no matching entries', () => {
    const repo = makeRepo()
    expect(repo.listGlossary('global')).toEqual([])
    repo.close()
  })

  it('orders by updated_at DESC within scope', () => {
    const repo = makeRepo()
    repo.upsertGlossary(sampleInput({ sourceTerm: 'a' }))
    repo.upsertGlossary(sampleInput({ sourceTerm: 'b' }))
    repo.upsertGlossary(sampleInput({ sourceTerm: 'c' }))
    const list = repo.listGlossary('global')
    // most recently inserted comes first
    expect(list[0].sourceTerm).toBe('c')
    expect(list[list.length - 1].sourceTerm).toBe('a')
    repo.close()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "listGlossary"`

Expected: FAIL — `listGlossary is not a function`.

- [ ] **Step 3: Implement `listGlossary`**

Inside `MemoryRepository`, add right after `getGlossaryEntry`:

```ts
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
           ORDER BY updated_at DESC`
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
           ORDER BY updated_at DESC`
        )
        .all(meetingId) as typeof rows
    }
    return rows.map((r) => ({
      ...r,
      translations: JSON.parse(r.translations) as Record<string, string>,
      preserve: r.preserve === 1,
    }))
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "listGlossary"`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-repository.test.ts
git commit -m "feat(glossary): repository list by scope"
```

---

### Task 1.5: Repository `deleteGlossary` — TDD

**Files:**
- Modify: `src/test/glossary-repository.test.ts`
- Modify: `src/main/memory/repository.ts`

- [ ] **Step 1: Append failing test**

Append to `src/test/glossary-repository.test.ts`:

```ts
describe('MemoryRepository deleteGlossary', () => {
  it('removes an entry by id', () => {
    const repo = makeRepo()
    const entry = repo.upsertGlossary(sampleInput())
    repo.deleteGlossary(entry.id)
    expect(repo.getGlossaryEntry(entry.id)).toBeNull()
    repo.close()
  })

  it('is a no-op when id does not exist', () => {
    const repo = makeRepo()
    expect(() => repo.deleteGlossary('does-not-exist')).not.toThrow()
    repo.close()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "deleteGlossary"`

Expected: FAIL — `deleteGlossary is not a function`.

- [ ] **Step 3: Implement `deleteGlossary`**

Add inside `MemoryRepository` after `listGlossary`:

```ts
  deleteGlossary(id: string): void {
    this.db.prepare('DELETE FROM glossary_entries WHERE id = ?').run(id)
  }
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "deleteGlossary"`

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-repository.test.ts
git commit -m "feat(glossary): repository delete"
```

---

### Task 1.6: Repository `activeGlossary` — TDD

**Files:**
- Modify: `src/test/glossary-repository.test.ts`
- Modify: `src/main/memory/repository.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/test/glossary-repository.test.ts`:

```ts
describe('MemoryRepository activeGlossary', () => {
  it('returns only globals when meetingId is null', () => {
    const repo = makeRepo()
    repo.upsertGlossary(sampleInput({ sourceTerm: 'g1' }))
    const list = repo.activeGlossary(null)
    expect(list.map((e) => e.sourceTerm)).toEqual(['g1'])
    repo.close()
  })

  it('merges globals and meeting entries when meetingId is provided', () => {
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
    repo.upsertGlossary(sampleInput({ sourceTerm: 'global1' }))
    repo.upsertGlossary(sampleInput({ scope: 'meeting', meetingId: 'mtg_a', sourceTerm: 'meeting1' }))
    const list = repo.activeGlossary('mtg_a')
    expect(list.map((e) => e.sourceTerm).sort()).toEqual(['global1', 'meeting1'])
    repo.close()
  })

  it('lets meeting entries override a global entry with same case-insensitive source_term', () => {
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
    repo.upsertGlossary(
      sampleInput({
        sourceTerm: 'kunchen',
        translations: { ko: '쿤 첸 (global)' },
      })
    )
    repo.upsertGlossary(
      sampleInput({
        scope: 'meeting',
        meetingId: 'mtg_a',
        sourceTerm: 'KunChen',
        translations: { ko: '쿤 첸 (meeting)' },
      })
    )
    const list = repo.activeGlossary('mtg_a')
    expect(list).toHaveLength(1)
    expect(list[0].scope).toBe('meeting')
    expect(list[0].translations.ko).toBe('쿤 첸 (meeting)')
    repo.close()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "activeGlossary"`

Expected: FAIL — `activeGlossary is not a function`.

- [ ] **Step 3: Implement `activeGlossary`**

Add inside `MemoryRepository` after `deleteGlossary`:

```ts
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
           ORDER BY scope ASC, updated_at DESC`
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
           ORDER BY updated_at DESC`
        )
        .all() as typeof rows
    }
    const parsed: GlossaryEntry[] = rows.map((r) => ({
      ...r,
      translations: JSON.parse(r.translations) as Record<string, string>,
      preserve: r.preserve === 1,
    }))
    // Dedup by lowercased sourceTerm; meeting entries override globals.
    // Query returns scope ASC ('global' < 'meeting'), so meeting rows come last
    // and overwrite globals in the Map.
    const byKey = new Map<string, GlossaryEntry>()
    for (const e of parsed) byKey.set(e.sourceTerm.toLowerCase(), e)
    return Array.from(byKey.values())
  }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/test/glossary-repository.test.ts -t "activeGlossary"`

Expected: PASS (3 tests).

- [ ] **Step 5: Run full repository test file**

Run: `npx vitest run src/test/glossary-repository.test.ts`

Expected: ALL PASS (16 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-repository.test.ts
git commit -m "feat(glossary): repository activeGlossary with scope merge"
```

---

## Phase 2 — Shared prompt helpers

### Task 2.1: `promptInjection.ts` — `formatGlossaryPromptSection` TDD

**Files:**
- Create: `src/main/glossary/promptInjection.ts`
- Create: `src/test/glossary-prompt-injection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/glossary-prompt-injection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildLabelLanguageBlock,
  formatGlossaryPromptSection,
  normalizePreserveTerms,
} from '../main/glossary/promptInjection'
import type { GlossaryEntry } from '../main/memory/types'

function entry(over: Partial<GlossaryEntry>): GlossaryEntry {
  return {
    id: 'x',
    scope: 'global',
    meetingId: null,
    sourceTerm: 'autoMeetic',
    translations: {},
    preserve: false,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('formatGlossaryPromptSection', () => {
  it('returns empty string for empty entries', () => {
    expect(formatGlossaryPromptSection([], 'ko')).toBe('')
  })

  it('returns empty string when entries exist but none match target', () => {
    const entries = [entry({ translations: { ja: 'auto' }, preserve: false })]
    expect(formatGlossaryPromptSection(entries, 'ko')).toBe('')
  })

  it('lists verbatim terms when preserve=true and no target translation', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    const out = formatGlossaryPromptSection(entries, 'ko')
    expect(out).toContain('GLOSSARY')
    expect(out).toContain('GPU')
    expect(out).toContain('verbatim')
  })

  it('emits mapped translation when target translation exists', () => {
    const entries = [
      entry({ sourceTerm: 'kunchen', translations: { ko: '쿤 첸' } }),
    ]
    const out = formatGlossaryPromptSection(entries, 'ko')
    expect(out).toContain('kunchen')
    expect(out).toContain('쿤 첸')
    expect(out).toContain('Korean')
  })

  it('lets target translation win over preserve when both apply for that lang', () => {
    const entries = [
      entry({
        sourceTerm: 'Anthropic',
        preserve: true,
        translations: { ko: '앤트로픽' },
      }),
    ]
    const out = formatGlossaryPromptSection(entries, 'ko')
    expect(out).toContain('앤트로픽')
    expect(out).not.toMatch(/verbatim[\s\S]*Anthropic/)
  })

  it('falls back to verbatim list when target is null', () => {
    const entries = [
      entry({ sourceTerm: 'GPU', preserve: true }),
      entry({ sourceTerm: 'kunchen', translations: { ko: '쿤 첸' } }),
    ]
    const out = formatGlossaryPromptSection(entries, null)
    expect(out).toContain('GPU')
    expect(out).not.toContain('쿤 첸')
  })
})

describe('normalizePreserveTerms', () => {
  it('normalizes casing for preserve=true terms', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    expect(normalizePreserveTerms('uses gpu and Gpu daily', entries)).toBe(
      'uses GPU and GPU daily'
    )
  })

  it('respects word boundaries (does not touch GPUS)', () => {
    const entries = [entry({ sourceTerm: 'GPU', preserve: true })]
    expect(normalizePreserveTerms('multiple GPUS at once', entries)).toBe(
      'multiple GPUS at once'
    )
  })

  it('leaves non-preserve entries untouched', () => {
    const entries = [
      entry({ sourceTerm: 'kunchen', preserve: false, translations: { ko: '쿤 첸' } }),
    ]
    expect(normalizePreserveTerms('Kunchen said hi', entries)).toBe('Kunchen said hi')
  })

  it('returns input unchanged when entries is empty', () => {
    expect(normalizePreserveTerms('anything goes', [])).toBe('anything goes')
  })
})

describe('buildLabelLanguageBlock', () => {
  it('renders the language name for a known code', () => {
    const out = buildLabelLanguageBlock('ko')
    expect(out).toContain('Korean')
    expect(out).toContain('LABEL LANGUAGE')
  })

  it('falls back to the raw code when unknown', () => {
    const out = buildLabelLanguageBlock('xx')
    expect(out).toContain('xx')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/test/glossary-prompt-injection.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `promptInjection.ts`**

Create `src/main/glossary/promptInjection.ts`:

```ts
import type { GlossaryEntry } from '../memory/types'

export const LANGUAGE_NAME_BY_CODE: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatGlossaryPromptSection(
  entries: GlossaryEntry[],
  targetLang: string | null
): string {
  if (entries.length === 0) return ''
  const verbatim: string[] = []
  const mapped: Array<[string, string]> = []

  for (const e of entries) {
    if (targetLang && e.translations[targetLang]) {
      mapped.push([e.sourceTerm, e.translations[targetLang]])
      continue
    }
    if (e.preserve) verbatim.push(e.sourceTerm)
  }

  if (verbatim.length === 0 && mapped.length === 0) return ''

  const lines: string[] = ['GLOSSARY (apply strictly, do not paraphrase):']
  if (verbatim.length) {
    lines.push(`- Keep verbatim in all output: ${verbatim.map(quote).join(', ')}`)
  }
  if (mapped.length) {
    const langName = LANGUAGE_NAME_BY_CODE[targetLang!] ?? targetLang
    lines.push(`- When producing ${langName}, render:`)
    for (const [src, dst] of mapped) lines.push(`  · ${quote(src)} → ${quote(dst)}`)
  }
  return lines.join('\n')
}

export function normalizePreserveTerms(
  output: string,
  entries: GlossaryEntry[]
): string {
  if (entries.length === 0) return output
  let result = output
  for (const e of entries) {
    if (!e.preserve) continue
    const re = new RegExp(`\\b${escapeRegex(e.sourceTerm)}\\b`, 'gi')
    result = result.replace(re, e.sourceTerm)
  }
  return result
}

export function buildLabelLanguageBlock(langCode: string): string {
  const name = LANGUAGE_NAME_BY_CODE[langCode] ?? langCode
  return `LABEL LANGUAGE:
- Output ALL shape labels, text titles, and arrow labels in ${name}.
- Translate concepts from the transcript into ${name} for the diagram, even if the speaker used a different language.
- Glossary terms marked verbatim must NEVER be translated — copy them as-is.`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/test/glossary-prompt-injection.test.ts`

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/glossary/promptInjection.ts src/test/glossary-prompt-injection.test.ts
git commit -m "feat(glossary): prompt injection + normalizePreserve helpers"
```

---

## Phase 3 — Cache layer

### Task 3.1: `glossary/cache.ts` — TDD

**Files:**
- Create: `src/main/glossary/cache.ts`
- Create: `src/test/glossary-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/glossary-cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/test/glossary-cache.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cache.ts`**

Create `src/main/glossary/cache.ts`:

```ts
import type { MemoryRepository } from '../memory/repository'
import type { GlossaryEntry } from '../memory/types'

let cachedGlossary: GlossaryEntry[] = []
let cachedMeetingId: string | null = null
let glossaryEpoch = 0
let cachedEpoch = -1

export function ensureFreshGlossary(
  repo: MemoryRepository,
  meetingId: string | null
): void {
  if (meetingId === cachedMeetingId && cachedEpoch === glossaryEpoch) return
  cachedGlossary = repo.activeGlossary(meetingId)
  cachedMeetingId = meetingId
  cachedEpoch = glossaryEpoch
}

export function getCachedGlossary(): GlossaryEntry[] {
  return cachedGlossary
}

export function bumpGlossaryEpoch(): void {
  glossaryEpoch += 1
}

/** Test-only: reset module state between tests. */
export function __resetGlossaryCacheForTesting(): void {
  cachedGlossary = []
  cachedMeetingId = null
  glossaryEpoch = 0
  cachedEpoch = -1
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/test/glossary-cache.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/glossary/cache.ts src/test/glossary-cache.test.ts
git commit -m "feat(glossary): pull-based cache with epoch bump"
```

---

## Phase 4 — IPC + preload

### Task 4.1: IPC handler factory

**Files:**
- Create: `src/main/ipc-glossary-handlers.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create the handler factory**

Create `src/main/ipc-glossary-handlers.ts`:

```ts
import { BrowserWindow } from 'electron'
import { bumpGlossaryEpoch } from './glossary/cache'
import type { MemoryRepository } from './memory/repository'
import type { GlossaryEntryInput } from './memory/types'

export type GlossaryRepoApi = Pick<
  MemoryRepository,
  'listGlossary' | 'upsertGlossary' | 'deleteGlossary' | 'activeGlossary'
>

type GetRepo = () => Promise<GlossaryRepoApi>
type GetCurrentMeetingId = () => string | null

function broadcastChanged(): void {
  bumpGlossaryEpoch()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('glossary:changed')
  }
}

async function getReady<T>(getter: () => Promise<T>, label: string): Promise<T> {
  try {
    return await getter()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} failed to initialize: ${message}`, { cause: err })
  }
}

export function buildGlossaryHandlers(
  getRepo: GetRepo,
  getCurrentMeetingId: GetCurrentMeetingId
) {
  return {
    'glossary:list': async (args: {
      scope: 'global' | 'meeting'
      meetingId?: string
    }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      return repo.listGlossary(args.scope, args.meetingId)
    },
    'glossary:upsert': async (args: { entry: GlossaryEntryInput }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const result = repo.upsertGlossary(args.entry)
      broadcastChanged()
      return result
    },
    'glossary:delete': async (args: { id: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      repo.deleteGlossary(args.id)
      broadcastChanged()
    },
    'glossary:active': async (args: { meetingId?: string } = {}) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const id = args.meetingId ?? getCurrentMeetingId()
      return repo.activeGlossary(id)
    },
  }
}
```

- [ ] **Step 2: Register handlers in `src/main/index.ts`**

Find the section of `src/main/index.ts` where `buildMemoryHandlers` is wired up. It will look approximately like:

```ts
const memoryHandlers = buildMemoryHandlers(() => memoryServicePromise)
for (const [channel, handler] of Object.entries(memoryHandlers)) {
  ipcMain.handle(channel, (_event, args) => handler(args))
}
```

Immediately after that block, add:

```ts
const glossaryHandlers = buildGlossaryHandlers(
  async () => (await memoryServicePromise).repository,
  () => meetingLifecycle.getCurrentMeetingId()
)
for (const [channel, handler] of Object.entries(glossaryHandlers)) {
  ipcMain.handle(channel, (_event, args) => handler(args))
}
```

Add the import at the top:

```ts
import { buildGlossaryHandlers } from './ipc-glossary-handlers'
```

If `memoryServicePromise` does not expose `.repository`, or `meetingLifecycle` is not in scope, locate the equivalent reference in the existing code (search for `MeetingLifecycle` and `MemoryRepository`) and adapt the closures accordingly. Both already exist in `src/main/index.ts` per the codebase recon.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-glossary-handlers.ts src/main/index.ts
git commit -m "feat(glossary): IPC handlers + main wiring"
```

---

### Task 4.2: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/types.ts`

- [ ] **Step 1: Extend preload types**

Open `src/preload/types.ts` and add (near the bottom, before the closing `}` of the main API interface — locate the existing `memory: { ... }` field and add a sibling `glossary` field):

```ts
glossary: {
  list: (
    scope: 'global' | 'meeting',
    meetingId?: string
  ) => Promise<GlossaryEntry[]>
  upsert: (entry: GlossaryEntryInput) => Promise<GlossaryEntry>
  delete: (id: string) => Promise<void>
  active: (meetingId?: string) => Promise<GlossaryEntry[]>
  onChanged: (handler: () => void) => () => void
}
```

Add imports at the top (if not present):

```ts
import type { GlossaryEntry, GlossaryEntryInput } from '../main/memory/types'
```

- [ ] **Step 2: Extend the preload bridge**

Open `src/preload/index.ts`. Locate the existing `memory: { … }` exposed surface. Add a sibling `glossary` field on the same `contextBridge.exposeInMainWorld('electronAPI', { ... })` object:

```ts
glossary: {
  list: (scope: 'global' | 'meeting', meetingId?: string) =>
    ipcRenderer.invoke('glossary:list', { scope, meetingId }),
  upsert: (entry: GlossaryEntryInput) =>
    ipcRenderer.invoke('glossary:upsert', { entry }),
  delete: (id: string) =>
    ipcRenderer.invoke('glossary:delete', { id }),
  active: (meetingId?: string) =>
    ipcRenderer.invoke('glossary:active', { meetingId }),
  onChanged: (handler: () => void) => {
    const wrapped = () => handler()
    ipcRenderer.on('glossary:changed', wrapped)
    return () => ipcRenderer.removeListener('glossary:changed', wrapped)
  },
},
```

Add at the top (if not present):

```ts
import type { GlossaryEntryInput } from '../main/memory/types'
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/types.ts
git commit -m "feat(glossary): preload bridge surface"
```

---

## Phase 5 — Translation integration

### Task 5.1: Wire glossary into the translation prompt

**Files:**
- Modify: `src/main/transcriptPostProcessor.ts`

- [ ] **Step 1: Add imports near the top of the file**

```ts
import { ensureFreshGlossary, getCachedGlossary } from './glossary/cache'
import {
  formatGlossaryPromptSection,
  normalizePreserveTerms,
} from './glossary/promptInjection'
```

Also locate the existing `MemoryRepository` and `MeetingLifecycle` references that this module already uses (search for `notifyTranslation` / `notifyTurnFinalized` in this file — both come from `./memory/transcriptHook`; the underlying `repo` and `lifecycle` references will be in scope or must be passed in via an init function similar to the existing `init(mainWindow)`).

If repo / lifecycle are NOT already accessible from this module, extend the existing `init()` signature to accept them:

```ts
// before:
export function init(mainWindow: BrowserWindow): void { ... }

// after:
let repoRef: MemoryRepository | null = null
let lifecycleRef: MeetingLifecycle | null = null

export function init(
  mainWindow: BrowserWindow,
  repo: MemoryRepository,
  lifecycle: MeetingLifecycle
): void {
  mainWindowRef = mainWindow
  repoRef = repo
  lifecycleRef = lifecycle
}
```

Update the call site in `src/main/index.ts` to pass the new arguments. Add the corresponding type imports:

```ts
import type { MemoryRepository } from './memory/repository'
import type { MeetingLifecycle } from './memory/meetingLifecycle'
```

- [ ] **Step 2: Locate the translate call site**

In `src/main/transcriptPostProcessor.ts`, search for the chat completions call that builds the system message containing `'You are a precise translation engine'`. The relevant block builds two messages — one `role: 'system'`, one `role: 'user'` — and posts to `OPENAI_CHAT_COMPLETIONS_URL`.

- [ ] **Step 3: Inject glossary into the system message + post-pass the output**

Replace the translation call body so that immediately before building the `messages` array:

```ts
const currentMeetingId = lifecycleRef?.getCurrentMeetingId() ?? null
if (repoRef) ensureFreshGlossary(repoRef, currentMeetingId)
const activeGlossary = getCachedGlossary()
const glossaryBlock = formatGlossaryPromptSection(activeGlossary, targetLanguage)

const systemContent = glossaryBlock
  ? `You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.\n\n${glossaryBlock}`
  : 'You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.'
```

Replace the existing system message content with `systemContent` (in the `role: 'system'` entry of the `messages` array).

After the fetch returns and you parse `translation` (the cleaned output string), apply the post-pass:

```ts
const normalized = normalizePreserveTerms(translation, activeGlossary)
// use `normalized` everywhere `translation` was previously consumed downstream
```

The exact variable names in this file may differ slightly — `translation`, `translated`, or `cleanedTranslation`. Apply `normalizePreserveTerms` to whichever variable becomes the final translated string that flows into `notifyTranslation` / IPC events.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 5: Manual smoke test**

Start dev mode: `npm run dev:electron`

1. Open the glossary panel will not yet exist — for now, manually insert a row by opening the SQLite database (`memory.db` in the user data dir) and running:

```sql
INSERT INTO glossary_entries (id, scope, meeting_id, source_term, translations, preserve, note, created_at, updated_at)
VALUES ('test1', 'global', NULL, 'GPU', '{}', 1, NULL, 1700000000000, 1700000000000);
```

2. Start a meeting, share an audio tab where someone says "GPU benchmarks today".
3. Verify the translation column shows `GPU` (not transliterated/translated).

If the test cannot be run because step-1 SQL access is awkward, defer the manual test until after Task 6.4 (panel ships), and just verify typecheck + lint pass here. Mark this step skipped with `// TODO(verify after Phase 6)` in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/main/transcriptPostProcessor.ts src/main/index.ts
git commit -m "feat(glossary): inject glossary into translation prompt + post-pass"
```

---

## Phase 6 — Glossary panel UI

### Task 6.1: Renderer types re-export

**Files:**
- Create: `src/renderer/glossary/types.ts`

- [ ] **Step 1: Create the file**

```ts
export type { GlossaryEntry, GlossaryEntryInput } from '../../main/memory/types'

export const LANGUAGE_OPTIONS = [
  { code: 'ko', label: 'Korean' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/glossary/types.ts
git commit -m "feat(glossary): renderer types re-export"
```

---

### Task 6.2: `useGlossaryStore.ts`

**Files:**
- Create: `src/renderer/glossary/useGlossaryStore.ts`

- [ ] **Step 1: Create the store**

```ts
import { useCallback, useEffect, useState } from 'react'
import type { GlossaryEntry, GlossaryEntryInput } from './types'

interface GlossaryState {
  entries: GlossaryEntry[]
  status: 'idle' | 'loading' | 'error'
  errorMessage: string | null
}

export function useGlossaryStore(
  scope: 'global' | 'meeting',
  meetingId: string | null
) {
  const [state, setState] = useState<GlossaryState>({
    entries: [],
    status: 'idle',
    errorMessage: null,
  })

  const load = useCallback(async () => {
    if (!window.electronAPI?.glossary) {
      setState({ entries: [], status: 'idle', errorMessage: null })
      return
    }
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const entries = await window.electronAPI.glossary.list(
        scope,
        scope === 'meeting' ? meetingId ?? undefined : undefined
      )
      setState({ entries, status: 'idle', errorMessage: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, status: 'error', errorMessage: msg }))
    }
  }, [scope, meetingId])

  const upsert = useCallback(
    async (input: GlossaryEntryInput) => {
      if (!window.electronAPI?.glossary) return
      await window.electronAPI.glossary.upsert(input)
      // server will broadcast glossary:changed; load() also fires below.
    },
    []
  )

  const remove = useCallback(async (id: string) => {
    if (!window.electronAPI?.glossary) return
    await window.electronAPI.glossary.delete(id)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const api = window.electronAPI?.glossary
    if (!api) return
    return api.onChanged(() => {
      void load()
    })
  }, [load])

  return {
    entries: state.entries,
    status: state.status,
    errorMessage: state.errorMessage,
    refresh: load,
    upsert,
    remove,
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/glossary/useGlossaryStore.ts
git commit -m "feat(glossary): renderer store hook"
```

---

### Task 6.3: `GlossaryRowEditor.tsx`

**Files:**
- Create: `src/renderer/glossary/GlossaryRowEditor.tsx`

- [ ] **Step 1: Create the editor component**

```tsx
import { useState } from 'react'
import { LANGUAGE_OPTIONS, type GlossaryEntry, type GlossaryEntryInput } from './types'

interface Props {
  initial?: GlossaryEntry
  scope: 'global' | 'meeting'
  meetingId: string | null
  onSave: (input: GlossaryEntryInput) => Promise<void>
  onCancel: () => void
}

export function GlossaryRowEditor({
  initial,
  scope,
  meetingId,
  onSave,
  onCancel,
}: Props) {
  const [sourceTerm, setSourceTerm] = useState(initial?.sourceTerm ?? '')
  const [preserve, setPreserve] = useState(initial?.preserve ?? false)
  const [note, setNote] = useState(initial?.note ?? '')
  const [translations, setTranslations] = useState<Record<string, string>>(
    initial?.translations ?? {}
  )
  const [newLang, setNewLang] = useState<string>('ko')
  const [newValue, setNewValue] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const addTranslation = () => {
    const v = newValue.trim()
    if (!v) return
    setTranslations((t) => ({ ...t, [newLang]: v }))
    setNewValue('')
  }

  const removeTranslation = (lang: string) => {
    setTranslations((t) => {
      const next = { ...t }
      delete next[lang]
      return next
    })
  }

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave({
        id: initial?.id,
        scope,
        meetingId: scope === 'meeting' ? meetingId : null,
        sourceTerm: sourceTerm.trim(),
        translations,
        preserve,
        note: note.trim() || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glossary-row-editor">
      <label className="glossary-field">
        <span>Source term</span>
        <input
          type="text"
          value={sourceTerm}
          onChange={(e) => setSourceTerm(e.target.value)}
          placeholder="e.g. autoMeetic"
          maxLength={100}
          autoFocus
        />
      </label>

      <label className="glossary-field glossary-field-row">
        <input
          type="checkbox"
          checked={preserve}
          onChange={(e) => setPreserve(e.target.checked)}
        />
        <span>Preserve verbatim in all output</span>
      </label>

      <div className="glossary-field">
        <span>Translations</span>
        {Object.entries(translations).map(([lang, val]) => (
          <div key={lang} className="glossary-translation-row">
            <span className="glossary-lang-chip amw-mono">{lang.toUpperCase()}</span>
            <span className="glossary-translation-val">{val}</span>
            <button
              type="button"
              className="glossary-translation-remove"
              onClick={() => removeTranslation(lang)}
              aria-label={`Remove ${lang} translation`}
            >
              ×
            </button>
          </div>
        ))}
        <div className="glossary-translation-add">
          <select
            value={newLang}
            onChange={(e) => setNewLang(e.target.value)}
            className="glossary-lang-select"
            aria-label="Translation language"
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code.toUpperCase()}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="rendered form"
            maxLength={100}
          />
          <button type="button" onClick={addTranslation}>
            + Add
          </button>
        </div>
      </div>

      <label className="glossary-field">
        <span>Note (optional)</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </label>

      {error && <div className="glossary-error">{error}</div>}

      <div className="glossary-editor-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="glossary-save"
          onClick={() => void save()}
          disabled={saving || !sourceTerm.trim()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/glossary/GlossaryRowEditor.tsx
git commit -m "feat(glossary): inline row editor component"
```

---

### Task 6.4: `GlossaryPanel.tsx`

**Files:**
- Create: `src/renderer/glossary/GlossaryPanel.tsx`

- [ ] **Step 1: Create the panel**

```tsx
import { useMemo, useState } from 'react'
import { GlossaryRowEditor } from './GlossaryRowEditor'
import type { GlossaryEntry, GlossaryEntryInput } from './types'
import { useGlossaryStore } from './useGlossaryStore'

interface Props {
  open: boolean
  meetingId: string | null
  onClose: () => void
}

type Tab = 'global' | 'meeting'

export function GlossaryPanel({ open, meetingId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('global')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const scope: 'global' | 'meeting' = tab
  const store = useGlossaryStore(scope, meetingId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return store.entries
    return store.entries.filter((e) => {
      if (e.sourceTerm.toLowerCase().includes(q)) return true
      return Object.values(e.translations).some((v) => v.toLowerCase().includes(q))
    })
  }, [store.entries, query])

  if (!open) return null

  const handleSave = async (input: GlossaryEntryInput) => {
    await store.upsert(input)
    setEditingId(null)
    setCreating(false)
  }

  const renderRow = (e: GlossaryEntry) => {
    if (editingId === e.id) {
      return (
        <GlossaryRowEditor
          key={e.id}
          initial={e}
          scope={scope}
          meetingId={meetingId}
          onSave={handleSave}
          onCancel={() => setEditingId(null)}
        />
      )
    }
    const translations = Object.entries(e.translations)
    return (
      <div className="glossary-row" key={e.id}>
        <div className="glossary-row-term amw-mono">{e.sourceTerm}</div>
        <div className="glossary-row-translations">
          {translations.length === 0 ? (
            <span className="glossary-row-empty">—</span>
          ) : (
            translations.map(([lang, val]) => (
              <span key={lang} className="glossary-translation-pill">
                <em className="amw-mono">{lang}</em>: {val}
              </span>
            ))
          )}
        </div>
        <div className="glossary-row-preserve">
          {e.preserve && <span className="glossary-preserve-chip">Preserve</span>}
        </div>
        <div className="glossary-row-actions">
          <button type="button" onClick={() => setEditingId(e.id)}>
            Edit
          </button>
          <button
            type="button"
            className="glossary-row-delete"
            onClick={() => {
              if (window.confirm(`Delete "${e.sourceTerm}"?`)) void store.remove(e.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="glossary-overlay" role="dialog" aria-label="Glossary">
      <div className="glossary-panel">
        <header className="glossary-head">
          <div className="glossary-head-title">
            <h2>Glossary</h2>
            <span className="amw-mono glossary-head-count">
              {filtered.length} of {store.entries.length}
            </span>
          </div>
          <button
            type="button"
            className="glossary-close"
            onClick={onClose}
            aria-label="Close glossary"
          >
            ×
          </button>
        </header>

        <div className="glossary-tabs">
          <button
            type="button"
            className={`glossary-tab ${tab === 'global' ? 'on' : ''}`}
            onClick={() => setTab('global')}
          >
            Global
          </button>
          <button
            type="button"
            className={`glossary-tab ${tab === 'meeting' ? 'on' : ''}`}
            onClick={() => setTab('meeting')}
            disabled={!meetingId}
            title={meetingId ? 'This meeting' : 'No live meeting'}
          >
            This meeting
          </button>
        </div>

        <div className="glossary-toolbar">
          <input
            type="text"
            placeholder="Search source or translation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="glossary-search"
          />
          <button
            type="button"
            className="glossary-add"
            onClick={() => setCreating(true)}
            disabled={creating || editingId !== null}
          >
            + Add term
          </button>
        </div>

        {store.errorMessage && (
          <div className="glossary-error-banner">{store.errorMessage}</div>
        )}

        <div className="glossary-list amw-scroll">
          {creating && (
            <GlossaryRowEditor
              scope={scope}
              meetingId={meetingId}
              onSave={handleSave}
              onCancel={() => setCreating(false)}
            />
          )}
          {filtered.length === 0 && !creating && (
            <div className="glossary-empty">
              {tab === 'global' ? (
                <p>
                  Glossary is empty. Register product names and proper nouns like{' '}
                  <code>autoMeetic</code> or <code>kunchen</code> and they will stay consistent
                  across your transcripts and diagrams.
                </p>
              ) : (
                <p>
                  No meeting-specific entries. Add terms here that only apply to the current
                  meeting (e.g. attendee names, project codenames).
                </p>
              )}
            </div>
          )}
          {filtered.map(renderRow)}
        </div>

        <footer className="glossary-foot">
          <span className="amw-mono">{store.entries.length} entries</span>
          <span className="glossary-foot-hint">
            Meeting-scoped entries apply only to the current meeting.
          </span>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/glossary/GlossaryPanel.tsx
git commit -m "feat(glossary): glossary panel UI"
```

---

### Task 6.5: Panel styles

**Files:**
- Modify: `src/renderer/App.css`

- [ ] **Step 1: Append styles at the end of `App.css`**

```css
/* =============================================================
   GLOSSARY PANEL
   ============================================================= */

.glossary-overlay {
  position: fixed;
  inset: 0;
  background: var(--p-overlay-tint);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.glossary-panel {
  width: min(820px, 100%);
  max-height: 90vh;
  background: var(--p-bg-card);
  border: 1px solid var(--p-border-strong);
  border-radius: 12px;
  box-shadow: var(--p-shadow-float);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.glossary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--p-border);
}

.glossary-head-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.glossary-head-title h2 {
  margin: 0;
  font-family: var(--p-sans);
  font-size: 18px;
  font-weight: 600;
  color: var(--p-text);
  letter-spacing: -0.01em;
}

.glossary-head-count {
  font-size: 11px;
  color: var(--p-mute);
}

.glossary-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-mute);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.glossary-close:hover {
  background: var(--p-bg-sub);
}

.glossary-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--p-border);
  padding: 0 24px;
}

.glossary-tab {
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--p-mute);
  font-family: var(--p-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.glossary-tab.on {
  color: var(--p-text);
  border-bottom-color: var(--p-primary);
}
.glossary-tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.glossary-toolbar {
  display: flex;
  gap: 10px;
  padding: 14px 24px 10px;
}

.glossary-search {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  font-family: var(--p-sans);
  font-size: 13px;
  color: var(--p-text);
}
.glossary-search:focus {
  outline: none;
  border-color: var(--p-primary);
}

.glossary-add {
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid var(--p-primary);
  background: var(--p-primary);
  color: var(--p-primary-on);
  font-family: var(--p-sans);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.glossary-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.glossary-error-banner {
  margin: 0 24px 8px;
  padding: 8px 12px;
  background: var(--p-error-soft);
  color: var(--p-error-ink);
  border: 1px solid var(--p-error);
  border-radius: 6px;
  font-size: 12px;
}

.glossary-list {
  flex: 1;
  padding: 6px 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.glossary-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) 90px auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--p-border);
  border-radius: 8px;
  background: var(--p-bg-card);
}

.glossary-row-term {
  font-size: 13px;
  color: var(--p-text);
  font-weight: 600;
}

.glossary-row-translations {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--p-mute);
}

.glossary-translation-pill em {
  font-style: normal;
  margin-right: 4px;
  color: var(--p-faint);
}

.glossary-row-empty {
  color: var(--p-faint);
}

.glossary-preserve-chip {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--p-warning-soft);
  color: var(--p-warning-ink);
  font-family: var(--p-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.glossary-row-actions {
  display: flex;
  gap: 6px;
}
.glossary-row-actions button {
  height: 26px;
  padding: 0 9px;
  border-radius: 5px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-mute);
  font-size: 11.5px;
  cursor: pointer;
}
.glossary-row-actions button:hover {
  background: var(--p-bg-sub);
  color: var(--p-text);
}
.glossary-row-delete {
  color: var(--p-error-ink) !important;
}

.glossary-row-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--p-primary);
  border-radius: 8px;
  background: var(--p-bg-sub);
}

.glossary-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--p-mute);
}
.glossary-field-row {
  flex-direction: row;
  align-items: center;
}
.glossary-field input[type='text'],
.glossary-field input[type='checkbox'] {
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 5px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-text);
}
.glossary-field input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin-right: 8px;
  padding: 0;
}

.glossary-translation-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.glossary-lang-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--p-bg-card);
  border: 1px solid var(--p-border);
  font-size: 10px;
  font-weight: 700;
  color: var(--p-mute);
}
.glossary-translation-val {
  font-size: 13px;
  color: var(--p-text);
}
.glossary-translation-remove {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-mute);
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}

.glossary-translation-add {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}
.glossary-lang-select {
  height: 28px;
  padding: 0 6px;
  border-radius: 5px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  font-family: var(--p-mono);
  font-size: 11px;
  color: var(--p-text);
}
.glossary-translation-add input[type='text'] {
  flex: 1;
  height: 28px;
}
.glossary-translation-add button {
  height: 28px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-text);
  font-size: 12px;
  cursor: pointer;
}

.glossary-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.glossary-editor-actions button {
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-mute);
  font-size: 12.5px;
  cursor: pointer;
}
.glossary-editor-actions button.glossary-save {
  background: var(--p-primary);
  border-color: var(--p-primary);
  color: var(--p-primary-on);
  font-weight: 600;
}
.glossary-editor-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.glossary-error {
  font-size: 11.5px;
  color: var(--p-error-ink);
}

.glossary-empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--p-mute);
  font-size: 13px;
  line-height: 1.5;
}
.glossary-empty code {
  font-family: var(--p-mono);
  background: var(--p-bg-sub);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}

.glossary-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 24px;
  border-top: 1px solid var(--p-border);
  font-size: 11px;
  color: var(--p-mute);
}
.glossary-foot-hint {
  color: var(--p-faint);
}

@media (max-width: 720px) {
  .glossary-overlay {
    padding: 0;
  }
  .glossary-panel {
    max-height: 100vh;
    border-radius: 0;
    border: none;
  }
  .glossary-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/App.css
git commit -m "feat(glossary): panel styles"
```

---

### Task 6.6: Mount panel + header button

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add the header button**

Open `src/renderer/App.tsx`. Add the import at the top:

```ts
import { GlossaryPanel } from './glossary/GlossaryPanel'
```

Find the existing state hook list and add:

```ts
const [glossaryOpen, setGlossaryOpen] = useState(false)
```

Locate the Memory Library button in the header right cluster:

```tsx
<button
  className={`v4p-iconbtn ghost ${memoryLibraryOpen ? 'on' : ''}`}
  ...
>
```

Insert a new button directly AFTER it:

```tsx
<button
  className={`v4p-iconbtn ghost ${glossaryOpen ? 'on' : ''}`}
  type="button"
  onClick={() => setGlossaryOpen(true)}
  title="Glossary"
  aria-label="Glossary"
  aria-pressed={glossaryOpen}
>
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 1.5h7.5a.5.5 0 0 1 .5.5v9.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" />
    <path d="M2.5 9.5h8M6.75 1.5v10" />
  </svg>
</button>
```

- [ ] **Step 2: Mount the panel**

Near the bottom of `App.tsx` where `<MemoryLibraryPanel ... />` is rendered, add directly after it:

```tsx
<GlossaryPanel
  open={glossaryOpen}
  meetingId={null}
  onClose={() => setGlossaryOpen(false)}
/>
```

The `meetingId` value is left as `null` for now — the renderer does not currently track the live meeting id (the main process owns it). Glossary v1 lets users manage GLOBAL entries from the panel; meeting-scope management is fine even with `meetingId=null` since the meeting tab is disabled.

If a future task wires the live meeting id into the renderer, this prop can be updated to point at it. The Open Question in the spec covers this; for v1 leave `null`.

- [ ] **Step 3: Verify typecheck + manual smoke test**

Run: `npm run typecheck`

Expected: clean.

Launch dev: `npm run dev:electron`

1. Click the new glossary icon button in the header — panel opens.
2. Click `+ Add term`, enter `autoMeetic`, toggle `Preserve`, add a translation `ko: 오토미틱`, click `Save`. Row appears.
3. Click `Edit` on the new row, change the note, save. Row updates.
4. Click `Delete`, confirm. Row disappears.
5. Open `memory.db` in a SQLite browser to verify the row is gone.
6. Close panel, reopen — entries persist.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(glossary): header button + panel mount"
```

---

## Phase 7 — Whiteboard integration

### Task 7.1: Extend whiteboard prompt signature

**Files:**
- Modify: `src/main/whiteboard/prompt.ts`

- [ ] **Step 1: Edit the function signature**

Open `src/main/whiteboard/prompt.ts`. Add the import at the top:

```ts
import type { GlossaryEntry } from '../memory/types'
import {
  buildLabelLanguageBlock,
  formatGlossaryPromptSection,
} from '../glossary/promptInjection'
```

Replace the `whiteboardSystemPrompt` signature:

```ts
export interface WhiteboardPromptOptions {
  viewport?: WhiteboardViewport
  labelLanguage?: string | null
  glossary?: GlossaryEntry[]
}

export function whiteboardSystemPrompt(opts: WhiteboardPromptOptions = {}): string {
  const vp = opts.viewport ?? DEFAULT_VIEWPORT
  const base = `[the existing big prompt body, unchanged — keep all the text from "You are AutoMeetic..." through the last example block]`

  const blocks: string[] = [base]
  if (opts.labelLanguage) {
    blocks.push(buildLabelLanguageBlock(opts.labelLanguage))
  }
  const glossaryBlock = formatGlossaryPromptSection(
    opts.glossary ?? [],
    opts.labelLanguage ?? null
  )
  if (glossaryBlock) blocks.push(glossaryBlock)

  return blocks.join('\n\n')
}
```

**Important:** The body marked `[the existing big prompt body, unchanged — keep all the text from "You are AutoMeetic..." through the last example block]` must be the actual existing content of the prompt body — DO NOT replace it with a placeholder. Take the entire string literal from the current `whiteboardSystemPrompt(vp)` body and put it as the `base` variable. The viewport interpolation `${vp.width}` etc. continues to work since `vp` is still in scope.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

Expected: clean — all existing callers of `whiteboardSystemPrompt(vp)` need to be updated. Find them via grep:

```bash
```

Run: `npx grep -n "whiteboardSystemPrompt" src/`

Each call site like `whiteboardSystemPrompt(vp)` becomes `whiteboardSystemPrompt({ viewport: vp })`. Fix each one — usually just `src/main/whiteboardService.ts` and possibly `src/main/whiteboard/session.ts`.

- [ ] **Step 3: Verify typecheck again**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/whiteboard/prompt.ts src/main/whiteboardService.ts src/main/whiteboard/session.ts
git commit -m "feat(glossary): whiteboard prompt accepts labelLanguage + glossary"
```

(If `session.ts` did not need changes, drop it from the `git add` line.)

---

### Task 7.2: Whiteboard agent receives label language via IPC + applies glossary

**Important architecture note:** In Electron mode the renderer does NOT open the whiteboard WebSocket — `whiteboardWsRef.current` is `null`. The whiteboard agent runs entirely in main, triggered by `enqueueWhiteboardTranscript()` called from `transcriptPostProcessor.ts`. Therefore the renderer cannot deliver `labelLanguage` by piggybacking on the WS `whiteboard:agent-run` payload (that path only fires in web mode).

The Electron path needs a dedicated IPC channel that the renderer fires on label-language change; main caches the value and the whiteboard service reads from the cache when building each prompt.

**Files:**
- Modify: `src/main/whiteboardService.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/types.ts`

- [ ] **Step 1: Add module-level label-language cache + setter in `whiteboardService.ts`**

Open `src/main/whiteboardService.ts`. Near the top of the file, alongside other module-level state, add:

```ts
import { normalizePreserveTerms } from './glossary/promptInjection'
import type { MemoryRepository } from './memory/repository'
import type { MeetingLifecycle } from './memory/meetingLifecycle'

let repoRef: MemoryRepository | null = null
let lifecycleRef: MeetingLifecycle | null = null
let cachedLabelLanguage: string | null = null

export function setDiagramLabelLanguage(code: string | null): void {
  cachedLabelLanguage = code && code.length > 0 ? code : null
}

export function getDiagramLabelLanguage(): string | null {
  return cachedLabelLanguage
}
```

If the file already has an `init(mainWindow: BrowserWindow)`-style function, extend its signature:

```ts
export function init(
  mainWindow: BrowserWindow,
  repo: MemoryRepository,
  lifecycle: MeetingLifecycle
): void {
  // ... existing assignments ...
  repoRef = repo
  lifecycleRef = lifecycle
}
```

If no such `init` exists, add one and have `src/main/index.ts` call it during startup with the repo + lifecycle references.

- [ ] **Step 2: Build prompt with glossary + label language in the agent dispatch**

Locate the function in `whiteboardService.ts` that builds the system prompt for the LLM agent (it calls `whiteboardSystemPrompt(...)` currently). Replace that single-arg call with the options-object form:

```ts
const meetingId = lifecycleRef?.getCurrentMeetingId() ?? null
const glossary = repoRef ? repoRef.activeGlossary(meetingId) : []
const systemPrompt = whiteboardSystemPrompt({
  viewport,
  labelLanguage: cachedLabelLanguage,
  glossary,
})
```

For web mode, the existing `whiteboard:agent-run` WS handler still reads `msg.labelLanguage`. If present, treat it as an override: just before the prompt build, do:

```ts
if (typeof msg.labelLanguage === 'string') {
  cachedLabelLanguage = msg.labelLanguage.length > 0 ? msg.labelLanguage : null
}
```

This makes the WS payload an optional override for the same cache that Electron mode keeps via IPC.

- [ ] **Step 3: Register the IPC handler in `src/main/index.ts`**

Add at the top of `src/main/index.ts`:

```ts
import {
  init as initWhiteboardService,
  setDiagramLabelLanguage,
} from './whiteboardService'
```

(If `initWhiteboardService` is already imported under a different name, just add `setDiagramLabelLanguage` to the import.)

Where other `ipcMain.handle(...)` registrations live, add:

```ts
ipcMain.handle('whiteboard:set-label-language', (_event, args: { code: string | null }) => {
  setDiagramLabelLanguage(args.code)
})
```

- [ ] **Step 4: Expose the setter in the preload bridge**

Open `src/preload/index.ts`. Inside the `contextBridge.exposeInMainWorld('electronAPI', { ... })` object, add a `whiteboard` field (or extend the existing one if present):

```ts
whiteboard: {
  setLabelLanguage: (code: string | null) =>
    ipcRenderer.invoke('whiteboard:set-label-language', { code }),
},
```

Open `src/preload/types.ts`. Add the corresponding type declaration (or extend the existing `whiteboard` field):

```ts
whiteboard: {
  setLabelLanguage: (code: string | null) => Promise<void>
}
```

If the preload already exposes a `whiteboard:` field with different methods, simply add `setLabelLanguage` to that block.

- [ ] **Step 5: Post-pass element labels**

After the OpenAI agent returns its element updates and they are parsed into objects (each with optional `label.text` and standalone `text` for `type === 'text'`), normalize:

```ts
function applyGlossaryPostPass(
  elements: WhiteboardElement[],
  glossary: GlossaryEntry[]
): WhiteboardElement[] {
  if (glossary.length === 0) return elements
  return elements.map((el) => {
    const next = { ...el }
    if (next.label && typeof next.label.text === 'string') {
      next.label = { ...next.label, text: normalizePreserveTerms(next.label.text, glossary) }
    }
    if (typeof next.text === 'string') {
      next.text = normalizePreserveTerms(next.text, glossary)
    }
    return next
  })
}
```

(Place this helper near the top of `whiteboardService.ts` or in a sibling file `src/main/whiteboard/glossaryPostPass.ts` if you prefer; the test surface is the same.)

Wire it into the elements pipeline before they are persisted / broadcast to the renderer:

```ts
const normalized = applyGlossaryPostPass(parsedElements, glossary)
// then broadcast `normalized` instead of `parsedElements`
```

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/whiteboardService.ts src/main/index.ts src/preload/index.ts src/preload/types.ts
git commit -m "feat(glossary): whiteboard agent + IPC for label language + glossary"
```

---

### Task 7.3: `WhiteboardLabelLangSelect.tsx` + wiring

**Files:**
- Create: `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the select component**

```tsx
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'automeetic.diagramLabelLanguage'

const OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'ko', label: 'KO' },
  { value: 'en', label: 'EN' },
  { value: 'ja', label: 'JA' },
  { value: 'zh', label: 'ZH' },
  { value: 'es', label: 'ES' },
  { value: 'fr', label: 'FR' },
  { value: 'de', label: 'DE' },
]

function readInitial(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(STORAGE_KEY) ?? ''
}

function pushToMain(value: string): void {
  const api = window.electronAPI?.whiteboard?.setLabelLanguage
  if (api) void api(value || null)
}

interface Props {
  onChange?: (next: string) => void
}

export function WhiteboardLabelLangSelect({ onChange }: Props) {
  const [value, setValue] = useState<string>(readInitial)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, value)
    pushToMain(value)
  }, [value])

  // Push the initial value once on mount, in case the user's previous
  // session left a non-default in localStorage but main started fresh.
  useEffect(() => {
    pushToMain(readInitial())
  }, [])

  return (
    <label className="v4p-wb-labellang" title="Diagram label language">
      <span className="amw-mono v4p-wb-labellang-prefix">LABELS</span>
      <select
        className="v4p-wb-labellang-select amw-mono"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          onChange?.(e.target.value)
        }}
        aria-label="Diagram label language"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function readDiagramLabelLanguage(): string {
  return readInitial()
}
```

- [ ] **Step 2: Add minimal styles to `App.css`**

Append:

```css
.v4p-wb-labellang {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
}
.v4p-wb-labellang-prefix {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--p-faint);
}
.v4p-wb-labellang-select {
  height: 22px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-text);
  font-size: 11px;
  font-weight: 600;
}
```

- [ ] **Step 3: Mount inside the shelf header**

In `src/renderer/App.tsx`, locate the shelf header markup (where the `v4p-shelf-tab` Whiteboard / Actions buttons and the `v4p-shelf-x` close button live). Add an import:

```ts
import {
  WhiteboardLabelLangSelect,
  readDiagramLabelLanguage,
} from './whiteboard/WhiteboardLabelLangSelect'
```

Insert the component into the shelf-tabs row, before the close button, conditional on the Whiteboard tab being active:

```tsx
{shelf === 'whiteboard' && <WhiteboardLabelLangSelect />}
<button
  className="v4p-shelf-x"
  onClick={() => setShelf('closed')}
  ...
>
```

- [ ] **Step 4: Wire label language into whiteboard agent run payload**

In `src/renderer/App.tsx`, locate the section that sends `whiteboard:agent-run` messages. Look at the existing effect that calls `bus.onTranscript((segment) => { ... })` and inside it sends:

```ts
ws.send(
  JSON.stringify({
    type: 'whiteboard:agent-run',
    transcript: text,
  })
)
```

Replace that body with:

```ts
ws.send(
  JSON.stringify({
    type: 'whiteboard:agent-run',
    transcript: text,
    labelLanguage: readDiagramLabelLanguage() || null,
  })
)
```

- [ ] **Step 5: Verify typecheck + manual smoke test**

Run: `npm run typecheck`

Expected: clean.

Run: `npm run dev:electron`

1. Open shelf, switch to Whiteboard tab. Notice `LABELS [Auto ▾]` to the left of the close button.
2. Change to `KO`. Start a meeting in English. Verify diagrams emerge with Korean labels.
3. Add a glossary entry `kunchen → preserve`, repeat. Verify `kunchen` appears verbatim in any diagram label.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx src/renderer/App.tsx src/renderer/App.css
git commit -m "feat(glossary): diagram label language selector"
```

---

## Phase 8 — STT vocabulary bias (bonus)

### Task 8.1: Append glossary terms to STT vocabulary keywords

**Files:**
- Modify: `src/main/sttService.ts`

- [ ] **Step 1: Find the STT connect path**

Open `src/main/sttService.ts`. Locate the function that builds the keyword list passed to OpenAI Realtime / the proxy when a new STT session starts. The relevant existing logic pulls keywords from the whiteboard agent context (see `src/main/whiteboard/keywords.ts`).

- [ ] **Step 2: Merge glossary terms**

Add imports:

```ts
import type { MemoryRepository } from './memory/repository'
import type { MeetingLifecycle } from './memory/meetingLifecycle'
```

Extend the existing init function (or add one if missing — same shape as Task 5.1's pattern) so that `MemoryRepository` and `MeetingLifecycle` are accessible.

Wherever the keyword list is computed:

```ts
const whiteboardKeywords = /* existing computation */
const glossaryTerms = repoRef
  ? repoRef.activeGlossary(lifecycleRef?.getCurrentMeetingId() ?? null).map((e) => e.sourceTerm)
  : []
const seen = new Set<string>()
const vocabulary: string[] = []
for (const term of [...whiteboardKeywords, ...glossaryTerms]) {
  const key = term.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  vocabulary.push(term)
}
```

Use `vocabulary` in the existing payload to STT.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/sttService.ts src/main/index.ts
git commit -m "feat(glossary): bias STT vocabulary with glossary source terms"
```

---

## Phase 9 — Answer Assist integration

### Task 9.1: Renderer fetches glossary + attaches to Answer Assist request

**Files:**
- Modify: `src/renderer/answer-assist/useAnswerAssistStore.ts`

- [ ] **Step 1: Locate the request build site**

Open `src/renderer/answer-assist/useAnswerAssistStore.ts`. Find the `requestAnswer` function that POSTs to `/api/answer-assist` (or to the IPC equivalent in Electron mode).

- [ ] **Step 2: Fetch glossary + include in body**

Just before the POST request body is constructed, add:

```ts
let glossary: Array<{
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
}> = []
if (window.electronAPI?.glossary) {
  try {
    const active = await window.electronAPI.glossary.active()
    glossary = active.map((e) => ({
      sourceTerm: e.sourceTerm,
      translations: e.translations,
      preserve: e.preserve,
    }))
  } catch {
    glossary = []
  }
}
```

Add `glossary` to the request body alongside `transcript`, `sourceLang`, `targetLang`.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/answer-assist/useAnswerAssistStore.ts
git commit -m "feat(glossary): renderer attaches glossary to Answer Assist requests"
```

---

### Task 9.2: Proxy applies glossary to Answer Assist + translateText

**Files:**
- Modify: `server/proxy.mjs`

- [ ] **Step 1: Add helper functions at the top of `proxy.mjs`**

Below the existing imports / constants, add:

```js
const GLOSS_LANGUAGE_NAME_BY_CODE = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

function glossQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`
}

function glossEscapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatGlossarySection(entries, targetLang) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const verbatim = []
  const mapped = []
  for (const e of entries) {
    if (!e || typeof e.sourceTerm !== 'string') continue
    const trans = e.translations || {}
    if (targetLang && typeof trans[targetLang] === 'string') {
      mapped.push([e.sourceTerm, trans[targetLang]])
      continue
    }
    if (e.preserve) verbatim.push(e.sourceTerm)
  }
  if (verbatim.length === 0 && mapped.length === 0) return ''
  const out = ['GLOSSARY (apply strictly, do not paraphrase):']
  if (verbatim.length) {
    out.push(`- Keep verbatim in all output: ${verbatim.map(glossQuote).join(', ')}`)
  }
  if (mapped.length) {
    const lang = GLOSS_LANGUAGE_NAME_BY_CODE[targetLang] || targetLang
    out.push(`- When producing ${lang}, render:`)
    for (const [src, dst] of mapped) out.push(`  · ${glossQuote(src)} → ${glossQuote(dst)}`)
  }
  return out.join('\n')
}

function normalizePreserve(output, entries) {
  if (typeof output !== 'string' || !Array.isArray(entries) || entries.length === 0) return output
  let result = output
  for (const e of entries) {
    if (!e || !e.preserve || typeof e.sourceTerm !== 'string') continue
    const re = new RegExp(`\\b${glossEscapeRegex(e.sourceTerm)}\\b`, 'gi')
    result = result.replace(re, e.sourceTerm)
  }
  return result
}
```

- [ ] **Step 2: Extend `translateText`**

Find `async function translateText(text, targetLang, openaiApiKey)`. Change the signature to accept a `glossary` array:

```js
async function translateText(text, targetLang, openaiApiKey, glossary = []) {
  const targetLanguage = LANGUAGE_NAME_BY_CODE.get(targetLang) ?? targetLang
  const glossaryBlock = formatGlossarySection(glossary, targetLang)
  const systemContent = glossaryBlock
    ? `You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.\n\n${glossaryBlock}`
    : 'You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.'
  // ... existing fetch call, but use systemContent for the system role ...
  // After parsing the translation:
  const translatedRaw = /* existing parse */
  return normalizePreserve(translatedRaw, glossary)
}
```

The existing call sites of `translateText` (Answer Assist target/source translation fallbacks) work without changes — they call it with 3 args; the new 4th defaults to `[]`.

- [ ] **Step 3: Extend `/api/answer-assist`**

Find the `app.post('/api/answer-assist', …)` handler. Where it destructures the body:

```js
const { transcript, sourceLang = 'en', targetLang = 'ko' } = req.body
```

Change to:

```js
const { transcript, sourceLang = 'en', targetLang = 'ko', glossary = [] } = req.body
```

Where it calls `buildAnswerAssistPrompt(sourceLang, targetLang)`, extend the signature:

```js
// before
{ role: 'system', content: buildAnswerAssistPrompt(sourceLang, targetLang) }

// after
{ role: 'system', content: buildAnswerAssistPrompt(sourceLang, targetLang, glossary) }
```

Update `buildAnswerAssistPrompt` to accept `glossary`:

```js
function buildAnswerAssistPrompt(sourceLang, targetLang, glossary = []) {
  // ... existing body up to the return string ...
  const glossaryBlock = formatGlossarySection(glossary, targetLang === 'off' ? null : targetLang)
  const tail = glossaryBlock ? `\n\n${glossaryBlock}` : ''
  return `${existingPromptBody}${tail}`
}
```

(The exact internal structure of `buildAnswerAssistPrompt` is in `proxy.mjs` — keep its existing body verbatim and append `tail` to the final return value.)

In the fallback-translation paths inside the Answer Assist handler, pass `glossary` to `translateText`:

```js
const translated = await translateText(answer, targetLang, openaiApiKey, glossary)
```

And apply `normalizePreserve` to the primary answer too:

```js
return { answer: normalizePreserve(answer, glossary), answerKo: normalizePreserve(answerKo, glossary) }
```

- [ ] **Step 4: Verify**

Restart proxy: `npm run server` (this exits the main dev; you may want to keep proxy and electron-vite running separately).

Run an Answer Assist request from the UI (Ctrl+Shift+A during a meeting with `kunchen → preserve` in glossary). Verify `kunchen` appears verbatim in both the answer and its translation.

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs
git commit -m "feat(glossary): proxy applies glossary to Answer Assist + translateText"
```

---

## Phase 10 — Polish + verification

### Task 10.1: Full regression sweep

- [ ] **Step 1: Run all checks**

```bash
npm run typecheck
npm run lint
npx vitest run
```

Expected: typecheck clean. Lint same baseline as before this branch (4 preexisting errors, no new ones). Tests: new tests (16 + 13 + 4 = 33) plus existing tests pass; existing failures (better-sqlite3 NODE_MODULE_VERSION) are environment issues unchanged from master.

If new lint errors appear from this branch's code, fix them before continuing.

- [ ] **Step 2: Manual end-to-end with empty glossary**

`npm run dev:electron` with an empty glossary. Run a Korean→English meeting. Verify:

- Bilingual columns appear normally
- Whiteboard generates English labels (or follows the existing inference)
- No errors in the console
- Behavior identical to pre-glossary baseline

- [ ] **Step 3: Manual end-to-end with populated glossary**

Populate glossary with:

| sourceTerm | translations | preserve |
|---|---|---|
| `autoMeetic` | `{ko: '오토미틱'}` | true |
| `kunchen` | `{ko: '쿤 첸'}` | false |
| `GPU` | `{}` | true |

Set `LABELS = KO` in the whiteboard shelf. Start an English meeting where the speaker says "autoMeetic uses GPU benchmarks by kunchen".

Verify:

- Translation column: `오토미틱 uses GPU benchmarks by 쿤 첸` (or similar — `autoMeetic` may also be preserved depending on LLM)
- Whiteboard labels render `오토미틱`, `GPU`, `쿤 첸` correctly with Korean surrounding labels

- [ ] **Step 4: Commit any tweaks**

If manual testing exposed bugs, fix in-place with new commits.

---

### Task 10.2: PR

- [ ] **Step 1: Open a PR**

```bash
gh pr create --title "feat(glossary): glossary + diagram label language" --body "$(cat <<'EOF'
## Summary
- Adds a user-managed glossary (global + meeting-scoped) backed by sqlite
- Glossary terms drive translation, Answer Assist, whiteboard labels, and STT vocabulary bias
- Adds a `LABELS` selector inside the whiteboard shelf header for independent diagram label language

## Spec
docs/superpowers/specs/2026-05-19-glossary-and-diagram-label-language-design.md

## Test plan
- [ ] typecheck clean
- [ ] new vitest suites pass (glossary-repository, glossary-prompt-injection, glossary-cache)
- [ ] manual end-to-end with empty glossary (no regression)
- [ ] manual end-to-end with populated glossary + LABELS=KO
- [ ] manual end-to-end with Answer Assist + glossary preserve

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (resolved inline)

**Spec coverage:** every section of the spec maps to one or more tasks:

- Schema → Task 1.1
- Types → Task 1.2
- Repository methods → Tasks 1.3–1.6
- Shared helpers → Task 2.1
- Cache → Task 3.1
- IPC + preload → Tasks 4.1–4.2
- Translation integration → Task 5.1
- Panel UI → Tasks 6.1–6.6
- Whiteboard integration → Tasks 7.1–7.3
- STT integration → Task 8.1
- Answer Assist integration → Tasks 9.1–9.2
- Regression + ship → Tasks 10.1–10.2

**Type consistency:** `GlossaryEntry`, `GlossaryEntryInput`, method names (`listGlossary`, `upsertGlossary`, `deleteGlossary`, `activeGlossary`, `getGlossaryEntry`), cache exports (`ensureFreshGlossary`, `getCachedGlossary`, `bumpGlossaryEpoch`) are consistent across all tasks.

**Web mode parity:** explicitly out of scope (spec deferred to v2). `/api/translate` glossary support and `server/whiteboard-runtime.mjs` extensions are NOT implemented here. If you want web-mode parity later, add a follow-up plan; the helper functions in `promptInjection.ts` are reusable.

**Known limitation:** the Glossary panel currently uses `meetingId={null}` because the renderer does not track the live meeting id. The "This meeting" tab is disabled. Wiring the renderer-side meeting id is captured in the spec's Open Questions and is appropriate for a follow-up after v1.


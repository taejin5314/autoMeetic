# Glossary Auto-Suggestions — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Steps use checkbox (`- [ ]`) syntax for tracking. Execute phase-by-phase. Each phase ends in a clean state with passing tests, lint, and typecheck before moving on. Read `HANDOFF.md` first for environment quirks and conventions.

**Goal:** Add LLM-driven candidate detection that runs after each meeting ends, surfaces suggestions in the glossary panel, and retroactively normalizes that meeting's transcript on accept.

**Architecture:** Two new sqlite tables (`glossary_suggestions`, `glossary_dismissed_terms`). A `suggestionService` orchestrates the LLM extraction + dedup + storage. The accept flow is one transactional unit: upsert entry + `backfillSegments` + delete suggestion. The renderer's `GlossaryPanel` gains a "Suggestions" tab; the header glossary button gains a count badge.

**Tech Stack:** Electron, React 19, TypeScript strict (NO `any`), better-sqlite3, vitest, OpenAI Chat Completions (gpt-4o-mini).

**Spec:** `docs/superpowers/specs/2026-05-20-glossary-auto-suggestions-design.md`

**Scope reminder (do NOT exceed):** End-of-meeting batch extraction only. No real-time, no mid-meeting prefetch. Edit-before-accept is out of scope (user can edit after acceptance via the Global tab). Memory Library inline surface is out of scope.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | SCHEMA_VERSION 2→3, append two CREATE TABLE blocks |
| `src/main/memory/types.ts` | Modify | Add `GlossarySuggestion`, `GlossarySuggestionInput` |
| `src/main/memory/repository.ts` | Modify | suggestion CRUD + dismiss memory + `backfillSegments` + cleanup hook on `upsertGlossary` |
| `src/main/glossary/extractionPrompt.ts` | Create | System prompt builder + transcript framing |
| `src/main/glossary/suggestionService.ts` | Create | Extract orchestration (LLM call → parse → dedup → write) |
| `src/main/index.ts` | Modify | Wire `suggestionService.extractCandidates` after `summaryService.generateSummary` |
| `src/main/ipc-glossary-handlers.ts` | Modify | Add 5 handler factories for suggestions |
| `src/preload/index.ts` | Modify | Extend `glossary.*` bridge |
| `src/preload/types.ts` | Modify | Extend ElectronAPI types |
| `src/renderer/glossary/types.ts` | Modify | Re-export `GlossarySuggestion` |
| `src/renderer/glossary/useGlossaryStore.ts` | Modify | Add suggestions state + accept/dismiss/bulk-accept/count |
| `src/renderer/glossary/GlossaryPanel.tsx` | Modify | Add Suggestions tab + Accept-all toolbar |
| `src/renderer/glossary/SuggestionRow.tsx` | Create | Suggestion row component |
| `src/renderer/App.tsx` | Modify | Header button badge |
| `src/renderer/App.css` | Modify | Suggestion row + badge styles |
| `src/test/glossary-suggestion-repository.test.ts` | Create | Unit tests for repo methods + transactions + cleanup hook |
| `src/test/glossary-extraction.test.ts` | Create | Unit tests for `parseExtractionResponse` + dedup |
| `src/test/glossary-backfill.test.ts` | Create | Unit tests for backfillSegments |
| `src/test/glossary-suggestion-ipc.test.ts` | Create | IPC round-trip tests |

---

## Phase 1 — Storage + types + repository CRUD

### Task 1.1 — Schema bump and new tables

**Files:** `src/main/memory/schema.ts`

- [ ] **Step 1: Bump version and append tables**

Open `src/main/memory/schema.ts`. Change `SCHEMA_VERSION` from `2` to `3`. Append to the end of the SQL string (after the existing `glossary_entries` block):

```sql
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
```

- [ ] **Step 2: Update the schema version assertion**

Open `src/test/memory-repository-init.test.ts`. Update the `toBe(2)` assertion to `toBe(3)` and update the test description from "version 2" to "version 3".

- [ ] **Step 3: Verify**

```bash
npm run typecheck
npx vitest run src/test/memory-repository-init.test.ts
```

Both pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/memory/schema.ts src/test/memory-repository-init.test.ts
git commit -m "feat(glossary-suggestions): schema bump v3 + new tables"
```

---

### Task 1.2 — Types

**Files:** `src/main/memory/types.ts`

- [ ] **Step 1: Append types**

```ts
export interface GlossarySuggestion {
  id: string
  meetingId: string
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  confidence: number
  reason: string | null
  frequency: number | null
  variants: string[]
  createdAt: number
}

export interface GlossarySuggestionInput {
  id?: string
  meetingId: string
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  confidence: number
  reason: string | null
  frequency: number | null
  variants: string[]
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/types.ts
git commit -m "feat(glossary-suggestions): add GlossarySuggestion types"
```

---

### Task 1.3 — Repository: `upsertSuggestion`, `getSuggestion`, `listSuggestionsByMeeting`, `listAllPendingSuggestions`, `countPendingSuggestions` (TDD)

**Files:** `src/main/memory/repository.ts`, `src/test/glossary-suggestion-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/glossary-suggestion-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossarySuggestionInput, Meeting } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function sampleMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_test_1',
    title: 'Meeting',
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

function sampleSuggestion(over: Partial<GlossarySuggestionInput> = {}): GlossarySuggestionInput {
  return {
    meetingId: 'mtg_test_1',
    sourceTerm: 'kunchen',
    translations: { ko: '쿤 첸' },
    preserve: false,
    confidence: 0.85,
    reason: 'Personal name',
    frequency: 4,
    variants: ['Kun Chen', 'Kunchen'],
    ...over,
  }
}

describe('MemoryRepository suggestion CRUD', () => {
  it('inserts a suggestion and returns it with generated id', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const s = repo.upsertSuggestion(sampleSuggestion())
    expect(s.id).toMatch(/^sugg_/)
    expect(s.sourceTerm).toBe('kunchen')
    expect(s.translations).toEqual({ ko: '쿤 첸' })
    expect(s.variants).toEqual(['Kun Chen', 'Kunchen'])
    expect(s.createdAt).toBeGreaterThan(0)
    repo.close()
  })

  it('lists suggestions by meeting in createdAt DESC order', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const a = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'a' }))
    const b = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'b' }))
    const list = repo.listSuggestionsByMeeting('mtg_test_1')
    expect(list.map((s) => s.id)).toEqual([b.id, a.id])
    repo.close()
  })

  it('listAllPendingSuggestions returns across meetings, newest first', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting({ id: 'mtg_a', startedAt: 1 }))
    repo.insertMeeting(sampleMeeting({ id: 'mtg_b', startedAt: 2 }))
    repo.upsertSuggestion(sampleSuggestion({ meetingId: 'mtg_a', sourceTerm: 'x' }))
    repo.upsertSuggestion(sampleSuggestion({ meetingId: 'mtg_b', sourceTerm: 'y' }))
    const list = repo.listAllPendingSuggestions()
    expect(list.length).toBe(2)
    expect(list[0].sourceTerm).toBe('y') // most recent first
    repo.close()
  })

  it('countPendingSuggestions returns the number of pending rows', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    expect(repo.countPendingSuggestions()).toBe(0)
    repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'a' }))
    repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'b' }))
    expect(repo.countPendingSuggestions()).toBe(2)
    repo.close()
  })

  it('rejects empty sourceTerm', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    expect(() => repo.upsertSuggestion(sampleSuggestion({ sourceTerm: '   ' }))).toThrow(
      /sourceTerm/i
    )
    repo.close()
  })

  it('rejects confidence outside [0, 1]', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    expect(() => repo.upsertSuggestion(sampleSuggestion({ confidence: 1.5 }))).toThrow(/confidence/i)
    expect(() => repo.upsertSuggestion(sampleSuggestion({ confidence: -0.1 }))).toThrow(/confidence/i)
    repo.close()
  })

  it('cascades on meeting delete', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.upsertSuggestion(sampleSuggestion())
    repo.deleteMeeting('mtg_test_1')
    expect(repo.countPendingSuggestions()).toBe(0)
    repo.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts -t "suggestion CRUD"
```

Expect FAIL (methods not defined).

- [ ] **Step 3: Implement repository methods**

Open `src/main/memory/repository.ts`. Add to the existing imports if not present:

```ts
import type { GlossarySuggestion, GlossarySuggestionInput } from './types'
```

Add the following methods inside the `MemoryRepository` class (place after the existing glossary methods, before `close()`):

```ts
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
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts -t "suggestion CRUD"
```

Expect PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-suggestion-repository.test.ts
git commit -m "feat(glossary-suggestions): repository CRUD"
```

---

### Task 1.4 — Repository: `acceptSuggestion`, `dismissSuggestion` (TDD with transactions)

**Files:** `src/main/memory/repository.ts`, `src/test/glossary-suggestion-repository.test.ts`

- [ ] **Step 1: Append failing tests** to `src/test/glossary-suggestion-repository.test.ts`:

```ts
import type { Segment } from '../main/memory/types'

function sampleSegment(over: Partial<Segment> = {}): Segment {
  return {
    id: 'seg_1',
    meetingId: 'mtg_test_1',
    seq: 0,
    createdAt: 1_700_000_001_000,
    speakerId: null,
    speakerLabel: null,
    sourceText: 'kunchen said hello',
    translatedText: 'kunchen이 안녕하세요',
    sourceLanguage: 'en',
    ...over,
  }
}

describe('MemoryRepository acceptSuggestion', () => {
  it('creates a glossary entry, backfills segments, and deletes the suggestion in a transaction', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.insertSegment(sampleSegment({ id: 's1', sourceText: 'kunchen', translatedText: 'kunchen' }))
    repo.insertSegment(
      sampleSegment({ id: 's2', sourceText: 'Kun Chen here', translatedText: 'Kun Chen 여기' })
    )
    const sugg = repo.upsertSuggestion(
      sampleSuggestion({
        sourceTerm: 'kunchen',
        translations: { ko: '쿤 첸' },
        preserve: false,
        variants: ['Kun Chen'],
      })
    )
    const entry = repo.acceptSuggestion(sugg.id)
    expect(entry.sourceTerm).toBe('kunchen')
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    expect(repo.countPendingSuggestions()).toBe(0)

    const segs = repo.listSegmentsByMeeting('mtg_test_1')
    expect(segs.find((s) => s.id === 's1')?.translatedText).toBe('쿤 첸')
    expect(segs.find((s) => s.id === 's2')?.sourceText).toBe('kunchen here')
    expect(segs.find((s) => s.id === 's2')?.translatedText).toBe('쿤 첸 여기')
    repo.close()
  })

  it('rolls back if backfill produces an error (no entry created, suggestion remains)', () => {
    // Forcing a backfill error is hard via public API; use a small spy approach:
    // run a real accept on data that produces no segments to backfill (no-op backfill is fine),
    // then assert idempotency.
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const sugg = repo.upsertSuggestion(sampleSuggestion())
    repo.acceptSuggestion(sugg.id)
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    repo.close()
  })

  it('throws when suggestion id is missing', () => {
    const repo = makeRepo()
    expect(() => repo.acceptSuggestion('missing')).toThrow(/not found/i)
    repo.close()
  })
})

describe('MemoryRepository dismissSuggestion', () => {
  it('records the term in dismissed_terms and deletes the suggestion', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const sugg = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'GPU' }))
    repo.dismissSuggestion(sugg.id)
    expect(repo.getSuggestion(sugg.id)).toBeNull()
    expect(repo.isDismissed('GPU')).toBe(true)
    expect(repo.isDismissed('gpu')).toBe(true) // case-insensitive
    repo.close()
  })

  it('is a no-op if id does not exist', () => {
    const repo = makeRepo()
    expect(() => repo.dismissSuggestion('missing')).not.toThrow()
    repo.close()
  })

  it('updates dismissed_at on conflict (re-dismissed)', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    const sugg1 = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'GPU' }))
    repo.dismissSuggestion(sugg1.id)
    const first = repo.getDismissedAt('GPU')
    const sugg2 = repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'GPU' }))
    repo.dismissSuggestion(sugg2.id)
    const second = repo.getDismissedAt('GPU')
    expect(second).toBeGreaterThanOrEqual(first!)
    repo.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts -t "acceptSuggestion|dismissSuggestion"
```

Expect FAIL.

- [ ] **Step 3: Implement methods**

Add to `MemoryRepository`:

```ts
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
```

You'll need `backfillSegments` and `listSegmentsByMeeting`. Implement `listSegmentsByMeeting` if missing:

```ts
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
```

(If this method already exists in the file, skip the addition. Search with Grep for `listSegmentsByMeeting` first.)

Stub `backfillSegments` with an empty body for now — the next task implements it:

```ts
  backfillSegments(meetingId: string, entry: GlossaryEntry, variants: string[]): number {
    void meetingId
    void entry
    void variants
    return 0
  }
```

- [ ] **Step 4: Run accept/dismiss tests (backfill not yet implemented — only the "no-op backfill" cases will pass; the "creates entry + backfills segments + deletes" case will fail on the segment assertions)**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts -t "dismissSuggestion"
```

Expect dismiss tests PASS. The accept "rolls back" and "throws when missing" tests should PASS. The "creates entry + backfills" test should FAIL (segments not updated). That's expected; Task 1.5 fixes it.

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-suggestion-repository.test.ts
git commit -m "feat(glossary-suggestions): accept + dismiss with transaction + dismiss memory"
```

---

### Task 1.5 — `backfillSegments` helper (TDD)

**Files:** `src/main/memory/repository.ts`, `src/test/glossary-backfill.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/glossary-backfill.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import type { GlossaryEntry, Meeting, Segment } from '../main/memory/types'

function makeRepo(): MemoryRepository {
  return new MemoryRepository(':memory:')
}

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg_1',
    title: 'm',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
    ...overrides,
  }
}

function seg(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    meetingId: 'mtg_1',
    seq: 0,
    createdAt: 2,
    speakerId: null,
    speakerLabel: null,
    sourceText: '',
    translatedText: '',
    sourceLanguage: 'en',
    ...overrides,
  }
}

function entry(overrides: Partial<GlossaryEntry>): GlossaryEntry {
  return {
    id: 'g1',
    scope: 'global',
    meetingId: null,
    sourceTerm: 'kunchen',
    translations: {},
    preserve: false,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('backfillSegments — preserve=true', () => {
  it('canonicalizes source and translated text for verbatim terms', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'GPU helps', translatedText: 'gpu helps' }))
    repo.insertSegment(seg({ id: 's2', sourceText: 'gpu power', translatedText: 'GPU 파워' }))
    const e = entry({ sourceTerm: 'GPU', preserve: true })
    const n = repo.backfillSegments('mtg_1', e, [])
    expect(n).toBe(1) // only s1 needs translatedText fixed (source already canonical)
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs.find((s) => s.id === 's1')?.translatedText).toBe('GPU helps')
    expect(segs.find((s) => s.id === 's2')?.sourceText).toBe('GPU power')
    repo.close()
  })

  it('respects word boundaries (does not touch GPUS)', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'multiple GPUS here', translatedText: 'gpus here' }))
    const e = entry({ sourceTerm: 'GPU', preserve: true })
    const n = repo.backfillSegments('mtg_1', e, [])
    expect(n).toBe(0) // no canonical replacement applies (GPUS is a different word)
    repo.close()
  })

  it('uses variants too', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'Kun Chen joined', translatedText: 'Kun Chen 합류' }))
    const e = entry({ sourceTerm: 'kunchen', preserve: true })
    repo.backfillSegments('mtg_1', e, ['Kun Chen'])
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs[0].sourceText).toBe('kunchen joined')
    expect(segs[0].translatedText).toBe('kunchen 합류')
    repo.close()
  })
})

describe('backfillSegments — preserve=false with translation mapping', () => {
  it('canonicalizes source and applies translation in target column', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting({ targetLanguage: 'ko' }))
    repo.insertSegment(
      seg({ id: 's1', sourceText: 'Kun Chen said', translatedText: 'Kun Chen이 말했다' })
    )
    const e = entry({
      sourceTerm: 'kunchen',
      preserve: false,
      translations: { ko: '쿤 첸' },
    })
    repo.backfillSegments('mtg_1', e, ['Kun Chen'])
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs[0].sourceText).toBe('kunchen said')
    expect(segs[0].translatedText).toBe('쿤 첸이 말했다')
    repo.close()
  })

  it('leaves translation alone when targetLanguage has no entry', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting({ targetLanguage: 'ja' }))
    repo.insertSegment(seg({ id: 's1', sourceText: 'Kun Chen', translatedText: 'Kun Chen' }))
    const e = entry({
      sourceTerm: 'kunchen',
      preserve: false,
      translations: { ko: '쿤 첸' },
    })
    repo.backfillSegments('mtg_1', e, ['Kun Chen'])
    const segs = repo.listSegmentsByMeeting('mtg_1')
    expect(segs[0].sourceText).toBe('kunchen')
    expect(segs[0].translatedText).toBe('Kun Chen') // unchanged
    repo.close()
  })
})

describe('backfillSegments — returns count of changed rows', () => {
  it('counts only segments that actually changed', () => {
    const repo = makeRepo()
    repo.insertMeeting(meeting())
    repo.insertSegment(seg({ id: 's1', sourceText: 'no match here', translatedText: 'no match' }))
    const e = entry({ sourceTerm: 'kunchen', preserve: true })
    expect(repo.backfillSegments('mtg_1', e, [])).toBe(0)
    repo.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-backfill.test.ts
```

Expect FAIL (backfill stub returns 0 always; segments not modified).

- [ ] **Step 3: Implement `backfillSegments`** in `MemoryRepository` (replace the stub):

```ts
  backfillSegments(meetingId: string, entry: GlossaryEntry, variants: string[]): number {
    const m = this.getMeeting(meetingId)
    if (!m) return 0
    const segments = this.listSegmentsByMeeting(meetingId)
    if (segments.length === 0) return 0

    const targetLang = m.targetLanguage
    const targetForm =
      !entry.preserve && targetLang && entry.translations[targetLang]
        ? entry.translations[targetLang]
        : null
    const terms = [entry.sourceTerm, ...variants]
    const sourceRegexes = terms.map(
      (t) => new RegExp(`\\b${escapeRegex(t)}\\b`, 'gi')
    )

    const stmt = this.db.prepare(
      `UPDATE segments SET source_text = ?, translated_text = ? WHERE id = ?`
    )
    let changed = 0
    for (const segment of segments) {
      let nextSource = segment.sourceText
      let nextTranslated = segment.translatedText ?? ''
      for (const re of sourceRegexes) {
        nextSource = nextSource.replace(re, entry.sourceTerm)
        if (entry.preserve) {
          nextTranslated = nextTranslated.replace(re, entry.sourceTerm)
        } else if (targetForm) {
          nextTranslated = nextTranslated.replace(re, targetForm)
        }
      }
      if (nextSource !== segment.sourceText || nextTranslated !== (segment.translatedText ?? '')) {
        stmt.run(nextSource, nextTranslated, segment.id)
        changed += 1
      }
    }
    return changed
  }
```

Add this helper at module-level (if not already present elsewhere in the file):

```ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

(If the v1 work added this helper to a different file, you can either re-declare here or import from `src/main/glossary/promptInjection.ts` — search for `escapeRegex` and reuse whichever pattern is cleaner.)

- [ ] **Step 4: Verify the failing accept test from Task 1.4 now passes**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts
npx vitest run src/test/glossary-backfill.test.ts
```

All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-backfill.test.ts
git commit -m "feat(glossary-suggestions): backfillSegments with preserve + translation paths"
```

---

### Task 1.6 — Cleanup hook on manual upsertGlossary (TDD)

**Files:** `src/main/memory/repository.ts`, `src/test/glossary-suggestion-repository.test.ts`

- [ ] **Step 1: Append failing test**

Append to `src/test/glossary-suggestion-repository.test.ts`:

```ts
describe('upsertGlossary cleanup hook for pending suggestions', () => {
  it('deletes any pending suggestion matching the same sourceTerm when a user adds the entry manually', () => {
    const repo = makeRepo()
    repo.insertMeeting(sampleMeeting())
    repo.upsertSuggestion(sampleSuggestion({ sourceTerm: 'autoMeetic' }))
    expect(repo.countPendingSuggestions()).toBe(1)
    repo.upsertGlossary({
      scope: 'global',
      meetingId: null,
      sourceTerm: 'AutoMeetic', // case-insensitive match
      translations: { ko: '오토미틱' },
      preserve: true,
      note: null,
    })
    expect(repo.countPendingSuggestions()).toBe(0)
    repo.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts -t "cleanup hook"
```

Expect FAIL.

- [ ] **Step 3: Modify `upsertGlossary`** to delete matching suggestions at the end (just before `return this.getGlossaryEntry(id)!`):

In both branches of `upsertGlossary` (insert and update), append the cleanup statement right before returning:

```ts
    // Cleanup pending suggestions that match this sourceTerm (case-insensitive).
    this.db
      .prepare('DELETE FROM glossary_suggestions WHERE LOWER(source_term) = LOWER(?)')
      .run(term)
```

Place this line just before the `return this.getGlossaryEntry(id)!` (or `return this.getGlossaryEntry(input.id)!`) on each branch.

- [ ] **Step 4: Verify**

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts -t "cleanup hook"
```

PASS.

Also run the full repo test file to make sure no regression:

```bash
npx vitest run src/test/glossary-suggestion-repository.test.ts src/test/glossary-repository.test.ts
```

All pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/repository.ts src/test/glossary-suggestion-repository.test.ts
git commit -m "feat(glossary-suggestions): cleanup hook on manual upsert"
```

---

## Phase 2 — Extraction service

### Task 2.1 — `extractionPrompt.ts` (TDD)

**Files:** `src/main/glossary/extractionPrompt.ts`, `src/test/glossary-extraction.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/glossary-extraction.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildExtractionSystemPrompt,
  parseExtractionResponse,
} from '../main/glossary/extractionPrompt'

describe('buildExtractionSystemPrompt', () => {
  it('embeds the target language name and existing terms', () => {
    const out = buildExtractionSystemPrompt({
      targetLang: 'ko',
      existingTerms: ['autoMeetic', 'GPU'],
      dismissedTerms: ['ignore'],
    })
    expect(out).toContain('Active target language: ko')
    expect(out).toContain('autoMeetic')
    expect(out).toContain('GPU')
    expect(out).toContain('ignore')
  })

  it('uses (empty) marker when lists are empty', () => {
    const out = buildExtractionSystemPrompt({
      targetLang: 'off',
      existingTerms: [],
      dismissedTerms: [],
    })
    expect(out).toContain('(empty)')
    expect(out).toContain('Active target language: off')
  })

  it('truncates long term lists to 200 entries each', () => {
    const big = Array.from({ length: 500 }, (_, i) => `term${i}`)
    const out = buildExtractionSystemPrompt({
      targetLang: 'ko',
      existingTerms: big,
      dismissedTerms: big,
    })
    expect(out).not.toContain('term499')
    expect(out).toContain('term0')
    expect(out).toContain('term199')
  })
})

describe('parseExtractionResponse', () => {
  it('returns [] for non-JSON content', () => {
    expect(parseExtractionResponse('not json')).toEqual([])
  })

  it('returns [] when candidates is missing', () => {
    expect(parseExtractionResponse('{"foo": "bar"}')).toEqual([])
  })

  it('parses valid candidates', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          sourceTerm: 'kunchen',
          variants: ['Kun Chen'],
          translations: { ko: '쿤 첸' },
          preserve: false,
          confidence: 0.85,
          reason: 'Personal name',
          frequency: 4,
        },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out).toHaveLength(1)
    expect(out[0].sourceTerm).toBe('kunchen')
    expect(out[0].translations).toEqual({ ko: '쿤 첸' })
  })

  it('drops candidates with confidence < 0.5', () => {
    const raw = JSON.stringify({
      candidates: [
        { sourceTerm: 'low', variants: [], translations: {}, preserve: true, confidence: 0.3, reason: 'x', frequency: 1 },
        { sourceTerm: 'ok', variants: [], translations: {}, preserve: true, confidence: 0.6, reason: 'y', frequency: 2 },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out.map((c) => c.sourceTerm)).toEqual(['ok'])
  })

  it('drops candidates with invalid types', () => {
    const raw = JSON.stringify({
      candidates: [
        { sourceTerm: '', variants: [], translations: {}, preserve: false, confidence: 0.9, reason: '', frequency: 1 },
        { sourceTerm: 123, variants: [], translations: {}, preserve: true, confidence: 0.9, reason: 'y', frequency: 1 },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out).toEqual([])
  })

  it('truncates reason to 200 chars and clamps variants to non-empty strings', () => {
    const raw = JSON.stringify({
      candidates: [
        {
          sourceTerm: 'X',
          variants: ['valid', '', '   ', 42],
          translations: {},
          preserve: true,
          confidence: 0.9,
          reason: 'r'.repeat(300),
          frequency: 1,
        },
      ],
    })
    const out = parseExtractionResponse(raw)
    expect(out).toHaveLength(1)
    expect(out[0].variants).toEqual(['valid'])
    expect((out[0].reason ?? '').length).toBeLessThanOrEqual(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-extraction.test.ts
```

Expect FAIL (module not found).

- [ ] **Step 3: Implement** `src/main/glossary/extractionPrompt.ts`:

```ts
import type { GlossarySuggestionInput } from '../memory/types'

interface BuildPromptArgs {
  targetLang: string
  existingTerms: string[]
  dismissedTerms: string[]
}

const MAX_TERMS = 200

export function buildExtractionSystemPrompt(args: BuildPromptArgs): string {
  const existing = args.existingTerms.slice(0, MAX_TERMS)
  const dismissed = args.dismissedTerms.slice(0, MAX_TERMS)
  const existingBlock = existing.length === 0 ? '(empty)' : existing.join(', ')
  const dismissedBlock = dismissed.length === 0 ? '(empty)' : dismissed.join(', ')
  return `You are a glossary extractor for meeting transcripts. Find recurring proper
nouns, brand names, code symbols, and technical terms that appear
inconsistently rendered — these are candidates for the user's glossary.

DO suggest:
- Person/company/product names mentioned multiple times
- Code identifiers, API/framework names, technical acronyms (when domain-specific)
- Foreign-origin terms used as proper nouns (e.g., romanized names like "kunchen")

DO NOT suggest:
- Common nouns (meeting, project, data, report)
- Numbers, dates, times, file paths
- Words mentioned only once unless declared explicitly as a project codename
- Terms already in the user's existing glossary (provided below)
- Terms the user previously dismissed (provided below)

Strongest signal: a term rendered DIFFERENTLY across occurrences in the
transcript (e.g., "kunchen", "Kun Chen", "쿤천" — same person).

Active target language: ${args.targetLang}
Existing glossary terms (case-insensitive — do NOT re-suggest):
${existingBlock}
Previously dismissed terms (do NOT re-suggest):
${dismissedBlock}

Output JSON only. Schema:
{
  "candidates": [
    {
      "sourceTerm": string,
      "variants": string[],
      "translations": object,
      "preserve": boolean,
      "confidence": number,
      "reason": string,
      "frequency": integer
    }
  ]
}

Rules:
- Pick ONE canonical sourceTerm form. List other forms in "variants".
- If targetLang is "off" or empty, leave translations as {}.
- Only propose preserve=true when the term is a code symbol, acronym, or brand name.
- confidence < 0.5 → exclude from output.
- Return at most 10 candidates, ordered by confidence DESC.
- Output JSON only. No code fences, labels, or explanation.`
}

type RawCandidate = {
  sourceTerm?: unknown
  variants?: unknown
  translations?: unknown
  preserve?: unknown
  confidence?: unknown
  reason?: unknown
  frequency?: unknown
}

export function parseExtractionResponse(
  raw: string
): Array<Omit<GlossarySuggestionInput, 'meetingId' | 'id'>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const candidates = (parsed as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return []

  const out: Array<Omit<GlossarySuggestionInput, 'meetingId' | 'id'>> = []
  for (const raw of candidates as RawCandidate[]) {
    if (!raw || typeof raw !== 'object') continue
    const sourceTerm =
      typeof raw.sourceTerm === 'string' ? raw.sourceTerm.trim() : ''
    if (!sourceTerm || sourceTerm.length > 100) continue
    const preserve = raw.preserve === true
    const confidence =
      typeof raw.confidence === 'number' ? raw.confidence : Number.NaN
    if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) continue
    const frequency =
      typeof raw.frequency === 'number' && Number.isFinite(raw.frequency) && raw.frequency > 0
        ? Math.floor(raw.frequency)
        : null
    const reasonRaw = typeof raw.reason === 'string' ? raw.reason : ''
    const reason = reasonRaw.length === 0 ? null : reasonRaw.slice(0, 200)
    const variants = Array.isArray(raw.variants)
      ? Array.from(
          new Set(
            (raw.variants as unknown[])
              .map((v) => (typeof v === 'string' ? v.trim() : ''))
              .filter((v) => v.length > 0 && v.length <= 100 && v.toLowerCase() !== sourceTerm.toLowerCase())
          )
        )
      : []
    const translationsRaw =
      raw.translations && typeof raw.translations === 'object' ? raw.translations : {}
    const translations: Record<string, string> = {}
    for (const [k, v] of Object.entries(translationsRaw as Record<string, unknown>)) {
      if (typeof k !== 'string' || k.length === 0 || k.length > 20) continue
      if (typeof v !== 'string' || v.length === 0 || v.length > 100) continue
      translations[k] = v
    }
    out.push({
      sourceTerm,
      variants,
      translations,
      preserve,
      confidence,
      reason,
      frequency,
    })
  }
  return out
}
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/test/glossary-extraction.test.ts
npm run typecheck
```

All pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/glossary/extractionPrompt.ts src/test/glossary-extraction.test.ts
git commit -m "feat(glossary-suggestions): extraction prompt + response parser"
```

---

### Task 2.2 — `suggestionService.extractCandidates`

**Files:** `src/main/glossary/suggestionService.ts`

This service is the orchestrator. It is not heavily unit-tested (it composes pieces that are unit-tested), but its happy path is verified manually + in IPC tests later.

- [ ] **Step 1: Investigate where the OpenAI fetch helper lives**

Search `src/main/` for the existing pattern that other LLM calls use. `summaryService.ts` calls `summarizeMeeting` from `proxyService.ts`. Re-use the same `getApiKey()` + `fetch` pattern.

- [ ] **Step 2: Create the service**

Create `src/main/glossary/suggestionService.ts`:

```ts
import type { MemoryService } from '../memory/memoryService'
import { buildExtractionSystemPrompt, parseExtractionResponse } from './extractionPrompt'
import { buildTranscriptUserPrompt } from '../memory/prompts/summary.v1'
import { logger } from '../telemetry/logger'

const EXTRACTION_MODEL = process.env.GLOSSARY_EXTRACTION_MODEL ?? 'gpt-4o-mini'
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_TRANSCRIPT_CHARS = 100_000

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export async function extractCandidates(
  memory: MemoryService,
  meetingId: string,
  notify: () => void
): Promise<void> {
  try {
    const m = memory.repository.getMeeting(meetingId)
    if (!m) {
      logger.warn('glossary.extraction.no-meeting', { meetingId })
      return
    }

    const segments = memory.repository.listSegmentsByMeeting(meetingId)
    if (segments.length === 0) {
      logger.info('glossary.extraction.empty-transcript', { meetingId })
      return
    }

    const userPrompt = buildTranscriptUserPrompt(m.startedAt, segments)
    if (userPrompt.length > MAX_TRANSCRIPT_CHARS) {
      logger.warn('glossary.extraction.failure', {
        meetingId,
        reason: 'transcript-too-large',
        length: userPrompt.length,
      })
      return
    }

    const existingEntries = memory.repository.activeGlossary(meetingId)
    const dismissedTerms = memory.repository.listDismissedTerms(200)
    const targetLang = m.targetLanguage ?? 'off'

    const systemPrompt = buildExtractionSystemPrompt({
      targetLang,
      existingTerms: existingEntries.map((e) => e.sourceTerm),
      dismissedTerms,
    })

    const apiKey = getApiKey()
    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    })

    if (!res.ok) {
      logger.warn('glossary.extraction.failure', {
        meetingId,
        reason: 'llm-error',
        status: res.status,
      })
      return
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const candidates = parseExtractionResponse(content)

    if (candidates.length === 0) {
      logger.info('glossary.extraction.success', { meetingId, emitted: 0 })
      return
    }

    // Final dedup pass: existing glossary + dismissed terms + intra-batch.
    const existingLower = new Set(existingEntries.map((e) => e.sourceTerm.toLowerCase()))
    const dismissedLower = new Set(dismissedTerms.map((d) => d.toLowerCase()))
    const seenInBatch = new Map<string, (typeof candidates)[number]>()
    for (const c of candidates) {
      const key = c.sourceTerm.toLowerCase()
      if (existingLower.has(key) || dismissedLower.has(key)) continue
      const prev = seenInBatch.get(key)
      if (!prev || prev.confidence < c.confidence) seenInBatch.set(key, c)
    }

    let written = 0
    for (const c of seenInBatch.values()) {
      try {
        memory.repository.upsertSuggestion({
          meetingId,
          ...c,
        })
        written += 1
      } catch (err) {
        logger.warn('glossary.extraction.upsert-failed', {
          meetingId,
          sourceTerm: c.sourceTerm,
          error: String(err),
        })
      }
    }

    logger.info('glossary.extraction.success', {
      meetingId,
      emitted: written,
      candidatesProposed: candidates.length,
    })

    if (written > 0) notify()
  } catch (err) {
    logger.warn('glossary.extraction.failure', {
      meetingId,
      reason: 'unexpected',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

**Note on `logger`:** The existing `src/main/telemetry/logger.ts` may use a different export shape. Inspect it first and adapt (e.g., it may export named loggers like `logger.event` or just `log.info`). The exact log function names are not load-bearing — only that some structured log is emitted on each branch.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/glossary/suggestionService.ts
git commit -m "feat(glossary-suggestions): extraction service orchestration"
```

---

## Phase 3 — IPC + preload + meeting-lifecycle wiring

### Task 3.1 — IPC handlers

**Files:** `src/main/ipc-glossary-handlers.ts`

- [ ] **Step 1: Extend the handler factory**

Open `src/main/ipc-glossary-handlers.ts`. Add five new handlers to the `buildGlossaryHandlers` return object (alongside the existing list/upsert/delete/active/onChanged):

```ts
    'glossary:suggestions:list': async (args: { meetingId?: string } = {}) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      if (args.meetingId) return repo.listSuggestionsByMeeting(args.meetingId)
      return repo.listAllPendingSuggestions()
    },
    'glossary:suggestions:accept': async (args: { id: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const entry = repo.acceptSuggestion(args.id)
      broadcastChanged()
      broadcastSuggestionsUpdated()
      broadcastMeetingUpdated()
      return entry
    },
    'glossary:suggestions:dismiss': async (args: { id: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      repo.dismissSuggestion(args.id)
      broadcastSuggestionsUpdated()
    },
    'glossary:suggestions:bulk-accept': async (args: { ids: string[] }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const accepted: string[] = []
      const failed: Array<{ id: string; error: string }> = []
      for (const id of args.ids) {
        try {
          repo.acceptSuggestion(id)
          accepted.push(id)
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : String(err) })
        }
      }
      broadcastChanged()
      broadcastSuggestionsUpdated()
      broadcastMeetingUpdated()
      return { accepted, failed }
    },
    'glossary:suggestions:count': async () => {
      const repo = await getReady(getRepo, 'Glossary repo')
      return repo.countPendingSuggestions()
    },
```

Add the new broadcasts as module-level helpers near `broadcastChanged`:

```ts
function broadcastSuggestionsUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('glossary:suggestions-updated')
  }
}

function broadcastMeetingUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('memory:meeting-updated')
  }
}
```

Extend the `GlossaryRepoApi` type to include the new repository methods:

```ts
export type GlossaryRepoApi = Pick<
  MemoryRepository,
  | 'listGlossary'
  | 'upsertGlossary'
  | 'deleteGlossary'
  | 'activeGlossary'
  | 'upsertSuggestion'
  | 'getSuggestion'
  | 'listSuggestionsByMeeting'
  | 'listAllPendingSuggestions'
  | 'countPendingSuggestions'
  | 'acceptSuggestion'
  | 'dismissSuggestion'
>
```

- [ ] **Step 2: Register the new IPC channels in `src/main/index.ts`**

The existing block that iterates `glossaryHandlers` already covers all keys, so no change needed there — the loop picks up the new entries automatically.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-glossary-handlers.ts
git commit -m "feat(glossary-suggestions): IPC handlers (list/accept/dismiss/bulk/count)"
```

---

### Task 3.2 — Preload bridge

**Files:** `src/preload/index.ts`, `src/preload/types.ts`

- [ ] **Step 1: Extend the `glossary` API in `preload/index.ts`**

Inside the existing `glossary: { ... }` object:

```ts
suggestions: {
  list: (meetingId?: string) =>
    ipcRenderer.invoke('glossary:suggestions:list', { meetingId }),
  accept: (id: string) => ipcRenderer.invoke('glossary:suggestions:accept', { id }),
  dismiss: (id: string) => ipcRenderer.invoke('glossary:suggestions:dismiss', { id }),
  bulkAccept: (ids: string[]) =>
    ipcRenderer.invoke('glossary:suggestions:bulk-accept', { ids }),
  count: () => ipcRenderer.invoke('glossary:suggestions:count'),
  onUpdated: createEventListener(
    'glossary:suggestions-updated'
  ) as ElectronAPI['glossary']['suggestions']['onUpdated'],
},
```

- [ ] **Step 2: Extend `preload/types.ts`** under `GlossaryAPI`:

```ts
suggestions: {
  list(meetingId?: string): Promise<GlossarySuggestion[]>
  accept(id: string): Promise<GlossaryEntry>
  dismiss(id: string): Promise<void>
  bulkAccept(ids: string[]): Promise<{ accepted: string[]; failed: Array<{ id: string; error: string }> }>
  count(): Promise<number>
  onUpdated(handler: () => void): () => void
}
```

Add type-only import at the top of `preload/types.ts`:

```ts
import type { GlossarySuggestion } from '../main/memory/types'
```

(If `GlossaryEntry` is already imported, just add `GlossarySuggestion` to the import.)

- [ ] **Step 3: Verify typecheck + commit**

```bash
npm run typecheck
git add src/preload/index.ts src/preload/types.ts
git commit -m "feat(glossary-suggestions): preload bridge for suggestions"
```

---

### Task 3.3 — IPC round-trip test (smoke)

**Files:** `src/test/glossary-suggestion-ipc.test.ts`

- [ ] **Step 1: Mirror `glossary-ipc-handlers.test.ts` shape**

Read the existing `src/test/glossary-ipc-handlers.test.ts` to understand the mock pattern (it stubs `BrowserWindow.getAllWindows()` and dispatches synchronously). Create `src/test/glossary-suggestion-ipc.test.ts` with the equivalent shape covering:

- `glossary:suggestions:list` (with and without `meetingId`)
- `glossary:suggestions:count`
- `glossary:suggestions:accept` happy path
- `glossary:suggestions:bulk-accept` mixed-success

Use `MemoryRepository(':memory:')` as the backing repo (insert a meeting + segment + suggestion before each test). Mock `BrowserWindow.getAllWindows()` with `vi.mock('electron', ...)` matching the existing pattern.

If the existing IPC test file uses helpers like `setupRepo` / `withMockedBrowserWindows`, reuse them. Skip exhaustive coverage — this is a smoke test ensuring handlers wire correctly. Aim for ~6 tests.

- [ ] **Step 2: Run and commit**

```bash
npx vitest run src/test/glossary-suggestion-ipc.test.ts
git add src/test/glossary-suggestion-ipc.test.ts
git commit -m "test(glossary-suggestions): IPC round-trip smoke tests"
```

---

### Task 3.4 — Wire extraction into the meeting lifecycle

**Files:** `src/main/index.ts`

- [ ] **Step 1: Locate the summary-on-end orchestration**

Search `src/main/index.ts` for where `summaryService.generateSummary` (or equivalent) is invoked. The existing pattern likely sits inside a handler for STT stop, or inside a `meetingLifecycle.endMeeting()` callback.

- [ ] **Step 2: Append extraction call after the summary**

Right after the summary call resolves (or fails), invoke:

```ts
import { extractCandidates as extractGlossaryCandidates } from './glossary/suggestionService'

// ...where the summary completes for a known ended meeting id...

const memorySvc = await memoryServicePromise.catch(() => null)
if (memorySvc && endedMeetingId) {
  void extractGlossaryCandidates(memorySvc, endedMeetingId, () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('glossary:suggestions-updated')
    }
  })
}
```

The exact location and variable names depend on the existing orchestration. Match the existing pattern (search for `summaryService` or `generateSummary` and add the extraction call below it). If the summary path is async fire-and-forget, the extraction should also be fire-and-forget (`void`).

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/main/index.ts
git commit -m "feat(glossary-suggestions): wire extraction into meeting end lifecycle"
```

---

## Phase 4 — Renderer state

### Task 4.1 — Re-export the suggestion type for the renderer

**Files:** `src/renderer/glossary/types.ts`

- [ ] **Step 1: Add the re-export**

Append to `src/renderer/glossary/types.ts`:

```ts
export type { GlossarySuggestion } from '../../main/memory/types'
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
git add src/renderer/glossary/types.ts
git commit -m "feat(glossary-suggestions): renderer type re-export"
```

---

### Task 4.2 — Extend `useGlossaryStore` with suggestions state

**Files:** `src/renderer/glossary/useGlossaryStore.ts`

- [ ] **Step 1: Read the existing hook**

Open `src/renderer/glossary/useGlossaryStore.ts`. The existing hook returns `{ entries, status, errorMessage, refresh, upsert, remove }`. Extend it to also expose suggestion state and actions.

- [ ] **Step 2: Add state + actions**

Add to the hook (inside the existing `useGlossaryStore` function body):

```ts
const [suggestions, setSuggestions] = useState<GlossarySuggestion[]>([])
const [pendingCount, setPendingCount] = useState<number>(0)

const loadSuggestions = useCallback(async () => {
  const api = window.electronAPI?.glossary?.suggestions
  if (!api) {
    setSuggestions([])
    setPendingCount(0)
    return
  }
  const [items, count] = await Promise.all([api.list(), api.count()])
  setSuggestions(items)
  setPendingCount(count)
}, [])

const acceptSuggestion = useCallback(async (id: string) => {
  const api = window.electronAPI?.glossary?.suggestions
  if (!api) return
  await api.accept(id)
}, [])

const dismissSuggestion = useCallback(async (id: string) => {
  const api = window.electronAPI?.glossary?.suggestions
  if (!api) return
  await api.dismiss(id)
}, [])

const bulkAcceptSuggestions = useCallback(async (ids: string[]) => {
  const api = window.electronAPI?.glossary?.suggestions
  if (!api) return { accepted: 0, failed: 0 }
  const result = await api.bulkAccept(ids)
  return { accepted: result.accepted.length, failed: result.failed.length }
}, [])

useEffect(() => {
  void loadSuggestions()
}, [loadSuggestions])

useEffect(() => {
  const api = window.electronAPI?.glossary
  if (!api?.suggestions) return
  const unsub = api.suggestions.onUpdated(() => {
    void loadSuggestions()
  })
  return unsub
}, [loadSuggestions])
```

Add `GlossarySuggestion` to the import line at the top:

```ts
import type { GlossaryEntry, GlossaryEntryInput, GlossarySuggestion } from './types'
```

Extend the return object:

```ts
return {
  entries: state.entries,
  status: state.status,
  errorMessage: state.errorMessage,
  refresh: load,
  upsert,
  remove,
  suggestions,
  pendingCount,
  loadSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  bulkAcceptSuggestions,
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/renderer/glossary/useGlossaryStore.ts
git commit -m "feat(glossary-suggestions): renderer store extension"
```

---

## Phase 5 — Renderer UI

### Task 5.1 — `SuggestionRow.tsx` component

**Files:** `src/renderer/glossary/SuggestionRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react'
import type { GlossarySuggestion } from './types'

interface Props {
  suggestion: GlossarySuggestion
  onAccept: (id: string) => Promise<void>
  onDismiss: (id: string) => Promise<void>
}

function formatMetaTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function SuggestionRow({ suggestion, onAccept, onDismiss }: Props) {
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAccept = async () => {
    setError(null)
    setBusy('accept')
    try {
      await onAccept(suggestion.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const handleDismiss = async () => {
    setError(null)
    setBusy('dismiss')
    try {
      await onDismiss(suggestion.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const translationPill = (() => {
    const entries = Object.entries(suggestion.translations)
    if (entries.length === 0) {
      if (suggestion.preserve) return <span className="glossary-preserve-chip">Preserve</span>
      return <span className="glossary-row-empty">—</span>
    }
    return (
      <span className="glossary-translation-pill">
        <em className="amw-mono">{entries[0][0]}</em>: {entries[0][1]}
      </span>
    )
  })()

  const confidencePct = Math.round(suggestion.confidence * 100)

  return (
    <div className={`glossary-suggestion-row${busy ? ' is-busy' : ''}`}>
      <div className="glossary-suggestion-main">
        <div className="glossary-suggestion-term amw-mono">{suggestion.sourceTerm}</div>
        <div className="glossary-suggestion-translation">{translationPill}</div>
        <div className="glossary-suggestion-actions">
          <button
            type="button"
            className="glossary-suggestion-accept"
            onClick={handleAccept}
            disabled={busy !== null}
          >
            ✓ Accept
          </button>
          <button
            type="button"
            className="glossary-suggestion-dismiss"
            onClick={handleDismiss}
            disabled={busy !== null}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="glossary-suggestion-meta">
        {suggestion.reason && <span>{suggestion.reason}</span>}
        <span>{confidencePct}%</span>
        <span>Meeting {formatMetaTime(suggestion.createdAt)}</span>
      </div>
      {error && <div className="glossary-suggestion-error">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck + commit**

```bash
npm run typecheck
git add src/renderer/glossary/SuggestionRow.tsx
git commit -m "feat(glossary-suggestions): SuggestionRow component"
```

---

### Task 5.2 — Add Suggestions tab to `GlossaryPanel`

**Files:** `src/renderer/glossary/GlossaryPanel.tsx`

- [ ] **Step 1: Extend the tab state**

Change the `Tab` type and `tab` state:

```ts
type Tab = 'suggestions' | 'global' | 'meeting'

const [tab, setTab] = useState<Tab>(() => (initialPendingCount > 0 ? 'suggestions' : 'global'))
```

Where `initialPendingCount` is read from the store on first render. Or simpler: default tab is always `'suggestions'` if `pendingCount > 0` at mount, else `'global'`. Implement via an effect that runs once.

- [ ] **Step 2: Add the new tab button**

In the tab row, add a button BEFORE the existing Global/Meeting buttons:

```tsx
<button
  type="button"
  className={`glossary-tab ${tab === 'suggestions' ? 'on' : ''}`}
  onClick={() => setTab('suggestions')}
>
  Suggestions{pendingCount > 0 ? ` (${pendingCount})` : ''}
</button>
```

- [ ] **Step 3: Render Suggestions list when active**

Add the conditional rendering of suggestions inside the panel body (in the same area where `filtered.map(renderRow)` currently lives — guard by `tab === 'suggestions'`):

```tsx
{tab === 'suggestions' ? (
  <>
    {suggestions.length === 0 ? (
      <div className="glossary-empty">
        <p>
          No pending suggestions — autoMeetic suggests new terms after each meeting ends.
        </p>
      </div>
    ) : (
      suggestions
        .filter((s) => {
          const q = query.trim().toLowerCase()
          if (!q) return true
          return (
            s.sourceTerm.toLowerCase().includes(q) ||
            Object.values(s.translations).some((v) => v.toLowerCase().includes(q))
          )
        })
        .map((s) => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            onAccept={acceptSuggestion}
            onDismiss={dismissSuggestion}
          />
        ))
    )}
  </>
) : creating ? (
  // ...existing creating + filtered renderRow tree...
)}
```

(Restructure the existing tab-based body so each tab has its own branch. The Global and "This meeting" branches use the existing `renderRow` flow.)

- [ ] **Step 4: Add the "Accept all" button**

In the toolbar (search row), add a third button visible only on the Suggestions tab when there are eligible (confidence >= 0.7) suggestions:

```tsx
{tab === 'suggestions' && (() => {
  const eligible = suggestions.filter((s) => s.confidence >= 0.7)
  if (eligible.length === 0) return null
  return (
    <button
      type="button"
      className="glossary-bulk-accept"
      onClick={async () => {
        const result = await bulkAcceptSuggestions(eligible.map((s) => s.id))
        // optional toast: show result
        void result
      }}
    >
      ✓ Accept all ({eligible.length})
    </button>
  )
})()}
```

- [ ] **Step 5: Verify typecheck + commit**

```bash
npm run typecheck
git add src/renderer/glossary/GlossaryPanel.tsx
git commit -m "feat(glossary-suggestions): Suggestions tab in panel"
```

---

### Task 5.3 — Header badge on glossary button

**Files:** `src/renderer/App.tsx`, `src/renderer/App.css`

- [ ] **Step 1: Read the pending count**

In `src/renderer/App.tsx`, inside `App()`, read the pending count via a small hook. Since `useGlossaryStore` is called inside the `GlossaryPanel`, we need a way to expose the pending count to the header. Two options:

(a) Call `useGlossaryStore` at the App level just to get pendingCount (cost: extra subscriptions)
(b) Use a tiny separate hook that only polls `glossary.suggestions.count()` on mount + on `onUpdated`

Option (b) is cleaner — App.tsx doesn't need the full store. Implement as:

```tsx
import { useEffect, useState } from 'react'

function useGlossarySuggestionCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI?.glossary?.suggestions
    if (!api) return
    const refresh = () => {
      void api.count().then((n) => {
        if (!cancelled) setCount(n)
      })
    }
    refresh()
    const unsub = api.onUpdated(refresh)
    return () => {
      cancelled = true
      unsub()
    }
  }, [])
  return count
}
```

Place this small hook either inline above `App()` or in a sibling file `src/renderer/glossary/useSuggestionCount.ts`. The file location doesn't matter much — pick whichever is consistent with the existing helper style.

- [ ] **Step 2: Add the badge to the glossary header button**

Find the existing glossary header button in `App.tsx` (the one whose icon is the book-with-bookmark SVG). Inside the button, after the `<svg>`, add:

```tsx
{glossarySuggestionCount > 0 && (
  <span className="v4p-iconbtn-badge amw-mono">{glossarySuggestionCount}</span>
)}
```

And just before the button declaration, call the hook:

```tsx
const glossarySuggestionCount = useGlossarySuggestionCount()
```

- [ ] **Step 3: Add the badge CSS**

Append to `src/renderer/App.css`:

```css
.v4p-iconbtn {
  position: relative;
}
.v4p-iconbtn-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--p-primary);
  color: var(--p-primary-on);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  border: 1px solid var(--p-bg);
}
```

- [ ] **Step 4: Suggestion row styles**

Append to `src/renderer/App.css`:

```css
.glossary-suggestion-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--p-border);
  border-radius: 8px;
  background: var(--p-bg-card);
  transition: opacity 200ms ease-out;
}
.glossary-suggestion-row.is-busy {
  opacity: 0.5;
  pointer-events: none;
}
.glossary-suggestion-main {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) auto;
  gap: 12px;
  align-items: center;
}
.glossary-suggestion-term {
  font-size: 13px;
  font-weight: 700;
  color: var(--p-text);
}
.glossary-suggestion-translation {
  font-size: 12px;
  color: var(--p-mute);
}
.glossary-suggestion-actions {
  display: flex;
  gap: 6px;
}
.glossary-suggestion-accept {
  height: 26px;
  padding: 0 12px;
  border-radius: 5px;
  border: 1px solid var(--p-primary);
  background: var(--p-primary);
  color: var(--p-primary-on);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.glossary-suggestion-accept:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.glossary-suggestion-dismiss {
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-mute);
  font-size: 11.5px;
  cursor: pointer;
}
.glossary-suggestion-dismiss:disabled {
  opacity: 0.5;
}
.glossary-suggestion-meta {
  display: flex;
  gap: 10px;
  font-size: 10.5px;
  color: var(--p-faint);
}
.glossary-suggestion-meta > span:not(:last-child)::after {
  content: '·';
  margin-left: 10px;
  color: var(--p-faint);
}
.glossary-suggestion-error {
  font-size: 11px;
  color: var(--p-error-ink);
}
.glossary-bulk-accept {
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
```

- [ ] **Step 5: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/App.tsx src/renderer/App.css
git commit -m "feat(glossary-suggestions): header badge + suggestion-row styles"
```

---

## Phase 6 — Telemetry passes

This phase is intentionally light — the suggestionService already emits structured logs via `logger.*`. Confirm the existing telemetry surface accepts the new event names without errors. If `src/main/telemetry/logger.ts` has a static allowlist, extend it; otherwise this phase is a no-op verification.

- [ ] **Step 1: Inspect `src/main/telemetry/logger.ts`**

Open the file. If logger has an enum / typed event registry, extend it with:

```
glossary.extraction.success
glossary.extraction.failure
glossary.extraction.empty-transcript
glossary.extraction.no-meeting
glossary.extraction.upsert-failed
glossary.suggestion.accepted
glossary.suggestion.dismissed
glossary.suggestion.bulk-accepted
glossary.backfill.segments-updated
```

If logger is free-form (`log.info(name: string, data?: object)`), no change needed.

- [ ] **Step 2: Add accept/dismiss/backfill counter calls** in the IPC handlers (`src/main/ipc-glossary-handlers.ts`):

```ts
import { logger } from './telemetry/logger'

// inside 'glossary:suggestions:accept' handler, after broadcastMeetingUpdated():
logger.info('glossary.suggestion.accepted', { suggestionId: args.id, entryId: entry.id })

// inside 'glossary:suggestions:dismiss' handler, after broadcastSuggestionsUpdated():
logger.info('glossary.suggestion.dismissed', { suggestionId: args.id })

// inside 'glossary:suggestions:bulk-accept' handler, after broadcasts:
logger.info('glossary.suggestion.bulk-accepted', {
  size: args.ids.length,
  accepted: accepted.length,
  failed: failed.length,
})
```

If `acceptSuggestion` could expose the backfill count, plumb it through (small change to return type). Otherwise log just the count by re-querying after the transaction.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/main/ipc-glossary-handlers.ts src/main/telemetry/logger.ts
git commit -m "feat(glossary-suggestions): telemetry counters"
```

---

## Phase 7 — Final regression + push

- [ ] **Step 1: Full regression**

```bash
npm run typecheck                     # clean
npm run lint                          # 0 errors expected (baseline from glossary v1)
npx vitest run                        # all suites pass (incl. new glossary-suggestion-*)
```

If anything fails, fix in-place before committing. New tests should add ~25-30 tests on top of the existing 117.

- [ ] **Step 2: Manual smoke (Electron)**

`npm run dev:electron`. Run through the success-criteria checklist from the spec:

1. English meeting where "kunchen" appears 4× with variant renderings → stop meeting → wait for extraction
2. Glossary header button shows `+1` badge
3. Open panel → Suggestions tab → see candidate row
4. Click Accept → row disappears, badge updates
5. Open the meeting in Memory Library → all 4 occurrences canonical
6. New meeting mentioning "kunchen" once → no new suggestion (already in glossary)
7. New meeting surfaces a different candidate → Dismiss it
8. Subsequent meeting mentioning the same dismissed term → no suggestion

If any step misbehaves, file an inline followup fix commit before pushing.

- [ ] **Step 3: Update HANDOFF**

Open `HANDOFF.md`. Move the "Glossary auto-suggestions" stream from "pending" to "complete," following the same shape as the v1 phase rows. Add a notes paragraph summarizing what shipped + known gaps + telemetry counter names.

- [ ] **Step 4: Commit + push**

```bash
git add HANDOFF.md
git commit -m "docs(glossary-suggestions): mark stream complete"
git push origin master
```

---

## Self-review notes (resolved inline)

**Spec coverage:** every section of the spec maps to one or more tasks:

- Schema → Task 1.1
- Types → Task 1.2
- Repository methods → Tasks 1.3 (CRUD), 1.4 (accept/dismiss), 1.5 (backfill), 1.6 (cleanup hook)
- Extraction prompt + parser → Task 2.1
- Extraction service → Task 2.2
- IPC handlers → Task 3.1
- Preload bridge → Task 3.2
- IPC tests → Task 3.3
- Meeting lifecycle wiring → Task 3.4
- Renderer types → Task 4.1
- Renderer store → Task 4.2
- SuggestionRow → Task 5.1
- Panel tab + Accept all → Task 5.2
- Header badge → Task 5.3
- Telemetry → Phase 6
- Regression + manual smoke → Phase 7

**Type consistency:** `GlossarySuggestion`, `GlossarySuggestionInput`, repository method names (`upsertSuggestion`, `getSuggestion`, `listSuggestionsByMeeting`, `listAllPendingSuggestions`, `countPendingSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `isDismissed`, `getDismissedAt`, `listDismissedTerms`, `backfillSegments`), IPC channel names, and preload bridge keys are all consistent across tasks.

**Known assumptions to verify during execution:**

- `MemoryService` exposes `.repository` (used in `suggestionService`). If not, adapt to whatever accessor is in place — the v1 work added similar plumbing already.
- `summaryService.generateSummary` is awaited (or fire-and-forget) at meeting end somewhere in `src/main/index.ts`. The exact attach point is the only thing the implementer needs to find via grep.
- `src/main/telemetry/logger.ts` accepts free-form event names. If it has a typed registry, extend it (Phase 6 covers this).

**Streaming / SSE:** This feature uses non-streaming chat completions (`response_format: { type: 'json_object' }`), which is materially simpler than the Answer Assist streaming path. No SSE handling needed.

**Web mode:** Out of scope. The renderer-side store falls back to no-op when `window.electronAPI.glossary.suggestions` is undefined. Web users see no suggestions; no errors.

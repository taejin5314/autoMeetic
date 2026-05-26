# Glossary Variants & Inline Highlights — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (Windows better-sqlite3 ABI shim + `EBUSY` `npm test` quirk).

**Goal:** Make glossary value visible. Add `variants` as a first-class column on `glossary_entries`, surface STT-mishearing candidates at the registration moment ("aha" preview), and render glossary matches inline in the live transcript with a subtle dotted underline + tooltip.

**Architecture:** Pure-function variant finder in main (`normalize` + Levenshtein ≤ 2) scans recent segments via a new IPC. UI gains a "변형 찾기" button + candidate picker modal + post-save success card. Renderer adds a memoized glossary matcher + `<HighlightedText>` component wrapping transcript text in both live feed and Memory Library views. The existing `normalizePreserveTerms` and `formatGlossaryPromptSection` extend to handle variants alongside the canonical `sourceTerm`.

**Tech stack:** TypeScript strict (no `any` unless documented), better-sqlite3, React 19, vitest, existing `telemetry/logger.ts`.

**Spec:** `docs/superpowers/specs/2026-05-25-glossary-variants-and-highlights-design.md`

**Scope reminder (do NOT exceed):** No usage counters. No live "saved" toast. No LLM phonetic detection. No highlights in chat/whiteboard. No per-entry highlight toggle. No custom tooltip popover. STT bias unchanged (canonical only).

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | Add `variants` column to `glossary_entries` SCHEMA_SQL; bump `SCHEMA_VERSION` 4 → 5 |
| `src/main/memory/types.ts` | Modify | `variants: string[]` on `GlossaryEntry`; optional on `GlossaryEntryInput`; new `VariantCandidate` |
| `src/main/memory/repository.ts` | Modify | `migrateToV5IfNeeded()`; variant round-trip in upsert/list/active/acceptSuggestion; new `listRecentSegmentsForScan` |
| `src/main/glossary/variantFinder.ts` | Create | Pure functions: `normalize`, `levenshtein`, `isVariantMatch`, `findVariantCandidates` |
| `src/main/glossary/promptInjection.ts` | Modify | `formatGlossaryPromptSection` mentions variants; `normalizePreserveTerms` loops over `[sourceTerm, ...variants]` |
| `src/main/ipc-glossary-handlers.ts` | Modify | Register `glossary:find-variants` handler |
| `src/preload/index.ts` | Modify | Expose `glossary.findVariants` |
| `src/preload/types.ts` | Modify | Preload API type addition |
| `src/renderer/glossary/types.ts` | Modify | Re-export `VariantCandidate`; ensure `variants` on renderer types |
| `src/renderer/glossary/useGlossaryStore.ts` | Modify | `findVariants(canonical)` action; variants in upsert payload; expose `activeEntries` selector |
| `src/renderer/glossary/GlossaryRowEditor.tsx` | Modify | Variants chip input + manual add + "변형 찾기" button |
| `src/renderer/glossary/VariantCandidatePicker.tsx` | Create | Modal with checkbox list of candidates |
| `src/renderer/glossary/GlossarySaveSuccessCard.tsx` | Create | Transient post-save "aha" card |
| `src/renderer/glossary/GlossaryPanel.tsx` | Modify | Variant chips on each row; highlight toggle in header |
| `src/renderer/glossary/glossaryMatcher.ts` | Create | `buildMatcher`, `applyHighlights` |
| `src/renderer/glossary/HighlightedText.tsx` | Create | React text wrapper that injects marks |
| `src/renderer/glossary/GlossaryMark.tsx` | Create | Single mark span + tooltip |
| `src/renderer/glossary/useActiveGlossary.ts` | Create | Small renderer hook that subscribes to active glossary entries (with refresh on `glossary:entries-updated` event) |
| `src/renderer/shell/TranscriptColumns.tsx` | Modify | Wrap source + translated text in `<HighlightedText>` |
| `src/renderer/library/MeetingsTab.tsx` | Modify | Same for saved transcript |
| `src/renderer/App.css` | Modify | `.glossary-mark` styles + accent CSS vars (light/dark) |
| `src/main/ipc-glossary-handlers.ts` | Modify | After upsert/accept, broadcast `glossary:entries-updated` on all windows (mirror of existing `glossary:suggestions-updated` pattern) |
| `src/test/glossary-variant-finder.test.ts` | Create | ~8 unit tests |
| `src/test/glossary-repository-variants.test.ts` | Create | ~6 round-trip + migration tests |
| `src/test/glossary-prompt-injection.test.ts` | Modify | Add ~4 variant-aware tests |
| `src/test/glossary-ipc-handlers.test.ts` | Modify | Add ~2 `findVariants` IPC tests |
| `src/test/glossary-matcher.test.ts` | Create | ~6 renderer matcher tests |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — Schema + types + repository (TDD)

### Task 1.1 — Schema bump v4 → v5

**Files:** `src/main/memory/schema.ts`

- [ ] **Step 1: Edit `src/main/memory/schema.ts`**

Change `SCHEMA_VERSION` from `4` to `5`. In the `glossary_entries` CREATE TABLE, add the `variants` column after `note`:

```sql
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
```

This handles fresh installs. Existing DBs (created at v4) need an explicit ALTER — handled in Task 1.3.

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/schema.ts
git commit -m "feat(glossary): add variants column to glossary_entries (schema v5)"
```

---

### Task 1.2 — Add types

**Files:** `src/main/memory/types.ts`

- [ ] **Step 1: Modify `GlossaryEntry` + `GlossaryEntryInput`; add `VariantCandidate`**

Add `variants` to `GlossaryEntry`:

```ts
export interface GlossaryEntry {
  // ... existing fields ...
  variants: string[]
}
```

Add optional `variants` to `GlossaryEntryInput`:

```ts
export interface GlossaryEntryInput {
  // ... existing fields ...
  variants?: string[]
}
```

Append:

```ts
export interface VariantCandidate {
  candidate: string
  frequency: number
  exampleSegmentId: string
  exampleText: string
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
```

(Will fail in places that construct `GlossaryEntry` literals without `variants`. Those are addressed in Task 1.3 and Phase 2/3 tasks. For commit, the type change alone is fine — TS errors elsewhere will resolve as tasks proceed.)

If typecheck fails only with "missing property 'variants'" errors in tests/fixtures, that's expected and will be fixed in Task 1.3.

```bash
git add src/main/memory/types.ts
git commit -m "feat(glossary): add variants to GlossaryEntry + VariantCandidate type"
```

---

### Task 1.3 — Repository migration + variant round-trip (TDD)

**Files:** `src/main/memory/repository.ts`, `src/test/glossary-repository-variants.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/glossary-repository-variants.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-repository-variants.test.ts
```

Expect FAIL — `migrateToV5IfNeeded`, `listRecentSegmentsForScan`, and variant fields don't exist yet.

- [ ] **Step 3: Update `MemoryRepository`**

In `initialize()`, run the column-level migration BEFORE the version row update:

```ts
private initialize(): void {
  this.db.exec(SCHEMA_SQL)
  this.migrateToV5IfNeeded()
  const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined
  if (!row) {
    this.db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION)
  } else if (row.version < SCHEMA_VERSION) {
    this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION)
  }
}

private migrateToV5IfNeeded(): void {
  const cols = this.db.pragma('table_info(glossary_entries)') as Array<{ name: string }>
  if (cols.some((c) => c.name === 'variants')) return
  this.db.exec(`ALTER TABLE glossary_entries ADD COLUMN variants TEXT NOT NULL DEFAULT '[]'`)
}
```

Update `upsertGlossary` to round-trip `variants`:

```ts
upsertGlossary(input: GlossaryEntryInput): GlossaryEntry {
  // ... existing id resolution + timestamp logic ...
  const variantsJson = JSON.stringify(input.variants ?? [])
  // Add `variants` to the INSERT ... ON CONFLICT UPDATE column list and parameter set.
  // Update all SELECTs of glossary_entries to include `variants` column and JSON.parse it.
  // ...
}
```

Update `listGlossary`, `getGlossaryEntry`, `activeGlossary`: SELECT now includes `variants AS variantsJson`; map to `variants: JSON.parse(row.variantsJson) as string[]` (with try/catch fallback to `[]`).

Update `acceptSuggestion`: when constructing the new entry, pass `variants: sugg.variants` to the `upsertGlossary` call.

Add `listRecentSegmentsForScan`:

```ts
listRecentSegmentsForScan(limit: number): { id: string; sourceText: string }[] {
  return this.db
    .prepare(
      `SELECT id, source_text AS sourceText
       FROM segments
       ORDER BY created_at DESC, seq DESC
       LIMIT ?`
    )
    .all(limit) as { id: string; sourceText: string }[]
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/glossary-repository-variants.test.ts
npm run typecheck
npm run lint
```

If any existing test breaks due to `GlossaryEntry` shape change (missing `variants` in test fixtures), patch the fixture (`variants: []`).

```bash
git add src/main/memory/repository.ts src/test/glossary-repository-variants.test.ts
git commit -m "feat(glossary): persist variants + v5 migration + recent-segment scan"
```

---

### Task 1.4 — Verify Phase 1

- [ ] **Run phase verification**

```bash
npm run verify:phase 1
```

Expected: `VERDICT: ✅ Phase 1 verified`.

- [ ] **Update `HANDOFF.md` Phase 1 row** with commit hash + verbatim verify output.

---

## Phase 2 — Variant finder + IPC + preload (TDD)

### Task 2.1 — Pure variant finder (TDD)

**Files:** `src/main/glossary/variantFinder.ts`, `src/test/glossary-variant-finder.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/glossary-variant-finder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  findVariantCandidates,
  isVariantMatch,
  levenshtein,
  normalize,
} from '../main/glossary/variantFinder'

describe('normalize', () => {
  it('lowercases and strips whitespace + hyphens + underscores + dots + slashes', () => {
    expect(normalize('Real-Time Orchestrator')).toBe('realtimeorchestrator')
    expect(normalize('  REALTIME_ORCHESTRATOR  ')).toBe('realtimeorchestrator')
    expect(normalize('A.B/C')).toBe('abc')
  })
})

describe('levenshtein', () => {
  it('returns edit distance', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('abc', 'abcd')).toBe(1)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('isVariantMatch', () => {
  it('returns true for normalized exact match', () => {
    expect(isVariantMatch('Real Time Orchestrator', 'RealtimeOrchestrator')).toBe(true)
  })
  it('returns true within edit distance 2', () => {
    expect(isVariantMatch('Realtim Orchestratr', 'RealtimeOrchestrator')).toBe(true)
  })
  it('returns false beyond edit distance 2', () => {
    expect(isVariantMatch('Real Time Architect', 'RealtimeOrchestrator')).toBe(false)
  })
  it('returns false when first character differs', () => {
    expect(isVariantMatch('XealtimeOrchestrator', 'RealtimeOrchestrator')).toBe(false)
  })
  it('returns false when length difference exceeds 2', () => {
    expect(isVariantMatch('Realtime', 'RealtimeOrchestrator')).toBe(false)
  })
  it('returns false for terms shorter than 3 normalized chars', () => {
    expect(isVariantMatch('AI', 'AI')).toBe(false)
    expect(isVariantMatch('ab', 'ac')).toBe(false)
  })
})

describe('findVariantCandidates', () => {
  it('finds and counts variants in segments, excluding exact canonical matches', () => {
    const segments = [
      { id: 's1', sourceText: 'the realtime orchestrator handles things' },
      { id: 's2', sourceText: 'and the real time orchestrator pivots' },
      { id: 's3', sourceText: 'RealtimeOrchestrator throws when overloaded' },
      { id: 's4', sourceText: 'totally unrelated content here' },
    ]
    const results = findVariantCandidates('RealtimeOrchestrator', segments)
    const candidates = results.map((r) => r.candidate.toLowerCase())
    expect(candidates).toContain('realtime orchestrator')
    expect(candidates).toContain('real time orchestrator')
    // Exact canonical match (s3) should NOT appear as a variant
    expect(candidates).not.toContain('realtimeorchestrator')
  })

  it('returns candidates sorted by frequency desc', () => {
    const segments = [
      { id: 's1', sourceText: 'real time orchestrator one' },
      { id: 's2', sourceText: 'real time orchestrator two' },
      { id: 's3', sourceText: 'realtime orchestrator three' },
    ]
    const results = findVariantCandidates('RealtimeOrchestrator', segments)
    expect(results[0].candidate.toLowerCase()).toBe('real time orchestrator')
    expect(results[0].frequency).toBe(2)
  })

  it('caps results at topN (default 10)', () => {
    const segments = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      sourceText: `unique${i.toString().padStart(2, '0')} variation`,
    }))
    const results = findVariantCandidates('unique00', segments, { topN: 5 })
    expect(results.length).toBeLessThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-variant-finder.test.ts
```

Expect FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/main/glossary/variantFinder.ts`**

```ts
import type { VariantCandidate } from '../memory/types'

const STRIP_RE = /[\s\-_/.]/g

export function normalize(text: string): string {
  return text.toLowerCase().replace(STRIP_RE, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

export function isVariantMatch(candidate: string, canonical: string, maxDistance = 2): boolean {
  const nc = normalize(candidate)
  const nn = normalize(canonical)
  if (nc.length < 3 || nn.length < 3) return false
  if (Math.abs(nc.length - nn.length) > maxDistance) return false
  if (nc[0] !== nn[0]) return false
  return levenshtein(nc, nn) <= maxDistance
}

interface FindOptions {
  topN?: number
  ngramMax?: number
}

export function findVariantCandidates(
  canonical: string,
  segments: { id: string; sourceText: string }[],
  options: FindOptions = {}
): VariantCandidate[] {
  const topN = options.topN ?? 10
  const ngramMax = options.ngramMax ?? 4
  const canonicalNorm = normalize(canonical)
  const counts = new Map<
    string,
    { frequency: number; exampleSegmentId: string; exampleText: string }
  >()

  for (const seg of segments) {
    const tokens = seg.sourceText.split(/\s+/).filter((t) => t.length > 0)
    for (let n = 1; n <= ngramMax; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const ngram = tokens.slice(i, i + n).join(' ')
        const norm = normalize(ngram)
        if (norm === canonicalNorm) continue
        if (!isVariantMatch(ngram, canonical)) continue
        const key = ngram.toLowerCase()
        const existing = counts.get(key)
        if (existing) {
          existing.frequency++
        } else {
          counts.set(key, {
            frequency: 1,
            exampleSegmentId: seg.id,
            exampleText: seg.sourceText,
          })
        }
      }
    }
  }

  return Array.from(counts.entries())
    .map(([candidate, data]) => ({ candidate, ...data }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, topN)
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/glossary-variant-finder.test.ts
npm run typecheck
npm run lint
git add src/main/glossary/variantFinder.ts src/test/glossary-variant-finder.test.ts
git commit -m "feat(glossary): variant finder (normalize + Levenshtein + n-gram scan)"
```

---

### Task 2.2 — IPC handler + preload + tests

**Files:** `src/main/ipc-glossary-handlers.ts`, `src/preload/index.ts`, `src/preload/types.ts`, `src/test/glossary-ipc-handlers.test.ts`

- [ ] **Step 1: Extend existing IPC test file**

Open `src/test/glossary-ipc-handlers.test.ts`. Add two tests:

```ts
describe('glossary:find-variants', () => {
  it('returns variant candidates from recent segments', async () => {
    const repo = makeFakeRepo() // existing helper in this test file; ensure it provides listRecentSegmentsForScan
    repo.listRecentSegmentsForScan = (limit: number) => [
      { id: 's1', sourceText: 'the realtime orchestrator handles agents' },
      { id: 's2', sourceText: 'real time orchestrator again' },
    ]
    const handlers = createGlossaryHandlers(repo as never)
    const out = await handlers['glossary:find-variants']({} as never, { canonical: 'RealtimeOrchestrator' })
    const names = out.map((c) => c.candidate.toLowerCase())
    expect(names).toContain('realtime orchestrator')
    expect(names).toContain('real time orchestrator')
  })

  it('returns empty array when no segments match', async () => {
    const repo = makeFakeRepo()
    repo.listRecentSegmentsForScan = () => [
      { id: 's1', sourceText: 'completely unrelated content' },
    ]
    const handlers = createGlossaryHandlers(repo as never)
    const out = await handlers['glossary:find-variants']({} as never, { canonical: 'RealtimeOrchestrator' })
    expect(out).toEqual([])
  })
})
```

(Adapt `makeFakeRepo`, the existing handler factory name, and the assertion shape to match the actual test-file conventions. If the existing tests stub the repo via `Pick<MemoryRepository, ...>`, expand the Pick type to include `listRecentSegmentsForScan`.)

- [ ] **Step 2: Implement the handler**

In `src/main/ipc-glossary-handlers.ts`, register:

```ts
ipcMain.handle('glossary:find-variants', async (_evt, args: { canonical: string }) => {
  const segments = repo.listRecentSegmentsForScan(5000)
  return findVariantCandidates(args.canonical, segments)
})
```

Import `findVariantCandidates` from `../glossary/variantFinder` at the top.

- [ ] **Step 3: Preload bridge**

In `src/preload/index.ts`, add to the `glossary` namespace:

```ts
findVariants: (canonical: string): Promise<VariantCandidate[]> =>
  ipcRenderer.invoke('glossary:find-variants', { canonical }),
```

In `src/preload/types.ts`, add to the glossary API type:

```ts
findVariants(canonical: string): Promise<VariantCandidate[]>
```

Import `VariantCandidate` from `'../main/memory/types'`.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/glossary-ipc-handlers.test.ts
npm run typecheck
npm run lint
git add src/main/ipc-glossary-handlers.ts src/preload/index.ts src/preload/types.ts src/test/glossary-ipc-handlers.test.ts
git commit -m "feat(glossary): glossary:find-variants IPC + preload bridge"
```

---

### Task 2.3 — Broadcast `glossary:entries-updated` on upsert/delete/accept

**Files:** `src/main/ipc-glossary-handlers.ts`

- [ ] **Step 1: Mirror the existing `glossary:suggestions-updated` pattern for entries**

After successful `upsert`, `delete`, and `acceptSuggestion` IPC handlers, broadcast:

```ts
for (const win of BrowserWindow.getAllWindows()) {
  win.webContents.send('glossary:entries-updated')
}
```

(Adapt to wherever the existing IPC layer broadcasts. Check `src/main/index.ts` for the existing `glossary:suggestions-updated` pattern — same mechanism.)

- [ ] **Step 2: Add the listener side in preload**

In `src/preload/index.ts` glossary namespace:

```ts
onEntriesUpdated: (cb: () => void): (() => void) => {
  const handler = () => cb()
  ipcRenderer.on('glossary:entries-updated', handler)
  return () => ipcRenderer.removeListener('glossary:entries-updated', handler)
},
```

Add corresponding type to `src/preload/types.ts`.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add src/main/ipc-glossary-handlers.ts src/preload/index.ts src/preload/types.ts
git commit -m "feat(glossary): broadcast entries-updated event for renderer subscribers"
```

---

### Task 2.4 — Verify Phase 2

- [ ] **Run phase verification**

```bash
npm run verify:phase 2
```

Expected: `VERDICT: ✅ Phase 2 verified`.

- [ ] **Update `HANDOFF.md` Phase 2 row.**

---

## Phase 3 — Prompt + normalize update (TDD)

### Task 3.1 — Update prompt + normalize to handle variants

**Files:** `src/main/glossary/promptInjection.ts`, `src/test/glossary-prompt-injection.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/test/glossary-prompt-injection.test.ts`:

```ts
describe('formatGlossaryPromptSection — variants', () => {
  it('mentions variants alongside the canonical for verbatim terms', () => {
    const section = formatGlossaryPromptSection(
      [
        {
          id: 'e1', scope: 'global', meetingId: null,
          sourceTerm: 'RealtimeOrchestrator',
          translations: {}, preserve: true, note: null,
          variants: ['real time orchestrator', 'realtime orchestrator'],
          createdAt: 0, updatedAt: 0,
        },
      ],
      null
    )
    expect(section).toContain('RealtimeOrchestrator')
    expect(section).toContain('real time orchestrator')
    expect(section).toContain('realtime orchestrator')
  })

  it('caps variants per entry in the prompt at 10 with an etc note', () => {
    const variants = Array.from({ length: 15 }, (_, i) => `variant${i}`)
    const section = formatGlossaryPromptSection(
      [
        {
          id: 'e1', scope: 'global', meetingId: null,
          sourceTerm: 'Foo', translations: {},
          preserve: true, note: null, variants,
          createdAt: 0, updatedAt: 0,
        },
      ],
      null
    )
    expect(section).toContain('variant0')
    expect(section).toContain('variant9')
    expect(section).not.toContain('variant10')
    expect(section.toLowerCase()).toMatch(/etc|more/)
  })
})

describe('normalizePreserveTerms — variants', () => {
  const entry = {
    id: 'e1', scope: 'global' as const, meetingId: null,
    sourceTerm: 'RealtimeOrchestrator',
    translations: {}, preserve: true, note: null,
    variants: ['real time orchestrator', 'realtime orchestrator'],
    createdAt: 0, updatedAt: 0,
  }

  it('rewrites variants to the canonical form', () => {
    expect(
      normalizePreserveTerms('the real time orchestrator runs', [entry])
    ).toBe('the RealtimeOrchestrator runs')
  })

  it('is case-insensitive across variants', () => {
    expect(
      normalizePreserveTerms('REAL TIME ORCHESTRATOR', [entry])
    ).toBe('RealtimeOrchestrator')
  })

  it('leaves unrelated text alone', () => {
    expect(
      normalizePreserveTerms('the architect went home', [entry])
    ).toBe('the architect went home')
  })

  it('dedupes variants identical to the canonical (no-op)', () => {
    const dup = { ...entry, variants: ['RealtimeOrchestrator'] }
    expect(
      normalizePreserveTerms('the RealtimeOrchestrator runs', [dup])
    ).toBe('the RealtimeOrchestrator runs')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-prompt-injection.test.ts
```

Expect FAIL on the new variant-aware assertions.

- [ ] **Step 3: Update `formatGlossaryPromptSection`**

When emitting a verbatim line, append variants:

```ts
function formatVerbatim(entry: GlossaryEntry): string {
  const variants = entry.variants
    .filter((v) => normalize(v) !== normalize(entry.sourceTerm))
    .slice(0, 10)
  const base = quote(entry.sourceTerm)
  if (variants.length === 0) return base
  const more = entry.variants.length > 10 ? ' (etc)' : ''
  return `${base} (also accept: ${variants.map(quote).join(', ')}${more})`
}
```

Use this helper in the `verbatim.map(quote).join(', ')` line. Same treatment for the mapped translation block (when `preserve` is also true, the variants apply; document accordingly).

Import `normalize` from `./variantFinder` (or duplicate the small function locally to avoid a cross-module dep — prefer the import).

- [ ] **Step 4: Update `normalizePreserveTerms`**

```ts
export function normalizePreserveTerms(output: string, entries: GlossaryEntry[]): string {
  if (entries.length === 0) return output
  let result = output
  for (const e of entries) {
    if (!e.preserve) continue
    const canonicalNorm = normalize(e.sourceTerm)
    const allForms = [e.sourceTerm, ...e.variants.filter((v) => normalize(v) !== canonicalNorm)]
    for (const form of allForms) {
      const re = new RegExp(`\\b${escapeRegex(form)}\\b`, 'gi')
      result = result.replace(re, e.sourceTerm)
    }
  }
  return result
}
```

- [ ] **Step 5: Fix any existing test fixtures that now lack `variants`**

```bash
npx vitest run
```

If failures point to test fixtures with `GlossaryEntry` literals missing `variants`, add `variants: []` to each fixture.

- [ ] **Step 6: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/main/glossary/promptInjection.ts src/test/glossary-prompt-injection.test.ts
git commit -m "feat(glossary): prompt + normalize handle variants alongside canonical"
```

---

### Task 3.2 — Verify Phase 3

- [ ] **Run phase verification**

```bash
npm run verify:phase 3
```

Expected: `VERDICT: ✅ Phase 3 verified`.

- [ ] **Update `HANDOFF.md` Phase 3 row.**

---

## Phase 4 — Registration UI (variant finder + success card)

### Task 4.1 — Extend `useGlossaryStore` with `findVariants`

**Files:** `src/renderer/glossary/useGlossaryStore.ts`, `src/renderer/glossary/types.ts`

- [ ] **Step 1: Re-export `VariantCandidate`** from `src/renderer/glossary/types.ts`:

```ts
export type { VariantCandidate } from '../../main/memory/types'
```

Also ensure `GlossaryEntry` re-export includes the `variants` field (it should automatically, since it re-exports the main type).

- [ ] **Step 2: Add `findVariants` to the store**

In `useGlossaryStore.ts`, add a method:

```ts
findVariants: async (canonical: string): Promise<VariantCandidate[]> => {
  return window.electronAPI.glossary.findVariants(canonical)
},
```

Ensure `upsert` passes `variants` through:

```ts
upsert: async (input: GlossaryEntryInput) => {
  const entry = await window.electronAPI.glossary.upsert(input)
  // input.variants is already in the payload
  await refresh()
  return entry
},
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/useGlossaryStore.ts src/renderer/glossary/types.ts
git commit -m "feat(glossary): store action findVariants + variants in upsert payload"
```

---

### Task 4.2 — `VariantCandidatePicker` modal

**Files:** `src/renderer/glossary/VariantCandidatePicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useMemo, useState } from 'react'
import type { VariantCandidate } from './types'

interface Props {
  candidates: VariantCandidate[]
  onConfirm: (selected: string[]) => void
  onCancel: () => void
}

export function VariantCandidatePicker({ candidates, onConfirm, onCancel }: Props) {
  const initial = useMemo(
    () => new Set(candidates.filter((c) => c.frequency >= 3).map((c) => c.candidate)),
    [candidates]
  )
  const [selected, setSelected] = useState<Set<string>>(initial)

  const toggle = (candidate: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(candidate)) next.delete(candidate)
      else next.add(candidate)
      return next
    })
  }

  if (candidates.length === 0) {
    return (
      <div className="variant-picker variant-picker-empty">
        <p>비슷한 표현을 찾지 못했어요.</p>
        <button onClick={onCancel}>닫기</button>
      </div>
    )
  }

  return (
    <div className="variant-picker">
      <h3>비슷한 표현 발견 (STT 오인일 수 있음)</h3>
      <ul className="variant-picker-list">
        {candidates.map((c) => (
          <li key={c.candidate}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(c.candidate)}
                onChange={() => toggle(c.candidate)}
              />
              <span className="variant-picker-candidate">{c.candidate}</span>
              <span className="variant-picker-frequency">({c.frequency}번)</span>
            </label>
            <p className="variant-picker-example" title={c.exampleText}>
              {c.exampleText.length > 90 ? c.exampleText.slice(0, 90) + '…' : c.exampleText}
            </p>
          </li>
        ))}
      </ul>
      <div className="variant-picker-actions">
        <button onClick={onCancel}>취소</button>
        <button onClick={() => onConfirm(Array.from(selected))} disabled={selected.size === 0}>
          선택한 {selected.size}개 추가
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/VariantCandidatePicker.tsx
git commit -m "feat(glossary): VariantCandidatePicker modal component"
```

---

### Task 4.3 — Update `GlossaryRowEditor` with variants UI

**Files:** `src/renderer/glossary/GlossaryRowEditor.tsx`

- [ ] **Step 1: Add variants state + UI**

Inside the editor component, alongside existing state (sourceTerm, translations, preserve, note):

```tsx
const [variants, setVariants] = useState<string[]>(initial?.variants ?? [])
const [newVariant, setNewVariant] = useState('')
const [candidates, setCandidates] = useState<VariantCandidate[] | null>(null)
const [scanning, setScanning] = useState(false)

const handleFind = async () => {
  if (!sourceTerm.trim()) return
  setScanning(true)
  try {
    const found = await store.findVariants(sourceTerm.trim())
    setCandidates(found)
  } finally {
    setScanning(false)
  }
}

const handlePickerConfirm = (picked: string[]) => {
  setVariants((prev) => Array.from(new Set([...prev, ...picked])))
  setCandidates(null)
}

const handleAddManual = () => {
  const v = newVariant.trim()
  if (!v) return
  setVariants((prev) => (prev.includes(v) ? prev : [...prev, v]))
  setNewVariant('')
}

const handleRemoveVariant = (v: string) => {
  setVariants((prev) => prev.filter((x) => x !== v))
}
```

In the rendered JSX, add a "Variants" section after the existing fields and before the save button:

```tsx
<div className="glossary-editor-variants">
  <label>변형 (STT 오인 / 띄어쓰기 차이)</label>
  <div className="glossary-editor-variants-chips">
    {variants.map((v) => (
      <span key={v} className="glossary-editor-chip">
        {v}
        <button type="button" onClick={() => handleRemoveVariant(v)} aria-label="제거">
          ×
        </button>
      </span>
    ))}
  </div>
  <div className="glossary-editor-variants-add">
    <input
      type="text"
      value={newVariant}
      onChange={(e) => setNewVariant(e.target.value)}
      placeholder="변형 직접 입력"
    />
    <button type="button" onClick={handleAddManual}>+ 추가</button>
    <button type="button" onClick={handleFind} disabled={scanning || !sourceTerm.trim()}>
      {scanning ? '검색 중…' : '변형 찾기'}
    </button>
  </div>
</div>
```

Pass `variants` in the save payload:

```tsx
await onSave({
  // ... existing fields ...
  variants,
})
```

If `candidates !== null`, render `<VariantCandidatePicker candidates={candidates} onConfirm={handlePickerConfirm} onCancel={() => setCandidates(null)} />` (as overlay/inline panel — match existing modal patterns in the codebase).

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/GlossaryRowEditor.tsx
git commit -m "feat(glossary): row editor variants UI + scan button"
```

---

### Task 4.4 — `GlossarySaveSuccessCard`

**Files:** `src/renderer/glossary/GlossarySaveSuccessCard.tsx`, `src/renderer/glossary/GlossaryPanel.tsx`

- [ ] **Step 1: Create the success card component**

```tsx
import { useEffect } from 'react'
import { normalize } from '../../main/glossary/variantFinder' // OR duplicate this small helper renderer-side if cross-side import isn't allowed in this codebase
import type { GlossaryEntry, VariantCandidate } from './types'

interface Props {
  entry: GlossaryEntry
  candidates: VariantCandidate[] // result of the scan that fed into save (may be empty)
  onDismiss: () => void
}

export function GlossarySaveSuccessCard({ entry, candidates, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000)
    return () => clearTimeout(t)
  }, [onDismiss])

  const normalizedLen = normalize(entry.sourceTerm).length
  const isShort = normalizedLen <= 2
  const totalPastMatches =
    candidates.reduce((sum, c) => sum + c.frequency, 0) +
    candidates.filter((c) => c.candidate.toLowerCase() === entry.sourceTerm.toLowerCase()).length
  const variantList = entry.variants.length > 0 ? entry.variants.join(', ') : null

  return (
    <div className="glossary-save-card" role="status" onClick={onDismiss}>
      <div className="glossary-save-card-header">✓ {entry.sourceTerm} 저장됨</div>
      {variantList && (
        <div className="glossary-save-card-variants">
          등록된 변형: {variantList}
        </div>
      )}
      {isShort ? (
        <div className="glossary-save-card-warning">
          짧은 단어라 라이브 하이라이트는 적용되지 않습니다 (보존 규칙은 작동).
        </div>
      ) : totalPastMatches > 0 ? (
        <>
          <div className="glossary-save-card-body">
            과거 미팅에서 총 {totalPastMatches}번 등장했습니다.
          </div>
          {candidates[0] && (
            <div className="glossary-save-card-example">
              예시: “{candidates[0].exampleText.slice(0, 120)}{candidates[0].exampleText.length > 120 ? '…' : ''}”
              <br />
              → 앞으로 ✨ <strong>{entry.sourceTerm}</strong>로 보존됩니다.
            </div>
          )}
        </>
      ) : (
        <div className="glossary-save-card-body">
          과거 미팅에서 등장하지 않은 새 단어예요. 다음 미팅부터 자동으로 보존됩니다.
        </div>
      )}
    </div>
  )
}
```

(If cross-side import is forbidden, duplicate the tiny `normalize` helper inline.)

- [ ] **Step 2: Wire into `GlossaryPanel`**

After successful save in `GlossaryPanel`, store the just-saved entry + the candidates fetched during the editor session into local state, render `<GlossarySaveSuccessCard>` until dismissed.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/GlossarySaveSuccessCard.tsx src/renderer/glossary/GlossaryPanel.tsx
git commit -m "feat(glossary): post-save success card with past-match preview"
```

---

### Task 4.5 — Display variant chips on each panel row

**Files:** `src/renderer/glossary/GlossaryPanel.tsx`

- [ ] **Step 1: Augment row rendering**

In `renderRow(entry)`, after the translations block, add (if `entry.variants.length > 0`):

```tsx
<div className="glossary-row-variants">
  {entry.variants.map((v) => (
    <span key={v} className="glossary-row-variant-chip">{v}</span>
  ))}
</div>
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/GlossaryPanel.tsx
git commit -m "feat(glossary): show variant chips on panel rows"
```

---

### Task 4.6 — Verify Phase 4

- [ ] **Run phase verification**

```bash
npm run verify:phase 4
```

Expected: `VERDICT: ✅ Phase 4 verified`.

- [ ] **Update `HANDOFF.md` Phase 4 row.**

---

## Phase 5 — Live highlight (matcher + HighlightedText + integrations)

### Task 5.1 — `useActiveGlossary` hook

**Files:** `src/renderer/glossary/useActiveGlossary.ts`

- [ ] **Step 1: Create**

```ts
import { useEffect, useState } from 'react'
import type { GlossaryEntry } from './types'

export function useActiveGlossary(meetingId: string | null): GlossaryEntry[] {
  const [entries, setEntries] = useState<GlossaryEntry[]>([])

  useEffect(() => {
    let active = true
    const load = async () => {
      const list = await window.electronAPI.glossary.active(meetingId)
      if (active) setEntries(list)
    }
    void load()
    const off = window.electronAPI.glossary.onEntriesUpdated(() => {
      void load()
    })
    return () => {
      active = false
      off()
    }
  }, [meetingId])

  return entries
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/useActiveGlossary.ts
git commit -m "feat(glossary): useActiveGlossary hook with entries-updated subscription"
```

---

### Task 5.2 — Matcher (TDD)

**Files:** `src/renderer/glossary/glossaryMatcher.ts`, `src/test/glossary-matcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/glossary-matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyHighlights, buildMatcher } from '../renderer/glossary/glossaryMatcher'
import type { GlossaryEntry } from '../main/memory/types'

const entry = (over: Partial<GlossaryEntry>): GlossaryEntry => ({
  id: 'e1', scope: 'global', meetingId: null,
  sourceTerm: 'RealtimeOrchestrator',
  translations: {}, preserve: true, note: null, variants: [],
  createdAt: 0, updatedAt: 0,
  ...over,
})

describe('glossaryMatcher', () => {
  it('matches the canonical sourceTerm with word boundaries', () => {
    const m = buildMatcher([entry({})])
    const parts = applyHighlights('the RealtimeOrchestrator runs', m)
    expect(parts.map((p) => p.kind)).toEqual(['text', 'match', 'text'])
    expect(parts[1].value).toBe('RealtimeOrchestrator')
  })

  it('matches variants alongside canonical', () => {
    const m = buildMatcher([entry({ variants: ['real time orchestrator'] })])
    const parts = applyHighlights('the real time orchestrator runs', m)
    const matches = parts.filter((p) => p.kind === 'match').map((p) => p.value)
    expect(matches).toEqual(['real time orchestrator'])
  })

  it('does not match substrings inside larger words', () => {
    const m = buildMatcher([entry({ sourceTerm: 'AI' })])
    // Should be excluded by short-word guard, but even without that, "again" must not match
    const parts = applyHighlights('he said again', m)
    expect(parts.filter((p) => p.kind === 'match')).toHaveLength(0)
  })

  it('excludes entries whose normalized canonical is ≤ 2 chars', () => {
    const m = buildMatcher([entry({ sourceTerm: 'AI' })])
    const parts = applyHighlights('AI is here', m)
    expect(parts.filter((p) => p.kind === 'match')).toHaveLength(0)
  })

  it('handles Hangul matches using lookarounds', () => {
    const m = buildMatcher([entry({ sourceTerm: '에이전트', variants: [] })])
    const parts = applyHighlights('이 에이전트는 빠르다', m)
    const matches = parts.filter((p) => p.kind === 'match').map((p) => p.value)
    expect(matches).toEqual(['에이전트'])
  })

  it('returns plain text when entries list is empty', () => {
    const m = buildMatcher([])
    const parts = applyHighlights('anything', m)
    expect(parts).toEqual([{ kind: 'text', value: 'anything' }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/glossary-matcher.test.ts
```

Expect FAIL.

- [ ] **Step 3: Implement `glossaryMatcher.ts`**

```ts
import type { GlossaryEntry } from './types'

export interface MatchSegment {
  kind: 'text' | 'match'
  value: string
  entryId?: string
}

export interface GlossaryMatcher {
  patterns: { regex: RegExp; entryId: string; canonical: string }[]
}

const HANGUL_RE = /[가-힯]/

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizedLen(s: string): number {
  return s.toLowerCase().replace(/[\s\-_/.]/g, '').length
}

export function buildMatcher(entries: GlossaryEntry[]): GlossaryMatcher {
  const patterns: GlossaryMatcher['patterns'] = []
  for (const entry of entries) {
    if (normalizedLen(entry.sourceTerm) <= 2) continue
    const forms = [entry.sourceTerm, ...entry.variants].filter((f) => f.length > 0)
    if (forms.length === 0) continue
    const alternation = forms.map(escapeRegex).join('|')
    // If any form contains Hangul, use lookarounds; otherwise use \b
    const usesHangul = forms.some((f) => HANGUL_RE.test(f))
    const regex = usesHangul
      ? new RegExp(`(?<![\\uAC00-\\uD7AF\\w])(${alternation})(?![\\uAC00-\\uD7AF\\w])`, 'g')
      : new RegExp(`\\b(${alternation})\\b`, 'gi')
    patterns.push({ regex, entryId: entry.id, canonical: entry.sourceTerm })
  }
  return { patterns }
}

export function applyHighlights(text: string, matcher: GlossaryMatcher): MatchSegment[] {
  if (matcher.patterns.length === 0 || text.length === 0) {
    return [{ kind: 'text', value: text }]
  }
  // Collect all match intervals
  type Interval = { start: number; end: number; entryId: string; value: string }
  const intervals: Interval[] = []
  for (const p of matcher.patterns) {
    p.regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.regex.exec(text)) !== null) {
      intervals.push({
        start: m.index,
        end: m.index + m[0].length,
        entryId: p.entryId,
        value: m[0],
      })
      if (m[0].length === 0) p.regex.lastIndex++
    }
  }
  intervals.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  // Drop overlaps (keep first/longest)
  const accepted: Interval[] = []
  for (const iv of intervals) {
    const last = accepted[accepted.length - 1]
    if (!last || iv.start >= last.end) accepted.push(iv)
  }
  // Slice text into segments
  const out: MatchSegment[] = []
  let cursor = 0
  for (const iv of accepted) {
    if (iv.start > cursor) out.push({ kind: 'text', value: text.slice(cursor, iv.start) })
    out.push({ kind: 'match', value: iv.value, entryId: iv.entryId })
    cursor = iv.end
  }
  if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) })
  return out
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/glossary-matcher.test.ts
npm run typecheck
npm run lint
git add src/renderer/glossary/glossaryMatcher.ts src/test/glossary-matcher.test.ts
git commit -m "feat(glossary): renderer matcher (regex builder + interval merging)"
```

---

### Task 5.3 — `GlossaryMark` + `HighlightedText`

**Files:** `src/renderer/glossary/GlossaryMark.tsx`, `src/renderer/glossary/HighlightedText.tsx`

- [ ] **Step 1: Create `GlossaryMark.tsx`**

```tsx
import type { GlossaryEntry } from './types'

interface Props {
  entry: GlossaryEntry
  children: string
}

export function GlossaryMark({ entry, children }: Props) {
  const translationLine = Object.entries(entry.translations)
    .map(([lang, value]) => `${lang}: ${value}`)
    .join(' · ')
  const tooltip = [
    `📖 내 glossary`,
    entry.sourceTerm,
    translationLine || null,
    entry.preserve ? '✨ 보존 (preserve)' : null,
  ]
    .filter((line) => line)
    .join('\n')
  return (
    <span className="glossary-mark" title={tooltip}>
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Create `HighlightedText.tsx`**

```tsx
import { useMemo, Fragment } from 'react'
import { GlossaryMark } from './GlossaryMark'
import { applyHighlights, buildMatcher } from './glossaryMatcher'
import type { GlossaryEntry } from './types'

interface Props {
  text: string
  entries: GlossaryEntry[]
  enabled: boolean
}

export function HighlightedText({ text, entries, enabled }: Props) {
  const matcher = useMemo(() => (enabled ? buildMatcher(entries) : null), [entries, enabled])
  if (!matcher) return <>{text}</>
  const parts = useMemo(() => applyHighlights(text, matcher), [text, matcher])
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') return <Fragment key={i}>{part.value}</Fragment>
        const entry = entryById.get(part.entryId!)
        if (!entry) return <Fragment key={i}>{part.value}</Fragment>
        return (
          <GlossaryMark key={i} entry={entry}>
            {part.value}
          </GlossaryMark>
        )
      })}
    </>
  )
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/glossary/GlossaryMark.tsx src/renderer/glossary/HighlightedText.tsx
git commit -m "feat(glossary): HighlightedText + GlossaryMark renderer components"
```

---

### Task 5.4 — Wire into `TranscriptColumns` + `MeetingsTab`

**Files:** `src/renderer/shell/TranscriptColumns.tsx`, `src/renderer/library/MeetingsTab.tsx`

- [ ] **Step 1: Add a global toggle (localStorage-backed)**

Wherever the highlight enable flag lives (suggest adding a small hook `useHighlightToggle()` in `src/renderer/glossary/`):

```ts
import { useEffect, useState } from 'react'

const KEY = 'automeetic.showGlossaryHighlights'

export function useHighlightToggle(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(KEY)
    return stored == null ? true : stored === 'true'
  })
  useEffect(() => {
    window.localStorage.setItem(KEY, String(enabled))
  }, [enabled])
  return [enabled, setEnabled]
}
```

(Create `src/renderer/glossary/useHighlightToggle.ts` for this.)

- [ ] **Step 2: Wrap transcript text in `TranscriptColumns.tsx`**

At the top of the component, fetch active glossary + toggle:

```tsx
const entries = useActiveGlossary(currentMeetingId ?? null)
const [highlightEnabled] = useHighlightToggle()
```

For each rendered source / translated text node, replace `<span>{text}</span>` with:

```tsx
<HighlightedText text={text} entries={entries} enabled={highlightEnabled} />
```

(Identify the exact text-rendering spots in the existing JSX and swap. Preserve any wrapper classes by keeping the outer span; `HighlightedText` returns a fragment of children.)

- [ ] **Step 3: Same treatment in `MeetingsTab.tsx`**

Where segment text is rendered, wrap with `<HighlightedText>`. Use `useActiveGlossary(meetingDetail.meeting.id)` so meeting-scoped overrides apply.

- [ ] **Step 4: Verify (manual run since these are renderer integrations)**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/glossary/useHighlightToggle.ts src/renderer/shell/TranscriptColumns.tsx src/renderer/library/MeetingsTab.tsx
git commit -m "feat(glossary): wire HighlightedText into live feed + meeting transcripts"
```

---

### Task 5.5 — Toggle UI in panel header + styles

**Files:** `src/renderer/glossary/GlossaryPanel.tsx`, `src/renderer/App.css`

- [ ] **Step 1: Add toggle to panel header**

In the existing panel header (next to tabs / search), add:

```tsx
const [highlightEnabled, setHighlightEnabled] = useHighlightToggle()

<label className="glossary-highlight-toggle">
  <input
    type="checkbox"
    checked={highlightEnabled}
    onChange={(e) => setHighlightEnabled(e.target.checked)}
  />
  하이라이트 표시
</label>
```

- [ ] **Step 2: Add styles to `App.css`**

```css
:root {
  --glossary-accent: rgba(99, 102, 241, 0.35);
  --glossary-accent-hover: rgba(99, 102, 241, 0.55);
}
[data-theme='dark'] {
  --glossary-accent: rgba(165, 180, 252, 0.4);
  --glossary-accent-hover: rgba(165, 180, 252, 0.6);
}
.glossary-mark {
  border-bottom: 1px dotted var(--glossary-accent);
  cursor: help;
  transition: border-bottom-color 0.15s;
}
.glossary-mark:hover {
  border-bottom-color: var(--glossary-accent-hover);
}

.glossary-row-variants {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.glossary-row-variant-chip {
  font-size: 11px;
  padding: 1px 6px;
  background: var(--surface-muted, rgba(0,0,0,0.05));
  border-radius: 8px;
}

.glossary-editor-variants { margin-top: 12px; }
.glossary-editor-variants-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.glossary-editor-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: var(--surface-muted, rgba(0,0,0,0.05));
  border-radius: 8px;
  font-size: 12px;
}
.glossary-editor-chip button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.glossary-editor-variants-add { display: flex; gap: 4px; }

.variant-picker {
  border: 1px solid var(--border, rgba(0,0,0,0.1));
  padding: 12px;
  border-radius: 6px;
  margin-top: 8px;
}
.variant-picker-list { list-style: none; padding: 0; }
.variant-picker-list li { padding: 6px 0; border-top: 1px dashed var(--border, rgba(0,0,0,0.06)); }
.variant-picker-list li:first-child { border-top: none; }
.variant-picker-candidate { font-family: monospace; margin: 0 8px; }
.variant-picker-frequency { color: var(--text-muted, #999); font-size: 12px; }
.variant-picker-example { color: var(--text-muted, #999); font-size: 11px; margin: 2px 0 0 24px; }
.variant-picker-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

.glossary-save-card {
  margin: 8px 0;
  padding: 12px;
  background: var(--surface-elevated, rgba(99, 102, 241, 0.06));
  border-left: 3px solid var(--accent, #6366f1);
  border-radius: 4px;
  cursor: pointer;
}
.glossary-save-card-header { font-weight: 600; margin-bottom: 6px; }
.glossary-save-card-variants { font-size: 12px; color: var(--text-muted, #777); margin-bottom: 4px; }
.glossary-save-card-body { font-size: 13px; margin-bottom: 4px; }
.glossary-save-card-example { font-size: 12px; color: var(--text-muted, #777); }
.glossary-save-card-warning { font-size: 12px; color: var(--warning, #d97706); }

.glossary-highlight-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  margin-left: 8px;
}
```

Adjust CSS variable names to match the project's existing conventions if they differ.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add src/renderer/glossary/GlossaryPanel.tsx src/renderer/App.css
git commit -m "feat(glossary): highlight toggle in panel header + all-component styles"
```

---

### Task 5.6 — Verify Phase 5

- [ ] **Run phase verification**

```bash
npm run verify:phase 5
```

Expected: `VERDICT: ✅ Phase 5 verified`.

- [ ] **Update `HANDOFF.md` Phase 5 row.**

---

## Phase 6 — Regression + manual smoke + push

### Task 6.1 — Full regression

- [ ] **Run general verification**

```bash
npm run verify
```

Expected: `VERDICT: ✅ Verified clean`.

- [ ] **Run build** (touches main + renderer + preload)

```bash
npm run build
```

Document any preexisting non-regression failures (e.g., the `tsc -b` issue noted in `HANDOFF.md` environment quirks — leave alone).

- [ ] **`npm test` blocked by Windows `EBUSY`?** Document it. Do not hide.

---

### Task 6.2 — Update `HANDOFF.md`

- [ ] **Move "Embedding Pipeline Durability" to a Completed stream section (if still active)**

- [ ] **Insert new "Next active stream" block:**

```markdown
> **Glossary Variants & Inline Highlights.** UX value-surfacing + minor backend extension. 6 phases. Makes glossary value visible: variants as first-class field, "변형 찾기" at registration, live inline highlights in transcript. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-25-glossary-variants-and-highlights-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md`
>
> Start at Phase 1 (Task 1.1). TDD pattern through Phases 1-3 + 5; Phase 4 is UI build; Phase 6 wrap-up.
```

- [ ] **Status table:**

```markdown
## Active stream state — Glossary Variants & Inline Highlights

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Schema + types + repo (TDD) | ⏳ PENDING | — | — |
| 2 — Variant finder + IPC + broadcast (TDD) | ⏳ PENDING | — | — |
| 3 — Prompt + normalize update (TDD) | ⏳ PENDING | — | — |
| 4 — Registration UI (picker + success card) | ⏳ PENDING | — | — |
| 5 — Live highlight + toggle + styles | ⏳ PENDING | — | — |
| 6 — Regression + handoff + push | ⏳ PENDING | — | — |
```

As each phase completes, replace the row with the verify-output-backed entry.

---

### Task 6.3 — Manual smoke (deferred to user)

Document in the final report:

- `npm run verify` is ✅ clean (or specific failure)
- Manual smoke deferred to user. Suggested checks (from spec success criteria):
  - Register `RealtimeOrchestrator`, click "변형 찾기" → candidates appear with frequencies
  - Save → success card shows past-match count and example
  - Start a meeting → live feed shows dotted underline on glossary matches
  - Open a saved meeting → same highlights in historical transcript
  - Toggle highlights off → underlines disappear
  - Register `AI` → save card warns about short-word exclusion
  - Register a brand-new term → forward-looking message in success card

---

### Task 6.4 — Push

```bash
git push origin master
```

- [ ] **Mark Phase 6 ✅ COMPLETE in `HANDOFF.md`** with the final commit hash.

---

## Self-review checklist (before declaring the stream done)

- [ ] All 6 phases ✅ COMPLETE in `HANDOFF.md` with verbatim `npm run verify:phase <N>` output.
- [ ] `glossary_entries.variants` column exists in fresh + migrated DBs; existing entries get `variants = []` without data loss.
- [ ] Variant finder returns candidates that visually look like the canonical (manual spot-check during testing).
- [ ] Live highlights render with dotted underline + working tooltip; toggle off removes them cleanly.
- [ ] `normalizePreserveTerms` rewrites variants to canonical in all four call sites (translation queue, Answer Assist, Whiteboard, Memory Chat) — same function = automatic.
- [ ] No regression to existing tests (count rises with new tests added; full count in `HANDOFF.md`).
- [ ] No deviation from the spec's "In scope" / "Out of scope" sections. If a deviation was necessary, it is documented in `HANDOFF.md` "Notes per phase" with a reason.

## Open questions (deferred to v2, do NOT implement in this stream)

- Per-entry highlight on/off toggle
- Usage counters / aggregate impact dashboard
- LLM-assisted phonetic variant detection
- Highlights in Memory Chat / Whiteboard
- Click-through from highlight to glossary panel
- Custom tooltip popover (replace native `title`)
- Sharing glossary across users / teams

# Glossary Auto-Suggestions — Design Spec

**Date:** 2026-05-20
**Status:** Draft — pending implementation
**Positioning lever:** Reduces manual friction of the v1 glossary by letting autoMeetic detect candidates and surface them as one-click suggestions after each meeting.

## One-line

After a meeting ends, autoMeetic asks the LLM to find recurring proper nouns and inconsistently-rendered terms in that meeting's transcript, surfaces them as pending suggestions in the glossary panel, and on accept retroactively normalizes the just-completed meeting's stored transcript.

## Why this follow-up

The v1 glossary (shipped 2026-05-20) is a pure manual store. The user pointed out that AI should reduce this friction: ideally autoMeetic notices "this term keeps showing up differently" and offers to register it. This spec covers the simplest version of that automation while preserving user veto.

## Success criteria

1. A user runs an English meeting where "kunchen" appears 4 times rendered as "kunchen", "Kun Chen", "Kunchen", "쿤천". After the meeting ends, the glossary header button shows a `+1` badge.
2. Opening the glossary panel shows a new "Suggestions" tab containing one row: `kunchen → ko: 쿤 첸 · 4× different renderings · 85%`.
3. Clicking Accept creates a global glossary entry, rewrites all four occurrences in the meeting's stored segments to the canonical form (and Korean target), and the suggestion disappears.
4. Re-opening the same meeting in the memory library shows the normalized transcript.
5. Dismissing a suggestion writes it to a permanent dismiss list — the same term will not be re-suggested in future meetings.
6. With auto-suggestions disabled (LLM unavailable, transcript too large, or extraction fails) the rest of the app behaves identically to the v1 baseline — zero regression.

## In scope

- LLM extraction of glossary candidates at meeting end (after summary generation)
- New `glossary_suggestions` table (ephemeral — deleted on accept/dismiss)
- New `glossary_dismissed_terms` table (permanent memory of user rejections)
- Retroactive normalization (`backfillSegments`) of the just-ended meeting's `segments` rows on accept
- New "Suggestions" tab in the glossary panel with per-row accept/dismiss
- "Accept all" bulk button (only for confidence ≥ 0.7)
- Header glossary-button badge showing pending suggestion count
- Cleanup hook: when the user manually upserts a glossary entry, delete any pending suggestion that matches the same sourceTerm
- Telemetry counters for extraction success/failure, accept/dismiss, backfill row count

## Out of scope (deferred to a later round)

- Real-time mid-meeting suggestions (only end-of-meeting batch in v1)
- Pre-meeting prefetch (look at upcoming calendar items, propose terms in advance)
- Edit-before-accept UI (user can edit after accept via the existing Global tab)
- Auto-regenerate the meeting summary after backfill
- Memory Library inline surface for suggestions (per-meeting card in the library detail view)
- Map-reduce extraction for very long meetings (transcripts >100,000 chars are silently skipped)
- Retry queue for failed extractions on next app startup
- User-tunable confidence threshold
- Surfacing suggestion provenance back into the meeting timeline UI

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Trigger timing | End of meeting (after summary completes) | Simplest possible. Matches existing summaryService cadence. User can revisit cleaned-up transcript in memory library. Cost minimal (1 LLM call per meeting). |
| Retroactive normalization scope | This meeting only | Magic moment without contaminating other meetings. Other meetings remain untouched. |
| LLM model | `gpt-4o-mini` | Same as summaryService. Stable JSON output. Cheap. |
| Suggestion storage | Ephemeral row, deleted on accept/dismiss | No history to maintain; simpler queries. Telemetry captures aggregate stats. |
| Dismiss memory | Permanent (`glossary_dismissed_terms` table) | User signals "not a glossary term." Re-suggesting wastes their time. |
| Confidence threshold | Fixed at 0.5 (in LLM filter) | v1 simplification — not user-tunable. |
| Bulk accept threshold | Confidence ≥ 0.7 only | Lower-confidence items must be reviewed individually. |
| Edit before accept | Not supported in v1 | Forces one-click commitment. User can edit afterwards via the Global tab. Dismiss + manual add covers wrong proposals. |
| Variants tracking | LLM outputs `variants[]`, used during backfill only | Captures the LLM's clustering insight (e.g., "kunchen" ≡ "쿤천") for backfill. Discarded with the suggestion afterwards. |
| Concurrent meeting safety | One live meeting at a time (existing MeetingLifecycle constraint) | No need for cross-meeting coordination. |
| Race with manual upsert | Cleanup hook deletes any pending suggestion that matches a manually-added sourceTerm | Avoids stale suggestions for already-resolved terms. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Main process                                                         │
│                                                                       │
│   meetingLifecycle.endMeeting()                                      │
│         │                                                             │
│         ▼                                                             │
│   summaryService.generateSummary(meetingId)  ── async                │
│         │ (completes — success OR failure)                            │
│         ▼                                                             │
│   suggestionService.extractCandidates(meetingId)                     │
│         │  - load full transcript via memoryRepo                     │
│         │  - load existing glossary terms + dismissed terms          │
│         │  - call OpenAI (gpt-4o-mini, JSON output)                  │
│         │  - parse + validate + dedup                                │
│         │  - upsert into glossary_suggestions table                  │
│         │  - broadcast 'glossary:suggestions-updated' IPC            │
│         ▼                                                             │
│   (Acceptance & dismiss are user-driven IPC events)                  │
│                                                                       │
│   On acceptSuggestion(id):                                            │
│      transaction(                                                    │
│        upsertGlossary(entry from suggestion)                         │
│        backfillSegments(meetingId, entry, variants)                  │
│        DELETE FROM glossary_suggestions WHERE id = ?                 │
│      )                                                                │
│      broadcast 'glossary:changed' + 'memory:meeting-updated'         │
│                                                                       │
│   On dismissSuggestion(id):                                           │
│      transaction(                                                    │
│        INSERT INTO glossary_dismissed_terms ON CONFLICT UPDATE       │
│        DELETE FROM glossary_suggestions WHERE id = ?                 │
│      )                                                                │
│      broadcast 'glossary:suggestions-updated'                        │
└─────────────────────────────────────────────────────────────────────┘
                    │ IPC
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer                                                              │
│                                                                       │
│   useGlossaryStore — extended with pending-suggestion state          │
│   GlossaryPanel — new "Suggestions" tab + "Accept all" toolbar       │
│   SuggestionRow — accept / dismiss buttons + metadata strip          │
│   Header button — count badge from glossary:suggestions:count        │
└─────────────────────────────────────────────────────────────────────┘
```

## Data model

### sqlite schema (`src/main/memory/schema.ts`)

Bump `SCHEMA_VERSION` 2 → 3. Append:

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

Schema 2 → 3 follows the same migration model as 1 → 2: the `MemoryRepository.initialize()` flow re-runs `SCHEMA_SQL` on every startup, idempotent via `IF NOT EXISTS`. The constant bump is informational.

### TypeScript types (`src/main/memory/types.ts`)

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

## LLM extraction

### Input context

Built in `src/main/glossary/extractionPrompt.ts`:

1. **Transcript**: re-use the existing `buildTranscriptUserPrompt(meeting.startedAt, segments)` from `summary.v1.ts`. Limit: skip extraction entirely if the transcript-formatted user message exceeds 100,000 characters (the system prompt and term lists add a few thousand more, so this caps total prompt at well under gpt-4o-mini's 128K-token window). Telemetry logs `extraction.failure.transcript-too-large`.
2. **Active target language**: `meeting.targetLanguage` (or `'off'` when none).
3. **Existing glossary terms**: case-insensitive lowercase list of `sourceTerm`s from `activeGlossary(meetingId)`. Truncated to 200 entries (most recent by `updated_at` DESC) to keep prompt size bounded.
4. **Dismissed terms**: full `glossary_dismissed_terms.source_term` column. Truncated to 200 entries (most recent by `dismissed_at` DESC).

### System prompt

```
You are a glossary extractor for meeting transcripts. Find recurring proper
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

Active target language: {targetLang}
Existing glossary terms (case-insensitive — do NOT re-suggest):
{existingTerms or "(empty)"}
Previously dismissed terms (do NOT re-suggest):
{dismissedTerms or "(empty)"}

Output JSON only. Schema:
{
  "candidates": [
    {
      "sourceTerm": string,         // canonical form, 1-100 chars
      "variants": string[],         // other renderings seen in transcript (may be empty)
      "translations": object,       // { "ko": "쿤 첸" } or {} if no translation or target is "off"
      "preserve": boolean,          // true = keep verbatim in all outputs
      "confidence": number,         // 0..1
      "reason": string,             // one short clause (<=200 chars)
      "frequency": integer          // occurrence count in transcript
    }
  ]
}

Rules:
- Pick ONE canonical sourceTerm form even if transcript has variants.
  List the other forms in "variants".
- If targetLang is "off" or empty, leave translations as {}.
- Only propose preserve=true when the term is a code symbol, acronym, or
  brand name that should be untranslated. Person names usually preserve=false
  with a translation entry.
- confidence < 0.5 → exclude from output.
- Return at most 10 candidates, ordered by confidence DESC.
- Output JSON only. No code fences, labels, or explanation.
```

### Output validation (in `suggestionService.parseExtractionResponse`)

For each raw candidate from the LLM:

- `sourceTerm`: non-empty string, length 1-100 (trim whitespace first)
- `variants`: array of strings, each 1-100 chars, dedupe within itself and against `sourceTerm` (case-insensitive)
- `translations`: object whose keys are 1-20 char language codes and values are 1-100 char strings
- `preserve`: boolean
- `confidence`: number in `[0.5, 1.0]`
- `reason`: optional string, truncated to 200 chars
- `frequency`: positive integer or null

Drop the candidate (silent) if any check fails.

After per-candidate validation, the service applies these dedup passes:

1. Drop any candidate whose lowercased `sourceTerm` matches an existing global or current-meeting glossary entry.
2. Drop any candidate whose lowercased `sourceTerm` is in `glossary_dismissed_terms`.
3. Within the batch, dedup by lowercased `sourceTerm`, keeping the highest-confidence entry.

Then `upsertSuggestion` writes each remaining candidate to `glossary_suggestions`.

## Backfill semantics

`backfillSegments(meetingId, entry, variants)` is the helper invoked inside the accept transaction.

**Inputs:**

- `meetingId` — segments scope
- `entry` — the just-created `GlossaryEntry` (canonical `sourceTerm`, `translations`, `preserve`)
- `variants` — string array carried by the suggestion (other renderings the LLM detected)

**Logic per segment:**

1. Collect normalization terms: `[entry.sourceTerm, ...variants]`. All matches use case-insensitive word-boundary regex on each term.
2. For `entry.preserve === true`:
   - In `source_text` and `translated_text`: replace any matched form with `entry.sourceTerm` (canonical casing).
3. For `entry.preserve === false`:
   - In `source_text`: replace any matched form with `entry.sourceTerm` (canonical casing).
   - In `translated_text` (only when the meeting's `targetLanguage` is set and `entry.translations[targetLanguage]` exists): replace any matched form with `entry.translations[targetLanguage]`.
4. `UPDATE segments SET source_text = ?, translated_text = ? WHERE id = ?` per row only when a change occurred (skip no-op updates).
5. Aggregate count of changed rows for telemetry.

**Word-boundary regex:** `new RegExp('\\b' + escapeRegex(term) + '\\b', 'gi')` — same as `normalizePreserveTerms` from v1. Variants and canonical sourceTerm are escaped per term.

**Atomicity:** The entire backfill runs inside the accept transaction. If any segment UPDATE throws, the whole accept is rolled back. The pre-existing glossary entry insertion and suggestion deletion roll back together.

**Limitation (documented):** Backfill cannot reconcile renderings that didn't appear in the LLM's `variants` output. E.g., if the LLM missed "쿤천" as a variant of "kunchen", that string stays in source_text. This is acceptable in v1; users can add it manually via the Global tab if they care.

## Renderer integration

### State (`useGlossaryStore`)

Extended with:

```ts
{
  // existing v1 state...
  suggestions: GlossarySuggestion[]
  pendingCount: number
  loadSuggestions(): Promise<void>
  acceptSuggestion(id: string): Promise<void>
  dismissSuggestion(id: string): Promise<void>
  bulkAcceptSuggestions(ids: string[]): Promise<{ accepted: number; failed: number }>
}
```

Refresh triggers on `glossary:suggestions-updated` and `glossary:changed` broadcasts.

### `GlossaryPanel` extensions

- Tabs become `[Suggestions (N)] [Global] [This meeting]` — Suggestions always present.
- Toolbar adapts per tab. Suggestions tab: `[Search] [Accept all (M)] [+ Add term]` (where M = count of suggestions with confidence ≥ 0.7). Other tabs unchanged.
- Empty state for Suggestions when count = 0: `"No pending suggestions — autoMeetic suggests new terms after each meeting ends."`

### `SuggestionRow` component

Layout per row:

```
[sourceTerm (mono bold)]   [translation pill OR "Preserve" pill]   [✓ Accept]  [Dismiss]
[reason · confidence% · "Meeting <HH:MM>"]
```

Behaviors:

- Accept: fire `acceptSuggestion(id)`, optimistic fade-out, error → restore row + inline banner
- Dismiss: fire `dismissSuggestion(id)`, optimistic fade-out, error → restore row + inline banner

Per CLAUDE.md UI guidelines: use Phosphor/Radix icons only (1.5 stroke), Geist font, existing `--p-*` color tokens, no glow effects.

### Header badge

Add a small `v4p-iconbtn-badge` chip overlaying the bottom-right corner of the existing Glossary header button when `pendingCount > 0`:

```tsx
{pendingCount > 0 && (
  <span className="v4p-iconbtn-badge amw-mono">{pendingCount}</span>
)}
```

CSS: absolutely positioned, `--p-primary` background, `--p-primary-on` text, mono font, ~9.5px font size.

## IPC surface

```ts
// Renderer → Main
'glossary:suggestions:list'        (meetingId?: string)   → GlossarySuggestion[]
'glossary:suggestions:accept'      (id: string)           → GlossaryEntry
'glossary:suggestions:dismiss'     (id: string)           → void
'glossary:suggestions:bulk-accept' (ids: string[])        → { accepted: string[]; failed: Array<{ id: string; error: string }> }
'glossary:suggestions:count'       ()                     → number

// Main → Renderer (broadcast)
'glossary:suggestions-updated'                            → void
```

Preload bridge extends `window.electronAPI.glossary` with five new method properties + `onSuggestionsUpdated` listener registration.

## Cleanup hook

`MemoryRepository.upsertGlossary` (existing) gets a small in-transaction follow-up: after the upsert, delete any rows in `glossary_suggestions` where `LOWER(source_term) = LOWER(?)`. This keeps the Suggestions tab from showing pending items for terms the user has just added manually. The transaction also fires `glossary:suggestions-updated` so the panel refreshes.

This is a one-line change in the existing repo method plus a small wrapper that emits the broadcast.

## Meeting lifecycle wiring

`src/main/memory/meetingLifecycle.ts` `endMeeting()` returns the just-ended meeting id. The `src/main/index.ts` orchestration that already fires the summary on meeting end appends a follow-up step:

```ts
const endedId = lifecycle.endMeeting()
if (endedId) {
  await summaryService.generateSummary(endedId).catch(logErr)
  await suggestionService.extractCandidates(endedId).catch(logErr)
}
```

Summary completes first (sequential, not parallel) — they share the same OpenAI key and rate-limit budget. Both call paths are independently fault-tolerant.

## Telemetry

Counters via existing `src/main/telemetry/logger.ts`:

- `glossary.extraction.success`            — increment per meeting where extraction completes (any candidates or none)
- `glossary.extraction.failure`            — tag with reason: `transcript-too-large`, `llm-error`, `parse-error`
- `glossary.extraction.candidates-emitted` — histogram, per meeting
- `glossary.suggestion.accepted`           — counter
- `glossary.suggestion.dismissed`          — counter
- `glossary.suggestion.bulk-accepted`      — counter, with bulk size
- `glossary.backfill.segments-updated`     — histogram, per accept

These feed the v2 question of "false positive rate" and "user adoption."

## Error handling summary

| Failure | Behavior |
|---|---|
| Transcript > 100,000 chars | Skip extraction silently. Telemetry `extraction.failure.transcript-too-large`. |
| OpenAI 4xx/5xx | Skip extraction silently. Telemetry `extraction.failure.llm-error`. |
| Malformed JSON or schema violation | Drop just that candidate (or whole batch if root is unparseable). Telemetry `extraction.failure.parse-error`. |
| `acceptSuggestion` transaction failure | ROLLBACK. Suggestion stays. Renderer shows inline error banner. |
| `dismissSuggestion` failure | Same (rare — only INSERT + DELETE). |
| Bulk accept partial failure | Each accept is its own transaction. Return `{ accepted: [...], failed: [...] }` and surface partial-success toast in the panel. |
| User manually adds term that has a pending suggestion | Cleanup hook deletes the suggestion in the same transaction as the upsert. Broadcast fires; panel refreshes. |

## Testing strategy

Unit (vitest):

- `glossary-suggestion-repository.test.ts` — upsert, list-by-meeting, count-pending, accept (transaction), dismiss (with dismiss-memory write), bulk-accept partial failure, manual-upsert cleanup hook.
- `glossary-extraction.test.ts` — `parseExtractionResponse` validates each rule. Dedup against existing entries + dismissed terms + intra-batch duplicates.
- `glossary-backfill.test.ts` — preserve=true case (source + translated both normalized). preserve=false + translations case (translated maps, source canonicalized). Variants substitution. Word-boundary respect (no partial matches).
- `glossary-suggestion-ipc.test.ts` — round-trip happy paths for list, accept, dismiss, bulk-accept, count. Broadcast verified via mocked `BrowserWindow.getAllWindows()`.

Manual smoke (Phase 8 in the plan):

1. Run an English meeting where "kunchen" appears 4× with variant renderings.
2. Stop meeting → wait ~10 s for extraction.
3. Confirm header glossary button has a `+1` badge.
4. Open panel → Suggestions tab → see the candidate row.
5. Click Accept → row disappears, badge updates.
6. Open the meeting in Memory Library → all 4 occurrences now render as canonical "kunchen" in source column, "쿤 첸" in target column.
7. In a new meeting that mentions "kunchen" once, no suggestion is generated for it (already in glossary).
8. Run another meeting that surfaces a new candidate → Dismiss it.
9. Run a third meeting mentioning the same dismissed term → no suggestion (dismiss-memory works).

## Files touched (estimated)

- `src/main/memory/schema.ts` — bump version + append two CREATE TABLEs
- `src/main/memory/types.ts` — `GlossarySuggestion`, `GlossarySuggestionInput`
- `src/main/memory/repository.ts` — suggestion CRUD + dismiss memory + backfillSegments + cleanup hook
- `src/main/glossary/suggestionService.ts` — orchestration: extract + dedup + write
- `src/main/glossary/extractionPrompt.ts` — system prompt + transcript framing
- `src/main/glossary/backfill.ts` — backfill helper extracted from repository (if cleaner) OR inline in repo
- `src/main/index.ts` — wire `suggestionService.extractCandidates(endedId)` after summary generation
- `src/main/ipc-glossary-handlers.ts` — 5 new handler factories
- `src/main/telemetry/logger.ts` — usage only (no API changes)
- `src/preload/index.ts` — bridge for `suggestions.*` methods + `onSuggestionsUpdated`
- `src/preload/types.ts` — types
- `src/renderer/glossary/types.ts` — re-export `GlossarySuggestion`
- `src/renderer/glossary/useGlossaryStore.ts` — extend with suggestions state + actions
- `src/renderer/glossary/GlossaryPanel.tsx` — add Suggestions tab + Accept all toolbar
- `src/renderer/glossary/SuggestionRow.tsx` — new file
- `src/renderer/App.tsx` — header button badge wiring
- `src/renderer/App.css` — suggestion row styles + badge style
- `src/test/glossary-suggestion-repository.test.ts` — new
- `src/test/glossary-extraction.test.ts` — new
- `src/test/glossary-backfill.test.ts` — new
- `src/test/glossary-suggestion-ipc.test.ts` — new

## Estimated effort

~16-20 hours of solo work, ~2-3 days. Plan breaks this into 8 phases (see companion implementation plan).

## Open questions (resolve during implementation plan)

- Should `summaryService.generateSummary` already return a typed result that exposes whether it succeeded so the wiring code can gate extraction? Verify the current return shape and add a thin status if needed.
- Does `MemoryRepository.upsertGlossary` already run inside a transaction wrapper, and if so where do we hook the cleanup so both run atomically? Confirm during Phase 1.
- The `meeting.targetLanguage` column may be `'auto'` or `'off'` — confirm how to coerce to the LLM's `targetLang` parameter (and what to do during translation mapping when `targetLanguage === 'off'`).

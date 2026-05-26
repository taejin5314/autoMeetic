# Glossary Variants & Inline Highlights — Design Spec

**Date:** 2026-05-25
**Status:** Draft — pending implementation
**Stream type:** UX value-surfacing + minor backend extension
**Related:**
- Glossary v1 (`2026-05-19-glossary-and-diagram-label-language-design.md`)
- Glossary auto-suggestions (`2026-05-20-glossary-auto-suggestions-design.md`)

This stream builds on both: glossary entries gain a first-class `variants` field, and the value of registering an entry becomes visible **at the registration moment** (an "aha" preview) and **continuously during live meetings** (subtle inline highlights).

## One-line

Make glossary value visible: when registering a term, scan past segments to surface STT mishearings the user can attach as `variants`; during live meetings, render those terms (canonical + variants) with a subtle dotted underline + hover tooltip so the user can see their glossary working in real time.

## Why this stream

Glossary currently does **a lot** invisibly:
- Injects terms into translation prompts (live transcript, Answer Assist, Whiteboard, Memory Chat)
- Post-passes translated text to normalize `preserve` terms back to canonical form
- Feeds canonical terms into STT vocabulary bias to reduce mishearings
- Auto-suggests terms from past meetings via the Suggestions tab

Yet the panel UI is a plain CRUD list. A user who registers `RealtimeOrchestrator` with `preserve=true` has **no signal that anything happened** — they just see translations come out, with no indication that their glossary was responsible for the term being preserved. The aggregate effect of glossary is real but feels speculative to the user, which suppresses willingness to register more terms.

Worse: **the most valuable case for glossary is the case where STT mishears the term.** A user registers `RealtimeOrchestrator` precisely because STT keeps emitting `real time orchestrator`, `realtime orchestrator`, or `real time architect`. A naive "find past mentions" preview will return 0 exact matches and look like the feature failed — actively discouraging the user from the very registrations that matter most.

This stream fixes both problems with one mechanism: `variants` as a first-class concept. The variant finder turns STT mishearings into visible, actionable evidence at the registration moment ("we found this term mistranscribed in 17 ways"), and the same variants drive both post-pass normalization and live highlights so the user sees ongoing impact.

## Success criteria

1. **Registration moment ("aha"):** User opens the glossary panel, clicks "+ new", types `RealtimeOrchestrator`, clicks "변형 찾기". Within ~1 second, candidates appear: `real time orchestrator (12 times)`, `realtime orchestrator (3 times)`, with checkboxes. User accepts both, saves. The success card shows "총 15번 등장" with one example segment.
2. **Forward-looking fallback:** Registering a brand-new term (0 exact + 0 variant matches) shows a clear "다음 미팅부터 자동으로 보존됩니다" message — never a discouraging "0 results" empty state.
3. **Live highlight:** In the live transcript columns (source + translated), any text matching a glossary entry's `sourceTerm` or any of its `variants` renders with a dotted underline. Hovering shows a tooltip with the canonical term, translation (if any), and a small "📖 내 glossary" label.
4. **Toggle:** A header toggle (default ON, persisted to localStorage as `automeetic.showGlossaryHighlights`) turns highlights off if the user finds them noisy.
5. **Past meeting transcripts also highlighted:** Opening any meeting in the Memory Library renders the same highlights on the saved transcript.
6. **Post-pass normalize handles variants:** If LLM-translated text contains `real time orchestrator`, the post-pass rewrites it to `RealtimeOrchestrator` (the canonical `sourceTerm`). Same for Answer Assist, Whiteboard label post-pass, and Memory Chat answers — all four already call `normalizePreserveTerms`; the change is one function update.
7. **Glossary prompt mentions variants:** LLM prompt sections now include variant forms so the model also normalizes proactively (not just post-pass).
8. **STT bias unchanged:** Only the canonical `sourceTerm` is sent to STT as a vocabulary hint. Variants are **not** sent, because adding misheard spellings would teach STT the wrong word.
9. **Suggestion → entry copy:** Accepting an auto-suggestion (`glossary_suggestions.variants`) creates an entry with those variants pre-filled.
10. **Schema migration:** Existing user DBs at v4 migrate to v5 with `ALTER TABLE glossary_entries ADD COLUMN variants TEXT NOT NULL DEFAULT '[]'`. Existing entries get an empty variants array; no data loss.
11. **Short-word guard:** Terms whose normalized form is ≤2 characters (e.g., `AI`) are excluded from both variant finding (would match every "a"+"i") and live highlighting. Documented in the success card if the term itself is too short.
12. **Word-boundary correctness:** The English highlight regex uses `\b` so registering `AI` does not highlight the `ai` in `again`. Korean (no word boundaries) uses normalized substring with surrounding non-Hangul char checks where applicable.
13. **No regression to existing tests** (`npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all clean).

## In scope

### Schema + types

- New schema version 4 → 5. SCHEMA_SQL includes the new column for fresh installs:
  ```sql
  variants TEXT NOT NULL DEFAULT '[]'
  ```
- Migration helper `migrateToV5()` in `MemoryRepository.initialize()` runs `ALTER TABLE glossary_entries ADD COLUMN variants TEXT NOT NULL DEFAULT '[]'` for DBs that were created before v5 (idempotent: probes `PRAGMA table_info(glossary_entries)` first).
- `GlossaryEntry` type gains `variants: string[]`.
- `GlossaryEntryInput` type gains `variants?: string[]` (optional; defaults to `[]`).
- New shared type `VariantCandidate { candidate: string; frequency: number; exampleSegmentId: string; exampleText: string }`.

### Variant finder

- New module `src/main/glossary/variantFinder.ts`:
  - `normalize(text: string): string` — lowercase + strip whitespace/hyphens/underscores/dots/slashes.
  - `levenshtein(a: string, b: string): number` — standard DP, capped at 4 chars for early-exit performance.
  - `isVariantMatch(candidate: string, canonical: string, maxDistance = 2): boolean` — returns true if:
    - both normalized forms have length ≥ 3, AND
    - `|len(nc) - len(nn)| ≤ maxDistance`, AND
    - first character matches (reduces false-positive cost), AND
    - `levenshtein(nc, nn) ≤ maxDistance`.
  - `findVariantCandidates(canonical, segments, options)`:
    - Tokenizes each `segment.sourceText` by whitespace.
    - For each token-window of size 1..4, builds an n-gram, normalizes, and tests with `isVariantMatch`.
    - Excludes exact normalized matches (those aren't "variants", they're the canonical form already).
    - Groups by lowercased n-gram, counts frequency, records the first example segment.
    - Returns top N (default 10) candidates sorted by frequency descending.
- Pure functions, fully unit-testable.

### Repository changes

- Add `variants` JSON column to all `glossary_entries` SELECTs and INSERTs/UPSERTs.
- `upsertGlossary(input)`: serialize `variants ?? []` to JSON; rehydrate on read.
- `acceptSuggestion(id)`: copy the suggestion's `variants` array into the new entry.
- `activeGlossary(meetingId)`: returned entries include `variants`.
- New method `listRecentSegmentsForScan(limit = 5000): { id: string; sourceText: string }[]` — pulls the most recent N segments across all meetings for variant scanning. (We cap to keep scans bounded; users almost always care about recent meetings.)

### IPC + preload

- New channel `glossary:find-variants` request: `{ canonical: string }`. Response: `VariantCandidate[]`.
- Handler in `src/main/ipc-glossary-handlers.ts`: calls `listRecentSegmentsForScan` + `findVariantCandidates`, returns top 10.
- Preload bridge: `window.electronAPI.glossary.findVariants(canonical: string): Promise<VariantCandidate[]>`.
- Preload types updated.

### Prompt injection

- `formatGlossaryPromptSection` (used by translation queue, Answer Assist, Whiteboard, Memory Chat):
  - When an entry has variants, prompt now mentions them:
    ```
    - Keep verbatim in all output: "RealtimeOrchestrator" (also accept these spellings as the same term: "real time orchestrator", "realtime orchestrator")
    ```
  - Mapped translations get a similar variant note.
- `normalizePreserveTerms`:
  - For each `preserve` entry, also normalize each variant to the canonical sourceTerm.
  - Loop: `for (const form of [entry.sourceTerm, ...entry.variants]) { /* regex replace */ }`.
  - All four call sites (translation queue, Answer Assist, Whiteboard, Memory Chat) get the upgrade automatically.

### Renderer — registration UI

- `GlossaryRowEditor.tsx`:
  - New "Variants" section: chip list (existing variants), text input + "+" button to add manually, "변형 찾기" button to scan past segments.
  - On "변형 찾기" click: invokes IPC, opens modal with candidates.
- New `VariantCandidatePicker.tsx`:
  - Renders `VariantCandidate[]` with checkboxes; pre-checks candidates with frequency ≥ 3.
  - Shows the `exampleText` preview under each candidate.
  - "선택 추가" button adds checked candidates to the entry's variants chip list (still unsaved at this point).
- New `GlossarySaveSuccessCard.tsx` (transient, appears after save):
  - If exact + variant total ≥ 1: "총 N번 등장 — 미래 미팅에서 자동 정정됩니다." + recent example.
  - If 0 + 0: "과거 미팅에서 등장하지 않은 새 단어예요. 다음 미팅부터 자동 보존됩니다."
  - If sourceTerm too short (normalized length ≤ 2): warning "짧은 단어라 하이라이트는 적용되지 않습니다." (entry still saves; just no highlight rendering).
  - Auto-dismisses after ~6 seconds, or click to dismiss.

### Renderer — live highlight

- New module `src/renderer/glossary/glossaryMatcher.ts`:
  - `buildMatcher(entries: GlossaryEntry[]): GlossaryMatcher` — precomputes a list of `(canonical, regex)` pairs. Each entry produces a regex like `/\b(RealtimeOrchestrator|real time orchestrator|realtime orchestrator)\b/gi`. Word-boundary `\b` for English; for entries whose canonical or any variant contains Hangul, also adds a Korean-friendly non-Hangul-or-boundary alternative.
  - `applyHighlights(text: string, matcher: GlossaryMatcher): Segment[]` — returns an array of `{ kind: 'text' | 'match'; value: string; entryId?: string }` for React rendering.
  - Memoize matcher build on `entries` reference identity.
- New component `src/renderer/glossary/HighlightedText.tsx`:
  - Props: `text: string`, `entries: GlossaryEntry[]`, `enabled: boolean`.
  - Returns `<>` with `<GlossaryMark entry={...} />` spans interleaved with plain text.
  - When `enabled=false`, returns plain text — zero overhead.
- New component `GlossaryMark.tsx`:
  - Renders `<span className="glossary-mark" title="...">{children}</span>`.
  - Tooltip content includes: canonical sourceTerm, translation (if target language set), "📖 내 glossary" label.
- Integration sites:
  - `src/renderer/shell/TranscriptColumns.tsx`: wraps each segment's source + translated text in `<HighlightedText>`.
  - `src/renderer/library/MeetingsTab.tsx`: same for saved transcript rendering.
- Toggle:
  - localStorage key `automeetic.showGlossaryHighlights` (default `true`).
  - Toggle UI in the GlossaryPanel header (the panel is the natural setting location).
  - When toggled, `HighlightedText` re-renders without marks.

### Styles (`src/renderer/App.css`)

- `.glossary-mark`: `border-bottom: 1px dotted var(--glossary-accent); padding-bottom: 0;`
- `--glossary-accent`: defined per theme (light/dark) at ~30% opacity of accent color.
- Hover: `border-bottom-color: var(--glossary-accent-hover)` (50% opacity).
- `cursor: help` to telegraph the tooltip.
- Tooltip uses native `title` attribute in v1; v2 may upgrade to a custom popover.

## Out of scope (deferred)

- Per-entry "highlight on/off" toggle (v2; v1 is a global toggle).
- Per-entry usage counter / aggregate impact dashboard (Combo B option — not selected).
- Live "saved by glossary" toast (Combo A explicitly excluded — highlight provides ambient signal).
- LLM-assisted phonetic variant detection (Combo A-3 explicitly deferred — orthographic Levenshtein only in v1).
- Highlights in Memory Chat answers, Whiteboard labels (the normalize pass already canonicalizes them; visual highlight is v2).
- Click-through from a highlight to the glossary panel.
- Custom tooltip popover (use `title` attribute in v1).
- Variant frequency timeline / per-meeting breakdown.
- STT vocabulary bias for variants (correctness concern — never).
- Bulk variant management (CSV import, etc.).
- Sharing glossary across users / teams.

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Variant representation | New JSON array column `variants TEXT NOT NULL DEFAULT '[]'` on `glossary_entries` | Mirrors the existing `glossary_suggestions.variants` column. Single source of truth. Easy schema migration. |
| Fuzzy algorithm | Normalized Levenshtein distance ≤ 2 + first-character match + length-delta ≤ 2 + length ≥ 3 | Catches the 80–90% case (STT spacing/hyphenation, simple typos, plurals). Cheap. No library deps. Predictable. Phonetic and LLM-based detection are v2. |
| Variant scan scope | Last 5000 segments across all meetings | Bounds scan cost; covers recent activity that's most relevant. Configurable later if needed. |
| Highlight regex | Per-entry alternation `(canonical\|variant1\|variant2)` with `\bword-boundaries` | Standard regex. One regex per entry, evaluated independently. Memoized at matcher build. |
| Highlight toggle | Global localStorage flag (default ON) | Most users will want it; the few who find it noisy can flip once. Per-entry is overkill for v1. |
| Short-word exclusion | Normalized length ≤ 2 ⇒ no variant search + no highlight | Avoids "AI matches in 'again'" noise. Documented in save card. |
| STT bias | Canonical only, never variants | Adding misheard spellings to STT hints would reinforce wrong spellings. Variants serve post-pass / highlight, not pre-recognition. |
| Prompt injection | LLM is told about variants explicitly ("accept these spellings as the same term") | Lets the model do proactive normalization in addition to the safety-net post-pass. |
| Migration approach | Explicit `migrateToV5()` runs ALTER once, guarded by `PRAGMA table_info` probe | Schema bumps that add columns can't rely on `CREATE TABLE IF NOT EXISTS`. Idempotent guard handles fresh installs (where SCHEMA_SQL already created the column) cleanly. |
| Tooltip mechanism | Native `title` attribute | Zero new dependencies. Browser-native UX. v2 can upgrade to a custom popover if discoverability matters more. |
| Highlight surface | Live feed columns + Memory Library transcripts | These are the high-traffic transcript surfaces. Chat answers and whiteboard labels are agent-generated and already normalize via the post-pass — highlight there is lower marginal value. |
| Saved suggestion → entry handoff | `acceptSuggestion` copies `variants` array | Suggestion extraction already discovers variants; carrying them forward avoids dropping that signal. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fuzzy matcher surfaces unrelated words | Conservative thresholds (length ≥ 3, len-delta ≤ 2, first-char match, Levenshtein ≤ 2). User has the final say via checkboxes. False positives are visible (preview text shown) and easy to skip. |
| Live highlight is visually noisy | Subtle styling (dotted underline, 30% opacity, no fill). User toggle. Short-word exclusion. Per-entry toggle deferred to v2 if needed. |
| Variant scan slows registration UI | Cap 5000 segments; n-grams up to 4 tokens; early-exit Levenshtein. Expected <1s on a typical DB. Run in main process (off renderer thread). |
| Normalize pass slows translation pipeline | Each entry adds N+1 regex passes (N = variant count). With 50 entries × 3 variants average × ~500-char segment, this is sub-millisecond. Negligible. |
| Schema migration fails partway | `ALTER TABLE ADD COLUMN` with DEFAULT is atomic in SQLite. Idempotent (re-runs are no-ops via the PRAGMA probe). No data loss risk. |
| Existing tests break because GlossaryEntry shape changed | All test fixtures must add `variants: []`. Repo tests must assert the column round-trips. Updates are mechanical. |
| LLM prompt becomes too long with many variants | Keep variant list per entry capped at e.g. 10 in the prompt section (truncate with "...etc"). Variants array itself can be longer for normalize pass. |
| Hangul highlight word-boundary | English `\b` doesn't work inside Hangul. For canonical/variant forms containing Hangul, use lookarounds against the Hangul Unicode block (`(?<![가-힣])` / `(?![가-힣])`) instead of `\b`. |
| User registers a variant identical to the canonical | Dedupe at save time: strip variants whose normalized form equals the canonical's normalized form. |
| Saved suggestions already include variants but glossary entries haven't until now | `acceptSuggestion` copy path is the only entry into this; existing accepted entries (pre-v5) have `variants = []`. Users can run "변형 찾기" on those manually. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` must show `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` must show `VERDICT: ✅ Verified clean`. `npm run build` clean (touches main + renderer + preload).
3. **Manual smoke (deferred to user):**
   - Register `RealtimeOrchestrator` against the current DB (which has 975 segments). Confirm "변형 찾기" surfaces `real time orchestrator` (or similar) with a count.
   - Start a meeting, speak the term. Confirm live transcript highlights both source and translated forms with a dotted underline.
   - Toggle highlights off via the panel header; confirm the underlines disappear.
   - Open a saved meeting in the Memory Library; confirm the same highlights render on the historical transcript.
   - Register a brand-new term that has never been spoken. Confirm the success card shows the forward-looking message (no "0 results" empty state).
   - Register a 2-letter term like `AI`. Confirm the success card warns about the short-word exclusion.

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | Add `variants` column to `glossary_entries` SCHEMA_SQL; bump `SCHEMA_VERSION` 4 → 5 |
| `src/main/memory/repository.ts` | Modify | `migrateToV5()`; round-trip `variants` in upsert/list/active/acceptSuggestion; new `listRecentSegmentsForScan` |
| `src/main/memory/types.ts` | Modify | Add `variants: string[]` to `GlossaryEntry`; optional to `GlossaryEntryInput`; add `VariantCandidate` |
| `src/main/glossary/variantFinder.ts` | Create | `normalize`, `levenshtein`, `isVariantMatch`, `findVariantCandidates` |
| `src/main/glossary/promptInjection.ts` | Modify | `formatGlossaryPromptSection` mentions variants; `normalizePreserveTerms` loops over all forms |
| `src/main/ipc-glossary-handlers.ts` | Modify | Register `glossary:find-variants` handler |
| `src/preload/index.ts` | Modify | Expose `glossary.findVariants` |
| `src/preload/types.ts` | Modify | Type addition |
| `src/renderer/glossary/types.ts` | Modify | Re-export `VariantCandidate`; add `variants` to renderer-side type |
| `src/renderer/glossary/useGlossaryStore.ts` | Modify | New action `findVariants(canonical)`; ensure variants round-trip in upsert |
| `src/renderer/glossary/GlossaryRowEditor.tsx` | Modify | Variants chip input + manual add + "변형 찾기" button |
| `src/renderer/glossary/VariantCandidatePicker.tsx` | Create | Modal with checkbox list of candidates |
| `src/renderer/glossary/GlossarySaveSuccessCard.tsx` | Create | Transient success/aha card |
| `src/renderer/glossary/GlossaryPanel.tsx` | Modify | Show variant chips on each row; add highlights toggle in header |
| `src/renderer/glossary/glossaryMatcher.ts` | Create | `buildMatcher`, `applyHighlights` |
| `src/renderer/glossary/HighlightedText.tsx` | Create | React component wrapping text with marks |
| `src/renderer/glossary/GlossaryMark.tsx` | Create | Individual mark span + tooltip |
| `src/renderer/shell/TranscriptColumns.tsx` | Modify | Wrap source + translated text in `<HighlightedText>` |
| `src/renderer/library/MeetingsTab.tsx` | Modify | Same for saved transcript |
| `src/renderer/App.css` | Modify | `.glossary-mark` styles + accent CSS vars (light/dark) |
| `src/test/glossary-variant-finder.test.ts` | Create | Unit tests for normalize/levenshtein/isVariantMatch/findVariantCandidates |
| `src/test/glossary-repository-variants.test.ts` | Create | Round-trip variants through upsert/list/accept |
| `src/test/glossary-prompt-injection.test.ts` | Modify | Existing prompt tests get variant-aware assertions; normalize covers variants |
| `src/test/glossary-ipc-handlers.test.ts` | Modify | Add tests for `findVariants` IPC |
| `src/test/glossary-matcher.test.ts` | Create | Renderer-side matcher: word boundaries, Hangul, short-word exclusion |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Should we also highlight in Answer Assist answers and Memory Chat answers?** v1: no. Those surfaces already normalize via `normalizePreserveTerms` so the canonical form is what the user sees. Inline highlights there add complexity for marginal value. v2 can revisit.
- **Should the variant scan be background-async with a "scanning..." spinner, or synchronous-wait?** v1: synchronous IPC, ~1s max. If it ever feels slow, async with progress is a v2 polish.
- **Should the highlight toggle live in App settings instead of the glossary panel?** v1: in the panel header — the panel is where users think about glossary, so it's the obvious control surface. Settings is for cross-cutting preferences.
- **What's the right default for `topN` in `findVariantCandidates`?** v1: 10. Few enough to fit a small modal; rare for a term to legitimately have more than 10 spelling variants.
- **What about variants on `glossary_suggestions` flowing the other way (suggestion ← entry)?** Out of scope. Variants flow from suggestion → entry on accept, not the other direction.

## Self-review notes

Initial draft considered a per-entry usage counter (Combo B in brainstorming) alongside the registration moment and live highlight. On second pass: aggregate counters are an abstract retrospective signal, while the variant finder + live highlight together give the user (a) a concrete one-shot "aha" at registration and (b) constant ambient feedback during the meeting. Counters would be a third overlapping signal with diminishing marginal value. Kept the scope to two reinforcing mechanisms.

The same self-review flagged that the original "live highlight" without variants would be useless for the most-valuable case (registering a term precisely because STT mishears it). Introducing variants as a first-class concept unifies the two mechanisms: the variant finder turns the registration moment into a believable preview, and the same variants drive the highlight regex so STT mishearings get visually annotated during live meetings too.

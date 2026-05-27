# STT Sentence Boundary — Decimal & Standalone-Punctuation Fix — Design Spec

**Date:** 2026-05-27
**Status:** Draft — pending implementation
**Stream type:** Bug fix in a high-risk area (live feed sentence grouping)
**Related:** Touches `src/main/transcriptPostProcessor.ts` (the live sentence-grouping engine) + a small `MemoryRepository` addition. `CLAUDE.md` flags "Live feed sentence grouping and auto-scroll" as high-risk — change carefully, lean on tests.

## One-line

Replace the single sentence-end regex in `transcriptPostProcessor.ts` with a 3-state classifier (`hard` / `soft` / `none`): hard enders (`?`, `!`, CJK) finalize immediately as today; soft enders (digit-then-period like `4.`, ellipsis, common abbreviations) wait a short grace window so trailing fragments can join; and standalone-punctuation fragments (a lone `?`) merge back into the just-finalized sentence instead of forming their own line.

## Why this stream

Two user-reported live-transcription defects, both rooted in the same over-eager finalization rule.

Current logic ([`transcriptPostProcessor.ts:290`](../../../src/main/transcriptPostProcessor.ts)):
```ts
const SENTENCE_END_RE = /[.!?。？！]\s*$/
function shouldFinalizeSourceTurn(text) {
  return text.length >= STT_LIVE_SENTENCE_MAX_CHARS || SENTENCE_END_RE.test(text)
}
```
The active turn finalizes the instant the accumulated buffer ends with `.`, `!`, or `?`.

**Bug 1 — "Opus 4.7" splits into "Opus 4" + "7":** STT emits fragments incrementally. When the buffer momentarily reads `"...Opus 4."` (the period of `4.7` arrives before the `7`), `SENTENCE_END_RE` matches and the turn finalizes immediately. The `"7"` then arrives as a fresh fragment and starts a new turn. The decimal/version number is severed. The regex cannot distinguish a decimal point from a sentence-ending period, and even a smarter regex can't help because at the instant of the check, the `7` hasn't arrived yet — this is fundamentally a timing problem requiring a brief look-ahead delay.

**Bug 2 — a lone "?" takes its own line:** When the active turn finalizes on a timeout (e.g., `"what is this"` with no terminal punctuation yet, finalized after the 3.2s idle timer), and the `"?"` is then committed by STT as a separate fragment, it arrives with no active turn. It starts a brand-new turn containing only `"?"`, which `SENTENCE_END_RE` immediately finalizes — producing a one-character sentence on its own line.

Both hurt the core live-feed experience, which is the app's primary surface. The fix is surgical: smarter classification + a small grace delay for ambiguous endings + merge-back of trailing punctuation.

## Success criteria

1. **Decimal preserved:** Speaking "we use Opus 4.7" produces a single sentence containing `Opus 4.7`, not two turns split at `Opus 4`.
2. **Multi-dot decimals:** "version 3.14.159" stays in one turn.
3. **Real numeric sentence end still finalizes:** "I scored 95." finalizes as one sentence within the soft-grace window (~700 ms) — slightly later than before, but as a single correct sentence.
4. **Standalone "?" merges back:** When `"?"` arrives shortly after a turn finalized as `"what is this"`, the displayed and persisted sentence becomes `"what is this?"` — the `?` does not occupy its own line.
5. **Standalone "?" with no recent turn is dropped:** A lone `?` arriving with no finalized turn within the merge window does not create a one-character line (it is discarded).
6. **Hard enders unchanged latency:** `?`, `!`, `。`, `？`, `！`, and ordinary sentence-ending periods (not preceded by a digit, not an abbreviation, not ellipsis) finalize immediately, exactly as today. No added latency for the common case.
7. **Abbreviations don't split (common set):** "I met Dr. Kim" and "the U.S. economy" don't finalize mid-sentence at the abbreviation period (they wait the grace window; if a real sentence continues, fragments join).
8. **Memory fidelity:** When a `?` merges back into a finalized turn, the persisted `segments.source_text` is updated to match the displayed text, and the (now stale) translation is regenerated to include the `?`.
9. **Translation correctness:** Merged-back punctuation triggers a re-translation of the affected turn (the previous translation may have lacked the `?`).
10. **No regression to existing behavior:** Existing sentence grouping, auto-scroll, glossary normalization, and translation routing all continue to work. `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all clean.
11. **Tunable via env:** `STT_LIVE_SOFT_END_GRACE_MS` (default 700) and `STT_PUNCT_MERGE_WINDOW_MS` (default 1500) are env-overridable like the existing STT timing constants.

## In scope

### Sentence-end classifier

- New pure function `classifySentenceEnd(text: string): 'hard' | 'soft' | 'none'`, exported for unit testing.
  - `none` — text does not end with sentence-ending punctuation.
  - `hard` — ends with `?`, `!`, `。`, `？`, `！`, OR with a period that is unambiguously a sentence end.
  - `soft` — ends with a period that might NOT be a sentence end:
    - digit immediately before the period (`\d\.$`) → decimal/version
    - ellipsis (`\.\.+$`)
    - the token before the period is a known abbreviation or a single letter (`U.`, `e.`, `Mr.`, `Dr.`, `vs.`, `etc.`, `e.g.`, `i.e.`, `a.m.`, `p.m.`, `U.S.`, `U.K.`, `No.`, `Inc.`, `Ltd.`, `Jr.`, `Sr.`, `St.`)
- A modest abbreviation `Set` constant. Tunable; not exhaustive. Unknown abbreviations fall through to `hard` and merely finalize ~700 ms later via the soft path if they were actually soft — acceptable.

### Soft-grace finalization

- `shouldFinalizeSourceTurn` is replaced by classifier-driven logic in `emitSourceFragment`:
  - `text.length >= STT_LIVE_SENTENCE_MAX_CHARS` → finalize immediately (unchanged).
  - `classifySentenceEnd(text) === 'hard'` → finalize immediately (unchanged behavior for the common case).
  - `=== 'soft'` → do NOT finalize now; schedule finalization with the short grace delay `STT_LIVE_SOFT_END_GRACE_MS` (default 700 ms). If a trailing fragment arrives before the timer fires, it joins and the turn is re-classified.
  - `=== 'none'` → schedule finalization with the existing idle delay (`sourceFinalizeDelayMs`), unchanged.
- `scheduleSourceFinalization(active, overrideDelayMs?)` gains an optional explicit-delay parameter; soft endings pass `STT_LIVE_SOFT_END_GRACE_MS`.

### Standalone-punctuation merge-back

- New module state: `lastFinalizedTurn: { id, text, hints, createdAtMs, finalizedAtMs } | null`, set in `finalizeActiveSourceTurn`.
- New constant `PUNCT_ONLY_RE = /^[.!?。？！,;:、，；：…]+$/`.
- In `emitSourceFragment`, before starting a new turn: if `activeSourceTurn` is null AND the incoming `fragment` matches `PUNCT_ONLY_RE`:
  - If `lastFinalizedTurn` exists and `Date.now() - lastFinalizedTurn.finalizedAtMs < STT_PUNCT_MERGE_WINDOW_MS` (default 1500 ms):
    - Append the punctuation to `lastFinalizedTurn.text` via `joinSourceFragments`.
    - `emitSourcePatch(lastFinalizedTurn.id, newText)` — patch the live feed.
    - `notifySourceTextUpdate(lastFinalizedTurn.id, newText)` — update the persisted segment.
    - Re-translate the turn (the prior translation may lack the punctuation).
    - Return without starting a new turn.
  - Else: discard the stray punctuation (return without creating a turn).

### Memory repository addition

- New `MemoryRepository.updateSourceText(id: string, text: string): void` — mirrors the existing `updateTranslation` pattern (`UPDATE segments SET source_text = ? WHERE id = ?`).
- New `transcriptHook.notifySourceTextUpdate(id, text)` — guards on repo presence, calls `repo.updateSourceText`. Adds `updateSourceText` to the hook's `Repo` Pick type.

### Config constants

- `STT_LIVE_SOFT_END_GRACE_MS` (default 700) — grace window for soft endings.
- `STT_PUNCT_MERGE_WINDOW_MS` (default 1500) — merge-back window for trailing punctuation.
- Both read from `process.env` with numeric fallback, matching the existing constant style at the top of `transcriptPostProcessor.ts`.

## Out of scope (deferred)

- Changing the STT proxy / OpenAI Realtime turn-detection (server-side VAD). This stream only post-processes the committed fragments.
- LLM-based sentence segmentation (cost + latency).
- A comprehensive abbreviation dictionary or locale-specific abbreviation handling. v1 ships a modest English set; unknown abbreviations just finalize ~700 ms later. Expanded dictionaries are v2.
- Re-embedding a segment whose source text changed by a merge-back. The change is typically a single punctuation char and does not meaningfully alter the embedding; re-embedding on text update is a v2 nicety.
- Renderer-side display changes. Source text and turn IDs are unchanged in shape; only boundaries improve. Auto-scroll, typewriter, columns untouched.
- Translation prompt changes. Merged-back turns simply re-run the existing translation path.
- Korean/Japanese/Chinese decimal or abbreviation conventions beyond what the digit-before-period rule already covers (CJK numerals are rare in STT output here).
- Handling mid-sentence ambiguous punctuation other than the trailing position (we only classify the END of the buffer, as today).

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Classification model | 3-state (`hard`/`soft`/`none`) pure function | Separates "finalize now" from "wait briefly" from "keep accumulating." Pure → trivially unit-testable, which matters in a high-risk area. |
| Decimal handling | digit-before-period → `soft` + grace delay | The `7` of `4.7` hasn't arrived when `4.` is seen; only a brief look-ahead delay can fix it. A regex alone cannot. |
| Soft grace duration | 700 ms default, env-tunable | Long enough for the next STT fragment to arrive (typical inter-fragment gap is < 500 ms), short enough to feel immediate. Tunable if real-world testing wants different. |
| Hard-ender latency | Unchanged (immediate) | The overwhelming majority of sentence ends are hard; preserving zero-latency finalization keeps the live feel. |
| Standalone punctuation | Merge back into last finalized turn within a window | Semantically correct: the `?` belongs to the previous sentence. Window bounds the "how late can it arrive" question. |
| Merge window | 1500 ms default, env-tunable | STT trailing-punctuation commits arrive within ~1 s in practice; 1.5 s gives margin without risking attaching to a truly unrelated later utterance. |
| Stray punctuation with no recent turn | Discard | A lone `?` with no antecedent sentence is meaningless; dropping it is strictly better than a one-char line. |
| Memory update path | New `updateSourceText` repo method + `notifySourceTextUpdate` hook | `notifyTurnFinalized` only inserts; merge-back needs an update. Mirrors the existing `updateTranslation` pattern exactly. Small, low-risk. |
| Re-translation on merge | Re-run existing translation path with version bump | The previous translation may lack the `?`; the existing `scheduleTranslation` + version mechanism already handles stale-translation suppression. |
| Abbreviation set | Modest hardcoded English set + single-letter heuristic | Covers the common cases (`Mr.`, `U.S.`, `e.g.`) cheaply. Unknown ones just get the 700 ms soft delay — graceful degradation, not breakage. |
| Re-embedding on text change | Not in v1 | A one-punctuation delta doesn't change retrieval. Avoids touching the embedding queue from the post-processor. |
| Config | Two new env-tunable constants | Matches existing `STT_LIVE_SENTENCE_*` constant convention; lets the user tune timing without a rebuild. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Soft delay adds latency to legitimate numeric sentence ends ("I scored 95.") | 700 ms is barely perceptible in a live feed that already debounces. Env-tunable down if desired. |
| Numbered list items ("5. First, ...") get merged across the period | Acceptable edge case — rare in spoken meetings; the grace window merges them, which is usually the right call for speech anyway ("five first" reads as continuous). Documented. |
| Merge-back attaches `?` to the wrong (earlier) sentence if a new utterance started | Guard: merge-back only fires when `activeSourceTurn` is null (no in-progress turn) AND within 1.5 s. A new utterance creates an active turn, so the punctuation appends to *that* instead via the normal path. |
| Memory update races with embedding generation | `updateSourceText` is a plain SQL UPDATE; embedding for the original text may already be queued. v1 accepts the tiny staleness (one punctuation char). Documented as out-of-scope for re-embedding. |
| Re-translation of merged turn races with an in-flight translation | Existing `translationVersion` + `translationVersionsById` mechanism suppresses stale results. The merge bumps the version. |
| High-risk area (CLAUDE.md) — subtle regressions in grouping | TDD: `classifySentenceEnd` gets exhaustive pure tests; merge-back + soft-grace get fake-timer integration tests; existing `memory-postprocessor-regression.test.ts` must stay green. |
| `lastFinalizedTurn` leaks across meetings | Cleared in `resetTranscriptPostProcessor` (the existing reset path used between sessions). Add the reset. |
| Classifier mis-flags a real abbreviation-ended sentence as soft forever | Soft only *delays* by 700 ms; it never prevents finalization. Worst case is a slightly late finalize. |
| `\d\.$` also matches "Step 1." style enumerations | Same as numbered-list case; grace-merges, acceptable. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` shows `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` clean. `npm run build` clean (touches `src/main/**`).
3. **Manual smoke (deferred to user):**
   - Speak "we use Opus 4.7 in production" → confirm one turn with `Opus 4.7` intact.
   - Speak a question and let the `?` land slightly late → confirm it joins the sentence, no lone `?` line.
   - Speak "I scored 95." → confirm single sentence, finalizes within ~1 s.
   - Speak "I met Dr. Kim yesterday" → confirm no split at `Dr.`.
   - Normal sentences end with no perceptible added latency.
   - Open the meeting in Memory Library → confirm persisted transcript matches the displayed (merged) text.

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `src/main/transcriptPostProcessor.ts` | Modify | `classifySentenceEnd`, soft-grace scheduling, merge-back, `lastFinalizedTurn` state, two new constants, reset cleanup |
| `src/main/memory/repository.ts` | Modify | New `updateSourceText(id, text)` |
| `src/main/memory/transcriptHook.ts` | Modify | New `notifySourceTextUpdate`; add `updateSourceText` to `Repo` Pick |
| `src/test/stt-sentence-boundary.test.ts` | Create | Pure classifier tests + fake-timer integration tests (soft grace, merge-back) |
| `src/test/memory-postprocessor-regression.test.ts` | Modify (if needed) | Ensure existing grouping assertions still hold; add merge-back regression |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Should the soft grace delay be different for abbreviations vs decimals?** v1: one shared `STT_LIVE_SOFT_END_GRACE_MS`. Splitting them is unnecessary precision.
- **Should merge-back also handle a trailing word fragment (not just punctuation), e.g., STT committing the last word late?** No — only punctuation-only fragments. Late word fragments are a different, riskier problem (could attach unrelated speech). Out of scope.
- **Should we re-embed on `updateSourceText`?** No (v1). One punctuation char doesn't shift the embedding.
- **What if `STT_LIVE_SOFT_END_GRACE_MS` is set to 0?** Then soft behaves like hard (immediate). Valid escape hatch for users who prefer the old behavior.
- **Korean sentence enders (`다.`, `요.`)** — these end with a period preceded by a Hangul char, not a digit, so they classify as `hard` and finalize immediately. Correct.

## Self-review notes

The first pass tried to fix Bug 1 purely with a smarter regex (negative lookbehind for digits). That fails because at the moment `"Opus 4."` is evaluated, the `7` hasn't been received — no regex over the current buffer can know more text is coming. The fix has to introduce a short time delay (the soft-grace window) to allow the look-ahead. This reframing — "the period is *ambiguous*, wait briefly" — is the core insight and drove the 3-state classifier design.

For Bug 2, an earlier idea was to buffer the stray `?` and prepend it to the *next* fragment. That misplaces it at the start of the following sentence. Merge-back into the *previous* turn is the semantically correct direction, which is why the small `updateSourceText` memory path is worth adding rather than avoided.

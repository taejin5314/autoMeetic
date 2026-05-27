# STT Sentence Boundary Fix — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (Windows better-sqlite3 ABI shim + `EBUSY` `npm test` quirk). **This touches a CLAUDE.md high-risk area (live feed sentence grouping) — TDD discipline is mandatory.**

**Goal:** Fix two live-transcription defects in `transcriptPostProcessor.ts`: (1) "Opus 4.7" splitting at "Opus 4" because the decimal period is treated as a sentence end, and (2) a lone "?" occupying its own line because trailing punctuation forms a standalone turn.

**Architecture:** Replace the single `SENTENCE_END_RE` finalization check with a 3-state `classifySentenceEnd` (`hard`/`soft`/`none`). Hard enders finalize immediately (unchanged). Soft enders (digit-period, ellipsis, abbreviations) schedule a short grace timer so trailing fragments can join. Standalone-punctuation fragments merge back into the last finalized turn within a window, updating the live feed + persisted segment + translation.

**Tech stack:** TypeScript strict (no `any`), vitest (with `vi.useFakeTimers()` for timer paths), better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-05-27-stt-sentence-boundary-design.md`

**Scope reminder (do NOT exceed):** No STT proxy / OpenAI turn-detection changes. No LLM segmentation. No large abbreviation dictionary. No re-embedding on text update. No renderer display changes. No translation prompt changes. Only the post-processor + a small memory `updateSourceText` path.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/transcriptPostProcessor.ts` | Modify | `classifySentenceEnd`, soft-grace scheduling, merge-back, `lastFinalizedTurn`, 2 new constants, reset cleanup |
| `src/main/memory/repository.ts` | Modify | New `updateSourceText(id, text)` |
| `src/main/memory/transcriptHook.ts` | Modify | New `notifySourceTextUpdate`; expand `Repo` Pick |
| `src/test/stt-sentence-boundary.test.ts` | Create | Classifier pure tests + fake-timer integration tests |
| `src/test/memory-postprocessor-regression.test.ts` | Modify (if needed) | Keep existing grouping green; add merge-back regression |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — Sentence-end classifier + soft-grace finalization (TDD)

### Task 1.1 — Export classifier with pure tests

**Files:** `src/main/transcriptPostProcessor.ts`, `src/test/stt-sentence-boundary.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/stt-sentence-boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifySentenceEnd } from '../main/transcriptPostProcessor'

describe('classifySentenceEnd', () => {
  it('returns none when no terminal punctuation', () => {
    expect(classifySentenceEnd('we use Opus 4')).toBe('none')
    expect(classifySentenceEnd('hello world')).toBe('none')
    expect(classifySentenceEnd('')).toBe('none')
  })

  it('returns hard for ? ! and CJK enders', () => {
    expect(classifySentenceEnd('what is this?')).toBe('hard')
    expect(classifySentenceEnd('amazing!')).toBe('hard')
    expect(classifySentenceEnd('맞아요。')).toBe('hard')
    expect(classifySentenceEnd('そうですか？')).toBe('hard')
    expect(classifySentenceEnd('すごい！')).toBe('hard')
  })

  it('returns hard for ordinary sentence-ending period', () => {
    expect(classifySentenceEnd('I agree.')).toBe('hard')
    expect(classifySentenceEnd('이것은 문장입니다.')).toBe('hard')
    expect(classifySentenceEnd('Let us begin.')).toBe('hard')
  })

  it('returns soft for digit-before-period (decimal/version)', () => {
    expect(classifySentenceEnd('we use Opus 4.')).toBe('soft')
    expect(classifySentenceEnd('pi is 3.')).toBe('soft')
    expect(classifySentenceEnd('version 3.14.')).toBe('soft')
  })

  it('returns soft for ellipsis', () => {
    expect(classifySentenceEnd('well...')).toBe('soft')
    expect(classifySentenceEnd('hmm..')).toBe('soft')
  })

  it('returns soft for common abbreviations', () => {
    expect(classifySentenceEnd('I met Dr.')).toBe('soft')
    expect(classifySentenceEnd('the U.S.')).toBe('soft')
    expect(classifySentenceEnd('e.g.')).toBe('soft')
    expect(classifySentenceEnd('etc.')).toBe('soft')
    expect(classifySentenceEnd('Mr.')).toBe('soft')
  })

  it('returns soft for single-letter-before-period (initialism in progress)', () => {
    expect(classifySentenceEnd('U.')).toBe('soft')
    expect(classifySentenceEnd('the A.')).toBe('soft')
  })

  it('ignores trailing whitespace', () => {
    expect(classifySentenceEnd('Opus 4.   ')).toBe('soft')
    expect(classifySentenceEnd('done.  ')).toBe('hard')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/stt-sentence-boundary.test.ts
```

Expect FAIL — `classifySentenceEnd` not exported / doesn't exist.

- [ ] **Step 3: Implement in `src/main/transcriptPostProcessor.ts`**

Add near the existing regex constants (after `SENTENCE_END_RE`):

```ts
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc',
  'no', 'inc', 'ltd', 'co', 'corp', 'gen', 'sen', 'rep',
  'a.m', 'p.m', 'i.e', 'e.g', 'u.s', 'u.k',
])

export type SentenceEnd = 'hard' | 'soft' | 'none'

export function classifySentenceEnd(text: string): SentenceEnd {
  const t = text.replace(/\s+$/, '')
  const last = t.at(-1)
  if (!last || !/[.!?。？！]/.test(last)) return 'none'
  if (last !== '.') return 'hard'
  if (/\d\.$/.test(t)) return 'soft'
  if (/\.\.+$/.test(t)) return 'soft'
  const m = t.match(/([A-Za-z][A-Za-z.]*)\.$/)
  if (m) {
    const word = m[1].toLowerCase()
    const bare = word.replace(/\./g, '')
    if (ABBREVIATIONS.has(word) || bare.length === 1) return 'soft'
  }
  return 'hard'
}
```

Note: keep `SENTENCE_END_RE` for now (still used by `isLikelyIncompleteSource`); the finalization gate switches to the classifier in Task 1.2.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/stt-sentence-boundary.test.ts
npm run typecheck
npm run lint
git add src/main/transcriptPostProcessor.ts src/test/stt-sentence-boundary.test.ts
git commit -m "feat(stt): add 3-state classifySentenceEnd (hard/soft/none)"
```

---

### Task 1.2 — Soft-grace finalization wiring (TDD)

**Files:** `src/main/transcriptPostProcessor.ts`, `src/test/stt-sentence-boundary.test.ts`

- [ ] **Step 1: Add the soft-grace constant**

Near the other `STT_LIVE_*` constants at the top of the file:

```ts
const STT_LIVE_SOFT_END_GRACE_MS = Number(process.env.STT_LIVE_SOFT_END_GRACE_MS ?? 700)
```

- [ ] **Step 2: Update `scheduleSourceFinalization` to accept an optional explicit delay**

```ts
function scheduleSourceFinalization(active: ActiveSourceTurn, overrideDelayMs?: number): void {
  if (active.finalizeTimer) clearTimeout(active.finalizeTimer)
  const delay = overrideDelayMs ?? sourceFinalizeDelayMs(active.text)
  active.finalizeTimer = setTimeout(() => {
    if (activeSourceTurn?.id !== active.id) return
    finalizeActiveSourceTurn({ translateImmediately: true })
  }, delay)
}
```

- [ ] **Step 3: Replace the finalize gate in `emitSourceFragment`**

Currently:
```ts
if (shouldFinalizeSourceTurn(active.text)) {
  finalizeActiveSourceTurn({ translateImmediately: true })
  return
}
scheduleSourceFinalization(active)
scheduleTranslation(active, STT_TRANSLATION_DEBOUNCE_MS)
```

Replace with:
```ts
const ending = classifySentenceEnd(active.text)
if (active.text.length >= STT_LIVE_SENTENCE_MAX_CHARS || ending === 'hard') {
  finalizeActiveSourceTurn({ translateImmediately: true })
  return
}
scheduleSourceFinalization(active, ending === 'soft' ? STT_LIVE_SOFT_END_GRACE_MS : undefined)
scheduleTranslation(active, STT_TRANSLATION_DEBOUNCE_MS)
```

Remove the now-unused `shouldFinalizeSourceTurn` function (it was only called here). Keep `SENTENCE_END_RE` (still referenced by `isLikelyIncompleteSource`).

- [ ] **Step 4: Add fake-timer integration tests**

Append to `src/test/stt-sentence-boundary.test.ts`. Use the module's public entry (`enqueueRoughTranscript`) + a transcript listener, with `vi.useFakeTimers()`. Match the harness style already used in `memory-postprocessor-regression.test.ts` (inspect it first for how it captures emitted turns and resets module state).

```ts
import { afterEach, beforeEach, vi } from 'vitest'
import {
  enqueueRoughTranscript,
  resetTranscriptPostProcessor,
} from '../main/transcriptPostProcessor'
// + whatever the regression test uses to subscribe to emitted source turns/patches

describe('soft-grace finalization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetTranscriptPostProcessor() // ensure clean module state
  })
  afterEach(() => {
    vi.useRealTimers()
    resetTranscriptPostProcessor()
  })

  it('does not split a decimal: "Opus 4" + "." + "7" stays one turn', () => {
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }
    enqueueRoughTranscript('we use Opus 4', hints)
    enqueueRoughTranscript('.', hints)
    // soft pending — advance less than grace, then the trailing digit arrives
    vi.advanceTimersByTime(300)
    enqueueRoughTranscript('7 in production.', hints)
    // now ends with a hard period (not digit-before) → finalize path
    vi.advanceTimersByTime(STT_LIVE_SOFT_END_GRACE_MS)
    // assert the finalized turn text contains "Opus 4.7" as one unit
    // (use the test's captured-turns helper)
  })

  it('finalizes a real numeric sentence after the grace window', () => {
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }
    enqueueRoughTranscript('I scored 95.', hints)
    // soft → not finalized immediately
    vi.advanceTimersByTime(STT_LIVE_SOFT_END_GRACE_MS + 50)
    // assert finalized as single turn "I scored 95."
  })
})
```

(Fill in the assertions using whatever capture mechanism `memory-postprocessor-regression.test.ts` already establishes. If `resetTranscriptPostProcessor` doesn't exist yet, check the actual reset export name — the file has a reset/clear path used between sessions; reuse it. If none is exported, export a test-only reset.)

- [ ] **Step 5: Verify + commit**

```bash
npx vitest run src/test/stt-sentence-boundary.test.ts
npm run typecheck
npm run lint
git add src/main/transcriptPostProcessor.ts src/test/stt-sentence-boundary.test.ts
git commit -m "feat(stt): soft endings wait a grace window before finalizing"
```

---

### Task 1.3 — Verify Phase 1

```bash
npm run verify:phase 1
```

Expected: `VERDICT: ✅ Phase 1 verified`. Update `HANDOFF.md` Phase 1 row.

---

## Phase 2 — Standalone-punctuation merge-back (TDD)

### Task 2.1 — Memory `updateSourceText` + hook (TDD)

**Files:** `src/main/memory/repository.ts`, `src/main/memory/transcriptHook.ts`, `src/test/memory-postprocessor-regression.test.ts` (or a small repo test)

- [ ] **Step 1: Add `updateSourceText` to `MemoryRepository`**

Next to `updateTranslation`:

```ts
updateSourceText(id: string, text: string): void {
  this.db.prepare('UPDATE segments SET source_text = ? WHERE id = ?').run(text, id)
}
```

- [ ] **Step 2: Add `notifySourceTextUpdate` to `transcriptHook.ts`**

Expand the `Repo` Pick type to include `updateSourceText`, and add:

```ts
export function notifySourceTextUpdate(id: string, text: string): void {
  if (!repo) return
  repo.updateSourceText(id, text)
}
```

- [ ] **Step 3: Add a focused repo test** (extend an existing memory repo test file or `memory-postprocessor-regression.test.ts`)

```ts
it('updateSourceText updates a segment in place', () => {
  // insert a meeting + segment via repo, then updateSourceText, then read back
  // assert source_text changed and other fields preserved
})
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/memory-postprocessor-regression.test.ts
npm run typecheck
npm run lint
git add src/main/memory/repository.ts src/main/memory/transcriptHook.ts src/test/
git commit -m "feat(stt): add updateSourceText repo method + notifySourceTextUpdate hook"
```

---

### Task 2.2 — Merge-back logic (TDD)

**Files:** `src/main/transcriptPostProcessor.ts`, `src/test/stt-sentence-boundary.test.ts`

- [ ] **Step 1: Add the constant + state + regex**

Constants block:
```ts
const STT_PUNCT_MERGE_WINDOW_MS = Number(process.env.STT_PUNCT_MERGE_WINDOW_MS ?? 1500)
const PUNCT_ONLY_RE = /^[.!?。？！,;:、，；：…]+$/
```

Module state (near `activeSourceTurn`):
```ts
let lastFinalizedTurn: {
  id: string
  text: string
  hints: LanguageHints
  createdAtMs: number
  finalizedAtMs: number
} | null = null
```

- [ ] **Step 2: Record `lastFinalizedTurn` in `finalizeActiveSourceTurn`**

At the end of `finalizeActiveSourceTurn` (after `notifyTurnFinalized`):
```ts
lastFinalizedTurn = {
  id: active.id,
  text: active.text,
  hints: active.hints,
  createdAtMs: active.createdAtMs,
  finalizedAtMs: Date.now(),
}
```

- [ ] **Step 3: Add the merge-back branch at the top of `emitSourceFragment`**

After `const fragment = text.trim(); if (!fragment) return` and BEFORE the language-hint check / `startActiveSourceTurn`:

```ts
if (!activeSourceTurn && PUNCT_ONLY_RE.test(fragment)) {
  if (
    lastFinalizedTurn &&
    Date.now() - lastFinalizedTurn.finalizedAtMs < STT_PUNCT_MERGE_WINDOW_MS
  ) {
    const merged = joinSourceFragments(lastFinalizedTurn.text, fragment)
    lastFinalizedTurn.text = merged
    emitSourcePatch(lastFinalizedTurn.id, merged)
    notifySourceTextUpdate(lastFinalizedTurn.id, merged)
    scheduleMergedTranslation(lastFinalizedTurn)
  }
  return // stray punctuation with no recent turn → discard
}
```

`scheduleMergedTranslation` re-runs translation for the finalized turn. Simplest: reconstruct a minimal `ActiveSourceTurn`-like object isn't needed; instead push directly to the translation queue with a fresh version:

```ts
function scheduleMergedTranslation(turn: { id: string; text: string; hints: LanguageHints }): void {
  const wantsTranslation =
    turn.hints.targetLanguage !== 'off' &&
    turn.hints.targetLanguage !== turn.hints.sourceLanguageHint
  if (!wantsTranslation) return
  const version = (translationVersionsById.get(turn.id) ?? 0) + 1
  translationVersionsById.set(turn.id, version)
  translationQueue.push({ id: turn.id, text: turn.text, hints: turn.hints, version })
  void drainTranslationQueue()
}
```

Import `notifySourceTextUpdate` from `./memory/transcriptHook`.

- [ ] **Step 4: Clear `lastFinalizedTurn` in the reset path**

Find the existing reset/clear function (the one that clears `coalesceBuffer`, `translationQueue`, `activeSourceTurn` between sessions) and add `lastFinalizedTurn = null`.

- [ ] **Step 5: Add merge-back integration tests**

Append to `src/test/stt-sentence-boundary.test.ts`:

```ts
describe('standalone punctuation merge-back', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetTranscriptPostProcessor()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetTranscriptPostProcessor()
  })

  it('merges a late "?" into the just-finalized turn', () => {
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }
    enqueueRoughTranscript('what is this', hints)
    // force finalize via idle timeout
    vi.advanceTimersByTime(6000)
    // "?" arrives shortly after
    enqueueRoughTranscript('?', hints)
    // assert: no new turn created; last turn text is now "what is this?"
    // (use captured patch events)
  })

  it('discards a stray "?" with no recent finalized turn', () => {
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }
    enqueueRoughTranscript('?', hints)
    // assert: no turn emitted
  })

  it('does not merge "?" when an active turn is in progress', () => {
    const hints = { sourceLanguageHint: 'en', targetLanguage: 'off' as const }
    enqueueRoughTranscript('hello', hints)
    enqueueRoughTranscript('?', hints)
    // active turn exists → "?" appends to it normally and finalizes as "hello?"
  })
})
```

- [ ] **Step 6: Verify + commit**

```bash
npx vitest run src/test/stt-sentence-boundary.test.ts
npm run typecheck
npm run lint
git add src/main/transcriptPostProcessor.ts src/test/stt-sentence-boundary.test.ts
git commit -m "feat(stt): merge standalone trailing punctuation into previous turn"
```

---

### Task 2.3 — Verify Phase 2

```bash
npm run verify:phase 2
```

Expected: `VERDICT: ✅ Phase 2 verified`. Update `HANDOFF.md` Phase 2 row.

---

## Phase 3 — Regression + handoff + push

### Task 3.1 — Full regression

```bash
npm run verify
npm run build
```

- Confirm `memory-postprocessor-regression.test.ts` still green (sentence grouping unchanged for the common case).
- Document Windows `EBUSY` if `npm test` blocked (use `npx vitest run`).
- `tsc -b` preexisting build issue (memory/repository.ts `lookupSearchHits`) is NOT this stream's concern.

### Task 3.2 — Update `HANDOFF.md`

- [ ] Move "App i18n" (and any other completed stream) to a Completed section if not already.
- [ ] Insert new "Next active stream" block + status table with 3 rows ⏳ PENDING (replaced phase by phase).

### Task 3.3 — Manual smoke (deferred to user)

Document the smoke checklist from the spec:
- "Opus 4.7" stays intact
- Late "?" merges, no lone-`?` line
- "I scored 95." finalizes within ~1 s as one sentence
- "Dr. Kim" / "U.S." don't split
- Normal sentences have no perceptible added latency
- Persisted transcript matches displayed merged text

### Task 3.4 — Push

```bash
git push origin master
```

Mark Phase 3 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [ ] All 3 phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output.
- [ ] `classifySentenceEnd` exhaustively unit-tested (none/hard/soft, decimals, ellipsis, abbreviations, single-letter, whitespace).
- [ ] Soft endings delay; hard endings keep zero added latency.
- [ ] Decimal "Opus 4.7" no longer splits.
- [ ] Late "?" merges into previous turn (feed + memory + translation).
- [ ] Stray "?" with no antecedent is discarded, not shown.
- [ ] `lastFinalizedTurn` cleared on reset (no cross-session leak).
- [ ] Existing regression tests green.
- [ ] No deviation from spec's "In scope" / "Out of scope".

## Open questions (deferred to v2)

- Larger / locale-specific abbreviation dictionaries
- Re-embedding a segment after `updateSourceText`
- Late *word* fragment merge-back (not just punctuation)
- Separate grace durations for decimals vs abbreviations
- Server-side (proxy) turn-detection tuning

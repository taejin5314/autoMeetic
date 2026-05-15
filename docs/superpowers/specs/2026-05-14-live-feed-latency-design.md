---
title: Live Feed Latency Reduction
date: 2026-05-14
status: design
---

# Live Feed Latency Reduction

## Problem

The live feed currently shows transcripts ~2.5-7 seconds after speech. Users want it closer to real-time. Acceptable tradeoff: lower output quality (raw STT punctuation, no speaker labels) in exchange for speed. The unit on screen should be roughly one completed sentence at a time.

Speaker A/B/Unknown classification is not yet accurate enough to be useful and is dropped from this iteration.

## Current Pipeline (Before)

```
STT delta stream
  → STT commit (sentence-end / 200 chars / 3000ms / 800ms quiet)  [sttService.ts]
  → Post-processor buffer (>= 60 chars + sentence-end, or 1200 chars, or 1000ms timer)  [transcriptPostProcessor.ts]
  → OpenAI gpt-4.1-mini: cleanup + speaker classification + translation  (~500-2000ms)
  → emit stt:processed
  → useFeedTypewriter reveals 1-2 chars/RAF  (~1s for 60-char Korean line)

End-to-end: ~2.5-7s. Chunks usually batch 2+ sentences.
```

## Target Pipeline (After)

```
STT delta stream
  → STT commit (unchanged thresholds; sentence-end already drives most commits)
  → Post-processor: no buffering (or 3-char floor), each commit flushed immediately
  → OpenAI lightweight model, translation-only prompt  (~300-500ms)
       - source text = raw STT (echoed through, not re-cleaned)
       - translation = LLM output
       - speakerId = 'unknown' (constant)
  → emit stt:processed
  → useFeedTypewriter reveals 5 chars/RAF (CJK) / 8 chars/RAF (Latin)  (~150-200ms for a typical line)

Target end-to-end: <1.5s P50, <2.5s P95.
```

Translation column stays synchronous (both source and translation appear together) — this is the user's explicit choice. Source is rendered as raw STT, but the LLM call is still on the critical path because we wait for translation.

## Components Changing

### `src/main/transcriptPostProcessor.ts`
- Remove the 60-char minimum / 1000ms buffering. Every `enqueueRoughTranscript` call flushes immediately (modulo serialization — see Ordering below).
- Minimum length floor (3 chars) to coalesce trivial utterances ("응", "ok") with the next commit. Below floor → keep buffered, do not call LLM.
- Simplify the LLM prompt:
  - Remove speaker classification rules.
  - Remove cleanup / punctuation rules.
  - Keep: translation when target language differs from source.
  - Output schema reduced to `{ "translation": "...", "sourceLanguage": "xx" }` (single turn per call, no `turns` array).
- Use the raw input text as `ProcessedTranscriptTurn.text` (do not take cleaned text from the LLM). This saves output tokens and preserves raw STT verbatim.
- `speakerId` always `'unknown'`, `speakerLabel` always `'Unknown'`.
- Default `STT_POSTPROCESS_MODEL` changed from `gpt-4.1-mini` to a lighter model (e.g. `gpt-4.1-nano`). Configurable via env var as today.
- When `targetLanguage === 'off'` or equals source: skip the LLM call entirely, emit a turn with `translation: null` immediately.

### `src/main/sttService.ts`
- No changes. Existing commit thresholds (sentence-end / 200 chars / 3000ms / 800ms quiet) already produce roughly sentence-level commits, and tightening them risks fragmenting mid-sentence.

### `src/renderer/feed/useFeedTypewriter.ts`
- `charsPerTickForLang`: `ko`/`ja`/`zh` → 5, others → 8 (up from 1 / 2).

### `src/renderer/App.tsx`
- Remove the `v4p-eyebrow` block (speaker label rule) from both source and translation columns. Since `speakerLabel` is always `'Unknown'`, rendering it adds visual noise without information.

### `src/main/stt/types.ts` (no change)
- `ProcessedTranscriptTurn.speakerId` / `speakerLabel` remain in the type. Downstream consumers (`actionItemService`, `whiteboardService`) read `formatTurnForDownstream` which uses `speakerLabel: text` — output stays well-formed with `Unknown:` prefix.

## Ordering

With per-commit flushing, multiple LLM calls could be in flight if STT commits faster than translation responds. Order must be preserved on screen.

**Decision: serialize the LLM calls in `transcriptPostProcessor`.** The next call does not start until the previous response is emitted (or fails). STT commits are typically ~1-2s apart and LLM responses are ~300-500ms, so the queue rarely backs up. If it does, queued items naturally batch into the next flush window — acceptable degradation.

Implementation: a single in-flight promise; new `enqueueRoughTranscript` calls during an in-flight call append to a pending queue (one slot deep, merging by joining with space if a second commit arrives during the first call).

## Out of Scope

- Speaker diarization (any form).
- Replacing the STT model or engine.
- UI layout or styling changes (other than removing the speaker eyebrow).
- Action items / whiteboard pipelines (continue to receive `formatTurnForDownstream` output unchanged).
- Caption overlay (uses `stt:partial` / `stt:committed`, unaffected).

## Tradeoffs (explicit)

**Losing:**
- LLM cleanup of punctuation, capitalization, filler.
- Speaker A/B/C labels in the feed.
- Possible minor translation quality drop from the lighter model.

**Gaining:**
- End-to-end latency ~2.5-7s → ~0.5-1.5s (P50 target).
- Chunks are roughly one sentence each, not multi-sentence batches.

**Cost:**
- API call count rises (one per sentence vs one per ~60-char batch). Lighter model offsets per-call cost.

## Success Criteria

**Primary — end-to-end latency:**
- From `stt:committed` emit to feed first typewriter tick: P50 < 1.5s, P95 < 2.5s.
- Measure with `console.time` markers or telemetry on `stt:committed` → `stt:processed` → first `advance-typing`.

**Secondary:**
- `tsc --noEmit` clean, `eslint` clean.
- Source and translation columns reveal in lockstep (both `typing: true` on arrival, both advance together as today).
- Mean chunk size ≤ ~2 sentences (`fullSource` split by sentence-end regex ≤ 2).
- Downstream agents (action items, whiteboard) receive identically-shaped input (`formatTurnForDownstream` unchanged).

**Failure modes / defenses:**
- Trivial utterances ("응", "ok") spamming the API → 3-char floor coalesces them.
- Out-of-order LLM responses → serialized calls (see Ordering).
- LLM failure → existing single retry + `fallbackTurn` (raw text, no translation) preserved.
- STT commit hits 200-char ceiling without sentence-end → that chunk goes through unchanged; one-sentence guarantee is best-effort.
- `targetLanguage === 'off'` → bypass LLM entirely, sub-100ms latency from STT commit to feed.

**One candidate evaluation time:** ~5 minutes (manual voice test + visual confirmation + dev console timing readout).

## Risks

- Lighter model translation quality is unknown until tested. If unacceptable, env var lets us roll back to `gpt-4.1-mini` without redeploy.
- Removing buffering means more frequent UI updates; React reducer cost rises but stays cheap given `MAX_ITEMS = 50` cap.
- Users who relied on speaker labels for context will lose them. Acceptable per requirement; can be re-added later when classification is reliable.

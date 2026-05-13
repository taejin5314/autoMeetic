# Whiteboard Agent 2-Stage Pipeline Design

**Date:** 2026-05-12
**Status:** Approved
**Goal:** Reduce whiteboard agent cost/latency while improving content quality (layout + relevance)

---

## Problem Statement

The whiteboard agent currently fires on nearly every transcript chunk (debounce 3s, cooldown 12s), calling GPT-4.1 each time with a large system prompt + canvas state + screenshot. This produces:

1. **Poor content judgment** — trivial or repetitive content gets visualized
2. **Layout degradation** — nodes pile up, overlap, and become unreadable
3. **High cost** — 10-15 GPT-4.1 calls per 5-minute meeting

## Success Criteria

- 5-minute meeting → 3-5 key nodes in a clean diagram (not 10+ cluttered nodes)
- Gatekeeper skip rate >= 50% (agent recognizes when NOT to update)
- Renderer calls <= 5 per 5-minute meeting
- Total API cost reduction ~70-80% vs current

---

## Architecture

### Current (1-stage)

```
Transcript → [debounce 3s / cooldown 12s] → GPT-4.1 (judge + render) → Canvas
```

### New (2-stage)

```
Transcript → [accumulation buffer ~30s / 200 words]
                → Stage 1: Gatekeeper (gpt-4.1-nano)
                    → "skip" → discard
                    → "update" + key_points → Stage 2: Renderer (gpt-4.1-mini) → Canvas
```

---

## Stage 1: Gatekeeper

**Model:** `gpt-4.1-nano`

**Input:**

- Accumulated transcript text (~30s worth)
- List of concepts already on the canvas (string array, for dedup)

**Output (structured JSON via `response_format`):**

Update case:

```json
{
  "action": "update",
  "key_points": [
    { "concept": "React Server Components", "relation": "replaces", "target": "SSR" },
    { "concept": "Streaming HTML", "relation": "enables", "target": "Progressive rendering" }
  ],
  "diagram_hint": "comparison"
}
```

Skip case:

```json
{
  "action": "skip",
  "reason": "filler and repetition of already-captured points"
}
```

**Prompt guidelines:**

- "In a 5-minute meeting, the final canvas should have 3-5 nodes. Be extremely selective."
- "Skip if the transcript only contains filler, self-corrections, repetition of existing points, or trivial commentary."
- "Extract only concepts with concrete meaning — named entities, decisions, comparisons, causal relationships."
- `diagram_hint` values: `comparison`, `flow`, `timeline`, `concept-map`, `hierarchy`

**Cost:** nano is ~1/30 the cost of gpt-4.1 per token. Skip responses use minimal output tokens.

---

## Stage 2: Renderer

**Model:** `gpt-4.1-mini` (downgraded from `gpt-4.1`)

**Input (changes from current):**

- ~~Raw transcript~~ → Gatekeeper's `key_points` array + `diagram_hint`
- Current canvas state (line-numbered, unchanged)
- Screenshot (when available, unchanged)
- History: reduced from last 4 turns to last 2 turns

**System prompt changes:**

- **Remove:** All transcript judgment/filtering instructions (gatekeeper handles this)
- **Keep:** Shape specs, layout rules, color rules, arrow rules
- **Add:** `diagram_hint` usage — "If hint is comparison, use 2-column layout; if flow, use left-to-right; if timeline, use horizontal timeline"
- **Strengthen:** Node limit from "8-10" → "5 max. When adding new points, consolidate or replace existing nodes."

**Tools:** Existing `whiteboard_apply` / `whiteboard_overwrite` — no changes.

---

## Accumulation Buffer

**Trigger conditions (OR):**

1. **Time-based:** 30 seconds since last gatekeeper call + buffer has text
2. **Volume-based:** Buffer has >= 200 words
3. **Sentence-complete:** Buffer has >= 100 words + sentence-ending punctuation detected

**Cooldowns:**

- Gatekeeper calls: minimum 15s apart
- Renderer calls: minimum 30s apart

**Implementation:**

- New `createGatekeeperQueue` wrapper function in `server/proxy.mjs`
- Handles buffer accumulation + trigger logic
- On trigger: calls gatekeeper → if "update", calls renderer
- Replaces existing `whiteboardQueue` variable

---

## File Changes

| File                            | Change                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/proxy.mjs`              | Add gatekeeper call function, refactor `runWhiteboardAgentProxy` into 2-stage pipeline, replace buffer/queue, update model constants                                            |
| `server/whiteboard-runtime.mjs` | Simplify `whiteboardSystemPrompt()` (remove transcript judgment, add diagram_hint, tighten node limit), update `buildWhiteboardAgentMessages()` input format (key_points based) |

**No changes to:**

- `src/` (frontend unchanged — server message format identical)
- Existing utils: `applyWhiteboardEditOperations`, `normalizeWhiteboardElements`, `formatLineNumberedWhiteboard`

## New Constants

```
GATEKEEPER_MODEL = process.env.GATEKEEPER_MODEL ?? 'gpt-4.1-nano'
RENDERER_MODEL = process.env.RENDERER_MODEL ?? 'gpt-4.1-mini'
BUFFER_MAX_WORDS = Number(process.env.WB_BUFFER_MAX_WORDS ?? 200)
BUFFER_MAX_MS = Number(process.env.WB_BUFFER_MAX_MS ?? 30000)
BUFFER_MIN_WORDS = Number(process.env.WB_BUFFER_MIN_WORDS ?? 100)
GATEKEEPER_COOLDOWN_MS = Number(process.env.WB_GATEKEEPER_COOLDOWN_MS ?? 15000)
RENDERER_COOLDOWN_MS = Number(process.env.WB_RENDERER_COOLDOWN_MS ?? 30000)
GATEKEEPER_ENABLED = process.env.GATEKEEPER_ENABLED !== 'false'
```

All constants overridable via environment variables for tuning.

## Rollback

- Set `GATEKEEPER_ENABLED=false` → bypasses gatekeeper, sends transcript directly to renderer
- Set `RENDERER_MODEL=gpt-4.1` → restores original model for renderer

---

## Test Strategy

1. **Manual test:** Run app → play 5-minute video/audio → check console logs for gatekeeper skip/update ratio, check canvas node count
2. **Pass criteria:** Gatekeeper skip >= 50%, final canvas 3-5 nodes, renderer calls <= 5
3. **Key log points:** Each gatekeeper decision (skip/update + reason), each renderer call (input key_points count), final element count

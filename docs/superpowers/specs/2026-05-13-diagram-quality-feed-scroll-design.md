# Diagram Quality + Feed Auto-scroll Design

**Date**: 2026-05-13
**Status**: Final

## Problem Statement

Two independent issues affecting the live meeting experience:

1. **Whiteboard diagrams lack relationships and have poor layout** — nodes appear scattered without arrows; spacing is irregular with overlaps.
2. **Live feed does not auto-scroll to latest transcript** — new transcript items appear but the feed stays at the top, requiring manual scrolling.

## Scope

### In scope
- Fix feed auto-scroll bug (CSS/ref mismatch)
- Improve whiteboard renderer prompt with arrow-mandatory rules and few-shot examples per diagram type
- Apply identical prompt changes to both Electron (`src/main/whiteboard/prompt.ts`) and browser (`server/whiteboard-runtime.mjs`) pipelines

### Out of scope
- Model changes (staying on gpt-4.1-nano gatekeeper + gpt-4.1-mini renderer)
- Buffer timing changes
- Post-processing validation layer
- Gatekeeper prompt changes (gatekeeper is working correctly)
- UI/layout changes beyond the scroll fix

## Design

### Fix 1: Feed Auto-scroll

**Root cause**: `feedContainerRef` is attached to `<section class="panel-feed">` which has `overflow: hidden`. The actual scrollable element is the inner `.caption-feed-list` div (`overflow-y: auto`). The auto-scroll JS targets the wrong element.

**Change**: Move `feedContainerRef` from the `<section>` to the inner `.caption-feed-list` div. The scroll event listener and `scrollTop = scrollHeight` logic will then target the correct scrollable container.

**Files changed**:
| File | Change |
|---|---|
| `src/renderer/App.tsx` | Move `ref={feedContainerRef}` from `<section>` to `.caption-feed-list` div |

**Verification**: Run app, generate transcripts. Feed should auto-scroll to show latest item. Manual scroll up should pause auto-scroll; scrolling back to bottom should re-enable it.

### Fix 2: Diagram Quality — Few-shot Prompt Enhancement

**Root cause**: The renderer system prompt describes layout rules in prose but provides no concrete coordinate examples for complete diagrams. The model generates nodes but frequently omits arrows and uses inconsistent spacing.

**Changes**:

#### 2a. Arrow mandatory rule

Add to both system prompts, after existing arrow rules:

```
HARD RULE: Every key_point relationship MUST produce a labeled arrow connecting the concept node to the target node. A diagram with labeled nodes but no arrows is a failure — always include arrows showing relationships.
```

#### 2b. Few-shot examples per diagram type

Add one complete `whiteboard_apply` operations example for each of the 5 diagram types. Each example includes:
- 3 nodes with explicit coordinates, dimensions, labels, and colors
- 2-3 arrows with explicit endpoints and labels
- 1 viewport command

Example structure (flow type):
```json
{
  "operations": [
    {"type":"rectangle","id":"step-1","x":80,"y":200,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Input Data","fontSize":18}},
    {"type":"rectangle","id":"step-2","x":360,"y":200,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Process","fontSize":18}},
    {"type":"rectangle","id":"step-3","x":640,"y":200,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Output","fontSize":18}},
    {"type":"arrow","id":"flow-1-2","x":280,"y":235,"width":80,"height":0,"points":[[0,0],[80,0]],"label":{"text":"leads-to","fontSize":14}},
    {"type":"arrow","id":"flow-2-3","x":560,"y":235,"width":80,"height":0,"points":[[0,0],[80,0]],"label":{"text":"leads-to","fontSize":14}}
  ],
  "viewport":{"action":"scroll_to_content","focus_ids":["step-1","step-2","step-3"]}
}
```

All 5 diagram types (flow, comparison, concept-map, hierarchy, timeline) get a similar concrete example.

#### 2c. Files changed

| File | Change |
|---|---|
| `src/main/whiteboard/prompt.ts` | Add arrow hard rule + 5 few-shot examples to `whiteboardSystemPrompt()` |
| `server/whiteboard-runtime.mjs` | Add identical arrow hard rule + 5 few-shot examples to `whiteboardSystemPrompt()` |

Both files must stay in sync — the Electron pipeline uses the TypeScript version, the browser dev mode uses the JS version.

#### 2d. Token impact

Current system prompt: ~1200 tokens. After few-shot additions: ~1800 tokens (+600). On gpt-4.1-mini this adds negligible latency (input-only increase, output unchanged).

## Verification

1. **Feed scroll**: `tsc --noEmit` passes. Manual QA: run app, verify auto-scroll works.
2. **Diagram quality**: Run `scripts/simulate-whiteboard-agent.js` with a sample transcript. Verify output contains arrows between nodes and follows diagram type layout coordinates.

## Success Criteria

- Feed auto-scrolls to latest transcript item on every new committed segment
- Manual scroll up pauses auto-scroll; scroll back to bottom re-enables
- Whiteboard diagrams always contain arrows between related nodes
- Diagram layout follows the concrete coordinate patterns from few-shot examples
- Both Electron and browser pipelines produce consistent results

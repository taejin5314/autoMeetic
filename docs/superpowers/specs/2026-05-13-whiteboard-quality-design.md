# Whiteboard Diagram Quality Improvement — Design Spec

**Date**: 2026-05-13
**Status**: Draft
**Approach**: C — Gatekeeper + Renderer prompt improvements (model unchanged)

## Problem

Whiteboard diagrams are confusing:
1. **Labels too verbose** — raw transcript copied into node labels instead of abstract keywords
2. **No structural relationships** — nodes scattered without clear connections or hierarchy
3. **Layout has no pattern** — no consistent spatial organization matching the content type

## Goals

- Diagrams should read as keyword maps with clear relationships (mind-map style)
- Labels: 1-4 word abstract keywords, never transcript sentences
- Every key_point relationship visualized as a labeled arrow
- Layout follows a consistent spatial pattern per diagram type

## Non-Goals

- Model changes (stay on gpt-4.1-nano gatekeeper, gpt-4.1-mini renderer)
- Buffer/cooldown timing changes
- UI/frontend changes
- JSON schema structural changes (only `relation` field becomes enum)

## Design

### 1. Gatekeeper Prompt Enhancement (`server/proxy.mjs`)

#### 1a. Key point quality constraints

Add to `runGatekeeper()` system prompt, replacing the current "Key point extraction" section:

```
Key point extraction:
- concept: 1-4 word abstract keyword. NEVER copy transcript verbatim.
  Good: "Iran proposal", "survival odds", "US stance"
  Bad: "Most recent proposal from Iran is garbage"
- relation: choose the most fitting verb from the allowed set.
- target: 1-4 word abstract keyword, same rules as concept.
- If the transcript is about ONE topic, emit 1 key_point with the core idea.
- If comparing/contrasting, emit 2-3 key_points showing the relationship.
```

#### 1b. Relation enum constraint

Change JSON schema `relation` field from free text to enum:

```js
relation: {
  type: 'string',
  enum: ['causes', 'opposes', 'supports', 'leads-to', 'part-of', 'compares-to', 'defines', 'blocks']
}
```

### 2. Renderer Prompt Enhancement (`server/whiteboard-runtime.mjs`)

#### 2a. Diagram type layout patterns

Replace the 1-line diagram type guidelines in `whiteboardSystemPrompt()` with:

```
Diagram type guidelines (follow the spatial pattern strictly):

- comparison: 2-column layout.
  Left column x=100, right column x=550, y starts at 120.
  Central title at top center. Items vertically stacked in each column.

- flow: left-to-right chain.
  Start x=80, each node offset +220px horizontally. Arrows between each step.
  All nodes at same y=200 for a clean horizontal line.

- timeline: horizontal timeline.
  Baseline arrow at y=300 spanning full width.
  Events as nodes above/below the baseline, evenly spaced.

- concept-map: central hub with spokes.
  Central node at (400, 340). Related nodes arranged in a circle
  at radius ~220px. Arrows radiate from center to each spoke.

- hierarchy: top-down tree.
  Root at top center (400, 80). Children evenly spaced below,
  each level +160px down. Arrows from parent to children.
```

#### 2b. Relationship visualization instructions

Add after diagram type guidelines:

```
Relationship visualization:
- Each key_point has concept -> relation -> target.
  Draw an arrow FROM the concept node TO the target node.
  Use the relation as the arrow label (e.g., "opposes", "leads-to").
- If concept or target already exists on canvas, reuse that node -- do not duplicate.
```

#### 2c. Plan-then-draw instruction

Add after relationship visualization:

```
Before drawing, mentally plan:
1. List all unique nodes (deduplicate concept/target across key_points).
2. Assign each node a position following the diagram type pattern.
3. Then emit the whiteboard_apply call with all elements and arrows.
```

#### 2d. Raw transcript handling

Add for the empty-canvas bypass path (when no gatekeeper key_points):

```
When receiving raw transcript (no pre-filtered key points):
- Extract 2-5 abstract keywords from the transcript yourself.
- NEVER use transcript sentences as node labels.
- Choose the most fitting diagram type based on content.
```

### 3. Task Instruction Enhancement (`server/whiteboard-runtime.mjs`)

In `formatCurrentCanvasTask()`, add to the task text:

```
- Labels must be 1-4 word keywords -- never sentences or transcript quotes.
- Every relationship between key_points must be shown as a labeled arrow.
- Follow the diagram type layout pattern strictly.
```

## Files Changed

| File | What changes |
|------|-------------|
| `server/proxy.mjs` | Gatekeeper system prompt rewrite (key_point rules), relation enum in JSON schema |
| `server/whiteboard-runtime.mjs` | `whiteboardSystemPrompt()` diagram type guide + relationship + plan-then-draw + raw transcript handling; `formatCurrentCanvasTask()` task text additions |

## Verification

- Run `node server/proxy.mjs` — server starts without error
- Use `scripts/simulate-whiteboard-agent.js` (if applicable) or manual test with live meeting
- Visual check: diagram nodes have short keyword labels, arrows show relationships, layout follows spatial pattern

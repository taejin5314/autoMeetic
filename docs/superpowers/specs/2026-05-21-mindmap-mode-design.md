# Whiteboard Mind-Map Mode — Design Spec

**Date:** 2026-05-21
**Status:** Draft — pending implementation
**Positioning lever:** Adds a second whiteboard mode that produces a clean, tree-structured mind map of the meeting. The current freeform agent stays untouched; users explicitly opt in via a shelf-header toggle.

## One-line

When the user toggles the whiteboard shelf into "Mind map" mode, the LLM curates a single tree rooted at the meeting's central topic — adding branches and sub-branches as the conversation unfolds — and a deterministic radial layout engine renders it onto the existing Excalidraw canvas.

## Why this follow-up

Internet research (Meeting.ai, Miro AI mind maps, Mapify, Whimsical, NoteGPT) shows mind maps as the dominant pattern for "meeting → visual notes." autoMeetic's current freeform agent supports concept-map and hierarchy patterns but does not commit to a mind-map paradigm with proper radial layout, branch coloring, or additive growth semantics. Adding a dedicated Mind-map mode closes that gap without disturbing the existing freeform behavior.

## Success criteria

1. The user opens the whiteboard shelf, selects "Mind map" in a segmented pill toggle, and the canvas resets to an empty mind map waiting for content.
2. When a meeting starts, a root node appears with the meeting title (e.g., "Meeting 2026-05-21 14:30").
3. As transcript flows in, the LLM proposes `add_branch` operations that the radial layout engine renders as colored branches and sub-branches.
4. Once the meeting has accumulated meaningful content, the LLM emits exactly one `upgrade_root` operation replacing the generic title with a meaningful theme (e.g., "Q4 OKR Planning"). Subsequent `upgrade_root` attempts are ignored.
5. Glossary preserve-terms and active label-language apply to new branch labels (existing infrastructure).
6. Toggling back to "Freeform" clears the mind map and shows an empty freeform canvas. Toggling to "Mind map" again starts a fresh tree.
7. With the auto-suggestions feature enabled, mind-map mode continues to work — glossary suggestions are produced from the underlying transcript regardless of which whiteboard mode is active.
8. Zero regression on freeform mode (existing whiteboard tests + manual flow still pass).

## In scope (v1)

- New `WhiteboardMode = 'freeform' | 'mindmap'` state, persisted in renderer localStorage + cached in main process
- Renderer `WhiteboardModeToggle` component in the shelf header, beside the existing LABELS selector
- New IPC channel `whiteboard:set-mode`
- New main-side modules:
  - `mindmapState.ts` — in-memory tree (root + branches), `init / applyOperations / getState / clear / findFirstLevelIndex`
  - `mindmapPrompt.ts` — system prompt builder + JSON response parser
  - `mindmapLayout.ts` — deterministic radial layout that produces `WhiteboardElement[]`
  - `mindmapColors.ts` — branch color palette + helpers
- `whiteboardService.ts` extension: cached mode, mode router (freeform path unchanged; mindmap path goes through new modules), meeting-begin hook that initializes the tree root with the meeting title
- LLM operations: `add_branch` (parentLabel + label) and `upgrade_root` (newLabel, at most once per meeting)
- Radial layout: root at center, first-level branches distributed evenly around 360°, sub-branches in a 120° arc on each parent's outward direction
- Color palette: 7 curated colors, assigned by first-level branch index modulo 7; sub-branches inherit the parent's secondary shade
- Glossary integration: branch labels passed through `normalizePreserveTerms` before storage; existing `formatGlossaryPromptSection` injected into the mind-map system prompt
- Label language integration: existing `cachedLabelLanguage` works in mind-map mode unchanged
- Telemetry counters for mode toggles, LLM turns, and tree mutations
- Unit tests for state, layout, and prompt parser

## Out of scope (deferred)

- Auto-detect mode (LLM picks freeform vs mind-map based on transcript content)
- Click-to-expand or click-to-edit interaction on individual nodes
- Cross-links between branches (hybrid mind-map / concept-map)
- Tree depth beyond 2 (root + branch + sub-branch)
- Mind-map persistence across app restart (sqlite storage)
- Migration of content between modes (toggling freeform ↔ mind-map clears both)
- Other diagram types (sequence, swim lane, matrix, decision tree, Venn, Sankey, Gantt)
- Sketchnote / hand-drawn aesthetic upgrades
- Dynamic radius based on branch count (visual collisions at 5 sub-branches are accepted)
- Backfilling existing labels when the glossary changes mid-meeting (only future labels get normalized)
- Tree manipulation commands beyond `add_branch` + `upgrade_root` (no `remove_branch`, `move_branch`, `merge_branches`)

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Mode coexistence | Modal toggle, never both at once | Avoids hybrid-state UI complexity. User intent is explicit. |
| Mode transition behavior | Complete reset of both modes' canvases | Mind map ≠ freeform — content is not migrable. Toggling = fresh start. |
| Layout strategy | Self-implemented radial math, no external library | Mind-map layout is well-bounded. ELK is overkill for a single diagram type. ~100 LOC. |
| LLM output schema | Operations with `parentLabel`, code resolves to ID | LLMs cannot track auto-generated IDs reliably. Label is the LLM-friendly handle. |
| Root upgrade | Once per meeting, gated by `topicSource` | Prevents thrash. First success sets `topicSource = 'llm-detected'` → all subsequent upgrades dropped. |
| Update pattern | Additive (operations) instead of full re-render per turn | Mind maps grow organically. Full re-render would lose stable IDs and cause flicker. |
| Branch coloring | Auto-assigned from curated 7-color palette | LLM doesn't need to think about color. Deterministic, consistent across turns. |
| Tree depth cap | 2 (root + branch + sub-branch) | Mind maps degrade past depth 2 anyway. Keeps layout solvable. |
| Tree breadth cap | 7 first-level, 5 sub-branches per parent | Magical 7±2 — readable maximum on screen. |
| Element representation | Existing Excalidraw primitives | Renderer pipeline unchanged. Canvas IPC unchanged. |
| Glossary in labels | `normalizePreserveTerms` on each new label only | Existing infrastructure. Backfill of old labels deferred to v2. |
| Persistence | In-memory only | Matches existing freeform behavior. v2 can add sqlite if user demand surfaces. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Main process                                                          │
│                                                                        │
│   whiteboardService.ts                                                 │
│   ─────────────────────                                                │
│     module state:                                                      │
│       cachedMode: 'freeform' | 'mindmap'                              │
│       cachedLabelLanguage: string | null  (existing)                  │
│       freeformElements: WhiteboardElement[]  (existing)               │
│                                                                        │
│     transcript chunk arrives → enqueueWhiteboardTranscript(text)      │
│       └── if cachedMode === 'freeform':                                │
│             [existing freeform agent path — unchanged]                 │
│       └── if cachedMode === 'mindmap':                                 │
│             1. snapshot mindmapState                                   │
│             2. build prompt via mindmapPrompt + glossary               │
│             3. call gpt-4o-mini, response_format=json_object          │
│             4. parse operations                                        │
│             5. mindmapState.applyOperations(ops, glossary)             │
│             6. layout = computeMindMapLayout(state)                    │
│             7. broadcast `whiteboard:update` { elements: layout }      │
│             8. broadcast `whiteboard:viewport` scroll_to_content       │
│                                                                        │
│     setWhiteboardMode(mode):                                          │
│       - if mode === cachedMode: no-op                                  │
│       - else: clear both modes' state, set cached mode, broadcast      │
│         empty elements (renderer's canvas resets)                      │
│                                                                        │
│     onMeetingBegin(meetingTitle):                                     │
│       - if cachedMode === 'mindmap': mindmapState.init(meetingTitle)  │
│       - broadcast initial layout                                       │
│                                                                        │
│   mindmapState.ts (new)                                                │
│     in-memory state, init/applyOperations/clear/getState               │
│                                                                        │
│   mindmapPrompt.ts (new)                                               │
│     buildMindMapSystemPrompt(state, glossary, labelLang)               │
│     parseOperations(jsonString) → Op[]                                 │
│                                                                        │
│   mindmapLayout.ts (new)                                               │
│     computeMindMapLayout(state) → WhiteboardElement[]                  │
│                                                                        │
│   mindmapColors.ts (new)                                               │
│     BRANCH_PALETTE, branchColor(firstLevelIndex, depth)                │
└──────────────────────────────────────────────────────────────────────┘
                          │ existing IPC channels
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer                                                               │
│                                                                        │
│   WhiteboardModeToggle (new) — segmented pill in shelf header         │
│     reads/writes localStorage 'automeetic.whiteboardMode'              │
│     fires window.electronAPI.whiteboard.setMode(mode) on change        │
│                                                                        │
│   Excalidraw canvas — unchanged. Receives whiteboard:update with      │
│   pre-laid-out elements regardless of source mode.                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Data model

### TypeScript types (`src/main/whiteboard/types.ts` extension)

```ts
export type WhiteboardMode = 'freeform' | 'mindmap'

export interface MindMapNode {
  id: string             // 'root' OR 'br_<base36>_<random6>'
  parentId: string | null  // null === root
  label: string          // 1-80 chars
  depth: number          // 0=root, 1=first-level branch, 2=sub-branch
}

export interface MindMapState {
  rootId: string         // always 'root'
  nodes: MindMapNode[]
  topicSource: 'meeting-title' | 'llm-detected'
}

export type MindMapOperation =
  | { type: 'add_branch'; parentLabel: string; label: string }
  | { type: 'upgrade_root'; newLabel: string }
```

### sqlite schema

**No changes.** Mind-map state is ephemeral and lives only in main-process module memory. The existing schema (v3 after auto-suggestions) is untouched.

## LLM prompt + parser

### Compact tree serialization

A textual representation of the current tree state, used as LLM context. Example:

```
ROOT: "Q4 OKR Planning"
- "Engineering Goals" [3 children]
  - "Reduce latency"
  - "Migrate to Postgres"
  - "Mobile rewrite"
- "Marketing Goals" [2 children]
  - "Brand refresh"
  - "Launch campaign"
- "Hiring" [0 children]
```

The `[N children]` annotation lets the LLM see the structure without overwhelming token budget when sub-branches are numerous.

### System prompt template

```
You are a mind-map curator for a live meeting. The user has switched to
mind-map mode. Maintain ONE tree that grows as the meeting unfolds.

Current mind map:
{compactTreeText}

Rules:
- One central topic at the root. Branches radiate outward.
- Tree depth: root (depth 0) + first-level branches (depth 1, max 7)
  + sub-branches (depth 2, max 5 per parent).
- Labels: 1-80 chars. 1-5 words ideal. Use sentence case.
- Do NOT propose duplicate labels under the same parent.
- Only ADD operations and ONE-TIME root upgrade. No remove/move/merge.

Per turn, output JSON only:
{
  "operations": [
    { "type": "add_branch", "parentLabel": "<exact existing>", "label": "<new>" },
    { "type": "upgrade_root", "newLabel": "<better central topic>" }
  ]
}

upgrade_root:
- Propose AT MOST ONCE per meeting, and only when the current root is a
  generic title like "Meeting 2026-05-21 14:30". Skip if the root is
  already meaningful (e.g., "Q4 OKR Planning").
- The new label captures the meeting's actual theme — short, 2-5 words.

add_branch:
- parentLabel must match an existing node EXACTLY (case-insensitive).
- If the new transcript fits an existing first-level branch, add as a
  child of that branch (depth 2). Otherwise add a new first-level branch.
- Prefer extending existing structure over multiplying top-level branches.
- Output at most 5 operations per turn.

If nothing in this transcript is worth adding, return: { "operations": [] }

Active label language: {labelLanguage or "Auto"}

{glossaryBlock or ""}

Output JSON only. No code fences, no labels, no explanation.
```

### Parser validation (`mindmapPrompt.parseOperations`)

For each operation:

- `type` is exactly `'add_branch'` or `'upgrade_root'`
- `add_branch`: both `parentLabel` and `label` are non-empty strings ≤ 80 chars
- `upgrade_root`: `newLabel` is a non-empty string ≤ 80 chars
- Drop malformed operations silently (no exceptions thrown into the caller)
- Truncate the operations array to at most 5 items
- Return an empty array on malformed JSON

The parser does not check parent-existence, depth, or duplication — those checks live in `mindmapState.applyOperations` so the parser stays pure.

### State application (`mindmapState.applyOperations`)

Inputs: `(operations, glossaryEntries)`. The glossary entries are needed so labels get `normalizePreserveTerms` applied before storage.

Logic, in order:

1. For each operation:
   - `upgrade_root`:
     - Skip if `state.topicSource === 'llm-detected'`
     - Normalize `newLabel` via `normalizePreserveTerms(label, glossary)`
     - Replace root.label, set `state.topicSource = 'llm-detected'`
   - `add_branch`:
     - Lookup parent: find the node whose `label.toLowerCase() === parentLabel.toLowerCase()`. If multiple match, pick the most recently added (highest `nodes` index).
     - Drop if no match.
     - Drop if parent.depth === 2 (would create depth 3, disallowed).
     - Normalize `label` via `normalizePreserveTerms`.
     - Drop if normalized label already exists under the same parent (case-insensitive).
     - Drop if parent.id === 'root' and the count of root's children >= 7.
     - Drop if parent.depth === 1 and the count of parent's children >= 5.
     - Otherwise generate ID `br_<now base36>_<6 random base36>`, push to `state.nodes`.
2. Return `{ rootUpgraded: boolean, addedNodeIds: string[] }` so the caller can emit telemetry.

## Layout engine

Constants:

```ts
const ROOT_SIZE = { w: 220, h: 80 }
const L1_SIZE = { w: 200, h: 60 }
const L2_SIZE = { w: 160, h: 50 }
const RADIUS_L1 = 280
const RADIUS_L2 = 180
const SUB_ARC = (2 * Math.PI) / 3  // 120°
const ARROW_GAP = 6
```

Algorithm:

1. Place root at `(0, 0)` as an `ellipse`, label = root.label, fontSize 20, backgroundColor `'#fff8e1'`.
2. Find first-level children of root. Distribute their angles evenly across `2π` starting at `-π/2` (12 o'clock). For each:
   - `angle = -π/2 + i * (2π / N)`
   - `centerX = cos(angle) * RADIUS_L1`, `centerY = sin(angle) * RADIUS_L1`
   - Render as `rectangle`, fontSize 16, backgroundColor `branchColor(i, 1)`, roundness `{ type: 3 }`, fillStyle `'solid'`.
   - Render an arrow root → branch with endpoints near each shape's edge (offset by half-min-dimension + `ARROW_GAP` from each center).
3. For each first-level branch with sub-children:
   - The branch's outward direction is the same `angle` from step 2.
   - Spread `subs.length` sub-branches across an arc of `SUB_ARC` centered on `angle`. If only 1 sub-branch, place it on `angle` exactly.
   - Each sub: `subCenter = (branchCenter.x + cos(subAngle) * RADIUS_L2, branchCenter.y + sin(subAngle) * RADIUS_L2)`.
   - Render as smaller `rectangle`, fontSize 14, backgroundColor `branchColor(parentIndex, 2)`.
   - Render an arrow branch → sub-branch similar to step 2.
4. Return the assembled `WhiteboardElement[]` to the caller (which broadcasts via the existing `whiteboard:update` IPC).

Edge cases:

- 0 first-level branches: just the root ellipse.
- 1 first-level branch: placed at 12 o'clock.
- 7+ first-level branches: capped at 7 by the state layer; layout assumes 1..7.

Color helper (`mindmapColors.ts`):

```ts
export const BRANCH_PALETTE = [
  { primary: '#a5d8ff', secondary: '#dbeafe' },
  { primary: '#ffd6a5', secondary: '#fed7aa' },
  { primary: '#caffbf', secondary: '#d9f99d' },
  { primary: '#ffadad', secondary: '#fecaca' },
  { primary: '#bdb2ff', secondary: '#ddd6fe' },
  { primary: '#fdffb6', secondary: '#fef08a' },
  { primary: '#9bf6ff', secondary: '#bae6fd' },
]

export function branchColor(firstLevelIndex: number, depth: 1 | 2): string {
  const c = BRANCH_PALETTE[firstLevelIndex % BRANCH_PALETTE.length]
  return depth === 1 ? c.primary : c.secondary
}
```

## IPC surface

Single new channel:

```ts
'whiteboard:set-mode' (args: { mode: 'freeform' | 'mindmap' }) → void
```

Existing channels (`whiteboard:update`, `whiteboard:viewport`, `whiteboard:agent-status`, `whiteboard:set-label-language`) remain unchanged.

Preload bridge extension:

```ts
// inside electronAPI.whiteboard
setMode: (mode: 'freeform' | 'mindmap') =>
  ipcRenderer.invoke('whiteboard:set-mode', { mode })
```

Type:

```ts
whiteboard: {
  setLabelLanguage(code: string | null): Promise<void>
  setMode(mode: 'freeform' | 'mindmap'): Promise<void>
}
```

## Mode transition flow

```
[Renderer] user clicks "Mind map" pill
  ↓
[Renderer] localStorage 'automeetic.whiteboardMode' = 'mindmap'
[Renderer] window.electronAPI.whiteboard.setMode('mindmap')
  ↓
[Main] ipc.handle('whiteboard:set-mode') → setWhiteboardMode('mindmap')
  ↓
[Main] cachedMode = 'mindmap'
       freeformElements = []  (drop)
       mindmapState.init(currentMeetingTitleOrDefault)  (if a meeting is live)
       broadcast 'whiteboard:update' { elements: computeMindMapLayout(state) }
  ↓
[Renderer] Excalidraw canvas re-renders to show empty mind-map root
```

The reverse (`mindmap → freeform`) is symmetric — broadcasts empty `whiteboard:update`, and the freeform agent picks up from there on the next transcript turn.

## Meeting lifecycle integration

`MeetingLifecycle.beginMeeting(args) → meetingId` returns the id. The `src/main/index.ts` orchestration that already wires the lifecycle gets a small addition:

```ts
const meetingId = lifecycle.beginMeeting({ sourceLanguage, targetLanguage })
const meeting = memorySvc.repository.getMeeting(meetingId)
if (meeting) {
  whiteboardService.onMeetingBegin(meeting.title)
}
```

`onMeetingBegin` checks the cached mode and only initializes mind-map state when relevant. Freeform path is untouched.

## Edge cases

| Case | Handling |
|---|---|
| LLM response arrives after mode toggle | Track `dispatchedMode` at call time. If `dispatchedMode !== cachedMode` when response lands, drop silently. |
| Mode toggle without active meeting | Both modes show empty canvas. Mind-map root appears only when a meeting starts. |
| LLM proposes `upgrade_root` twice | Second is dropped by the `topicSource === 'llm-detected'` check. |
| LLM uses wrong `parentLabel` | `applyOperations` lookup returns null, that op is dropped (silent), siblings continue. |
| 5+ sub-branches collide visually | Accepted in v1. 30° spacing at 160px width may produce minor overlap. v2 can add dynamic radius. |
| Long labels overflow shape | Excalidraw's default clipping behavior. Prompt instructs "1-5 words ideal" to mitigate. |
| Glossary changes mid-meeting | Existing nodes are NOT re-normalized in v1. Document the gap; user can manually fix via re-trigger or v2 backfill. |
| LLM error / malformed JSON | Silent skip + telemetry `mindmap.turn.failure`. Next transcript turn retries. |
| Transcript too small / no signal | LLM returns `{ "operations": [] }`. State unchanged. No telemetry noise (success with `opsApplied: 0`). |

## Glossary + label-language integration

- The mind-map system prompt includes the same `formatGlossaryPromptSection(entries, labelLanguage)` block already used by the freeform agent.
- After parsing operations, `applyOperations` runs `normalizePreserveTerms(label, glossary)` on every new label before insertion.
- `cachedLabelLanguage` is unchanged — both freeform and mind-map agents read from the same source.
- The renderer's existing `WhiteboardLabelLangSelect` continues to work; no changes needed.

## Telemetry

Counters via existing `src/main/telemetry/logger.ts`:

- `mindmap.mode-toggled` — target = `'freeform' | 'mindmap'`
- `mindmap.turn.success` — `opsApplied: int`, `totalNodes: int`
- `mindmap.turn.failure` — reason = `'llm-error' | 'parse-error'`
- `mindmap.node.added` — `depth: 1 | 2`
- `mindmap.root.upgraded` — `oldLabel`, `newLabel`

## Testing strategy

Unit (vitest), all in `src/test/`:

- `mindmap-state.test.ts` (~10 tests): init, add_branch valid, parent-not-found drop, depth-3 drop, duplicate drop, 7-first-level cap, 5-sub-branch cap, upgrade_root applies once, second upgrade_root dropped, ops list truncated to 5.
- `mindmap-layout.test.ts` (~8 tests): root only, 1 first-level, 7 first-levels evenly distributed, sub-branches in outward arc, arrows endpoints near shape edges (not centers), color palette wrap-around, sub-branch inherits parent secondary color, root center is (0, 0).
- `mindmap-prompt-parser.test.ts` (~6 tests): valid ops parsed, malformed JSON returns [], invalid type dropped, op count truncated to 5, label length check, empty operations returns [].

Manual smoke (Phase 6 in plan): toggle to mind-map, run a Q4-OKR-style meeting, verify root upgrade + branch additions + colors + toggle back to freeform.

## Files touched (estimated)

```
src/main/whiteboard/types.ts                            — extend
src/main/whiteboard/mindmapPrompt.ts                    — new
src/main/whiteboard/mindmapState.ts                     — new
src/main/whiteboard/mindmapLayout.ts                    — new
src/main/whiteboard/mindmapColors.ts                    — new
src/main/whiteboardService.ts                           — mode routing, cachedMode, onMeetingBegin hook, dispatch-time mode check
src/main/ipc.ts                                         — 'whiteboard:set-mode' handler
src/main/index.ts                                       — wire onMeetingBegin
src/preload/index.ts                                    — expose whiteboard.setMode
src/preload/types.ts                                    — type extension
src/renderer/whiteboard/WhiteboardModeToggle.tsx        — new
src/renderer/App.tsx                                    — mount the toggle in shelf header
src/renderer/App.css                                    — pill styles
src/test/mindmap-state.test.ts                          — new
src/test/mindmap-layout.test.ts                         — new
src/test/mindmap-prompt-parser.test.ts                  — new
```

## Estimated effort

~16-20 hours of solo work, ~2-3 days. Plan breaks this into 6 phases (see companion implementation plan).

## Open questions (resolve during implementation plan)

- Where exactly does `MeetingLifecycle.beginMeeting` get called in `src/main/index.ts` today? The implementer should grep for it and attach the `whiteboardService.onMeetingBegin(meetingTitle)` call at the same site. Same pattern as the auto-suggestions extraction wiring.
- The freeform agent currently uses some internal coalesce/debounce when enqueueing transcripts. The mind-map dispatcher should reuse the same queue; confirm the existing `enqueueTranscript` function in `whiteboardService.ts` is shape-compatible (it should be, since both modes consume `(text: string)`).
- The renderer's existing `WhiteboardLabelLangSelect` reads localStorage on mount and pushes to main via IPC. The new `WhiteboardModeToggle` should mirror that pattern exactly. Verify the shelf-header layout doesn't break responsively when both controls are present.

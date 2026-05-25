# Ask to Mind Map Design

**Date:** 2026-05-25
**Status:** Draft, approved for planning

## One-line

Add a `Send to Mind Map` action to Memory Ask answers so a cited cross-meeting answer can become a fresh whiteboard mind map.

## Why

Memory Ask now answers questions across past meetings with citations. Whiteboard mind-map mode already turns meeting content into a visual tree. Connecting the two makes autoMeetic feel less like a generic meeting search tool and more like a workspace: ask a question, get a grounded answer, then turn that answer into a visual artifact.

## Success Criteria

1. Ask tab assistant answers with at least one source show a `Send to Mind Map` action.
2. Streaming, errored, or source-less assistant messages do not offer an active send action.
3. Clicking the action creates a new mind map from that answer, switches the whiteboard to `mindmap` mode, and opens the whiteboard modal.
4. Existing whiteboard and mind-map contents are replaced by the generated map.
5. The root label is a short topic derived from the user question or answer.
6. First-level branches capture the answer's main conclusions, decisions, or themes.
7. Second-level branches capture supporting source snippets or cited details.
8. Citation markers are preserved in short labels when useful, for example `Pricing delay [^2]`.
9. Existing Ask citation navigation remains unchanged.
10. Existing live whiteboard mind-map behavior remains unchanged unless the user explicitly sends an Ask answer to the mind map.

## In Scope

- Renderer Ask action on assistant messages.
- Ask-to-whiteboard callback plumbing through `MemoryLibraryPanel` and `App`.
- Main-process IPC for creating a mind map from an Ask answer.
- Deterministic answer/source-to-tree conversion.
- Reuse of existing `mindmapState`, `computeMindMapLayout`, whiteboard update events, and `setWhiteboardMode`.
- Telemetry for send attempts, successes, and failures.
- Focused unit tests for conversion and IPC behavior.

## Out of Scope

- LLM-based mind-map curation for v1.
- Node click deep-links back to source segments.
- Merging Ask maps into an existing live meeting mind map.
- Persisting generated maps across restart.
- Exporting the map.
- Multi-map history.
- Editing map nodes from the Ask tab.

## Key Decisions

| Decision | Choice | Reasoning |
| --- | --- | --- |
| User entry point | `Send to Mind Map` button under assistant answers | Keeps Ask as the place where the user first judges answer quality. |
| Target behavior | Replace current whiteboard with a fresh map | Avoids mixing cross-meeting synthesis with live meeting notes. |
| Generation strategy | Deterministic conversion in v1 | Faster, testable, no extra model latency or cost. |
| Root label | Derive from question first, fallback to answer | The question usually names the user's intended topic. |
| Branch shape | Root + main points + source-backed details | Matches existing mind-map depth constraints and stays readable. |
| Citation behavior | Preserve markers in labels, no node deep-linking | Gives provenance without adding a new interaction contract. |
| Ownership | Whiteboard service owns tree creation | The renderer should request an artifact, not know layout/tree internals. |

## UX Flow

1. User asks a question in Memory Ask.
2. Assistant streams an answer and sources.
3. After the `done` event, the assistant message renders `Send to Mind Map`.
4. User clicks the action.
5. Renderer invokes the new IPC with:
   - original user question, if available
   - assistant answer text
   - answer sources
6. Main process converts the payload into a fresh mind-map state.
7. Whiteboard mode switches to `mindmap`.
8. Main broadcasts `whiteboard:update` with the computed layout.
9. Renderer opens the whiteboard modal.

The action should show a short pending state while IPC is running. If creation fails, the Ask message area should show a compact error near the button and leave the existing chat intact.

## Architecture

```text
Renderer Ask
  ChatMessageView
    Send to Mind Map
      |
      v
  AskTab / MemoryLibraryPanel callback
      |
      v
  App opens whiteboard modal after IPC success
      |
      v
Preload
  whiteboard.createMindMapFromAsk(payload)
      |
      v
Main IPC
  whiteboard:create-mindmap-from-ask
      |
      v
whiteboardService
  createMindMapFromAsk(payload)
    - clear freeform elements
    - clear mindmap state
    - set mode to mindmap
    - build tree from answer + sources
    - compute layout
    - send whiteboard:update
```

## Data Contract

```ts
export interface AskMindMapPayload {
  question: string
  answer: string
  sources: ChatSource[]
}

export interface AskMindMapResult {
  nodeCount: number
}
```

The payload is sent through the whiteboard preload surface because the operation creates a whiteboard artifact. `ChatSource` can be imported from the existing memory types.

## Tree Conversion

The deterministic converter should be intentionally conservative:

1. Root label:
   - Strip citation markers from the question.
   - Remove leading question phrases such as `What`, `How`, `Summarize`, or Korean equivalents only when doing so is simple and safe.
   - Clamp to 80 characters.
   - Fallback: first meaningful answer sentence.
2. Main branches:
   - Split the answer into short paragraphs or sentences.
   - Prefer sentences with citation markers.
   - Keep up to 5 first-level branches.
   - Strip markdown-like bullets if present.
   - Clamp each label to 80 characters.
3. Supporting branches:
   - For each source cited by a main branch, add one child using the source preview.
   - If citation parsing is sparse, attach the top sources in order.
   - Keep up to 3 supporting children per branch.
4. Empty fallback:
   - If no branch can be derived, create one branch named `Summary` and attach up to 3 source-backed children.

The converter must respect the existing mind-map constraints: depth 2, max 7 first-level branches, max 5 sub-branches per parent, 80-character labels.

## Error Handling

- Empty answer: reject with a clear error.
- Missing sources: reject; the renderer should keep the button disabled for this case.
- Malformed citation markers: ignore malformed markers and use ordered sources.
- Whiteboard window unavailable: return an IPC error and show a compact renderer error.
- Conversion creates no nodes: use the `Summary` fallback.

## Telemetry

- `memory.ask_mindmap.submit` with `answerChars` and `sourceCount`.
- `memory.ask_mindmap.created` with `nodeCount` and `sourceCount`.
- `memory.ask_mindmap.error` with `reason`.

## Tests

- Converter derives a root from the question.
- Converter creates first-level branches from cited answer sentences.
- Converter attaches source-backed supporting branches.
- Converter falls back to ordered sources when citations are absent or malformed.
- Converter enforces label length, depth, and branch count limits.
- IPC handler calls the whiteboard service and returns `nodeCount`.
- Renderer action is disabled while streaming or when sources are absent.

## Files Likely Touched

- `src/main/whiteboardService.ts`
- `src/main/whiteboard/askMindMap.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/preload/types.ts`
- `src/renderer/ask/ChatMessageView.tsx`
- `src/renderer/ask/AskTab.tsx`
- `src/renderer/library/MemoryLibraryPanel.tsx`
- `src/renderer/App.tsx`
- `src/renderer/App.css`
- `src/test/ask-mindmap.test.ts`
- `src/test/chat-renderer.test.ts`

## Verification

This touches `src/main`, `src/preload`, and `src/renderer`, so final implementation verification must run:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`


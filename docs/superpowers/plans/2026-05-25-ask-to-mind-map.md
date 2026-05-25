# Ask to Mind Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Send to Mind Map` action to Memory Ask answers that creates a fresh whiteboard mind map from the cited answer.

**Architecture:** The renderer exposes an action on eligible assistant messages and passes the question, answer, and sources through the whiteboard preload API. Main process owns the artifact creation: it converts the Ask payload into a bounded mind-map tree, reuses existing mind-map layout, switches whiteboard mode to `mindmap`, and broadcasts the new elements.

**Tech Stack:** Electron IPC, React, TypeScript, Vitest, existing whiteboard mind-map modules.

---

### Task 1: Converter

**Files:**
- Create: `src/main/whiteboard/askMindMap.ts`
- Test: `src/test/ask-mindmap.test.ts`

- [ ] **Step 1: Write failing converter tests**

Add tests that import `buildAskMindMapState` and verify root derivation, cited branches, source fallback, and caps.

- [ ] **Step 2: Run converter tests red**

Run: `npx vitest run src/test/ask-mindmap.test.ts`

Expected: fail because `src/main/whiteboard/askMindMap.ts` does not exist.

- [ ] **Step 3: Implement deterministic converter**

Create `AskMindMapPayload`, `AskMindMapResult`, and `buildAskMindMapState(payload)` in `src/main/whiteboard/askMindMap.ts`. The converter must:
- reject empty answer
- reject missing sources
- derive root from question with answer fallback
- create up to 5 first-level branches from answer sentences
- attach up to 3 source-backed children per branch
- preserve valid citation markers in labels
- clamp labels to 80 chars

- [ ] **Step 4: Run converter tests green**

Run: `npx vitest run src/test/ask-mindmap.test.ts`

Expected: pass.

### Task 2: Main IPC and Whiteboard Service

**Files:**
- Modify: `src/main/whiteboardService.ts`
- Modify: `src/main/ipc.ts`
- Test: `src/test/ask-mindmap.test.ts`

- [ ] **Step 1: Add failing service/IPC tests**

Add tests for `createMindMapFromAsk` returning `nodeCount` and setting whiteboard mode to `mindmap`.

- [ ] **Step 2: Run tests red**

Run: `npx vitest run src/test/ask-mindmap.test.ts`

Expected: fail because `createMindMapFromAsk` is missing.

- [ ] **Step 3: Implement service method and IPC handler**

Add `createMindMapFromAsk(payload)` to `whiteboardService.ts`. It clears existing state, sets cached mode to `mindmap`, initializes the tree from converter output, computes layout, sends `whiteboard:update`, logs telemetry, and returns `{ nodeCount }`.

Register `whiteboard:create-mindmap-from-ask` in `src/main/ipc.ts`.

- [ ] **Step 4: Run focused tests green**

Run: `npx vitest run src/test/ask-mindmap.test.ts`

Expected: pass.

### Task 3: Preload Contract

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/types.ts`

- [ ] **Step 1: Add preload API**

Expose `window.electronAPI.whiteboard.createMindMapFromAsk(payload)`.

- [ ] **Step 2: Typecheck focused contract**

Run: `npm run typecheck`

Expected: pass after renderer wiring is complete.

### Task 4: Renderer Action

**Files:**
- Modify: `src/renderer/ask/ChatMessageView.tsx`
- Modify: `src/renderer/ask/AskTab.tsx`
- Modify: `src/renderer/library/MemoryLibraryPanel.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.css`
- Test: `src/test/chat-renderer.test.ts`

- [ ] **Step 1: Add failing renderer test**

Extend renderer tests to verify the action is disabled/hidden while streaming or when sources are absent, and active for completed sourced assistant messages.

- [ ] **Step 2: Run renderer tests red**

Run: `npx vitest run src/test/chat-renderer.test.ts`

Expected: fail because the action is missing.

- [ ] **Step 3: Implement renderer action**

Thread `onSendToMindMap` from `App` through `MemoryLibraryPanel`, `AskTab`, and `ChatMessageView`. On success, open the whiteboard modal. Show a compact error if IPC fails.

- [ ] **Step 4: Run renderer tests green**

Run: `npx vitest run src/test/chat-renderer.test.ts`

Expected: pass.

### Task 5: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

Run:
- `npx vitest run src/test/ask-mindmap.test.ts src/test/chat-renderer.test.ts`

- [ ] **Step 2: Run required verification gate**

Run:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

Expected: pass, except any documented pre-existing Windows `EBUSY` behavior must be reported with command output.


# Live Sentence Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render fast live source text as one growing sentence row instead of many fragment rows.

**Architecture:** Main owns active sentence assembly and emits source patches for the same turn id. Renderer patches the existing caption item and lets the existing typewriter continue from displayed lengths. Translation is debounced per row and stale responses are ignored by version.

**Tech Stack:** Electron IPC, TypeScript, React reducer store.

---

### Task 1: Source Patch IPC Types

**Files:**
- Modify: `src/preload/types.ts`
- Modify: `src/preload/index.ts`

- [ ] Add `SourcePatchEvent { id: string; text: string }`.
- [ ] Add `onSttSourcePatch(callback)` to `ElectronAPI`.
- [ ] Expose `stt:source-patch` from preload.
- [ ] Verify with `npm run typecheck`.

### Task 2: Renderer Source Patch Handling

**Files:**
- Modify: `src/renderer/overlay/useCaptionStore.ts`
- Modify: `src/renderer/App.tsx`

- [ ] Add a `patch-source` reducer action.
- [ ] Update matching item fields: `fullSource`, `sourceText`, `typing: true`, `updatedAtMs`.
- [ ] Export `patchSource(id, text)`.
- [ ] Subscribe to `api.onSttSourcePatch` and clean it up.
- [ ] Verify with `npm run typecheck`.

### Task 3: Main Live Sentence Assembly

**Files:**
- Modify: `src/main/transcriptPostProcessor.ts`

- [ ] Add active source turn state with `id`, `text`, `hints`, `createdAtMs`, timers, and translation version.
- [ ] Emit `stt:processed` only for the first fragment in a sentence.
- [ ] Emit `stt:source-patch` for appended fragments with the full source text.
- [ ] Finalize on punctuation, silence timeout, max chars, force flush, and reset.
- [ ] Send downstream whiteboard/action transcript once on finalize.
- [ ] Debounce translation while the row grows and enqueue immediately on finalize.
- [ ] Ignore stale translation responses by version.
- [ ] Verify with `npm run typecheck` and `npm run lint`.

### Task 4: Final Verification

**Files:**
- No code changes.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build` and report whether unrelated existing build errors remain.
- [ ] Manual QA in Electron: speak short Korean fragments and confirm one row grows into a sentence.

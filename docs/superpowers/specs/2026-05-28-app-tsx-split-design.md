# App.tsx Split — Behavior-Preserving Decomposition — Design Spec

**Date:** 2026-05-28
**Status:** Draft — pending implementation
**Stream type:** Behavior-preserving refactor (renderer composition root)
**Related:** First of three sequenced refactor streams agreed in brainstorming (#1 App.tsx split → dead-code handled opportunistically → #3 error/logging consistency). No new behavior.

## One-line

Decompose the 1243-line `src/renderer/App.tsx` god-component: move its stateful logic into focused custom hooks and its large JSX into presentational sub-components, leaving App.tsx a thin composition root (~150–250 lines). Strictly behavior-preserving — no functional, UI, or style change.

## Why this stream

`App.tsx` is the renderer composition root and has grown to **1243 lines** holding everything: ~25 `useState` declarations, the capture/listening-session lifecycle, whiteboard controller state, pipeline-health polling, STT/translation language state, panel open/close toggles, Slack-huddle session wiring, answer-assist, ask-to-mindmap, plus a ~410-line JSX return (header with pipeline stages, body, four modal mounts).

Consequences:
- **Hard to reason about / edit safely.** Any change to one concern risks the others; the file exceeds what fits comfortably in working memory.
- **Cross-concern entanglement.** Session start/stop touches capture, timers, whiteboard, and Slack; it's all inline.
- **It's the highest-value, best-defined target** among the large files (vs `whiteboardService.ts`, `repository.ts`).

The fix is the standard React decomposition: extract cohesive **custom hooks** (state + effects + handlers for one concern) and **presentational components** (JSX sections). This is the "improve the code you're working in" kind of refactor — done surgically, behavior-preserving.

## Success criteria

1. **App.tsx shrinks to a thin root** (~150–250 lines) that calls the extracted hooks and renders extracted section components.
2. **Identical behavior.** Capture start/stop, transcription, translation, whiteboard, action items, memory library, glossary, Slack arm/huddle, answer-assist, ask-to-mindmap, theme, language picker, pipeline-health display — all behave exactly as before. No UI/style/timing change.
3. **Each extracted unit is cohesive and independently understandable:** one clear purpose, a documented interface (what it returns / what props it takes), and stated dependencies.
4. **Extraction is purely mechanical:** logic and JSX move verbatim; only the wiring (hook returns / component props) is added. No logic rewrite.
5. **Automated checks green at every step:** `npm run typecheck`, `npm run lint`, `npm run build` pass after each extraction commit. `npx vitest run` stays green (existing tests unaffected).
6. **Slack/session wiring preserved:** `useSlackArm` continues to receive `beginSession` / `endSession` / `sessionActive`; the listening-session and Slack-huddle session paths still share the same begin/end logic (no duplication, no divergence).
7. **No new dependencies.**

## In scope

### Custom hooks (state + effects + handlers)

Extracted in dependency order (most self-contained first):

- `src/renderer/shell/usePanels.ts` — `shelf`, `whiteboardMaximized`, `memoryLibraryOpen`, `glossaryOpen`, `slackSettingsOpen` + their setters/toggles. Pure local UI state; no side effects.
- `src/renderer/shell/usePipelineHealth.ts` — `healthTick`, `updateHealth`, and the health `snapshot` derivation + the polling effect.
- `src/renderer/shell/useSttLanguageState.ts` — `sttLanguage`, `translationTarget`, `languageLock`, `detectedLanguage` + their setters and any persistence/init (`getInitialTranslationTarget`, `DEFAULT_STT_LANGUAGE`).
- `src/renderer/shell/useWhiteboardController.ts` — `whiteboardElements`, `viewportCommand`, `agentStatus`, `whiteboardConnected`, `canvasResetVersion`, `handleWhiteboardChange`, `handleWhiteboardScreenshot`, and related effects.
- `src/renderer/shell/useListeningSession.ts` — `running`, `starting`, `activeAudioMs`, `sessionStartMs`, `runStartMs`, `analyser`, `beginListeningSession`, `endListeningSession`, `onStart`, `onStop`, `resetSession`, `beginSlackHuddleSession`, `endSlackHuddleSession`, `formatDuration`, capture lifecycle. (Last because it is the most entangled; it receives callbacks from the other hooks/controllers as needed — e.g., resetting whiteboard on session reset — passed explicitly.)

Each hook returns a typed object; App.tsx destructures it. Dependencies between hooks are passed explicitly (e.g., `useListeningSession({ onResetWhiteboard })`), never via hidden shared module state.

### Presentational components (JSX)

- `src/renderer/shell/AppHeader.tsx` — the `<header>` block: live status + duration, the four `<PipelineStage>`s, the title, `<LanguagePicker>` / `<ThemeToggle>`, and panel-toggle buttons. Receives the data/handlers it needs as props.
- `src/renderer/shell/CaptureControls.tsx` — the capture start/stop/source-control body section.
- `src/renderer/shell/AppModals.tsx` — groups the modal mounts (`WhiteboardModal`, `MemoryLibraryPanel`, `GlossaryPanel`, `SlackSettingsPanel`) behind their open flags + handlers. (These are already components; this only groups their mounting to declutter the root.)

App.tsx after: imports the hooks + section components, wires them, returns `<main>{<AppHeader/>}{body/CaptureControls}{shelf}{<AppModals/>}</main>`.

### Tests

- Light unit tests only where a pure helper is extracted (e.g., `formatDuration` if it becomes a standalone export). Side-effect-heavy hooks (capture, IPC) are NOT force-unit-tested — the automated net is typecheck/lint/build; behavior is verified by manual smoke.
- Existing tests must stay green (they don't target App.tsx directly).

## Out of scope (deferred)

- Any behavior, UI, layout, styling, copy, or timing change. Pixel- and behavior-identical.
- Logic rewrites / "while I'm here" improvements inside the moved code. Move verbatim.
- Refactoring other large files (`whiteboardService.ts`, `repository.ts`, `MeetingsTab.tsx`) — separate future streams.
- Dead-code removal as a dedicated pass (#4) — only remove code made dead BY this extraction (e.g., a now-unused local). The repo-wide dead-code stream is separate.
- Error-handling / logging consistency (#3) — the next sequenced stream; do not touch error/log patterns here beyond moving them verbatim.
- New abstractions beyond the hooks/components named above. No speculative generalization.
- Adding tests for side-effect-heavy hooks (capture/IPC) — not practical; manual smoke covers behavior.
- State-management library introduction (Redux/Zustand/etc.). Plain hooks only.

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Decomposition style | Custom hooks (state/logic) + presentational components (JSX) | Idiomatic React; matches the existing pattern (`useSlackArm`, `useChatStore`, `useGlossaryStore`). No new concepts. |
| Hook location | `src/renderer/shell/` | Existing folder for shell-level hooks (`useClockMs`, `useFullscreenState`, `useTranscriptScrollSync` live there). |
| Extraction order | Self-contained first (panels → health → language → whiteboard), entangled last (listening session) | Minimizes the chance an early extraction breaks a later one; each step independently verifiable. |
| Inter-hook dependencies | Passed explicitly as args/callbacks | Keeps hooks decoupled and testable; avoids hidden module-global coupling. |
| Behavior preservation | Move code verbatim; add only wiring | The whole point is zero behavior change; rewrites would inflate risk in an untested root. |
| Verification net | typecheck + lint + build per step + manual smoke | App.tsx has no direct tests; these are the available guarantees. Honest about the weaker automated net. |
| Slack/session sharing | Keep `useSlackArm` consuming `beginSession`/`endSession`/`sessionActive` from `useListeningSession` | The Slack stream already wired this; the split must not duplicate or diverge the begin/end logic. |
| Commit granularity | One hook/component per commit | Reviewable diffs; easy bisect if a regression appears. |
| Components are presentational | Receive data/handlers via props; no business logic | Clear boundary: hooks own logic, components own markup. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| No direct test coverage of App.tsx → silent behavior regression | Purely mechanical moves; typecheck/lint/build per step; manual smoke checklist (deferred to user) covering every wired feature. One unit per commit for easy bisect. |
| Cross-concern entanglement (session reset touches whiteboard, etc.) | Extract the entangled `useListeningSession` LAST; pass cross-hook callbacks explicitly (e.g., `onResetWhiteboard`). Document each hook's dependencies. |
| Hook extraction changes effect timing / dependency arrays | Move effects verbatim with identical dependency arrays; do not "tidy" deps. Lint's `react-hooks/exhaustive-deps` guards. |
| Slack-huddle + manual session diverge after extraction | Single source of truth: both call the same `beginListeningSession`/`endListeningSession` from `useListeningSession`; `useSlackArm` keeps receiving them. Verified in smoke. |
| Prop-drilling explosion in `AppHeader` | Pass a small, typed props object; if it balloons, that's a signal the header itself has sub-sections (acceptable to leave; don't over-split in v1). |
| Early-return guards (web-mode/loading at lines ~156, ~219) lost in the move | Preserve the early returns in App.tsx exactly; they gate before the main render. |
| Large diff hard to review | Per-unit commits; spec lists exact ownership so reviewer can map old→new. |
| Build regression (touches renderer) | `npm run build` required after each phase, not just at the end. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` shows `VERDICT: ✅ Phase N verified` (typecheck + lint + vitest + expected files). **Plus `npm run build`** after each phase (renderer change).
2. **Final:** `npm run verify` clean + `npm run build` clean.
3. **Manual smoke (deferred to user — the primary behavioral check, since App.tsx is untested):**
   - Start capture (share a tab/window) → transcript + translation appear as before.
   - Whiteboard updates; agent status reflects correctly; maximize/restore.
   - Open Memory Library / Glossary / Slack settings panels — all open/close as before.
   - Action items shelf; answer-assist hotkey; ask-to-mindmap.
   - Slack Arm toggle → share → (huddle) auto-start/stop still works.
   - Theme toggle + language picker.
   - Stop + reset session → clean state.
   - Pipeline health stages display the same statuses.
   - No console errors.

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `src/renderer/shell/usePanels.ts` | Create | Panel open/close + shelf state |
| `src/renderer/shell/usePipelineHealth.ts` | Create | Health tick + snapshot |
| `src/renderer/shell/useSttLanguageState.ts` | Create | STT/translation language state |
| `src/renderer/shell/useWhiteboardController.ts` | Create | Whiteboard state + handlers |
| `src/renderer/shell/useListeningSession.ts` | Create | Capture/session lifecycle (+ Slack-huddle session) |
| `src/renderer/shell/AppHeader.tsx` | Create | Header JSX (status, pipeline stages, controls) |
| `src/renderer/shell/CaptureControls.tsx` | Create | Capture body section JSX |
| `src/renderer/shell/AppModals.tsx` | Create | Grouped modal mounts |
| `src/renderer/App.tsx` | Modify | Reduce to thin composition root wiring the above |
| `src/test/*` | Maybe add | Light test for any extracted pure helper (e.g., `formatDuration`) |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Should `formatDuration` become a shared util with a test?** If trivially pure, extract to a tiny module + a small test; otherwise keep inside `useListeningSession`. Decide during implementation.
- **Should `AppHeader` be split further (left/mid/right)?** Not in v1 — one `AppHeader` is enough to declutter the root. Over-splitting is its own smell.
- **Do panel toggles belong in `usePanels` or stay inline?** In `usePanels` — they're cohesive UI state and several components read them.
- **Where do the two early-return guards live?** Stay in App.tsx (they gate the whole render before hooks/sections matter for output). Preserve verbatim.
- **Conservative fallback (hooks only, defer JSX components)?** Offered in brainstorm; user chose the full split. If Phase 2 (components) proves risky mid-stream, it can be deferred without blocking Phase 1's value.

## Self-review notes

The defining constraint here is the **absence of automated coverage for App.tsx**. That pushed two decisions: (1) extraction must be strictly verbatim moves (no opportunistic rewrites), because the only behavioral guarantee is manual smoke; and (2) the entangled `useListeningSession` is extracted last and receives cross-hook needs as explicit callbacks, so earlier, safer extractions don't depend on untangling it first.

A second consideration: the Slack stream recently wired `useSlackArm` to share the session begin/end logic. The split must treat that shared begin/end as a single source of truth living in `useListeningSession`, not duplicate it — otherwise auto-capture-on-huddle and manual Start could silently diverge.

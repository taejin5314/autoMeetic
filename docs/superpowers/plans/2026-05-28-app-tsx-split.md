# App.tsx Split — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` **and `npm run build`** before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first. **Behavior preservation is the prime directive: move code verbatim, add only wiring. App.tsx has NO direct test coverage — typecheck/lint/build are the automated net; manual smoke (deferred to user) is the behavioral check.**

**Goal:** Reduce `src/renderer/App.tsx` (1243 lines) to a thin composition root by extracting cohesive custom hooks (state/logic) and presentational components (JSX). Zero functional/UI/style change.

**Architecture:** Hooks live in `src/renderer/shell/` (alongside existing `useClockMs`, `useFullscreenState`). Extraction order = self-contained first (panels → health → language → whiteboard), entangled last (`useListeningSession`). Inter-hook needs are passed as explicit callbacks. Then JSX sections become `AppHeader` / `CaptureControls` / `AppModals`. The two early-return guards stay in App.tsx verbatim. `useSlackArm` keeps consuming `beginSession`/`endSession`/`sessionActive` from `useListeningSession` (single source of truth — no duplication).

**Tech stack:** React 19, TypeScript strict (no `any`), vitest, no new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-app-tsx-split-design.md`

**Scope reminder (do NOT exceed):** No behavior/UI/style/timing change. No logic rewrites in moved code. No other-file refactors. No dedicated dead-code pass (only remove code made dead by an extraction). No error/logging consistency work (next stream). No new abstractions beyond the named hooks/components. No state library.

---

## Working method (every extraction)

For each hook/component:
1. Create the new file; **move** the relevant state/effects/handlers/JSX **verbatim** (identical logic, identical effect dependency arrays).
2. In App.tsx, replace the moved code with a hook call (destructure its return) or a component render (pass props).
3. `npm run typecheck && npm run lint && npm run build` — all clean.
4. `npx vitest run` — green.
5. Commit (one unit per commit).

Never "tidy" the moved code. If a moved `useEffect` had a lint-suppression or a specific dep array, carry it exactly.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/renderer/shell/usePanels.ts` | Create | shelf + panel open/close state |
| `src/renderer/shell/usePipelineHealth.ts` | Create | healthTick + snapshot + poll effect |
| `src/renderer/shell/useSttLanguageState.ts` | Create | sttLanguage / translationTarget / languageLock / detectedLanguage |
| `src/renderer/shell/useWhiteboardController.ts` | Create | whiteboard state + handlers + effects |
| `src/renderer/shell/useListeningSession.ts` | Create | capture/session lifecycle + slack-huddle session |
| `src/renderer/shell/AppHeader.tsx` | Create | header JSX |
| `src/renderer/shell/CaptureControls.tsx` | Create | capture body JSX |
| `src/renderer/shell/AppModals.tsx` | Create | grouped modal mounts |
| `src/renderer/App.tsx` | Modify | thin composition root |
| `HANDOFF.md` | Modify | active stream block + status table |

---

## Phase 1 — Extract self-contained hooks

> App.tsx keeps rendering the exact same JSX throughout Phase 1; only the source of state moves into hooks.

### Task 1.1 — `usePanels`

- [ ] Move `shelf`, `whiteboardMaximized`, `memoryLibraryOpen`, `glossaryOpen`, `slackSettingsOpen` (state + setters) into `src/renderer/shell/usePanels.ts`. Return `{ shelf, setShelf, whiteboardMaximized, setWhiteboardMaximized, memoryLibraryOpen, setMemoryLibraryOpen, glossaryOpen, setGlossaryOpen, slackSettingsOpen, setSlackSettingsOpen }` (or provide `open*/close*` helpers if App used inline setters — match existing call sites).
- [ ] In App.tsx: `const panels = usePanels()` and replace references.
- [ ] `npm run typecheck && npm run lint && npm run build && npx vitest run`
- [ ] Commit: `refactor(app): extract usePanels hook`

### Task 1.2 — `usePipelineHealth`

- [ ] Move `healthTick`, `updateHealth` (line ~304), the health polling effect, and the `snapshot` derivation into `usePipelineHealth.ts`. Return `{ snapshot, updateHealth }` (+ whatever App reads).
- [ ] Wire in App.tsx; replace references.
- [ ] Verify (typecheck+lint+build+vitest) + commit: `refactor(app): extract usePipelineHealth hook`

### Task 1.3 — `useSttLanguageState`

- [ ] Move `sttLanguage`, `translationTarget`, `languageLock`, `detectedLanguage` (+ `getInitialTranslationTarget`, `DEFAULT_STT_LANGUAGE` usage / persistence) into `useSttLanguageState.ts`. Return state + setters.
- [ ] Wire + replace.
- [ ] Verify + commit: `refactor(app): extract useSttLanguageState hook`

### Task 1.4 — `useWhiteboardController`

- [ ] Move `whiteboardElements`, `viewportCommand`, `agentStatus`, `whiteboardConnected`, `canvasResetVersion`, `handleWhiteboardChange` (~554), `handleWhiteboardScreenshot` (~561), and related effects into `useWhiteboardController.ts`. Return state + handlers + a `resetCanvas()` (bumps `canvasResetVersion`) that `useListeningSession` can call on reset.
- [ ] Wire + replace.
- [ ] Verify + commit: `refactor(app): extract useWhiteboardController hook`

### Task 1.5 — Verify Phase 1

```bash
npm run verify:phase 1
npm run build
```

Update `HANDOFF.md` Phase 1 row.

---

## Phase 2 — Extract the listening-session hook (entangled, last)

### Task 2.1 — `useListeningSession`

- [ ] Move into `useListeningSession.ts`: `running`, `starting`, `activeAudioMs`, `sessionStartMs`, `runStartMs`, `analyser`, `formatDuration` (~594), `beginListeningSession` (~605), `onStart` (~639), `endListeningSession` (~646), `beginSlackHuddleSession` (~669), `endSlackHuddleSession` (~674), `onStop` (~687), `resetSession` (~694), and the capture lifecycle + timer effects.
- [ ] **Cross-hook dependencies passed explicitly as args**, e.g.:
  ```ts
  const session = useListeningSession({
    onResetWhiteboard: whiteboard.resetCanvas,
    sttLanguage, translationTarget, languageLock, // whatever start needs
    // ...only what's actually read
  })
  ```
  Do NOT reach into other hooks' internals; pass what's needed.
- [ ] **Preserve the Slack wiring:** `useSlackArm` must still receive `beginSession`/`endSession`/`sessionActive` sourced from this hook (e.g., `session.beginListeningSession`/`endListeningSession`/`running`). Confirm `beginSlackHuddleSession`/`endSlackHuddleSession` still route through the same begin/end path — no duplication.
- [ ] If `formatDuration` is trivially pure, optionally extract to `src/renderer/shell/formatDuration.ts` + a small test; else keep in the hook.
- [ ] Wire in App.tsx; replace all references.
- [ ] `npm run typecheck && npm run lint && npm run build && npx vitest run`
- [ ] Commit: `refactor(app): extract useListeningSession hook`

### Task 2.2 — Verify Phase 2

```bash
npm run verify:phase 2
npm run build
```

App.tsx now sources ALL state from hooks; JSX still inline. Update `HANDOFF.md` Phase 2 row.

---

## Phase 3 — Extract presentational components

### Task 3.1 — `AppHeader`

- [ ] Move the `<header className="v4p-head">…</header>` block (live status + duration, four `<PipelineStage>`s, title, `<LanguagePicker>`/`<ThemeToggle>`, panel-toggle buttons) into `AppHeader.tsx`. Props: the data/handlers it reads (`running`, `starting`, `heroDurationLabel`, `snapshot`, `agentStatus`, `whiteboardConnected`, `theme`, `setTheme`, panel toggles, etc.). Presentational only — no logic.
- [ ] Render `<AppHeader {...} />` in App.tsx.
- [ ] Verify (typecheck+lint+build+vitest) + commit: `refactor(app): extract AppHeader component`

### Task 3.2 — `CaptureControls`

- [ ] Move the capture body section (start/stop/source controls) into `CaptureControls.tsx` with props for `running`, `starting`, `onStart`, `onStop`, `resetSession`, source/language controls, etc.
- [ ] Render in App.tsx.
- [ ] Verify + commit: `refactor(app): extract CaptureControls component`

### Task 3.3 — `AppModals`

- [ ] Move the modal mounts (`WhiteboardModal`, `MemoryLibraryPanel`, `GlossaryPanel`, `SlackSettingsPanel`) into `AppModals.tsx`, props = their open flags + close handlers + payload props (e.g., `onSendAskToMindMap`, `meetingId`, whiteboard props).
- [ ] Render `<AppModals {...} />` in App.tsx.
- [ ] Verify + commit: `refactor(app): extract AppModals component`

### Task 3.4 — Verify Phase 3

```bash
npm run verify:phase 3
npm run build
```

App.tsx should now be ~150–250 lines (hooks + early-return guards + `<AppHeader>`/body/`<CaptureControls>`/shelf/`<AppModals>`). Update `HANDOFF.md` Phase 3 row.

---

## Phase 4 — Regression + handoff + push

### Task 4.1 — Full regression

```bash
npm run verify
npm run build
```

- [ ] Confirm App.tsx line count materially reduced; it contains only composition (no inline business logic / large JSX blocks).
- [ ] Grep App.tsx to confirm the early-return guards are intact.
- [ ] Document Windows `EBUSY` if `npm test` blocked (`npx vitest run`). Preexisting `tsc -b` issue not this stream's concern.

### Task 4.2 — Update `HANDOFF.md`

- [ ] Move "Slack Huddle Detection" (and prior) to Completed if needed; new "Next active stream" block + status table.
- [ ] Note next sequenced stream: error-handling + logging consistency (#3).

### Task 4.3 — Manual smoke (deferred to user — primary behavioral check)

Document the spec's full smoke checklist (capture → transcript/translation → whiteboard → panels → action items → answer-assist → ask-to-mindmap → Slack arm/huddle → theme/language → stop/reset → health stages → no console errors).

### Task 4.4 — Push

```bash
git push origin master
```

Mark Phase 4 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [ ] All phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output + build confirmation.
- [ ] App.tsx reduced to a thin composition root (~150–250 lines).
- [ ] Every extraction was a verbatim move (no logic/UI/timing change).
- [ ] Effect dependency arrays preserved exactly; no exhaustive-deps suppressions added/removed casually.
- [ ] `useSlackArm` still receives begin/end/active from `useListeningSession`; manual + huddle sessions share one begin/end path.
- [ ] Early-return guards intact in App.tsx.
- [ ] typecheck/lint/build/vitest green at every phase.
- [ ] No new dependencies; no other-file refactors; no dead-code/consistency work bled in.

## Open questions (deferred)

- Whether `AppHeader` warrants further sub-splitting (left/mid/right) — only if it proves unwieldy; not now.
- `formatDuration` as a shared tested util vs hook-local — decided at Task 2.1.
- Conservative fallback (ship Phase 1+2 hooks, defer Phase 3 components) if component extraction proves risky mid-stream.

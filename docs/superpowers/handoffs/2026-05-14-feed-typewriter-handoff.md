# Handoff: Feed Typewriter + Translation Plan Execution

**Date:** 2026-05-14
**Plan:** [docs/superpowers/plans/2026-05-14-feed-typewriter-and-translation.md](../plans/2026-05-14-feed-typewriter-and-translation.md)
**Status:** Tasks 1-7 complete and committed. Tasks 8-9 + final review pending.
**Skill in use:** `superpowers:subagent-driven-development` (dispatch fresh subagent per task, then spec + code-quality reviews).

## How to resume

The next agent should:

1. Read the plan file end-to-end if context is missing.
2. Read this handoff for "what's already done + key context decisions."
3. Pick up at **Task 8** below. Skip review of completed tasks — they have already been reviewed and approved (with one acknowledged carry-over: stylistic concern on `setPostProcessorLanguages` args-object — rejected, see Task 2 notes).
4. After Task 8 + Task 9, dispatch a final code reviewer for the entire set of commits from `b242e28..HEAD`.
5. Finish with `superpowers:finishing-a-development-branch`.

User preferences observed during this session:
- Works **directly on `master`**. No worktrees, no feature branches. Commits + pushes to origin/master directly when ready.
- Accepts pushing without test suite (project has no formal tests yet; verifies via typecheck + lint + manual QA).
- Uses Korean and English mixed.

## Commit history so far (this plan only)

In chronological order on master:

| SHA | Task | Title |
|---|---|---|
| `b242e28` | 1 | `feat(stt): add translation + language fields to processed turn` |
| `4661992` | 2 | `feat(stt): thread source/target language hints into post-processor` |
| `60e1eb9` | 3 | `feat(stt): bundle translation into post-processor LLM call` |
| `2a01bf5` | 3-fix | `fix(stt): align translation gating + add 15s fetch timeout` |
| `8369e91` | 4 | `feat(stt): renderer pushes language pair to post-processor` |
| `d0afb78` | 5 | `feat(feed): typewriter fields on CaptionItem and store actions` |
| `5963583` | 6 | `feat(feed): typewriter hook that walks the caption queue` |
| `56a08f2` | 7 | `feat(feed): drive bilingual feed via processed turns + typewriter` |

The most recent push to `origin/master` was `21d2899` (right-panel toggle fix). Everything from `b242e28` onward is **local only** at the time of this handoff. Push when complete.

## What each completed task did

### Task 1 (`b242e28`)
Added `translation: string | null`, `sourceLanguage: string`, `targetLanguage: string` to `ProcessedTranscriptTurn` in `src/main/stt/types.ts`. Added `ProcessedTurnsEvent` wrapper. Typed `onSttProcessed` callback in `src/preload/types.ts`.

### Task 2 (`4661992`)
Threaded `LanguageHints { sourceLanguageHint, targetLanguage }` through `transcriptPostProcessor.ts`. Added `pendingHints`/`retryHints` module state. Stubbed translation/sourceLanguage/targetLanguage with placeholders in the parser (cleaned up in Task 3). Added `setPostProcessorLanguages(args)` export on `src/main/sttService.ts` and updated both `enqueueRoughTranscript` call sites to pass the hints.

**Reviewer concern (rejected):** Code-quality reviewer flagged `setPostProcessorLanguages` using an args-object instead of positional params (inconsistent with rest of `sttService.ts`). **Decision:** Kept args-object since it's more extensible and the function is wired from Task 4. Not a real problem.

### Task 3 (`60e1eb9` + `2a01bf5`)
Made `processTranscriptBatch` actually use hints. Added translation directives + source-language detection to the LLM prompt. Updated `toProcessedTurn` to read `turn.sourceLanguage` and compute `wantsTranslation = targetLanguage !== 'off' && targetLanguage !== sourceLanguage`. Follow-up commit `2a01bf5` fixed two issues from code review:
- Aligned the prompt-side `wantsTranslation` check with the parser-side check (was inconsistent).
- Added 15s `AbortController` fetch timeout (prevents the LLM call hanging the flush pipeline).

**Reviewer concern (deferred):** Reviewer flagged "unvalidated hints could allow prompt injection." **Decision:** Not real for this Electron-internal IPC boundary; hints come from a closed-set renderer dropdown. Skipped.

### Task 4 (`8369e91`)
Wired the language IPC end-to-end:
- `setTranscriptLanguages` exposed via preload.
- IPC handler `stt:set-languages` in `src/main/ipc.ts` calls `setPostProcessorLanguages`.
- `App.tsx`'s `onLanguageChange` / `onTranslationChange` now push the new pair to main. A `useEffect` with `[]` deps pushes the initial pair on mount (intentional one-time sync; eslint-disable comment justifies it).

### Task 5 (`d0afb78`)
Replaced `CaptionItem` and `useCaptionStore` to support typewriter state:
- New fields: `fullSource`, `fullTranslation`, `displayedSource`, `displayedTranslation`, `typing`, `sourceLanguage`.
- Legacy aliases retained: `sourceText`, `translatedText` (for Answer Assist's transcript window).
- New actions: `partial`, `append-processed`, `advance-typing`, `complete-typing`, `clear-partial`, `clear`.
- Removed: `committed`, `translation` actions and corresponding hook methods (`applyTranscript`, `applyTranslation`).
- `getRecentTranscript` reads from `item.fullSource`.

### Task 6 (`5963583`)
Added `src/renderer/feed/useFeedTypewriter.ts` — the RAF-driven hook. CJK = 1 char/tick, Latin = 2 char/tick. Translation column starts at 30% of source progress. Cleans up `cancelAnimationFrame` on effect cleanup.

### Task 7 (`56a08f2`) — biggest task
Rewired `App.tsx`:
- New `useCaptionStore` destructure.
- `useFeedTypewriter({ items, advanceTyping, completeTyping })` driven from items.
- Old `bus.onTranscript` feed handler replaced with two Electron IPC listeners: `onSttPartial` (hero only) and `onSttProcessed` (calls `appendProcessed`).
- EN column renders from `displayedSource` with `Fragment` + speaker eyebrow on change.
- KO column renders from `displayedTranslation`; skips items with `fullTranslation === null`.
- `typing=true` adds `v4p-line-typing` class for caret animation.
- Deleted: `flushFeedBuffer`, `enqueueTranslation`, `drainTranslationQueue`, `updateTranslationQueueStatus`, `translationQueueRef`, `translationActiveCountRef`, `translationTargetRef`, `translationGenerationRef`, `feedBufferRef`, `feedBufferText`, `translatingCount`, `shouldAcceptTranscript`, and all associated refs/effects.
- Net `App.tsx` delta: −78 LOC.
- Typecheck + lint clean.

**Scope expansion in Task 7 (acknowledged):** The implementer also added CSS classes that were planned for Task 8: `.v4p-eyebrow`, `.v4p-eyebrow-name`, `.v4p-eyebrow-rule`, `.v4p-line-text.v4p-line-typing`. The implementer noted these are placeholder values — Task 8's job is now to **verify/tune** rather than add fresh.

**Known visual quirk (acknowledged):** KO column eyebrow alignment can drift from EN when an untranslated turn (e.g., source is Korean and target is Korean) precedes a translated turn. The KO column uses `index - 1` for the "previous" pointer, which still counts the skipped row. This is per the spec but worth a designer's eye.

**Unverified at runtime:** Whiteboard agent effect still reads `bus.onTranscript`, which in Electron mode relies on `ElectronSttClient` republishing finals to the bus. Behavior should be preserved but wasn't manually QA'd.

## Tasks remaining

### Task 8: Speaker eyebrow + caret styles

Per the plan, this task adds the styles to `src/renderer/App.css`. **However, the Task 7 implementer already added them as placeholders.** The remaining work for Task 8:

1. Read the current state of `.v4p-eyebrow`, `.v4p-eyebrow-name`, `.v4p-eyebrow-rule`, and the caret on `.v4p-line-typing::after` in `App.css`.
2. Compare against the plan's expected style block:

```css
.v4p-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0 8px;
}

.v4p-eyebrow:first-child {
  margin-top: 0;
}

.v4p-eyebrow-name {
  font-family: var(--p-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--p-accent);
  white-space: nowrap;
}

.v4p-eyebrow-rule {
  flex: 1;
  height: 1px;
  background: var(--p-border);
}

.v4p-line-typing::after {
  content: '▍';
  display: inline-block;
  margin-left: 2px;
  color: var(--p-accent);
  font-weight: 400;
  animation: v4p-caret-blink 1s steps(1) infinite;
}

@keyframes v4p-caret-blink {
  50% {
    opacity: 0;
  }
}
```

3. If the placeholders don't match (likely they don't), update to match exactly.
4. Verify by typecheck + visual inspection if a dev server is started.
5. Commit: `feat(feed): speaker eyebrow + caret animation styles`.

### Task 9: Manual QA

The plan has a checklist of QA scenarios. The user has been running through manual QA in the actual Electron app. The agent doing this handoff cannot run Electron from here; the user does. The pragmatic move:

- Run `npm run dev:electron` if available, or just hand off the checklist to the user.
- Confirm the user is OK to skip if needed.

### Final code review

Per the subagent-driven-development workflow:
> "After all tasks, dispatch final code reviewer for entire implementation."

Use the `superpowers:requesting-code-review` template if present, or just dispatch a general code-reviewer subagent with the commit range `b242e28..HEAD` and the full plan as context. Reviewer should look for:
- Spec coverage gaps
- Cross-task integration issues (e.g., does the typewriter actually fire when `onSttProcessed` arrives?)
- Performance concerns (RAF leak risk, re-renders on every item update — acceptable in practice but worth a glance)
- Test gaps (the project has no test infra; reviewer should note this rather than demand tests)

### Push

After everything passes, push:

```bash
git push origin master
```

## Plan-level scope reminders

**In scope:**
- LLM call cleanup + speaker label + translation (single bundled call)
- Renderer typewriter animation, CJK-aware speed
- Multi-language support (en/ko/ja/zh/es/fr/de via existing dropdowns)
- Speaker eyebrow on change in feed columns
- Edge cases per `§5` of the design (stop/reset, lang change, modal toggle, etc.)

**Out of scope (do NOT add):**
- Mic capture / dual audio source
- Real OpenAI streaming (we use simulated typewriter)
- Speaker rename UI
- Browser/non-Electron mode

## Important file locations

- Plan: `docs/superpowers/plans/2026-05-14-feed-typewriter-and-translation.md`
- Post-processor: `src/main/transcriptPostProcessor.ts`
- IPC: `src/main/ipc.ts`, `src/preload/index.ts`, `src/preload/types.ts`
- STT service: `src/main/sttService.ts`
- STT types: `src/main/stt/types.ts`
- Caption store: `src/renderer/overlay/useCaptionStore.ts`
- Caption types: `src/renderer/overlay/types.ts`
- Typewriter hook: `src/renderer/feed/useFeedTypewriter.ts`
- Main app shell: `src/renderer/App.tsx`
- Styles: `src/renderer/App.css`

## Pre-existing typecheck noise (ignore)

`tsc --noEmit -p tsconfig.main.json` is expected to emit two pre-existing unrelated errors:
- `src/main/index.ts:50-51` — `line` property access issue on Electron WebContents console event
- `src/main/whiteboardService.ts:260` — `ViewportCommand` index signature mismatch

These have been present since before this plan and are unrelated. **Don't try to fix them here.**

## Pre-existing lint noise (ignore)

`npx eslint src/renderer/App.tsx` emits one persistent warning at line ~520:
- `react-hooks/set-state-in-effect` on `setWhiteboardConnected(true)` in the whiteboard WebSocket effect

This is unrelated to the feed work. Do NOT try to fix it as part of this plan.

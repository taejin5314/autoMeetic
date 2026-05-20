# Glossary + Diagram Label Language — Implementation Handoff

Live handoff document maintained during the subagent-driven implementation of the glossary feature. Any agent (Claude, Codex, human) can resume from this file.

## Resuming work

1. Read this file end-to-end.
2. Find the **Current state** table. The next phase to work on is the first row marked `⏳ PENDING`.
3. For that phase, read the corresponding section in `docs/superpowers/plans/2026-05-19-glossary-and-diagram-label-language.md`.
4. Implement per the plan (TDD where indicated). Each phase has discrete tasks with exact code blocks and exact commit messages.
5. After each phase: run `npm run typecheck` and `npx vitest run <phase-test-file>`. Commit each task individually (the plan specifies the commit message). Update the **Current state** table here.

## Spec & plan

- **Spec:** `docs/superpowers/specs/2026-05-19-glossary-and-diagram-label-language-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-19-glossary-and-diagram-label-language.md`

## Working branch

`master` (user explicitly approved working on master). Commits go directly; final PR is the last step in Phase 10.

## Environment quirks

- **better-sqlite3 ABI mismatch:** The project's `better-sqlite3` is compiled for Electron (ABI 145), but vitest runs under Node (ABI 115). Workaround: a shim at `src/test/__sqlite-shim__.ts` plus an alias in `vitest.config.ts`. If tests fail locally with `NODE_MODULE_VERSION` errors, run `node scripts/prepare-native-deps.mjs node` (requires Electron not running) to install the Node-compatible binary at `node_modules/better-sqlite3/build/Release/better_sqlite3_node115.node`.
- **Preexisting lint errors on master:** 4 errors unrelated to glossary work — 3 in `src/renderer/library/MemoryLibraryPanel.tsx` and 1 in `src/renderer/App.tsx` (translation health effect). Treat these as the baseline; flag only new ones introduced by glossary work.
- **Preexisting tsc -b build error:** `npm run build` fails on a preexisting issue in `src/main/memory/repository.ts` (the `lookupSearchHits` return type). `npm run typecheck` (which uses `tsc --noEmit` instead of `tsc -b`) does pass cleanly. Don't try to "fix" this in glossary phases — it's out of scope.
- **Windows + PowerShell shell:** Use `npx vitest run` directly when possible to avoid the `npm test` script's native-deps prep step.

## Current state

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Storage foundation | ✅ COMPLETE | `1e2f819` → `85a7c2a` (9 commits) | 16/16 |
| 2 — Shared prompt helpers | ✅ COMPLETE | `1b79734` | 12/12 |
| 3 — Pull-based cache | ✅ COMPLETE | `0d2bc81` | 4/4 |
| 4 — IPC handlers + preload bridge | ✅ COMPLETE | `f47896b` → `476190c` (2 commits) | 4/4 |
| 5 — Translation queue integration | ✅ COMPLETE | `de672e1` | 2/2 |
| 6 — Glossary panel UI | ✅ COMPLETE | `f7945aa` → `bc98721` (7 commits) | 117/117 |
| 7 — Whiteboard integration | ✅ COMPLETE | `648f6dc` → `b3a016f` (3 commits) | 38/38 |
| 8 — STT vocabulary bias | ⏳ PENDING | — | — |
| 9 — Answer Assist integration | ⏳ PENDING | — | — |
| 10 — Regression sweep + PR | ⏳ PENDING | — | — |

## Notes per phase

**Phase 1** — Schema bump to v2 + `glossary_entries` table + `GlossaryEntry`/`GlossaryEntryInput` types + `MemoryRepository` methods (`upsertGlossary`, `getGlossaryEntry`, `listGlossary`, `deleteGlossary`, `activeGlossary`). 16 tests. One code-review fix cycle resolved: drop `any` from sqlite shim, validate translation language keys (≤20 chars), drop redundant `?? {}`, update stale schema-version-1 test description.

Notable unplanned additions (both accepted by review):
- `src/test/__sqlite-shim__.ts` + `vitest.config.ts` alias for the ABI workaround above
- `rowid DESC` tiebreaker on `ORDER BY updated_at DESC` for stable ordering in fast tests

**Phase 2** — `src/main/glossary/promptInjection.ts` with three pure helpers (`formatGlossaryPromptSection`, `normalizePreserveTerms`, `buildLabelLanguageBlock`) and `LANGUAGE_NAME_BY_CODE` lookup. 12 unit tests. Review pending.

**Phase 3** — `src/main/glossary/cache.ts` with pull-based `ensureFreshGlossary`, `getCachedGlossary`, `bumpGlossaryEpoch`, and test-only reset helper. 4 unit tests. Verification run: `npm run typecheck` and `npx vitest run src/test/glossary-repository.test.ts src/test/glossary-prompt-injection.test.ts src/test/glossary-cache.test.ts` passed (32/32 glossary tests).

**Phase 4** — `src/main/ipc-glossary-handlers.ts` handler factory + wiring in the actual IPC entrypoint (`src/main/ipc.ts`), plus `MemoryService` glossary pass-through methods and preload `window.electronAPI.glossary` bridge. 4 unit tests in `src/test/glossary-ipc-handlers.test.ts`. Verification run: `npm run typecheck`, glossary test bundle (36/36), `npm run lint`, `npx vitest run` (116/116), and `npm run build` passed. `npm test` was attempted but blocked before Vitest by Windows `EBUSY` on `node_modules/better-sqlite3/build/Release/better_sqlite3.node` while Electron/native deps were in use; use `npx vitest run` until the Electron process releases the file.

**Phase 5** — `src/main/transcriptPostProcessor.ts` now receives the `MemoryService` promise, pulls active glossary entries through the Phase 3 cache, injects `formatGlossaryPromptSection()` into live translation prompts, and applies `normalizePreserveTerms()` before emitting translation patches / memory updates. `src/main/index.ts` now shares the initialized memory service promise with the postprocessor. Regression coverage added to `src/test/memory-postprocessor-regression.test.ts` (2 tests). Verification run: `npm run typecheck`, `npx vitest run src/test/memory-postprocessor-regression.test.ts src/test/glossary-prompt-injection.test.ts src/test/glossary-cache.test.ts` (18/18), `npm run lint`, `npx vitest run` (117/117), and `npm run build` passed. Manual SQL smoke test deferred until the Phase 6 glossary panel exists.

**Phase 6** — Renderer glossary surface added: type re-export, `useGlossaryStore`, inline row editor, panel UI, styles, and header button mount in `App.tsx`. Meeting-scoped tab remains disabled with `meetingId={null}` per v1 plan. Lint fix included to defer initial store load from the effect body. Verification run: `npm run typecheck`, `npm run lint`, `npx vitest run` (117/117), and `npm run build` passed. `npm test` was re-attempted and still blocked before Vitest by Windows `EBUSY` on `node_modules/better-sqlite3/build/Release/better_sqlite3.node`, likely because Electron/native deps are currently holding the file. Manual Electron smoke test not run in this pass.

**Phase 7** — Whiteboard integration implemented across 3 tasks:
- Task 7.1: `whiteboardSystemPrompt` refactored to accept a `WhiteboardPromptOptions` object (`viewport`, `labelLanguage`, `glossary`), with `buildLabelLanguageBlock` and `formatGlossaryPromptSection` appended when non-empty.
- Task 7.2: `whiteboardService.ts` gains module-level `cachedLabelLanguage` + `setDiagramLabelLanguage`/`getDiagramLabelLanguage` exports; `init()` now optionally accepts the memory service promise (mirroring Phase 5 pattern) and resolves it async. Glossary is fetched via Phase 3 cache (`ensureFreshGlossary`/`getCachedGlossary`) before each agent prompt build. A `applyGlossaryPostPass()` helper normalizes `element.label.text` and standalone `text` fields after the LLM returns. IPC handler `whiteboard:set-label-language` registered in `src/main/ipc.ts`. Preload bridge `whiteboard.setLabelLanguage` added to `src/preload/index.ts` and `src/preload/types.ts`. Architectural note: in Electron mode the whiteboard WS is null — label language reaches main exclusively via the IPC channel, not the WS payload; the WS `labelLanguage` field is web-mode-only insurance.
- Task 7.3: `WhiteboardLabelLangSelect` component created at `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx`. Mounts in the shelf header conditional on `shelf === 'whiteboard'`. Persists selection to `localStorage` and fires the IPC on mount + change. WS payload in `App.tsx` includes `labelLanguage` for web-mode parity. `readDiagramLabelLanguage` was inlined in `App.tsx` as a direct `localStorage.getItem` call to avoid the `react-refresh/only-export-components` lint error. Verification: `npm run typecheck`, `npm run lint` (clean — 0 errors), `npx vitest run` (38/38 Phase 7 tests, 117/117 full suite).
- Review fix: removed the duplicate mount-time IPC push useEffect (the `[value]` effect already pushes on mount, so the dedicated mount effect was sending the same value twice).
- Known deferred gap: `server/proxy.mjs` and `server/whiteboard-runtime.mjs` ignore the `labelLanguage` field in the WS `whiteboard:agent-run` payload, so web-mode diagram label language is non-functional. The spec defers all web-mode whiteboard parity to v2; Electron mode (the primary target) is fully functional.

## Subagent-driven workflow conventions

- **Phase-level batching:** Tasks tightly coupled within a phase get bundled into one implementer dispatch (e.g., Phase 1 was 6 tasks → 1 dispatch). Loosely coupled work uses one dispatch per task.
- **Per phase / dispatch:** implementer → spec reviewer → fix loop if needed → code quality reviewer → fix loop if needed → mark complete.
- **Commit hygiene:** Each task in the plan specifies its own commit message. Don't squash; let the history reflect the TDD cycle.
- **Commit message format:** `<type>(glossary): <description>`. Types in use: `feat`, `fix`, `chore`, `docs`, `test`. All commits include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.

## Open questions (deferred to v2, do NOT implement in this stream)

- Pre-meeting document upload / RAG
- Sharing links / export
- Team-shared glossary
- CSV / Anki imports
- Inline transcript/diagram highlighting of glossary matches
- Web-mode parity for `/api/translate` glossary (Answer Assist parity IS in scope for Phase 9)
- Renderer-side meeting-id propagation (the GlossaryPanel currently passes `meetingId={null}`; the "This meeting" tab is disabled until this is wired in a follow-up)

## Stack / commands

```bash
# Typecheck (must pass after every phase)
npm run typecheck

# Run a single test file (preferred during dev)
npx vitest run src/test/glossary-repository.test.ts

# Run all glossary tests (after Phase 3)
npx vitest run "src/test/glossary-*.test.ts"

# Lint (4 preexisting errors expected — flag any new ones)
npm run lint

# Build is preexisting-broken (see Environment quirks); don't gate on it.

# Manual dev run (Electron)
npm run dev:electron

# Manual dev run (web mode against proxy)
npm run dev:web
```

## Files created so far

```
src/main/memory/schema.ts              (modified)
src/main/memory/types.ts               (modified)
src/main/memory/repository.ts          (modified — glossary CRUD methods)
src/main/glossary/promptInjection.ts   (new)
src/main/glossary/cache.ts             (new — Phase 3)
src/main/ipc-glossary-handlers.ts      (new — Phase 4)
src/main/index.ts                      (modified — memory service promise shared with transcript postprocessor)
src/main/ipc.ts                        (modified — glossary handlers registered)
src/main/memory/memoryService.ts       (modified — glossary pass-through methods)
src/main/transcriptPostProcessor.ts    (modified — glossary injection into live translation)
src/renderer/glossary/types.ts         (new — renderer type re-export)
src/renderer/glossary/useGlossaryStore.ts (new — renderer store hook)
src/renderer/glossary/GlossaryPanel.tsx (new — glossary panel UI)
src/renderer/glossary/GlossaryRowEditor.tsx (new — inline row editor)
src/renderer/App.tsx                   (modified — glossary header button + panel mount)
src/renderer/App.css                   (modified — glossary panel styles)
src/preload/index.ts                   (modified — glossary bridge)
src/preload/types.ts                   (modified — glossary API types)
src/test/glossary-repository.test.ts   (new — 16 tests)
src/test/glossary-prompt-injection.test.ts (new — 12 tests)
src/test/glossary-cache.test.ts        (new — 4 tests)
src/test/glossary-ipc-handlers.test.ts (new — 4 tests)
src/test/memory-postprocessor-regression.test.ts (modified — glossary translation regression)
src/test/memory-repository-init.test.ts (modified — schema version assertion)
src/test/__sqlite-shim__.ts            (new — ABI workaround)
vitest.config.ts                       (modified — shim alias)
src/main/whiteboard/prompt.ts          (modified — Phase 7: options-object signature, labelLanguage + glossary blocks)
src/main/whiteboardService.ts          (modified — Phase 7: label-lang cache, glossary post-pass, memory service wiring)
src/main/ipc.ts                        (modified — Phase 7: whiteboard:set-label-language handler)
src/main/index.ts                      (modified — Phase 7: pass memory service promise to initWhiteboard)
src/preload/index.ts                   (modified — Phase 7: whiteboard.setLabelLanguage bridge)
src/preload/types.ts                   (modified — Phase 7: whiteboard API type)
src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx (new — Phase 7)
src/renderer/App.tsx                   (modified — Phase 7: label-lang select mount + WS payload)
src/renderer/App.css                   (modified — Phase 7: label-lang select styles)
```

## Files yet to create / modify (preview from plan)

```
src/main/sttService.ts                 (Phase 8 — vocabulary bias)
src/renderer/answer-assist/useAnswerAssistStore.ts (Phase 9 — attach glossary to request)
server/proxy.mjs                       (Phase 9 — Answer Assist glossary)
```

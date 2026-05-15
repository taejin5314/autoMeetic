# AutoMeetic Agent Instructions

## Required Verification

Before claiming a coding task is complete, run:

- `npm run typecheck`
- `npm run lint`
- `npm test`

Also run `npm run build` when changes touch:

- `src/main/**`
- `src/renderer/**`
- `src/preload/**`
- Electron/Vite/TypeScript config
- package dependencies

## TDD Rule

For behavior changes and bug fixes, write or update a failing test first when the behavior can be exercised without a full manual UI session.

Good first test targets:

- `src/main/whiteboard/elements.ts`
- `src/main/whiteboard/session.ts`
- `src/main/whiteboard/keywords.ts`
- live feed sentence grouping helpers
- translation language routing helpers
- renderer/main IPC adapters

## High-Risk Areas

Be especially conservative around:

- live feed sentence grouping and auto-scroll
- translation source/target language routing
- answer assist prompt context
- whiteboard element layout and Excalidraw conversion
- dark/light theme rendering
- renderer/main IPC contracts

## AI Review Triage Loop

- Do not treat all AI review comments as correct.
- Investigate every `must-fix` candidate.
- Prefer adding a regression test before fixing a bug.
- Explain any deferred `should-fix` comment in the PR.
- Classify review feedback as `must-fix`, `should-fix`, or `note` before action.
- If findings conflict, prefer the one backed by failing tests, reproducible behavior, or clear production risk.
- Never mark work complete until verification commands have passed or the failure is clearly documented.

## Code Review Expectations

Prioritize:

- behavioral regressions
- race conditions
- lost renderer state after theme changes or modal remounts
- missing tests for bug fixes
- brittle string parsing where structured data is available
- changes that make diagrams unreadable in compact preview

Do not revert unrelated user changes in the worktree.

# Maintenance Verification Design

## Purpose

AutoMeetic maintenance work should be safe to repeat. Cleanup, refactoring, and performance fixes need a verification flow that catches behavior regressions without turning every small change into a slow full-system exercise.

This design defines a risk-based verification matrix for maintenance tasks. It builds on the repository's existing required commands:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` when changes touch `src/main/**`, `src/renderer/**`, `src/preload/**`, Electron/Vite/TypeScript config, or package dependencies

## Principles

1. Preserve behavior unless a task explicitly says otherwise.
2. Prefer fast, focused checks while iterating.
3. Add or update a regression test before fixing a bug when the behavior can be tested without full manual UI.
4. Measure performance before and after changing performance-sensitive code.
5. Promote checks to CI only when they are deterministic enough to be trusted.

## Verification Levels

### Level 0: Baseline

Run for every maintenance task before claiming completion.

- Inspect `git status --short` before editing.
- Avoid unrelated dirty files.
- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm test`.
- Run `npm run build` when required by `AGENTS.md`.

### Level 1: Cleanup And Dead Code

Use for removing unused files, imports, variables, code paths, assets, or local generated artifacts.

- Confirm absence of references with `rg`.
- Prefer TypeScript and ESLint unused-code signals over manual guessing.
- For assets, confirm the path is not referenced from `src`, `public`, `server`, `scripts`, or docs that describe active behavior.
- For generated artifacts, confirm the path is ignored or reproducible.
- Run the baseline gate.

### Level 2: Refactoring

Use when changing structure while intending to preserve behavior.

- State the invariant in one sentence before editing.
- Run the closest focused tests before the edit when practical.
- If current tests do not cover the behavior, add a characterization test before restructuring.
- Refactor in small steps.
- Run focused tests after each meaningful step.
- Run the baseline gate before completion.

### Level 3: Bug Fixes

Use when changing behavior to correct a defect.

- Reproduce the bug with a failing test when feasible.
- Keep the failing test focused on the observed behavior.
- Make the smallest fix that passes the new test.
- Add adjacent regression coverage only when the bug suggests a family of failures.
- Run the baseline gate.

### Level 4: Performance Fixes

Use when the goal is lower latency, smaller bundles, lower memory use, faster startup, or less render work.

- Define the metric before editing.
- Capture a before measurement in a repeatable command or script.
- Define an initial budget or target.
- Change one meaningful factor at a time.
- Capture the after measurement under the same conditions.
- Keep functional tests passing.
- Start noisy metrics as reports, not hard CI failures. Promote them to blocking gates only after they are stable.

## AutoMeetic High-Risk Additions

The following areas require targeted checks beyond the baseline gate:

- Live feed sentence grouping and auto-scroll: focused helper tests and, when renderer behavior changes, a UI smoke or state-retention check.
- Translation source/target language routing: routing helper tests with explicit language pairs.
- Answer assist prompt context: prompt assertions or snapshot-style tests for included context.
- Whiteboard element layout and Excalidraw conversion: layout regression tests for compact previews and conversion edge cases.
- Dark/light theme rendering: renderer state checks; visual smoke checks when practical.
- Renderer/main IPC contracts: adapter tests that validate request and response shapes.

## CI Shape

The minimum protected-branch gate should run:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

Optional checks should be introduced gradually:

- `npm run format:check` for formatting drift.
- `npm run test:coverage` with thresholds only for stable core modules first.
- Bundle-size or performance-budget reports for renderer output.
- Visual checks for stable high-value screens after screenshot noise is understood.

## Task Template

Use this short template before maintenance changes:

```md
## Maintenance Task

Goal:

Change type:
- cleanup
- refactor
- bug fix
- performance

Invariant or intended behavior change:

Risk area:

Focused verification:

Required final verification:
- npm run typecheck
- npm run lint
- npm test
- npm run build, if required

Performance metric and budget, if applicable:
```

## Out Of Scope

This design does not require new CI files immediately. It defines the verification policy first. CI automation can be planned separately after the team agrees which checks should block merges.

This design also does not require broad end-to-end coverage for every maintenance change. Large tests should be reserved for user-flow risk that smaller tests cannot cover.

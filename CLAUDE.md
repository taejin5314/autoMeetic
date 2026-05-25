# CLAUDE.md

Behavior contract for Claude-style agents working in this repository. Merge with `AGENTS.md`, active user instructions, and tool/system instructions. When instructions conflict, obey the higher-priority instruction and document the conflict briefly.

**Tradeoff:** These rules bias toward caution, evidence, and small diffs over speed. For trivial docs-only edits, use judgment but still report what was and was not verified.

---

## Project Entry Contract

Before starting work in this repo:

1. Read `HANDOFF.md` for the active stream, phase state, environment quirks, and verification convention.
2. Read `INDEX.md` to find the relevant code paths before searching broadly.
3. Read `AGENTS.md` for required verification, TDD expectations, and high-risk areas.
4. Inspect `git status --short` and do not overwrite unrelated user changes.
5. For planned work, open the linked spec/plan under `docs/superpowers/specs/` and `docs/superpowers/plans/`.

`README.md` is not the primary source of truth for current architecture. Treat `HANDOFF.md`, `INDEX.md`, and the code as fresher unless the user says otherwise.

---

## Phase Verification Convention (Mandatory)

When implementing any multi-phase plan in `docs/superpowers/plans/*.md`, verify before marking a phase complete anywhere (`HANDOFF.md`, task reports, status updates, PR text):

1. Run `npm run verify` for general verification or `npm run verify:phase <N>` for phase N of the active plan when the plan/HANDOFF requires phase verification.
2. Paste the verbatim output in the final report when requested by the convention. Do not summarize, edit, or fabricate it.
3. Only mark a phase complete when the script's `VERDICT` line is passing.
4. If the verdict fails, fix the failures, rerun, and only then update status.

The script exit code and verdict are the source of truth, not confidence or visual inspection.

Unacceptable behavior:

- Marking a phase complete in `HANDOFF.md` without the required verification.
- Claiming a phase is complete while expected files, IPC bridges, preload types, renderer surfaces, or tests are missing.
- Treating partial verification as full verification.
- Hiding `npm test` failures such as Windows `EBUSY` on `better_sqlite3.node`.

If manual Electron smoke is not run, say so plainly. Use the existing convention: "manual smoke deferred to user."

---

## Required Verification Gate

Before claiming a coding task is complete, run the repo-required checks from `AGENTS.md`:

```bash
npm run typecheck
npm run lint
npm test
```

Also run `npm run build` when changes touch:

- `src/main/**`
- `src/renderer/**`
- `src/preload/**`
- Electron/Vite/TypeScript config
- package dependencies

When `npm test` is blocked before Vitest by the known Windows native-module lock, report the exact blocker and run the closest direct test command that still provides useful evidence, usually `npx vitest run`.

For docs-only edits, a focused formatting check is enough unless the docs change scripts, generated files, or instructions that affect build/test behavior.

---

## Coding Harness Principles

Before non-trivial implementation, define the task boundary. This prevents hidden assumptions, scope creep, and unmeasurable outcomes.

### 1. Problem Framing

Answer these before touching code:

- What exact behavior is being improved?
- What is the unit of evaluation: one component, one user flow, one IPC contract, one test suite?
- What is frozen: public APIs, data shapes, routing, UI conventions?
- What can change?
- What is the expected budget: time, file count, or risk level?

If the unit of evaluation cannot be stated in one sentence, ask one focused question before editing.

### 2. Scope Boundary

- Define the interface the change must satisfy.
- State what is explicitly out of scope.
- If multiple approaches exist, list tradeoffs instead of silently choosing.
- Prefer the smallest blast radius: fewest files, fewest new dependencies, no speculative abstraction.

### 3. Evaluation Plan

Before implementation, state:

- Primary check: test, typecheck, lint, build, visual smoke, or script.
- Secondary risks: latency, bundle size, accessibility, compact layout, IPC compatibility.
- Adjacent areas that could regress.
- Approximate time for one verification loop.

"Make it work" is not an evaluation plan. Convert it to a concrete command or observable behavior.

### 4. Learn From Runs

- Note failed attempts that changed your approach.
- If a recurring error pattern appears, capture a durable rule in this file or `HANDOFF.md` when appropriate.
- Do not silently discard relevant investigation.

---

## Superpowers Development Methodology

Use the available Superpowers skills when their trigger conditions match the task.

Core workflow:

1. Brainstorming: refine rough ideas, explore alternatives, present design before implementation.
2. Planning: break work into small tasks with exact file paths and verification steps.
3. Execution: implement in batches with checkpoints.
4. TDD: for behavior changes and bug fixes, write or update a failing test first when feasible.
5. Review: prioritize regressions, race conditions, missing tests, and contract mismatches.
6. Verification: run the proof before declaring success.

Philosophy:

- Evidence over claims.
- Systematic over ad hoc.
- Simplicity over speculative flexibility.
- Small diffs over broad rewrites.

---

## 1. Think Before Coding

Do not assume. Do not hide confusion. Surface tradeoffs.

Before implementing:

- State assumptions explicitly.
- If multiple interpretations exist, present them.
- If a simpler approach exists, say so.
- If requirements are unclear and cannot be inferred from local context, ask one focused question.

---

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No new dependencies unless the project already uses them or the user approves.
- No error handling for impossible scenarios.
- If a change grows large, look for a smaller boundary before continuing.

Ask: would a senior engineer call this overcomplicated? If yes, simplify.

---

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Do not refactor adjacent code unless required by the task.
- Match the local style even when it is not your preferred style.
- Do not reformat whole files casually.
- If you notice unrelated dead code, mention it instead of deleting it.

When your changes create orphans:

- Remove imports, variables, functions, and tests made obsolete by your change.
- Do not remove pre-existing dead code unless asked.

Every changed line should trace to the user request or required verification cleanup.

---

## 4. Goal-Driven Execution

Transform tasks into verifiable goals:

- "Add validation" means write tests for invalid inputs, then make them pass.
- "Fix the bug" means reproduce it with a focused test or manual proof, then make it pass.
- "Refactor X" means preserve behavior and run the closest characterization tests before and after.

For multi-step tasks, state a short plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Loop until the stated check passes or the blocker is documented.

---

## Project-Specific Guidelines

- Use TypeScript strict mode. Do not introduce `any` unless there is no safer boundary and the reason is documented.
- Treat `src/main/**`, `src/preload/**`, and `src/renderer/**` as a contract chain. IPC changes usually require updates in all three plus tests.
- Use `INDEX.md` to locate the relevant feature area before editing.
- Use `HANDOFF.md` for active stream state. Keep its table accurate; never mark future phases complete.
- Behavior changes and bug fixes should follow TDD when feasible.
- Renderer/main/preload/config/package changes require `npm run build` before completion.
- Preserve user work in a dirty worktree. Never revert unrelated changes.
- If requirements are ambiguous, document the assumption before implementing.

High-risk areas:

- Live feed sentence grouping and auto-scroll.
- Translation source/target language routing.
- Answer assist prompt context.
- Whiteboard element layout and Excalidraw conversion.
- Dark/light theme rendering.
- Renderer/main IPC contracts.
- Memory Library chat citations, source navigation, and cross-meeting search.

---

## UI / Design Guidelines

This app is a React + Vite + Electron workspace with custom CSS, not a Tailwind-first app. Follow existing component and CSS patterns unless the user asks for a design-system change.

Architecture:

- Check `package.json` before importing any third-party library.
- Prefer existing local components, stores, and CSS classes.
- Keep operational tool UI dense, quiet, and scannable.
- Do not add landing-page or marketing-style layouts for app features.
- Avoid nested cards and decorative page sections.
- Use stable dimensions for toolbars, boards, tiles, and fixed-format controls.

Typography and layout:

- Match nearby heading scale and spacing.
- Do not use viewport-width-based font sizing.
- Keep letter spacing at `0` unless an existing class nearby says otherwise.
- Ensure button labels and table text fit at desktop and mobile widths.
- Prefer predictable navigation and compact controls over oversized hero composition.

Color and visual style:

- Respect existing light/dark theme variables.
- Avoid one-note palettes and dominant purple/blue gradients.
- Do not add glow/orb/bokeh decoration.
- Use contrast that remains readable in both themes.

Interaction states:

- Provide loading, empty, error, and disabled states for new interactive surfaces.
- Use familiar controls: icon buttons for tools, tabs for views, toggles for binary settings, inputs/sliders for numeric values, menus for option sets.
- Do not describe UI instructions in visible app text unless it is needed for the workflow.

Manual UI verification:

- For significant frontend changes, run the app and inspect the affected flow when feasible.
- If manual smoke is deferred to the user, record it honestly in `HANDOFF.md` or the final report.

# Maintenance Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the maintenance verification design into repository-level guidance and a small local checklist command.

**Architecture:** Keep policy and automation separate. `AGENTS.md` owns the human-readable rules, `package.json` exposes the command, and `scripts/maintenance-checklist.mjs` inspects changed paths and prints the final verification gate plus risk-specific reminders.

**Tech Stack:** Node.js ESM script, npm scripts, existing TypeScript/Vitest/ESLint/Vite verification commands.

---

## File Structure

- Modify `AGENTS.md`: add the maintenance verification matrix after the existing Required Verification section.
- Modify `package.json`: add a `maintenance:check` npm script.
- Create `scripts/maintenance-checklist.mjs`: a dependency-free Node script that reads changed file names from git and prints recommended checks.

## Task 1: Document Maintenance Verification In AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Insert the maintenance matrix**

Add this block after the existing `Required Verification` section and before `TDD Rule`:

```md
## Maintenance Verification Matrix

Before cleanup, refactoring, bug fixes, or performance work, classify the change:

- `cleanup`: removing unused files, imports, variables, assets, local generated artifacts, or dead code paths.
- `refactor`: changing structure while preserving behavior.
- `bug fix`: changing behavior to correct a defect.
- `performance`: improving latency, bundle size, memory use, startup time, or render work.

Use the smallest focused verification loop while editing, then run the required verification gate before claiming completion.

### Cleanup

- Confirm removed symbols or files have no active references with `rg`.
- Prefer TypeScript and ESLint unused-code signals over manual guessing.
- For generated artifacts, confirm the path is ignored or reproducible.

### Refactor

- State the behavior-preserving invariant before editing.
- Run the closest focused tests before restructuring when practical.
- Add a characterization test first if existing coverage does not protect the behavior.
- Refactor in small steps and rerun focused tests after meaningful steps.

### Bug Fix

- Write or update a failing regression test first when feasible.
- Keep the test focused on the observed defect.
- Make the smallest fix that passes the regression test.

### Performance

- Define the metric before editing.
- Capture a before measurement with a repeatable command or script.
- Define an initial budget or target.
- Capture the after measurement under the same conditions.
- Treat noisy performance checks as reports before promoting them to blocking CI gates.
```

- [ ] **Step 2: Verify the document section is present**

Run:

```powershell
rg -n "Maintenance Verification Matrix|### Cleanup|### Refactor|### Bug Fix|### Performance" AGENTS.md
```

Expected: each heading appears once.

- [ ] **Step 3: Commit the documentation change**

Run:

```powershell
git add AGENTS.md
git commit -m "docs: add maintenance verification matrix"
```

Expected: commit succeeds with only `AGENTS.md` staged.

## Task 2: Add A Maintenance Checklist Command

**Files:**
- Create: `scripts/maintenance-checklist.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the checklist script**

Create `scripts/maintenance-checklist.mjs` with this content:

```js
import { execFileSync } from 'node:child_process'

const BUILD_PATH_PATTERNS = [
  /^src\/main\//,
  /^src\/renderer\//,
  /^src\/preload\//,
  /^electron\.vite\.config\.ts$/,
  /^vite\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /^tsconfig(\.[^.]+)?\.json$/,
  /^package(-lock)?\.json$/,
]

const HIGH_RISK_PATTERNS = [
  {
    name: 'live feed sentence grouping / auto-scroll',
    pattern: /^src\/renderer\/feed\/|transcriptPostProcessor|CaptionOverlay|useCaptionStore/,
    check: 'Run focused feed/transcript tests or add coverage for sentence grouping and renderer state retention.',
  },
  {
    name: 'translation language routing',
    pattern: /^src\/main\/translate\/|translation|language routing/i,
    check: 'Run or add routing tests with explicit source/target language pairs.',
  },
  {
    name: 'answer assist prompt context',
    pattern: /answer-assist|answerAssist|answer-assist-prompt/i,
    check: 'Run prompt assertions or snapshot-style tests for included context.',
  },
  {
    name: 'whiteboard layout / Excalidraw conversion',
    pattern: /whiteboard|Excalidraw|mindmap/i,
    check: 'Run whiteboard layout/conversion tests and inspect compact-preview readability risk.',
  },
  {
    name: 'theme rendering',
    pattern: /theme|App\.css|index\.css/i,
    check: 'Run renderer state checks and perform a visual smoke check when practical.',
  },
  {
    name: 'renderer/main IPC contracts',
    pattern: /ipc|preload|api\.ts/i,
    check: 'Run or add adapter tests that validate request and response shapes.',
  },
]

function normalizePath(path) {
  return path.replaceAll('\\\\', '/')
}

export function classifyChangedFiles(files) {
  const normalized = files.map(normalizePath).filter(Boolean)
  const requiresBuild = normalized.some((file) => BUILD_PATH_PATTERNS.some((pattern) => pattern.test(file)))
  const highRisk = HIGH_RISK_PATTERNS.filter((risk) => normalized.some((file) => risk.pattern.test(file)))

  return {
    files: normalized,
    requiresBuild,
    highRisk,
  }
}

export function formatChecklist(classification) {
  const lines = []

  lines.push('Maintenance verification checklist')
  lines.push('')

  if (classification.files.length === 0) {
    lines.push('Changed files: none detected against HEAD.')
  } else {
    lines.push('Changed files:')
    for (const file of classification.files) {
      lines.push(`- ${file}`)
    }
  }

  lines.push('')
  lines.push('Required final verification:')
  lines.push('- npm run typecheck')
  lines.push('- npm run lint')
  lines.push('- npm test')

  if (classification.requiresBuild) {
    lines.push('- npm run build')
  }

  if (classification.highRisk.length > 0) {
    lines.push('')
    lines.push('High-risk focused checks:')
    for (const risk of classification.highRisk) {
      lines.push(`- ${risk.name}: ${risk.check}`)
    }
  }

  lines.push('')
  lines.push('Before editing, classify the task as cleanup, refactor, bug fix, or performance work.')
  lines.push('For performance work, capture before/after measurements under the same conditions.')

  return lines.join('\n')
}

function readChangedFiles() {
  const output = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return output.split(/\r?\n/u)
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\\\', '/')}`) {
  const classification = classifyChangedFiles(readChangedFiles())
  console.log(formatChecklist(classification))
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add this script near the existing verification scripts:

```json
"maintenance:check": "node scripts/maintenance-checklist.mjs",
```

The surrounding `scripts` block should keep valid JSON commas.

- [ ] **Step 3: Smoke-test the checklist script**

Run:

```powershell
npm run maintenance:check
```

Expected: output begins with `Maintenance verification checklist` and lists `npm run typecheck`, `npm run lint`, and `npm test`. If current changes touch `src/main/**`, `src/renderer/**`, `src/preload/**`, config, or package files, output also lists `npm run build`.

- [ ] **Step 4: Run syntax and lint verification**

Run:

```powershell
npm run lint
```

Expected: exit 0.

- [ ] **Step 5: Commit the checklist command**

Run:

```powershell
git add package.json scripts/maintenance-checklist.mjs
git commit -m "chore: add maintenance checklist command"
```

Expected: commit succeeds with only `package.json` and `scripts/maintenance-checklist.mjs` staged.

## Task 3: Final Verification

**Files:**
- No new file edits.

- [ ] **Step 1: Run the repository verification gate**

Run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Expected:

- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `npm test` exits 0.
- `npm run build` exits 0. Vite chunk-size warnings are acceptable if the command exits 0.

- [ ] **Step 2: Confirm working tree status**

Run:

```powershell
git status --short
```

Expected: only pre-existing unrelated user changes remain unstaged, or no changes remain if those were handled separately.

## Self-Review

- Spec coverage: This plan implements repository guidance, a local checklist command, high-risk reminders, and the required final verification gate from `docs/superpowers/specs/2026-05-22-maintenance-verification-design.md`.
- Placeholder scan: No placeholder tasks remain.
- Type consistency: Script functions are named `classifyChangedFiles` and `formatChecklist` consistently.

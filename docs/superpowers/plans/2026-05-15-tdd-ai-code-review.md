# TDD AI Code Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reliable TDD, CI, and AI-assisted code review foundation for AutoMeetic.

**Architecture:** Start with deterministic local checks that AI agents cannot bypass: Vitest unit tests, coverage support, GitHub Actions CI, and project-level agent instructions. Add repo-side AI review configuration so Codex, GitHub Copilot, and CodeRabbit-style reviewers share the same expectations.

**Tech Stack:** TypeScript 6, Vite 8, React 19, Electron Vite, Vitest, V8 coverage, GitHub Actions, Markdown agent/review instructions.

---

## File Structure

- Create: `vitest.config.ts`
  - Owns Vitest configuration for Node-oriented unit tests.
- Create: `src/test/whiteboard-layout.test.ts`
  - Converts the current whiteboard regression script into an automated test suite.
- Modify: `package.json`
  - Adds `test`, `test:watch`, `test:coverage`, and `ci` scripts.
  - Adds test dev dependencies.
- Modify: `package-lock.json`
  - Updated by `npm install`.
- Create: `.github/workflows/ci.yml`
  - Runs install, typecheck, lint, tests, and build on PR/push.
- Create: `AGENTS.md`
  - Gives Codex and other coding agents project-specific TDD and verification rules.
- Create: `.github/copilot-instructions.md`
  - Gives GitHub Copilot/Copilot Review concise repo instructions.
- Create: `.github/pull_request_template.md`
  - Makes test evidence visible on every PR.
- Create: `.coderabbit.yaml`
  - Optional repo-side CodeRabbit configuration if the GitHub app is installed later.
- Delete: `scripts/whiteboard-layout-regression.ts`
  - Remove the temporary standalone regression script after the Vitest test exists.

---

### Task 1: Install Vitest Test Harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install test dependencies**

Run:

```powershell
npm install -D vitest @vitest/coverage-v8
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

If npm reports nonzero vulnerabilities, do not fix unrelated dependency ranges in this task. Record the output and continue only if installation succeeded.

- [ ] **Step 2: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      exclude: [
        "src/**/*.test.ts",
        "src/renderer/**",
        "src/preload/**",
        "src/**/*.d.ts",
      ],
    },
  },
});
```

- [ ] **Step 3: Add npm scripts**

Modify `package.json` scripts to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "ci": "npm run typecheck && npm run lint && npm test && npm run build"
}
```

Keep all existing scripts unchanged.

- [ ] **Step 4: Run test command with no tests**

Run:

```powershell
npm test
```

Expected:

```text
No test files found
```

Vitest may exit with code 1 when no tests exist. That is acceptable for this step because Task 2 adds the first test.

- [ ] **Step 5: Commit**

Run:

```powershell
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest harness"
```

Expected:

```text
[branch ...] test: add vitest harness
```

---

### Task 2: Convert Whiteboard Layout Regression Into Vitest

**Files:**
- Create: `src/test/whiteboard-layout.test.ts`
- Delete: `scripts/whiteboard-layout-regression.ts`

- [ ] **Step 1: Write the failing/passing regression test**

Create `src/test/whiteboard-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  detectMalformedLayoutWarnings,
  repairWhiteboardLayout,
} from "../main/whiteboard/elements";
import type { WhiteboardElement } from "../main/whiteboard/types";

describe("repairWhiteboardLayout", () => {
  it("wraps crowded three-node diagrams and removes arrow labels that collide in compact previews", () => {
    const crowdedThreeNodeDiagram: WhiteboardElement[] = [
      {
        id: "challenge",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 160,
        height: 56,
        label: { text: "Challenge" },
        backgroundColor: "#a5d8ff",
      },
      {
        id: "meaning",
        type: "rectangle",
        x: 220,
        y: 0,
        width: 160,
        height: 56,
        label: { text: "Meaning" },
        backgroundColor: "#a5d8ff",
      },
      {
        id: "start",
        type: "rectangle",
        x: 440,
        y: 0,
        width: 160,
        height: 56,
        label: { text: "Start" },
        backgroundColor: "#a5d8ff",
      },
      {
        id: "arrow-a",
        type: "arrow",
        x: 160,
        y: 28,
        width: 60,
        height: 0,
        points: [
          [0, 0],
          [60, 0],
        ],
        label: { text: "means" },
        endArrowType: "arrow",
      },
      {
        id: "arrow-b",
        type: "arrow",
        x: 380,
        y: 28,
        width: 60,
        height: 0,
        points: [
          [0, 0],
          [60, 0],
        ],
        label: { text: "starts" },
        endArrowType: "arrow",
      },
    ];

    const repaired = repairWhiteboardLayout(crowdedThreeNodeDiagram);
    const shapes = repaired.filter((element) => element.type === "rectangle");
    const arrows = repaired.filter((element) => element.type === "arrow");
    const left = Math.min(...shapes.map((shape) => shape.x));
    const right = Math.max(...shapes.map((shape) => shape.x + (shape.width ?? 0)));
    const top = Math.min(...shapes.map((shape) => shape.y));
    const bottom = Math.max(...shapes.map((shape) => shape.y + (shape.height ?? 0)));

    expect(right - left).toBeLessThanOrEqual(700);
    expect(bottom - top).toBeGreaterThan(120);
    expect(arrows.every((arrow) => !arrow.label?.text)).toBe(true);
    expect(detectMalformedLayoutWarnings(repaired)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
npm test -- src/test/whiteboard-layout.test.ts
```

Expected:

```text
1 passed
```

If it fails, inspect `src/main/whiteboard/elements.ts` before changing the test. The expected behavior is no overlap warnings, compact width <= 700px, and removed inline arrow labels.

- [ ] **Step 3: Remove the temporary script**

Run:

```powershell
Remove-Item -LiteralPath scripts\whiteboard-layout-regression.ts
```

Expected:

```text
no output
```

- [ ] **Step 4: Run all tests**

Run:

```powershell
npm test
```

Expected:

```text
1 passed
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/test/whiteboard-layout.test.ts scripts/whiteboard-layout-regression.ts
git commit -m "test: cover whiteboard layout repair"
```

Expected:

```text
[branch ...] test: cover whiteboard layout repair
```

---

### Task 3: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main
      - master

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

- [ ] **Step 2: Validate workflow YAML shape locally**

Run:

```powershell
Get-Content -Raw .github\workflows\ci.yml
```

Expected:

```text
name: CI
...
run: npm run build
```

This repository does not currently include a YAML validator. Manual file read is enough for this task.

- [ ] **Step 3: Run the same checks locally**

Run:

```powershell
npm run ci
```

Expected:

```text
typecheck passes
lint passes
tests pass
build passes
```

If build fails due to an existing unrelated issue, record the exact error and do not hide it by weakening CI.

- [ ] **Step 4: Commit**

Run:

```powershell
git add .github/workflows/ci.yml package.json package-lock.json
git commit -m "ci: verify pull requests"
```

Expected:

```text
[branch ...] ci: verify pull requests
```

---

### Task 4: Add Agent Instructions For TDD And Review

**Files:**
- Create: `AGENTS.md`
- Create: `.github/copilot-instructions.md`

- [ ] **Step 1: Create root agent instructions**

Create `AGENTS.md`:

```md
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

## Code Review Expectations

Prioritize:

- behavioral regressions
- race conditions
- lost renderer state after theme changes or modal remounts
- missing tests for bug fixes
- brittle string parsing where structured data is available
- changes that make diagrams unreadable in compact preview

Do not revert unrelated user changes in the worktree.
```

- [ ] **Step 2: Create Copilot-specific instructions**

Create `.github/copilot-instructions.md`:

```md
# AutoMeetic Copilot Instructions

AutoMeetic is a TypeScript, React, Vite, and Electron application.

Before suggesting completion for code changes, prefer evidence from:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` for integration changes

For reviews, focus on:

- live caption latency and sentence grouping regressions
- whiteboard diagram overlap, lost elements, and theme readability
- source/target language routing bugs
- answer assist prompt/context mismatches
- missing regression tests for user-reported bugs

When proposing fixes, prefer small patches that follow existing project patterns.
```

- [ ] **Step 3: Review instruction files for contradictions**

Run:

```powershell
Get-Content -Raw AGENTS.md
Get-Content -Raw .github\copilot-instructions.md
```

Expected:

```text
Both files mention the same verification commands and high-risk areas.
```

- [ ] **Step 4: Commit**

Run:

```powershell
git add AGENTS.md .github/copilot-instructions.md
git commit -m "docs: add agent coding instructions"
```

Expected:

```text
[branch ...] docs: add agent coding instructions
```

---

### Task 5: Add PR Template

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Create PR template**

Create `.github/pull_request_template.md`:

```md
## Summary

-

## Test Plan

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build` when integration code changed
- [ ] Manual UI check when renderer behavior changed

## Risk Areas

- [ ] live feed
- [ ] translation/language routing
- [ ] answer assist
- [ ] whiteboard/diagram layout
- [ ] dark/light theme
- [ ] renderer/main IPC
- [ ] packaging/build

## Notes For Reviewers

-
```

- [ ] **Step 2: Verify template reads cleanly**

Run:

```powershell
Get-Content -Raw .github\pull_request_template.md
```

Expected:

```text
The file includes Summary, Test Plan, Risk Areas, and Notes For Reviewers.
```

- [ ] **Step 3: Commit**

Run:

```powershell
git add .github/pull_request_template.md
git commit -m "docs: add pull request template"
```

Expected:

```text
[branch ...] docs: add pull request template
```

---

### Task 6: Add Optional CodeRabbit Configuration

**Files:**
- Create: `.coderabbit.yaml`

- [ ] **Step 1: Create CodeRabbit configuration**

Create `.coderabbit.yaml`:

```yaml
language: en-US

reviews:
  profile: chill
  request_changes_workflow: false
  high_level_summary: true
  review_status: true
  collapse_walkthrough: true
  path_filters:
    - "!package-lock.json"
    - "!dist/**"
    - "!out/**"
    - "!coverage/**"
  auto_review:
    enabled: true
    drafts: false

chat:
  auto_reply: true

knowledge_base:
  opt_out: false

early_access: false
```

This file is harmless if CodeRabbit is not installed. If the app is installed later, it gives reviews a quieter default and avoids reviewing generated output.

- [ ] **Step 2: Verify config file**

Run:

```powershell
Get-Content -Raw .coderabbit.yaml
```

Expected:

```text
reviews:
  profile: chill
```

- [ ] **Step 3: Commit**

Run:

```powershell
git add .coderabbit.yaml
git commit -m "chore: add ai review configuration"
```

Expected:

```text
[branch ...] chore: add ai review configuration
```

---

### Task 7: Final Verification

**Files:**
- Read: `package.json`
- Read: `vitest.config.ts`
- Read: `.github/workflows/ci.yml`
- Read: `AGENTS.md`

- [ ] **Step 1: Run full local CI**

Run:

```powershell
npm run ci
```

Expected:

```text
npm run typecheck passes
npm run lint passes
npm test passes
npm run build passes
```

- [ ] **Step 2: Run coverage once**

Run:

```powershell
npm run test:coverage
```

Expected:

```text
Coverage report from v8
```

No coverage threshold is required in this initial plan. Thresholds should be added after the test suite has real breadth.

- [ ] **Step 3: Check git diff for whitespace issues**

Run:

```powershell
git diff --check
```

Expected:

```text
no output
```

- [ ] **Step 4: Inspect final status**

Run:

```powershell
git status --short
```

Expected:

```text
no output
```

If unrelated pre-existing files are still modified, list them in the handoff instead of reverting them.

---

## Self-Review Notes

- Spec coverage: The plan covers TDD setup, CI enforcement, agent instructions, PR template, and optional AI review configuration.
- Placeholder scan: No placeholder markers or undefined future work remains in task steps.
- Type consistency: The test imports `repairWhiteboardLayout` and `detectMalformedLayoutWarnings` from the existing `src/main/whiteboard/elements.ts` module and uses the existing `WhiteboardElement` type.

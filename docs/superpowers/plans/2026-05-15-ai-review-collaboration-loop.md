# AI Review Collaboration Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode a risk-based AI review loop into repo guardrails so every PR captures risk, evidence, and explicit triage decisions.

**Architecture:** Add lightweight, file-content guardrail tests that fail when PR/review process rules drift. Then update the PR template, AGENTS guidance, and CodeRabbit config to align Codex, CodeRabbit, Copilot, and CI roles from the design spec. Keep the implementation documentation-first with deterministic checks via `npm test` and `npm run ci`.

**Tech Stack:** Markdown docs/config (`.github/pull_request_template.md`, `AGENTS.md`, `.coderabbit.yaml`), TypeScript + Vitest (`src/test/*.test.ts`), npm CI scripts.

---

## Scope Check

This spec is a single subsystem (review-process governance). It touches PR metadata, agent instructions, and review configuration, but all changes ship as one coherent flow and should remain in one plan.

---

## File Structure

- Create: `src/test/ai-review-collaboration.test.ts`
  - Repository guardrail tests that assert required review-loop content is present.
- Modify: `.github/pull_request_template.md`
  - Adds concise evidence-first PR sections and triage buckets (`must-fix`, `should-fix`, `note`).
- Modify: `AGENTS.md`
  - Makes AI feedback triage rules explicit and enforces verification before completion.
- Modify: `.coderabbit.yaml`
  - Biases automated review toward correctness, tests, async/state safety, and high-risk paths.

---

### Task 1: Add PR Template Guardrail With TDD

**Files:**
- Create: `src/test/ai-review-collaboration.test.ts`
- Modify: `.github/pull_request_template.md`
- Test: `src/test/ai-review-collaboration.test.ts`

- [ ] **Step 1: Write the failing test for PR template structure**

Create `src/test/ai-review-collaboration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readText = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("ai review collaboration guardrails", () => {
  it("requires PR template risk, evidence, and triage sections", () => {
    const template = readText(".github/pull_request_template.md");

    expect(template).toContain("## Summary");
    expect(template).toContain("## Risk Areas");
    expect(template).toContain("## Test Evidence");
    expect(template).toContain("## AI Review Triage");
    expect(template).toContain("must-fix");
    expect(template).toContain("should-fix");
    expect(template).toContain("note");
    expect(template).toContain("## Deferred Follow-Ups");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts
```

Expected:

```text
FAIL src/test/ai-review-collaboration.test.ts
... expected ".github/pull_request_template.md" to contain "## Test Evidence"
```

- [ ] **Step 3: Update PR template with evidence-first sections**

Replace `.github/pull_request_template.md` with:

```md
## Summary

-

## Risk Areas

- [ ] live feed sentence grouping / auto-scroll
- [ ] translation source/target language routing
- [ ] answer assist prompt/context
- [ ] whiteboard layout / Excalidraw conversion
- [ ] renderer/main IPC contracts
- [ ] proxy/network failure modes
- [ ] packaging/build

## Test Evidence

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build` (required when `src/main/**`, `src/renderer/**`, `src/preload/**`, config, or dependencies changed)
- [ ] Additional targeted checks (list command + result)

## AI Review Triage

List unresolved or accepted AI review comments and classify each as one of:

- `must-fix`:
- `should-fix`:
- `note`:

If no blocking findings:

- `No must-fix findings`

## Deferred Follow-Ups

- Include any intentionally deferred `should-fix` items and linked issue/next PR.

## Notes For Reviewers

- If CI is failing, fix CI before lower-severity review comments.
- If an AI finding is non-reproducible, add a test proving safe behavior or explain why it is not applicable.
```

- [ ] **Step 4: Re-run focused test and confirm pass**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts
```

Expected:

```text
PASS src/test/ai-review-collaboration.test.ts
1 passed
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/test/ai-review-collaboration.test.ts .github/pull_request_template.md
git commit -m "test+docs: enforce PR triage template"
```

Expected:

```text
[branch ...] test+docs: enforce PR triage template
```

---

### Task 2: Add AGENTS Triage Rules With TDD

**Files:**
- Modify: `src/test/ai-review-collaboration.test.ts`
- Modify: `AGENTS.md`
- Test: `src/test/ai-review-collaboration.test.ts`

- [ ] **Step 1: Extend test with AGENTS requirements (should fail first)**

Update `src/test/ai-review-collaboration.test.ts` to:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readText = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("ai review collaboration guardrails", () => {
  it("requires PR template risk, evidence, and triage sections", () => {
    const template = readText(".github/pull_request_template.md");

    expect(template).toContain("## Summary");
    expect(template).toContain("## Risk Areas");
    expect(template).toContain("## Test Evidence");
    expect(template).toContain("## AI Review Triage");
    expect(template).toContain("must-fix");
    expect(template).toContain("should-fix");
    expect(template).toContain("note");
    expect(template).toContain("## Deferred Follow-Ups");
  });

  it("requires AGENTS guidance for AI review triage and verification", () => {
    const agents = readText("AGENTS.md");

    expect(agents).toContain("Do not treat all AI review comments as correct.");
    expect(agents).toContain("Investigate every `must-fix` candidate.");
    expect(agents).toContain("Prefer adding a regression test before fixing a bug.");
    expect(agents).toContain("Explain any deferred `should-fix` comment in the PR.");
    expect(agents).toContain("Never mark work complete until verification commands have passed");
  });
});
```

- [ ] **Step 2: Run focused test and confirm new AGENTS assertions fail**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts
```

Expected:

```text
FAIL src/test/ai-review-collaboration.test.ts > ... AGENTS guidance ...
... expected "AGENTS.md" to contain "Do not treat all AI review comments as correct."
```

- [ ] **Step 3: Update AGENTS instructions**

Replace `AGENTS.md` with:

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
```

- [ ] **Step 4: Re-run focused test and confirm pass**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts
```

Expected:

```text
PASS src/test/ai-review-collaboration.test.ts
2 passed
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/test/ai-review-collaboration.test.ts AGENTS.md
git commit -m "docs: codify AI review triage loop"
```

Expected:

```text
[branch ...] docs: codify AI review triage loop
```

---

### Task 3: Bias CodeRabbit Toward Risk Signals With TDD

**Files:**
- Modify: `src/test/ai-review-collaboration.test.ts`
- Modify: `.coderabbit.yaml`
- Test: `src/test/ai-review-collaboration.test.ts`

- [ ] **Step 1: Extend test for CodeRabbit priorities (fail first)**

Update `src/test/ai-review-collaboration.test.ts` to:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readText = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("ai review collaboration guardrails", () => {
  it("requires PR template risk, evidence, and triage sections", () => {
    const template = readText(".github/pull_request_template.md");

    expect(template).toContain("## Summary");
    expect(template).toContain("## Risk Areas");
    expect(template).toContain("## Test Evidence");
    expect(template).toContain("## AI Review Triage");
    expect(template).toContain("must-fix");
    expect(template).toContain("should-fix");
    expect(template).toContain("note");
    expect(template).toContain("## Deferred Follow-Ups");
  });

  it("requires AGENTS guidance for AI review triage and verification", () => {
    const agents = readText("AGENTS.md");

    expect(agents).toContain("Do not treat all AI review comments as correct.");
    expect(agents).toContain("Investigate every `must-fix` candidate.");
    expect(agents).toContain("Prefer adding a regression test before fixing a bug.");
    expect(agents).toContain("Explain any deferred `should-fix` comment in the PR.");
    expect(agents).toContain("Never mark work complete until verification commands have passed");
  });

  it("requires CodeRabbit focus on correctness, risk paths, and missing tests", () => {
    const codeRabbit = readText(".coderabbit.yaml");

    expect(codeRabbit).toContain("profile: assertive");
    expect(codeRabbit).toContain("request_changes_workflow: true");
    expect(codeRabbit).toContain("path_instructions:");
    expect(codeRabbit).toContain("src/renderer/**");
    expect(codeRabbit).toContain("src/main/whiteboard/**");
    expect(codeRabbit).toContain("src/main/ipc.ts");
    expect(codeRabbit).toContain("src/main/proxyService.ts");
    expect(codeRabbit).toContain("avoid style-only comments");
    expect(codeRabbit).toContain("ask for regression tests");
  });
});
```

- [ ] **Step 2: Run focused test and confirm CodeRabbit assertions fail**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts
```

Expected:

```text
FAIL src/test/ai-review-collaboration.test.ts > ... CodeRabbit focus ...
... expected ".coderabbit.yaml" to contain "profile: assertive"
```

- [ ] **Step 3: Update CodeRabbit config for risk-based review**

Replace `.coderabbit.yaml` with:

```yaml
language: en-US

reviews:
  profile: assertive
  request_changes_workflow: true
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
  path_instructions:
    - path: "src/renderer/**"
      instructions: "Prioritize UI behavior regressions, state-sync issues, and user-visible failures. Ask for regression tests when behavior changes."
    - path: "src/main/whiteboard/**"
      instructions: "Prioritize diagram overlap, lost elements, and compact-preview readability regressions. Ask for regression tests when behavior changes."
    - path: "src/main/ipc.ts"
      instructions: "Prioritize renderer/main contract safety, async ordering, and failure handling."
    - path: "src/main/proxyService.ts"
      instructions: "Prioritize network failure handling, retries/timeouts, and production-risk behavior."
  poem: false

chat:
  auto_reply: true

knowledge_base:
  opt_out: false

# Review policy notes:
# - Emphasize correctness, tests, security, performance, and maintainability.
# - Avoid style-only comments unless readability or correctness is impacted.
# - For risky behavior changes, ask for regression tests.
# - Watch renderer, whiteboard, IPC, and proxy code carefully.

early_access: false
```

- [ ] **Step 4: Re-run focused test and confirm pass**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts
```

Expected:

```text
PASS src/test/ai-review-collaboration.test.ts
3 passed
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/test/ai-review-collaboration.test.ts .coderabbit.yaml
git commit -m "chore: tune coderabbit for risk-first review"
```

Expected:

```text
[branch ...] chore: tune coderabbit for risk-first review
```

---

### Task 4: End-to-End Verification and PR Readiness

**Files:**
- Validate only (no file changes)

- [ ] **Step 1: Run full local gate**

Run:

```bash
npm run ci
```

Expected:

```text
> npm run typecheck && npm run lint && npm test && npm run build
... completed successfully
```

- [ ] **Step 2: Confirm guardrail test is in suite output**

Run:

```bash
npm test -- src/test/ai-review-collaboration.test.ts --reporter=verbose
```

Expected:

```text
ai review collaboration guardrails
  ✓ requires PR template risk, evidence, and triage sections
  ✓ requires AGENTS guidance for AI review triage and verification
  ✓ requires CodeRabbit focus on correctness, risk paths, and missing tests
```

- [ ] **Step 3: Validate staged diff scope before opening PR**

Run:

```bash
git diff --name-only main...HEAD
```

Expected:

```text
.github/pull_request_template.md
AGENTS.md
.coderabbit.yaml
src/test/ai-review-collaboration.test.ts
```

- [ ] **Step 4: Final commit for verification notes (if needed)**

Run only if verification required follow-up edits:

```bash
git add -A
git commit -m "chore: finalize AI review collaboration guardrails"
```

Expected:

```text
nothing to commit
```

If there are changes, the commit should contain only verification-driven fixes.

---

## Self-Review

### 1) Spec Coverage Check

- Goal/problem framing covered by Task 1 template + Task 2 AGENTS + Task 3 CodeRabbit + Task 4 CI verification.
- Role split (Codex/CodeRabbit/Copilot/GitHub Actions) captured in AGENTS bullets and PR template reviewer notes; CI enforcement validated in Task 4.
- Comment classification (`must-fix`, `should-fix`, `note`) implemented in PR template and AGENTS assertions.
- PR template changes implemented directly in Task 1.
- Agent instruction changes implemented directly in Task 2.
- CodeRabbit configuration bias implemented directly in Task 3.
- Data-flow/error-handling behaviors represented in reviewer notes + AGENTS triage loop + CI-first handling.
- Success criteria covered by required risk/test sections and deterministic local verification (`npm run ci`).

### 2) Placeholder Scan

- No `TODO`, `TBD`, or "implement later" placeholders.
- Every code-changing step includes full code to apply.
- Every execution step includes exact command + expected result.

### 3) Type/Name Consistency

- Classification labels are consistently `must-fix`, `should-fix`, `note` across tests and docs.
- Guardrail test file path and test titles are consistent across all tasks.
- Verification commands match repository scripts in `package.json` (`npm run ci`, `npm test`).

# AI Review Collaboration Design

Date: 2026-05-15

## Goal

Make AI-assisted review useful by focusing it on missed bugs and clear next actions. The system should reduce vague review noise, avoid duplicated AI comments, and make every PR answer three questions:

- What could break?
- What evidence proves it works?
- Which review comments are must-fix versus intentionally deferred?

## Problem

AutoMeetic now has a working CI and AI review foundation, but the next risk is review ambiguity. Multiple AI helpers can comment on the same code without shared roles, and that can bury the useful findings. The main failures to prevent are:

- Important defects getting missed, especially UI regressions, async/state bugs, native dependency issues, and missing tests.
- Review comments creating unclear work, where it is not obvious whether a comment must be fixed, can be deferred, or is only informational.

## Recommended Approach

Use a Risk-Based AI Review Loop.

Codex remains the implementation and local verification agent. It must identify risky paths before implementation, add or update focused tests where practical, and provide CI evidence when opening or updating a PR.

CodeRabbit acts as the PR risk reviewer. Its review should prioritize correctness, security, test coverage, maintainability risks, async/state behavior, and production failure modes. It should avoid low-value style comments unless they affect readability or correctness.

Copilot stays lightweight. It can help while editing and may provide broad PR suggestions, but it should not be treated as the primary risk reviewer.

GitHub Actions is the final mechanical gate. AI comments cannot override failing CI.

## Roles

### Codex

Codex owns implementation quality before review:

- State expected risk areas for each non-trivial PR.
- Prefer test-first changes for bug fixes and risky behavior changes.
- Run `npm run ci` before claiming the PR is ready.
- Summarize test evidence in the PR.
- Triage AI review comments by impact rather than accepting every suggestion.

### CodeRabbit

CodeRabbit owns PR risk discovery:

- Look for correctness bugs, race conditions, state sync issues, and missing coverage.
- Flag UI behavior regressions when the changed code touches renderer or whiteboard logic.
- Mark comments with a clear severity or action level when possible.
- Avoid commenting on formatting that the repo tooling already controls.

### Copilot

Copilot owns low-friction coding assistance:

- Help write code and tests during development.
- Keep PR review suggestions lightweight.
- Do not duplicate CodeRabbit's risk-review role.

### GitHub Actions

GitHub Actions owns deterministic enforcement:

- Install dependencies from the lockfile.
- Run typecheck, lint, tests, and build.
- Block merge when CI fails.

## Review Comment Classification

All review feedback should be sorted into one of three buckets before action:

- `must-fix`: A likely bug, failing test, security issue, data loss risk, broken UX path, or CI failure.
- `should-fix`: A maintainability or clarity issue that is worth fixing in the PR if it is nearby and low risk.
- `note`: Context, preference, or future improvement that should not block the PR.

If a comment cannot be classified, Codex should investigate the code path or reproduce the issue before deciding.

## PR Template Changes

The PR template should ask for concise evidence, not long prose:

- Summary
- Risk areas
- Test evidence
- AI review triage
- Deferred follow-ups

The AI review triage section should list unresolved or accepted review comments using the three action levels. A PR with no relevant AI feedback can say `No must-fix findings`.

## Agent Instruction Changes

`AGENTS.md` should make the review loop explicit:

- Do not treat all AI review comments as correct.
- Investigate every `must-fix` candidate.
- Prefer adding a regression test before fixing a bug.
- Explain any deferred `should-fix` comment in the PR.
- Never mark work complete until verification commands have passed or the failure is clearly documented.

## CodeRabbit Configuration Changes

`.coderabbit.yaml` should bias reviews toward high-signal comments:

- Emphasize correctness, tests, security, performance, and maintainability.
- De-emphasize style-only comments.
- Ask for missing tests when behavior changes.
- Watch renderer, whiteboard, IPC, and proxy code more carefully because they are high-risk surfaces.

## Data Flow

1. Codex implements a change and runs local verification.
2. Codex opens or updates the PR with risk areas and test evidence.
3. GitHub Actions runs the deterministic checks.
4. CodeRabbit reviews the diff for risk-based issues.
5. Codex classifies feedback as `must-fix`, `should-fix`, or `note`.
6. Codex fixes must-fix issues, updates tests, reruns verification, and updates the PR.
7. Deferred items are documented as follow-ups rather than silently ignored.

## Error Handling

If CI fails, fix CI before addressing lower-severity review comments.

If CodeRabbit reports a bug that cannot be reproduced, inspect the surrounding code and either add a test proving the safe behavior or document why the finding is not applicable.

If multiple AI tools give conflicting suggestions, prefer the suggestion backed by a failing test, reproducible behavior, or clear production risk.

If the PR becomes too large to review, split the remaining work into a follow-up PR rather than expanding the review scope.

## Testing Strategy

This design does not require new product tests directly. The implementation should be verified by:

- Running `npm run ci`.
- Opening a small test PR or using the next feature PR to confirm the template and review instructions produce useful output.
- Checking that CodeRabbit comments are more focused on risk and missing tests than style-only feedback.

## Success Criteria

The loop is working when:

- Every PR includes risk areas and test evidence.
- AI review comments can be quickly sorted into `must-fix`, `should-fix`, and `note`.
- Must-fix comments lead to code changes, tests, or explicit technical rebuttals.
- CI remains the final merge gate.
- Developers spend less time interpreting AI comments and more time fixing real issues.

## Out of Scope

- Enforcing hard coverage thresholds.
- Blocking all PRs without new tests.
- Replacing human judgment with AI review.
- Adding paid services or new GitHub apps beyond the existing CodeRabbit configuration.

# Domain Spec: autoMeetic Frontend Harness

## Domain Summary

Optimize the AI coding harness for the autoMeetic React + Vite + TypeScript project.

**Unit of evaluation:** One feature implementation that passes `tsc --noEmit` AND `eslint --max-warnings 0`.

**Fixed:** Base model (Claude Sonnet 4.6), project stack (React + Vite + TS), CLAUDE.md rules.

**Changeable:** Context selection strategy (which files to include), file inclusion order, memory/logging patterns.

**Budget:** Up to 10 candidate harness evaluations per feature task.

## Harness and Search Plan

Every candidate harness must satisfy this interface:

```python
class BaseHarness:
    def build_context(self, task: str) -> str: ...  # returns context string for Claude
    def evaluate(self) -> EvalResult: ...           # runs tsc + eslint, returns score
    def log_run(self, task: str, result: EvalResult) -> None: ...  # persists run
```

**Base harness (starting point):** CLAUDE.md + package.json + all src/*.tsx + src/*.ts

**Out of scope (first pass):** model changes, Vitest setup, API integration tests.

**Candidate variants to try:**
1. Task-keyword-filtered file selection (only include files mentioned in task)
2. Reverse order (most recently modified files first)
3. Minimal context (CLAUDE.md + package.json only)

**Blast-radius rule:** Prefer the variant with fewest files that still passes evaluation.

## Evaluation Plan

| Metric | Weight | Passing condition |
|---|---|---|
| `tsc --noEmit` | 0.6 | exit code 0 |
| `eslint src --max-warnings 0` | 0.4 | exit code 0 |

**Score:** `0.6 * tsc_pass + 0.4 * eslint_pass` → 1.0 = fully passing.

**Runtime per candidate:** ~5–15 seconds (static analysis only, no browser).

**Leakage risk:** None — evaluation is fully static, no held-out data involved.

**Noise:** Low — deterministic tools.

## Experience and Logging

**Per-run artifacts:**
- `harness/last_context.md` — full context sent to Claude on last run
- `harness/runs.jsonl` — one JSON line per run: task, score, tsc_pass, eslint_pass, timestamp

**Tooling:** `uv run python run.py --task "..."` from the `harness/` directory.

## Open Questions and Unknowns

- **Test framework:** Vitest not yet set up. Will add as third metric (weight 0.2, redistribute) when ready.
- **Held-out task set:** `unknown` — will define 5–10 representative tasks as project grows.
- **Proposer integration:** Currently manual (human reads context, Claude Code implements). Automated proposer loop is out of scope until task set exists.

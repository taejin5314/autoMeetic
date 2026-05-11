#!/usr/bin/env python3
"""
run.py — Meta-Harness entry point for autoMeetic.

Usage:
    uv run python run.py --task "Add a login form component"
    uv run python run.py --task "..." --strategy filtered --iterations 5

Steps:
  1. Build context for each strategy variant
  2. Run tsc + eslint evaluation (baseline — before Claude implements anything)
  3. Write context to last_context.md for Claude to read
  4. Log result to runs.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import get_args

from context_builder import Strategy, build_context
from evaluate import EvalResult, evaluate

try:
    from rich.console import Console
    from rich.table import Table

    console = Console()
    _rich = True
except ImportError:
    _rich = False

HERE = Path(__file__).parent
PROJECT_ROOT = HERE.parent
RUNS_LOG = HERE / "runs.jsonl"
LAST_CONTEXT = HERE / "last_context.md"

STRATEGIES: list[Strategy] = list(get_args(Strategy))


# ── helpers ──────────────────────────────────────────────────────────────────


def _print(msg: str) -> None:
    if _rich:
        console.print(msg)
    else:
        print(msg)


def _log_run(task: str, strategy: Strategy, result: EvalResult) -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "task": task,
        "strategy": strategy,
        "score": result.score,
        "tsc": result.tsc_passed,
        "eslint": result.eslint_passed,
    }
    with RUNS_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _show_result(strategy: Strategy, result: EvalResult) -> None:
    tsc = "[green]✓[/green]" if result.tsc_passed else "[red]✗[/red]"
    esl = "[green]✓[/green]" if result.eslint_passed else "[red]✗[/red]"
    score_color = "green" if result.passed else "yellow" if result.score > 0 else "red"
    _print(
        f"  [{score_color}]{strategy:10}[/{score_color}]  "
        f"tsc {tsc}  eslint {esl}  "
        f"score [{score_color}]{result.score:.2f}[/{score_color}]"
    )


# ── main ─────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="autoMeetic Meta-Harness runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--task", required=True, help="Feature task description")
    parser.add_argument(
        "--strategy",
        choices=STRATEGIES + ["all"],
        default="all",
        help="Context strategy to use (default: all — picks best)",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=5,
        metavar="N",
        help="Max candidates to evaluate (default: 5, max: 10)",
    )
    args = parser.parse_args(argv)

    iterations = min(args.iterations, 10)  # budget cap from domain spec
    strategies: list[Strategy] = (
        STRATEGIES if args.strategy == "all" else [args.strategy]
    )[:iterations]

    root = str(PROJECT_ROOT)
    _print(f"\n[bold]autoMeetic Harness[/bold]  task: [italic]{args.task}[/italic]\n")

    # ── evaluate current state ────────────────────────────────────────────────
    _print("[bold]Step 1 — Baseline evaluation[/bold] (current codebase state)")
    baseline = evaluate(root)
    _show_result("baseline", baseline)

    if not baseline.tsc_passed and baseline.tsc_output:
        _print("\n[dim]tsc errors:[/dim]")
        _print(f"[dim]{baseline.tsc_output[:800]}[/dim]")
    if not baseline.eslint_passed and baseline.eslint_output:
        _print("\n[dim]eslint warnings:[/dim]")
        _print(f"[dim]{baseline.eslint_output[:800]}[/dim]")

    # ── build context for each strategy ──────────────────────────────────────
    _print(f"\n[bold]Step 2 — Context candidates[/bold] ({len(strategies)} strategies)")

    best_strategy: Strategy = strategies[0]
    best_size = float("inf")

    for strategy in strategies:
        ctx = build_context(root, args.task, strategy=strategy)
        size = len(ctx)
        passing_marker = " ← smallest" if size < best_size else ""
        _print(f"  {strategy:10}  {size:>7,} chars{passing_marker}")
        if size < best_size:
            best_size = size
            best_strategy = strategy

    # ── write winning context for Claude ─────────────────────────────────────
    winning_ctx = build_context(root, args.task, strategy=best_strategy)
    LAST_CONTEXT.write_text(winning_ctx, encoding="utf-8")
    _print(
        f"\n[bold]Step 3 — Best context written[/bold]  "
        f"strategy=[green]{best_strategy}[/green]  "
        f"file=harness/last_context.md"
    )

    # ── log result ────────────────────────────────────────────────────────────
    _log_run(args.task, best_strategy, baseline)

    # ── summary ───────────────────────────────────────────────────────────────
    _print("\n[bold]Summary[/bold]")
    _print(f"  Baseline score : {baseline.score:.2f}")
    _print(f"  Best strategy  : {best_strategy} ({best_size:,} chars)")
    _print(f"  Context file   : harness/last_context.md")
    _print(f"  Run log        : harness/runs.jsonl\n")

    if not baseline.passed:
        _print(
            "[yellow]⚠ Baseline does not fully pass. Fix tsc/eslint errors "
            "before implementing the feature.[/yellow]\n"
        )

    return 0 if baseline.passed else 1


if __name__ == "__main__":
    sys.exit(main())

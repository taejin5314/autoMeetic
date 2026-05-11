"""
context_builder.py — assembles the context string Claude receives for a task.

Three strategies (harness variants):
  "full"     — CLAUDE.md + package.json + all src files (default baseline)
  "filtered" — only src files whose name overlaps with keywords in the task
  "minimal"  — CLAUDE.md + package.json only

The strategy with the smallest passing context wins (blast-radius rule).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

Strategy = Literal["full", "filtered", "minimal"]

_SEPARATOR = "\n\n" + "─" * 60 + "\n\n"


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _format_file(path: Path, root: Path) -> str:
    rel = path.relative_to(root)
    return f"### {rel}\n\n```\n{_read(path)}\n```"


def _task_keywords(task: str) -> set[str]:
    """Extract lowercase word stems from the task description."""
    return {w.lower() for w in re.findall(r"[a-zA-Z]{3,}", task)}


def build_context(
    project_root: str,
    task: str,
    strategy: Strategy = "full",
    max_src_files: int = 20,
) -> str:
    root = Path(project_root).resolve()
    parts: list[str] = []

    # Always include CLAUDE.md
    claude_md = root / "CLAUDE.md"
    if claude_md.exists():
        parts.append(f"### CLAUDE.md\n\n{_read(claude_md)}")

    # Always include package.json
    pkg = root / "package.json"
    if pkg.exists():
        parts.append(_format_file(pkg, root))

    if strategy == "minimal":
        pass  # only CLAUDE.md + package.json

    else:
        src = root / "src"
        src_files = sorted(src.rglob("*.tsx")) + sorted(src.rglob("*.ts"))

        if strategy == "filtered":
            keywords = _task_keywords(task)
            src_files = [
                f for f in src_files
                if keywords & _task_keywords(f.stem)
            ] or src_files  # fallback to all if nothing matches

        for f in src_files[:max_src_files]:
            parts.append(_format_file(f, root))

    header = f"# Task\n\n{task}\n\n# Project Context ({strategy} strategy)"
    return header + _SEPARATOR + _SEPARATOR.join(parts)

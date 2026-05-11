"""
evaluate.py — runs tsc + eslint and returns a scored EvalResult.

Primary metric:   tsc --noEmit       (weight 0.6)
Secondary metric: eslint --max-warnings 0 (weight 0.4)
Score = 1.0 only when both pass.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# On Windows, npx must be called as npx.cmd
_NPX = "npx.cmd" if sys.platform == "win32" else "npx"


@dataclass
class EvalResult:
    tsc_passed: bool
    eslint_passed: bool
    tsc_output: str
    eslint_output: str
    score: float = field(init=False)

    def __post_init__(self) -> None:
        self.score = round(
            (0.6 if self.tsc_passed else 0.0) + (0.4 if self.eslint_passed else 0.0),
            2,
        )

    @property
    def passed(self) -> bool:
        return self.score >= 1.0


def _run(cmd: list[str], cwd: str) -> tuple[bool, str]:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output


def evaluate(project_root: str) -> EvalResult:
    """Run tsc and eslint against project_root. Returns scored EvalResult."""
    root = str(Path(project_root).resolve())

    tsc_passed, tsc_output = _run(
        [_NPX, "--yes", "tsc", "--noEmit"],
        cwd=root,
    )

    eslint_passed, eslint_output = _run(
        [_NPX, "--yes", "eslint", "src", "--max-warnings", "0"],
        cwd=root,
    )

    return EvalResult(
        tsc_passed=tsc_passed,
        eslint_passed=eslint_passed,
        tsc_output=tsc_output,
        eslint_output=eslint_output,
    )

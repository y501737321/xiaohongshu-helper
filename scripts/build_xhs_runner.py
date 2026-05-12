#!/usr/bin/env python3
"""Build a one-file Xiaohongshu runner executable with PyInstaller."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "xiaohongshu_wrapper.py"
DIST_DIR = ROOT / "dist-runner"
BUILD_DIR = ROOT / "build" / "xhs_runner"
SPEC_DIR = ROOT / "build"


def main() -> int:
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    SPEC_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--onefile",
        "--console",
        "--name",
        "xhs_runner",
        "--collect-all",
        "playwright",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(SPEC_DIR),
        str(SCRIPT),
    ]
    print("Running:", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=str(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())

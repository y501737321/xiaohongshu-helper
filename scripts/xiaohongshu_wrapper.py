#!/usr/bin/env python3
"""Stable PyInstaller entrypoint for the standalone Xiaohongshu runner."""

from xhs_browser_cli import main


if __name__ == "__main__":
    raise SystemExit(main())

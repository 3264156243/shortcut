#!/usr/bin/env python3
"""Open a local HTML file in the default browser."""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="在默认浏览器中打开本地 HTML 文件。")
    parser.add_argument("path", help="要打开的 HTML 文件路径")
    args = parser.parse_args()

    target = Path(args.path).resolve()
    if not target.exists():
        sys.exit(f"文件不存在: {target}")
    webbrowser.open(target.as_uri())
    print(f"已在浏览器打开: {target}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Print a readable summary of an exported answers.json file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def mark_for(a: dict) -> str:
    if not a.get("answered"):
        return "○"
    if a.get("type") == "not_needed":
        return "×"
    if a.get("type") == "defer":
        return "→"
    return "✓"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="以可读格式输出 answers.json 的答案摘要。")
    parser.add_argument("path", help="answers.json 路径")
    args = parser.parse_args()

    path = Path(args.path)
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"无法读取 {path}: {exc}")

    answers = data.get("answers")
    if not isinstance(answers, list):
        sys.exit("answers.json 缺少 \"answers\" 数组。")

    print(f"# {data.get('title', '需求确认问卷')}")
    if data.get("savedAt"):
        print(f"保存时间: {data['savedAt']}")
    answered = sum(1 for a in answers if a.get("answered"))
    print(f"已回答: {answered}/{len(answers)}\n")

    groups: dict[str, list] = {}
    for a in answers:
        groups.setdefault(a.get("group") or "通用问题", []).append(a)

    for group, items in groups.items():
        print(f"## {group}")
        for a in items:
            tag = mark_for(a)
            status = {
                "option": "选择",
                "custom": "自定义",
                "not_needed": "不需要",
                "defer": "后续再定",
            }.get(a.get("type"), a.get("type") or "未回答")
            value = a.get("customText") or a.get("label") or ""
            rec = " [推荐]" if a.get("recommended") else ""
            note = f"（适合：{a['note']}）" if a.get("note") and a.get("type") == "option" else ""
            print(f"{tag} {a.get('id', '?')} {a.get('question', '')}")
            if a.get("answered"):
                print(f"    [{status}{rec}] {value}{note}")
            else:
                print(f"    [未回答]")
            if a.get("type") == "custom" and a.get("customText"):
                print(f"    自定义回答: {a['customText']}")
        print()


if __name__ == "__main__":
    main()

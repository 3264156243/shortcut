#!/usr/bin/env python3
"""Generate a self-contained Socratic requirements questionnaire as a single HTML file.

The HTML file works offline (no external resources). Selections are persisted in
browser localStorage, and the user can export a JSON answers file or copy the
answer text to share back with Codex.
"""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path


SPECIAL_OPTION_TYPES = {"custom", "not_needed", "defer"}

SPECIAL_OPTIONS = [
    {
        "type": "custom",
        "label": "我自己来回答（留空填写）",
        "note": "选择后可在下方输入框填写你的回答",
    },
    {
        "type": "not_needed",
        "label": "不需要",
        "note": "此项不适用于本项目，可以跳过",
    },
    {
        "type": "defer",
        "label": "后续再定",
        "note": "暂不决定，开发过程中再具体确认",
    },
]


TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<style>
:root {
  --bg: #f6f8fb;
  --card: #ffffff;
  --text: #1f2937;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #4f6ef7;
  --accent-soft: #eef1fe;
  --ok: #16a34a;
  --warn: #b45309;
  --danger: #dc2626;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; }
header { margin-bottom: 24px; }
h1 { font-size: 26px; margin: 0 0 8px; }
.intro { color: var(--muted); margin: 0 0 16px; white-space: pre-wrap; }
.progress-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.progress-bar { flex: 1; height: 8px; background: #eef0f4; border-radius: 99px; overflow: hidden; }
.progress-fill { height: 100%; width: 0%; background: var(--accent); border-radius: 99px; transition: width .2s ease; }
.progress-text { white-space: nowrap; font-size: 13px; color: var(--muted); }
.group { margin-top: 32px; }
.group h2 {
  font-size: 18px;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--accent-soft);
}
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 16px;
}
.q-title { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.q-explain { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
.opts { display: flex; flex-direction: column; gap: 8px; }
.opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 11px 13px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: border-color .12s ease, background .12s ease;
  font-family: inherit;
}
.opt:hover { border-color: var(--accent); }
.opt.selected { border-color: var(--accent); background: var(--accent-soft); }
.opt.custom.selected { border-style: dashed; }
.opt .opt-main { flex: 1; }
.opt .badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 99px;
  margin-left: 8px;
  vertical-align: 1px;
}
.badge.recommended { background: #dcfce7; color: var(--ok); }
.badge.not-needed { background: #f3f4f6; color: var(--muted); }
.badge.defer { background: #fef3c7; color: var(--warn); }
.opt .note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
.custom-box {
  margin-top: 10px;
  width: 100%;
  min-height: 84px;
  padding: 10px 12px;
  border: 1.5px solid var(--accent);
  border-radius: 10px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.actions {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(255,255,255,.94);
  backdrop-filter: blur(6px);
  border-top: 1px solid var(--border);
  padding: 12px 20px;
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.danger { color: var(--danger); }
.hint {
  font-size: 12px;
  color: var(--muted);
  margin-top: 20px;
  text-align: center;
}
.toast {
  position: fixed;
  bottom: 84px; left: 50%;
  transform: translateX(-50%);
  background: #111827; color: #fff;
  padding: 9px 18px;
  border-radius: 99px;
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s ease;
  z-index: 10;
}
.toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>__TITLE__</h1>
    <p class="intro">__INTRO__</p>
  </header>

  <div class="progress-card">
    <div class="progress-bar"><div class="progress-fill" id="fill"></div></div>
    <span class="progress-text" id="ptext">0 / 0</span>
  </div>

  <div id="questions"></div>
  <p class="hint">答案会自动保存在浏览器本地（localStorage），关闭页面后再次打开不会丢失。全部选完后，请点击下方「导出答案 JSON」，并把下载的 <b>answers.json</b> 路径告诉 Codex，或直接说“已保存”。</p>
</div>

<div class="actions">
  <button class="btn primary" id="exportBtn">导出答案 JSON</button>
  <button class="btn" id="copyBtn">复制答案文本</button>
  <button class="btn danger" id="resetBtn">重置本问卷</button>
</div>
<div class="toast" id="toast"></div>

<script type="application/json" id="qdata">__DATA_JSON__</script>
<script>
"use strict";
const DATA = JSON.parse(document.getElementById("qdata").textContent);
const KEY = "sq_answers::" + DATA.title;
let answers = {};
try { answers = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { answers = {}; }

const GROUP_ORDER = {};
DATA.questions.forEach(function (q, i) {
  q.idx = i + 1;
  if (!(q.group in GROUP_ORDER)) GROUP_ORDER[q.group] = [];
  GROUP_ORDER[q.group].push(q);
});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function answerFor(q) {
  const a = answers[q.id];
  if (a && typeof a === "object") return a;
  return { type: null, label: "", recommended: false, note: "", customText: "" };
}

function renderOptions(q, box) {
  const cur = answerFor(q);
  q.options.forEach(function (opt) {
    const b = el("button", "opt");
    if (opt.type === "custom") b.classList.add("custom");
    if (cur.type === opt.type) {
      b.classList.add("selected");
      if (opt.type === "custom" && cur.customText) b.classList.add("has-text");
    }
    const main = el("span", "opt-main");
    main.appendChild(el("span", null, opt.label));
    if (opt.recommended) {
      main.appendChild(el("span", "badge recommended", "★ 推荐"));
    } else if (opt.type === "not_needed") {
      main.appendChild(el("span", "badge not-needed", "跳过"));
    } else if (opt.type === "defer") {
      main.appendChild(el("span", "badge defer", "稍后"));
    }
    if (opt.note) main.appendChild(el("span", "note", "适合：" + opt.note));
    b.appendChild(main);
    b.addEventListener("click", function () {
      const prev = answerFor(q);
      answers[q.id] = {
        type: opt.type,
        label: opt.label,
        recommended: !!opt.recommended,
        note: opt.note || "",
        customText: opt.type === "custom" ? (prev.customText || "") : ""
      };
      save();
      renderAll();
    });
    box.appendChild(b);
  });

  if (cur.type === "custom") {
    const ta = el("textarea", "custom-box");
    ta.placeholder = "在这里填写你的回答…";
    ta.value = cur.customText || "";
    ta.addEventListener("input", function () {
      const a = answerFor(q);
      a.customText = ta.value;
      answers[q.id] = a;
      save(false);
    });
    box.appendChild(ta);
  }
}

function renderAll() {
  const container = document.getElementById("questions");
  container.innerHTML = "";
  const groups = Object.keys(GROUP_ORDER);
  groups.forEach(function (g) {
    container.appendChild(el("div", "group")).appendChild(el("h2", null, g));
    GROUP_ORDER[g].forEach(function (q) {
      const card = el("div", "card");
      const title = el("p", "q-title", q.idx + ". " + q.question);
      card.appendChild(title);
      if (q.explanation) card.appendChild(el("p", "q-explain", "为什么问：" + q.explanation));
      const box = el("div", "opts");
      renderOptions(q, box);
      card.appendChild(box);
      container.appendChild(card);
    });
  });
  updateProgress();
}

function countAnswered() {
  let n = 0;
  DATA.questions.forEach(function (q) {
    const a = answerFor(q);
    if (a.type) n += 1;
  });
  return n;
}

function updateProgress() {
  const n = countAnswered();
  const total = DATA.questions.length;
  document.getElementById("fill").style.width = (total ? Math.round(n / total * 100) : 0) + "%";
  document.getElementById("ptext").textContent = n + " / " + total;
}

function save(doRender) {
  localStorage.setItem(KEY, JSON.stringify(answers));
  if (doRender !== false) updateProgress();
}

function exportAnswers() {
  const payload = {
    title: DATA.title,
    savedAt: new Date().toISOString(),
    answers: DATA.questions.map(function (q) {
      const a = answerFor(q);
      return {
        id: q.id,
        group: q.group,
        question: q.question,
        answered: !!a.type,
        type: a.type,
        label: a.label,
        recommended: a.recommended,
        note: a.note,
        customText: a.customText || ""
      };
    })
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "answers.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("已导出 answers.json（通常下载到“下载”文件夹）。请把路径告诉 Codex，或说“已保存”。");
}

function copyText() {
  const lines = ["# " + DATA.title, ""];
  DATA.questions.forEach(function (q) {
    const a = answerFor(q);
    const tag = a.type === "option" ? (a.recommended ? " [推荐]" : "") : a.type === "custom" ? " [自定义]" : a.type === "not_needed" ? " [不需要]" : a.type === "defer" ? " [后续再定]" : "";
    const val = a.type === "custom" && a.customText ? a.customText : a.type ? a.label : "（未回答）";
    lines.push(q.idx + ". " + q.question);
    lines.push("   答案：" + val + tag);
  });
  const text = lines.join("\\n");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast("已复制答案文本，可直接粘贴给 Codex。"); });
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("已复制答案文本，可直接粘贴给 Codex。");
  }
}

function resetAll() {
  if (confirm("确定要清空本问卷的全部答案吗？此操作不可撤销。")) {
    answers = {};
    localStorage.removeItem(KEY);
    renderAll();
    toast("已重置。");
  }
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 4000);
}

document.getElementById("exportBtn").addEventListener("click", exportAnswers);
document.getElementById("copyBtn").addEventListener("click", copyText);
document.getElementById("resetBtn").addEventListener("click", resetAll);

renderAll();
</script>
</body>
</html>
"""


def load_questions(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"无法读取问卷 JSON {path}: {exc}")

    if not isinstance(data, dict) or "questions" not in data:
        sys.exit("问卷 JSON 必须是包含 \"questions\" 数组的对象。")
    questions = data["questions"]
    if not isinstance(questions, list) or not questions:
        sys.exit("\"questions\" 必须是非空数组。")

    seen_ids = set()
    for q in questions:
        if not isinstance(q, dict):
            sys.exit("每个问题都必须是对象。")
        q.setdefault("id", "")
        q.setdefault("group", "通用问题")
        q.setdefault("question", "")
        q.setdefault("explanation", "")
        if not q["id"] or not q["question"]:
            sys.exit("每个问题都必须包含非空的 \"id\" 和 \"question\"。")
        if q["id"] in seen_ids:
            sys.exit(f"问题 id 重复: {q['id']}")
        seen_ids.add(q["id"])

        raw_options = q.get("options", [])
        if not isinstance(raw_options, list):
            sys.exit(f"问题 {q['id']} 的 \"options\" 必须是数组。")
        options = []
        seen_types = set()
        for opt in raw_options:
            if not isinstance(opt, dict):
                sys.exit(f"问题 {q['id']} 的选项必须是对象。")
            opt.setdefault("type", "option")
            opt.setdefault("label", "")
            opt.setdefault("note", "")
            opt.setdefault("recommended", False)
            if not opt["label"]:
                sys.exit(f"问题 {q['id']} 存在没有 label 的选项。")
            seen_types.add(opt["type"])
            options.append(opt)
        for special in SPECIAL_OPTIONS:
            if special["type"] not in seen_types:
                options.append(dict(special))
        q["options"] = options
    return data


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="从问卷 JSON 生成自包含的 HTML 问卷。")
    parser.add_argument("--questions", required=True, help="问卷 JSON 文件路径")
    parser.add_argument("--output", default="questionnaire.html", help="输出 HTML 路径（默认 questionnaire.html）")
    parser.add_argument("--title", help="覆盖问卷标题")
    parser.add_argument("--open", action="store_true", help="生成后自动在浏览器打开")
    args = parser.parse_args()

    data = load_questions(Path(args.questions))
    title = args.title or data.get("title") or "需求确认问卷"
    intro = data.get("intro") or "请逐题选择最符合你情况的选项；标有“★ 推荐”的选项是建议项，旁边注明了适用场景。你也可以选择“我自己来回答”“不需要”或“后续再定”。"

    payload = {
        "title": title,
        "intro": intro,
        "questions": data["questions"],
    }
    data_json = json.dumps(payload, ensure_ascii=False, indent=2).replace("<", "\\u003c")

    html = (
        TEMPLATE.replace("__TITLE__", title)
        .replace("__INTRO__", intro)
        .replace("__DATA_JSON__", data_json)
    )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    print(f"已生成问卷: {output.resolve()}")
    print(f"共 {len(data['questions'])} 题")

    if args.open:
        webbrowser.open(output.resolve().as_uri())
        print("已在默认浏览器打开。")


if __name__ == "__main__":
    main()

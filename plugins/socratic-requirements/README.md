# Socratic Requirements（苏格拉底需求确认）

一个本地 Codex 插件：启动新项目/计划/任务时，用苏格拉底问答式问卷确认需求，生成需求/计划
MD 文档并迭代到用户确认，然后清理临时文件开始工作；开发中遇到未明确的问题时询问用户而不是
自行臆断。

## 安装

```bash
codex plugin add socratic-requirements@personal
```

安装后请在新任务中测试（新任务才会加载新技能）。

## 从仓库安装（给其他人 / 团队）

本插件同时以仓库 marketplace 的形式放在本仓库中，克隆后即可安装：

```bash
# 1. 克隆仓库（如果你还没有）
git clone https://gitee.com/wanan6/short-cut.git
cd short-cut

# 2. 注册仓库 marketplace（本地路径或仓库地址均可）
codex plugin marketplace add https://gitee.com/wanan6/short-cut.git

# 3. 安装插件
codex plugin add socratic-requirements@short-cut
```

仓库 marketplace 清单位于 `.agents/plugins/marketplace.json`，插件源码位于
`plugins/socratic-requirements/`。仓库根目录的 `AGENTS.md` 还包含“开发中遇到不明确问题先问用户、
不臆断”的通用规则，对所有在该仓库中工作的 Codex 会话生效。

## 用法

1. 对 Codex 说“我要开始一个新项目……”或“先确认需求/生成需求问卷”；
2. Codex 生成问卷并在浏览器打开：点选答案，带“★ 推荐”的是建议项；
3. 答完后点「导出答案 JSON」，把 `answers.json` 路径告诉 Codex（或说“已保存”）；
4. Codex 生成 `requirements.md` 并继续提问未决问题，直到你说“开始工作”；
5. 说“开始工作”后，Codex 删除临时问卷文件，保留 `requirements.md` 并开始实现；
6. 开发中遇到没提过的问题，Codex 会直接问你，不会自行假设。

## 目录结构

```text
socratic-requirements/
├── .codex-plugin/plugin.json      # 插件清单
├── skills/socratic-requirements/  # 技能：苏格拉底需求确认工作流
└── scripts/
    ├── generate_questionnaire.py  # 从 questions.json 生成 HTML 问卷
    ├── open_html.py               # 在浏览器中打开 HTML
    └── read_answers.py            # 输出 answers.json 可读摘要
```

## 工作流中的文件

- 临时目录 `.requirements-work/`：`questions.json`、`questionnaire.html`、`answers.json`
  （确认完成后整体删除）；
- 保留产物：项目根目录的 `requirements.md`。

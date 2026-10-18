#!/usr/bin/env node
/**
 * 生成完整版本历史数据（website/assets/js/changelog-data.js）
 * ---------------------------------------------------------------------------
 * 数据源：
 *   1. release-notes/*.md  —— 历史版本的逐版本说明（自动解析「## 分组」+「- 条目」）
 *   2. 发布日期用该文件的 git 首次提交日期（比手写更真实）
 *   3. NEWER 里补充 release-notes 还没覆盖的新版本（2.4.6 / 2.5.0 / 2.5.1 …）
 *
 * 用法：node scripts/gen-changelog-data.mjs
 * 产出：纯数据文件，站点直接引用，无需构建。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const NOTES = join(ROOT, 'release-notes');
const OUT = join(ROOT, 'website', 'assets', 'js', 'changelog-data.js');

/* ── 人工补充：release-notes 里还没有的版本（按版本倒序插入）─────────────── */
const NEWER = [
  {
    version: '2.5.1',
    date: '2026-10-18',
    groups: [
      {
        title: '修复',
        items: [
          '修复「检查更新」永远失败：旧实现读取 Electron 时期留下的清单格式，且返回体缺少成功标记',
          '修复更新进度条不动：下载进度事件字段名与前端读取的不一致',
          '检查更新改用 Tauri 官方更新器，按 available / not-available 正确返回'
        ]
      }
    ]
  },
  {
    version: '2.5.0',
    date: '2026-10-17',
    groups: [
      {
        title: '技术栈',
        items: [
          'Tauri 2 重构后首个正式版，Electron 版正式退役（体积约 -94%、内存约 -30%）',
          '支持从旧版应用内自动迁移到 Tauri 版'
        ]
      },
      {
        title: '修复（发版阻塞级）',
        items: [
          '实例守卫误判自身：可执行文件被命名为 ShortCut.exe 时会把自己认成旧版，表现为双击无反应且不写日志',
          '侧车与静态页依赖构建机绝对路径：换机器后音乐桥、硬件监控、语音输入全部失效',
          '打包资源补齐 hardware-monitor / music-bridge / usage-monitor 三个目录'
        ]
      },
      {
        title: '变更',
        items: ['SC球鼠标穿透快捷键默认值 Ctrl+Alt+B → Alt+B（旧默认值自动迁移）']
      }
    ]
  },
  {
    version: '2.4.6',
    date: '2026-09-30',
    groups: [
      {
        title: 'Tauri 2 重构',
        items: [
          '首个对外重构版：内存占用 -30%，安装包体积 -94%',
          '岛设置全面生效；音乐控制、截图、翻译、任务墙、语音胶囊全功能对齐',
          '窗口状态记忆与残留进程清理机制'
        ]
      }
    ]
  }
];

/* ── 更早的初始版本（release-notes 从 2.0.0 才开始有）──────────────────── */
const EARLIEST = [
  {
    version: '1.0.0',
    date: firstCommitDate(),
    groups: [
      {
        title: '首个版本',
        items: ['快捷启动面板基础能力：集中管理软件、文件夹、网页，键盘选择启动', '任务墙与本地配置存储']
      }
    ]
  }
];

/* ── 读取 release-notes 并解析 ─────────────────────────────────────────── */
function parseNote(text) {
  const lines = text.split(/\r?\n/);
  const groups = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      cur = { title: h2[1].trim(), items: [] };
      groups.push(cur);
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) continue; // 标题行是版本号，跳过

    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      if (!cur) { cur = { title: '更新', items: [] }; groups.push(cur); }
      cur.items.push(li[1].trim());
    }
  }
  return groups.filter((g) => g.items.length);
}

function firstCommitDate() {
  try {
    const out = execSync('git log --reverse --format=%ad --date=short', { cwd: ROOT, encoding: 'utf8' });
    const first = out.split(/\r?\n/).filter(Boolean)[0];
    return first || '';
  } catch (e) {
    return '';
  }
}

function noteDate(file) {
  try {
    const out = execSync(`git log -1 --format=%ad --date=short -- "release-notes/${file}"`, {
      cwd: ROOT, encoding: 'utf8'
    });
    return (out.split(/\r?\n/).filter(Boolean)[0] || '').trim();
  } catch (e) {
    return '';
  }
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

const fromNotes = [];
if (existsSync(NOTES)) {
  for (const file of readdirSync(NOTES)) {
    if (!file.endsWith('.md')) continue;
    const version = file.replace(/\.md$/, '');
    const groups = parseNote(readFileSync(join(NOTES, file), 'utf8'));
    if (!groups.length) continue;
    fromNotes.push({ version, date: noteDate(file), groups });
  }
}

const all = [...NEWER, ...fromNotes, ...EARLIEST].sort((a, b) => cmpVersion(a.version, b.version));

/* ── 统计与输出 ───────────────────────────────────────────────────────── */
const totalItems = all.reduce((n, v) => n + v.groups.reduce((m, g) => m + g.items.length, 0), 0);

const header = `/**
 * ShortCut 完整版本历史（自动生成，请勿手改）
 * ---------------------------------------------------------------------------
 * 生成：node scripts/gen-changelog-data.mjs
 * 来源：release-notes/*.md（历史）+ 脚本内的 NEWER/EARLIEST（补充）
 * 规模：${all.length} 个版本、${totalItems} 条更新
 * 日期：取自对应 release-notes 文件的 git 首次提交日期
 */
`;

const body = `window.SC_CHANGELOG = ${JSON.stringify(all, null, 2)};\n`;

writeFileSync(OUT, header + body, 'utf8');

console.log(`已生成 ${OUT.replace(ROOT, '.')}`);
console.log(`  ${all.length} 个版本、${totalItems} 条更新`);
console.log('  版本列表：' + all.map((v) => v.version).join(' → '));

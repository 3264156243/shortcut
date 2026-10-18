#!/usr/bin/env node
/**
 * 生成英文站点（website/en/**）
 * ---------------------------------------------------------------------------
 * 复用 gen-site-pages.mjs 里的页面数据结构与渲染片段，文案来自 site-en.mjs。
 *
 * 产出：
 *   website/en/index.html              首页（由中文首页按替换表翻译）
 *   website/en/features/*.html         6 个功能页
 *   website/en/download.html           下载页
 *   website/en/changelog.html          更新日志
 *   website/en/faq.html                FAQ
 *   website/en/feedback.html           问题反馈
 *   website/assets/js/data-en.js       英文界面数据（data.js 在 lang=en 时使用）
 *
 * 用法：node scripts/gen-en.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGES, head as zhHead, CTA } from './gen-site-pages.mjs';
import { EN_PAGES, EN_UI, EN_INDEX_REPLACE, EN_CTA, EN_LABELS } from './site-en.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(here, '..', 'website');
const OUT = join(SITE, 'en');

/* ── 通用片段 ──────────────────────────────────────────────────────────── */

const BOOT = `  <script>
  /* Apply colour mode before styles load to avoid a flash */
  (function () {
    try {
      var m = localStorage.getItem('sc-mode');
      if (m !== 'light' && m !== 'dark') m = 'dark';
      document.documentElement.setAttribute('data-mode', m);
    } catch (e) {
      document.documentElement.setAttribute('data-mode', 'dark');
    }
  })();
  <\/script>`;

function head({ title, desc }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="theme-color" content="#0a0a0b" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="ShortCut" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="/assets/img/og.png" />
<meta name="twitter:card" content="summary_large_image" />

<link rel="icon" href="/assets/img/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" href="/assets/img/logo-64.png" sizes="64x64" />
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png" />

${BOOT}
<link rel="stylesheet" href="/assets/css/site.css" />
<link rel="stylesheet" href="/assets/css/pages.css" />
</head>`;
}

const EN_CTA_HTML = `  <!-- Call to action -->
  <section class="cta">
    <div class="wrap">
      <h2>${EN_CTA.heading}</h2>
      <p id="ctaSub">${EN_CTA.sub}</p>
      <div class="btn-row center">
        <a class="btn btn--primary btn--lg" href="/en/download.html">${EN_CTA.primary}</a>
        <a class="btn btn--ghost btn--lg" href="/en/faq.html">${EN_CTA.ghost}</a>
      </div>
    </div>
  </section>`;

const EN_SCRIPTS = `  <script src="/assets/js/data-en.js"></script>
  <script src="/assets/js/data.js"></script>
  <script src="/assets/js/site.js"></script>
  <script src="/assets/js/motion.js"></script>`;

function enCrumbs(page) {
  const items = [`<a href="/en/">${EN_LABELS.home}</a>`];
  if (page.startsWith('features/')) {
    items.push('<span>/</span>', `<a href="/en/features/shortcut.html">${EN_LABELS.features}</a>`);
  }
  const key = page.startsWith('features/') ? page : page;
  const crumb = (EN_PAGES[key] && EN_PAGES[key].crumb) || '';
  if (crumb) items.push('<span>/</span>', `<span>${crumb}</span>`);
  return `        <nav class="crumbs" aria-label="Breadcrumb">${items.join('')}</nav>`;
}

function enPager(prev, next) {
  if (!prev && !next) return '';
  const a = prev
    ? `        <a href="/en${prev.href}"><small>${EN_LABELS.prev}</small><b>← ${prev.label}</b></a>`
    : '        <span></span>';
  const b = next
    ? `        <a class="pager--next" href="/en${next.href}"><small>${EN_LABELS.next}</small><b>${next.label} →</b></a>`
    : '        <span></span>';
  return `      <nav class="pager" aria-label="Feature navigation">
${a}
${b}
      </nav>`;
}

function enCaps(list) {
  return list
    .map(
      ([icon, title, desc]) => `          <div class="capability reveal">
            <span class="cap-ico" data-icon="${icon}"></span>
            <div><b>${title}</b><p>${desc}</p></div>
          </div>`
    )
    .join('\n');
}

/* 把中文示意里的 aria-label 换成英文泛称 */
function localizeFigure(html) {
  var map = [
    ['快捷方式', 'Shortcuts'], ['任务墙', 'Task Wall'], ['驾驶舱', 'Dashboard'],
    ['翻译', 'Translate'], ['使用记录', 'Usage log'], ['控制', 'Control'],
    ['搜索快捷方式…', 'Search shortcuts…'], ['搜索名称、路径或备注…', 'Search name, path or note…'],
    ['正在播放', 'Now playing'], ['SC球 设置', 'SC Ball settings'],
    ['显示音乐模块', 'Music module'], ['显示驾驶舱', 'System stats'], ['鼠标穿透', 'Click-through'],
    ['封面、歌词、播放控制', 'Cover, lyrics, playback'], ['CPU / GPU / 内存温度', 'CPU / GPU / memory temperature'],
    ['开启后不挡桌面点击（Alt+B 切换）', 'Never blocks desktop clicks (Alt+B)'],
    ['键盘输入', 'Keyboard'], ['触控板', 'Trackpad'], ['组合键 Ctrl+C / Ctrl+V', 'Ctrl+C / Ctrl+V'],
    ['剪贴板互传', 'Clipboard'], ['输入文字，电脑上直接出现', 'Type here — it appears on the PC'],
    ['电脑控制 · 已连接', 'PC control · connected'], ['我的电脑 · 已连接', 'My PC · connected'],
    ['检查更新', 'Check for updates'], ['文件快传', 'File transfer'],
    ['周五前交设计稿', 'Design draft by Friday'], ['买路由器', 'Buy a router'],
    ['备份照片', 'Back up photos'], ['写周报', 'Write the weekly report'],
    ['今天 18:00 提醒', 'Reminder today 18:00'], ['普通待办', 'Plain to-do'],
    ['明天 09:30', 'Tomorrow 09:30'], ['手机钉入', 'Pinned from phone'],
    ['我的传输 · 3 个文件', 'My transfers · 3 files'],
    ['产品说明书-v2.pdf', 'manual-v2.pdf'], ['项目备份-20261018.zip', 'project-backup.zip'],
    ['截图-灵动岛.png', 'screenshot-island.png'],
    ['有效期 24 小时', 'expires in 24 h'], ['分片上传中', 'uploading in chunks'], ['已生成分享链接', 'share link created'],
    ['ShortCut 安装程序', 'ShortCut Installer'], ['SC球 示意', 'SC Ball'],
    ['目标平台', 'Target platform'], ['安装位置', 'Install location'], ['更新签名', 'Update signature'],
    ['用户数据', 'User data'], ['自定义', 'Custom'], ['已校验', 'Verified'], ['保留', 'Kept']
  ];
  var out = html;
  map.forEach(function (pair) { out = out.split(pair[0]).join(pair[1]); });
  return out.replace(/aria-label="[^"]*"/g, 'aria-label="ShortCut interface illustration"');
}

function pageIdOf(file) {
  const map = {
    'download.html': 'download',
    'changelog.html': 'changelog',
    'faq.html': 'faq',
    'feedback.html': 'feedback'
  };
  return map[file] || 'features';
}

/* ── 1. 英文子页 ───────────────────────────────────────────────────────── */
let count = 0;

for (const p of PAGES) {
  const en = EN_PAGES[p.file];
  if (!en) { console.warn('缺少英文文案，跳过：' + p.file); continue; }

  const outPath = join(OUT, p.file);
  mkdirSync(dirname(outPath), { recursive: true });

  const isFeature = Boolean(p.caps);

  let body;
  if (isFeature) {
    const lead = p.flip
      ? `<div class="feature-lead feature-lead--flip">
        <div class="feature-lead__text reveal"><p class="hero__lead" style="margin-bottom:0">${en.lead}</p></div>
        <div class="reveal">${localizeFigure(p.figure)}</div>
      </div>`
      : `<div class="feature-lead">
        <div class="feature-lead__text reveal"><p class="hero__lead" style="margin-bottom:0">${en.lead}</p></div>
        <div class="reveal">${localizeFigure(p.figure)}</div>
      </div>`;

    body = `  <section class="section section--flush">
    <div class="wrap">
${lead}
    </div>
  </section>

  <section class="section section--alt">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">${en.sectionTitle}</span>
        <h2>${en.sectionDesc}</h2>
      </div>
      <div class="grid grid--2" style="gap:14px">
${enCaps(en.caps)}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
${enPager(en.pagerPrev, en.pagerNext)}
    </div>
  </section>`;
  } else {
    /* 下载 / 日志 / FAQ / 反馈：复用中文页的 body 片段（结构相同，文案少量替换） */
    let frag = '';
    try {
      frag = readFileSync(join(SITE, '_bodies', p.file), 'utf8');
    } catch (e) {
      frag = '  <section class="section"><div class="wrap"><p>Content pending.</p></div></section>';
    }
    body = localizeBody(frag, p.file);
  }

  const html = `${head({ title: en.title, desc: en.desc })}

<body data-page="${pageIdOf(p.file)}">

<div id="site-nav"></div>

<main>

  <section class="page-head">
    <div class="wrap">
${enCrumbs(p.file)}
      <h1>${en.h1}</h1>
      <p>${en.lead}</p>
    </div>
  </section>

${body}

${EN_CTA_HTML}

</main>

<div id="site-footer"></div>

${EN_SCRIPTS}
  <script>
  (function () {
    'use strict';
    Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (n) {
      n.innerHTML = SC.icon(n.getAttribute('data-icon'), 20);
    });
  })();
  <\/script>
</body>
</html>
`;

  writeFileSync(outPath, html, 'utf8');
  console.log('✓ en/' + p.file);
  count++;
}

/* ── 2. 英文首页（由中文首页按替换表翻译）──────────────────────────────── */
try {
  let idx = readFileSync(join(SITE, 'index.html'), 'utf8');

  for (const [from, to] of EN_INDEX_REPLACE) {
    if (idx.includes(from)) idx = idx.split(from).join(to);
  }

  /* 内部链接加 /en 前缀（仅站内绝对路径，且排除已在 /en 下的） */
  idx = idx.replace(/href="\/(?!en\/)(download\.html|changelog\.html|faq\.html|feedback\.html|features\/)/g, 'href="/en/$1');

  /* 示意图 aria-label 换英文 */
  idx = idx.replace(/aria-label="[^"]*"/g, 'aria-label="ShortCut interface illustration"');

  /* 英文页需要 data-en.js */
  idx = idx.replace(
    '<script src="/assets/js/data.js"></script>',
    '<script src="/assets/js/data-en.js"></script>\n<script src="/assets/js/data.js"></script>'
  );

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'index.html'), idx, 'utf8');
  console.log('✓ en/index.html');
  count++;
} catch (e) {
  console.warn('英文首页生成失败：' + e.message);
}

/* ── 3. 英文界面数据 data-en.js ────────────────────────────────────────── */
const dataEn = `/**
 * 英文界面数据（自动生成，请勿手改）
 * ---------------------------------------------------------------------------
 * 生成：node scripts/gen-en.mjs
 * 使用：仅英文页面引入；data.js 在 <html lang="en"> 时套用它
 */
window.SC_EN = ${JSON.stringify(EN_UI, null, 2)};
`;
writeFileSync(join(SITE, 'assets', 'js', 'data-en.js'), dataEn, 'utf8');
console.log('✓ assets/js/data-en.js');

console.log('\n共生成 ' + count + ' 个英文页面。');

/* ── 辅助：中文 body 片段的英文替换 ────────────────────────────────────── */
function localizeBody(html, file) {
  const REPL = {
    'download.html': [
      ['>Windows 10 / 11 · 64 位<', '>Windows 10 / 11 · 64-bit<'],
      ['版本读取中…', 'Reading version…'],
      ['官网直链下载', 'Official direct download'],
      ['其他下载渠道', 'Other download channels'],
      ['当前版本', 'Current version'],
      ['安装包体积', 'Installer size'],
      ['技术栈', 'Stack'],
      ['ShortCut 安装程序', 'ShortCut Installer'],
      ['目标平台', 'Target platform'],
      ['Windows 10 / 11（64 位）', 'Windows 10 / 11 (64-bit)'],
      ['安装位置', 'Install location'],
      ['由安装程序管理，卸载可从设置里完成', 'Managed by the installer; uninstall from Settings'],
      ['自定义', 'Custom'],
      ['更新签名', 'Update signature'],
      ['更新包带签名校验，不会被替换', 'Update packages are signature-checked and cannot be swapped'],
      ['已校验', 'Verified'],
      ['用户数据', 'User data'],
      ['配置存放在 %APPDATA%\\\\ShortCut，覆盖安装不丢', 'Stored in %APPDATA%\\\\ShortCut, kept across upgrades'],
      ['保留', 'Kept'],
      ['下载渠道', 'Download channels'],
      ['四个渠道，任选其一', 'Four channels, pick one'],
      ['官网直链始终是最新版本；蓝奏云在国内较快但需人工同步，版本可能滞后；Gitee / GitHub 为源码仓库。',
       'The official link always has the newest build; Lanzou is faster in mainland China but uploaded by hand, so it may lag. Gitee / GitHub are source repositories.'],
      ['安卓端', 'Android App'],
      ['手机上也能用', 'Also available on your phone'],
      ['ShortCut 安卓端', 'ShortCut for Android'],
      ['正在读取版本…', 'Reading version…'],
      ['下载 APK', 'Download APK'],
      ['安装步骤', 'Installation'],
      ['三步装好', 'Three steps'],
      ['安装包', 'installer'],
      ['运行安装程序', 'Run the installer'],
      ['若出现 SmartScreen「未知发布者」提示，点「更多信息 → 仍要运行」。安装包当前未做代码签名。',
       'If SmartScreen warns about an unknown publisher, choose "More info → Run anyway". The installer is not code-signed yet.'],
      ['正常权限启动', 'Launch with normal privileges'],
      ['<strong>不要以管理员身份运行</strong>：管理员权限会触发 Windows 的窗口隔离机制，导致「从资源管理器拖文件到 SC球」整体失效。',
       '<strong>Do not run as administrator</strong>: elevated processes trigger Windows UIPI, which breaks dragging files from Explorer onto the SC Ball.'],
      ['系统要求', 'System requirements'],
      ['需要什么环境', 'What you need'],
      ['操作系统', 'OS'],
      ['运行时', 'Runtime'],
      ['WebView2（Windows 11 已自带；Win10 若无，安装器会提示）', 'WebView2 (bundled with Windows 11; the installer prompts on Windows 10 if missing)'],
      ['磁盘', 'Disk'],
      ['约 40 MB（安装后）', 'About 40 MB installed'],
      ['权限', 'Privileges'],
      ['普通用户权限即可；驾驶舱温度如需更精确可单独授权', 'A standard user account is enough; temperature readings can be granted separately'],
      ['网络', 'Network'],
      ['离线可用；移动互联功能需你的自建服务端', 'Works offline; interconnect features need your own server'],
      ['安装问题', 'Installation issues'],
      ['装的时候可能遇到', 'Things you may run into'],
      ['提示「未知发布者」怎么办？', 'What about the "unknown publisher" warning?'],
      ['覆盖安装会不会丢配置和任务？', 'Will upgrading lose my settings and tasks?'],
      ['旧版本（2.4.x 及更早）的自带更新会失败？', 'Old versions (2.4.x and earlier) fail to update in-app?'],
      ['能不能绿色版 / 便携版？', 'Is there a portable build?']
    ],
    'changelog.html': [
      ['最新版本', 'Latest release'],
      ['读取中…', 'Loading…'],
      ['下载此版本', 'Download this version'],
      ['展开全部版本', 'Expand all versions'],
      ['版本索引', 'Version index'],
      ['完整历史', 'Full history'],
      ['所有版本，点开看详情', 'Every version, expand for details'],
      ['当前', 'Current'],
      ['条更新', 'items']
    ],
    'faq.html': [],
    'feedback.html': [
      ['问题反馈', 'Feedback'],
      ['反馈类型', 'Type'],
      ['问题 / Bug', 'Bug report'],
      ['功能建议', 'Feature request'],
      ['界面与体验', 'UI and UX'],
      ['更新与安装', 'Updates and install'],
      ['其它', 'Something else'],
      ['内容', 'Details'],
      ['必填，至少 5 个字', 'required, at least 5 characters'],
      ['联系方式', 'Contact'],
      ['选填', 'optional'],
      ['邮箱 / QQ / 微信，方便回你', 'Email / QQ / WeChat so I can reply'],
      ['你的版本', 'Your version'],
      ['选填，可自动填', 'optional, filled automatically'],
      ['提交反馈', 'Submit feedback'],
      ['先看常见问题', 'Read the FAQ first'],
      ['说明', 'About'],
      ['反馈会怎么处理', 'How feedback is handled'],
      ['直接记录到你自己的服务器', 'Recorded on the project server'],
      ['不留 IP 原文', 'No raw IP stored'],
      ['不一定逐条回复', 'Replies are not guaranteed'],
      ['下面这些不用发反馈', 'You do not need to send these'],
      ['请勿填写', 'Leave empty']
    ]
  };

  let out = html;
  const list = REPL[file] || [];
  for (const [from, to] of list) {
    out = out.split(from).join(to);
  }
  return out;
}

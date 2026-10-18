#!/usr/bin/env node
/**
 * 把 website/ 打成一个自包含的 HTML 预览文件（CSS/JS 全部内联）。
 *
 * 用途：阶段性给用户「在浏览器里看效果」，而不用先部署整个站点。
 *   - 内联后无路径依赖，放在站点根的任何位置都能打开
 *   - 页面里的 fetch('/updates/latest.json') 仍按域名根解析，所以在真实域名下预览也能取到版本号
 *   - 导航链接指向尚未开发的页面时点击会 404，属预览期预期
 *
 * 用法：
 *   node scripts/build-site-preview.mjs                 # 输出 website/_preview.html
 *   node scripts/build-site-preview.mjs --page faq      # 预览某个子页（website/faq.html）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SITE = join(ROOT, 'website');

const argPage = (() => {
  const i = process.argv.indexOf('--page');
  return i >= 0 ? process.argv[i + 1] : '';
})();

const pageFile = argPage ? join(SITE, argPage + '.html') : join(SITE, 'index.html');
const themeMode = process.argv.includes('--themes');
const outFile = argPage
  ? join(SITE, '_preview-' + argPage + '.html')
  : join(SITE, themeMode ? '_preview-theme.html' : '_preview.html');

if (!existsSync(pageFile)) {
  console.error('找不到页面：' + pageFile);
  process.exit(1);
}

const read = (p) => readFileSync(p, 'utf8');

let html = read(pageFile);

/* 1. 内联样式表 */
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g,
  (m, href) => {
    const rel = href.replace(/^\//, '');
    const p = join(SITE, rel);
    if (!existsSync(p)) { console.warn('缺少样式文件：' + rel); return ''; }
    return '<style>\n/* ' + rel + ' */\n' + read(p) + '\n</style>';
  }
);

/* 2. 内联脚本（顺序必须保持：data.js → site.js → 页面脚本） */
html = html.replace(
  /<script\s+src="([^"]+)"\s*><\/script>/g,
  (m, src) => {
    const rel = src.replace(/^\//, '');
    const p = join(SITE, rel);
    if (!existsSync(p)) { console.warn('缺少脚本：' + rel); return ''; }
    return '<script>\n/* ' + rel + ' */\n' + read(p) + '\n</script>';
  }
);

/* 3. 标注这是预览文件 */
html = html.replace(
  '</head>',
  '<!-- 预览文件（由 scripts/build-site-preview.mjs 生成；请勿直接编辑） -->\n</head>'
);

/* 4. 可选：注入配色方案切换器（方案评审用）
 *    用法：node scripts/build-site-preview.mjs --themes
 *    产出：preview-theme.html —— 右下角可切换 4 套配色
 */
const withThemes = themeMode;
if (withThemes) {
  const themesPath = join(SITE, 'assets/css/themes.css');
  const themesCss = existsSync(themesPath)
    ? '\n<style>\n/* assets/css/themes.css */\n' + read(themesPath) + '\n</style>'
    : '';

  /* 默认现状方案 d，并把持久化放最前 */
  html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-theme="d">');

  html = html.replace('</head>', themesCss + '\n</head>');

  const picker = `
<div class="theme-picker" role="group" aria-label="配色方案切换">
  <b>配色</b>
  <button type="button" data-theme-btn="d" aria-pressed="true">现状（深色橙）</button>
  <button type="button" data-theme-btn="a" aria-pressed="false">A 石墨铜</button>
  <button type="button" data-theme-btn="b" aria-pressed="false">B 中性极简</button>
  <button type="button" data-theme-btn="c" aria-pressed="false">C 浅色纸感</button>
</div>
<script>
(function () {
  var KEY = 'sc-theme';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved) root.setAttribute('data-theme', saved);

  function sync() {
    var cur = root.getAttribute('data-theme') || 'd';
    document.querySelectorAll('[data-theme-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-theme-btn') === cur ? 'true' : 'false');
    });
  }
  document.querySelectorAll('[data-theme-btn]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-theme-btn');
      root.setAttribute('data-theme', t);
      try { localStorage.setItem(KEY, t); } catch (e) {}
      sync();
    });
  });
  sync();
})();
</script>
`;
  html = html.replace('</body>', picker + '</body>');
}

writeFileSync(outFile, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('已生成预览：' + outFile.replace(ROOT, '.') + '  (' + kb + ' KB)');
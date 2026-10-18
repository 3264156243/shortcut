#!/usr/bin/env node
/**
 * 官网页面生成器（开发期工具）
 * ---------------------------------------------------------------------------
 * 为什么有它：9 个页面共用同一套 <head> / 面包屑 / 功能区块 / 翻页 / CTA 结构，
 * 手写重复度极高且容易漏改。这里用数据表生成静态 HTML —— **产出仍是纯静态文件**，
 * 部署时不需要 Node，也不引入构建链（符合"无构建"的站点要求）。
 *
 * 用法：
 *   node scripts/gen-site-pages.mjs
 *
 * 注意：index.html 是手写的（结构特殊），不由本脚本生成。
 *       功能页 / 下载页 / 更新日志页 / FAQ 页由本脚本生成。
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(here, '..', 'website');

/* ── 共用片段 ──────────────────────────────────────────────────────────── */

const BOOT_SCRIPT = `  <script>
  /* 明暗模式：在样式生效前应用，避免刷新闪烁 */
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

function head({ title, desc, canonical }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
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
${canonical ? `<link rel="canonical" href="${canonical}" />\n` : ''}
<link rel="icon" href="/assets/img/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" href="/assets/img/logo-64.png" sizes="64x64" />
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png" />

${BOOT_SCRIPT}
<link rel="stylesheet" href="/assets/css/site.css" />
<link rel="stylesheet" href="/assets/css/pages.css" />
</head>`;
}

const CTA = `  <!-- 结尾 CTA -->
  <section class="cta">
    <div class="wrap">
      <h2>试试 <span class="grad">ShortCut</span></h2>
      <p>Windows 10 / 11 · 免费下载 · 无需登录</p>
      <div class="btn-row center">
        <a class="btn btn--primary btn--lg" href="/download.html">下载最新版本</a>
        <a class="btn btn--ghost btn--lg" href="/faq.html">先看看常见问题</a>
      </div>
    </div>
  </section>`;

const SCRIPTS = `  <script src="/assets/js/data.js"></script>
  <script src="/assets/js/site.js"></script>
  <script src="/assets/js/motion.js"></script>`;

function crumbs(items) {
  const parts = ['<a href="/">首页</a>'];
  items.forEach((it) => {
    parts.push('<span>/</span>');
    parts.push(it.href ? `<a href="${it.href}">${it.label}</a>` : `<span>${it.label}</span>`);
  });
  return `        <nav class="crumbs" aria-label="面包屑">${parts.join('')}</nav>`;
}

function pager(prev, next) {
  if (!prev && !next) return '';
  const a = prev
    ? `        <a href="${prev.href}"><small>上一功能</small><b>← ${prev.label}</b></a>`
    : '        <span></span>';
  const b = next
    ? `        <a class="pager--next" href="${next.href}"><small>下一功能</small><b>${next.label} →</b></a>`
    : '        <span></span>';
  return `      <nav class="pager" aria-label="功能翻页">
${a}
${b}
      </nav>`;
}

function caps(list) {
  return list
    .map(
      ([icon, title, desc]) => `          <div class="capability reveal">
            <span class="cap-ico" data-icon="${icon}"></span>
            <div><b>${title}</b><p>${desc}</p></div>
          </div>`
    )
    .join('\n');
}

/* ── 页面数据 ──────────────────────────────────────────────────────────── */

const PAGES = [
  /* ═══════════ 1. 快捷启动 ═══════════ */
  {
    file: 'features/shortcut.html',
    nav: 'features',
    title: '快捷启动 — 常用软件、文件夹、网页一键直达 | ShortCut',
    desc: '把常用软件、文件、文件夹和网页集中到一处，用键盘快速选择并启动。支持图标自动提取、导入已安装软件、页签与分组管理。',
    crumbs: [{ label: '功能', href: '/features/shortcut.html' }, { label: '快捷启动' }],
    h1: '常用软件、文件夹、网页，<br />键盘一按直达',
    lead:
      '不用再回头找桌面图标或在开始菜单里翻。所有常用入口集中在同一页，用方向键选中、回车即启动；图标自动从程序里提取，也可以自己指定。',
    figure: `        <div class="device" role="img" aria-label="快捷启动界面示意图：左侧板块导航，右侧按分组排列的程序图标网格，其中一个为键盘选中态">
          <div class="device__bar">
            <span class="device__dots"><i></i><i></i><i></i></span>
            <span class="device__title">ShortCut</span>
            <span class="device__actions"><i></i><i></i></span>
          </div>
          <div class="pane">
            <div class="pane__side">
              <span class="pane__item is-active"><b></b>快捷方式</span>
              <span class="pane__item"><b></b>任务墙</span>
              <span class="pane__item"><b></b>驾驶舱</span>
              <span class="pane__item"><b></b>翻译</span>
              <span class="pane__item"><b></b>使用记录</span>
              <span class="pane__item"><b></b>控制</span>
            </div>
            <div class="pane__main">
              <div class="pane__search">搜索名称、路径或备注…</div>
              <div class="pane__grid">
                <span class="tile is-selected"></span><span class="tile"></span>
                <span class="tile"></span><span class="tile"></span>
                <span class="tile"></span><span class="tile"></span>
                <span class="tile"></span><span class="tile"></span>
                <span class="tile"></span><span class="tile"></span>
              </div>
            </div>
          </div>
        </div>`,
    sectionTitle: '能力细节',
    sectionDesc: '从「加进去」到「一按就开」，中间不需要额外操作。',
    caps: [
      ['bolt', '全局快捷键唤出', '默认 Alt+Space，在任何程序里都能叫出面板，不用先切回桌面。'],
      ['grid', '图标自动提取', '从程序自身资源里提取原始图标；也支持手动指定图标文件与网站图标自动抓取。'],
      ['check', '导入已安装软件', '扫描系统已安装程序，一键批量加入，不必逐个找路径。'],
      ['sticky', '页签与分组', '支持页签与分组管理，拖拽排序、跨分组移动，常用的一眼就能看到。'],
      ['send', '搜索与键盘导航', '按名称、路径、备注搜索；方向键选中、回车启动，全程可以不碰鼠标。'],
      ['windows', '支持四种入口', '应用、文件夹、普通文件、网页 URL，以及快捷方式组与 BAT 脚本。']
    ],
    extra: `  <!-- 快捷键 -->
  <section class="section section--alt">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">快捷键</span>
        <h2>常用的几个键</h2>
      </div>
      <div class="narrow">
        <table class="hotkey-table"><tbody id="hotkeyRows"></tbody></table>
      </div>
    </div>
  </section>`,
    inlineScript: `
  (function () {
    var D = SC.getData();
    var rows = document.getElementById('hotkeyRows');
    if (!rows || !D.HOTKEYS) return;
    D.HOTKEYS.forEach(function (h) {
      var keysHtml = h.keys.map(function (k) {
        return k === '/' ? '<span style="color:var(--muted-2)">/</span>' : '<span class="kbd">' + k + '</span>';
      }).join(' ');
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + keysHtml + '</td><td>' + h.desc + '</td>';
      rows.appendChild(tr);
    });
  })();`,
    pager: { prev: null, next: { href: '/features/taskwall.html', label: '任务墙' } }
  },

  /* ═══════════ 2. 任务墙 ═══════════ */
  {
    file: 'features/taskwall.html',
    nav: 'features',
    title: '任务墙 — 纸条式待办，贴上就不会忘 | ShortCut',
    desc: '纸条式任务墙：多面墙、长文本任务、待办提醒，手机钉一条任务电脑立刻出现，完成状态双向同步。',
    crumbs: [{ label: '功能', href: '/features/shortcut.html' }, { label: '任务墙' }],
    h1: '任务用纸条贴在墙上，<br />贴上就不会忘',
    lead:
      '与其在笔记软件里建十几个层级，不如把要做的事写成纸条钉在墙上。到时提醒会通过 SC球 弹出来；手机上也能钉任务，回到电脑前它已经在那了。',
    flip: true,
    figure: `        <div class="sticky-mock" role="img" aria-label="任务墙示意图：四张不同颜色的便签，分别写着待办事项与提醒时间">
          <div class="sticky"><b>周五前交设计稿</b>把首页的第二版改完，同步给客户确认<span class="sticky__meta"><span class="sticky__dot"></span>今天 18:00 提醒</span></div>
          <div class="sticky"><b>买路由器</b>家里那台老断流，换一个支持 Wi-Fi 6 的<span class="sticky__meta"><span class="sticky__dot"></span>普通待办</span></div>
          <div class="sticky"><b>备份照片</b>把手机里这两个月的照片导到移动硬盘<span class="sticky__meta"><span class="sticky__dot"></span>明天 09:30</span></div>
          <div class="sticky"><b>写周报</b>本周完成：官网重构、三处 bug 修复<span class="sticky__meta"><span class="sticky__dot"></span>手机钉入</span></div>
        </div>`,
    sectionTitle: '能力细节',
    sectionDesc: '轻量，但该有的都有。',
    caps: [
      ['sticky', '多面任务墙', '工作、生活、项目各一面墙，互不干扰；每面墙独立排序。'],
      ['check', '长文本与待办提醒', '纸条可以写长内容；待办型任务可设提醒时间，到点由 SC球 弹窗提示。'],
      ['clock', '到时提醒', '提醒弹窗支持「查看跳转」与「标记完成」，不用打开主面板。'],
      ['phone', '手机钉任务', '手机上钉一条，电脑任务墙立刻出现；桌面端离线也不会丢，上线自动接收。'],
      ['send', '完成状态双向同步', '在电脑上勾掉，手机上一并消失；反之亦然。'],
      ['bolt', '任务清单球', '重要任务可加入 SC任务清单球，常驻桌面随时看到还剩什么。']
    ],
    pager: { prev: { href: '/features/shortcut.html', label: '快捷启动' }, next: { href: '/features/scball.html', label: 'SC球 灵动岛' } }
  },

  /* ═══════════ 3. SC球 ═══════════ */
  {
    file: 'features/scball.html',
    nav: 'features',
    title: 'SC球 灵动岛 — 常驻桌面的小岛 | ShortCut',
    desc: 'SC球是常驻桌面的悬浮小岛：收起 / 迷你 / 展开三态，显示音乐封面歌词、任务提醒、驾驶舱温度与余额，可鼠标穿透，不挡桌面操作。',
    crumbs: [{ label: '功能', href: '/features/shortcut.html' }, { label: 'SC球 灵动岛' }],
    h1: '一颗小球，<br />收着音乐、任务和驾驶舱',
    lead:
      '平时缩成一条细胶囊，不占地方；要听歌时点开就有封面、歌词和播放控制。鼠标穿透可以打开，让它完全不挡桌面点击——想点它的时候按快捷键临时关闭穿透就行。',
    figure: `        <div class="hero__figure" style="perspective:none">
          <div class="device" role="img" aria-label="SC球 示意图：悬浮胶囊显示播放状态与进度，下方为设置项">
            <div class="device__bar">
              <span class="device__dots"><i></i><i></i><i></i></span>
              <span class="device__title">SC球 设置</span>
            </div>
            <div class="pane" style="grid-template-columns:1fr;min-height:auto;padding:16px;gap:0">
              <div class="island-live" style="position:relative;top:0;left:0;transform:none;margin:0 auto 18px">
                <span class="il-dot"></span>
                <span class="il-text">正在播放</span>
                <span class="il-track"><span class="il-fill"></span></span>
                <span class="il-wave"><i></i><i></i><i></i><i></i><i></i></span>
              </div>
              <div class="setting-row"><div>显示音乐模块<small>封面、歌词、播放控制</small></div><span class="switch is-on"></span></div>
              <div class="setting-row"><div>显示驾驶舱<small>CPU / GPU / 内存温度</small></div><span class="switch is-on"></span></div>
              <div class="setting-row"><div>鼠标穿透<small>开启后不挡桌面点击（Alt+B 切换）</small></div><span class="switch"></span></div>
            </div>
          </div>
        </div>`,
    sectionTitle: '能力细节',
    sectionDesc: '它常驻桌面，所以每一处都考虑「不打扰」。',
    caps: [
      ['island', '收起 / 迷你 / 展开三态', '收起时宽度随内容自适应，播放音乐时保持固定宽度，不会来回跳。'],
      ['send', '音乐封面与歌词', '内置网易云音乐桥：封面、进度、歌词逐字跳动、长歌词轮播，还能提前半句显示。'],
      ['check', '任务提醒球', '任务到时弹出提醒，可直接查看跳转或标记完成。'],
      ['bolt', '驾驶舱与余额', 'CPU/GPU/内存占用与温度随时可见；DeepSeek 余额每分钟刷新，播放音乐时分离成右侧小球。'],
      ['shield', '鼠标穿透', '打开后完全不挡桌面点击；窗口仍可被快捷快捷键唤起。默认 Alt+B 切换。'],
      ['windows', '独立置顶窗口', '与主面板互不影响：主面板关掉，SC球 仍在。']
    ],
    extra: `  <!-- 设置项 -->
  <section class="section section--alt">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">快捷键</span>
        <h2>球的几个键</h2>
      </div>
      <div class="narrow">
        <table class="hotkey-table"><tbody>
          <tr><td><span class="kbd">Alt</span> <span class="kbd">I</span></td><td>显示 / 隐藏 SC球</td></tr>
          <tr><td><span class="kbd">Alt</span> <span class="kbd">U</span></td><td>显示 / 隐藏 SC任务清单球</td></tr>
          <tr><td><span class="kbd">Alt</span> <span class="kbd">B</span></td><td>切换鼠标穿透</td></tr>
          <tr><td><span class="kbd">Alt</span> <span class="kbd">Z</span> / <span class="kbd">X</span> / <span class="kbd">C</span></td><td>音乐 上一首 / 播放暂停 / 下一首</td></tr>
        </tbody></table>
      </div>
    </div>
  </section>`,
    pager: { prev: { href: '/features/taskwall.html', label: '任务墙' }, next: { href: '/features/control.html', label: '手机控电脑' } }
  },

  /* ═══════════ 4. 手机控电脑 ═══════════ */
  {
    file: 'features/control.html',
    nav: 'features',
    title: '手机控电脑 — 手机当键盘触控板 | ShortCut',
    desc: '用手机远程操作电脑：键盘输入、触控板、常用组合键、剪贴板互传。云端中继 4G 可连，同一 Wi-Fi 下可局域网直连，延迟更低。',
    crumbs: [{ label: '功能', href: '/features/shortcut.html' }, { label: '手机控电脑' }],
    h1: '手机当键盘和触控板，<br />远程操作电脑',
    lead:
      '躺在沙发上想把电脑上的视频暂停？手机上打开联动页，就能打字、移动光标、按组合键。4G 网络下走云端中继也能连；同一个 Wi-Fi 里还能局域网直连，几乎感觉不到延迟。',
    figure: `        <div class="grid" style="gap:18px;justify-items:center">
          <div class="phone" role="img" aria-label="手机控制页示意图：输入框与常用按键">
            <div class="phone__screen">
              <div class="phone__title"><span class="dot-live"></span>电脑控制 · 已连接</div>
              <div class="phone__card is-accent"><span class="pc-dot"></span>键盘输入</div>
              <div class="phone__card"><span class="pc-dot"></span>触控板</div>
              <div class="phone__card"><span class="pc-dot"></span>组合键 Ctrl+C / Ctrl+V</div>
              <div class="phone__card"><span class="pc-dot"></span>剪贴板互传</div>
              <div class="phone__typing">输入文字，电脑上直接出现<span class="caret-line"></span></div>
            </div>
          </div>
        </div>`,
    sectionTitle: '能力细节',
    sectionDesc: '两种连接方式，按场景自动选择。',
    caps: [
      ['cloud', '云端中继（4G 可用）', '不在同一网络也能连：手机与电脑各自连到你的服务器，经中继转发指令。'],
      ['bolt', '局域网直连', '同一 Wi-Fi 下直连桌面 9823 端口，不绕服务器，延迟最低。'],
      ['grid', '键盘输入', '手机输入法打的中文、符号直接注入电脑当前焦点窗口。'],
      ['phone', '触控板与组合键', '相对移动的光标、单击双击、常用组合键一键触发。'],
      ['send', '剪贴板互传', '把手机上的文本发到电脑剪贴板，也能反过来取。'],
      ['shield', '权限最小化', '必须先在桌面端开启控制服务并完成配对；随时可一键停止。']
    ],
    extra: `  <section class="section section--alt">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">安全提示</span>
        <h2>关于暴露面</h2>
        <p>远程控制天然是敏感功能，所以我们把话说清楚。</p>
      </div>
      <div class="narrow">
        <div class="capability reveal" style="margin-bottom:12px">
          <span class="cap-ico" data-icon="shield"></span>
          <div><b>局域网模式会监听本机端口</b><p>开启后桌面端监听 <code>0.0.0.0:9823</code>，仅接受通过配对码鉴权的连接。<strong>不要在公共 Wi-Fi 下开启</strong>；用完即关最安全。</p></div>
        </div>
        <div class="capability reveal">
          <span class="cap-ico" data-icon="check"></span>
          <div><b>云端通道需要绑定关系</b><p>中继只接受已绑定的手机与桌面，指令走一次性 ticket；服务器不保存你的输入内容。</p></div>
        </div>
      </div>
    </div>
  </section>`,
    pager: { prev: { href: '/features/scball.html', label: 'SC球 灵动岛' }, next: { href: '/features/transfer.html', label: '文件快传' } }
  },

  /* ═══════════ 5. 文件快传 ═══════════ */
  {
    file: 'features/transfer.html',
    nav: 'features',
    title: '文件快传 — 手机与电脑互传文件 | ShortCut',
    desc: '手机与电脑互传文件与文本：分片上传大文件、按有效期自动清理、生成分享链接、哈希校验，不经过第三方网盘。',
    crumbs: [{ label: '功能', href: '/features/shortcut.html' }, { label: '文件快传' }],
    h1: '手机电脑互传文件，<br />不用再折腾数据线',
    lead:
      '把文件丢上去，另一头就能取。文件存在你自己的服务器上，按有效期自动清理，不经过任何第三方网盘；大文件走分片上传，中断了也能续。',
    flip: true,
    figure: `        <div class="file-mock" role="img" aria-label="文件快传示意图：三个文件条目，其中一个正在上传并显示进度">
          <div class="file-mock__bar"><span class="dot-live"></span>我的传输 · 3 个文件</div>
          <div class="file-row">
            <span class="file-row__ico">PDF</span>
            <div><div class="file-row__name">产品说明书-v2.pdf</div><div class="file-row__meta">2.4 MB · 有效期 24 小时</div></div>
            <span class="file-row__pct">100%</span>
          </div>
          <div class="file-row">
            <span class="file-row__ico">ZIP</span>
            <div><div class="file-row__name">项目备份-20261018.zip</div><div class="file-row__meta">86.1 MB · 分片上传中</div></div>
            <span class="file-row__pct">64%</span>
          </div>
          <div class="file-row">
            <span class="file-row__ico">PNG</span>
            <div><div class="file-row__name">截图-灵动岛.png</div><div class="file-row__meta">480 KB · 已生成分享链接</div></div>
            <span class="file-row__pct">100%</span>
          </div>
        </div>`,
    sectionTitle: '能力细节',
    sectionDesc: '传完就忘，剩下的交给有效期。',
    caps: [
      ['send', '分片上传大文件', '大文件切片上传，网络中断可续传，不要求一次传完。'],
      ['clock', '有效期自动清理', '每个文件可设有效期，到期自动删除，不用手动维护空间。'],
      ['check', '哈希校验', '上传与下载都做完整性校验，避免传出一个损坏的文件。'],
      ['grid', '文本也能传', '一段文字、一个链接，直接发到另一端剪贴板，比复制粘贴跨设备省事。'],
      ['shield', '不经第三方网盘', '文件存放在你自己部署的服务器，链接可控、可随时撤销。'],
      ['windows', '分享链接', '生成一个带有效期的下载链接，发给别人也不需要对方装客户端。']
    ],
    pager: { prev: { href: '/features/control.html', label: '手机控电脑' }, next: { href: '/features/android.html', label: '安卓端' } }
  },

  /* ═══════════ 6. 安卓端 ═══════════ */
  {
    file: 'features/android.html',
    nav: 'features',
    title: '安卓端 — 原生 Android 客户端 | ShortCut',
    desc: 'ShortCut 安卓端：原生 Kotlin 客户端，与桌面端使用同一套接口契约。支持应用内更新、局域网直连与设备绑定。',
    crumbs: [{ label: '功能', href: '/features/shortcut.html' }, { label: '安卓端' }],
    h1: '安卓端：<br />把联动装进口袋',
    lead:
      '手机网页用浏览器打开就能用，而安卓端是原生 App —— 界面更跟手，支持应用内更新，同一 Wi-Fi 下还有局域网直连。它与桌面端用同一套接口契约，功能会和桌面端一起更新。',
    figure: `        <div class="grid" style="gap:18px;justify-items:center">
          <div class="phone" role="img" aria-label="安卓端示意图：应用首页功能入口">
            <div class="phone__screen">
              <div class="phone__title"><span class="dot-live"></span>ShortCut</div>
              <div class="phone__card is-accent"><span class="pc-dot"></span>我的电脑 · 已连接</div>
              <div class="phone__card"><span class="pc-dot"></span>任务墙</div>
              <div class="phone__card"><span class="pc-dot"></span>文件快传</div>
              <div class="phone__card"><span class="pc-dot"></span>电脑控制</div>
              <div class="phone__card"><span class="pc-dot"></span>检查更新</div>
            </div>
          </div>
        </div>`,
    sectionTitle: '能力细节',
    sectionDesc: '与桌面端同一套契约，功能同步推进。',
    caps: [
      ['android', '原生 Kotlin 客户端', '不是套壳网页，界面与交互按 Android 习惯实现。'],
      ['cloud', '应用内更新', '读取官网更新清单，检查到新版本直接引导安装，不用手动找 APK。'],
      ['bolt', '局域网直连', '同一 Wi-Fi 下直连桌面端，指令延迟更低。'],
      ['phone', '设备绑定', '用绑定码把手机与电脑配对一次，之后自动识别。'],
      ['send', '任务墙 / 快传 / 控制', '桌面端三大联动能力在手机上都能用。'],
      ['shield', '同一份接口契约', '所有接口与字段以《移动互联-协议契约》为准，不会出现两端行为不一致。']
    ],
    extra: `  <section class="section section--alt">
    <div class="wrap">
      <div class="android-card reveal">
        <span class="ac-icon" data-icon="android"></span>
        <div>
          <b style="font-size:16px">下载安卓端</b>
          <div style="color:var(--muted);font-size:13.5px;margin-top:4px" id="androidMeta">正在读取版本…</div>
        </div>
        <a class="btn btn--primary" id="androidDl" href="/download.html">获取安装包</a>
      </div>
    </div>
  </section>`,
    inlineScript: `
  SC.loadAndroidVersion().then(function (a) {
    if (!a) return;
    var m = document.getElementById('androidMeta');
    if (m) m.textContent = '版本 ' + a.version + ' · ' + SC.formatSize(a.size) + ' · APK';
    var b = document.getElementById('androidDl');
    if (b && a.url) { b.href = a.url; b.textContent = '下载 APK'; }
  });`,
    pager: { prev: { href: '/features/transfer.html', label: '文件快传' }, next: null }
  },

  /* ═══════════ 7. 下载页 ═══════════ */
  {
    file: 'download.html',
    nav: 'download',
    title: '下载 ShortCut — Windows 桌面效率工具',
    desc: '下载 ShortCut 最新版：官网直链、蓝奏云、Gitee、GitHub 四个渠道，含安卓端 APK。Windows 10 / 11 64 位。',
    crumbs: [{ label: '下载' }],
    h1: '下载 ShortCut',
    lead: '选择一个渠道下载。官网直链始终是最新版本；蓝奏云在国内下载较快，但需要手动同步，版本可能稍滞后。',
    customBody: true
  },

  /* ═══════════ 8. 更新日志 ═══════════ */
  {
    file: 'changelog.html',
    nav: 'changelog',
    title: '更新日志 — ShortCut 版本变更记录',
    desc: 'ShortCut 的版本更新记录：每个版本修复了什么、新增了什么。最新版本信息实时读取更新清单。',
    crumbs: [{ label: '更新日志' }],
    h1: '更新日志',
    lead: '最新版本信息从更新清单实时读取，历史版本记录在站点数据里维护。',
    customBody: true
  },

  /* ═══════════ 9. FAQ ═══════════ */
  {
    file: 'faq.html',
    nav: 'faq',
    title: '常见问题 — ShortCut',
    desc: 'ShortCut 常见问题：安装与更新、功能使用、移动互联、隐私与数据、安卓端。',
    crumbs: [{ label: '常见问题' }],
    h1: '常见问题',
    lead: '按分类整理。没找到答案可以到仓库的问答台留言。',
    customBody: true
  }
];

/* ── 生成 ──────────────────────────────────────────────────────────────── */

function renderFeaturePage(p) {
  const lead = p.flip
    ? `<div class="feature-lead feature-lead--flip">
        <div class="feature-lead__text reveal">
          <p class="hero__lead" style="margin-bottom:0">${p.lead}</p>
        </div>
        <div class="reveal">${p.figure}</div>
      </div>`
    : `<div class="feature-lead">
        <div class="feature-lead__text reveal">
          <p class="hero__lead" style="margin-bottom:0">${p.lead}</p>
        </div>
        <div class="reveal">${p.figure}</div>
      </div>`;

  return `${head({ title: p.title, desc: p.desc })}

<body data-page="${p.nav}">

<div id="site-nav"></div>

<main>

  <section class="page-head">
    <div class="wrap">
${crumbs(p.crumbs)}
      <h1>${p.h1}</h1>
    </div>
  </section>

  <section class="section section--flush">
    <div class="wrap">
${lead}
    </div>
  </section>

  <section class="section section--alt">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">${p.sectionTitle}</span>
        <h2>${p.sectionDesc}</h2>
      </div>
      <div class="grid grid--2" style="gap:14px">
${caps(p.caps)}
      </div>
    </div>
  </section>

${p.extra || ''}

  <section class="section">
    <div class="wrap">
${pager(p.pager && p.pager.prev, p.pager && p.pager.next)}
    </div>
  </section>

${CTA}

</main>

<div id="site-footer"></div>

${SCRIPTS}
  <script>
  (function () {
    'use strict';
    Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (n) {
      n.innerHTML = SC.icon(n.getAttribute('data-icon'), 20);
    });${p.inlineScript || ''}
  })();
  <\/script>
</body>
</html>
`;
}

/* 自定义页面的额外脚本引用 */
const EXTRA_SCRIPTS = {
  'download.html': '  <script src="/assets/js/download.js"></script>',
  'changelog.html': '  <script src="/assets/js/changelog.js"></script>',
  'faq.html': '  <script src="/assets/js/faq.js"></script>'
};

let written = 0;
for (const p of PAGES) {
  const outPath = join(SITE, p.file);
  mkdirSync(dirname(outPath), { recursive: true });

  let html;
  if (p.customBody) {
    /* 自定义主体：从独立片段文件读取 body 内容 */
    const bodyPath = join(SITE, '_bodies', p.file.replace(/\//g, '__'));
    if (!existsSync(bodyPath)) {
      console.warn('跳过（缺少主体片段）：' + p.file);
      continue;
    }
    const body = readFileSync(bodyPath, 'utf8');
    html = `${head({ title: p.title, desc: p.desc })}

<body data-page="${p.nav}">

<div id="site-nav"></div>

<main>

  <section class="page-head">
    <div class="wrap">
${crumbs(p.crumbs)}
      <h1>${p.h1}</h1>
      <p>${p.lead}</p>
    </div>
  </section>

${body}

${CTA}

</main>

<div id="site-footer"></div>

${SCRIPTS}
${EXTRA_SCRIPTS[p.file] || ''}
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
  } else {
    html = renderFeaturePage(p);
  }

  writeFileSync(outPath, html, 'utf8');
  console.log('✓ ' + p.file + '  (' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB)');
  written++;
}

console.log('\n共生成 ' + written + ' 个页面。');

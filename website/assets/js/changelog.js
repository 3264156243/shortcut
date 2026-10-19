/**
 * 更新日志页逻辑
 * ---------------------------------------------------------------------------
 * 数据：
 *   - 最新版本  → /updates/latest.json（版本 / 日期 / 体积 / 说明），失败静默降级
 *   - 全部版本  → assets/js/changelog-data.js（由 scripts/gen-changelog-data.mjs 生成）
 *
 * 交互：
 *   - 每个版本是一个时间点，点开显示该版本的分组更新内容（原生 <details>）
 *   - 最新两个版本默认展开；顶部有版本索引可跳转
 *   - 「展开全部版本」一键全开
 */
(function (global) {
  'use strict';

  var doc = document;
  var ALL = global.SC_CHANGELOG || [];
  var isEN = (doc.documentElement.getAttribute('lang') || 'zh-CN').toLowerCase().indexOf('en') === 0;
  var L = isEN ? {
    index: 'Version index',
    noData: 'Release history has not been generated yet.',
    current: 'Current',
    items: 'updates',
    stats: ' version releases, ',
    statsTail: ' updates. Dates come from the first commit of each release note.',
    expand: 'Expand all versions',
    collapse: 'Collapse all versions',
    genericNote: 'Detailed release notes are currently maintained in Chinese. Open the full history below.',
    noNotes: 'No detailed notes yet.'
  } : {
    index: '版本索引',
    noData: '版本数据尚未生成。',
    current: '当前',
    items: '项更新',
    stats: '共 ',
    statsTail: ' 个版本、',
    expand: '展开全部版本',
    collapse: '收起全部版本',
    genericNote: '暂无详细说明。',
    noNotes: '暂无详细说明。'
  };

  function $(id) { return doc.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }

  // Public release notes should describe what changed for users, not the
  // implementation details kept in the repository.
  function publicText(value) {
    return String(value || '')
      .replace(/Tauri\s*2?/gi, '桌面端')
      .replace(/Electron/gi, '旧版桌面端')
      .replace(/侧车/g, '后台组件')
      .replace(/构建机/g, '不同电脑')
      .replace(/前端/g, '界面')
      .replace(/后端/g, '服务')
      .replace(/技术栈/g, '整体升级')
      .replace(/后台组件/g, '运行组件')
      .replace(/静态页/g, '界面')
      .replace(/可执行文件/g, '程序')
      .replace(/打包资源/g, '安装内容')
      .replace(/实例守卫/g, '启动检查')
      .replace(/音乐桥/g, '音乐连接')
      .replace(/hardware-monitor\s*\/\s*music-bridge\s*\/\s*usage-monitor/gi, '硬件监控、音乐与使用记录组件')
      .replace(/SHA-256\s*哈希完整性校验/gi, '文件完整性校验')
      .replace(/SHA-256/gi, '')
      .replace(/app-update\.yml/gi, '更新服务配置')
      .replace(/API/gi, '服务')
      .replace(/JSONL/gi, '反馈记录')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* ═══ 1. 最新版本（动态）══════════════════════════════════════════════ */
  global.SC.loadDesktopVersion().then(function (v) {
    setText('latestVersion', 'v' + v.version);
    setText('latestDate', v.pubDate || '—');
    setText('latestSize', v.size ? global.SC.formatSize(v.size) : '—');

    var list = $('latestNotes');
    if (list) {
      var notes = (v.notes || '').split(/\r?\n/)
        .map(function (s) { return s.replace(/^[#*\-\s]+/, '').trim(); })
        .filter(function (s) { return s && s.length > 3; })
        .map(publicText);

      if (isEN) {
        notes = [L.genericNote];
      } else if (!notes.length) {
        var top = ALL[0];
        notes = top && top.groups.length ? top.groups[0].items.slice(0, 4).map(publicText) : [L.noNotes];
      }
      list.innerHTML = notes.map(function (s) { return '<li>' + s + '</li>'; }).join('');
    }

    var dl = $('latestDownload');
    if (dl && v.url) dl.href = v.url;
  });

  /* ═══ 2. 版本索引 ═════════════════════════════════════════════════════ */
  var index = $('versionIndex');
  if (index && ALL.length) {
    index.innerHTML =
      '<span class="version-index__label">' + L.index + '</span>' +
      ALL.map(function (v) {
        return '<a href="#v' + v.version.replace(/\./g, '-') + '">v' + v.version + '</a>';
      }).join('');
  }

  /* ═══ 3. 完整时间轴 ═══════════════════════════════════════════════════ */
  var tl = $('timeline');
  if (!tl) return;

  if (!ALL.length) {
    tl.innerHTML = '<p style="color:var(--muted)">' + L.noData + '</p>';
    return;
  }

  var totalItems = 0;

  tl.innerHTML = ALL.map(function (v, i) {
    var count = v.groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    totalItems += count;

    var groupsHtml = v.groups.map(function (g) {
      return '<div class="rel-group">' +
        (g.title ? '<h4>' + publicText(g.title) + '</h4>' : '') +
        '<ul>' + g.items.map(function (x) { return '<li>' + publicText(x) + '</li>'; }).join('') + '</ul>' +
      '</div>';
    }).join('');

    return '<details class="timeline__item rel"' +
      (i < 2 ? ' open' : '') +
      ' id="v' + v.version.replace(/\./g, '-') + '"' +
      ' style="--d:' + (i * 40) + 'ms">' +
      '<summary class="timeline__head">' +
        '<span class="timeline__ver">v' + v.version + '</span>' +
        '<span class="timeline__date">' + (v.date || '') + '</span>' +
        (i === 0 ? '<span class="tag tag--accent">' + L.current + '</span>' : '') +
        '<span class="rel__count">' + count + ' ' + L.items + '</span>' +
        '<span class="rel__chev" aria-hidden="true"></span>' +
      '</summary>' +
      '<div class="rel__body">' + groupsHtml + '</div>' +
    '</details>';
  }).join('');

  setText('timelineStats', isEN
    ? ALL.length + L.stats + totalItems + L.statsTail
    : L.stats + ALL.length + L.statsTail + totalItems + ' 条更新；日期取自对应版本说明的首次提交时间。');

  /* 展开全部 / 收起全部 */
  var btn = $('expandAll');
  if (btn) {
    function sync() {
      var allOpen = Array.prototype.every.call(tl.querySelectorAll('details'), function (d) { return d.open; });
      btn.textContent = allOpen ? L.collapse : L.expand;
      btn.setAttribute('data-all-open', allOpen ? '1' : '0');
    }
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('data-all-open') === '1';
      Array.prototype.forEach.call(tl.querySelectorAll('details'), function (d) { d.open = !open; });
      sync();
    });
    tl.addEventListener('toggle', sync, true);
    sync();
  }

  /* 从索引点击时的平滑定位（考虑固定导航） */
  index && index.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var el = doc.querySelector(a.getAttribute('href'));
    if (!el) return;
    e.preventDefault();
    el.open = true;
    var navH = parseInt(getComputedStyle(doc.documentElement).getPropertyValue('--nav-h'), 10) || 68;
    var y = el.getBoundingClientRect().top + global.pageYOffset - navH - 18;
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    global.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  });

  /* 入场 */
  if ('IntersectionObserver' in global) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.03 });
    Array.prototype.forEach.call(tl.querySelectorAll('.reveal'), function (n) { io.observe(n); });
  }
})(window);

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

  function $(id) { return doc.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }

  /* ═══ 1. 最新版本（动态）══════════════════════════════════════════════ */
  global.SC.loadDesktopVersion().then(function (v) {
    setText('latestVersion', 'v' + v.version);
    setText('latestDate', v.pubDate || '—');
    setText('latestSize', v.size ? global.SC.formatSize(v.size) : '—');

    var list = $('latestNotes');
    if (list) {
      var notes = (v.notes || '').split(/\r?\n/)
        .map(function (s) { return s.replace(/^[#*\-\s]+/, '').trim(); })
        .filter(function (s) { return s && s.length > 3; });

      if (!notes.length) {
        var top = ALL[0];
        notes = top && top.groups.length ? top.groups[0].items.slice(0, 4) : ['暂无详细说明，见仓库 release-notes 目录'];
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
      '<span class="version-index__label">版本索引</span>' +
      ALL.map(function (v) {
        return '<a href="#v' + v.version.replace(/\./g, '-') + '">v' + v.version + '</a>';
      }).join('');
  }

  /* ═══ 3. 完整时间轴 ═══════════════════════════════════════════════════ */
  var tl = $('timeline');
  if (!tl) return;

  if (!ALL.length) {
    tl.innerHTML = '<p style="color:var(--muted)">版本数据尚未生成。</p>';
    return;
  }

  var totalItems = 0;

  tl.innerHTML = ALL.map(function (v, i) {
    var count = v.groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    totalItems += count;

    var groupsHtml = v.groups.map(function (g) {
      return '<div class="rel-group">' +
        (g.title ? '<h4>' + g.title + '</h4>' : '') +
        '<ul>' + g.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
      '</div>';
    }).join('');

    return '<details class="timeline__item rel"' +
      (i < 2 ? ' open' : '') +
      ' id="v' + v.version.replace(/\./g, '-') + '"' +
      ' style="--d:' + (i * 40) + 'ms">' +
      '<summary class="timeline__head">' +
        '<span class="timeline__ver">v' + v.version + '</span>' +
        '<span class="timeline__date">' + (v.date || '') + '</span>' +
        (i === 0 ? '<span class="tag tag--accent">当前</span>' : '') +
        '<span class="rel__count">' + count + ' 项更新</span>' +
        '<span class="rel__chev" aria-hidden="true"></span>' +
      '</summary>' +
      '<div class="rel__body">' + groupsHtml + '</div>' +
    '</details>';
  }).join('');

  setText('timelineStats', '共 ' + ALL.length + ' 个版本、' + totalItems + ' 条更新；日期取自对应版本说明的首次提交时间。');

  /* 展开全部 / 收起全部 */
  var btn = $('expandAll');
  if (btn) {
    function sync() {
      var allOpen = Array.prototype.every.call(tl.querySelectorAll('details'), function (d) { return d.open; });
      btn.textContent = allOpen ? '收起全部版本' : '展开全部版本';
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

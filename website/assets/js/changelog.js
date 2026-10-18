/**
 * 更新日志页逻辑
 * ---------------------------------------------------------------------------
 * - 最新版本：读 /updates/latest.json（版本 / 日期 / 体积 / 说明），失败静默降级
 * - 历史版本：来自 data.js 的 CHANGELOG（手工维护，改一处全站生效）
 */
(function (global) {
  'use strict';

  var D = global.SC_DATA || {};
  var doc = document;

  function $(id) { return doc.getElementById(id); }
  function setText(id, t) { var n = $(id); if (n) n.textContent = t; }

  /* ═══ 1. 最新版本 ═════════════════════════════════════════════════════ */
  global.SC.loadDesktopVersion().then(function (v) {
    setText('latestVersion', 'v' + v.version);
    setText('latestDate', v.pubDate || '—');
    setText('latestSize', v.size ? global.SC.formatSize(v.size) : '—');

    var list = $('latestNotes');
    if (list) {
      var notes = (v.notes || '').split(/\r?\n/).map(function (s) {
        return s.replace(/^[#*\-\s]+/, '').trim();
      }).filter(function (s) { return s && s.length > 3; });

      if (!notes.length) {
        var top = (D.CHANGELOG || [])[0];
        notes = top ? top.items : ['暂无详细说明，见仓库 release-notes 目录'];
      }
      list.innerHTML = notes.map(function (s) { return '<li>' + s + '</li>'; }).join('');
    }

    var dl = $('latestDownload');
    if (dl && v.url) dl.href = v.url;
  });

  /* ═══ 2. 历史版本时间线 ═══════════════════════════════════════════════ */
  var tl = $('timeline');
  if (tl) {
    var items = D.CHANGELOG || [];
    tl.innerHTML = items.map(function (it, i) {
      return '<div class="timeline__item reveal" style="--d:' + (i * 60) + 'ms">' +
        '<div class="timeline__head">' +
          '<span class="timeline__ver">v' + it.version + '</span>' +
          '<span class="timeline__date">' + (it.date || '') + '</span>' +
          (i === 0 ? '<span class="tag">当前</span>' : '') +
        '</div>' +
        '<ul>' + (it.items || []).map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
      '</div>';
    }).join('');

    if ('IntersectionObserver' in global) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.05 });
      Array.prototype.forEach.call(tl.querySelectorAll('.reveal'), function (n) { io.observe(n); });
    } else {
      Array.prototype.forEach.call(tl.querySelectorAll('.reveal'), function (n) { n.classList.add('is-in'); });
    }
  }
})(window);

/**
 * 下载页逻辑
 * ---------------------------------------------------------------------------
 * - 桌面端版本号 / 日期 / 体积：读 /updates/latest.json（失败用 data.js 兜底）
 * - 四个渠道卡片：从 data.js 的 CHANNELS 渲染
 * - 安卓端：读 /updates/android/latest.json
 * - 蓝奏云：点按弹出提取码（不用把码印在页面上）
 */
(function (global) {
  'use strict';

  var D = global.SC_DATA || {};
  var doc = document;
  var isEN = (doc.documentElement.getAttribute('lang') || 'zh-CN').toLowerCase().indexOf('en') === 0;
  var L = isEN ? {
    recommended: 'Recommended',
    stale: 'Synced manually; the version may lag behind',
    getCode: 'Get access code',
    download: 'Download installer',
    open: 'Open',
    codeTitle: ' access code',
    codeHint: 'Copy it, then enter it on the share page to download.',
    copyCode: 'Copy access code',
    copied: 'Copied',
    openShare: 'Open share page',
    main: 'Download installer',
    androidVersion: 'Version '
  } : {
    recommended: '推荐',
    stale: '需手动同步，版本可能滞后',
    getCode: '获取提取码',
    download: '下载安装包',
    open: '打开',
    codeTitle: ' 提取码',
    codeHint: '复制后在分享页输入即可下载',
    copyCode: '复制提取码',
    copied: '已复制',
    openShare: '打开分享页',
    main: '下载安装包',
    androidVersion: '版本 '
  };

  function $(id) { return doc.getElementById(id); }

  /* ═══ 1. 渠道卡片 ═════════════════════════════════════════════════════ */
  var desktopUrl = null;

  function renderChannels(version) {
    var grid = $('channelGrid');
    if (!grid) return;
    grid.innerHTML = '';

    (D.CHANNELS || []).forEach(function (ch) {
      var card = doc.createElement('div');
      card.className = 'card card--channel reveal' + (ch.recommend ? ' is-recommend' : '');

      var url = ch.id === 'server' ? (desktopUrl || ch.fallbackUrl) : ch.url;
      var isFile = ch.id === 'server';

      var headHtml =
        '<div class="channel__head">' +
          '<span class="channel-icon">' + global.SC.icon(ch.icon, 18) + '</span>' +
          '<span class="channel__name">' + ch.label + '</span>' +
          (ch.recommend ? '<span class="tag">' + L.recommended + '</span>' : '') +
        '</div>' +
        '<div class="channel__desc">' + ch.desc + '</div>';

      var noteHtml = ch.note ? '<div class="channel-note">' + ch.note + '</div>' : '';
      var staleHtml = ch.mayBeStale
        ? '<div class="channel-note" style="color:var(--muted-2)">' + L.stale + '</div>'
        : '';

      var btnHtml;
      if (ch.id === 'lanzou') {
        btnHtml = '<button class="btn btn--block" type="button">' + L.getCode + '</button>';
      } else {
        btnHtml = '<a class="btn btn--block' + (ch.recommend ? ' btn--primary' : '') + '" href="' + url +
          '"' + (isFile ? ' download' : ' target="_blank" rel="noopener"') + '>' +
          (isFile ? L.download : L.open) + '</a>';
      }

      card.innerHTML = headHtml + btnHtml + staleHtml + noteHtml;

      /* 蓝奏云：弹层显示提取码 */
      if (ch.id === 'lanzou') {
        card.querySelector('button').addEventListener('click', function () {
          global.SC.openModal(
            '<h3 style="margin-bottom:6px">' + ch.label + L.codeTitle + '</h3>' +
            '<p style="color:var(--muted);font-size:13.5px;margin-bottom:0">' + L.codeHint + '</p>' +
            '<div class="modal__code">' + ch.code + '</div>' +
            '<div class="btn-row" style="justify-content:center">' +
              '<button class="btn btn--primary btn--sm" id="copyCode" type="button">' + L.copyCode + '</button>' +
              '<a class="btn btn--ghost btn--sm" href="' + ch.url + '" target="_blank" rel="noopener">' + L.openShare + '</a>' +
            '</div>'
          );
          var copyBtn = $('copyCode');
          if (copyBtn) {
            copyBtn.addEventListener('click', function () {
              copyText(ch.code).then(function (ok) {
                copyBtn.textContent = ok ? L.copied : ch.code;
                setTimeout(function () { copyBtn.textContent = L.copyCode; }, 1800);
              });
            });
          }
        });
      }

      grid.appendChild(card);
    });

    revealNew(grid);
  }

  function copyText(text) {
    if (global.navigator && global.navigator.clipboard) {
      return global.navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    doc.body.removeChild(ta);
    return ok;
  }

  function revealNew(scope) {
    if (!('IntersectionObserver' in global)) {
      Array.prototype.forEach.call(scope.querySelectorAll('.reveal'), function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.05 });
    Array.prototype.forEach.call(scope.querySelectorAll('.reveal'), function (n) { io.observe(n); });
  }

  /* ═══ 2. 版本信息 ═════════════════════════════════════════════════════ */
  function setText(id, text) {
    var n = $(id);
    if (n) n.textContent = text;
  }

  global.SC.loadDesktopVersion().then(function (v) {
    desktopUrl = v.url;

    setText('dlVersion', 'v' + v.version);
    setText('dlDate', v.pubDate || '—');
    setText('dlSize', v.size ? global.SC.formatSize(v.size) : '—');
    setText('factVersion', 'v' + v.version);
    setText('factSize', v.size ? global.SC.formatSize(v.size) : '—');

    var main = $('dlMain');
    if (main && v.url) {
      main.href = v.url;
      main.setAttribute('download', '');
      main.textContent = L.main + (v.size ? (isEN ? ' (' : '（') + global.SC.formatSize(v.size) + (isEN ? ')' : '）') : '');
    }

    renderChannels(v);
  });

  /* ═══ 3. 安卓端 ═══════════════════════════════════════════════════════ */
  global.SC.loadAndroidVersion().then(function (a) {
    if (!a) return;
    setText('androidMeta', L.androidVersion + a.version + (a.versionCode ? (isEN ? ' (versionCode ' : '（versionCode ') + a.versionCode + (isEN ? ')' : '）') : '') +
      ' · ' + global.SC.formatSize(a.size) + ' · Android');
    var btn = $('androidDl');
    if (btn && a.url) btn.href = a.url;
  });
})(window);

/**
 * ShortCut 官网 · 公共脚本
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 注入顶部导航与页脚（9 个页面只维护一处）
 *   2. 导航交互：滚动加深、功能下拉、手机汉堡抽屉
 *   3. 通用组件：内联 SVG 图标、弹层、滚动入场、当前页高亮
 *   4. 数据读取：latest.json / 安卓 latest.json / 安装包体积
 *
 * 无任何外部依赖。
 */
(function (global) {
  'use strict';

  var D = global.SC_DATA || {};

  /* ═══ 1. 内联 SVG 图标（避免外部图标库）══════════════════════════════ */
  var ICONS = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    sticky: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/>',
    island: '<rect x="2" y="8" width="20" height="8" rx="4"/><circle cx="8" cy="12" r="1.6"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10.5 18.5h3"/>',
    send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4z"/>',
    android: '<path d="M6 9h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/><path d="M9.5 5.5L8 4M14.5 5.5L16 4"/>',
    download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.2 9.6A4.2 4.2 0 0 0 7 18z"/>',
    gitee: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    github: '<path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5a3 3 0 0 0-.9-2.6c3-.3 6-1.6 6-6.9a5.4 5.4 0 0 0-1.5-3.8A5 5 0 0 0 17.9 1s-1.2-.4-4 1.5a12 12 0 0 0-6.4 0C4.7.6 3.5 1 3.5 1a5 5 0 0 0-1.5 3.8C2 9.9 5 11.2 8 11.5A3 3 0 0 0 7.1 14V20"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
    windows: '<path d="M3 5.5l7.5-1v7H3zM12 4.2l9-1.2v8.5h-9zM3 13h7.5v7L3 18.5zM12 13h9v8l-9-1.2z"/>'
  };

  function icon(name, size) {
    var p = ICONS[name] || ICONS.check;
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + p + '</svg>';
  }

  /* ═══ 2. 页面元信息工具 ═══════════════════════════════════════════════ */
  function pageId() {
    return (document.body && document.body.getAttribute('data-page')) || '';
  }
  function isExternal(href) {
    return /^https?:\/\//i.test(href || '');
  }
  function attr(el, k, v) {
    if (v != null) el.setAttribute(k, v);
    return el;
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ═══ 3. 导航 ═════════════════════════════════════════════════════════ */
  function buildNav() {
    var nav = el('nav', 'nav');
    nav.setAttribute('aria-label', '主导航');

    var inner = el('div', 'nav__inner');

    /* Logo */
    var logo = el('a', 'logo');
    logo.href = '/';
    logo.innerHTML = '<img class="logo__img" src="/assets/img/logo-256.png" alt="" width="32" height="32" decoding="async" /><span>ShortCut</span>';
    inner.appendChild(logo);

    /* 桌面链接 */
    var links = el('div', 'nav__links');
    (D.NAV || []).forEach(function (item) {
      var wrap = el('div', 'nav__item');
      var a = el('a', 'nav__link');
      a.href = item.href;
      a.innerHTML = item.label + (item.children ? '<i class="caret"></i>' : '');
      if (item.id === pageId() || (item.children && pageId() === 'features')) {
        a.setAttribute('aria-current', 'page');
      }
      wrap.appendChild(a);

      if (item.children) {
        var dd = el('div', 'nav__dropdown');
        item.children.forEach(function (c) {
          var ca = el('a', null, c.label);
          ca.href = c.href;
          dd.appendChild(ca);
        });
        wrap.appendChild(dd);

        /* 悬停展开（桌面） */
        wrap.addEventListener('mouseenter', function () { wrap.classList.add('nav__item--open'); });
        wrap.addEventListener('mouseleave', function () { wrap.classList.remove('nav__item--open'); });
        /* 键盘/点击展开 */
        a.addEventListener('click', function (e) {
          /* 手机端无悬停，首次点击展开菜单；桌面端直接进入首个子页 */
          if (global.matchMedia('(hover: none)').matches) {
            e.preventDefault();
            wrap.classList.toggle('nav__item--open');
          }
        });
        a.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            wrap.classList.add('nav__item--open');
            var first = dd.querySelector('a');
            if (first) first.focus();
          }
        });
        wrap.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { wrap.classList.remove('nav__item--open'); a.focus(); }
        });
      } else {
        wrap.appendChild(a);
      }
      links.appendChild(wrap);
    });
    inner.appendChild(links);

    /* 右侧操作 */
    var actions = el('div', 'nav__actions');

    /* 语言切换：中文 ↔ English */
    var isEN = (document.documentElement.getAttribute('lang') || 'zh-CN').toLowerCase().indexOf('en') === 0;
    var langBtn = el('a', 'nav__lang');
    if (isEN) {
      var zhPath = location.pathname.replace(/^\/en(\/|$)/, '/');
      if (zhPath === '') zhPath = '/';
      langBtn.href = zhPath + location.search + location.hash;
      langBtn.textContent = '中文';
      langBtn.title = '切换到中文';
    } else {
      langBtn.href = '/en' + (location.pathname === '/' ? '/' : location.pathname) + location.search + location.hash;
      langBtn.textContent = 'EN';
      langBtn.title = 'Switch to English';
    }
    actions.appendChild(langBtn);
    /* 明暗切换 */
    var mode = el('button', 'nav__mode');
    mode.type = 'button';
    mode.setAttribute('aria-label', '切换明暗主题');
    mode.title = '切换明暗主题';
    mode.innerHTML =
      '<span class="mode-icon mode-icon--moon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>' +
      '</span>' +
      '<span class="mode-icon mode-icon--sun" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>' +
      '</span>';
    mode.addEventListener('click', function () { SC.toggleMode(); });
    actions.appendChild(mode);

    var cta = el('a', 'btn btn--primary btn--sm btn--nav-cta', '下载');
    cta.href = '/download.html';
    actions.appendChild(cta);

    var burger = el('button', 'nav__burger');
    burger.type = 'button';
    burger.setAttribute('aria-label', '打开导航菜单');
    burger.setAttribute('aria-expanded', 'false');
    burger.appendChild(el('span'));
    actions.appendChild(burger);

    inner.appendChild(actions);
    nav.appendChild(inner);
    return nav;
  }

  function buildDrawer() {
    var drawer = el('div', 'drawer');
    drawer.setAttribute('data-open', 'false');

    (D.NAV || []).forEach(function (item) {
      var a = el('a', null, item.label);
      a.href = item.href;
      drawer.appendChild(a);
      if (item.children) {
        var sub = el('div', 'drawer__sub');
        item.children.forEach(function (c) {
          var ca = el('a', null, c.label);
          ca.href = c.href;
          sub.appendChild(ca);
        });
        drawer.appendChild(sub);
      }
    });

    var cta = el('a', 'btn btn--primary btn--block', '下载最新版本');
    cta.href = '/download.html';
    drawer.appendChild(cta);
    return drawer;
  }

  /* ═══ 4. 页脚 ═════════════════════════════════════════════════════════ */
  function buildFooter() {
    var F = D.FOOTER || { columns: [], legal: '', copyright: '' };
    var f = el('footer', 'footer');
    var wrap = el('div', 'wrap');

    var grid = el('div', 'footer__grid');

    /* 品牌列 */
    var brand = el('div', 'footer__brand');
    brand.innerHTML =
      '<a class="logo" href="/"><img class="logo__img" src="/assets/img/logo-256.png" alt="" width="32" height="32" loading="lazy" /><span>ShortCut</span></a>' +
      '<p>' + (D.SITE ? D.SITE.description : '') + '</p>';
    grid.appendChild(brand);

    (F.columns || []).forEach(function (col) {
      var c = el('div');
      c.appendChild(el('h4', null, col.title));
      var ul = el('ul');
      (col.links || []).forEach(function (l) {
        var li = el('li');
        var a = el('a', null, l.label);
        a.href = l.href;
        if (l.external || isExternal(l.href)) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
        li.appendChild(a);
        ul.appendChild(li);
      });
      c.appendChild(ul);
      grid.appendChild(c);
    });

    wrap.appendChild(grid);

    var bottom = el('div', 'footer__bottom');
    bottom.innerHTML =
      '<span>' + (F.copyright || '') + ' · ' + (F.legal || '') + '</span>' +
      '<span>Windows 10 / 11 · Tauri 2</span>';
    wrap.appendChild(bottom);

    f.appendChild(wrap);
    return f;
  }

  /* ═══ 5. 弹层 ═════════════════════════════════════════════════════════ */
  var activeModal = null;

  function openModal(boxHtml) {
    closeModal();
    var m = el('div', 'modal');
    m.setAttribute('data-open', 'true');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    var box = el('div', 'modal__box', boxHtml);
    var x = el('button', 'modal__close', '&times;');
    x.type = 'button';
    x.setAttribute('aria-label', '关闭');
    box.appendChild(x);
    m.appendChild(box);

    function onKey(e) { if (e.key === 'Escape') closeModal(); }
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    x.addEventListener('click', closeModal);
    document.addEventListener('keydown', onKey);

    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    activeModal = { node: m, onKey: onKey };
    var focusable = box.querySelector('button, a');
    if (focusable) focusable.focus();
    return m;
  }

  function closeModal() {
    if (!activeModal) return;
    document.removeEventListener('keydown', activeModal.onKey);
    if (activeModal.node.parentNode) activeModal.node.parentNode.removeChild(activeModal.node);
    document.body.style.overflow = '';
    activeModal = null;
  }

  /* ═══ 6. 滚动入场 ═════════════════════════════════════════════════════ */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (!('IntersectionObserver' in global)) {
      Array.prototype.forEach.call(items, function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(items, function (n) { io.observe(n); });
  }

  /* ═══ 7. 数据读取（失败静默降级）══════════════════════════════════════ */
  function fetchJson(url) {
    if (!global.fetch) return Promise.resolve(null);
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /** 取安装包体积（HEAD Content-Length），失败返回 0 */
  function fetchSize(url) {
    if (!global.fetch || !url) return Promise.resolve(0);
    return fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return 0;
        var n = parseInt(r.headers.get('Content-Length') || '0', 10);
        return isFinite(n) ? n : 0;
      })
      .catch(function () { return 0; });
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    var mb = bytes / 1048576;
    return (mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)) + ' MB';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** 桌面端版本信息：latest.json 优先，失败用兜底 */
  function loadDesktopVersion() {
    var F = (D.FALLBACK_VERSION && D.FALLBACK_VERSION.desktop) || {};
    var base = (D.SITE && D.SITE.updatesBase) || '/updates/';
    return fetchJson((D.SITE && D.SITE.latestJson) || '/updates/latest.json')
      .then(function (j) {
        var p = j && j.platforms && (j.platforms['windows-x86_64'] || j.platforms['windows-x86-64']);
        var ver = (j && j.version) || F.version;
        var url = (p && p.url) || (base + 'ShortCut_' + ver + '_x64-setup.exe');
        var size = (p && p.size) || 0;
        var info = {
          version: ver,
          pubDate: formatDate(j && j.pub_date),
          notes: (j && j.notes) || '',
          url: url,
          size: size
        };
        /* 清单里没有 size 时用 HEAD 补 */
        if (!info.size) {
          return fetchSize(url).then(function (n) { info.size = n || (F.size || 0); return info; });
        }
        return info;
      })
      .catch(function () {
        return {
          version: F.version, pubDate: '', notes: '', size: F.size || 0,
          url: base + 'ShortCut_' + F.version + '_x64-setup.exe'
        };
      });
  }

  /** 安卓端版本信息 */
  function loadAndroidVersion() {
    var F = (D.FALLBACK_VERSION && D.FALLBACK_VERSION.android) || {};
    var base = (D.SITE && D.SITE.androidBase) || '/updates/android/';
    return fetchJson((D.SITE && D.SITE.androidLatestJson) || '/updates/android/latest.json')
      .then(function (j) {
        if (!j) return null;
        return {
          version: j.versionName || F.version,
          versionCode: j.versionCode || F.versionCode || 0,
          size: j.size || F.size || 0,
          url: j.apkUrl || (base + 'ShortCut-' + (j.versionName || F.version) + '.apk'),
          notes: j.releaseNotes || ''
        };
      })
      .catch(function () {
        return {
          version: F.version, versionCode: F.versionCode || 0, size: F.size || 0,
          url: base + 'ShortCut-' + F.version + '.apk', notes: ''
        };
      });
  }

  /* ═══ 8. 当前页高亮 + 初始化 ══════════════════════════════════════════ */
  function initNav() {
    var navHost = document.getElementById('site-nav');
    var footHost = document.getElementById('site-footer');

    if (navHost) {
      var nav = buildNav();
      navHost.parentNode.replaceChild(nav, navHost);
      var drawer = buildDrawer();
      document.body.appendChild(drawer);

      var burger = nav.querySelector('.nav__burger');
      var setDrawer = function (open) {
        drawer.setAttribute('data-open', open ? 'true' : 'false');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        burger.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
        document.body.style.overflow = open ? 'hidden' : '';
      };
      burger.addEventListener('click', function () {
        setDrawer(drawer.getAttribute('data-open') !== 'true');
      });
      drawer.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') setDrawer(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && drawer.getAttribute('data-open') === 'true') setDrawer(false);
      });
      global.addEventListener('resize', function () {
        if (global.innerWidth > 860 && drawer.getAttribute('data-open') === 'true') setDrawer(false);
      });

      /* 滚动加深顶栏 */
      var onScroll = function () {
        if (global.pageYOffset > 8) nav.classList.add('nav--scrolled');
        else nav.classList.remove('nav--scrolled');
      };
      global.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    if (footHost) {
      var foot = buildFooter();
      footHost.parentNode.replaceChild(foot, footHost);
    }
  }

  /* ═══ 9. 启动 ═════════════════════════════════════════════════════════ */
  /* ═══ 回到顶部 ════════════════════════════════════════════════════════ */
  function initToTop() {
    var btn = el('button', 'to-top');
    btn.type = 'button';
    btn.setAttribute('aria-label', '回到顶部');
    btn.title = '回到顶部';
    btn.innerHTML =
      '<span class="to-top__ring" aria-hidden="true"></span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 19V6"/><path d="M5 12l7-7 7 7"/></svg>';
    document.body.appendChild(btn);

    function update() {
      var doc = document.documentElement;
      var y = global.pageYOffset;
      var max = (doc.scrollHeight - global.innerHeight) || 1;
      /* 下滑超过 1.2 屏才出现 */
      if (y > global.innerHeight * 1.2) btn.classList.add('is-on');
      else btn.classList.remove('is-on');
      btn.style.setProperty('--p', Math.min(100, Math.max(0, (y / max) * 100)).toFixed(1));
    }

    var onScroll = function () { update(); };
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', update);
    update();

    btn.addEventListener('click', function () {
      var reduceMotion = global.matchMedia &&
        global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      global.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  function boot() {
    initNav();
    initToTop();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 导出给页面脚本用 */
  /* ── 明暗模式 ── */
  function currentMode() {
    return document.documentElement.getAttribute('data-mode') === 'light' ? 'light' : 'dark';
  }
  function applyMode(m) {
    document.documentElement.setAttribute('data-mode', m);
    try { global.localStorage.setItem('sc-mode', m); } catch (e) {}
    /* 通知页面脚本（图表等可据此重绘） */
    document.dispatchEvent(new CustomEvent('sc:mode', { detail: { mode: m } }));
  }
  function toggleMode() {
    applyMode(currentMode() === 'light' ? 'dark' : 'light');
  }

  global.SC = {
    icon: icon,
    currentMode: currentMode,
    applyMode: applyMode,
    toggleMode: toggleMode,
    el: el,
    openModal: openModal,
    closeModal: closeModal,
    fetchJson: fetchJson,
    fetchSize: fetchSize,
    formatSize: formatSize,
    formatDate: formatDate,
    loadDesktopVersion: loadDesktopVersion,
    loadAndroidVersion: loadAndroidVersion,
    getData: function () { return D; }
  };
})(window);

/**
 * ShortCut 官网 · 动效层
 * ---------------------------------------------------------------------------
 * 所有动效都是"可感知但不打扰"，并且：
 *   - 尊重 prefers-reduced-motion（直接不启动）
 *   - 用 rAF 节流，滚动/鼠标事件不阻塞主线程
 *   - 任何一项失败都不影响页面可用（每项独立 try）
 *
 * 提供：
 *   1. 顶部滚动进度条
 *   2. 光球视差（随鼠标与滚动轻微位移）
 *   3. 卡片鼠标聚光（写入 --mx/--my）
 *   4. 数字滚动（data-count）
 *   5. 入场错峰（自动为同级 .reveal 分配 --d 延迟）
 *   6. 首屏示意图鼠标微倾斜
 *   7. 导航滚动收缩（已由 site.js 处理，此处只做进度条）
 */
(function (global) {
  'use strict';

  var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = global.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };

  function rafThrottle(fn) {
    var ticking = false;
    return function () {
      if (ticking) return;
      ticking = true;
      raf(function () { ticking = false; fn(); });
    };
  }

  /* ═══ 1. 滚动进度条 ═══════════════════════════════════════════════════ */
  function initProgress() {
    var bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    var update = rafThrottle(function () {
      var doc = document.documentElement;
      var max = (doc.scrollHeight - global.innerHeight) || 1;
      var pct = Math.min(100, Math.max(0, (global.pageYOffset / max) * 100));
      bar.style.width = pct + '%';
    });
    global.addEventListener('scroll', update, { passive: true });
    global.addEventListener('resize', update);
    update();
  }

  /* ═══ 2. 光球视差 ═════════════════════════════════════════════════════ */
  function initOrbs() {
    var orbs = document.querySelectorAll('.orb');
    if (!orbs.length || reduce) return;

    /* 鼠标视差（幅度小，仅"感知得到"） */
    var move = rafThrottle(function (e) {
      var cx = (e.clientX / global.innerWidth - .5);
      var cy = (e.clientY / global.innerHeight - .5);
      Array.prototype.forEach.call(orbs, function (o, i) {
        var depth = (i + 1) * 8;
        o.style.setProperty('--mx', (-cx * depth).toFixed(1) + 'px');
        o.style.setProperty('--my', (-cy * depth).toFixed(1) + 'px');
      });
    });
    if (global.matchMedia('(hover: hover)').matches) {
      global.addEventListener('mousemove', move, { passive: true });
    }
  }

  /* ═══ 3. 卡片鼠标聚光 ═════════════════════════════════════════════════ */
  function initSpotlight() {
    if (reduce || !global.matchMedia('(hover: hover)').matches) return;

    var selector = '.card, .value-item, .capability, .pager a';
    document.addEventListener('mousemove', function (e) {
      var el = e.target.closest ? e.target.closest(selector) : null;
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* ═══ 4. 数字滚动 ═════════════════════════════════════════════════════ */
  function initCounts() {
    var nodes = document.querySelectorAll('[data-count]');
    if (!nodes.length) return;

    function run(node) {
      var target = parseFloat(node.getAttribute('data-count'));
      var decimals = parseInt(node.getAttribute('data-decimals') || '0', 10);
      var suffix = node.getAttribute('data-suffix') || '';
      var prefix = node.getAttribute('data-prefix') || '';

      if (reduce || !isFinite(target)) {
        node.textContent = prefix + target.toFixed(decimals) + suffix;
        return;
      }

      var dur = 1100, start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        /* easeOutExpo */
        var e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        var val = target * e;
        node.textContent = prefix + val.toFixed(decimals) + suffix;
        if (p < 1) raf(step);
        else node.textContent = prefix + target.toFixed(decimals) + suffix;
      }
      raf(step);
    }

    if (!('IntersectionObserver' in global)) {
      Array.prototype.forEach.call(nodes, run);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { run(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
  }

  /* ═══ 5. 入场错峰（自动分配延迟）══════════════════════════════════════ */
  function initStagger() {
    /* 同一父级下连续的 .reveal 自动获得递增延迟，减少手写 style */
    var groups = {};
    Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (n) {
      if (n.style.getPropertyValue('--d')) return;         // 已显式指定
      var key = n.parentNode ? (n.parentNode.className || 'root') : 'root';
      groups[key] = (groups[key] || 0);
      var i = groups[key]++;
      if (i > 0 && i <= 8) n.style.setProperty('--d', (i * 70) + 'ms');
    });
  }

  /* ═══ 6. 首屏示意图微倾斜（跟随鼠标）══════════════════════════════════ */
  function initFigureTilt() {
    var fig = document.querySelector('.hero__figure');
    if (!fig || reduce || !global.matchMedia('(hover: hover)').matches) return;

    var move = rafThrottle(function (e) {
      var r = fig.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - .5;
      var py = (e.clientY - r.top) / r.height - .5;
      var dev = fig.querySelector('.device');
      if (!dev) return;
      dev.style.transform =
        'rotateX(' + (3.2 - py * 3).toFixed(2) + 'deg) ' +
        'rotateY(' + (-4.5 + px * 4).toFixed(2) + 'deg) ' +
        'translateY(' + (py * -6).toFixed(1) + 'px)';
    });
    fig.addEventListener('mousemove', move, { passive: true });
    fig.addEventListener('mouseleave', function () {
      var dev = fig.querySelector('.device');
      if (dev) dev.style.transform = '';
    });
  }

  /* ═══ 7. 锚点平滑滚动（修正固定导航遮挡）═══════════════════════════════ */
  function initAnchors() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (!id || id === '#' || id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 68;
      var y = t.getBoundingClientRect().top + global.pageYOffset - navH - 14;
      global.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* ═══ 启动（每项独立，互不影响）═══════════════════════════════════════ */
  function boot() {
    var tasks = [initProgress, initOrbs, initSpotlight, initCounts, initStagger, initFigureTilt, initAnchors];
    tasks.forEach(function (fn) {
      try { fn(); } catch (err) { /* 单项失败不影响其它 */ }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.SCMotion = { reduceMotion: reduce };
})(window);

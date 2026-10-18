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

  /* ═══ 6. 首屏示意图：鼠标移入后跟随光标 3D 倾斜 ═════════════════════════
   行为：
     - 常态平放（CSS 里只有 2°/-3° 的轻微静态倾斜）
     - 鼠标移入容器 → 进入 is-tilting，倾斜角跟随光标在容器内的位置
     - 鼠标移出 → 平滑复位
   注：这是"用户主动触发"的交互反馈，不属于自动播放动画，
   因此即使系统开启"减少动效"也保留（但幅度减半） */
  function initFigureTilt() {
    var fig = document.querySelector('.hero__figure');
    if (!fig) return;

    var dev = fig.querySelector('.device');
    if (!dev) return;

    var canHover = global.matchMedia('(hover: hover)').matches;
    if (!canHover) return;                       /* 触屏设备不做悬停倾斜 */

    var MAX = reduce ? 4.5 : 9;                  /* 最大倾角（度） */
    var SCALE = 1.03;

    function onMove(e) {
      var r = fig.getBoundingClientRect();
      if (!r.width || !r.height) return;
      /* 光标在容器内的归一化位置：-0.5 ~ 0.5 */
      var px = (e.clientX - r.left) / r.width - .5;
      var py = (e.clientY - r.top) / r.height - .5;

      /* 鼠标在右侧 → 绕 Y 轴正向转，立体感与真实一致 */
      var ry = px * 2 * MAX;
      var rx = -py * 2 * MAX;

      fig.classList.add('is-tilting');
      fig.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      fig.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      fig.style.setProperty('--sc', SCALE);
      /* 反光位移（像素，跟随光标） */
      fig.style.setProperty('--gx', (px * 90).toFixed(1));
      fig.style.setProperty('--gy', (py * 60).toFixed(1));
    }

    function reset() {
      fig.classList.remove('is-tilting');
      fig.style.setProperty('--rx', '2deg');
      fig.style.setProperty('--ry', '-3deg');
      fig.style.setProperty('--sc', '1');
      fig.style.setProperty('--gx', '0');
      fig.style.setProperty('--gy', '0');
    }

    var move = rafThrottle(function (e) { onMove(e); });
    fig.addEventListener('mouseenter', function (e) { onMove(e); });
    fig.addEventListener('mousemove', move, { passive: true });
    fig.addEventListener('mouseleave', reset);
    /* 键盘/触摸滚动离开视口时复位，避免停住不动 */
    global.addEventListener('blur', reset);
  }

  /* ═══ 6b. 所有演示面板：悬停跟随光标的 3D 视差 ═════════════════════════
     适用：功能页里的设备框 / 手机 / 便签墙 / 文件列表等示意图
     做法：以元素自身为枢轴，perspective + rotateX/Y + 轻微位移，
           比只做旋转更像"整块板子跟着鼠标动" */
  function initTiltAll() {
    if (!global.matchMedia || !global.matchMedia('(hover: hover)').matches) return;

    var sel = '.reveal > .device, .reveal > .phone, .reveal > .sticky-mock, .reveal > .file-mock';
    var els = document.querySelectorAll(sel);
    if (!els.length) return;

    var STRENGTH = reduce ? 3 : 6;      /* 最大倾角（度） */
    var SHIFT = reduce ? 3 : 7;         /* 最大位移（px） */

    Array.prototype.forEach.call(els, function (el) {
      var host = el.parentElement || el;
      var frame = null;

      function onMove(e) {
        var r = host.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var px = (e.clientX - r.left) / r.width - .5;
        var py = (e.clientY - r.top) / r.height - .5;

        el.style.transform =
          'perspective(1000px) ' +
          'rotateX(' + (-py * 2 * STRENGTH).toFixed(2) + 'deg) ' +
          'rotateY(' + (px * 2 * STRENGTH).toFixed(2) + 'deg) ' +
          'translate3d(' + (px * SHIFT).toFixed(1) + 'px, ' + (py * SHIFT).toFixed(1) + 'px, 0) ' +
          'scale(1.015)';
        el.style.transition = 'transform .1s linear, box-shadow .4s';
        el.style.willChange = 'transform';
      }

      function reset() {
        el.style.transform = '';
        el.style.transition = 'transform .7s cubic-bezier(.16,1,.3,1)';
        el.style.willChange = '';
      }

      var throttled = rafThrottle(onMove);
      host.addEventListener('mouseenter', function (e) { onMove(e); }, { passive: true });
      host.addEventListener('mousemove', throttled, { passive: true });
      host.addEventListener('mouseleave', reset, { passive: true });
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
    var tasks = [initProgress, initOrbs, initSpotlight, initCounts, initStagger, initFigureTilt, initTiltAll, initAnchors];
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

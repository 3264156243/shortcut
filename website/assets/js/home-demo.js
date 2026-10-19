/**
 * ShortCut 官网首页 · 动效与交互
 * ============================================================
 * 包含：
 *   1. 首屏截图 3D 鼠标倾斜（含3D位移深度）
 *   2. 首屏快捷启动自动演示（Alt+Space → 方向键移动 → Enter 启动）
 *   3. 三大场景滚动入场与持续动画
 *   4. SC球 点击展开/收起 + 悬停交互
 *   5. 下载按钮状态机（检查版本 / 下载中 / 已开始）
 *   6. 导航活动项平滑指示线
 *   7. 更多功能卡片入场错峰
 *
 * 约定：
 *   - 全部用 rAF 节流，不阻塞主线程
 *   - 尊重 prefers-reduced-motion（自动降级为静态展示）
 *   - 每个模块独立 try-catch，单项失败不影响整体
 */
(function (global) {
  'use strict';

  var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = global.matchMedia && global.matchMedia('(hover: hover)').matches;
  var isMobile = global.innerWidth <= 900;
  var raf = global.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };

  function rafThrottle(fn) {
    var ticking = false;
    return function () {
      if (ticking) return;
      ticking = true;
      raf(function () { ticking = false; fn(); });
    };
  }

  /* ═══ 1. 首屏截图 3D 鼠标倾斜 ══════════════════════════════════════════ */
  function initHeroTilt() {
    if (reduce || !canHover || isMobile) return;

    var shot = document.querySelector('.home-shot');
    if (!shot) return;

    var MAX_ROT = 7;        /* 最大旋转角（度） */
    var MAX_SHIFT = 12;     /* 最大位移（px） */
    var SCALE = 1.02;

    function onMove(e) {
      var r = shot.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;

      var ry = px * 2 * MAX_ROT;
      var rx = -py * 2 * MAX_ROT;

      shot.classList.add('is-tilting');
      var img = shot.querySelector('img');
      if (img) {
        img.style.transform =
          'perspective(1400px) ' +
          'rotateX(' + rx.toFixed(2) + 'deg) ' +
          'rotateY(' + ry.toFixed(2) + 'deg) ' +
          'translate3d(' + (px * MAX_SHIFT).toFixed(1) + 'px, ' + (py * MAX_SHIFT).toFixed(1) + 'px, 20px) ' +
          'scale(' + SCALE + ')';
      }
      shot.style.setProperty('--gx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      shot.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');

      /* 同步演示层倾斜 */
      var demo = document.querySelector('.hero-demo__inner');
      if (demo) {
        demo.style.transform =
          'perspective(1400px) ' +
          'rotateX(' + rx.toFixed(2) + 'deg) ' +
          'rotateY(' + ry.toFixed(2) + 'deg) ' +
          'translate3d(' + (px * MAX_SHIFT).toFixed(1) + 'px, ' + (py * MAX_SHIFT).toFixed(1) + 'px, 0) ' +
          'scale(' + SCALE + ')';
        demo.style.transition = 'transform 0.1s linear';
      }
    }

    function reset() {
      shot.classList.remove('is-tilting');
      var img = shot.querySelector('img');
      if (img) {
        img.style.transform = '';
        img.style.transition = 'transform 0.8s cubic-bezier(.16,1,.3,1), box-shadow 0.4s ease';
      }
      var demo = document.querySelector('.hero-demo__inner');
      if (demo) {
        demo.style.transform = '';
        demo.style.transition = 'transform 0.8s cubic-bezier(.16,1,.3,1)';
      }
    }

    var throttled = rafThrottle(onMove);
    shot.addEventListener('mouseenter', function (e) { onMove(e); }, { passive: true });
    shot.addEventListener('mousemove', throttled, { passive: true });
    shot.addEventListener('mouseleave', reset, { passive: true });
    global.addEventListener('blur', reset);
  }

  /* ═══ 2. 首屏自动演示 ══════════════════════════════════════════════════ */
  function initHeroDemo() {
    if (reduce || isMobile) return;

    var shot = document.querySelector('.home-shot');
    if (!shot) return;

    /* --- 注入演示层 DOM --- */
    var demo = document.createElement('div');
    demo.className = 'hero-demo';
    demo.innerHTML =
      '<div class="hero-demo__inner">' +
        '<div class="demo-keys" id="demoKeys">' +
          '<kbd data-k="alt">Alt</kbd><span>+</span><kbd data-k="space">Space</kbd>' +
          '<span style="margin-left:8px;color:rgba(255,255,255,.5);">·</span>' +
          '<span style="margin-left:8px;" id="demoStep">唤出面板</span>' +
        '</div>' +
        '<div class="demo-focus" id="demoFocus"></div>' +
        '<div class="demo-status" id="demoStatus"><i></i><span>正在打开…</span></div>' +
        '<button class="demo-replay" id="demoReplay" type="button" aria-label="重新演示">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>' +
          '重新演示' +
        '</button>' +
      '</div>';
    shot.appendChild(demo);

    var focus = demo.querySelector('#demoFocus');
    var keys = demo.querySelector('#demoKeys');
    var status = demo.querySelector('#demoStatus');
    var replay = demo.querySelector('#demoReplay');
    var stepLabel = demo.querySelector('#demoStep');

    /* --- 焦点移动序列（基于截图的网格估算位置）---
       截图内快捷方式为 4 列 3 行网格，我们选 4 个典型位置 */
    var steps = [
      { /* Alt+Space 唤出 */ type: 'wake', dur: 1200, label: '唤出面板' },
      { /* 第一个位置 */ x: 28, y: 28, label: '移动选中', keys: ['down'], dur: 900 },
      { /* 右移 */ x: 28, y: 52, label: '方向键移动', keys: ['right'], dur: 900 },
      { /* 下移 */ x: 52, y: 52, label: '搜索定位', keys: ['enter'], dur: 700, type: 'launch' },
      { /* 暂停 */ type: 'pause', dur: 1200, label: '完成启动' }
    ];

    var current = 0;
    var timer = null;
    var paused = false;
    var userInteracted = false;

    function lightKey(keyName, on) {
      var k = keys.querySelector('[data-k="' + keyName + '"]');
      if (k) {
        if (on) k.classList.add('is-lit');
        else k.classList.remove('is-lit');
      }
    }

    function showStep(idx) {
      var step = steps[idx];
      if (!step) return;

      stepLabel.textContent = step.label;

      /* 键盘点亮 */
      lightKey('alt', step.type === 'wake');
      lightKey('space', step.type === 'wake');

      if (step.keys) {
        step.keys.forEach(function (k) { lightKey(k, true); });
      }

      /* 焦点移动 */
      if (typeof step.x === 'number' && typeof step.y === 'number') {
        focus.style.left = step.x + '%';
        focus.style.top = step.y + '%';
        focus.classList.add('is-visible');
      }

      /* 启动特效 */
      if (step.type === 'launch') {
        focus.classList.add('is-enter');
        status.classList.add('is-visible');
      } else {
        focus.classList.remove('is-enter');
        status.classList.remove('is-visible');
      }

      /* 清除按键高亮 */
      if (step.keys) {
        setTimeout(function () {
          step.keys.forEach(function (k) { lightKey(k, false); });
        }, step.dur * 0.6);
      }
    }

    function nextStep() {
      if (paused) return;
      showStep(current);
      current = (current + 1) % steps.length;

      /* 最后一步后，短暂显示"重新演示"按钮 */
      if (current === 0) {
        replay.classList.add('is-visible');
        paused = true;
        return;
      }

      var dur = steps[current - 1] ? steps[current - 1].dur : 1000;
      timer = setTimeout(nextStep, dur);
    }

    function start() {
      if (reduce) return;
      current = 0;
      paused = false;
      keys.classList.add('is-visible');
      replay.classList.remove('is-visible');
      clearTimeout(timer);
      timer = setTimeout(nextStep, 600);
    }

    function stop() {
      clearTimeout(timer);
      focus.classList.remove('is-visible');
      keys.classList.remove('is-visible');
      status.classList.remove('is-visible');
    }

    /* --- 交互：鼠标进入暂停，离开恢复；悬停时显示重播按钮 --- */
    shot.addEventListener('mouseenter', function () {
      paused = true;
      clearTimeout(timer);
      replay.classList.add('is-visible');
    }, { passive: true });

    shot.addEventListener('mouseleave', function () {
      if (!userInteracted) {
        paused = false;
        replay.classList.remove('is-visible');
        timer = setTimeout(nextStep, 800);
      }
    }, { passive: true });

    replay.addEventListener('click', function (e) {
      e.stopPropagation();
      userInteracted = true;
      start();
    });

    /* --- 启动 --- */
    /* 等首屏稳定后开始 */
    setTimeout(start, 1500);

    /* 首屏离开视口时暂停，回来时继续 */
    if ('IntersectionObserver' in global) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            if (!userInteracted) start();
          } else {
            stop();
          }
        });
      }, { threshold: 0.3 });
      io.observe(shot);
    }
  }

  /* ═══ 3. 场景滚动触发动画 ══════════════════════════════════════════════ */
  function initSceneAnimations() {
    var scenes = document.querySelectorAll('.scene');
    if (!scenes.length) return;

    /* 每个场景的视觉容器也做3D倾斜 */
    scenes.forEach(function (scene) {
      var visual = scene.querySelector('.scene__visual');
      if (!visual || reduce || !canHover || isMobile) return;

      var MAX = 5;
      var SHIFT = 8;

      function onMove(e) {
        var r = visual.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;

        visual.classList.add('is-tilting');
        var child = visual.firstElementChild;
        if (child) {
          child.style.transform =
            'perspective(1200px) ' +
            'rotateX(' + (-py * 2 * MAX).toFixed(2) + 'deg) ' +
            'rotateY(' + (px * 2 * MAX).toFixed(2) + 'deg) ' +
            'translate3d(' + (px * SHIFT).toFixed(1) + 'px, ' + (py * SHIFT).toFixed(1) + 'px, 0) ' +
            'scale(1.015)';
        }
      }

      function reset() {
        visual.classList.remove('is-tilting');
        var child = visual.firstElementChild;
        if (child) child.style.transform = '';
      }

      var throttled = rafThrottle(onMove);
      visual.addEventListener('mouseenter', function (e) { onMove(e); }, { passive: true });
      visual.addEventListener('mousemove', throttled, { passive: true });
      visual.addEventListener('mouseleave', reset, { passive: true });
    });

    /* IntersectionObserver 触发入场 */
    if (!('IntersectionObserver' in global)) {
      scenes.forEach(function (s) { s.classList.add('is-active'); });
      var more = document.querySelector('.home-more');
      if (more) more.classList.add('is-active');
      var cta = document.querySelector('.home-cta');
      if (cta) cta.classList.add('is-active');
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-active');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.25 });

    scenes.forEach(function (s) { io.observe(s); });

    var more = document.querySelector('.home-more');
    if (more) io.observe(more);

    var cta = document.querySelector('.home-cta');
    if (cta) io.observe(cta);
  }

  /* ═══ 4. SC球 交互 ══════════════════════════════════════════════════════ */
  function initIslandInteraction() {
    var pill = document.querySelector('.island-pill');
    if (!pill) return;

    var expanded = false;
    var autoResume = null;

    function expand() {
      expanded = true;
      pill.classList.add('is-expanded');
      pill.setAttribute('aria-expanded', 'true');
    }

    function collapse() {
      expanded = false;
      pill.classList.remove('is-expanded');
      pill.setAttribute('aria-expanded', 'false');
    }

    if (canHover && !isMobile) {
      pill.addEventListener('mouseenter', expand, { passive: true });
      pill.addEventListener('mouseleave', function () {
        if (!userToggled) collapse();
      }, { passive: true });
    }

    var userToggled = false;
    pill.addEventListener('click', function (e) {
      e.preventDefault();
      userToggled = true;
      if (expanded) collapse();
      else expand();
      clearTimeout(autoResume);
      autoResume = setTimeout(function () { userToggled = false; }, 4000);
    });

    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute('aria-expanded', 'false');
    pill.setAttribute('aria-label', 'SC球 展开/收起');
    pill.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pill.click();
      }
    });
  }

  /* ═══ 5. 下载按钮状态机 ════════════════════════════════════════════════ */
  function initDownloadButton() {
    var btn = document.getElementById('heroDownload');
    if (!btn) return;

    var states = {
      idle: '免费下载 Windows 版',
      checking: '正在检查版本…',
      downloading: '正在下载…',
      done: '下载已开始 ✓'
    };

    function setState(name) {
      btn.textContent = states[name] || states.idle;
      btn.classList.remove('is-loading', 'is-done');
      if (name === 'checking' || name === 'downloading') {
        btn.classList.add('is-loading');
      } else if (name === 'done') {
        btn.classList.add('is-done');
      }
    }

    /* 点击后模拟下载流程（实际跳转到下载页） */
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setState('checking');

      setTimeout(function () {
        setState('downloading');
      }, 600);

      setTimeout(function () {
        setState('done');
        setTimeout(function () {
          global.location.href = btn.getAttribute('href');
        }, 800);
      }, 1800);
    });

    /* CTA 按钮也加一个点击反馈 */
    var ctaBtn = document.getElementById('ctaDownload');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', function (e) {
        e.preventDefault();
        ctaBtn.textContent = '正在前往下载…';
        ctaBtn.classList.add('is-loading');
        setTimeout(function () {
          global.location.href = ctaBtn.getAttribute('href');
        }, 500);
      });
    }
  }

  /* ═══ 6. 导航活动项平滑指示线 ══════════════════════════════════════════ */
  function initNavIndicator() {
    var navLinks = document.querySelector('.nav__links');
    if (!navLinks) return;

    var indicator = document.createElement('span');
    indicator.className = 'nav__indicator';
    indicator.setAttribute('aria-hidden', 'true');
    navLinks.appendChild(indicator);

    function update() {
      var active = navLinks.querySelector('[aria-current="page"]');
      if (!active) { indicator.classList.remove('is-visible'); return; }
      var r = active.getBoundingClientRect();
      var nr = navLinks.getBoundingClientRect();
      indicator.style.left = (r.left - nr.left + active.offsetLeft - active.offsetLeft) + 'px';
      indicator.style.width = r.width + 'px';
      indicator.classList.add('is-visible');
    }

    update();
    global.addEventListener('resize', rafThrottle(update));
  }

  /* ═══ 启动 ══════════════════════════════════════════════════════════════ */
  function boot() {
    var tasks = [
      initHeroTilt,
      initHeroDemo,
      initSceneAnimations,
      initIslandInteraction,
      initDownloadButton,
      initNavIndicator
    ];
    tasks.forEach(function (fn) {
      try { fn(); } catch (err) {
        /* 单项失败不影响其它 */
        if (global.console && console.warn) console.warn('[home-demo]', fn.name, err);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.SCHomeDemo = { reduceMotion: reduce };
})(window);

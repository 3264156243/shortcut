/* Local product demonstrations. No system shortcuts, uploads or app launches. */
(function () {
  'use strict';
  var en = document.documentElement.lang === 'en';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var hover = matchMedia('(hover: hover) and (pointer: fine)');
  var timers = new Set();
  function later(fn, delay) { var id = setTimeout(function () { timers.delete(id); fn(); }, delay); timers.add(id); return id; }
  function clear(id) { clearTimeout(id); timers.delete(id); }
  function say(zh, eng) { return en ? eng : zh; }
  function decorate() { document.querySelectorAll('[data-icon]').forEach(function (n) { n.innerHTML = SC.icon(n.dataset.icon, 20); }); }

  function initLauncher(root) {
    var apps = Array.from(root.querySelectorAll('[data-app]'));
    var search = root.querySelector('[data-demo-search]');
    var status = root.querySelector('[data-demo-status]');
    var grid = root.querySelector('.app-grid');
    var pending = [];
    var touched = false;
    var replay = document.createElement('button');
    replay.type = 'button'; replay.className = 'demo-run';
    replay.textContent = say('播放演示', 'Play demo');
    root.querySelector('.window-bar').insertBefore(replay, root.querySelector('.window-dots'));
    function cancel() { pending.forEach(clear); pending = []; replay.disabled = false; }
    function visible() { return apps.filter(function (a) { return !a.hidden; }); }
    function choose(app) { apps.forEach(function (a) { a.classList.toggle('is-selected', a === app); }); }
    function launch(app) {
      choose(app); app.classList.remove('is-launched');
      requestAnimationFrame(function () { app.classList.add('is-launched'); });
      status.textContent = say('演示：已打开「', 'Demo: opened “') + app.dataset.app + say('」', '”');
    }
    function resetSearch() { search.value = ''; apps.forEach(function (a) { a.hidden = false; }); root.querySelector('.demo-empty').hidden = true; }
    function play() {
      cancel(); resetSearch(); replay.disabled = true;
      status.textContent = say('选择 → 移动 → 回车启动', 'Select → navigate → launch');
      [0, 3, 4].forEach(function (n, i) { pending.push(later(function () { choose(apps[n]); }, i * 650)); });
      pending.push(later(function () { launch(apps[4]); replay.disabled = false; }, 2100));
    }
    root.addEventListener('pointerdown', function (e) { if (e.target !== replay) { touched = true; cancel(); } });
    root.addEventListener('focusin', function () { touched = true; cancel(); });
    replay.addEventListener('click', function () { touched = true; if (reduce.matches) { resetSearch(); launch(apps[0]); } else play(); });
    apps.forEach(function (app) { app.addEventListener('click', function () { cancel(); launch(app); }); });
    search.addEventListener('input', function () {
      cancel(); touched = true;
      var q = search.value.trim().toLowerCase();
      apps.forEach(function (a) { a.hidden = !a.dataset.app.toLowerCase().includes(q); });
      var list = visible(); choose(list[0]);
      root.querySelector('.demo-empty').hidden = list.length !== 0;
      status.textContent = list.length ? say('回车体验选中入口', 'Press Enter to try the selected entry') : say('换一个关键词试试', 'Try a different keyword');
    });
    root.addEventListener('keydown', function (event) {
      var list = visible(); if (!list.length || event.target === replay) return;
      var selected = list.findIndex(function (a) { return a.classList.contains('is-selected'); });
      if (event.target === search && event.key === 'Enter') { event.preventDefault(); launch(list[Math.max(selected, 0)]); return; }
      if (event.target === search && event.key !== 'ArrowDown') return;
      var cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      var delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[event.key];
      if (delta === undefined) return;
      event.preventDefault(); cancel(); touched = true;
      var next = (Math.max(selected, 0) + delta + list.length) % list.length;
      choose(list[next]); list[next].focus({ preventScroll: true });
    });
    if ('IntersectionObserver' in window) {
      var played = false;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) { cancel(); return; }
          if (!played && !touched && !reduce.matches && !document.hidden) { played = true; pending.push(later(play, 700)); }
        });
      }, { threshold: .6 });
      io.observe(root);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) cancel(); });
    reduce.addEventListener('change', function () { if (reduce.matches) cancel(); });
  }

  function initTilt(root) {
    var frame = 0, x = 0, y = 0;
    function reset() { cancelAnimationFrame(frame); frame = 0; root.style.removeProperty('--tilt-x'); root.style.removeProperty('--tilt-y'); }
    root.addEventListener('pointermove', function (e) {
      if (reduce.matches || !hover.matches || innerWidth < 900) return;
      var rect = root.getBoundingClientRect();
      x = (e.clientX - rect.left) / rect.width - .5;
      y = (e.clientY - rect.top) / rect.height - .5;
      if (frame) return;
      frame = requestAnimationFrame(function () { frame = 0; root.style.setProperty('--tilt-x', (-y * 4).toFixed(2) + 'deg'); root.style.setProperty('--tilt-y', (x * 5).toFixed(2) + 'deg'); });
    });
    root.addEventListener('pointerleave', reset); window.addEventListener('blur', reset); reduce.addEventListener('change', reset);
  }

  function boot() {
    decorate();
    document.querySelectorAll('[data-launcher]').forEach(initLauncher);
    document.querySelectorAll('[data-tilt]').forEach(initTilt);
    document.querySelectorAll('[data-note-complete]').forEach(function (button) {
      button.addEventListener('click', function () {
        var done = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(done)); button.closest('.note').classList.toggle('is-complete', done);
        button.querySelector('span:last-child').textContent = done ? say('已完成 · 撤销', 'Done · undo') : say('标记完成', 'Mark complete');
      });
    });
    document.querySelectorAll('[data-ball-scene]').forEach(function (scene) {
      var toggle = scene.querySelector('[data-ball-toggle]');
      var panel = scene.querySelector('.ball-expanded');
      var play = scene.querySelector('[data-ball-play]');
      toggle.addEventListener('click', function () {
        var open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? say('收起 SC球演示', 'Collapse SC Ball demo') : say('展开 SC球演示', 'Expand SC Ball demo'));
        panel.hidden = !open;
        if (!open) { scene.classList.remove('is-playing'); play.setAttribute('aria-pressed', 'false'); play.textContent = '▶'; }
      });
      play.addEventListener('click', function () {
        var playing = play.getAttribute('aria-pressed') !== 'true';
        play.setAttribute('aria-pressed', String(playing)); play.textContent = playing ? 'Ⅱ' : '▶';
        play.setAttribute('aria-label', playing ? say('暂停演示', 'Pause demo') : say('播放演示', 'Play demo'));
        scene.classList.toggle('is-playing', playing);
      });
    });
    document.querySelectorAll('[data-transfer-demo]').forEach(function (scene) {
      var btn = scene.querySelector('[data-send-demo]'), status = scene.querySelector('[data-transfer-status]');
      btn.addEventListener('click', function () {
        scene.classList.toggle('is-sent');
        var sent = scene.classList.contains('is-sent');
        status.textContent = sent ? say('演示完成：手机已收到示例文件', 'Demo complete: sample file received') : say('文件不上传，仅演示传递过程', 'Local demo. No file is uploaded.');
        btn.textContent = sent ? say('重置演示 ↺', 'Reset demo ↺') : say('演示传递 →', 'Try the handoff →');
      });
    });
    var rows = document.getElementById('hotkeyRows');
    if (rows) SC.getData().HOTKEYS.forEach(function (hotkey) {
      var tr = document.createElement('tr'), td = document.createElement('td'), desc = document.createElement('td');
      hotkey.keys.forEach(function (key) { var k = document.createElement('span'); k.className = 'kbd'; k.textContent = key; td.append(k, ' '); });
      desc.textContent = hotkey.desc; tr.append(td, desc); rows.append(tr);
    });
    if (document.querySelector('[data-current-version]')) SC.loadDesktopVersion().then(function (v) { document.querySelectorAll('[data-current-version]').forEach(function (n) { n.textContent = 'v' + v.version; }); });
  }
  window.addEventListener('pagehide', function () { timers.forEach(clearTimeout); timers.clear(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

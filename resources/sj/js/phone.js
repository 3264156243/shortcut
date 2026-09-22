/* 手机控制端：输入主页 + 底部上滑抽屉（触控板 / 键盘） */
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'mkb_token';

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let composing = false;
  let sent = '';
  let queue = Promise.resolve();
  let mods = { ctrl: false, shift: false, alt: false, win: false };
  let activeSheet = null; // 'pad' | 'vk' | 'clip' | null
  let authMode = 'pair';
  let requirePair = true;

  const TYPE_SHORTCUTS = [
    { label: '复制', keys: ['ctrl', 'c'] },
    { label: '粘贴', keys: ['ctrl', 'v'] },
    { label: '全选', keys: ['ctrl', 'a'] },
    { label: '粘贴板', keys: ['win', 'v'] },
    { label: '撤回', keys: ['ctrl', 'z'] },
    { label: '任务视图', keys: ['win', 'tab'] },
  ];

  const PAD_MORE_SHORTCUTS = [
    { label: '剪切', keys: ['ctrl', 'x'] },
    { label: '重做', keys: ['ctrl', 'y'] },
    { label: '保存', keys: ['ctrl', 's'] },
    { label: '查找', keys: ['ctrl', 'f'] },
    { label: '关闭', keys: ['alt', 'f4'] },
    { label: '切换', keys: ['alt', 'tab'] },
    { label: '桌面', keys: ['win', 'd'] },
    { label: '任务管理', keys: ['ctrl', 'shift', 'esc'] },
    { label: '运行', keys: ['win', 'r'] },
    { label: '截图', keys: ['printscreen'] },
    { label: '锁屏', keys: ['win', 'l'] },
    { label: '刷新', keys: ['f5'] },
  ];

  function setBound(ok) {
    $('pairCard').classList.toggle('hidden', ok);
    $('app').classList.toggle('hidden', !ok);
    $('dot').classList.toggle('on', ok);
    $('statusText').textContent = ok
      ? authMode === 'pair'
        ? '已绑定'
        : authMode === 'static'
          ? 'static 已就绪'
          : '直连模式'
      : authMode === 'pair'
        ? '未绑定'
        : '未就绪';
  }

  function enqueue(fn) {
    queue = queue.then(fn).catch((e) => console.warn(e));
    return queue;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function authFail(r) {
    if (r.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      token = '';
      setBound(false);
      $('pairErr').textContent = '绑定已失效，请重新绑定';
      return true;
    }
    return false;
  }

  function sendText(text) {
    if (!text) return;
    if (requirePair && !token) return;
    enqueue(async () => {
      const r = await api('/api/type', { text });
      if (requirePair) authFail(r);
    });
  }

  function sendKey(name) {
    if (requirePair && !token) return;
    enqueue(() => api('/api/key', { key: name }).then((r) => { if (requirePair) authFail(r); }));
  }

  function sendCombo(keys) {
    if (requirePair && !token) return;
    enqueue(() => api('/api/combo', { keys }).then((r) => { if (requirePair) authFail(r); }));
  }

  function sendMouse(dx, dy) {
    if (!dx && !dy) return;
    if (requirePair && !token) return;
    enqueue(() => api('/api/mouse', { dx, dy }).then((r) => { if (requirePair) authFail(r); }));
  }

  function sendClick(btn) {
    if (requirePair && !token) return;
    enqueue(() => api('/api/click', { button: btn }).then((r) => { if (requirePair) authFail(r); }));
  }

  function sendWheel(d) {
    if (requirePair && !token) return;
    enqueue(() => api('/api/wheel', { delta: d }).then((r) => { if (requirePair) authFail(r); }));
  }

  /* ---------- 保持系统键盘不因点按钮而收起 ---------- */
  const kb = $('kb');

  /**
   * 点按钮时不影响当前输入状态：mousedown preventDefault 防抢焦点；
   * 仅当焦点本来就在输入区（键盘弹出中）时才把焦点还给输入区保持键盘，
   * 非输入状态（键盘收起）不主动拉起键盘。
   */
  function keepKeyboardOpen(el) {
    if (!el) return;
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      if (activeSheet) return;
      if (document.activeElement !== kb) return;
      try {
        kb.focus({ preventScroll: true });
      } catch (_) {
        kb.focus();
      }
    });
  }

  function updateMeter() {
    const buf = kb.value;
    $('bufLen').textContent = String(buf.length);
    $('sentLen').textContent = String(sent.length);
    const same = buf === sent;
    $('syncState').textContent = same
      ? '已同步'
      : buf.startsWith(sent)
        ? '待同步'
        : sent.startsWith(buf)
          ? '将退格差量'
          : '差量同步';
    const max = Math.max(buf.length, sent.length, 1);
    const ratio = same ? 100 : Math.round((Math.min(buf.length, sent.length) / max) * 100);
    $('syncBar').style.width = ratio + '%';
  }

  function syncFromBuffer() {
    const buf = kb.value;
    if (buf === sent) {
      updateMeter();
      return;
    }

    let i = 0;
    const min = Math.min(buf.length, sent.length);
    while (i < min && buf.charCodeAt(i) === sent.charCodeAt(i)) i++;

    if (i === buf.length && buf.length < sent.length && sent.startsWith(buf)) {
      const n = sent.length - buf.length;
      for (let k = 0; k < n; k++) sendKey('backspace');
      sent = buf;
      updateMeter();
      return;
    }

    if (i === sent.length && buf.length > sent.length) {
      sendText(buf.slice(sent.length));
      sent = buf;
      updateMeter();
      return;
    }

    const bs = sent.length - i;
    const insert = buf.slice(i);
    for (let k = 0; k < bs; k++) sendKey('backspace');
    if (insert) sendText(insert);
    sent = buf;
    updateMeter();
  }

  function renderChips(el, items, safeKb) {
    el.innerHTML = '';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = it.label;
      b.addEventListener('click', () => sendCombo(it.keys));
      if (safeKb) keepKeyboardOpen(b);
      el.appendChild(b);
    });
  }

  /* ---------- 输入控件 ---------- */
  kb.addEventListener('compositionstart', () => { composing = true; });
  kb.addEventListener('compositionend', () => { composing = false; syncFromBuffer(); });
  kb.addEventListener('input', (e) => {
    if (composing || e.isComposing) return;
    syncFromBuffer();
  });

  $('btnBs').addEventListener('click', () => {
    sendKey('backspace');
    if (sent.length) {
      if (kb.value === sent) {
        kb.value = sent.slice(0, -1);
        sent = sent.slice(0, -1);
      } else {
        sent = sent.slice(0, -1);
      }
    }
    updateMeter();
  });

  $('btnEnter').addEventListener('click', () => sendKey('enter'));
  $('btnTab').addEventListener('click', () => sendKey('tab'));

  /* 清空：只清缓冲，不影响电脑 */
  $('btnClear').addEventListener('click', () => {
    kb.value = '';
    sent = '';
    updateMeter();
  });

  ['btnBs', 'btnEnter', 'btnTab', 'btnClear'].forEach((id) => keepKeyboardOpen($(id)));

  document.querySelectorAll('#arrows [data-key]').forEach((b) => {
    b.addEventListener('click', () => sendKey(b.getAttribute('data-key')));
    keepKeyboardOpen(b);
  });

  renderChips($('typeChips'), TYPE_SHORTCUTS, true);
  renderChips($('padMoreChips'), PAD_MORE_SHORTCUTS, false);

  /* ---------- 全屏抽屉 ---------- */
  const backdrop = $('sheetBackdrop');
  const sheets = {
    pad: $('padSheet'),
    vk: $('vkSheet'),
    clip: $('clipSheet'),
  };

  let clipData = { current: null, history: [] };
  let lastClipPasteAt = 0;

  function toast(msg) {
    let el = document.querySelector('.clip-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'clip-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function previewText(t) {
    const s = String(t == null ? '' : t);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  }

  async function copyToPhoneClipboard(text) {
    const t = String(text == null ? '' : text);
    if (!t) {
      toast('内容为空');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        toast('已复制到手机剪贴板');
        return;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, t.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      toast(ok ? '已复制到手机剪贴板' : '复制失败');
    } catch (_) {
      toast('复制失败');
    }
  }

  async function pasteClipToPc(text) {
    const t = String(text == null ? '' : text);
    if (!t) {
      toast('内容为空');
      return;
    }
    const now = Date.now();
    if (now - lastClipPasteAt < 80) return;
    lastClipPasteAt = now;
    if (requirePair && !token) return;
    const r = await api('/api/clipboard/paste', { text: t });
    if (requirePair && authFail(r)) return;
    toast(r.ok ? '已输出到电脑光标处' : '输出失败');
  }

  function renderClipList() {
    const list = $('clipList');
    const cur = clipData.current;
    const curEl = $('clipCurrentText');
    if (cur == null || cur === '') {
      curEl.textContent = '（空或未读取）';
      curEl.classList.add('empty');
    } else {
      curEl.textContent = previewText(cur);
      curEl.classList.remove('empty');
    }
    $('btnClipPasteCurrent').onclick = () => pasteClipToPc(cur);
    $('btnClipCopyCurrent').onclick = () => copyToPhoneClipboard(cur);

    const items = clipData.history || [];
    if (!items.length) {
      list.innerHTML = '<div class="clip-empty">暂无记录，点「刷新」读取电脑剪贴板</div>';
      return;
    }
    list.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'clip-item';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'clip-item-main';
      main.textContent = item.preview || previewText(item.text);
      main.title = '输出到电脑光标处';
      main.addEventListener('click', () => pasteClipToPc(item.text));

      const meta = document.createElement('div');
      meta.className = 'clip-item-meta';

      const info = document.createElement('span');
      const len = item.length != null ? item.length : (item.text || '').length;
      const time = item.at ? new Date(item.at) : null;
      const hh = time
        ? String(time.getHours()).padStart(2, '0') + ':' + String(time.getMinutes()).padStart(2, '0')
        : '';
      info.textContent = len + ' 字' + (hh ? ' · ' + hh : '');

      const actions = document.createElement('div');
      actions.className = 'clip-item-actions';

      const btnPaste = document.createElement('button');
      btnPaste.type = 'button';
      btnPaste.className = 'btn sm';
      btnPaste.textContent = '输出';
      btnPaste.addEventListener('click', (e) => {
        e.stopPropagation();
        pasteClipToPc(item.text);
      });

      const btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'btn ghost sm';
      btnCopy.textContent = '复制';
      btnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToPhoneClipboard(item.text);
      });

      actions.appendChild(btnPaste);
      actions.appendChild(btnCopy);
      meta.appendChild(info);
      meta.appendChild(actions);
      row.appendChild(main);
      row.appendChild(meta);
      list.appendChild(row);
    });
  }

  async function refreshClipUi() {
    if (requirePair && !token) {
      $('clipList').innerHTML = '<div class="clip-empty">请先绑定</div>';
      return;
    }
    const r = await api('/api/clipboard/refresh', {});
    if (requirePair && authFail(r)) return;
    if (!r.ok) {
      $('clipList').innerHTML = '<div class="clip-empty">读取电脑粘贴板失败</div>';
      return;
    }
    clipData = {
      current: r.data.current,
      history: r.data.history || [],
    };
    renderClipList();
  }

  $('btnClipRefresh').addEventListener('click', () => refreshClipUi());
  $('btnClipClear').addEventListener('click', async () => {
    if (requirePair && !token) return;
    await api('/api/clipboard/clear', {}).catch(() => {});
    clipData = { current: clipData.current, history: [] };
    renderClipList();
    toast('已清空历史（不影响电脑剪贴板）');
  });

  function openSheet(name) {
    const el = sheets[name];
    if (!el) return;
    Object.keys(sheets).forEach((key) => {
      const s = sheets[key];
      const on = key === name;
      s.classList.toggle('open', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    backdrop.classList.remove('hidden');
    void backdrop.offsetWidth;
    backdrop.classList.add('show');
    activeSheet = name;
    document.body.style.overflow = 'hidden';
    if (name === 'vk') {
      requestAnimationFrame(() => layoutVk());
      setTimeout(layoutVk, 60);
      setTimeout(layoutVk, 200);
    }
    if (name === 'clip') {
      refreshClipUi();
    }
  }

  function closeSheet() {
    Object.keys(sheets).forEach((key) => {
      sheets[key].classList.remove('open');
      sheets[key].setAttribute('aria-hidden', 'true');
    });
    backdrop.classList.remove('show');
    activeSheet = null;
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!activeSheet) backdrop.classList.add('hidden');
    }, 220);
  }

  $('btnOpenPad').addEventListener('click', () => openSheet('pad'));
  $('btnOpenVk').addEventListener('click', () => openSheet('vk'));
  $('btnOpenClip').addEventListener('click', () => openSheet('clip'));

  backdrop.addEventListener('click', closeSheet);
  document.querySelectorAll('[data-close-sheet]').forEach((el) => {
    el.addEventListener('click', closeSheet);
  });

  document.querySelectorAll('.sheet .btn, .sheet .chip, .sheet .vk, .sheet .inner-toggle').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.preventDefault());
  });

  /* ---------- 触控板 ---------- */
  const pad = $('pad');
  let lastTouch = null;
  let longTimer = null;
  let gestureMode = null;
  let lastY = 0;
  let fingerCountAtStart = 0;

  function touchPoint(t) {
    return { x: t.clientX, y: t.clientY };
  }

  pad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    $('padHint').style.display = 'none';
    const n = e.touches.length;
    fingerCountAtStart = n;
    if (n === 1) {
      const p = touchPoint(e.touches[0]);
      lastTouch = { x: p.x, y: p.y, t: Date.now(), moved: false };
      gestureMode = 'move';
      clearTimeout(longTimer);
      longTimer = setTimeout(() => {
        if (lastTouch && !lastTouch.moved && fingerCountAtStart === 1) {
          sendClick('right');
          lastTouch = null;
        }
      }, 550);
    } else if (n >= 2) {
      clearTimeout(longTimer);
      const p = touchPoint(e.touches[0]);
      lastTouch = { x: p.x, y: p.y, t: Date.now(), moved: false };
      gestureMode = 'scroll';
      lastY = p.y;
    }
  }, { passive: false });

  pad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const sens = parseFloat($('sens').value) || 1;
    if (gestureMode === 'move' && e.touches.length === 1 && lastTouch) {
      const p = touchPoint(e.touches[0]);
      const dx = p.x - lastTouch.x;
      const dy = p.y - lastTouch.y;
      lastTouch.x = p.x;
      lastTouch.y = p.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) lastTouch.moved = true;
      sendMouse(Math.round(dx * sens), Math.round(dy * sens));
    } else if (gestureMode === 'scroll' && e.touches.length >= 2) {
      const p = touchPoint(e.touches[0]);
      const dy = p.y - lastY;
      lastY = p.y;
      if (Math.abs(dy) >= 12) {
        sendWheel(-Math.round(dy * 4));
        lastTouch.moved = true;
      }
    }
  }, { passive: false });

  pad.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearTimeout(longTimer);
    if (lastTouch && !lastTouch.moved && Date.now() - lastTouch.t < 320) {
      if (fingerCountAtStart >= 2) sendClick('right');
      else if (gestureMode === 'move') sendClick('left');
    }
    if (e.touches.length === 0) {
      lastTouch = null;
      gestureMode = null;
      fingerCountAtStart = 0;
      $('padHint').style.display = '';
    }
  }, { passive: false });

  pad.addEventListener('touchcancel', () => {
    clearTimeout(longTimer);
    lastTouch = null;
    gestureMode = null;
    fingerCountAtStart = 0;
    $('padHint').style.display = '';
  });

  document.querySelectorAll('[data-click]').forEach((b) => {
    b.addEventListener('click', () => sendClick(b.getAttribute('data-click')));
  });
  $('wheelUp').addEventListener('click', () => sendWheel(240));
  $('wheelDn').addEventListener('click', () => sendWheel(-240));
  $('btnDbl').addEventListener('click', () => {
    sendClick('left');
    setTimeout(() => sendClick('left'), 80);
  });
  $('sens').addEventListener('input', () => {
    $('sensVal').textContent = (parseFloat($('sens').value) || 1).toFixed(1);
  });

  $('btnMoreToggle').addEventListener('click', () => {
    const body = $('moreBody');
    const chev = $('moreChev');
    const btn = $('btnMoreToggle');
    const willOpen = body.classList.contains('hidden');
    body.classList.toggle('hidden', !willOpen);
    btn.classList.toggle('open', willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
    chev.textContent = willOpen ? '收起' : '展开';
  });

  /* ---------- 横屏虚拟键盘 ---------- */
  const VK_ROWS = [
    [
      { l: 'Esc', k: 'esc', c: 'w1' },
      { l: 'F1', k: 'f1' }, { l: 'F2', k: 'f2' }, { l: 'F3', k: 'f3' }, { l: 'F4', k: 'f4' },
      { l: 'F5', k: 'f5' }, { l: 'F6', k: 'f6' }, { l: 'F7', k: 'f7' }, { l: 'F8', k: 'f8' },
      { l: 'F9', k: 'f9' }, { l: 'F10', k: 'f10' }, { l: 'F11', k: 'f11' }, { l: 'F12', k: 'f12' },
      { l: 'PrtSc', k: 'printscreen', c: 'w1' },
    ],
    [
      { l: '`', k: '`' }, { l: '1', k: '1' }, { l: '2', k: '2' }, { l: '3', k: '3' },
      { l: '4', k: '4' }, { l: '5', k: '5' }, { l: '6', k: '6' }, { l: '7', k: '7' },
      { l: '8', k: '8' }, { l: '9', k: '9' }, { l: '0', k: '0' },
      { l: '-', k: '-' }, { l: '=', k: '=' }, { l: '⌫', k: 'backspace', c: 'w2' },
    ],
    [
      { l: 'Tab', k: 'tab', c: 'w2' },
      { l: 'Q', k: 'q' }, { l: 'W', k: 'w' }, { l: 'E', k: 'e' }, { l: 'R', k: 'r' },
      { l: 'T', k: 't' }, { l: 'Y', k: 'y' }, { l: 'U', k: 'u' }, { l: 'I', k: 'i' },
      { l: 'O', k: 'o' }, { l: 'P', k: 'p' },
      { l: '[', k: '[' }, { l: ']', k: ']' }, { l: '\\', k: '\\' },
    ],
    [
      { l: 'Caps', k: 'capslock', c: 'w2' },
      { l: 'A', k: 'a' }, { l: 'S', k: 's' }, { l: 'D', k: 'd' }, { l: 'F', k: 'f' },
      { l: 'G', k: 'g' }, { l: 'H', k: 'h' }, { l: 'J', k: 'j' }, { l: 'K', k: 'k' },
      { l: 'L', k: 'l' }, { l: ';', k: ';' }, { l: "'", k: "'" },
      { l: 'Enter', k: 'enter', c: 'w2' },
    ],
    [
      { l: 'Shift', k: 'shift', c: 'w3' },
      { l: 'Z', k: 'z' }, { l: 'X', k: 'x' }, { l: 'C', k: 'c' }, { l: 'V', k: 'v' },
      { l: 'B', k: 'b' }, { l: 'N', k: 'n' }, { l: 'M', k: 'm' },
      { l: ',', k: ',' }, { l: '.', k: '.' }, { l: '/', k: '/' },
      { l: 'Shift', k: 'shift', c: 'w3' },
    ],
    [
      { l: 'Ctrl', k: 'ctrl', c: 'w1' },
      { l: 'Win', k: 'win', c: 'w1' },
      { l: 'Alt', k: 'alt', c: 'w1' },
      { l: 'Space', k: 'space', c: 'w6' },
      { l: 'Alt', k: 'alt', c: 'w1' },
      { l: 'Ctrl', k: 'ctrl', c: 'w1' },
    ],
    [
      { l: 'Ins', k: 'insert' }, { l: 'Home', k: 'home' }, { l: 'PgUp', k: 'pageup' },
      { l: 'Del', k: 'del' }, { l: 'End', k: 'end' }, { l: 'PgDn', k: 'pagedown' },
      { l: '←', k: 'left' }, { l: '↑', k: 'up' }, { l: '↓', k: 'down' }, { l: '→', k: 'right' },
    ],
  ];

  function clearMods() {
    mods = { ctrl: false, shift: false, alt: false, win: false };
    document.querySelectorAll('[data-mod]').forEach((b) => b.classList.remove('on'));
  }

  function pressVk(key) {
    const k = String(key).toLowerCase();
    if (['ctrl', 'shift', 'alt', 'win'].includes(k)) return;

    const active = [];
    if (mods.ctrl) active.push('ctrl');
    if (mods.shift) active.push('shift');
    if (mods.alt) active.push('alt');
    if (mods.win) active.push('win');

    if (active.length) sendCombo(active.concat([key]));
    else sendKey(key);
    clearMods();
  }

  function renderVk() {
    const body = $('vkBody');
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'vk-rows';
    VK_ROWS.forEach((row) => {
      const r = document.createElement('div');
      r.className = 'vk-row';
      row.forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vk' + (k.c ? ' ' + k.c : '');
        b.textContent = k.l;
        b.addEventListener('click', () => pressVk(k.k));
        r.appendChild(b);
      });
      wrap.appendChild(r);
    });
    body.appendChild(wrap);
    layoutVk();
  }

  const VK_DESIGN_WIDTH = 720;

  /**
   * 键盘永远按「横屏形态」绘制，与手机系统方向无关：
   * - 舞台是横长的（宽>高）→ 直接铺满
   * - 舞台是竖长的（高>宽）→ 把横屏键盘旋转 -90°，用长边贴屏幕长边铺满
   */
  function layoutVk() {
    const stage = $('vkStage');
    const inner = $('vkStageInner');
    if (!stage || !inner) return;

    const designW = VK_DESIGN_WIDTH;
    inner.style.position = 'absolute';
    inner.style.left = '50%';
    inner.style.top = '50%';
    inner.style.width = designW + 'px';
    inner.style.transform = 'none';
    const designH = inner.scrollHeight || 400;

    const availW = stage.clientWidth || 320;
    const availH = stage.clientHeight || Math.floor(window.innerHeight * 0.75);
    if (availW < 2 || availH < 2) return;

    const stageIsTall = availH > availW;
    let scale;

    if (stageIsTall) {
      // 竖屏舞台：横屏键盘旋转后，designW 对齐舞台高，designH 对齐舞台宽
      scale = Math.min(availH / designW, availW / designH);
      scale = Math.max(0.2, Math.min(1.8, scale));
      stage.classList.add('is-rotated');
      inner.style.transformOrigin = 'center center';
      // 90deg：横屏键盘从右向左展开（与原先 -90deg 相反）
      inner.style.transform =
        'translate(-50%, -50%) rotate(90deg) scale(' + scale + ')';
    } else {
      // 横屏舞台：正常横屏键盘铺满
      scale = Math.min(availW / designW, availH / designH);
      scale = Math.max(0.2, Math.min(1.8, scale));
      stage.classList.remove('is-rotated');
      inner.style.transformOrigin = 'center center';
      inner.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    }
  }

  renderVk();

  document.querySelectorAll('[data-mod]').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.getAttribute('data-mod');
      mods[m] = !mods[m];
      b.classList.toggle('on', mods[m]);
    });
  });
  $('btnVkClear').addEventListener('click', () => clearMods());

  window.addEventListener('resize', () => {
    if (activeSheet === 'vk') layoutVk();
  });
  window.addEventListener('orientationchange', () => {
    // 系统方向变化不影响「键盘始终横屏形态」；只重算铺满缩放
    if (activeSheet === 'vk') setTimeout(layoutVk, 100);
  });

  /* ---------- 绑定 / 启动配置 ---------- */
  async function boot() {
    // URL 可带 ?token= 供父项目 static 模式注入
    try {
      const qs = new URLSearchParams(location.search);
      const qToken = qs.get('token');
      if (qToken) {
        token = qToken;
        localStorage.setItem(TOKEN_KEY, token);
      }
    } catch (_) {}

    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      authMode = cfg.authMode || 'pair';
      requirePair = authMode === 'pair';
    } catch (_) {
      authMode = 'pair';
      requirePair = true;
    }

    if (!requirePair) {
      // none / static：跳过绑定卡；static 可用 URL token
      if (authMode === 'none') {
        token = token || 'none';
        localStorage.setItem(TOKEN_KEY, token);
      }
      if (authMode === 'static' && !token) {
        $('pairCard').querySelector('p').textContent =
          '模块为 static 鉴权，请通过父项目链接进入（URL 携带 token），或联系集成方。';
        $('pairCard').querySelector('label').textContent = 'Token';
        $('pairCode').setAttribute('inputmode', 'text');
        $('pairCode').setAttribute('maxlength', '128');
        $('pairCode').placeholder = '粘贴父项目下发的 token';
        $('btnPair').textContent = '保存 Token';
      }
      if (authMode === 'none' || (authMode === 'static' && token)) {
        setBound(true);
        updateMeter();
        return;
      }
    }

    setBound(!!token);
    updateMeter();
  }

  async function doPair() {
    $('pairErr').textContent = '';

    if (authMode === 'static' && !requirePair) {
      const t = $('pairCode').value.trim();
      if (!t) {
        $('pairErr').textContent = '请输入 token';
        return;
      }
      token = t;
      localStorage.setItem(TOKEN_KEY, token);
      setBound(true);
      updateMeter();
      return;
    }

    if (!requirePair) {
      setBound(true);
      updateMeter();
      return;
    }

    const code = $('pairCode').value.trim();
    if (!/^\d{6}$/.test(code)) {
      $('pairErr').textContent = '请输入 6 位数字绑定码';
      return;
    }
    $('btnPair').disabled = true;
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        $('pairErr').textContent = data.error || '绑定失败';
        return;
      }
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      setBound(true);
      updateMeter();
    } catch (e) {
      $('pairErr').textContent = '网络错误，请检查地址';
    } finally {
      $('btnPair').disabled = false;
    }
  }

  $('btnPair').addEventListener('click', doPair);
  $('pairCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doPair();
  });

  setInterval(async () => {
    if (requirePair && !token) return;
    if (!requirePair && authMode !== 'none' && !token) return;
    try {
      const r = await api('/api/ping', {});
      if (requirePair && authFail(r)) return;
      if (r.ok) {
        $('dot').classList.add('on');
        if (requirePair) $('statusText').textContent = '已绑定';
        else if (authMode === 'static') $('statusText').textContent = 'static 已就绪';
        else $('statusText').textContent = '直连模式';
      }
    } catch {
      $('statusText').textContent = '连接不稳';
      $('dot').classList.remove('on');
    }
  }, 5000);

  boot();
})();

/**
 * ShortCut 移动联动 · 共享 SDK（协议版本 1）
 *
 * 为什么要它：现在 /mobile/、/taskwall/、/transfer/、/control/、/bind/ 五个页面
 * 各自声明同一个 localStorage 键、各自实现请求与错误提示 —— 协议一改就要同时改五页，
 * 也无法给后续 Capacitor 安卓壳做兼容。所有移动页面统一引用这一份。
 *
 * 用法：
 *   <script src="/sync/web/sdk.js"></script>
 *   const sdk = window.ShortCutMobile;
 *   if (!sdk.isBound()) location.href = '/bind/';
 *   const r = await sdk.request('transfer.messages');
 *
 * 约定：
 *   - 身份统一存 localStorage['shortcut-mobile-binding-v1'] = { bindId, mobileToken, deviceName, code }
 *   - 所有请求自动带 bindId + mobileToken（公开接口用 requestPublic）
 *   - 出错返回 { success:false, message }，不抛异常（调用方只需看 success）
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'shortcut-mobile-binding-v1';
  var API_URL = '/sync/api.php';
  var PROTOCOL_VERSION = 1;
  var DEFAULT_TIMEOUT = 15000;

  function binding() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function fetchJson(url, options, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var opts = options || {};
    if (controller) {
      opts.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, timeoutMs || DEFAULT_TIMEOUT);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (timer) clearTimeout(timer);
        if (!res.ok || !data) return { success: false, message: '服务暂时不可用（HTTP ' + res.status + '）' };
        return data;
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      var aborted = err && err.name === 'AbortError';
      return { success: false, message: aborted ? '请求超时，请检查网络' : '网络错误：' + ((err && err.message) || '未知') };
    });
  }

  var sdk = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    STORAGE_KEY: STORAGE_KEY,

    // ── 身份 ──
    binding: binding,
    isBound: function () {
      var b = binding();
      return !!(b && b.bindId && b.mobileToken);
    },
    saveBinding: function (obj) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj || {}));
    },
    patchBinding: function (patch) {
      var b = binding() || {};
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) b[k] = patch[k];
      sdk.saveBinding(b);
      return b;
    },
    clearBinding: function () { localStorage.removeItem(STORAGE_KEY); },
    /** 未绑定则跳转到统一绑定页（返回 true 表示已跳转） */
    requireBinding: function (redirect) {
      if (sdk.isBound()) return false;
      location.href = redirect || '/bind/';
      return true;
    },

    // ── 请求 ──
    /** 公开接口（不需要绑定身份，例如 module.list） */
    requestPublic: function (action, payload) {
      var body = { action: action, protocolVersion: PROTOCOL_VERSION };
      if (payload) for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
      return fetchJson(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    /** 带身份请求：自动补 bindId + mobileToken */
    request: function (action, payload) {
      var b = binding();
      if (!b || !b.bindId || !b.mobileToken) {
        return Promise.resolve({ success: false, message: '尚未绑定桌面端', needBind: true });
      }
      var body = {
        action: action,
        protocolVersion: PROTOCOL_VERSION,
        bindId: b.bindId,
        mobileToken: b.mobileToken,
        side: 'mobile',
      };
      if (payload) for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
      return fetchJson(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        // 移动端令牌失效（换手机/重新绑定）→ 清掉本地身份并提示重新绑定
        if (r && r.success === false && typeof r.message === 'string' && r.message.indexOf('移动端绑定已失效') >= 0) {
          sdk.clearBinding();
          r.needBind = true;
        }
        return r;
      });
    },

    // ── 模块清单（服务端权威：modules.json）──
    modules: function () {
      if (sdk.isBound()) return sdk.request('module.list');
      return sdk.requestPublic('module.list');
    },
    /** 渲染模块卡片到某个容器（数据驱动，新增板块不用改页面） */
    renderModules: function (container, modules) {
      if (!container) return;
      container.innerHTML = '';
      (modules || []).forEach(function (m) {
        if (!m || !m.entry || m.enabled === false) return;
        var a = document.createElement('a');
        a.className = 'nav-card';
        a.href = m.entry;
        var ico = document.createElement('span'); ico.className = 'nav-ico'; ico.textContent = m.icon || '•';
        var txt = document.createElement('span'); txt.className = 'txt';
        var b = document.createElement('b'); b.textContent = m.label || m.id;
        var s = document.createElement('span'); s.textContent = m.desc || '';
        txt.appendChild(b); txt.appendChild(s);
        var arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '›';
        a.appendChild(ico); a.appendChild(txt); a.appendChild(arrow);
        container.appendChild(a);
      });
    },

    // ── 小工具（各页原先各写一份）──
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    fmtBytes: function (n) {
      var v = Number(n) || 0;
      if (v < 1024) return v + ' B';
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
      if (v < 1024 * 1024 * 1024) return (v / 1048576).toFixed(1) + ' MB';
      return (v / 1073741824).toFixed(2) + ' GB';
    },
    fmtTime: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    /** 轻量 toast（各页统一观感；页面没有 #scToast 时自动创建） */
    toast: function (message, type) {
      if (!message) return;
      var el = document.getElementById('scToast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'scToast';
        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9999;max-width:86vw;padding:10px 14px;border-radius:10px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;background:#3a3631;color:#f6efe5;border:1px solid rgba(255,255,255,.12)';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.style.background = type === 'error' ? '#5a2a2a' : '#3a3631';
      el.style.opacity = '1';
      clearTimeout(el.__timer);
      el.__timer = setTimeout(function () { el.style.opacity = '0'; }, 2600);
    },
  };

  window.ShortCutMobile = sdk;
})();

/**
 * ShortCut 移动联动 · 共享 SDK（协议版本 1）
 *
 * 为什么要它：现在 /mobile/、/taskwall/、/transfer/、/control/、/bind/ 五个页面
 * 各自声明同一个 localStorage 键、各自实现请求与错误提示 —— 协议一改就要同时改五页，
 * 也无法给后续 Capacitor 安卓壳做兼容。所有移动页面统一引用这一份。
 *
 * 用法：
 *   <script src="/sync/sdk.php"></script>
 *   const sdk = window.ShortCutMobile;
 *   if (!sdk.isBound()) location.href = '/bind/';
 *   const r = await sdk.request('transfer.messages');
 *
 * 为什么用 /sync/sdk.php 而不是直接引这份 .js：
 *   本站 nginx 对 .js 给 12 小时缓存头，前面 Cloudflare 又按静态资源缓存 4 小时
 *   （cf-cache-status: HIT）。直连静态文件会导致改完 sdk.js 后手机最长 4 小时
 *   仍跑旧副本。sdk.php 由 PHP 透传本文件并显式发 no-store，保证「云端一改，
 *   手机刷新即生效」。本文件仍是唯一真源，sdk.php 只做读取转发。
 *
 * 约定：
 *   - 身份统一存 localStorage['shortcut-mobile-binding-v1'] = { bindId, mobileToken, deviceName, code }
 *   - 所有请求自动带 bindId + mobileToken（公开接口用 requestPublic）
 *   - 出错返回 { success:false, message }，不抛异常（调用方只需看 success）
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'shortcut-mobile-binding-v1';
  var DEVICE_KEY_STORAGE = 'shortcut-device-key-v1';
  var API_URL = '/sync/api.php';
  var PROTOCOL_VERSION = 1;
  var DEFAULT_TIMEOUT = 15000;

  /**
   * 本机（本浏览器）稳定设备标识，长期保存。
   *
   * 为什么需要：服务端从"单槽"改成设备列表后，如果不区分设备，同一台手机每次重新绑定都会
   * 在列表里新增一条（反复重绑会堆出一串同名僵尸设备，还会白占设备名额）。带上这个标识后，
   * 同一台手机重绑 = 原地轮换凭证，列表里始终只有一条。
   */
  function deviceKey() {
    var existing = '';
    try {
      existing = localStorage.getItem(DEVICE_KEY_STORAGE) || '';
    } catch (e) {
      existing = '';
    }
    if (existing) return existing;
    var bytes = new Uint8Array(12);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var key = Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
    try {
      localStorage.setItem(DEVICE_KEY_STORAGE, key);
    } catch (e) { /* 隐私模式下写不了：退化为本次会话内有效 */ }
    return key;
  }

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
    /** 本机稳定设备标识（绑定 mobile.bind 时带上，避免重绑堆出重复设备） */
    deviceKey: deviceKey,
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
      // 统一补设备标识：绑定动作必须带上它，服务端才能认出"还是同一台手机"并原地轮换凭证，
      // 而不是每次重绑都新增一条设备（放在这里是为了让所有绑定入口都不会漏）。
      if (action === 'mobile.bind' && !body.deviceKey) body.deviceKey = deviceKey();
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

    // ── 向桌面端直接要一次答复（经云端中继）──
    /**
     * 有些信息只有桌面端自己知道（最典型：它在局域网里的地址 + 一键直连令牌）。
     * 云端 WS 中继的桌面连接是**常驻**的（与桌面端"云端连接"开关解耦），所以随时可以问。
     *
     * 一次连接用完即关（不做持久化、不参与心跳），失败一律返回 { success:false, message }。
     * 返回 data = 桌面端 /api/* 的响应体。
     */
    requestDesktop: function (path, body, timeoutMs) {
      var b = binding();
      if (!b || !b.bindId || !b.mobileToken) {
        return Promise.resolve({ success: false, message: '尚未绑定桌面端', needBind: true });
      }
      if (typeof WebSocket === 'undefined') {
        return Promise.resolve({ success: false, message: '当前环境不支持实时通道' });
      }
      var limit = timeoutMs || 9000;
      var relay = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/relay-ws';
      return fetchJson(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'control.ticket', protocolVersion: PROTOCOL_VERSION,
          bindId: b.bindId, mobileToken: b.mobileToken, side: 'mobile', role: 'mobile',
        }),
      }).then(function (r) {
        if (!r || !r.success || !r.ticket) {
          return { success: false, message: (r && r.message) || '获取连接凭证失败' };
        }
        return new Promise(function (resolve) {
          var ws = null;
          var done = false;
          var id = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
          var finish = function (result) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { if (ws) ws.close(); } catch (e) { /* 忽略 */ }
            resolve(result);
          };
          var timer = setTimeout(function () {
            finish({ success: false, message: '桌面端没有响应（超时）' });
          }, limit);
          try {
            ws = new WebSocket(relay);
          } catch (e) {
            return finish({ success: false, message: '无法连接实时通道' });
          }
          ws.onopen = function () {
            try {
              ws.send(JSON.stringify({ auth: { role: 'mobile', bindId: b.bindId, ticket: r.ticket } }));
            } catch (e) {
              finish({ success: false, message: '发送鉴权失败' });
            }
          };
          ws.onmessage = function (ev) {
            var msg = null;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (!msg || !msg.t) return;
            if (msg.t === 'auth-fail') {
              return finish({ success: false, message: msg.error === 'ticket invalid or expired' ? '连接凭证已失效，请重试' : ('实时通道拒绝：' + (msg.error || '未知')) });
            }
            if (msg.t === 'auth-ok') {
              // 桌面端不在线就没必要再等（中继明确给了在线状态）
              if (msg.desktopOnline === false) {
                return finish({ success: false, desktopOffline: true, message: '电脑端不在线（请确认桌面 ShortCut 正在运行）' });
              }
              try {
                ws.send(JSON.stringify({ t: 'api', id: id, path: path, body: body || {} }));
              } catch (e) {
                finish({ success: false, message: '发送请求失败' });
              }
              return;
            }
            if (msg.t === 'api-res' && String(msg.id) === id) {
              return finish({ success: !!msg.ok, status: msg.status || 200, data: msg.data || {} });
            }
          };
          ws.onerror = function () { finish({ success: false, message: '实时通道连接失败' }); };
          ws.onclose = function () { finish({ success: false, message: '实时通道已断开' }); };
        });
      });
    },

    // ── 模块清单（服务端权威：modules.json）──
    modules: function () {
      var p = sdk.isBound() ? sdk.request('module.list') : sdk.requestPublic('module.list');
      return p.then(function (r) {
        if (r && r.protocolVersion) {
          sdk.serverProtocol = Number(r.protocolVersion) || 0;
          if (sdk.serverProtocol && sdk.serverProtocol !== PROTOCOL_VERSION) {
            console.warn('[ShortCutMobile] 协议版本不一致：客户端 ' + PROTOCOL_VERSION + ' / 服务端 ' + sdk.serverProtocol);
          }
        }
        return r;
      });
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

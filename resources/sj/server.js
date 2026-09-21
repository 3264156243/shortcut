#!/usr/bin/env node
/**
 * sj — 手机控制端（输入 / 触控板 / 键盘 / 电脑粘贴板）
 * Windows 光标注入；可作为独立进程或被父项目集成。
 *
 * 鉴权（可拆卸）SJ_AUTH_MODE:
 *   pair   默认：启动时生成绑定码，手机绑定后拿 token
 *   static 使用 SJ_TOKENS 中预置 token（父项目/网关下发）
 *   none   不鉴权（仅建议内网或父项目已在网关鉴权时使用）
 */
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

function loadConfig(env = process.env) {
  const authMode = String(env.SJ_AUTH_MODE || 'pair').toLowerCase();
  const tokens = String(env.SJ_TOKENS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: Number(env.PORT || env.SJ_PORT || 9823),
    host: env.SJ_HOST || '0.0.0.0',
    authMode: ['pair', 'static', 'none'].includes(authMode) ? authMode : 'pair',
    staticTokens: tokens,
    // 集成时可指向其他静态目录；默认本模块目录
    staticRoot: env.SJ_STATIC_ROOT ? path.resolve(env.SJ_STATIC_ROOT) : __dirname,
    // 父项目反代前缀，如 /module/sj（仅用于状态展示，路由仍从 path 原样匹配 API）
    basePath: String(env.SJ_BASE_PATH || '').replace(/\/$/, ''),
  };
}

function createApp(config = loadConfig()) {
  const ROOT = config.staticRoot;
  const PS_PATH = path.join(__dirname, 'inject.ps1');
  const PORT = config.port;

  let pairCode = String(Math.floor(100000 + Math.random() * 900000));
  const sessionTokens = new Map();
  const recentInput = [];
  const MAX_LOG = 30;
  const clipHistory = [];
  const CLIP_MAX = 40;
  let clipBusy = false;

  const injector = { ps: null, ready: false };

  function startInjector() {
    if (!fs.existsSync(PS_PATH)) {
      console.error('[inject] missing inject.ps1 at', PS_PATH);
      return;
    }
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_PATH],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    injector.ps = ps;
    let buf = '';
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === 'READY') injector.ready = true;
      }
    });
    ps.stderr.setEncoding('utf8');
    ps.stderr.on('data', (d) => process.stderr.write('[inject:err] ' + d));
    ps.on('exit', () => {
      injector.ready = false;
    });
  }

  function injectNow(cmd) {
    if (!injector.ps || injector.ps.killed) return false;
    try {
      injector.ps.stdin.write(cmd + '\n');
      return true;
    } catch {
      return false;
    }
  }

  function typeText(text) {
    return injectNow('TYPE ' + Buffer.from(text, 'utf8').toString('base64'));
  }

  function readPcClipboard() {
    return new Promise((resolve) => {
      if (clipBusy) {
        resolve(null);
        return;
      }
      clipBusy = true;
      const ps = `$ErrorActionPreference='SilentlyContinue';
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
Add-Type -AssemblyName System.Windows.Forms;
$t=[System.Windows.Forms.Clipboard]::GetText();
if ($null -eq $t) { $t = '' };
[Console]::Out.Write($t)`;
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { encoding: 'buffer', timeout: 4000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout) => {
          clipBusy = false;
          if (err) {
            resolve(null);
            return;
          }
          let buf = stdout;
          if (buf && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
            buf = buf.slice(3);
          }
          resolve(buf.toString('utf8'));
        }
      );
    });
  }

  function pushClipHistory(text) {
    if (text == null) return;
    const t = String(text).replace(/\r\n/g, '\n');
    if (!t.trim()) return;
    if (clipHistory.length && clipHistory[0].text === t) {
      clipHistory[0].at = Date.now();
      return;
    }
    clipHistory.unshift({ id: crypto.randomBytes(4).toString('hex'), text: t, at: Date.now() });
    while (clipHistory.length > CLIP_MAX) clipHistory.pop();
  }

  async function refreshClipboard() {
    const current = await readPcClipboard();
    if (current != null) pushClipHistory(current);
    return {
      current: current == null ? null : current,
      history: clipHistory.map((x) => ({
        id: x.id,
        text: x.text,
        preview: x.text.length > 160 ? x.text.slice(0, 160) + '…' : x.text,
        length: x.text.length,
        at: x.at,
      })),
    };
  }

  const VK = {
    backspace: 0x08, tab: 0x09, enter: 0x0d, return: 0x0d,
    shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, menu: 0x12,
    capslock: 0x14, esc: 0x1b, escape: 0x1b,
    space: 0x20, pageup: 0x21, pgup: 0x21, pagedown: 0x22, pgdn: 0x22,
    end: 0x23, home: 0x24,
    left: 0x25, up: 0x26, right: 0x27, down: 0x28,
    printscreen: 0x2c, prtsc: 0x2c, insert: 0x2d, del: 0x2e, delete: 0x2e,
    win: 0x5b, meta: 0x5b, super: 0x5b,
    f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
    f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
    ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
    '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde,
  };
  for (let i = 0; i < 10; i++) VK[String(i)] = 0x30 + i;
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(97 + i);
    VK[ch] = 0x41 + i;
    VK[ch.toUpperCase()] = 0x41 + i;
  }

  function resolveVk(name) {
    if (typeof name === 'number' && Number.isFinite(name)) return name | 0;
    const k = String(name || '').toLowerCase().trim();
    if (!k) return null;
    if (/^vk_?\d+$/i.test(k)) return parseInt(k.replace(/\D/g, ''), 10);
    if (/^0x[0-9a-f]+$/i.test(k)) return parseInt(k, 16);
    return Object.prototype.hasOwnProperty.call(VK, k) ? VK[k] : null;
  }

  function sendKey(name) {
    const vk = resolveVk(name);
    if (!vk) return false;
    return injectNow('KEY ' + vk);
  }

  function sendCombo(keys) {
    const list = Array.isArray(keys) ? keys : String(keys || '').split(/[+\-]/);
    const vks = [];
    for (const item of list) {
      const vk = resolveVk(item);
      if (!vk) return false;
      if (!vks.includes(vk)) vks.push(vk);
    }
    if (!vks.length) return false;
    return injectNow('COMBO ' + vks.join(','));
  }

  function sendMouse(dx, dy) {
    dx = Math.round(Number(dx) || 0);
    dy = Math.round(Number(dy) || 0);
    if (!dx && !dy) return true;
    return injectNow(`MOUSE ${dx} ${dy}`);
  }

  function sendClick(button) {
    const b = String(button || 'left').toLowerCase();
    if (!['left', 'right', 'middle'].includes(b)) return false;
    return injectNow('CLICK ' + b);
  }

  function sendWheel(delta) {
    delta = Math.round(Number(delta) || 0);
    if (!delta) return true;
    return injectNow('WHEEL ' + delta);
  }

  function lanIPv4() {
    const nets = os.networkInterfaces();
    const out = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) out.push(net.address);
      }
    }
    return out;
  }

  function urls() {
    return lanIPv4().map((a) => `http://${a}:${PORT}`);
  }

  function logInput(text) {
    recentInput.unshift({ text, at: Date.now() });
    if (recentInput.length > MAX_LOG) recentInput.pop();
  }

  function extractToken(req) {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1] : String(req.headers['x-token'] || '');
  }

  /** 鉴权入口：可按 SJ_AUTH_MODE 拆卸 */
  function isAuthorized(req) {
    if (config.authMode === 'none') return true;
    const token = extractToken(req);
    if (!token) return false;
    if (config.authMode === 'static') return config.staticTokens.includes(token);
    return sessionTokens.has(token);
  }

  function requireAuth(req, res) {
    if (isAuthorized(req)) return true;
    json(res, 401, { error: 'unauthorized', authMode: config.authMode });
    return false;
  }

  function json(res, code, obj) {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(new Error('body too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('invalid json'));
        }
      });
      req.on('error', reject);
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  function serveFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  }

  function tryStatic(pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return null;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) return null;
    return file;
  }

  function dashHtml() {
    const list = urls();
    const primary = list[0] || `http://127.0.0.1:${PORT}`;
    const authNote =
      config.authMode === 'pair'
        ? `绑定码：${esc(pairCode)}`
        : config.authMode === 'static'
          ? '鉴权：static（父项目下发 token，本页不显示绑定码）'
          : '鉴权：none（已关闭模块内绑定，请确保网关已做安全控制）';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>sj · 电脑端状态</title>
<style>
  :root { --bg:#f4f1ea; --ink:#1c242c; --muted:#5c6b7a; --accent:#0b6e4f; --card:#fffdf8; --line:#d9d2c3; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; padding:40px 20px; }
  .wrap { max-width:720px; margin:0 auto; }
  h1 { font-size:26px; margin:0 0 8px; }
  .sub { color:var(--muted); margin:0 0 24px; font-size:15px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; margin-bottom:14px; }
  .label { font-size:12px; color:var(--muted); letter-spacing:.06em; margin-bottom:6px; text-transform:uppercase; }
  .big { font-size:28px; font-weight:700; font-family:ui-monospace,Consolas,monospace; }
  .url { font-family:ui-monospace,Consolas,monospace; font-size:16px; word-break:break-all; color:var(--accent); }
  .url a { color:inherit; }
  .note { color:var(--muted); font-size:13px; line-height:1.6; margin-top:8px; }
  .ok { color:var(--accent); font-weight:600; }
  .grid { display:grid; gap:8px; }
  @media (min-width:640px) { .grid.two { grid-template-columns:1fr 1fr; } }
</style>
</head>
<body>
  <div class="wrap">
    <h1>sj 手机控制端</h1>
    <p class="sub">可集成模块 · 模块内绑定可拆卸 · 公网由外部网关/云服务器转发</p>
    <div class="card">
      <div class="label">局域网地址</div>
      <div class="grid two">
        ${list.map((u) => `<div class="url"><a href="${esc(u)}" target="_blank">${esc(u)}</a></div>`).join('') || `<div class="url">${esc(primary)}</div>`}
      </div>
    </div>
    <div class="card">
      <div class="label">鉴权模式</div>
      <div class="big">${esc(config.authMode)}</div>
      <div class="note">${authNote}</div>
    </div>
    <div class="card">
      <div class="label">状态</div>
      <div class="ok" id="st">injector: …</div>
      <div class="note">手机入口：<code>index.html</code>；集成时由父项目反代到本服务。</div>
    </div>
  </div>
  <script>
    async function refresh(){
      try{
        const data=await (await fetch('/api/status')).json();
        const parts=[
          'injector: '+(data.injector?'ready':'down'),
          'auth: '+data.authMode,
        ];
        if(data.authMode==='pair') parts.push('pairCode: '+data.pairCode);
        parts.push('clients: '+data.clients);
        document.getElementById('st').textContent=parts.join(' · ');
      }catch(e){
        document.getElementById('st').textContent='status unavailable';
      }
    }
    refresh(); setInterval(refresh,2000);
  </script>
</body>
</html>`;
  }

  async function handleApi(req, res, p) {
    if (req.method === 'GET' && p === '/api/config') {
      // 给手机页：是否需要展示绑定界面
      json(res, 200, {
        authMode: config.authMode,
        requirePair: config.authMode === 'pair',
        basePath: config.basePath,
      });
      return true;
    }

    if (req.method === 'GET' && p === '/api/status') {
      json(res, 200, {
        authMode: config.authMode,
        pairCode: config.authMode === 'pair' ? pairCode : null,
        clients: config.authMode === 'pair' ? sessionTokens.size : null,
        urls: urls(),
        basePath: config.basePath,
        recent: recentInput.slice(0, 12),
        injector: injector.ready,
      });
      return true;
    }

    if (req.method === 'POST' && p === '/api/pair') {
      if (config.authMode !== 'pair') {
        json(res, 400, { error: 'pair disabled', authMode: config.authMode });
        return true;
      }
      const body = await readBody(req);
      const code = String(body.code || '').trim();
      if (code !== pairCode) {
        json(res, 401, { error: '绑定码错误' });
        return true;
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessionTokens.set(token, { ua: req.headers['user-agent'] || '', at: Date.now() });
      json(res, 200, { token });
      return true;
    }

    if (req.method === 'POST' && p === '/api/unbind') {
      if (config.authMode === 'pair') {
        const token = extractToken(req);
        if (token) sessionTokens.delete(token);
      }
      json(res, 200, { ok: true });
      return true;
    }

    // 以下接口在 none 模式直接放行，其余模式校验 token
    const openRoutes = new Set(['/api/pair', '/api/unbind', '/api/config', '/api/status']);

    if (!openRoutes.has(p) && !requireAuth(req, res)) return true;

    if (req.method === 'POST' && p === '/api/ping') {
      json(res, 200, { ok: true, injector: injector.ready, authMode: config.authMode });
      return true;
    }

    if (req.method === 'POST' && p === '/api/type') {
      const body = await readBody(req);
      const text = String(body.text || '');
      if (!text) return json(res, 400, { error: 'empty' }), true;
      if (text.length > 2000) return json(res, 400, { error: 'too long' }), true;
      const ok = typeText(text);
      if (ok) logInput(text);
      json(res, ok ? 200 : 503, { ok, injector: injector.ready });
      return true;
    }

    if (req.method === 'POST' && p === '/api/key') {
      const body = await readBody(req);
      const ok = sendKey(body.key);
      json(res, ok ? 200 : 400, { ok });
      return true;
    }

    if (req.method === 'POST' && p === '/api/combo') {
      const body = await readBody(req);
      const keys = body.keys || body.key;
      const ok = sendCombo(keys);
      if (ok && Array.isArray(keys)) logInput('[' + keys.join('+') + ']');
      json(res, ok ? 200 : 400, { ok });
      return true;
    }

    if (req.method === 'POST' && p === '/api/mouse') {
      const body = await readBody(req);
      const ok = sendMouse(body.dx, body.dy);
      json(res, ok ? 200 : 400, { ok });
      return true;
    }

    if (req.method === 'POST' && p === '/api/click') {
      const body = await readBody(req);
      const ok = sendClick(body.button);
      json(res, ok ? 200 : 400, { ok });
      return true;
    }

    if (req.method === 'POST' && p === '/api/wheel') {
      const body = await readBody(req);
      const ok = sendWheel(body.delta);
      json(res, ok ? 200 : 400, { ok });
      return true;
    }

    if (req.method === 'POST' && p === '/api/clipboard/refresh') {
      const data = await refreshClipboard();
      json(res, 200, data);
      return true;
    }

    if (req.method === 'POST' && p === '/api/clipboard/paste') {
      const body = await readBody(req);
      let text = body.text;
      if (text == null && body.id) {
        const item = clipHistory.find((x) => x.id === body.id);
        text = item ? item.text : null;
      }
      text = text == null ? '' : String(text);
      if (!text) return json(res, 400, { error: 'empty' }), true;
      if (text.length > 20000) return json(res, 400, { error: 'too long' }), true;
      const CHUNK = 500;
      let ok = true;
      for (let i = 0; i < text.length; i += CHUNK) {
        if (!typeText(text.slice(i, i + CHUNK))) {
          ok = false;
          break;
        }
      }
      if (ok) logInput('[粘贴]' + (text.length > 40 ? text.slice(0, 40) + '…' : text));
      json(res, ok ? 200 : 503, { ok, injector: injector.ready });
      return true;
    }

    if (req.method === 'POST' && p === '/api/clipboard/clear') {
      clipHistory.length = 0;
      json(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'POST' && p === '/api/reset-code') {
      if (config.authMode !== 'pair') {
        json(res, 400, { error: 'pair disabled' });
        return true;
      }
      const ra = req.socket.remoteAddress || '';
      if (!ra.includes('127.0.0.1') && !ra.includes('::1')) {
        json(res, 403, { error: 'localhost only' });
        return true;
      }
      pairCode = String(Math.floor(100000 + Math.random() * 900000));
      sessionTokens.clear();
      json(res, 200, { pairCode });
      return true;
    }

    json(res, 404, { error: 'not found' });
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let p = url.pathname;

    // 支持父项目挂载前缀：/module/sj/api/xxx → /api/xxx
    if (config.basePath && p.startsWith(config.basePath + '/')) {
      p = p.slice(config.basePath.length);
    } else if (config.basePath && p === config.basePath) {
      p = '/';
    }

    try {
      if (p.startsWith('/api/')) {
        await handleApi(req, res, p);
        return;
      }

      if (req.method === 'GET' && (p === '/' || p === '/index.html') && url.searchParams.get('view') === 'pc') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(dashHtml());
        return;
      }
      if (req.method === 'GET' && p === '/pc') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(dashHtml());
        return;
      }

      if (req.method === 'GET') {
        const file = tryStatic(p);
        if (file) {
          serveFile(res, file);
          return;
        }
      }

      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message || 'server error' });
    }
  });

  function printBanner() {
    console.log('');
    console.log('  sj 手机控制端 · auth=' + config.authMode + ' · port=' + PORT);
    if (config.authMode === 'pair') console.log('  绑定码: ' + pairCode);
    if (config.authMode === 'static') console.log('  static tokens: ' + (config.staticTokens.length || 0));
    for (const u of urls()) console.log('  ' + u + (config.basePath || ''));
    console.log('  手机页: /index.html  状态页: /?view=pc');
    console.log('');
  }

  return {
    config,
    server,
    injector,
    startInjector,
    printBanner,
    /** 供父项目/测试注入，不启动监听 */
    _internal: {
      isAuthorized,
      sessionTokens,
      typeText,
      sendKey,
    },
  };
}

function start(options = {}) {
  const config = { ...loadConfig(), ...options };
  const app = createApp(config);
  app.startInjector();
  app.server.listen(config.port, config.host, () => app.printBanner());
  app.server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`端口 ${config.port} 被占用，可设 PORT/SJ_PORT`);
    else console.error(e);
    process.exit(1);
  });

  if (process.stdin.isTTY && config.authMode === 'pair') {
    process.stdin.setEncoding('utf8');
    let lineBuf = '';
    process.stdin.on('data', (d) => {
      lineBuf += d;
      let nl;
      while ((nl = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, nl).trim().toLowerCase();
        lineBuf = lineBuf.slice(nl + 1);
        if (line === 'r') {
          // 重置绑定码需访问 createApp 内部状态：通过再暴露简单方法
          // 这里用 /api/reset-code 更合适；本地快捷键改为提示
          console.log('\n[reset] 请 POST http://127.0.0.1:' + config.port + '/api/reset-code\n');
        }
      }
    });
  }
  return app;
}

module.exports = {
  createApp,
  start,
  loadConfig,
};

if (require.main === module) {
  start();
}

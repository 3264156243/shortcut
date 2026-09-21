/**
 * 控制板块 · 云端转发模式（桌面侧）
 * 桌面 ⇄(wss)⇄ 云端中继 ⇄(wss)⇄ 手机，按 ShortCut 绑定身份（bindId）配对。
 * - 连接凭证：向 sync/api.php 的 control.ticket action 换取 HMAC 短时效 ticket（10 分钟）
 * - 注入：require resources/sj/server.js 的 createApp()._internal（不监听端口，纯进程内调用）
 * - 断线自动重连（重取 ticket）
 */
const path = require('path');
const fs = require('fs');

const SYNC_API_URL = 'https://shortcut.326415.xyz/sync/api.php';
const RELAY_URL = 'wss://shortcut.326415.xyz/relay-ws';
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_MS = 25000;
const API_TIMEOUT_MS = 8000;

let WebSocket: any = null; // 延迟 require，避免非云模式加载
let sjApp: any = null;     // sj createApp 实例（注入通道）
let ws: any = null;
let wsState: 'idle' | 'connecting' | 'authed' = 'idle';
let reconnectTimer: any = null;
let heartbeatTimer: any = null;
let reconnectAttempts = 0;
let stopping = false;
let lastError = '';

function getSjServerPath(): string {
  const app = require('electron').app;
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'sj', 'server.js');
  }
  return path.join(__dirname, '..', 'resources', 'sj', 'server.js');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTicket(bindId: string, bindCode: string): Promise<string> {
  const res = await fetch(SYNC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'control.ticket', role: 'desktop', bindId, bindCode }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || !data?.success || !data.ticket) {
    throw new Error(data?.message || '获取云端连接凭证失败');
  }
  return String(data.ticket);
}

async function ensureInjector(): Promise<any> {
  if (sjApp) return sjApp;
  const serverJs = getSjServerPath();
  if (!fs.existsSync(serverJs)) throw new Error('控制服务组件不存在');
  // require sj 模块：createApp 不监听端口，仅启动注入器（PowerShell SendInput 常驻）
  // eslint-disable-next-line global-require
  const sj = require(serverJs);
  const sjDir = path.dirname(serverJs);
  sjApp = sj.createApp({
    authMode: 'none',
    port: 0,
    host: '127.0.0.1',
    basePath: '',
    staticRoot: sjDir,
  });
  sjApp.startInjector();
  // 等注入器就绪（最多 8 秒），未就绪也继续——指令会返回 503
  for (let i = 0; i < 40; i++) {
    if (sjApp.injector.ready) break;
    // eslint-disable-next-line no-await-in-loop
    await delay(200);
  }
  return sjApp;
}

function handleApi(pathname: string, body: any): Promise<{ ok: boolean; status: number; data: any }> {
  const inject = sjApp?._internal || {};
  const wrap = (ok: boolean, status = ok ? 200 : 400, data: any = null) => ({ ok, status, data: data || { ok } });
  switch (pathname) {
    case '/api/ping':
      return Promise.resolve(wrap(true, 200, { ok: true, injector: inject.isInjectorReady?.() || false }));
    case '/api/type': {
      const text = String(body?.text || '');
      if (!text || text.length > 2000) return Promise.resolve(wrap(false, 400, { error: 'empty or too long' }));
      return Promise.resolve(wrap(!!inject.typeText?.(text), inject.typeText ? 200 : 503));
    }
    case '/api/key':
      return Promise.resolve(wrap(!!inject.sendKey?.(body?.key), inject.sendKey ? 200 : 503));
    case '/api/combo':
      return Promise.resolve(wrap(!!inject.sendCombo?.(body?.keys || body?.key), inject.sendCombo ? 200 : 503));
    case '/api/mouse':
      return Promise.resolve(wrap(!!inject.sendMouse?.(body?.dx, body?.dy), inject.sendMouse ? 200 : 503));
    case '/api/click':
      return Promise.resolve(wrap(!!inject.sendClick?.(body?.button), inject.sendClick ? 200 : 503));
    case '/api/wheel':
      return Promise.resolve(wrap(!!inject.sendWheel?.(body?.delta), inject.sendWheel ? 200 : 503));
    case '/api/clipboard/refresh':
      if (!inject.refreshClipboard) return Promise.resolve(wrap(false, 503));
      return inject.refreshClipboard().then((data: any) => wrap(true, 200, data));
    case '/api/clipboard/paste':
      if (!inject.pasteClipboardText) return Promise.resolve(wrap(false, 503));
      return inject.pasteClipboardText(body?.text).then((ok: boolean) => wrap(ok, ok ? 200 : 503));
    case '/api/clipboard/clear':
      inject.clearClipHistory?.();
      return Promise.resolve(wrap(true));
    default:
      return Promise.resolve(wrap(false, 400, { error: 'unknown path' }));
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function teardownSocket() {
  stopHeartbeat();
  if (ws) {
    try { ws.removeAllListeners?.(); ws.close(); } catch { }
    ws = null;
  }
  wsState = 'idle';
}

function connect(bindId: string, bindCode: string) {
  if (stopping) return;
  teardownSocket();
  wsState = 'connecting';

  fetchTicket(bindId, bindCode).then((ticket) => {
    if (stopping) return;
    if (!WebSocket) WebSocket = require('ws');
    const socket = new WebSocket(RELAY_URL, { handshakeTimeout: 10000 });
    ws = socket;

    socket.on('open', () => {
      socket.send(JSON.stringify({ auth: { role: 'desktop', bindId, ticket } }));
    });

    socket.on('message', (raw: any) => {
      let msg: any = null;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.t === 'auth-ok') {
        wsState = 'authed';
        reconnectAttempts = 0;
        lastError = '';
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try { socket.send(JSON.stringify({ t: 'ping' })); } catch { }
        }, HEARTBEAT_MS);
        return;
      }
      if (msg.t === 'auth-fail') {
        lastError = String(msg.error || '鉴权失败');
        // 票据失效等情况：立即重试（重取 ticket）
        try { socket.close(); } catch { }
        return;
      }
      if (msg.t === 'api' && wsState === 'authed') {
        const id = String(msg.id || '');
        const reply = (result: { ok: boolean; status: number; data: any }) => {
          try { socket.send(JSON.stringify({ t: 'api-res', id, ok: result.ok, status: result.status, data: result.data })); } catch { }
        };
        const timeout = setTimeout(() => reply({ ok: false, status: 504, data: { error: 'timeout' } }), API_TIMEOUT_MS);
        handleApi(String(msg.path || ''), msg.body || {})
          .then((result) => { clearTimeout(timeout); reply(result); })
          .catch((err: any) => { clearTimeout(timeout); reply({ ok: false, status: 500, data: { error: err?.message || 'inject error' } }); });
      }
    });

    socket.on('close', () => {
      if (ws === socket) {
        ws = null;
        wsState = 'idle';
        stopHeartbeat();
      }
      scheduleReconnect(bindId, bindCode);
    });

    socket.on('error', (err: Error) => {
      lastError = err?.message || '连接错误';
      try { socket.close(); } catch { }
    });
  }).catch((err) => {
    lastError = err?.message || '获取凭证失败';
    scheduleReconnect(bindId, bindCode);
  });
}

function scheduleReconnect(bindId: string, bindCode: string) {
  if (stopping) return;
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const waitMs = Math.min(RECONNECT_BASE_MS * Math.pow(1.6, Math.min(reconnectAttempts, 8)), RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!stopping) connect(bindId, bindCode);
  }, waitMs);
}

export async function startCloudControl(): Promise<{ success: boolean; error?: string }> {
  stopping = false;
  try {
    // 云模式与局域网 spawn 互斥
    const lan = require('./control-service');
    if (lan && typeof lan.stopControlService === 'function') lan.stopControlService();

    const bindingMod = require('./sync/binding');
    const binding = bindingMod.getOrCreateBind ? await bindingMod.getOrCreateBind() : null;
    if (!binding || !binding.bindId) {
      return { success: false, error: '尚未建立联动绑定，请先在「联动绑定」板块完成绑定' };
    }
    await ensureInjector();
    connect(binding.bindId, String(binding.code || ''));
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || '云端控制启动失败' };
  }
}

export function stopCloudControl(): boolean {
  stopping = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
  teardownSocket();
  if (sjApp) {
    try { if (sjApp.injector && sjApp.injector.ps) sjApp.injector.ps.kill(); } catch { }
    sjApp = null;
  }
  return true;
}

export async function getCloudStatus(): Promise<any> {
  return {
    active: wsState !== 'idle' || !!sjApp,
    connected: wsState === 'authed',
    connecting: wsState === 'connecting',
    injector: !!(sjApp && sjApp.injector && sjApp.injector.ready),
    lastError,
  };
}

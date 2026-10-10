#!/usr/bin/env node
/**
 * ShortCut 控制板块 · 云端 WebSocket 中继
 * 手机 ⇄(wss)⇄ 本中继 ⇄(wss)⇄ 桌面，按 bindId 配对转发控制指令。
 *
 * 鉴权：客户端连接后第一条消息必须为
 *   { auth: { role: 'desktop'|'mobile', bindId, ticket } }
 * ticket 由 sync/api.php 的 control.ticket action 签发（HMAC-SHA256，10 分钟时效），
 * 本中继只验签，不访问数据文件。密钥通过环境变量 CONTROL_RELAY_SECRET 传入。
 *
 * 消息协议（auth 通过后）：
 *   mobile → desktop : { t:'api', id, path, body }
 *   desktop → mobile : { t:'api-res', id, ok, status, data }
 *   双方             : { t:'ping' } → { t:'pong' }
 *   中继 → mobile    : { t:'desktop-status', online }  桌面上下线通知
 *   中继 → desktop   : { t:'sync-wake', board, count } 任务墙实时唤醒（桌面收到后立刻拉取）
 *
 * 本地 HTTP（仅 127.0.0.1，给 sync/api.php 用）：
 *   GET  /healthz            → { ok, rooms, at }
 *   POST /notify {bindId,board,count} → { online, delivered }  桌面在线则转 sync-wake
 *
 * 部署：node relay.js（监听 127.0.0.1:9840，nginx 反代 /relay-ws → 本端口并做 TLS 终结）
 * 依赖：npm i ws（仅此一个）
 */
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.RELAY_PORT || 9840);
const HOST = process.env.RELAY_HOST || '127.0.0.1';
const SECRET = String(process.env.CONTROL_RELAY_SECRET || '');
const MAX_BINDINGS = 500;          // 同时在线 bindId 数上限
const MAX_CLIENTS_PER_BIND = 3;    // 每个 bindId 最多连接数（1 桌面 + 2 手机）
const MAX_MESSAGE = 64 * 1024;
const TICKET_TTL_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

if (!SECRET) {
  console.error('[relay] 缺少 CONTROL_RELAY_SECRET 环境变量，拒绝启动');
  process.exit(1);
}

/** desktop 与 mobile 连接表：bindId → { desktop, mobiles:Set } */
const rooms = new Map();

function verifyTicket(ticket, expectRole) {
  try {
    const dot = String(ticket || '').lastIndexOf('.');
    if (dot <= 0) return null;
    const payloadB64 = String(ticket).slice(0, dot);
    const sig = String(ticket).slice(dot + 1);
    const expect = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    if (!payload || typeof payload.bindId !== 'string' || payload.role !== expectRole) return null;
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp * 1000 + 5000) return null;
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(payload.bindId)) return null;
    return { bindId: payload.bindId, role: payload.role };
  } catch {
    return null;
  }
}

function roomOf(bindId, create) {
  let room = rooms.get(bindId);
  if (!room && create) {
    if (rooms.size >= MAX_BINDINGS) return null;
    room = { desktop: null, mobiles: new Set() };
    rooms.set(bindId, room);
  }
  return room || null;
}

function roomCount(room) {
  return (room.desktop ? 1 : 0) + room.mobiles.size;
}

function dropRoomIfEmpty(bindId, room) {
  if (room.desktop || room.mobiles.size) return;
  rooms.delete(bindId);
}

function notifyDesktopStatus(room, online) {
  for (const mobile of room.mobiles) {
    try { mobile.ws.send(JSON.stringify({ t: 'desktop-status', online })); } catch { }
  }
}

function safeParse(raw) {
  try { return JSON.parse(String(raw)); } catch { return null; }
}

/** 指令转发统计（10 秒汇总一条，避免高频 mouse 刷爆日志） */
const fwdStats = new Map(); // bindId → { api, res, last }
setInterval(() => {
  for (const [bindId, st] of fwdStats) {
    if (st.api || st.res) {
      console.log(`[relay] fwd bind=${bindId.slice(0, 8)}… api=${st.api} res=${st.res} last=${st.last || '-'}`);
      st.api = 0; st.res = 0; st.last = '-';
    }
  }
}, 10000).unref();

function bumpFwd(bindId, kind, path) {
  let st = fwdStats.get(bindId);
  if (!st) { st = { api: 0, res: 0, last: '-' }; fwdStats.set(bindId, st); }
  if (kind === 'api') st.api += 1;
  else st.res += 1;
  if (path) st.last = path;
}

const server = http.createServer((req, res) => {
  // 健康检查
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, at: new Date().toISOString() }));
    return;
  }
  // 任务墙推送的实时唤醒（由 sync/api.php 入队成功后调用，仅 127.0.0.1 可达）：
  // 该 bindId 的桌面在线 → 立刻发 { t:'sync-wake', board, count }（桌面收到就拉取队列）；
  // 离线 → 原样返回 online:false，任务留在服务端队列等下次拉取。
  if (req.method === 'POST' && req.url === '/notify') {
    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      const out = (code, payload) => {
        try { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); } catch { }
      };
      if (tooBig) { out(413, { online: false, delivered: 0, error: 'payload too large' }); return; }
      const msg = safeParse(raw) || {};
      const bindId = String(msg.bindId || '');
      const board = String(msg.board || 'taskwall');
      const count = Number.isFinite(Number(msg.count)) ? Number(msg.count) : 1;
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(bindId)) {
        out(400, { online: false, delivered: 0, error: 'bad bindId' });
        return;
      }
      const room = rooms.get(bindId);
      const desktop = room && room.desktop;
      if (!desktop) {
        console.log(`[relay] notify bind=${bindId.slice(0, 8)}… board=${board} desktop=offline（任务留在队列）`);
        out(200, { online: false, delivered: 0 });
        return;
      }
      let delivered = 0;
      try {
        desktop.send(JSON.stringify({ t: 'sync-wake', board, count }));
        delivered = 1;
      } catch { delivered = 0; }
      console.log(`[relay] notify bind=${bindId.slice(0, 8)}… board=${board} count=${count} delivered=${delivered}（已实时唤醒桌面）`);
      out(200, { online: true, delivered });
    });
    req.on('error', () => { try { res.destroy(); } catch { } });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.authed = false;
  ws.role = null;
  ws.bindId = null;
  ws.room = null;

  // 仅允许本机 / nginx 反代来源；不做来源强校验（鉴权靠 ticket）
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (raw.length > MAX_MESSAGE) return;
    ws.isAlive = true;
    const msg = safeParse(raw);
    if (!msg || typeof msg !== 'object') return;

    if (!ws.authed) {
      const auth = msg.auth;
      if (!auth || typeof auth !== 'object') {
        try { ws.send(JSON.stringify({ t: 'auth-fail', error: 'missing auth' })); } catch { }
        ws.close();
        return;
      }
      const identity = verifyTicket(auth.ticket, auth.role === 'desktop' ? 'desktop' : 'mobile');
      if (!identity) {
        try { ws.send(JSON.stringify({ t: 'auth-fail', error: 'ticket invalid or expired' })); } catch { }
        ws.close();
        return;
      }
      const room = roomOf(identity.bindId, true);
      if (!room) {
        try { ws.send(JSON.stringify({ t: 'auth-fail', error: 'server busy' })); } catch { }
        ws.close();
        return;
      }
      if (roomCount(room) >= MAX_CLIENTS_PER_BIND) {
        try { ws.send(JSON.stringify({ t: 'auth-fail', error: 'too many connections' })); } catch { }
        ws.close();
        return;
      }
      ws.authed = true;
      ws.role = identity.role;
      ws.bindId = identity.bindId;
      ws.room = room;
      if (identity.role === 'desktop') {
        // 顶掉旧桌面连接（桌面重连场景）
        if (room.desktop && room.desktop !== ws) {
          try { room.desktop.close(); } catch { }
        }
        const wasOffline = !room.desktop;
        room.desktop = ws;
        if (wasOffline) notifyDesktopStatus(room, true);
      } else {
        room.mobiles.add(ws);
        try { ws.send(JSON.stringify({ t: 'desktop-status', online: !!room.desktop })); } catch { }
      }
      try {
        ws.send(JSON.stringify({
          t: 'auth-ok',
          role: identity.role,
          bindId: identity.bindId,
          // 手机端需要知道桌面当前是否在线（undefined = 桌面端自身连接无需此字段）
          desktopOnline: identity.role === 'mobile' ? !!room.desktop : undefined,
        }));
      } catch { }
      console.log(`[relay] auth ${identity.role} bind=${identity.bindId.slice(0, 8)}… rooms=${rooms.size}`);
      return;
    }

    if (msg.t === 'ping') {
      try { ws.send(JSON.stringify({ t: 'pong', now: Date.now() })); } catch { }
      return;
    }

    const room = ws.room;
    if (!room) return;

    if (ws.role === 'mobile' && msg.t === 'api') {
      const desktop = room.desktop;
      if (!desktop) {
        try { ws.send(JSON.stringify({ t: 'api-res', id: msg.id, ok: false, status: 503, data: { error: 'desktop offline' } })); } catch { }
        return;
      }
      // 只转发受支持的路径，防止任意转发滥用
      // /api/lan-entry：手机问桌面端"你在局域网里的地址 + 一键直连令牌"（桌面端只回只读信息，
      // 不注入任何指令）。没有它，局域网直连就只能让用户手输地址再输绑定码。
      const ALLOWED = new Set([
        '/api/type', '/api/key', '/api/combo', '/api/mouse', '/api/click', '/api/wheel',
        '/api/clipboard/refresh', '/api/clipboard/paste', '/api/clipboard/clear', '/api/ping',
        '/api/lan-entry',
      ]);
      const path = String(msg.path || '');
      if (!ALLOWED.has(path)) {
        try { ws.send(JSON.stringify({ t: 'api-res', id: msg.id, ok: false, status: 400, data: { error: 'path not allowed' } })); } catch { }
        return;
      }
      try {
        desktop.ws === undefined; // noop 防御
        bumpFwd(ws.bindId, 'api', path);
        desktop.send(JSON.stringify({ t: 'api', id: String(msg.id || ''), path, body: msg.body || {} }));
      } catch { }
      return;
    }

    if (ws.role === 'desktop' && msg.t === 'api-res') {
      bumpFwd(ws.bindId, 'res', '');
      for (const mobile of room.mobiles) {
        try { mobile.send(JSON.stringify({ t: 'api-res', id: msg.id, ok: !!msg.ok, status: msg.status || 200, data: msg.data || {} })); } catch { }
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.authed) return;
    const room = ws.room;
    if (!room) return;
    console.log(`[relay] close ${ws.role} bind=${ws.bindId.slice(0, 8)}… rooms=${rooms.size}`);
    if (ws.role === 'desktop' && room.desktop === ws) {
      room.desktop = null;
      notifyDesktopStatus(room, false);
    } else {
      room.mobiles.delete(ws);
    }
    dropRoomIfEmpty(ws.bindId, room);
  });

  ws.on('error', () => { /* 统一由 close 清理 */ });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch { } continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { }
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`[relay] ShortCut control relay listening on ${HOST}:${PORT} (rooms=${rooms.size})`);
});

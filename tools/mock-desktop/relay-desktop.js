#!/usr/bin/env node
/**
 * 假桌面桩（mock desktop）—— 用一个 Node 进程扮演"桌面端"，接在真实的云端中继上。
 *
 * 用途：
 *   1) 安卓端/移动 Web 端在没有 Windows 桌面端时，也能联调**实时控制链路**（电脑控制）；
 *   2) 桌面侧把它当**协议回归工具**：改完 relay / cloud.rs 后跑一遍，确认消息形状没变。
 *
 * 它严格按 docs/移动互联-协议契约.md §7 实现：
 *   ① POST api.php {action:'control.ticket', role:'desktop', bindId, deskToken} → ticket
 *   ② 连 wss://shortcut.326415.xyz/relay-ws，**首帧**发 {auth:{role:'desktop', bindId, ticket}}
 *   ③ 收 {t:'api', id, path, body} → 本地"执行" → 回 {t:'api-res', id, ok, status, data}
 *   ④ 收 {t:'sync-wake'} → 打印（真实桌面端此时会去 pull 任务）
 *   ⑤ 每 25 秒发 {t:'ping'}；中继的 WS 协议层 ping 由 ws 库自动回 pong
 *
 * 用法（token 不要写进命令行历史，优先用环境变量）：
 *   set SC_BIND_ID=xxxx
 *   set SC_DESK_TOKEN=yyyy
 *   node tools/mock-desktop/relay-desktop.js
 *
 *   # 或显式传参
 *   node tools/mock-desktop/relay-desktop.js --bind xxxx --token yyyy
 *
 *   # 让 /api/lan-entry 假装"局域网直连已开启"（用于联调一键直连）
 *   # 用环境变量传最省事（命令行传 JSON 要额外转义）：
 *   set SC_LAN_ENTRY={"running":true,"port":9823,"url":"http://192.168.1.5:9823","urls":["http://192.168.1.5:9823"],"token":"<48hex>","pairCode":"123456","authMode":"pair"}
 *   node tools/mock-desktop/relay-desktop.js
 *
 * 怎么拿 bindId / deskToken：契约 §2.1 `bind.create`（新建测试绑定）或 §2.2 `bind.claimToken`（凭绑定码换）。
 */
'use strict';

const https = require('https');
const http = require('http');

const API_BASE = process.env.SC_API_BASE || 'https://shortcut.326415.xyz/sync/api.php';
const RELAY_URL = process.env.SC_RELAY_URL || 'wss://shortcut.326415.xyz/relay-ws';
const PING_MS = 25000;
const RECONNECT_MS = 3000;

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
}

const BIND_ID = arg('bind') || process.env.SC_BIND_ID || '';
const DESK_TOKEN = arg('token') || process.env.SC_DESK_TOKEN || '';
let LAN_ENTRY = { running: false };
// 优先用环境变量 SC_LAN_ENTRY：命令行传 JSON 在各家 shell 里都要额外转义，容易踩坑
const lanArg = process.env.SC_LAN_ENTRY || arg('lan-entry');
if (lanArg) {
  try { LAN_ENTRY = JSON.parse(lanArg); } catch (e) {
    console.error('[mock] LAN_ENTRY 不是合法 JSON：' + e.message);
    process.exit(2);
  }
}

if (!BIND_ID || !DESK_TOKEN) {
  console.error('缺少身份：请设置 SC_BIND_ID / SC_DESK_TOKEN 环境变量，或传 --bind/--token。');
  console.error('（bindId 与 deskToken 见 docs/移动互联-协议契约.md §2.1 / §2.2）');
  process.exit(2);
}

let WebSocket;
try {
  WebSocket = require('ws');           // 仓库根目录已带 ws；若在别处跑：npm i ws
} catch (e) {
  console.error('缺少依赖 ws：请在仓库根目录执行 `npm i ws`，或用 NODE_PATH 指向仓库的 node_modules。');
  process.exit(2);
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

function post(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(API_BASE);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('非 JSON 响应: ' + buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** 把手机发来的 /api/* 在这里"执行"。返回 [ok, status, data]。 */
function handleApi(path, body, state) {
  const b = body || {};
  switch (path) {
    case '/api/ping':
      return [true, 200, { ok: true, injector: true }];
    case '/api/type': {
      const text = String(b.text == null ? '' : b.text);
      if (!text) return [false, 400, { error: 'empty' }];
      if (Buffer.byteLength(text, 'utf8') > 2000) return [false, 400, { error: 'too long' }];
      state.typed += text;
      console.log(`  └ TYPE ${JSON.stringify(text)}`);
      return [true, 200, { ok: true, injector: true }];
    }
    case '/api/key': {
      console.log(`  └ KEY ${JSON.stringify(b.key)}`);
      return [true, 200, { ok: true }];
    }
    case '/api/combo': {
      const keys = Array.isArray(b.keys) ? b.keys : String(b.key || '').split(/[+-]/);
      console.log(`  └ COMBO ${JSON.stringify(keys)}`);
      return [true, 200, { ok: true }];
    }
    case '/api/mouse': {
      const dx = Math.round(Number(b.dx) || 0);
      const dy = Math.round(Number(b.dy) || 0);
      if (dx || dy) console.log(`  └ MOUSE ${dx} ${dy}`);
      return [true, 200, { ok: true }];
    }
    case '/api/click': {
      const btn = String(b.button || 'left').toLowerCase();
      if (!['left', 'right', 'middle'].includes(btn)) return [false, 400, { ok: false }];
      console.log(`  └ CLICK ${btn}`);
      return [true, 200, { ok: true }];
    }
    case '/api/wheel': {
      const d = Math.round(Number(b.delta) || 0);
      if (d) console.log(`  └ WHEEL ${d}`);
      return [true, 200, { ok: true }];
    }
    case '/api/clipboard/refresh':
      // 真实桌面端读 Windows 剪贴板；桩返回固定内容便于联调
      return [true, 200, { current: '[mock 剪贴板内容]', history: [{ id: 'c1', text: '[mock 剪贴板内容]', at: Date.now() }] }];
    case '/api/clipboard/paste': {
      const text = String(b.text == null ? '' : b.text);
      if (!text) return [false, 400, { error: 'empty' }];
      if (Buffer.byteLength(text, 'utf8') > 20000) return [false, 400, { error: 'too long' }];
      console.log(`  └ CLIPBOARD PASTE ${JSON.stringify(text.slice(0, 40))}`);
      return [true, 200, { ok: true, injector: true }];
    }
    case '/api/clipboard/clear':
      return [true, 200, { ok: true }];
    case '/api/lan-entry':
      // 桌面端局域网入口（契约 §8.2）：默认回"没开启"，可用 --lan-entry 假装开启
      return [true, 200, LAN_ENTRY];
    default:
      return [false, 400, { error: 'path not allowed' }];
  }
}

function start() {
  const state = { typed: '' };
  post({ action: 'control.ticket', role: 'desktop', bindId: BIND_ID, deskToken: DESK_TOKEN })
    .then((t) => {
      if (!t || !t.ticket) {
        console.error(`[${ts()}] ✗ 取票失败：${(t && t.message) || '无 ticket'}（bindId/deskToken 是否正确？）`);
        process.exit(1);
      }
      console.log(`[${ts()}] ✓ 已取得中继票据，连接 ${RELAY_URL}`);
      const ws = new WebSocket(RELAY_URL);
      let seq = 0;

      ws.on('open', () => {
        console.log(`[${ts()}] WS 已连接，发送首帧 auth（role=desktop）`);
        ws.send(JSON.stringify({ auth: { role: 'desktop', bindId: BIND_ID, ticket: t.ticket } }));
      });

      const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
      }, PING_MS);

      ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch (e) { return; }
        if (m.t === 'pong') return;

        if (m.t === 'auth-ok') {
          console.log(`[${ts()}] ✓ 鉴权通过  role=${m.role}  bindId=${m.bindId}  （手机侧会看到 desktopOnline=true）`);
          console.log(`[${ts()}] 等待手机指令…（Ctrl+C 退出）`);
          return;
        }
        if (m.t === 'auth-fail') {
          console.error(`[${ts()}] ✗ 鉴权失败：${m.error}`);
          clearInterval(pingTimer);
          return;
        }
        if (m.t === 'sync-wake') {
          console.log(`[${ts()}] ← sync-wake board=${m.board} count=${m.count}（真实桌面端此时会去 pull 任务）`);
          return;
        }
        if (m.t === 'api') {
          const id = m.id;
          const path = String(m.path || '');
          console.log(`[${ts()}] ← api id=${id} path=${path} body=${JSON.stringify(m.body || {})}`);
          const [ok, status, data] = handleApi(path, m.body, state);
          const payload = JSON.stringify({ t: 'api-res', id: id, ok: ok, status: status, data: data });
          if (ws.readyState === WebSocket.OPEN) ws.send(payload);
          console.log(`[${ts()}] → api-res id=${id} ok=${ok} status=${status}`);
          seq += 1;
          return;
        }
        console.log(`[${ts()}] ← (未处理) ${JSON.stringify(m)}`);
      });

      ws.on('close', () => {
        clearInterval(pingTimer);
        console.log(`[${ts()}] WS 已断开，${RECONNECT_MS}ms 后重连…`);
        setTimeout(start, RECONNECT_MS);
      });
      ws.on('error', (e) => console.error(`[${ts()}] WS 错误：${e.message}`));
    })
    .catch((e) => {
      console.error(`[${ts()}] ✗ 请求票据失败：${e.message}`);
      setTimeout(start, RECONNECT_MS);
    });
}

console.log(`[mock-desktop] bindId=${BIND_ID}`);
console.log(`[mock-desktop] lanEntry=${JSON.stringify(LAN_ENTRY)}`);
start();

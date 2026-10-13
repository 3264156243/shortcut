# tools/mock-desktop —— 假桌面桩（mock desktop）

用一个 Node 进程扮演"桌面端"，接在**真实云端中继**上。用途有两个：

1. **安卓端/移动 Web 端**在没有 Windows 桌面端的情况下，也能联调**实时控制链路**（电脑控制）；
2. **桌面侧**把它当**协议回归工具**：改完 `relay.js` / `cloud.rs` 后跑一遍，确认消息形状没变。

它严格按 [`docs/移动互联-协议契约.md`](../../docs/移动互联-协议契约.md) §7 实现，不自己发明协议。

---

## 1. 准备身份（两种方式）

| 方式 | 说明 |
|---|---|
| `bind.create` | 新建**独立测试绑定** → 返回 `bindId` + `code` + `deskToken`。**推荐**，不碰你自己的真实绑定 |
| `bind.claimToken` | 凭绑定码换 `deskToken`（会**轮换**该绑定的桌面凭证，会顶掉真桌面端，慎用） |

```bash
curl -s -X POST https://shortcut.326415.xyz/sync/api.php \
  -H 'Content-Type: application/json' \
  -d '{"action":"bind.create","deviceName":"mock-desk"}'
```

> ⚠️ **不要拿别人的真实绑定做实验**：该绑定下的真桌面端会被踢下线（中继对同一 bindId 只保留一条桌面连接）。

---

## 2. 运行

依赖 `ws`（仓库根目录已带；在别处跑请 `npm i ws`）。

```bash
# 方式 A：环境变量（推荐，token 不进命令行历史）
set SC_BIND_ID=<bindId>
set SC_DESK_TOKEN=<deskToken>
node tools/mock-desktop/relay-desktop.js

# 方式 B：显式传参
node tools/mock-desktop/relay-desktop.js --bind <bindId> --token <deskToken>
```

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SC_API_BASE` | `https://shortcut.326415.xyz/sync/api.php` | 换测试环境时用 |
| `SC_RELAY_URL` | `wss://shortcut.326415.xyz/relay-ws` | 换中继地址 |
| `SC_LAN_ENTRY` | 无（回 `{"running":false}`） | 让 `/api/lan-entry` 假装"局域网直连已开启"，用于联调一键直连 |

`SC_LAN_ENTRY` 示例（**用环境变量传，命令行传 JSON 要额外转义**）：

```
set SC_LAN_ENTRY={"running":true,"port":9823,"url":"http://192.168.1.5:9823","urls":["http://192.168.1.5:9823"],"token":"<48hex 任意值>","pairCode":"123456","authMode":"pair"}
```

启动后它自己换票、连中继、发首帧 auth，然后打印每一条手机指令：

```
[09:14:58] ✓ 鉴权通过  role=desktop  bindId=…  （手机侧会看到 desktopOnline=true）
[09:15:11] ← api id=2 path=/api/type body={"text":"你好 ShortCut"}
  └ TYPE "你好 ShortCut"
[09:15:11] → api-res id=2 ok=true status=200
```

---

## 3. 它响应哪些指令

| path | 行为 |
|---|---|
| `/api/ping` | `{ok:true, injector:true}` |
| `/api/type` | 打印文本；空 → 400 `empty`；>2000 字节 → 400 `too long` |
| `/api/key` / `/api/combo` | 打印按键 |
| `/api/mouse` / `/api/click` / `/api/wheel` | 打印动作；非法按钮 → 400 |
| `/api/clipboard/refresh` | 返回固定假剪贴板 + 历史 |
| `/api/clipboard/paste` / `clear` | 打印 / 返回 ok |
| `/api/lan-entry` | 返回 `SC_LAN_ENTRY`（默认 `{running:false}`） |
| 其它路径 | 400 `{error:'path not allowed'}`（与中继白名单一致） |

`sync-wake`（任务墙实时唤醒）只打印；真实桌面端收到后会去 `pull`。

---

## 4. 自测（回归）

桩写好后用"角色为手机"的客户端走一遍真实中继即可验证协议形状。仓库不内置该客户端脚本，
最小做法（Node）：

```js
// 取手机凭证：先 bind.create 拿 code，再 mobile.bind{code, deviceName, deviceKey}
// 然后：control.ticket(role=mobile) → WS 连中继 → 首帧 {auth:{role:'mobile',bindId,ticket}}
//       → 发 {t:'api', id, path, body} → 看 {t:'api-res', id, ok, status, data}
```

已实测通过的用例（2026-10-10，11/11）：`control.ticket` 取票、`auth-ok.desktopOnline=true`、
`/api/ping`、`/api/type`（正常 + 空文本 400）、`/api/combo`、`/api/click`（正常 + 非法 400）、
`/api/clipboard/refresh`、`/api/lan-entry`（一键直连数据齐全）、白名单外路径 400 `path not allowed`。

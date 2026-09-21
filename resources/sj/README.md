# sj — 手机控制端模块

将手机浏览器变成 Windows 电脑的远程输入面板：**缓冲打字、触控板鼠标、横屏虚拟键盘、电脑粘贴板**。  
面向**集成到其他项目**：模块内绑定可拆卸，不做内网穿透（公网由你们的云服务器/网关转发）。

---

## 功能

| 能力 | 说明 |
|------|------|
| 缓冲输入 | 手机输入区保留内容；系统键盘删除/退格会同步删电脑已同步字符 |
| 控件不收起输入法 | 退格/回车/Tab/清空/方向/快捷键不抢焦点 |
| 常用快捷键 | 复制 / 粘贴 / 全选 / 粘贴板(Win+V) / 撤回 / 任务视图 |
| 触控板抽屉 | 全屏上滑浮层；滑动/点击/滚轮/更多快捷键 |
| 虚拟键盘抽屉 | 全屏；**始终按横屏形态**绘制（竖屏时旋转铺满），与系统方向无关 |
| 电脑粘贴板抽屉 | 读取 PC 剪贴板；点条目输出到光标；「复制」到手机剪贴板 |
| 注入方式 | Windows `SendInput`（文本、按键、组合键、鼠标、滚轮） |

---

## 目录结构

```
sj/
├── server.js       # HTTP 服务 + 可拆卸鉴权 + 注入调度（可被 require）
├── inject.ps1      # PowerShell SendInput 常驻进程
├── index.html      # 手机端入口
├── css/phone.css
├── js/phone.js
├── package.json
└── README.md
```

无 npm 运行时依赖。注入依赖 **Windows + PowerShell**。

---

## 快速启动（独立）

```bash
cd sj
node server.js
```

默认 `SJ_AUTH_MODE=pair`：终端打印 **6 位绑定码**，手机与电脑同一网络打开：

```
http://<电脑局域网IP>:9823/
```

状态页（电脑浏览器）：

```
http://127.0.0.1:9823/?view=pc
```

---

## 集成到其他项目

本模块**自带的绑定码鉴权可关闭**，由父项目/网关统一做登录与转发。

### 鉴权模式 `SJ_AUTH_MODE`

| 模式 | 行为 | 适用 |
|------|------|------|
| `pair`（默认） | 模块内 6 位绑定码，签发临时 token | 单独演示、局域网直连 |
| `static` | 只认 `SJ_TOKENS` 里预置的 token | 父项目下发 token，URL `?token=` |
| `none` | 模块内不鉴权，API 直接放行 | **父项目/云服务器网关已鉴权**（推荐集成场景） |

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SJ_AUTH_MODE` | `pair` | `pair` \| `static` \| `none` |
| `SJ_TOKENS` | 空 | `static` 模式，逗号分隔多个 token |
| `PORT` / `SJ_PORT` | `9823` | 监听端口 |
| `SJ_HOST` | `0.0.0.0` | 监听地址 |
| `SJ_BASE_PATH` | 空 | 父项目反代前缀，如 `/module/sj`；API/静态资源会剥掉该前缀 |
| `SJ_STATIC_ROOT` | 模块目录 | 静态资源根目录 |

### 场景 A：云服务器网关转发（推荐，关掉模块绑定）

```bash
# 本机（被控 Windows）只监听回环或内网
set SJ_AUTH_MODE=none
set SJ_HOST=127.0.0.1
set PORT=9823
node server.js
```

由云服务器 / 父项目把 `https://your-domain/module/sj/` 反代到本机 `127.0.0.1:9823/`。

若挂载在子路径，启动时设置：

```bash
set SJ_BASE_PATH=/module/sj
```

反代示例（Nginx）：

```nginx
location /module/sj/ {
    proxy_pass http://<windows内网IP>:9823/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

父项目需自行完成：登录态、鉴权、防滥用（本模块 `none` 模式不再校验）。

### 场景 B：父项目下发 token（模块内仍校验）

```bash
set SJ_AUTH_MODE=static
set SJ_TOKENS=parent-issued-token-1,parent-issued-token-2
node server.js
```

手机打开：

```
https://your-domain/module/sj/index.html?token=parent-issued-token-1
```

或由父项目页面拿到 token 后写入 `localStorage.mkb_token`。

### 场景 C：在 Node 父进程内嵌

```js
const { createApp, loadConfig } = require('./sj/server');

const app = createApp({
  ...loadConfig(),
  authMode: 'none',
  port: 9823,
  host: '127.0.0.1',
  basePath: '/module/sj',
});
app.startInjector();
app.server.listen(9823, '127.0.0.1', () => console.log('sj ready'));
```

也可用子进程方式拉起，便于崩溃隔离：

```js
const { spawn } = require('child_process');
spawn(process.execPath, [require.resolve('./sj/server')], {
  env: { ...process.env, SJ_AUTH_MODE: 'none', PORT: '9823' },
  stdio: 'inherit',
});
```

---

## HTTP API

除标注外，请求体均为 JSON。

### 公开

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` 或 `/index.html` | 手机端页面 |
| GET | `/?view=pc` | 电脑状态页 |
| GET | `/api/config` | `{ authMode, requirePair, basePath }` |
| GET | `/api/status` | 状态（`pair` 时含绑定码） |
| POST | `/api/pair` | `{ code }` → `{ token }`（仅 `pair`） |
| POST | `/api/unbind` | 会话 token 失效（`pair`） |

### 需鉴权（`none` 模式放行；`static`/`pair` 需 `Authorization: Bearer <token>` 或 `X-Token`）

| 方法 | 路径 | Body | 说明 |
|------|------|------|------|
| POST | `/api/ping` | `{}` | 心跳 |
| POST | `/api/type` | `{ text }` | 注入文本到光标 |
| POST | `/api/key` | `{ key }` | 单键，如 `enter` `backspace` `left` |
| POST | `/api/combo` | `{ keys: ["ctrl","c"] }` | 组合键 |
| POST | `/api/mouse` | `{ dx, dy }` | 相对移动 |
| POST | `/api/click` | `{ button: "left"\|"right"\|"middle" }` | 点击 |
| POST | `/api/wheel` | `{ delta }` | 滚轮 |
| POST | `/api/clipboard/refresh` | `{}` | 读 PC 剪贴板 + 历史 |
| POST | `/api/clipboard/paste` | `{ text }` 或 `{ id }` | 输出到电脑光标 |
| POST | `/api/clipboard/clear` | `{}` | 清模块侧历史 |

`pair` 重置绑定码（仅本机回环）：`POST /api/reset-code`。

---

## 前端约定

- 手机页启动时请求 `/api/config`：
  - `pair` → 显示绑定码输入
  - `none` → 直接进入控制界面
  - `static` → 优先用 `?token=` 或 `localStorage.mkb_token`
- Token 存储键：`localStorage` 的 `mkb_token`
- 抽屉：触控板 / 键盘 / 电脑粘贴板，均为**全屏上滑**覆盖层

---

## 粘贴板说明

- 仅支持**文本**剪贴板
- 打开抽屉或点「刷新」时读取**当前** PC 剪贴板
- 历史在**进程内存**中，最多 40 条；只记录本进程读过的条目
- 不读取 Windows「Win+V」系统历史

---

## 运行环境

- 操作系统：**Windows**（注入依赖 `user32.dll` SendInput）
- Node.js：≥ 16
- PowerShell：系统自带即可
- 浏览器：手机端需较新的 Chrome / Safari / 微信内核等

---

## 安全注意

1. `SJ_AUTH_MODE=none` 时，任何能访问到该端口的人都能向电脑打字、移鼠标、读粘贴板——**务必只暴露在受控内网，或经你们的网关鉴权后再转发**。
2. 不要把绑定码或 `SJ_TOKENS` 提交到公开仓库。
3. 粘贴板内容含敏感信息时，注意手机页面是否被他人看到。
4. 本项目不含内网穿透；公网能力完全由外部云服务器/网关负责。

---

## License

私有集成用途，按你的项目规范管理。

# ShortCut 项目开发状态存档（多工具共同维护）

> **本文件是多工具/多会话共同维护的项目进度记录。**
> 切换工具或转移会话前：读取本文件 → 把当前完成项并入下方"已完成"、更新"进行中"到最新、追加未提交改动、刷新下一步顺序，然后保存。
> 再次进入时：**只读本文件即可续接**，无需回看历史会话。
> 更新时间区：每次更新时在文末追加一行「更新记录」。
> 最后更新：见文末「更新记录」最新一条。

---

## 1. 项目概况

- 桌面软件 ShortCut（Electron + React/TS + zustand），包含快捷面板、任务墙、SC球、翻译、统计、语音输入、文件快传、激活授权与移动端联动。
- 当前 `package.json` 版本：**2.4.4**（V2.4.4 已正式构建并发布到更新服务器）。
- 当前工作分支：`codex/v2-development`（所有开发提交到该分支，Gitee 远端 `https://gitee.com/wanan6/short-cut.git`）。
- 工作根目录：`D:\wenjian\js\ShortCut`。
- 服务器：`43.108.21.35`（宝塔面板，Web 站点根 `/www/wwwroot/ShortCut`），SSH 连接信息在本机 `D:\wenjian\mima\服务器连接信息.md`。连接凭据不得写入本文件或提交到 Git。
- 服务器文件上传手段：本机已装 **Posh-SSH**（PowerShell 模块，3.2.7），用 `New-SSHSession` + `Set-SCPItem` / `Invoke-SSHCommand`，密码即可连，无需公钥。示例见下方「关键命令」。

---

## 2. 构建 / 发布流程

- 开发验收（快速，改 asar + 桥脚本）：见 HANDOVER.md §"手动刷新 app.asar"步骤。
- 正式构建安装包：`npm run electron:build`（产物在 `release/`：`ShortCut-<ver>-Setup.exe`、`.blockmap`、`latest.yml`、`release-notes.json`、`*-ReleaseNotes.md`）。
- 上传更新到服务器：`npm run release:update` 或直接 Posh-SSH `Set-SCPItem` 上传上述 5 个文件到 `/www/wwwroot/ShortCut/updates/`。
- 线上更新地址：`https://shortcut.326415.xyz/updates/latest.yml`。
- 完整流程 / 常见坑见 `HANDOVER.md`（重打包前关掉 ShortCut.exe；不要用 `asar pack .`）。
- **重要**：`release/win-unpacked` 不会随源码自动更新，改完 electron 代码必须手动刷新 `app.asar`（或用 electron:build 重打包）才能验收。
- `scripts/publish-update.ps1` 用 scp（需公钥或密码，本机无公钥 → 改用 Posh-SSH）。

---

## 3. 已完成并发布的版本（git 已推送）

### V2.4.4（最新，`deaa852` release）
- **语音输入板块完整落地**：胶囊暂存识别文字（不实时写光标）、流式累加防重复（committed+currentPartial 模型）、空格/回车/ESC 键控、结构整理（合并重复/改错别字/通顺/明确列举才编号 1.2.3.）、SendInput Unicode 直输不碰剪贴板、今日/历史使用统计、拖拽+位置大小记忆、玻璃拟态样式。
- **服务端**：`voiceInput` 板块已加入 `MODULE_META` 并在管理后台用户分组权限中可勾选（config.php/index.php 已上传服务器）。
- **修复**：识别文字反复删现、双句号、多要点不编号自动编号、胶囊圆角直角阴影（drop-shadow）。
- V2.4.4 安装包 + latest.yml 已上传服务器，线上更新源验证 HTTP 200。

### 更早语音/胶囊相关（已推送，按时间倒序）
- `c352acd` 结构整理双问题（结尾仅一个句号；模型输出≥2行即强制编号）+ 服务端 config/index 上传 voiceInput。
- `5a79a7c` 统计卡片四格（今日/历史×调用/转写）+ drop-shadow 修复 + 服务端预置 voiceInput。
- `3110dc6` 语音使用统计。
- `f7ad4f0` 撤回形态状态机动画，保留拖拽+记忆。
- （更早语音输入演进：capsule refactor bc2292b → d121e6b → 22c3a4c → 2842919 → 2a2531f → ae7323a → 4c1953b → e185bd1 → e007c41 → 8624650 → f7ad4f0，详见 git log。）

---

## 4. 当前进行中的工作（★ 最新重点）

### 通用移动联动与文件快传（目标 V2.4.5）

需求与完整路线见：

- `docs/移动端联动开发计划.md`：任务墙同步第一期。
- `docs/文件快传与通用移动联动开发计划.md`：统一移动框架、文件快传、临时分享、WebRTC、SC球和权限后台的正式开发计划。

设计原则：任务墙和文件快传不是彼此独立的手机网页，而是共用 `bindId + mobileToken` 的移动联动平台。后续可继续增加剪贴板、语音、遥控与安卓壳，不要再为新功能建立另一套绑定。

#### 已完成并已推送

- 任务墙云同步闭环已经完成并实机验证：手机选择桌面已有任务墙、提交任务，桌面 `pull → 本地写入 → ack`，失败重试不会主动丢任务。
- 手机任务类型改为显式“长文本/待办提醒”开关，默认关闭；桌面按字段映射，不再因填写详情自动开启类型。
- 通用绑定支持 6 位绑定码、二维码直链和手机摄像头扫码；新手机绑定会轮换 `mobileToken`，旧手机失效。
- 统一移动入口已上线：`https://shortcut.326415.xyz/mobile/`。包含任务墙和文件快传入口。
- 原任务墙地址 `https://shortcut.326415.xyz/taskwall/` 保留兼容，并在已绑定页面顶部提供“任务墙 / 文件快传”切换入口。
- “接收共享内容”已经从移动首页移入文件快传页面；当前领取协议只完整支持文本。
- 桌面新增 `fileTransfer` 常用板块，已接入模块管理、客户端模块上报和激活后台用户组策略字段。
- 桌面与移动端完成双向文本消息、复制、轮询刷新和全端删除。
- 文件快传第二阶段已开始：桌面与移动端都有选择文件控件，服务端建立文件元数据、2 MB 分片上传和分片下载端点；文件消息显示名称、大小和下载入口。
- 云端已部署 `server/sync/{config.php,api.php,file.php}`、`server/sync/web/mobile/index.html`、`server/sync/web/taskwall/index.html`。服务器 `php -l` 三个 PHP 文件均通过，两个网页 HTTP 状态均为 200。
- 最新提交：`665ab70 feat: 接入统一移动快传框架与文件分片传输`，已推送 `origin/codex/v2-development`。

#### 当前实现边界与风险

- 当前文件传输是“基础分片上传/下载”，不是计划文档中的完整可靠传输。尚无分片哈希、完整文件 SHA-256、已上传分片查询、断点恢复、取消、失败重试、速度或预计时间。
- 桌面端文件下载暂时用 `response.arrayBuffer()` 整体读入内存；大文件会明显增加内存，正式发布前必须改成流式写文件。
- 服务端声明上限暂为 1 GB，但还没有真正读取激活后台用户组的单文件上限、空间配额、分享权限和最长分享时间。
- 桌面选择文件目前一次一个；移动端文件选择支持多个但按顺序上传。桌面拖拽、粘贴图片、图片预览、多文件队列均未实现。
- 临时密码分享当前只支持文本。共享文件领取、领取记录和共享文件下载令牌尚未实现。
- 文件下载身份目前仍依赖绑定身份；后续需要不可猜测下载令牌、短时能力凭据和更严格的桌面端身份校验。
- 过期消息、孤立分片、临时共享和云空间尚无定时清理脚本。
- WebRTC 在线发现、信令、DataChannel 和局域网失败后云端接力尚未开始。
- SC球的文件提醒、传输进度和拖入发送尚未开始。
- 尚未做真实手机 ↔ 桌面文件的完整端到端测试，不能仅凭 PHP 语法和前端构建判定可发布。
- `package.json` 仍为 `2.4.4`；V2.4.5 尚未升版本、未生成安装包、未上传更新服务器。
- 当前源码尚未同步到 `release/win-unpacked/resources/app.asar`。该文件时间仍是 `2026-08-18 20:40:43`，打开验收版看不到提交 `665ab70` 的桌面文件控件。

---

## 5. 工作区与接手入口

当前业务源码已提交。`git status --short` 仅剩此前就存在、与本轮无关的内容：

- `M resources/hardware-monitor/ShortCut.HardwareMonitor.exe`
- `?? docs/references/`
- `?? ico/`

不要擅自删除、还原或提交这些内容。它们可能是用户提供的监控程序、参考源码和图标原稿。

文件快传关键代码：

- 桌面 UI：`src/components/FileTransferPanel.tsx`
- Electron 主进程上传/下载：`electron/file-transfer.ts`
- IPC 暴露：`electron/preload.ts`、`src/store/index.ts`
- 通用绑定与任务同步：`electron/sync/`
- 服务端 JSON/文件存储：`server/sync/config.php`
- 消息和上传会话 API：`server/sync/api.php`
- 分片上传/下载：`server/sync/file.php`
- 统一移动 Web：`server/sync/web/mobile/index.html`
- 任务墙兼容入口：`server/sync/web/taskwall/index.html`
- 模块与客户端页面入口：`src/moduleRegistry.ts`、`src/App.tsx`、`src/types/index.ts`
- 激活后台策略：`server/activation/`

---

## 6. 接手后的执行顺序

1. ✅ 确认所有 `ShortCut.exe` 已从托盘退出，执行 `npx tsc -p tsconfig.electron.json` 和 `npm run build`，按 `HANDOVER.md` 刷新 `release/win-unpacked/resources/app.asar`。——**已完成（本轮 01:14 刷新）**
2. 启动 `release/win-unpacked/ShortCut.exe`，确认左侧“文件快传”入口、选择文件按钮和文件消息 UI 可见。——**冒烟已通过（进程稳定），UI 目检待人工**
3. 用真实手机访问 `/mobile/`，至少验证：桌面发小文件到手机并下载；手机发小文件到桌面并下载；删除文件消息后两端消失且服务器分片被删除。——**尚未做真实端到端文件测试**
4. ✅ 修复桌面下载整体进内存的问题，改成 Node 流式响应写入临时文件，完成后原子重命名。——**已完成，提交 `2cb2dbf`，app.asar 已刷入**
5. 完成可靠传输协议：分片哈希、完整哈希、上传状态查询、缺片续传、取消/重试、速度、预计时间与本地历史。
6. ✅ 实现共享文件弹窗（移动端）：自定义/自动 6 位密码、最长 24 小时、我的共享列表 + 删除。——**移动端已完成并部署（`c6a5bf2`），桌面端「我的共享列表/删除」尚未同步，可后续补**；共享文件下载令牌（跨绑定领取下载）尚未实现。
7. 把激活后台 `fileTransferPolicy` 真正接入同步服务端校验，并实现过期文件、孤立分片和空间配额清理。
8. 再实现多文件队列、拖拽、粘贴图片、WebRTC 和 SC球集成。
9. 全部验收后再升 V2.4.5、补 release notes、构建安装包并发布；不要提前发布当前基础分片版本。

---

## 7. 关键命令速查（Posh-SSH 连服务器）

```powershell
Import-Module Posh-SSH
$serverInfo = Get-Content 'D:\wenjian\mima\服务器连接信息.md' -Raw -Encoding UTF8
# 从本机凭据文件读取密码，不要把明文密码写入仓库。
$password = [regex]::Match($serverInfo, '密码：([^\r\n]+)').Groups[1].Value.Trim()
$pass = ConvertTo-SecureString $password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('root', $pass)
$s = New-SSHSession -ComputerName '43.108.21.35' -Port 22 -Credential $cred -AcceptKey -ConnectionTimeout 15 -ErrorAction Stop
Invoke-SSHCommand -SessionId $s.SessionId -Command '你的shell命令'
Set-SCPItem -ComputerName '43.108.21.35' -Port 22 -Credential $cred -AcceptKey -Path '本地路径' -Destination '/www/wwwroot/ShortCut/目录/' -Force
Remove-SSHSession -SessionId $s.SessionId | Out-Null
```

> 注意：`Invoke-SSHCommand` 的命令字符串**不要用双引号包含复杂正则**（PowerShell 会解析 `[^}]` 等报错），用单引号变量存命令再传参。

---

## 8. 当前目标

- 目标版本：V2.4.5。
- 当前阶段：文件快传阶段 B 的基础云端分片闭环，尚未达到发布标准。
- 当前优先事项：刷新开发验收版、完成双向文件实机测试、补可靠传输和共享文件能力。
- 不再使用此前暂停的工具内部 goal ID；以本文件和文件快传开发计划为唯一交接依据。

---

## 更新记录

- [2026-08-19] 移动端联动重构 + 共享弹窗 + 真机适配，提交 `c6a5bf2` 已推送。**URL 结构变更（重要）**：绑定抽离到新独立页 `/bind/`（含扫码/绑定显示/更换绑定）；文件快传独立页 `/transfer/`（带「共享内容」弹窗：文本/选文件共享、共享时长、自定义密码、我的共享列表、删除）；`/taskwall/` 精简为单功能仅保留返回按钮；`/mobile/` 改为重定向入口（兼容 `?bind=` 直链）。服务端扩展 `transfer.shares`(共享列表)/`transfer.shareDelete`(删除)/`transfer.share`(支持 messageId 引用文件消息)。真机适配：bind 页摄像头多重降级约束（后置→默认→纯 getUserMedia，BarcodeDetector 失败回退 jsQR），transfer 页 fileInput.click 在用户手势内触发。**部署**：线上 `server/sync/{api,config}.php` 已更新（php -l 通过），`/bind/`、`/transfer/`、`/taskwall/`、`/mobile/` 均 HTTP 200 为新版；`transfer.shares`/`transfer.shareDelete` 无效绑定冒烟返回正确。经服务器核实：站点根是 `/www/wwwroot/ShortCut`，移动站物理目录在 `{bind,transfer,taskwall,mobile}`（=URL），`server/sync/web/` 只是源码副本，**改动需同步到根下目录**（本次已 cp）。
- [2026-08-19] 刷新开发验收 `app.asar`（01:12 与 01:14 两次，含 `665ab70` 文件快传 UI + 流式下载修复），冒烟通过。修复桌面文件下载改为 Node 流式写临时文件 + Content-Length 校验 + 原子重命名，提交 `2cb2dbf`。核实服务器端 `server/sync/{api,config,file}.php` 已部署且 `php -l` 通过，`/mobile/`、`/taskwall/` HTTP 200 正常，`/sync/api.php` 405 属正常（仅 POST）。
- [2026-08-18] 文件快传第二阶段基础实现提交 `665ab70`：统一移动框架入口，任务墙页可切换文件快传，领取密码移入快传页；桌面和移动端新增文件选择，服务端新增文件元数据、2 MB 分片上传和下载端点。代码已推送，服务端已部署并通过 PHP 语法检查；开发验收 `app.asar` 尚未刷新，真实双向文件测试尚未完成。
- [2026-08-18] 建立文件快传正式计划 `docs/文件快传与通用移动联动开发计划.md`，明确统一绑定、云端中转、临时分享、WebRTC、SC球、权限和安卓壳扩展路线。
- [2026-08-18] 提交 `48f1e69`：注册 `fileTransfer` 常用板块、统一移动首页、严格移动令牌、双向文本消息、文本共享密码和激活后台策略字段；移动站已部署。
- [2026-08-18] 移动任务墙完整端到端验证通过，提交 `ae65516`、`a67cf9d`；手机能读取桌面任务墙列表并按指定墙推送，桌面可靠消费后 ack。
- [2026-08-18] 移动端绑定页新增扫码绑定：调用后置摄像头扫描桌面端二维码，支持完整绑定链接、绑定 ID 和 6 位绑定码；原生二维码识别不可用时自动使用兼容识别器，关闭/切后台/绑定成功后立即释放摄像头。已部署至线上 taskwall 页面。
- [2026-08-18] 修复语音润色确认后首字/次字偶发丢失：胶囊隐藏后轮询等待目标输入框恢复焦点，增加首字稳定延迟并降低 SendInput 速度，同时补齐 SSE 末尾缓冲解析。
- [2026-08-18] 移动任务墙改为显式“长文本/待办提醒”开关，默认均关闭；服务端同步协议保存类型字段，桌面端严格按开关映射任务类型；放大手机端“钉到桌面任务墙”按钮。线上 taskwall 页面和 sync API 已部署并通过 PHP 语法检查。
- [2026-08-18] 修复应用使用统计的长期内存增长源：历史数据不再常驻/持久化 base64 图标，启动时清理旧图标字段，图标缓存限制为 160 项。开发验收版已同步到 `release/win-unpacked`。
- [2026-08-18] 核对激活后台自动板块同步正常，服务器已保存 `voiceInput` 权限。移动任务墙联动属于任务墙子功能而非独立板块，若需单独授权应新增 `tasks.mobileSync` 功能权限。
- [2026-08-18] 创建本文档：整理 V2.4.4 发布历史 + 语音输入已完成项 + 移动端联动开发进行中状态（含未提交文件清单、服务端 code 半成品提示、下一步顺序、关键命令）。
- [2026-08-18] 移动端联动本地代码完成并审查：补齐绑定二维码、移动 Web 页、原子 JSON 写入、CORS/限流、配置刷新；消费协议升级为 pull + ack 防任务丢失。目标版本改为 V2.4.5，暂未升版本或构建正式安装包。

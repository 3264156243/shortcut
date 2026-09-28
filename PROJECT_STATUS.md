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
5. 完成可靠传输协议：分片哈希、完整哈希、上传状态查询、缺片续传、取消/重试、速度、预计时间与本地历史。——**分片 sha256 + 完整文件 SHA-256 已完成（`e363b91`，桌面/移动/服务端三端已部署）；缺片续传/取消重试/速度/本地历史尚未做**
6. ✅ 实现共享文件弹窗（移动端）：自定义/自动 6 位密码、最长 24 小时、我的共享列表 + 删除。——**移动端已完成并部署（`c6a5bf2`），桌面端「我的共享列表/删除」已同步（`06f2379`）；跨绑定领取下载令牌已完成（`dba977d`，dl_ 前缀 15 分钟过期）**。
7. 把激活后台 `fileTransferPolicy` 真正接入同步服务端校验，并实现过期文件、孤立分片和空间配额清理。——**已完成主体并部署生产验证（`513d877`）：backend retentionHours(1~720h默认24)；sync 侧 `run_cleanup_if_due` 15 分钟节流随 API 触发，清理过期消息/孤立分片/失效分享/限流旧记录，服务器 settings.json 已见实际清理（shares:3, files:2）。空间配额清理尚未做**；当前生产用户组尚无 fileTransferPolicy 字段（旧配置），后台保存一次策略即下发 retentionHours。
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

- [2026-09-29] **Tauri 2 M4 局域网控制服务 Rust 化完成**（提交 `9a58f28`）：control.rs（约 850 行）逐条对齐 resources/sj/server.js——HTTP 15 端点（config/status/pair/unbind/ping/type/key/combo/mouse/click/wheel/clipboard refresh·paste·clear/reset-code）、常驻 powershell 注入器（stdin 管道 TYPE/KEY/COMBO/MOUSE/CLICK/WHEEL + READY 握手，tokio mpsc）、VK 表、Bearer/x-token + pair 会话鉴权、剪贴板历史、静态文件服务（MIME 白名单+路径穿越防护）、/pc 状态页。桌面壳内 tokio task 直接跑，**彻底摆脱 node 运行时**（Electron 版靠 ELECTRON_RUN_AS_NODE）。集成测试 control_server_full_flow 全绿（HTTP 全链路 0.33s）。踩坑：①`#[tokio::test]` 默认单线程 runtime，同步阻塞 IO 饿死 server 任务，须 `flavor="multi_thread"`；②Windows `canonicalize` 返回 `\\?\` 前缀路径，与未规范化 root 做 starts_with 永远失败；③`State<ControlHandle>` 链式 `.0.lock()` 临时值 E0716，先绑变量再 lock。M4 剩余：云控制 WS 客户端（control-cloud.ts → tokio-tungstenite）。

- [2026-09-29] **Tauri 2 M3 透明窗家族全通过**（提交 `e6fd0dd`）：build_overlay 通用覆盖窗工厂后，任务墙（340×430）与 SC球（46×46）同模式点亮，截图验证**岛+任务墙双透明窗并存**、位置精确锚定岛右侧。Alt+U 切换任务墙（与 Electron 行为一致：存在即销毁）、SC 球随岛移动跟随。任务墙数据管道（sendTaskListData/pruneTaskList）M5 接入；翻译胶囊（Electron 版为 data:URL 动态 HTML、与翻译流程耦合）留 M5 翻译板块一起做。M3 里程碑核心目标（透明窗技术验证+主要窗口迁移）完成。

- [2026-09-29] **Tauri 2 M3 灵动岛透明窗攻坚通过**（提交 `114a351`）——**迁移最大技术风险解除**：WebView2 透明合成正常，截图验证胶囊毛玻璃渲染+背景完全透出+位置精确还原 Electron 版记忆点（673,15）。实现：windows.rs 透明窗规格照抄 Electron（无边框/置顶/无影/不聚焦/跳过任务栏 + 收起态 set_ignore_cursor_events 穿透）；island_bounds 用逻辑像素（DPI 缩放兼容 DIP 位置记忆，primary_monitor 物理尺寸须除以 scale_factor）；patch_island_config 读-改-写 config.island 节。命令 toggleIsland/getIslandState/setIsland/moveIslandTo/getIslandBounds。踩坑：①global-shortcut 插件键名是 W3C code 格式（`alt+keyi` 非 `alt+i`），match 须兼容；②窗口位置 clamp 的 min/max 写反导致坐标跑屏外（2200）；③plugin-log 必须在 setup 最先初始化否则前段日志丢失；④`tauri build --debug` 后日志在 `%LOCALAPPDATA%\com.wanan.shortcut\logs\tauri.log`。SC球/翻译胶囊/任务墙/提醒窗复用同模式（风险已解除，属体力活）。

- [2026-09-29] **Tauri 2 M2 完成**（提交 `1b86e8f`，对账 30/139）：①全局快捷键（global-shortcut 插件）——Alt+Space 壳内 toggle 主窗实测通过（可见→隐藏→恢复），Alt+I/U/S/D 以 `electron:shortcut` 事件转发前端待 M3/M5 接线，键位与 Electron 一致；②usage.rs 使用统计数据层（usage-record.json 结构/legacy icon 剥离/camelCase 序列化照抄 Electron，8 个命令），采集器 M5 接入；③clipboard-manager copyText + openFile/openFolder/showInFolder。**关键验证：主面板带配置数据完整渲染**——分组标签（通用1-4）/收藏快捷方式真实图标全部从 readConfig 桥接链路读出，前端零改动。踩坑：json! 宏不支持 `[0.0; 24]` 重复语法（改 vec!）。下一步 M3 透明窗攻坚（SC球/灵动岛/胶囊，唯一技术悬念点）。

- [2026-09-29] **Tauri 2 重构启动，M1 最小壳验收通过**（分支 `codex/tauri2-migration`，提交 `97a90a2`/`ffd9783`/`cd3407f`，计划书 `docs/TAURI2-重构计划书.md`）：①工具链从零搭建——VS Build Tools（VC++ + Win11 SDK 26100，vcvars64 环境编译）+ rustup stable 1.98.1（rsproxy 镜像 7 分钟装完，cargo 源同配 rsproxy）；注意用户机 D:\APP\visualstudio 有旧 VS 实例会被 rustc 优先探测但缺 SDK 库路径（LNK1104 msvcrt.lib），必须走 vcvars 环境。②`tauri init` 脚手架 + 图标全套生成 + electronAPI Proxy shim（Rust initialization_script 注入，任意未实现方法 invoke `electron_api` 统一分发 Null 兜底防前端崩，onXxx 回调 → emit `electron:<name>`）+ `SHIM-CHECKLIST.md`（preload.ts 全量 139 方法对账，M1-M5 施工地图）。③M2 配置层：`config.rs` 硬兼容 %APPDATA%\ShortCut（readConfig/writeConfig 原子写+3 份备份+启动损坏自愈，语义与 Electron 完全一致）+ 自启/通知/openExternal 命令。④踩坑修复：electron_api args 须 `Vec<Value>`（shim 传数组）、initialization_script 仅 builder 可用（主窗口改 Rust 创建、conf windows 留空）、`set_activation_policy` 是 macOS 专属、裸 `cargo build` debug 会指向 devUrl（须 `tauri build --debug`）。⑤**验收数据：NSIS 安装包 3.27MB（Electron 93.6MB，-96.5%）、单进程 32.5MB（Electron 5 进程 506MB）、前端 dist 零改动完整渲染（控制板块 UI 验证截图）**。下一步：M2 核心骨架（全局快捷键/统计/任务墙数据层）→ M3 透明窗攻坚。

- [2026-09-28] 发布 v2.4.5（安装包 93.6MB 已上传更新服务器，外网 latest.yml 验证通过；web 端 sync 全量同步+页面探活 200；合并 main + tag v2.4.5）：内容=控制板块新板块（云转发+局域网双模式）、文件快传分片哈希/过期清理/共享弹窗重构、移动端绑定跳转与控制引导页优化。构建坑记录：electron-builder 下载 Electron 42.5.0 被网络中断，设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重试通过；PowerShell Get-Content 默认 GBK 读 UTF-8 会显示乱码（文件本身正常，验证时须带 `-Encoding UTF8`）。
- [2026-09-28] 架构决策落档（`docs/ROADMAP-架构演进.md`）：①**桌面壳长期迁移 Electron → Tauri 2 已决策**（包体 ~200MB→3-10MB、内存基线 -50~70%、React 层 ~95% 复用；SendInput PowerShell 注入/HardwareMonitor.exe/sj node sidecar 三者与壳无关原样保留）——策略：功能闭环 → 内存摸底（app.getAppMetrics 30s 采样 + 渲染层 heap 上报 + 24h 稳态基线）→ 迁移准备（electronAPI 收敛单桥接模块）→ 一次性迁移（2-3 周窗口），映射表与步骤见 ROADMAP。②**移动推送已决策**：前台 WS relay 实时（已有）+ OPPO Push 离线兜底（用户已有 OPPO 开发者账号，未上架应用每日测试推送额度个人使用足够，场景均为通知栏消息不依赖透传）+ 白名单保活引导页增强；非 OPPO 设备回退 PWA 提醒路径。实施分 P0（PWA 兜底）→ P1（Capacitor 壳 + APK 自分发）→ P2（OPPO Push：Capacitor 插件桥接 OPush SDK + PHP push 网关，regId 挂 bind 体系）→ P3（保活引导）。

- [2026-09-28] 内存采样监控上线（`5384969`，仅验收包运行攒数据，**不构建推送新版本**——等基线数据攒齐后再开重构分支，用户已确认）：新增 `electron/memory-monitor.ts`——30s 采样 `app.getAppMetrics()` 按进程类型（Browser/GPU/Tab/Utility）聚合 working set，同时向所有存活 WebContents 取 `performance.memory`（2s 超时防挂死、采样防重入），JSONL 追加写 `userData/logs/memory.log`（超 5MB 轮转）。**首条基线快照（2026-09-28）**：总计 ~506MB/5 进程——Browser 119MB、GPU 131MB（透明窗口特效渲染）、Utility 54MB、Tab×2 213MB；JS heap 仅 ~19MB（主窗口 9.5MB + 灵动岛 9.5MB）——**JS 层无泄漏堆积，内存大头是 Chromium 进程基线 + GPU 渲染**，印证 Tauri 2 迁移决策（WebView2 共享系统进程 + 更轻 GPU 开销）。下一步：攒 24h 稳态曲线 → 开重构分支迁 Tauri 2。

- [2026-09-22] 架构决策落档（`docs/ROADMAP-架构演进.md`）：①**桌面壳长期迁移 Electron → Tauri 2 已决策**（包体 ~200MB→3-10MB、内存基线 -50~70%、React 层 ~95% 复用；SendInput PowerShell 注入/HardwareMonitor.exe/sj node sidecar 三者与壳无关原样保留）——策略：功能闭环 → 内存摸底（app.getAppMetrics 30s 采样 + 渲染层 heap 上报 + 24h 稳态基线）→ 迁移准备（electronAPI 收敛单桥接模块）→ 一次性迁移（2-3 周窗口），映射表与步骤见 ROADMAP。②**移动推送已决策**：前台 WS relay 实时（已有）+ OPPO Push 离线兜底（用户已有 OPPO 开发者账号，未上架应用每日测试推送额度个人使用足够，场景均为通知栏消息不依赖透传）+ 白名单保活引导页增强；非 OPPO 设备回退 PWA 提醒路径。实施分 P0（PWA 兜底）→ P1（Capacitor 壳 + APK 自分发）→ P2（OPPO Push：Capacitor 插件桥接 OPush SDK + PHP push 网关，regId 挂 bind 体系）→ P3（保活引导）。

- [2026-09-21] 控制板块第三轮修复（`a135c49`，云端已部署+桌面验收包已刷新）：①**云端输入无反应根因收窄**——用假桌面（systemd 临时服务）+假手机（node）+外网 CDN 实测三段全通：relay→桌面转发 ✓、CDN WS 数据帧（外网→CDN→回源→relay→桌面→回包）✓、鉴权/ticket ✓，服务端完全排除；结论为手机端半死连接（CDN/移动网络静默断开，手机端 onclose 迟迟不触发，指令发进黑洞而 UI 仍显示已连接）——中继日志佐证：手机 auth 后 2 分钟内零 fwd 转发、两次 close 间隔不规律。修复：手机页 60s 未收到中继任何消息判定半死连接主动断开重连 + 指令失败 toast（鼠标类高频除外）+ 状态条显示"已连接桌面·已发N"现场诊断。②bind 页删『继续使用功能』按钮，绑定成功（含扫码直链）900ms 自动跳 /mobile/。③快捷键焦点修正（keepKeyboardOpen）：仅当焦点本在输入区（键盘弹出中）才重新 focus 保持键盘，非输入状态点击快捷键不再拉起键盘——云版与局域网版 sj 同步修复。④/control/ 引导页：云端连接为唯一主入口，局域网直连折叠（用户反馈地址输入框造成困惑，云端本就无需输码——绑定身份自动配对）。⑤桌面控制板块云模式状态卡新增二维码（扫了直达 control/app/）。测试绑定/假桌面服务已清理。

- [2026-09-21] 控制板块第二轮反馈修复（`aa68139`，云端已部署+桌面验收包已刷新）：①局域网模式已通（防火墙修复生效）。②云端"连接成功但输入无反应"排查中——已排除：桌面进程内注入完全正常（ELECTRON_RUN_AS_NODE 模拟 require sj createApp+startInjector，injector.ready=true、PowerShell spawn 正常）、指令路径白名单、id 匹配；已加双端诊断日志待用户复测定位：relay 侧 journalctl 看指令转发统计（fwd bind=… api=N res=M last=path，10 秒汇总防刷屏）与连接关闭记录，桌面侧 `userData/logs/control-cloud.log` 看 auth-ok/api 收发/注入结果/socket 错误。注意：ShortCut.exe 的 ELECTRON_RUN_AS_NODE 模式 stdout 会丢失（GUI 子系统），诊断输出必须走文件。③绑定后跳转修正：bind 页"继续使用"默认从 /taskwall/ 改为 /mobile/（用户要求绑定完回 Hub）。

- [2026-09-21] 控制板块双问题修复（`7eb95f8`，云端已部署）：①**手机云控制页误报"桌面端未启动"**——根因是 relay 对 mobile 先发 `desktop-status(online:true)` 再发 `auth-ok`（原不带 online 字段），phone.js 在 auth-ok 处理里用 `!!msg.desktopOnline` 把已收到的在线状态覆盖回 false；修复为 relay auth-ok 携带 `desktopOnline` 字段 + phone.js 仅在字段为布尔时才更新（服务器端到端验证 PASS：DESKTOP auth-ok → MOBILE 收 desktop-status:true + auth-ok.desktopOnline:true）。中继日志还证实断连后桌面会自动重连（10:07 与 10:09 两次 auth），属 CDN/网络偶发抖动，重连机制正常。②**局域网手机打不开页面**——根因是 Windows 防火墙：网络配置文件为 Public 且 ShortCut/9823 无任何入站规则，已添加防火墙入站放行规则「ShortCut Control (TCP 9823-9830)」（All profiles Allow）；sj 服务本身正常（0.0.0.0:9823 监听确认）。

- [2026-09-21] 修复桌面验收包控制板块"启用失败"（非代码 bug，构建流程坑）：`tsc --noEmit` 只做类型检查不产出 JS，此前两轮改动后 `dist-electron` 一直是 8/19 旧产物（control-service.js/control-cloud.js 缺失、main.js 无 control IPC handler、preload 无 startControl 等方法），点启动必然落空。修复：`npx tsc -p tsconfig.electron.json` 真编译 → 重刷 app.asar → 验证通过。HANDOVER.md §4.2 已补"前置编译必做"说明（渲染层 `npm run build` + 主进程 `npx tsc -p tsconfig.electron.json` 不带 --noEmit；extraResources 改动需同步到 win-unpacked\resources\）。另确认 win-unpacked 的 app.asar 内 node_modules 已含 ws 依赖（asar list 验证），Windows 排除端口范围不含 9823-9830，ELECTRON_RUN_AS_NODE 手动拉起 sj server.js 正常（pairCode/injector:true）。
- [2026-09-21] **控制板块新增云端转发模式——云转发+局域网双通道可选**（`4850740`，云端已部署常驻，桌面端待重新打包）：手机控制电脑不再依赖同一局域网。①**云端 WS 中继** `server/control-relay/relay.js`（Node+ws，systemd 服务 `shortcut-control-relay` 常驻，服务器 node16 兼容 glibc 2.17——nvm v20 因 GLIBC_2.25 无法运行）：按 bindId 配对转发手机⇄桌面指令，白名单路径（type/key/combo/mouse/click/wheel/clipboard）、HMAC-SHA256 票据鉴权（10 分钟时效，密钥 PHP 首次运行自动生成落盘 `sync/data/control-relay-secret.txt`）、心跳保活、桌面上下线通知、每 bindId 连接数限制；nginx `location ^~ /relay-ws` 反代 127.0.0.1:9840（注意：**实际生效 vhost 是 `shortcut-updates.conf`**，域名 80 端口被它先加载抢占，HTTPS 走 CDN 回源 80；`shortcut.326415.xyz.conf` 被 nginx conflicting 警告忽略）。②**鉴权**：`sync/api.php` 新增 `control.ticket`——手机凭 mobileToken、桌面凭 bindCode 换取票据。③**桌面端** `electron/control-cloud.ts`：主进程 WS 客户端连接 `wss://shortcut.326415.xyz/relay-ws`，require sj `createApp()` 进程内注入（**不监听端口**），断线自动重连（重取票据），与局域网 spawn 模式互斥；`resources/sj/server.js` 的 `_internal` 扩展导出 sendCombo/sendMouse/sendClick/sendWheel/refreshClipboard/pasteClipboardText/clearClipHistory；新增 IPC `control:cloudStart/cloudStop/cloudStatus`。④**控制板块 UI** ControlPanel 重构：未运行时显示模式选择卡片（云端连接·推荐·任何网络可用·延迟 30~80ms / 局域网直连·同网更快·延迟 5~15ms），云模式状态（通道/注入器/手机接入）与局域网模式（绑定码/地址/二维码）分卡展示。⑤**手机端**：云控制页 `control/app/`（复用 sj 手机页交互，传输层从 HTTP 替换为 WS 中继，ShortCut 绑定身份自动配对无需输码）；`/control/` 引导页改为绑定态检测+双入口（云端连接/局域网直连）。**验证**：服务器内端到端（bind.create→桌面 ticket→WS auth-ok；mobile.bind→手机 ticket→desktop-status；伪造 ticket 被拒 auth-fail）；外部 wss 握手+鉴权拒绝路径通过；四页 HTTP 200；tsc 双端零错误、vite build 通过、node --check 三脚本通过、PHP 语法通过。测试绑定数据已清理。
- [2026-09-02] **新增控制板块——手机远程控制电脑**（`86eaa4b`，桌面端待打包，Web 已部署）：集成自研 sj 模块（打字/触控板/虚拟键盘/电脑粘贴板，SendInput 注入，pair 绑定码鉴权）。桌面端：`resources/sj/` 随包分发（extraResources）；`electron/control-service.ts` 管理服务子进程（ELECTRON_RUN_AS_NODE 拉起 server.js，端口 9823-9830 自动探测空闲）；IPC `control:start/stop/restart/status/resetCode`；新增「控制」板块 ControlPanel（服务开关/注入状态/绑定码复制+重置/局域网地址/扫码接入二维码/安全提示）；管理后台 MODULE_META 加「手机控制」（默认免费）。Web 端：新增 `/control/` 引导页（同网说明、地址输入记忆跳转、扫码提示）；移动 Hub 加「电脑控制」入口卡片。链路：手机与电脑同一网络 → 桌面「控制」启动 → 手机扫桌面二维码或经 /control/ 输入地址 → 输入 6 位绑定码 → 手机变电脑输入面板。sj 本机冒烟通过（pair 模式 injector ready、页面/静态全 200）；tsc 双端零错误、vite build 通过；PHP 语法通过、线上 HTTP 200。
- [2026-09-02] 移动联动 Hub 删除底部未绑定提示条（`939c62d`，已部署）：未绑定时顶部"去绑定"绑定条与尾部"尚未绑定……前往绑定"提示重复，只保留顶部唯一绑定入口（去绑定/管理均跳 `/bind/`）；同步清理 `unboundTip` JS 逻辑与 `.unbound-tip`/`.hidden` 废弃 CSS。页面结构：顶部绑定条 + 任务墙/文件共享两入口。HTTP 200、md5 一致。
- [2026-09-02] 移动联动 Hub 去掉冗余"验证绑定"入口卡片（`3fadabb`，已部署）：顶部绑定信息条已承担绑定跳转（未绑定"去绑定"、已绑定"管理"，点击均跳 `/bind/`），第三个"验证绑定"卡片完全冗余，从 HTML 删除（连同 JS 中已绑定时移除卡片的兼容逻辑）；页面仅保留任务墙、文件共享两个功能入口，未绑定提示与顶部绑定条保留。HTTP 200、md5 一致。
- [2026-09-02] 介绍网站每次进入/刷新强制定位顶部（`f03759b`，已部署）：根因是浏览器默认 `scrollRestoration=auto` 刷新时恢复上次滚动位置（上次停在下载区）。修复：设 `history.scrollRestoration='manual'`，并在 DOMContentLoaded 与 load 时 `scrollTo(0,0)` 双保险。HTTP 200、md5 一致。
- [2026-09-02] 介绍网站时间线控件移除主干线（`08d511d`，已部署）：删除 `.tl-track::before` 贯穿竖线，仅保留可点击节点列表（圆点 `.nd` + 版本号 `.ver`），交互不变。HTTP 200、md5 一致。
- [2026-09-02] 介绍网站更新日志重构为**整体时间线控件**（`ff41e75`，已部署）：自包含 `.tl-widget` 组件——主干线由 `.tl-track` 容器 `::before` 一次性绘制贯穿全部节点，节点 `.tl-node`（`.nd` 圆点 + `.tx` 文本，统一 min-height）排列在线上；彻底移除旧逐行拼接实现（`tl-item`/`tl-dot`/`tl-info`/`tl-rail`/`tl-scroll` 全部清零），结构自包含、圆点严格对齐主干线。HTTP 200、md5 一致。
- [2026-09-02] 介绍网站更新日志改**标准时间线控件**（`bdf590d`，已部署）：每个版本节点用独立 `.tl-dot` 圆点列 + 主干线 `.tl-item::before` 贯穿 + 右侧 `.tl-info` 版本信息；JS 渲染为标准 dot/info 结构，圆点严格对齐主干线，不再出现字符拼接导致的错位/破碎。HTTP 200、md5 一致。
- [2026-09-02] 介绍网站更新日志时间线样式修正（`ffe48e6`，已部署）：时间线从"每段断开"改为**一条连续竖线贯穿所有节点**——用 `.tl-scroll::before` 画一条贯通全列实线（圆点中心对齐），版本节点圆点盖在线上；删除标题下方描述文案与空 hint 元素（JS 中 `changelogHint` 引用同步清理）。HTTP 200、md5 一致。
- [2026-09-02] 介绍网站更新记录改**竖向时间线**（`24820b4`，已部署）：左侧竖线列表集成版本节点（ShortCut x.x.x，最新在上带"最新"标签，节点过多时侧栏内部上下滚动，选中节点自动 scrollIntoView 到可视）；右侧固定 520px 高滚动展示框（长更新内容框内上下滑动，滚动条统一样式——WebKit scrollbar 定制 + Firefox scrollbar-width/color）；同时**删除常见问题板块**（含导航链接）并清理废弃的教程/路线图/卡片 CSS。标签全平衡、HTTP 200、无残留。
- [2026-09-02] 介绍网站再重构（`1e6fb2c`，已部署）：**修复 latest.yml 版本解析**——旧正则只匹配行首 `url:`，而实际 yaml 中 url 带缩进（`  - url:`），导致首屏"当前版本"与下载按钮版本一直显示默认值不更新；新版按行解析处理缩进，实测读出 2.4.4 并正确链接。其他改动：首屏删「访问仓库」按钮；删除**使用教程、后续规划、预留位置、仓库地址**四个板块；下载区删「查看更新内容」按钮、蓝奏云改「推荐」并升级为**点击弹窗**（显示密码 9akr，含"复制密码/已复制"按钮与"我已复制，前往下载"按钮，支持 navigator.clipboard 与 execCommand 兜底）；**更新记录改为横向时间线**——上方各节点为版本（最新置顶带"最新"标签），点击节点下方面板切换显示该版更新内容，数据仍来自 `/updates/release-notes.json` 全自动。标签全部校验平衡，页面 HTTP 200 且无残留旧板块。
- [2026-09-02] 介绍网站三大升级（`ae98f03`，已部署服务器根 index.html，md5 一致 + HTTP 200）：①**更新日志时间线自动化**——读取 `/updates/release-notes.json`（每次构建自动生成全量版本）动态渲染时间线，未来发布新版本网站自动长出新条目，零手动改码；②**下载板块**——自动拉取 `/updates/latest.yml` 动态指向最新版安装包（按钮与首屏版本号自动更新），另新增**蓝奏云下载**入口（https://wwbac.lanzoue.com/ijE7j45ylf5a，访问密码 9akr）；③**新增「移动联动」板块**（核心板块四，含文档截图占位）——web 桌面联动门户入口 `shortcut.326415.xyz/mobile/` 与文件快传页按钮，说明扫码/6 位绑定码绑定、任务墙互通、文件快传、临时共享能力。截图占位按用户要求保持不动。
- [2026-09-01] 分片上传 SHA-256 哈希完整性（`e363b91`，已推送 + 部署）：桌面端 Electron（`createHash('sha256')`）与移动端 transfer 页（Web Crypto）对每个分片计算 sha256 随 `chunkHash` 上报；服务端 `verify_chunk_hash` 校验（未上报向后兼容跳过，非法 64 位 hex 拒绝）；`transfer.fileComplete` 拼接全部分片计算完整文件 SHA-256 存 meta 并返回，download 两分支响应头 `X-Checksum-Sha256` 供下载后校验。已部署 `sync/{config,api,file}.php` + `{bind,transfer}/index.html`（md5 与本地一致，php -l 通过，HTTP 冒烟 200）。
- [2026-09-01] 阶段A剩余——过期清理机制（`513d877`）部署并生产验证：服务器 settings.json 显示清理已实际触发（lastCleanupStats：shares:3, files:2，即删除 3 条过期分享 + 2 个孤立分片）。管理后台 fileTransferPolicy 新增「消息保留小时」retentionHours（1~720h 默认 24，`normalize_transfer_policy` 归一化已实测 99/5 正确），用户组保存策略后写入 activation_config.json 供 sync 侧 `sync_retention_hours` 读取。注：当前生产各用户组配置尚无 fileTransferPolicy 字段（旧配置），实际生效为默认 24h，后台保存一次策略即下发。
- [2026-08-19] transfer 页完整重写（`0f52397`）：共享内容重构为独立弹窗（overlay 全屏遮罩 + sheet 底部抽屉），内含三区块（创建共享：文本/文件上传/时长/密码 + 领取共享：输密码下载/复制 + 我的共享历史：列表/删除）。主页面仅文件互传（composer+消息列表+工具栏"共享内容"按钮），不混入任何共享表单。JS 全部引用匹配 DOM，脚本不再崩溃。所有返回按钮指向 `/mobile/`。
- [2026-08-19] 跳转页修复（`72b79fc`）：已绑定时移除"验证绑定"卡片+隐藏"尚未绑定"提示（顶部已有管理入口）；补 `.hidden` 样式。
- [2026-08-19] 移动端四页结构（`614eedb`）+ 文件共享弹窗（`2741909`）已部署并验证。
- [2026-08-19] 跨绑定下载令牌（`dba977d`）、桌面共享列表（`06f2379`）、验收版刷新（`37c7ed1`）已部署。

- [2026-08-19] 移动端重构为四页结构，提交 `614eedb` 已推送并部署到服务器：`/mobile/` = 跳转Hub（提供任务墙 / 文件共享 / 验证绑定三入口卡片 + 绑定状态条）；`/bind/` = 验证绑定页；`/taskwall/` = 任务墙页；`/transfer/` = 文件共享页。**三板块左上角返回按钮均跳转 `/mobile/`（Hub）**。修正 transfer 共享弹窗：共享文件改为**上传按钮**（选本地文件→分片上传→fileComplete→按 fileId 建共享），不再"选已有消息"。线上四页面 HTTP 200 已确认更新。
- [2026-08-19] 桌面端文件快传新增「我的共享」列表与删除（`fileTransfer:shareList`/`shareDelete`），与移动端共享弹窗闭环，提交 `06f2379` 已推送，验收版已刷新。**目标（移动端联动重构）4 点全部达成并部署**：绑定抽离独立 `/bind/`、任务墙精简仅返回按钮、文件快传独立 `/transfer/` 带共享弹窗、响应式完善、摄像头/上传适配；服务端 `transfer.shares`/`shareDelete`/`share`(messageId 引用文件)。遗留高级项（非本轮目标）：共享文件**跨绑定下载令牌**、桌面端「我的共享列表」已补但共享文件下载领取界面可再完善。
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


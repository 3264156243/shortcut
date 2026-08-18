# ShortCut 项目开发状态存档（多工具共同维护）

> **本文件是多工具/多会话共同维护的项目进度记录。**
> 切换工具或转移会话前：读取本文件 → 把当前完成项并入下方"已完成"、更新"进行中"到最新、追加未提交改动、刷新下一步顺序，然后保存。
> 再次进入时：**只读本文件即可续接**，无需回看历史会话。
> 更新时间区：每次更新时在文末追加一行「更新记录」。
> 最后更新：见文末「更新记录」最新一条。

---

## 1. 项目概况

- 桌面软件 ShortCut（Electron + React/TS + zustand），实时快捷面板 + 任务墙 + SC球 + 翻译 + 语音输入 + 激活授权。
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

### 移动端联动 · 任务墙云同步（第一期）
> 需求确认完毕（见 `docs/移动端联动开发计划.md`，内容已定稿）。底层原则：**通用云同步通道**（服务端 sync API + 客户端 sync-engine），任务墙为第一接入板块，后续语音/剪贴板/笔记/遥控复用。

**已确认需求**：6位绑定码+二维码（绑定通用模块、固定永久、设置中展示）；手机可选墙（墙名匹配/不存在新建）；启动拉取+系统通知（仅提示不跳转）；字段=标题+可选详情+可选提醒时间；接收成功即删除；服务端 **JSON+flock**；Web 页 `https://shortcut.326415.xyz/taskwall/` 独立响应式；任务墙为第一个接入板块。目标发布版本为 **V2.4.5**，当前未升版本、未构建正式安装包。

#### 已完成代码（尚未提交）：
- **服务端同步通道**：`server/sync/config.php` 使用独立锁文件 + flock 串行化，JSON 通过临时文件完整写入后原子替换；损坏 JSON 会拒绝覆盖。绑定创建、任务入队、限流均在单把锁内完成。
- **可靠消费协议**：`pull` 只读取，桌面成功写入后再调用 `ack` 按任务 ID 删除；本地失败时云端保留，ack 失败时下次按任务 ID 去重。
- **服务端 API**：已实现 `bind.create` / `bind.info` / `bind.query` / `bind.resolve` / `push` / `pull` / `ack` / `board.list`，包含 CORS、超时友好错误、字段长度校验、任务 ID 校验和轻量 IP 限流。
- **桌面绑定**：绑定 ID、6 位绑定码、绑定直链一并持久化到 `config.json → sync`；已有绑定可从云端补回绑定码，不重复创建。
- **同步引擎**：消费者注册、启动拉取、手动拉取、写入成功确认、重复任务去重。
- **任务墙接入**：按墙名匹配或新建，映射标题/详情/提醒时间，随机生成纸条布局；写入后发送 `config:changed` 刷新渲染层，并弹系统通知。
- **设置绑定卡片**：显示绑定码、二维码、绑定地址、复制、刷新、立即接收与错误提示。
- **移动 Web 页**：`server/sync/web/taskwall/index.html`，支持 6 位码、二维码直链、本地记忆绑定、标题/详情/提醒/墙名、请求超时和便签/胶带响应式样式。
- **验证**：`npx tsc -p tsconfig.electron.json --noEmit`、`npm run build`、`git diff --check` 均通过。

#### 尚未完成：
- **服务器部署与 PHP 语法检查**：上传 `server/sync/api.php`、`config.php` 到 `/www/wwwroot/ShortCut/sync/`，上传 Web 页到 `/www/wwwroot/ShortCut/taskwall/`。当前工具的远程执行权限审核异常，尚未部署。
- **端到端实机联调**：bind.create → 手机 push → 桌面 pull/write/ack → 任务墙刷新 + 通知。
- **`release/win-unpacked` 同步**：当前工具的文件覆盖执行权限审核异常，尚未刷新 app.asar。
- **提交推送**：代码审查完成后提交。

#### 本次尚未提交的语义（务必还原）：
- 服务端 config.php 改造（flock 读改写一体）——当前 `json_lock_update` 已加但未应用。
- 目录规划：`server/sync/data/{binds.json, queues/taskwall/{bindId}.json}`；`docs/移动端联动开发计划.md`（开发计划书，已定稿）；`electron/sync/`（binding/engine/init）；`src/components/BindCard.tsx`；修改 SettingsPanel / main.ts / preload.ts / store。

---

## 5. 工作区未提交改动（git status --short）

已修改（M）：
- `electron/main.ts`（加了 initSync 调用）
- `electron/preload.ts`（加 syncGetBinding）
- `src/components/SettingsPanel.tsx`（引 BindCard）
- `src/store/index.ts`（electronAPI 加 syncGetBinding）
- `resources/hardware-monitor/ShortCut.HardwareMonitor.exe`（二进制微小变化，来源待核对——可能是 electron:build 时 electron-builder 重签名/重打包导致，非业务改动，可 git checkout 还原或保留并提交）

未跟踪（??）：
- `docs/移动端联动开发计划.md`
- `docs/references/`
- `electron/sync/`（binding.ts / engine.ts / init.ts）
- `server/sync/`（config.php / api.php / data/）
- `src/components/BindCard.tsx`
- 废弃临时复现脚本已删除。
- `ico/`（来源待确认，可能是图标资源，需判断是否要保留）

> 注意：`resources/hardware-monitor/ShortCut.HardwareMonitor.exe`、`docs/references/`、`ico/` 都不是本次移动联动改动，提交时不要误带。

---

## 6. 下一步执行顺序（移动端联动开发）

1. 提交并推送本轮源码，不带无关二进制和参考资料。
2. 权限恢复后部署 `/sync/` 与 `/taskwall/`，在服务器运行 `php -l`。
3. 端到端联调 bind.create → push → pull → 本地写入 → ack，并验证 ack 失败重试不会重复任务。
4. 同步开发构建到 `release/win-unpacked` 供用户验收。
5. 用户确认后再将版本升至 V2.4.5、写 release notes、构建正式安装包并发布。

---

## 7. 关键命令速查（Posh-SSH 连服务器）

```powershell
Import-Module Posh-SSH
$serverInfo = Get-Content 'D:\wenjian\mima\服务器连接信息.md' -Raw
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

## 8. 当前目标（活动 goal）

- goal id：`goal-1512116a-0b9f-4bda-8d6b-38e1803d8c08`，当前已 **pause（暂停）**，revision=2。
- objective：完成移动端与桌面端通用云同步通道的第一期开发（绑定码/二维码、Web 提交页、JSON+flock 队列、桌面启动拉取入墙+通知、部署联调）。
- 恢复时：`update_goal` action=resume。

---

## 更新记录

- [2026-08-18] 移动端绑定页新增扫码绑定：调用后置摄像头扫描桌面端二维码，支持完整绑定链接、绑定 ID 和 6 位绑定码；原生二维码识别不可用时自动使用兼容识别器，关闭/切后台/绑定成功后立即释放摄像头。已部署至线上 taskwall 页面。
- [2026-08-18] 修复语音润色确认后首字/次字偶发丢失：胶囊隐藏后轮询等待目标输入框恢复焦点，增加首字稳定延迟并降低 SendInput 速度，同时补齐 SSE 末尾缓冲解析。
- [2026-08-18] 移动任务墙改为显式“长文本/待办提醒”开关，默认均关闭；服务端同步协议保存类型字段，桌面端严格按开关映射任务类型；放大手机端“钉到桌面任务墙”按钮。线上 taskwall 页面和 sync API 已部署并通过 PHP 语法检查。
- [2026-08-18] 修复应用使用统计的长期内存增长源：历史数据不再常驻/持久化 base64 图标，启动时清理旧图标字段，图标缓存限制为 160 项。开发验收版已同步到 `release/win-unpacked`。
- [2026-08-18] 核对激活后台自动板块同步正常，服务器已保存 `voiceInput` 权限。移动任务墙联动属于任务墙子功能而非独立板块，若需单独授权应新增 `tasks.mobileSync` 功能权限。
- [2026-08-18] 创建本文档：整理 V2.4.4 发布历史 + 语音输入已完成项 + 移动端联动开发进行中状态（含未提交文件清单、服务端 code 半成品提示、下一步顺序、关键命令）。
- [2026-08-18] 移动端联动本地代码完成并审查：补齐绑定二维码、移动 Web 页、原子 JSON 写入、CORS/限流、配置刷新；消费协议升级为 pull + ack 防任务丢失。目标版本改为 V2.4.5，暂未升版本或构建正式安装包。

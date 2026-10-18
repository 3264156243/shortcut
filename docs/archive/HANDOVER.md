# ShortCut 项目交接文档

最后更新：2026-08-17  
当前分支：`codex/v2-development`  
当前版本：`2.4.2`（OpenCode Go 余额功能已开发，尚未发版）

## 1. 项目简介

ShortCut 是一个 Windows 桌面多功能快捷工具，基于 Electron + React + TypeScript + Vite + Zustand + Framer Motion 构建。

主要板块：

- 快捷方式：应用、文件夹、文件、网页、快捷方式组、BAT 脚本
- 任务墙：纸条式任务、长文本、待办提醒、SC球 任务提醒与任务清单
- 电脑驾驶舱：CPU / GPU / 内存占用与温度
- 翻译：`Alt+E` 划词翻译气泡 + 双语对照页面
- 应用使用记录：前台程序与浏览器网页计时统计
- SC球：置顶灵动岛，音乐、任务、驾驶舱数据、DeepSeek / OpenCode 余额
- Codex 供应商：预设多套 Codex 配置并一键切换
- 设置：激活码、更新、板块管理、快捷键等

## 2. 代码位置

项目根目录：`D:\wenjian\js\ShortCut`

```text
electron/          Electron 主进程与 preload 桥接代码
src/               React 渲染进程源码
src/components/    各板块 UI 组件
src/store/         Zustand 状态
src/island.tsx     SC球 灵动岛主界面
src/deepseekBall.tsx  余额小圆球（DeepSeek / OpenCode）
resources/         图标、硬件监控、音乐桥接、使用统计辅助程序
scripts/           构建与发布脚本
server/activation  服务器端激活码 API 与管理后台（PHP）
website/           项目介绍网站源码
deploy/            服务器 Nginx 配置、翻译代理服务
release-notes/     各版本更新说明（发布时的唯一来源）
docs/              需求、开发规划和参考资料
```

常用命令：

```powershell
npm install                 # 安装依赖
npm run dev                 # 只启动 Vite 渲染进程
npm run electron:dev        # Electron 开发环境
npm run build               # 构建前端 dist/
npx tsc -p tsconfig.electron.json   # 构建主进程 dist-electron/
npm run electron:build      # 完整构建安装包
npm run release:update      # 构建并上传更新到服务器
```

## 3. 工作区说明

### 必须保留的目录

- `src/`、`electron/`：全部源码
- `resources/`：运行时资源，其中 `hardware-monitor`、`music-bridge`、`usage-monitor` 会被打进安装包
- `scripts/`、`server/`、`website/`、`deploy/`、`docs/`：构建、服务端和文档
- `release-notes/`：每个发布版本的更新说明
- `ico/`：软件图标原图与各尺寸图标素材，用户提供，勿删

### 构建产物与验收目录

- `dist/`、`dist-electron/`：编译输出，Git 已忽略
- `release/win-unpacked/`：用户验收目录，Git 已忽略，需要手动刷新 `app.asar`
- `release/ShortCut-x.x.x-Setup.exe`：安装包
- `release/latest.yml`、`release/release-notes.json`、`release/ShortCut-*-ReleaseNotes.md`：更新元数据
- `.asar-refresh/`、`.asar-work/`：早期 asar 刷新用的临时工作目录，已忽略，可删除

### 临时或无用内容

以下目录和文件基本是测试残留，确认不需要后可删除：

```text
release-test/ ~ release-test9/
release-next/
release-2.2.0/
123.txt
deepseekball.html
island.html
reminder.html
tasklist.html
test-electron.js
test-main.js
island-shot.png
netease-*.png
references/                  # 空目录
CODEX_PLUSPLUS_DREAM_SKIN.md
rebuild-codexplusplus-dream-skin.js
```

`docs/references/` 是三个开源参考项目（CAPS、NetSpeed-Dynamic、WinIsland），只用于参考实现方式，不参与构建，可保留在本地或按需清理。

## 4. 日常开发与验收流程

用户的验收方式是直接运行 `release\win-unpacked\ShortCut.exe`，所以每次修改代码后都需要把新构建同步到这个目录。

### 4.1 修改并构建

```powershell
# 关闭正在运行的 ShortCut，避免占用文件
Get-Process ShortCut -ErrorAction SilentlyContinue | Stop-Process -Force

# 构建渲染进程和主进程
npm run build
npx tsc -p tsconfig.electron.json
```

如果改了硬件监控或音乐桥接相关资源：

```powershell
npm run hardware:build
npm run music:bridge
```

### 4.2 刷新 release/win-unpacked 的 app.asar

**前置（必做）**：先重新编译两套产物，缺一不可——`tsc --noEmit` 只做类型检查**不产出 JS**，改了主进程/electron 代码后必须真正编译：

```powershell
npm run build                      # 渲染层 → dist/
npx tsc -p tsconfig.electron.json  # 主进程+preload → dist-electron/（不加 --noEmit！）
```

> 坑：只跑 `--noEmit` 校验就刷新 asar，会导致 dist-electron 仍旧版（新 IPC/preload 全部缺失），UI 点按钮一律"启用失败"。且 `resources/sj/` 等 extraResources 改动不在 asar 里，需同步到 `release\win-unpacked\resources\` 对应目录。

不要用 `asar pack .` 打包整个项目（会把 node_modules 等全部打进去，产物会膨胀到几 GB）。正确做法是解包、替换 `dist` 和 `dist-electron`、再打包：

```powershell
npx --no-install asar extract "release\win-unpacked\resources\app.asar" "$env:TEMP\asar-src"
Remove-Item "$env:TEMP\asar-src\dist","$env:TEMP\asar-src\dist-electron" -Recurse -Force
Copy-Item "dist" "$env:TEMP\asar-src\dist" -Recurse -Force
Copy-Item "dist-electron" "$env:TEMP\asar-src\dist-electron" -Recurse -Force
npx --no-install asar pack "$env:TEMP\asar-src" "release\win-unpacked\resources\app.asar"
```

打包完成后 `app.asar` 应在 20MB 左右。启动一次 `release\win-unpacked\ShortCut.exe` 验证无报错，验收后关闭进程。

## 5. Gitee 推送

远程仓库：`https://gitee.com/wanan6/short-cut.git`

- `main`：正式发布分支
- `codex/v2-development`：当前第二版开发分支
- `feature/project-expansion`：早期功能扩展分支，已基本完成使命

日常开发在 `codex/v2-development` 上提交，发布时再合并到 `main` 并打 tag。

```powershell
git add <具体源码文件>
git commit -m "feat: 说明本次改动"
git push origin codex/v2-development
```

提交注意事项：

- 只提交源码和必要的配置，不要提交 `dist/`、`dist-electron/`、`release/`、`node_modules/`、临时目录
- 不要提交与任务无关的用户本地文件，例如 `123.txt`、`docs/references/`、`ico/`、`release-test*/`
- `resources/hardware-monitor/ShortCut.HardwareMonitor.exe` 是历史被跟踪的构建产物，重新构建后如需同步再提交
- 提交信息建议带 `feat:`、`fix:`、`chore:` 前缀

## 6. 服务器连接

SSH 连接信息（IP、端口、账号、密码）保存在本机：

```text
D:\wenjian\mima\服务器连接信息.md
```

该文件明确要求不要提交到 Git，交接文档中也不写具体密码。服务器是宝塔面板环境，站点目录：

```text
/www/wwwroot/ShortCut/
├── index.html                 # 项目介绍网站（对应本地 website/index.html）
├── updates/                   # electron-updater 更新文件
├── activation/                # 激活码 API 与管理后台（PHP）
│   └── data/                  # codes.json、devices.json、checks.json 等运行时数据
└── translation/               # 百度翻译代理服务
```

常用地址：

- 更新检查：`<你的服务器域名>/updates/latest.yml`
- 激活管理后台：`<你的服务器域名>/activation/index.php`
- 项目介绍网站：`<你的服务器域名>/`

翻译代理由 systemd 服务 `shortcut-translation.service` 运行 `translation-proxy.py`，监听 `127.0.0.1:32642`，Nginx 把 `/api/translate` 代理过去。百度翻译 APP_ID / SECRET 通过 `/etc/shortcut-translation.env` 注入，不在代码仓库里。

激活后台的管理密码定义在 `server/activation/config.php` 的 `$ADMIN_PASSWORD`。

## 7. 更新功能原理

正式安装版使用 `electron-updater`，发布源是通用 HTTP 静态目录：

```text
`<你的服务器域名>`/updates/
```

程序启动时只检查版本，发现新版本后先显示版本号和本次更新内容，用户确认后才下载，下载时展示速度和预计时间，完成后自动调用安装包更新，不需要用户卸载重装，属于“热更新”。

更新目录必须包含：

```text
latest.yml
ShortCut-x.x.x-Setup.exe
ShortCut-x.x.x-Setup.exe.blockmap
ShortCut-x.x.x-ReleaseNotes.md
release-notes.json
```

更新内容以 `release-notes/` 目录为准。`scripts/prepare-release-notes.mjs` 会在构建时校验当前版本说明，生成安装包内嵌说明、独立版本说明文件和 `release-notes.json`。用户配置保存在安装目录之外的 `userData`，更新不会丢失配置；配置写入使用临时文件 + 原子重命名，并保留最近 3 份备份。

## 8. 构建新版本并推送

```powershell
# 1. 确认在 codex/v2-development，且工作区干净
git status

# 2. 修改 package.json 版本号，例如 2.5.0
# 3. 新增 release-notes/2.5.0.md，写明更新内容

# 4. 完整构建安装包
npm run electron:build

# 5. 检查 release/ 下的产物
#    ShortCut-2.5.0-Setup.exe
#    ShortCut-2.5.0-Setup.exe.blockmap
#    latest.yml
#    ShortCut-2.5.0-ReleaseNotes.md
#    release-notes.json

# 6. 上传到服务器（需要 scp 输入服务器密码，或已配置 SSH 公钥）
npm run release:update

# 如果已经构建过，只想重新上传：
powershell -ExecutionPolicy Bypass -File scripts/publish-update.ps1 -SkipBuild

# 7. 验证
#    `<你的服务器域名>`/updates/latest.yml 显示新版本
#    在安装版中点击“检查更新”能读到新版本和更新说明
```

上传完成后提交源码到 Gitee，并把 `codex/v2-development` 合并到 `main`，按需打 tag（例如 `v2.5.0`），最后更新 Gitee Release 和介绍网站的下载地址。

## 9. 常见坑

- `release/win-unpacked` 不会随源码自动更新，必须手动刷新 `app.asar`
- 重打包前先关闭所有 `ShortCut.exe` 进程，否则文件被占用会失败
- 不要用 `asar pack .`，产物会巨大且不可用
- 更新报 `sha512 checksum mismatch` 时，先确认服务器上的 `latest.yml` 与安装包是否完整，通常重新上传即可
- `npm run electron:build` 偶发因网络下载 Electron 超时失败；不影响正式环境时可退回手动刷新 `app.asar` 的方式供验收
- 软件只允许单实例运行，重复启动会复用已有进程


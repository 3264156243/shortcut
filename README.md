# ShortCut

ShortCut 是一个**桌面 + 移动互联**的多功能效率工具：Windows 端提供快捷面板、任务墙、文件转换、电脑驾驶舱、截图翻译与常驻桌面的 **SC球（灵动岛）**；移动端通过 Web / 安卓 App 与桌面联动（任务墙、文件快传、手机远程控制电脑）。

> **当前版本 v2.5.1** · 桌面端已完成 **Electron → Tauri 2** 技术栈重构（体积 -94%、内存 -30%）

> ⚠️ **这是一个私有项目，未开源。** 仓库仅用于作者在多台设备与协作者之间同步代码。
> 使用与分发限制见 [LICENSE](./LICENSE)。本文档中的服务器地址均为占位符（`<你的服务器域名>`），
> 自建部署需替换为你自己的域名。

## 技术栈

| 部分 | 技术 |
|---|---|
| **桌面端**（主线） | **Tauri 2.12** + Rust · 前端 React 19 + TypeScript + Vite + Zustand + Tailwind CSS + Framer Motion |
| **移动 Web** | 原生 JS（`server/sync/web/**`：任务墙 / 文件共享 / 电脑控制 / 绑定） |
| **安卓端** | 原生 Kotlin + Jetpack Compose（`android/`） |
| **服务端** | PHP（同步与绑定 `server/sync/`）+ Node（实时中继 `server/control-relay/`）+ nginx |

> ℹ️ **Electron 版已于 2026-10 退役**（`electron/` 与 `electron-builder` 已从仓库移除）。
> 老用户（≤2.4.5 Electron 版）可通过应用内「检查更新」自动迁移到 Tauri 版。

## 功能特性

### 快捷方式

- 全局快捷键唤出/隐藏面板，默认 `Alt+Space`
- 支持应用、文件夹、普通文件、URL、快捷方式组和 BAT 脚本
- 支持页签与分组管理，拖拽排序和跨分组移动
- 支持按名称、路径、备注搜索
- 支持扫描并导入 Windows 已安装软件
- 支持文件图标提取与网站图标自动抓取

### 任务墙

- 纸条式任务墙，支持多个任务墙
- 长文本任务、待办提醒时间选择
- 双击任务条编辑，删除有二次确认和碎纸机动画
- 任务到时提醒 SC球 弹窗，查看跳转、确认标记完成
- 任务可添加到 SC任务清单球，完成状态与任务墙双向同步

### 翻译

- `Alt+E` 在任意程序翻译选中文字，气泡显示结果
- 翻译板块左右双语对照，支持语言选择与互换

### 应用使用记录

- 统计板块记录前台程序与浏览器网页使用时长
- 今日占比圆环、每小时活动图、应用/网站排行
- 空闲 10 分钟自动暂停，锁屏/睡眠不补记
- 支持查看历史日期和删除单日数据
- 后台常驻应用计时与忽略名单管理

### 电脑控制（移动互联）

- 手机远程操作电脑：键盘输入、触控板、常用组合键、剪贴板读写
- **云端模式**：任意网络（4G / 异地 Wi-Fi）经中继连接，扫码或一键直连
- **局域网模式**：同一 Wi-Fi 下直连 `9823` 端口，延迟最低
- 手机端实时显示云端通道 / 输入注入 / 桌面在线状态

### 移动互联

- **任务墙同步**：手机钉任务 → 电脑任务墙（桌面离线时排队，上线自动接收）
- **文件快传**：手机 ↔ 电脑互传文件与文本，支持分享与过期清理
- **身份与设备**：绑定码配对、设备列表管理、多端身份隔离
- 模块清单（`module.list`）由服务端下发，新增板块无需改动移动端

### 电脑驾驶舱

- CPU、GPU、内存占用与温度显示
- 数据缺失时显示 `?`

### SC球 灵动岛

- 独立置顶透明窗口，收起 / 迷你 / 展开三种固定状态
- 网易云音乐：封面、歌词、进度、播放控制、歌词提前半句、逐字跳动、长歌词轮播
- 播放时彩色流光线环绕、右侧柱条跳动、落球入场动画
- 任务提醒球与任务清单球
- 驾驶舱数据模块
- DeepSeek 余额模块，每分钟刷新，API Key 由用户填写
- 播放音乐时 DeepSeek 余额分离成右侧小圆球，实时跟随 SC球
- 收起状态宽度随内容自适应，播放音乐时保持固定宽度
- 设置面板按模块分区，音乐、任务、驾驶舱、DeepSeek 独立开关

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt+Space` | 显示或隐藏主面板 |
| `Alt+E` | 翻译当前选中的文字 |
| `Alt+S` | 截取整个屏幕到剪贴板 |
| `Alt+D` | 进入区域截屏模式 |
| `Alt+I` | 显示或隐藏 SC球 |
| `Alt+U` | 显示或隐藏 SC任务清单球 |
| `Alt+Z` | 音乐上一首 |
| `Alt+X` | 音乐播放或暂停 |
| `Alt+C` | 音乐下一首 |
| `长按 Space 0.5 秒` | 循环切换快捷、任务、驾驶舱、翻译、统计等板块 |
| `Z` / `X` | 上一个 / 下一个板块 |

## 激活码

- 新安装需输入有效激活码后才能使用，程序每次启动会向**你自己的服务端**核对激活码与机器码
- 服务端提供激活码管理后台（`server/activation/`），支持生成、禁用、启用、解除绑定、删除
- 管理后台地址为你自己的部署地址，形如：`https://`<你的服务器域名>`/activation/index.php`
  （部署后由你自己访问，**不在此公开**）

> 📌 激活机制依赖自建服务端。若你要编译运行本项目，需自行部署 `server/` 并把客户端里的
> 服务端地址改成你的域名 —— 见下方「服务端地址配置」。

## 环境要求

- Windows 10 / 11（64 位，桌面端）
- **Rust**（stable）+ Visual Studio C++ Build Tools（Tauri 编译需要）
- Node.js 20+ / npm
- WebView2 Runtime（Windows 11 自带）
- 安卓端：JDK 21 + Android SDK（见 `android/README.md`）

## 快速开始

```bash
npm install

# 前端热更新（浏览器调试 UI）
npm run dev

# 启动完整桌面端（Tauri，普通权限）
powershell -ExecutionPolicy Bypass -File scripts\run-app.ps1
```

> ⚠️ **必须以普通权限启动**：管理员权限会触发 Windows UIPI，导致「从资源管理器拖文件到 SC球」整体失效（症状是禁止光标 + 无任何事件）。

## 构建

```bash
# 1. 前端构建（必须先执行：frontendDist 是编译期嵌入的）
npm run build

# 2. 打包安装包（必须在 vcvars64 环境里，否则 lzma-sys 的 C 编译会失败）
& "scripts\install-local.ps1" -Build     # 构建 + 安装到本地固定目录 + 以普通权限启动
```

发布用的 NSIS 安装包需手动执行：

```bat
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set TAURI_SIGNING_PRIVATE_KEY=<密钥内容>
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密钥口令>
npx tauri build --features custom-protocol
```

产物：`src-tauri/target/release/bundle/nsis/ShortCut_<ver>_x64-setup.exe`（+ `.sig` 更新签名）

## 自动更新发布

正式安装版使用 **Tauri updater**（`tauri-plugin-updater`）检查更新：读取 `updates/latest.json`，用内置 minisign 公钥校验安装包签名。**只检查不自动装**——发现新版本时展示版本号与更新说明，由用户确认后才下载安装。用户配置保存在安装目录之外（`%APPDATA%`），覆盖升级不会丢失。

历史版本说明保留在 `release-notes/` 目录，例如 `release-notes/2.4.0.md`。

```powershell
# 1. 三处同步版本号：src-tauri/Cargo.toml、src-tauri/tauri.conf.json、package.json
# 2. 按上面「构建」章节打包（拿到 .exe 与 .sig）
# 3. 上传 .exe 与 .sig 到服务器 updates 目录
# 4. 更新 updates/latest.json（version / pub_date / url / signature=**.sig 文件全文**）
```

发布链路（详见 [docs/server/updater-deploy.md](./docs/server/updater-deploy.md)）：

```text
https://`<你的服务器域名>`/updates/
├── latest.json                       ← Tauri updater 读取（minisign 签名校验）
├── ShortCut_2.5.1_x64-setup.exe
├── ShortCut_2.5.1_x64-setup.exe.sig
├── latest.yml                         ← 兼容旧版 Electron 客户端（迁移引导）
└── android/                           ← 安卓端
    ├── latest.json                    ← 以 versionCode 判据
    └── ShortCut-x.x.x.apk
```

服务器静态目录约定为 `<站点根>`：项目介绍网站放在根目录，更新文件放在 `updates/` 子目录，
激活码管理后台放在 `activation/` 子目录。

## 服务端地址配置（自建时必读）

本仓库的客户端代码里**内置了作者自己的服务端地址**。若你要部署到自己的服务器，需要替换以下位置
（这些是**功能必需**的地址，不是文档引用）：

| 位置 | 作用 |
|---|---|
| `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` | 桌面端更新清单地址（`latest.json`） |
| `src-tauri/src/lib.rs` / `sync.rs` / `cloud.rs` / `license.rs` / `transfer.rs` | 同步、中继、激活、文件快传的接口基址 |
| `android/.../core/net/Endpoints.kt` | 安卓端所有网络地址的**唯一真源** |
| `server/sync/modules.json`、`server/control-relay/relay.js` | 服务端下发给客户端的地址 |
| `server/sync/api.php`、`server/sync/web/control/**` | 移动 Web 页面的接口地址 |

搜索 `<你的服务器域名>` 即可定位全部位置（共 30+ 处）。作者自建的实例使用该域名，**与他人无关**。

## 配置存储

用户配置写入 `%APPDATA%\ShortCut\shortcut\config.json`（Tauri 与旧 Electron 版共用同一位置，升级不丢配置）。
写入采用「临时文件 + 重命名」，每次写入前保留最近 3 份时间点备份，启动时校验完整性并从健康备份恢复。

应用日志：`%LOCALAPPDATA%\com.wanan.shortcut\logs\tauri.log`（**时间戳为 UTC，比北京时间早 8 小时**）。

## 项目结构

```text
src/              React 前端源码（多窗口入口：index / island / tasklist / deepseekball / reminder / voiceinput）
src/components/   前端 UI 组件
src/store/        Zustand 应用状态
src-tauri/        桌面壳：Tauri 2 + Rust（窗口/拖放/穿透/同步/控制/侧车）
resources/        运行时资源：图标、局域网控制静态页（sj/）、侧车（硬件监控/音乐桥/语音/用量）
public/           静态页面（翻译气泡、截图覆盖层）
server/           服务端：同步与绑定（sync/）、激活（activation/）、实时中继（control-relay/）、nginx
android/          安卓端（原生 Kotlin，独立协作者维护，见 android/README.md）
tools/            开发与联调工具（含 mock-desktop 假桌面桩）
scripts/          本地启动 / 安装 / 侧车构建脚本
docs/             全部文档 → 先看 docs/README.md 的文档地图
```

> ℹ️ **Electron 遗留**：`electron/`、`electron-builder.json5` 等已于 2026-10 移除，历史见 git。

### 文档去哪找

| 我想… | 看 |
|---|---|
| 了解项目现状 / 该读哪些文档 | [`docs/README.md`](./docs/README.md) |
| 改移动互联 / 安卓端接口 | [`docs/移动互联-协议契约.md`](./docs/移动互联-协议契约.md)（唯一真源） |
| 参与协作（分支、提交、构建） | [`docs/协同开发规范.md`](./docs/协同开发规范.md) |
| 提问 / 要接口 / 看双方待办 | [`docs/协作交流-问答台.md`](./docs/协作交流-问答台.md) |
| 桌面端踩坑与回归（启动方式、构建顺序等） | [`docs/desktop/tauri-regression.md`](./docs/desktop/tauri-regression.md) |
| Electron 时期的资料（已归档） | [`docs/archive/`](./docs/archive/) |

## 协作开发

本仓库由两端并行开发，边界见 [docs/协同开发规范.md](./docs/协同开发规范.md)：

| 分支 | 归属 | 说明 |
|---|---|---|
| `main` | 桌面侧 | 主线（默认分支） |
| `codex/tauri2-migration` | 桌面侧 | 桌面端开发分支 |
| `feature/android-shell` | 安卓侧 | 安卓端开发分支（独立协作者维护） |

- **接口契约唯一真源**：[`docs/移动互联-协议契约.md`](./docs/移动互联-协议契约.md)（与代码冲突即为 bug）
- **提问与待办**：[`docs/协作交流-问答台.md`](./docs/协作交流-问答台.md)

## 需求文档

更完整的产品目标、功能边界和设计标准见 [docs/archive/requirements.md](./docs/archive/requirements.md) 与 [docs/desktop/灵动岛开发规划.md](./docs/desktop/灵动岛开发规划.md)。

## 许可证

**专有软件，保留所有权利（未开源）。** 详见 [LICENSE](./LICENSE)。

本项目仅用于作者自身的开发与使用。未经书面许可，不得复制、分发、用于商业用途或发布衍生作品。
所使用的第三方开源组件各自遵循其原有许可证。

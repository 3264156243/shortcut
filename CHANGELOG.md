# 更新日志

本项目从 v2.5.0 起改用「桌面端 Tauri 2 + 移动互联 + 安卓端」三线并行。
更早版本的详细说明保留在 [`release-notes/`](./release-notes/) 目录。

> 更新通道：`<你的服务器域名>/updates/latest.json`（桌面端，minisign 签名校验）
> 　　　　　`<你的服务器域名>/updates/android/latest.json`（安卓端，按 `versionCode` 判定）

---

## [2.5.1] — 2026-10-18

### 修复

- **「检查更新」永远失败**：旧实现读取 Electron 期的 `latest.yml`，且返回体缺少 `success` 字段，
  导致无论有没有新版本，前端都显示"检查更新失败"。现改为调用 Tauri 官方 updater
  （读 `latest.json`），并按前端契约返回 `available / not-available / error`。
- **更新进度条不动**：下载进度事件发出的是 `{state, received}`，而前端读的是
  `status / progress / transferred / total / bytesPerSecond`，字段名不匹配 → 进度条恒为 0。已对齐。
- `getUpdateState` 返回静态存根，现结合「已下载待安装」状态正确恢复界面。

## [2.5.0] — 2026-10-17

**Tauri 2 重构后首个正式版**，Electron 版正式退役。

### 新增

- 跨技术栈迁移通道：Electron ≤2.4.5 用户可通过应用内「检查更新」自动升级到 Tauri 版
  （`latest.yml` 指向 Tauri 安装包 + 校验 `sha512`）。
- 安卓端发布目录 `updates/android/` 与最小权限发布账号（仅 SFTP、仅写该目录）。

### 变更

- 移除 `electron/`、`electron-builder.json5`、`tsconfig.electron.json`、`electron:*` 与
  发布脚本；devDeps 移除 `electron` / `electron-builder` / `concurrently` / `wait-on`。
- 仓库整理：文档分层（`desktop/` `mobile/` `server/` `archive/`）、新增文档地图、
  参考项目改为「索引 + 阅读笔记」入库（克隆不入库）、补 `.gitattributes`。
- 分发统一到 NSIS 安装包（自启/快捷方式由安装器管理）。
- SC球穿透快捷键默认值 `Ctrl+Alt+B` → **`Alt+B`**。

### 修复（发版阻塞级）

- **实例守卫误判自身**：扫描 `tasklist` 见到 `shortcut.exe` 就判"旧版在运行"，不排除自身 PID
  也不比对路径 —— 当可执行文件被命名为 `ShortCut.exe` 时会把自己认成 Electron 版，
  表现为双击无反应且不写日志。现在要求「PID ≠ 自身」且「路径 ≠ 自身路径」。
- **侧车与静态页依赖构建机绝对路径**：`sidecar.rs` / `voice.rs` 等使用
  `env!("CARGO_MANIFEST_DIR")` 作运行时路径，换台机器即失效；且 `bundle.resources`
  未包含 `hardware-monitor` / `music-bridge` / `usage-monitor`。现已改为
  `<exe目录>/_up_/resources` → `<exe目录>/resources` → 仓库（开发）三级探测，并补齐打包。

## [2.4.6] — 2026-09-30

- Tauri 2 重构版首个对外版本：内存占用 -30%，体积 -94%。
- 岛设置全面生效；音乐控制 / 截图 / 翻译 / 任务墙 / 语音胶囊全功能对齐；
  窗口状态记忆；进程清理机制。

## [2.4.5] — 2026-09-29

- 新增「控制」板块：手机远程控制电脑（云端转发 + 局域网直连双模式）、
  剪贴板读写、常用组合键、桌面状态卡二维码。
- 文件快传：哈希校验与过期清理。
- 移动端控制页加固。

## 早期版本

见 [`release-notes/`](./release-notes/)：v1.0.0 → v2.4.4 的逐版本说明。

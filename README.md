# ShortCut

ShortCut 是一个面向 Windows 的桌面快捷面板应用，用来集中管理并快速启动常用应用、文件夹、文件和网页链接。项目基于 Electron、React、TypeScript、Vite、Zustand、Framer Motion 和 Tailwind CSS 构建。

## 功能特性

- 全局快捷键唤出/隐藏面板，默认快捷键为 `Alt+Space`
- 支持添加应用、文件夹、普通文件和 URL 网页快捷方式
- 支持页签与分组管理
- 支持按名称、路径、备注搜索快捷方式
- 支持拖拽排序和跨分组移动
- 支持系统托盘常驻
- 支持暗色、浅色和跟随系统主题
- 支持导入/导出本地 JSON 配置
- 支持扫描并导入 Windows 已安装软件
- 支持文件图标提取与快捷方式图标展示

## 环境要求

- Windows
- Node.js
- npm

## 安装依赖

```bash
npm install
```

## 开发运行

仅启动 Vite 渲染进程：

```bash
npm run dev
```

启动 Electron 开发环境：

```bash
npm run electron:dev
```

## 构建

构建前端产物：

```bash
npm run build
```

构建 Windows 安装/发布包：

```bash
npm run electron:build
```

构建 Windows 解包目录：

```bash
npm run electron:build:dir
```

## 自动更新发布

正式安装版使用 `electron-updater` 检查更新。程序启动后只检查版本，不会自动下载；发现新版本时会展示版本号和本次更新内容，由用户确认后才开始下载。用户配置保存在安装目录之外，不会因为覆盖安装丢失。

每个版本都必须在 `release-notes` 目录中提供同版本说明文件，例如：

```text
release-notes/2.0.0.md
```

构建脚本会自动校验版本说明，将内容嵌入 `latest.yml`，并生成独立的版本说明文件。更新目录结构：

```text
https://shortcut.326415.xyz/updates/
├── latest.yml
├── ShortCut-x.x.x-Setup.exe
├── ShortCut-x.x.x-Setup.exe.blockmap
└── ShortCut-x.x.x-ReleaseNotes.md
```

发布步骤：

```powershell
# 1. 修改 package.json 中的版本号
# 2. 新增 release-notes/x.x.x.md
# 3. 构建并检查安装包
npm run electron:build

# 4. 用户确认后再上传服务器
npm run release:update
```

`release:update` 不保存服务器密码，会通过 Windows OpenSSH 交互式要求输入密码。发布脚本会先上传安装包、blockmap 和版本说明，最后上传 `latest.yml`，避免客户端提前读取到尚未完整上传的新版本。

Nginx 模板位于 `deploy/nginx/shortcut.326415.xyz.conf`，服务器静态目录为 `/www/wwwroot/ShortCut`，项目介绍网站放在根目录，更新文件放在 `updates` 子目录。

## 项目结构

```text
electron/        Electron 主进程与 preload 桥接代码
src/             React 渲染进程源码
src/components/  前端 UI 组件
src/store/       Zustand 应用状态
src/i18n/        多语言文本
resources/       应用图标和静态资源
```

## 配置存储

ShortCut 运行时会把用户配置写入 Electron 的 `userData` 目录。主配置文件使用 JSON 格式，并通过临时文件写入后重命名的方式降低配置损坏风险。

## 需求文档

更完整的产品目标、功能边界和设计标准见 [requirements.md](./requirements.md)。

## 许可证

本项目基于 MIT License 开源。

# ShortCut

ShortCut 是一个面向 Windows 的桌面多功能快捷工具，包含快捷方式面板、任务墙、翻译、电脑驾驶舱和常驻桌面的 SC球 灵动岛。项目基于 Electron、React、TypeScript、Vite、Zustand、Framer Motion 和 Tailwind CSS 构建。

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

- 新安装需输入有效激活码后才能使用，程序每次启动会向服务器核对激活码与机器码
- 服务器端提供激活码管理后台，支持生成、禁用、启用、解除绑定、删除
- 管理后台：[https://shortcut.326415.xyz/activation/index.php](https://shortcut.326415.xyz/activation/index.php)

## 环境要求

- Windows 10 / 11（64 位）
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

构建 Windows 解包目录：

```bash
npm run electron:build:dir
```

构建 Windows 安装包：

```bash
npm run electron:build
```

## 自动更新发布

正式安装版使用 `electron-updater` 检查更新。程序启动后只检查版本，不会自动下载；发现新版本时会展示版本号和本次更新内容，由用户确认后才开始下载。用户配置保存在安装目录之外，不会因为覆盖安装丢失。

每个版本都必须在 `release-notes` 目录中提供同版本说明文件，例如：

```text
release-notes/2.4.0.md
```

构建脚本会自动校验版本说明，将当前版本内容嵌入 `latest.yml`，为所有历史版本生成独立说明文件，并生成便于网站读取的 `release-notes.json`。更新目录结构：

```text
https://shortcut.326415.xyz/updates/
├── latest.yml
├── ShortCut-x.x.x-Setup.exe
├── ShortCut-x.x.x-Setup.exe.blockmap
├── ShortCut-x.x.x-ReleaseNotes.md
└── release-notes.json
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

服务器静态目录为 `/www/wwwroot/ShortCut`，项目介绍网站放在根目录，更新文件放在 `updates` 子目录，激活码管理后台放在 `activation` 子目录。

## 配置存储

ShortCut 运行时会把用户配置写入 Electron 的 `userData` 目录。主配置文件使用 JSON 格式，并通过临时文件写入后重命名的方式降低配置损坏风险；每次写入前保留最近 3 份时间点备份，启动时自动检查配置完整性并从健康备份恢复。

## 项目结构

```text
electron/         Electron 主进程与 preload 桥接代码
src/              React 渲染进程源码
src/components/   前端 UI 组件
src/store/        Zustand 应用状态
src/i18n/         多语言文本
resources/        应用图标和静态资源
server/activation 服务器端激活码 API 与管理后台
docs/             灵动岛开发规划与参考资料
```

## 需求文档

更完整的产品目标、功能边界和设计标准见 [requirements.md](./requirements.md) 与 [docs/灵动岛开发规划.md](./docs/灵动岛开发规划.md)。

## 许可证

本项目基于 MIT License 开源。

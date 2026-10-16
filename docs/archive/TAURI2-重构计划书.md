# ShortCut Tauri 2 重构开发计划书

> 分支：`codex/tauri2-migration`（自 88b81fe / v2.4.5 切出）
> 决策依据：`docs/ROADMAP-架构演进.md` D1 · 基线数据：Electron 后台固定底座 ~301MB（Browser 118 + GPU 130 + Utility 53），JS 层无泄漏
> 目标：迁移后后台占用 100-150MB 量级，包体 3-10MB，功能与 2.4.5 等价，前端 React 层零重写

## 一、验收标准（完成定义）

1. 全部板块在 Tauri 壳下功能等价（对照 2.4.5 回归清单逐项过）
2. 安装包 ≤ 15MB（含 WebView2 引导探测）
3. 24h 稳态内存对比报告（同口径 vs Electron 基线 506MB）
4. sidecar 三件套（sj 控制 / HardwareMonitor / PowerShell 注入）行为一致
5. 老用户升级：`%APPDATA%\ShortCut\` 配置/绑定/统计数据**零迁移**直接沿用
6. 自动更新通道可用（tauri updater）

## 二、资产盘点

### 原样保留（零改动）
| 资产 | 说明 |
|---|---|
| `src/` React 前端 + zustand | 通过 electronAPI shim 桥接，不改代码 |
| `dist/`（vite 产物） | Tauri frontendDist 直接加载 |
| `resources/sj/`（inject.ps1 + 页面静态资源） | PowerShell 注入协议（TYPE base64/READY）不变 |
| `resources/hardware-monitor/ShortCut.HardwareMonitor.exe` | sidecar 挂载 |
| `server/sync`、`server/control-relay` | 云端与壳无关 |
| `%APPDATA%\ShortCut\` 用户数据 | Rust 直接读写同一路径，升级零迁移 |

### 重写（Electron 主进程 → Rust）
| Electron 模块 | Rust 对应 | 量级 |
|---|---|---|
| main.ts（窗口/托盘/生命周期） | tauri::WebviewWindow + tray | 中 |
| 全局快捷键 / 开机自启 | tauri-plugin-global-shortcut / autostart | 小 |
| IPC 全量（preload electronAPI） | #[tauri::command] + initialization_script 注入 shim | **大（分批）** |
| control-service.ts（局域网 sj 服务） | Rust axum HTTP + WS + spawn powershell（方案 B）或 Node SEA 打包（方案 A） | 中 |
| control-cloud.ts（云端 WS 客户端） | tokio-tungstenite | 中 |
| electron-updater | tauri-plugin-updater | 小 |
| sj server 依赖 node 运行时 | 见 M4 决策 | 中 |

### 废弃
`electron/`、`dist-electron/`、`tsconfig.electron.json`、`electron-builder.json5`、preload——迁移期保留在仓库作对照，切版后删除。

## 三、关键架构决策

### D-1 桥接：Rust 注入 electronAPI shim（前端零改动）
`WebviewWindowBuilder::initialization_script()` 注入一段 JS：把 `window.electronAPI` 的每个方法实现为 `window.__TAURI__.core.invoke('cmd名', args)`，回调型 API（onXxx）映射到 `tauri::Emitter` 事件 + `listen`。**渲染层一行不改**；后续有空再收敛到显式桥接模块。

### D-2 配置路径：硬兼容
Rust 端所有持久化继续读写 `%APPDATA%\ShortCut\`（config.json、sync、logs、usage 等），不走 Tauri 默认 app_data_dir。老用户装完即用，数据无感。

### D-3 sj 控制服务（M4 时二选一）
- **方案 B（倾向）**：Rust 重写 server.js 语义（axum HTTP + WS + spawn powershell 管道，TYPE/READY 协议原样），彻底摆脱 node 运行时，体积最小
- 方案 A：Node SEA 单文件打包 server.js+ws——快但 SEA 对依赖打包有限制，且多 ~40MB

### D-4 更新通道并行
electron-updater 的 `updates/latest.yml` 保持不动（2.x 用户继续收更新）；Tauri 版走 `updates/tauri/latest.json`（tauri-plugin-updater 格式），两通道并行，全量切换后再下线 electron 通道。

### D-5 透明窗（最大技术风险，M3 首个攻坚）
SC球/灵动岛/翻译胶囊 = 透明 + 无边框 + 点击穿透 + 置顶。Tauri 2：`transparent: true` + `set_ignore_cursor_events(true)` + `always_on_top`。M3 第一天验证三者组合在 Win10/Win11 的实际表现（WebView2 透明合成 historically 有坑）。

## 四、里程碑

### M1 最小壳（1-2 天）
- [ ] 工具链：VS Build Tools (VC++ + Win11 SDK) + rustup stable + rsproxy 源
- [ ] `@tauri-apps/cli` + `tauri init`：src-tauri/、tauri.conf.json（frontendDist=../dist，窗口 1280×800）
- [ ] 图标：`tauri icon` 从 ico/抠图原图.png 生成全套
- [ ] Rust：主窗口 + 托盘（显示/主面板/设置/退出）+ electronAPI shim v1（app 版本/窗口最小化关闭隐藏/系统信息）
- [ ] `tauri build` 出 exe，主窗口渲染 dist 界面、托盘交互可用

### M2 核心骨架（2-3 天）
- [ ] 全局快捷键（默认键位表与 Electron 一致）→ emit 到前端
- [ ] 开机自启（plugin-autostart）
- [ ] 配置读写命令（读写 %APPDATA%\ShortCut\config.json，原子写 + 备份策略同 Electron）
- [ ] 使用统计记录/查询命令
- [ ] electronAPI shim 补齐主窗口面板所需命令（板块注册表/开关状态）
- [ ] 主窗口全功能：板块开关、设置、统计显示

### M3 透明窗三兄弟（2-3 天，风险攻坚）
- [ ] 透明+穿透+置顶组合验证（Win10 19045 / Win11 各一台）
- [ ] SC球、灵动岛、翻译胶囊三窗迁移
- [ ] 位置记忆（同 userData 存储路径）

### M4 控制板块（3-4 天）
- [ ] sj 服务 Rust 化（按 D-3 决策执行）
- [ ] 云控制 WS 客户端（tokio-tungstenite：auth/心跳/重连/API 转发注入）
- [ ] 局域网/云端双模式 IPC + 状态推送
- [ ] 手机端回归（双模式全链路）

### M5 全板块点亮（3-4 天）
- [ ] 快捷面板/任务墙/翻译/统计/语音输入（SSE 流）/文件快传/剪贴板/激活
- [ ] electronAPI shim 全量补齐 + 单元冒烟脚本（命令对账：preload.ts 导出 vs Rust 命令注册）
- [ ] HardwareMonitor sidecar 接入

### M6 发布（2 天）
- [ ] NSIS 安装包（tauri bundle）+ tauri updater 通道
- [ ] 24h 内存基线对比报告（memory.log 同口径）
- [ ] 回归清单全过 → 合 main，发 v3.0.0-beta（或 2.5.0-tauri）

**总估时：14-18 个工作日**

## 五、风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| WebView2 透明合成异常（黑底/闪烁） | 中 | M3 第一天验证；备选：WinUI 层透明或 SC球降级为不透明小窗 |
| WebView2 老版本渲染差异 | 低 | 启动时探 webview2 版本，低于阈值提示安装 |
| electronAPI 面（几十个命令）迁移遗漏 | 高 | M5 命令对账脚本 + 回归清单兜底 |
| sj Rust 化协议细节（stdin 管道/READY 握手） | 中 | 协议原样照抄；保留 Electron 版作对照调试 |
| crates.io 国内网络 | 高 | rsproxy 镜像（rustup/cargo 全配） |
| 迁移期 Electron 线 bug | 中 | main 冻结新功能只修致命 bug；修复摘樱桃到迁移分支 |

## 六、回归验证清单（M6 逐项打勾）

- [ ] 主面板：全部板块开关、快捷键呼出/隐藏、设置持久化
- [ ] SC球/灵动岛：拖拽、点击穿透、显示隐藏、位置记忆
- [ ] 翻译胶囊：划词/快捷键触发、流式显示
- [ ] 语音输入：Alt+H 胶囊、识别流、SendInput 输入
- [ ] 任务墙/统计/激活：数据与安装版一致
- [ ] 文件快传：桌面⇄移动双端收发、分片哈希、共享
- [ ] 控制：手机云控/局域网控全链路（打字/触控板/快捷键/剪贴板）
- [ ] 更新：检查更新→下载→安装流程
- [ ] 升级安装：2.4.5 覆装 Tauri 版，配置/绑定/统计数据零丢失
- [ ] 内存：24h 稳态对比 Electron 基线

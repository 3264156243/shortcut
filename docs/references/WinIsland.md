# WinIsland — 项目介绍与关键源码索引

> 本地路径：`references/WinIsland`（浅克隆，2026-08-02）
> 仓库地址：https://github.com/Eatgrapes/WinIsland
> 许可证：**GPL-3.0** ⚠️（强传染；ShortCut 若非 GPL 开源，**禁止复制/翻译任何代码**，仅可读源码借鉴思路）

---

## 一、项目介绍

**一句话定位**：Windows 上的完整灵动岛——半透明置顶岛，展示媒体播放信息、歌词、音频可视化，纯 Rust + Skia GPU 原生渲染，功能最完整的参考项目。

| 维度 | 内容 |
| --- | --- |
| 技术栈 | Rust + winit + DirectComposition + skia-safe（D3D12 共享 Ganesh 上下文）+ CPAL（频谱）+ windows crate（WinRT API） |
| 规模 | 183 文件 / 3.6 MB；Rust 源码 **104 文件 / 约 19,000 行**（三个项目中最大） |
| Star/Fork | 211 / 18（评估时点） |
| 活跃度 | 活跃（2026-08-01 更新），带完整 CI、release、插件系统、官网 |

**核心功能**：
- 灵动岛完整形态：紧凑态（媒体/音量/通知/时间小部件）↔ 展开态（音乐视图/控件/频谱/歌词）
- SMTC 媒体会话管理（300ms 轮询 + 会话白名单自动放行）
- 歌词三层获取链路（本地 .lrc → 网易云在线 → 回退源）
- **系统通知读取**（UserNotificationListener，完整授权状态机 + 500ms 轮询 + 应用图标解析）
- 全屏检测、毛玻璃/动态背景/弹簧动画、系统托盘、设置窗口、原生插件系统（C ABI DLL）
- 极详细的架构文档 `.agents/ARCHITECTURE.md`（强烈建议通读）

**对本项目的价值**：三个项目中**产品形态最完整**、**设计文档最详尽**的参考。GPL 限制代码复用，但架构/算法/交互设计思路全部可借鉴。

---

## 二、关键源码索引

### 1. SMTC 媒体会话（需求 4.1 参考，思路借鉴）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/core/smtc.rs` | SMTC 会话管理器主模块 | `MediaInfo` 聚合模型；`take_info_if_changed()` 变更检测；`request_seek/toggle_play/next/prev` 控制接口；`effective_duration_ms()` 时长处理；`current_lyric(delay_ms)` 带延迟的歌词定位 |
| `src/core/smtc/session.rs` | 会话筛选与白名单 | `auto_allow_new_apps()` 自动放行新音乐应用（首次运行全放行，写入 `smtc_known_apps` 配置）；`get_target_session()` 按白名单 + PlaybackType（排除 Video）+ 播放状态优先筛选；`is_music_session()` |
| `src/core/smtc/worker.rs` | 轮询工作线程 | 300ms 轮询会话属性、歌曲变更时触发歌词异步获取 + 封面下载、每 30 次轮询（~9s）刷新会话列表 |
| `src/core/smtc/properties.rs` | 会话属性读取 | 标题/歌手/缩略图/进度/时长的 WinRT 属性读取封装 |

### 2. 歌词链路（需求 4.1 参考，思路借鉴）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/core/lyrics.rs` | 歌词获取主逻辑 | 三层链路：①本地 `.lrc`（`{artist} - {title}.lrc` / `{title}.lrc`，大小写不敏感）→ ②在线源（网易云等）→ ③回退源；`query_matches_song()` 防错配匹配；`parse_lyrics()` LRC 解析 |

### 3. 系统通知（需求 4.2 参考，思路借鉴）——【已修正：WinIsland 实现了通知读取】

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/ui/compact/notification.rs` | 通知监控器（完整） | **完整授权状态机**：`GetAccessStatus()` 检查 → Unspecified 才 `RequestAccessAsync()` → 异步回调处理；500ms 轮询 `GetNotificationsAsync(Toast)` 取最新 ID、首次轮询建基线；解析 ToastGeneric 文本 + AppInfo（应用名/AUMID）**+ 应用图标**；`RemoveNotification()` 支持移除；失败 5s 重试；`stop()` 干净退出 |
| `src/ui/compact/volume.rs` | 音量变化监控 | 50ms 轮询音量 + `IMMNotificationClient` 事件通知，阈值 0.002 触发展示 1.6s |

> **修正说明**：此前评估报告称"WinIsland 未实现系统通知"——**不准确**。其 `compact/notification.rs` 实现了完整的 UserNotificationListener 读取（比 NSD 更工程化：授权状态机、图标解析、移除通知、错误重试）。注意：与 NSD 相同，它只是**读取**，不隐藏系统原通知。因 GPL 仅可借鉴思路。

### 4. 窗口与视觉（需求 3.1 / 暂留项参考）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/window/app.rs` + `app/*` | 应用主循环 | winit `WaitUntil` 调度：按动画/播放/交互/空闲状态计算下一帧 deadline；置顶强制、命中测试、自动隐藏 |
| `src/utils/mouse.rs` | 全局鼠标与全屏检测 | 光标位置、命中测试、**全屏应用检测**（需求"全屏自动隐藏"核心） |
| `src/utils/glass.rs` | 毛玻璃效果 | GDI 截屏 + Skia 模糊 + 暗色叠加 |
| `src/utils/physics.rs` | 弹簧物理动画 | 弹簧目标值 + 平滑曲线（展开/收起动画参考） |
| `src/utils/color.rs` | 自适应描边 | 从屏幕像素取色做岛边缘配色 |
| `src/utils/win32.rs` | Win32 原始 API 封装 | 置顶、窗口样式等 |
| `src/utils/autostart.rs` | 注册表自启 | 自启动实现（需求"不增加独立开机启动项"的对照组） |

### 5. 架构与工程（高价值文档）

| 文件 | 说明 |
| --- | --- |
| `.agents/ARCHITECTURE.md` | **强烈建议通读**——渲染管线、SMTC 集成、插件系统、目录职责全讲透 |
| `packaging/identity/` | Appx 身份注册脚本（Build/Install/Register-DevIdentity）——评估"带包身份后通知权限/抑制原通知"路径的参考（仅思路） |
| `src/plugin/` | 原生插件系统（C ABI + libloading） |
| `src/core/persistence.rs` | 配置存取（~/.winisland/config.toml） |

---

## 三、复用结论

- ⛔ **GPL-3.0：所有代码（含翻译版）禁止进入 ShortCut 仓库**，团队需周知
- ✅ 可自由参考：架构文档、SMTC 会话筛选策略、歌词三层链路设计、通知授权状态机、全屏检测思路、毛玻璃/弹簧动画方案
- 技术栈差异最大（Skia 原生渲染 vs Electron+C#），适合做"设计参考"而非"代码来源"

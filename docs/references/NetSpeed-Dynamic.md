# NetSpeed-Dynamic（NSD）— 项目介绍与关键源码索引

> 本地路径：`references/NetSpeed-Dynamic`（浅克隆，2026-08-02）
> 仓库地址：https://github.com/GEORGEWWWU/NetSpeed-Dynamic
> 许可证：**MIT** ✅（可直接复用代码，保留版权声明即可）

---

## 一、项目介绍

**一句话定位**：Windows 灵动岛（NSD），Tauri 2 + Vue3 架构——前端 WebView 渲染 + Rust 后端，展示网速、音乐、通知、电池等动态信息。**与 ShortCut 的 Electron + C# 原生进程架构最接近。**

| 维度 | 内容 |
| --- | --- |
| 技术栈 | Tauri 2 + Vue3 + TypeScript（前端 WebView）+ Rust（后端：SMTC / 通知 / 系统事件 / 频谱）+ 任务栏插件（NSD_Taskbar_Plugin.exe） |
| 规模 | 103 文件 / 5.2 MB（其中图片素材约 4.6 MB）；业务代码：Vue ~6,800 行 + Rust ~1,700 行 |
| Star/Fork | 245 / 21（评估时点） |
| 活跃度 | 活跃（2026-08-01 更新） |

**核心功能**：
- **网易云媒体读取与控制**：SMTC 匹配 cloudmusic/netease 会话，读取标题/歌手/播放状态/进度/总时长 + 进度补偿算法；控制播放/暂停/上下曲/进度跳转
- **系统通知读取**：UserNotificationListener 授权 + 轮询读取 Toast 通知（标题/正文/应用名/AUMID）
- 网速监控、音量/电源/电量系统事件、音频频谱
- 任务栏插件（NSD_Taskbar_Plugin.exe，WebSocket 通信）

**对本项目的价值**：**与需求 4.1（网易云）和 4.2（通知读取）贴合度最高**，MIT 许可，代码逻辑可直接翻译为 C#。

---

## 二、关键源码索引

### 1. 网易云媒体会话（需求 4.1 核心参考，MIT 可直接翻译）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src-tauri/src/music_controller.rs`（24KB，核心文件） | 网易云 SMTC 读取与控制 | ①`get_target_media_session()`：`GlobalSystemMediaTransportControlsSessionManager` 遍历会话，按 `SourceAppUserModelId` 匹配 `cloudmusic`/`netease`（也支持指定其他播放器/通用模式）②`fetch_netease_music_info()`：读标题/歌手/播放状态/进度/总时长；**进度补偿算法**——用 `LastUpdatedTime` 与当前系统时间差纠正轮询间隔的进度漂移（`diff_ms` 有效范围校验 0~86400000）③`control_system_media()`：`TryTogglePlayPauseAsync` / `TrySkipNextAsync` / `TrySkipPreviousAsync` / 进度跳转 |
| `src-tauri/src/audio_spectrum.rs` | 频谱分析 | 音频可视化（后续视觉参考） |

### 2. 系统通知（需求 4.2 参考，MIT 可直接翻译）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src-tauri/src/notification.rs`（3.5KB） | 通知读取 | `UserNotificationListener::Current()` + `RequestAccessAsync()` 授权；`GetNotificationsAsync(Toast)` 取最新通知；按 ID 递增判定新通知（首次初始化基线）；解析 `AppInfo`（应用名/AUMID）+ ToastGeneric 文本元素（首元素为标题，其余拼接为正文）；**硬编码过滤微信**（见下方注意事项） |

### 3. 系统事件（需求 4.5 / 系统占用参考）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src-tauri/src/system_events.rs` | 系统事件监控 | 800ms 轮询：音量变化（`IAudioEndpointVolume`）、电源插拔（`GetSystemPowerStatus`）、低电量阈值 20/15/10/5 触发分级事件；通过 `app.emit` 事件驱动前端——事件驱动模式参考 |

### 4. 主进程与前端

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src-tauri/src/lib.rs`（24KB） | 后端编排 | 任务栏插件 WebSocket 服务（`init_taskbar_ws_server`）、窗口边界控制（`set_window_bounds`）、岛动画（`start_island_animation`）、网速统计（`get_network_stats`） |
| `src/views/WidgetIsland.vue` | 灵动岛组件 | 前端灵动岛视图（交互/布局参考） |
| `src/views/MainPanel.vue` | 主面板 | 设置/配置面板 |
| `src/components/DynamicSet.vue` | 动态配置 | 模块开关配置 UI（对应需求 3.2 设置项） |
| `src-tauri/tauri.conf.json` | 窗口配置 | 透明/无边框/置顶窗口配置（对应 Electron 的 BrowserWindow 配置参考） |

---

## 三、注意事项与改进点

1. **通知过滤写死了微信**：`notification.rs` 中 `if title.contains("微信") || title.contains("WeChat") ... return Ok(None)`——硬编码关键字，不区分来源 App，正文含"微信"二字的通知也会被误杀。**我们实现时应改为按 AUMID 的应用黑名单/白名单配置，不照搬此逻辑。**
2. **通知是"读取"非"拦截"**：轮询式（非事件订阅），且不隐藏系统原弹窗。需求 4.2 的"隐藏原通知"仍需另行验证（TV-2）。
3. **SMTC 轮询式**：音乐进度靠轮询 + 补偿算法，实时性够用；网易云需客户端开启 SMTC（默认开启），兼容版本需实测。
4. 前端含微信图标等素材，仅作展示参考。

---

## 四、复用结论

- ✅ **MIT**，网易云 SMTC 读取/控制（含进度补偿）与通知读取逻辑**可直接翻译为 C#**，是需求 4.1/4.2 的首选参考实现
- ⚠️ 通知过滤逻辑需重设计（去硬编码）；拦截原通知能力 NSD 未覆盖
- 架构映射：Tauri Rust 后端 ≈ 你的 C# 辅助进程，Vue3 ≈ 你的 Electron 渲染进程

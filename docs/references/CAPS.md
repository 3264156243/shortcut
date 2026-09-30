# CAPS — 项目介绍与关键源码索引

> 本地路径：`references/CAPS`（浅克隆，2026-08-02）
> 仓库地址：https://github.com/ref42/CAPS
> 许可证：**MIT** ✅（可直接复用代码，保留版权声明即可）

---

## 一、项目介绍

**一句话定位**：一个常驻桌面顶部的轻量"音乐岛"，空闲时显示 CPU/内存/网速，播放时展开为封面 + 歌词 + 频谱 + 进度条 + 播放控制的音乐岛。

| 维度 | 内容 |
| --- | --- |
| 技术栈 | Rust 2024 + Dioxus Desktop（WebView 渲染）+ Rodio/CPAL（音频播放）+ RustFFT（频谱）+ sysinfo（系统状态） |
| 版本 | v1.0.12（仓库 Cargo.toml） |
| 规模 | 40 文件 / 0.75 MB；Rust 源码约 6,000 行 |
| Star/Fork | 22 / 0（评估时点） |
| 活跃度 | 活跃（2026-08-01 仍有推送，带 release 工作流） |

**核心功能**：
- 桌面顶部胶囊形态，空闲显示系统占用（CPU/内存/上下行网速）
- 播放时展开为音乐岛：专辑封面、歌词、频谱、进度条、播放/暂停/上一首/下一首
- 支持从网易云/B站/YouTube/本地文件搜索、导入、播放
- 宠物岛（Coco/Dodo 分离小窗）、液态玻璃风格、专辑主色提取配色
- 三种模式：普通模式（音乐+系统）、静默模式（纯系统状态）、安静模式（隐藏歌名歌词）

**对本项目的价值**：网易云歌词 Web API 调用 + LRC 解析 + 灵动岛窗口两态切换/顶部居中，MIT 许可可直接参考。

---

## 二、关键源码索引

### 1. 歌词模块（需求 4.1 参考）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/lyrics.rs` | 标准 LRC 解析器 | `parse_lrc()` 支持多时间戳展开、按时间排序；`current_lyric_line()` 带 +0.55s 播放偏移取当前句——**可直接翻译为 C#** |
| `src/shitease.rs` | 网易云 Web API 封装 | 搜索歌曲、取歌词；响应含 `lyric/tlyric/yrc` 字段；UA + Referer 伪装——验证了"网易云在线歌词 API"可行性 |

### 2. 窗口模块（需求 3.1 参考）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/windowing.rs` | 窗口尺寸与位置管理 | 折叠/展开两态尺寸常量（380×56 ↔ 460×490）、`set_always_on_top(true)`、`place_top_center()` 按当前/主显示器逻辑坐标居中、缩放 clamp(0.85,1.50)、边缘出血 18px——**最贴近需求 3.1 的窗口行为** |
| `src/main.rs` | Dioxus 应用入口（64KB） | `desktop_config()` 窗口透明/无边框配置；`App()` 折叠/展开状态机；`schedule_window_collapse()` 自动收起调度 |

### 3. 音乐播放（仅思路参考，不可直接套用）

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/audio.rs` | Rodio 自播音频 | `AudioCommand` 枚举（LoadFile/PlayPause/Seek/SetVolume/Stop）+ 独立音频线程 + `AudioState`——命令模式可借鉴，但它是**自己播放文件**，不是控制网易云客户端（与我们 SMTC 路线互补而非替代） |
| `src/actions.rs` | 播放动作编排 | `spawn_play()` 加载曲目→播放→同步加载歌词的异步链路；`spawn_search()` 多源搜索 |

### 4. 视觉与系统状态

| 文件 | 说明 | 参考要点 |
| --- | --- | --- |
| `src/album_color.rs` | 专辑主色提取 | 从封面提取主色用于岛配色（需求"专辑图配色联动"暂留项参考） |
| `src/audio_spectrum.rs` | 频谱渲染 | CPAL 采集 + RustFFT 6 频段 |
| `src/app.css` | 样式（43KB） | 液态玻璃（liquid glass）CSS 参考 |
| `src/mode.rs` | 三种模式枚举 | 模式切换设计 |

### 5. 数据与基础设施

| 文件 | 说明 |
| --- | --- |
| `src/storage.rs` | 本地持久化 |
| `src/track.rs` | 多源曲目统一模型（Track） |
| `src/download.rs` / `src/bilibili.rs` / `src/youtube.rs` | 多平台内容获取 |
| `Cargo.toml` | 依赖清单（dioxus 0.7.9、rodio 0.22、symphonia、cpal、rustfft） |

---

## 三、复用结论

- ✅ **MIT**，歌词解析、窗口管理、网易云 Web API 逻辑可直接参考/翻译
- ⚠️ 音乐播放走**自播文件**路线（rodio），不符合"控制网易云客户端"需求，此部分仅借鉴命令模式
- 技术栈差异（Dioxus vs Electron+C#），代码需翻译，**算法与窗口策略可直接照搬**

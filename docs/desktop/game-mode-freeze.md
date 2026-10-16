# 游戏模式（冻结后台）设计说明

> 入口：**托盘右键菜单 → 「游戏模式（冻结后台）」**（勾选项，再点一次恢复）。
> 不占用任何全局快捷键；托盘图标是冻结态唯一的恢复入口。
> 代码：`src-tauri/src/freeze.rs`（主逻辑）、`sidecar.rs`（侧车进程树回收）、
> `lib.rs`（托盘菜单 / 主窗显示路径 / 快捷键清单 / 启动清扫）、`windows.rs`（悬浮窗创建门禁）。

## 一、目标

打游戏时把本软件的后台占用压到最低，且**不需要退出/重启软件**；打完再点一下托盘就恢复原状
（窗口可见性、位置、大小、穿透状态、侧车、快捷键全部回到冻结前）。

## 二、为什么"只隐藏窗口"没用（实测数据）

隐藏窗口只是 Win32 层 `SW_HIDE`：

- WebView2 的渲染进程照旧在跑动画（岛的雷达/歌词、余额轮播），CPU/GPU 不降；
- WebView2 也不认为窗口隐藏了，`TrySuspendAsync` 会直接失败（`0x8007139F`，实测踩到）；
- 侧车（音乐桥 `powershell`、`ShortCut.HardwareMonitor.exe`）本来就不受窗口显隐影响。

冻结前实测（本机，我们自己的 WebView2 共 8 个进程）：

```
browser 148MB | gpu-process 127MB | renderer 112+92+60MB | utility 41+18MB | crashpad 15MB
```

## 三、冻结做的五件事

| 项 | 做法 | 效果 |
|---|---|---|
| **A** WebView2 挂起 | 先 `window.hide()`，再 `controller.SetIsVisible(false)`（**关键**，wry 不会同步隐藏状态给 controller），然后 `ICoreWebView2_3::TrySuspendAsync()`；解冻 `Resume()` + `SetIsVisible(true)` | 渲染进程 CPU/GPU 归零；失败时 B 兜底 |
| **B** 页面硬暂停 | 注入 JS：全局 `animation-play-state: paused`、`transition: none`、`setTimeout/setInterval/rAF` 空转、暂停页面内 `video/audio`；解冻撤销 | 直接砍掉动画那部分 CPU/GPU |
| **C** 销毁悬浮窗 | 冻结时 `destroy()` 掉 `island` / `deepseekball` / `tasklist` / 提醒窗（主面板保留），解冻按"冻结前存在过"的清单重建 | 回收 2~3 个 renderer，工作集约 −150~250MB |
| **E** 侧车进程树 | 启动时建 `Job Object` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，音乐桥/硬件监控 spawn 后立刻 `AssignProcessToJobObject` | 我们无论怎么死（正常退出/崩溃/强杀），侧车必被回收，不再留孤儿 |
| **F** 低功耗 | `SetPriorityClass(IDLE)` + `ProcessPowerThrottling/EcoQoS`（任务管理器会显示"效率模式"）+ `EmptyWorkingSet` / `SetProcessWorkingSetSize` 把工作集还给系统 | CPU 调度降级、物理内存腾出；解冻全部还原 |

附带：冻结期间注销本软件**全部**全局快捷键（`configured_hotkeys()` 一份清单，解冻按同条件重注册）、
跳过 30s 提醒扫描、`ensure_island/ensure_deepseekball/ensure_tasklist/ensure_reminder_window`
全部拒绝创建（防止旁路把窗口拉回来）。

## 四、实测结果（2026-10-07，托盘切换冻结）

| 指标 | 运行中 | 冻结后 | 变化 |
|---|---|---|---|
| WebView2 进程数 | 2 | 1 | −1 |
| WebView2 内存 | 278.9 MB | 131.1 MB | **−147.8 MB（约 −53%）** |
| WebView2 CPU | 3.9% | 0% | 归零 |
| WebView2 GPU | 2.4% | 0% | 归零 |
| ShortCut 进程数 | 2 | 1 | −1 |
| ShortCut 内存 | 5.6 MB | 2.6 MB | −3 MB |
| 任务管理器状态 | 运行中 | **效率模式（挂起）** | EcoQoS 生效 |

## 五、踩过的坑（重要，别再犯）

1. **`TrySuspendAsync` 报 `0x8007139F`**：不是版本问题，是 WebView2 认为自己还可见。
   必须先 `controller.SetIsVisible(false)`。
2. **解冻后主面板仍是最小化 / 变成细条**：Windows 把"最小化"编码成位置 `-32000,-32000`、
   尺寸只剩标题栏；`unminimize()` 不保证恢复几何。修法：`show → unminimize → 重新套用
   window-state.json 的尺寸/位置 → 再 set_focus`；`ensure_on_screen` 遇到 `-32000` 哨兵坐标
   且仍最小化时先 `unminimize` 再判断。
3. **唤起主面板后"看不见"**：`closeOnBlur`（默认开）会在窗口失焦且光标在窗外时立刻隐藏，
   而程序化 `show()` 常被 Windows 前台锁抢走焦点 → 刚显示就被藏。修法：显示后 800ms 内不因失焦隐藏；
   只有"稳定获得焦点 ≥400ms"之后的失焦才算用户点走；另外做一次 600ms 置顶脉冲保证可见。
4. **侧车孤儿**：Windows 不会因父进程退出而杀子进程；`kill_child()` 是异步的、强杀/崩溃根本不走它。
   实测残留过 89MB / 91MB 两个音乐桥。→ Job Object 解决（已验证：`taskkill /F` 主进程后侧车被回收）。
5. **启动清扫孤儿会自伤**：清理命令的关键字若写进命令行字面量，`Where-Object` 会把执行清理的
   shell 自己匹配上并杀掉（实测退出码 −1、孤儿一个没清）。→ 关键字运行时拼接 + 打印清理条数。
6. **解冻后硬件监控起一秒就退**：解冻时先还原 `main_active` 再 `sync_cockpit`；否则被判成"不该跑"。
7. **解冻时写配置会重建小球**（闪烁）：恢复穿透走 `restore_passthrough_state()`，只改运行期状态不写配置。

## 六、暂缓项：D / D-lite（"彻底模式"）

| 方案 | 收益 | 风险 | 工作量 |
|---|---|---|---|
| **D** 连主 webview 一起销毁（WebView2 整组退出） | 再省 browser+gpu+utility ≈ 350~600MB，进程数归零，CPU/GPU 不依赖 A 是否成功 | 主窗要抽 `ensure_main_window()` 重建；前端状态全丢（当前板块/未保存输入/转换列表）；"主窗不存在"期间托盘事件、单实例转交、`--convert` 排队都要覆盖；重建失败需降级兜底 | 1.5~2.5 天 |
| **D-lite** 只销毁主 webview、保留岛 | 约 −200MB，风险低于全 D | 同上（少一半） | 约 1 天 |

当前状态：**未实现，待需要时再做**（用户 2026-10-07 决定）。冻结态剩余占用主要是 WebView2
的 browser + gpu 进程（任务管理器口径约 131MB），要再压只能走 D。

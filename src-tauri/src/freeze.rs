//! 游戏模式（冻结后台）：从**托盘菜单**一键冻结/恢复，不需要任何额外热键。
//!
//! 目标：打游戏时把本软件的后台占用压到最低，且**不需要退出/重启软件**。
//!
//! 冻结做四件事：
//! 1. 隐藏所有窗口（岛 / 旁边小球 / 任务墙 / 提醒 / 气泡 / 主面板），记住每个窗口冻结前是否可见；
//! 2. **结束**两个侧车进程（powershell 音乐桥、ShortCut.HardwareMonitor.exe）——挂起不释放内存，
//!    结束才会，解冻时按配置重启（`start_music_bridge` / `sync_cockpit` 自己判断该不该跑）；
//! 3. 主进程降优先级到 IDLE + 打开 **EcoQoS**（只跑小核/低频）+ 清空工作集
//!    （`EmptyWorkingSet` 把物理内存还回系统，解冻后按需换页回来）；
//! 4. **注销本软件全部全局快捷键**（游戏里不会被我们的热键打断），解冻时按配置重新注册。
//!
//! 托盘图标本身不隐藏，它是唯一的恢复入口。
//!
//! 注意：不做"挂起主进程"——挂起后没人响应托盘/窗口消息，反而会让系统把它标记为未响应。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// 是否处于冻结态：冻结期间后台轮询、侧车、热键全部停
pub static FROZEN: AtomicBool = AtomicBool::new(false);

/// 冻结前的状态快照（解冻时逐步还原）
#[derive(Clone, Default)]
struct Snap {
    /// 所有窗口 label → 冻结前是否可见
    wins: Vec<(String, bool)>,
    /// 冻结前 SC 球（岛）是否穿透
    passthrough: bool,
}

static SNAP: Mutex<Option<Snap>> = Mutex::new(None);

pub fn is_frozen() -> bool {
    FROZEN.load(Ordering::Relaxed)
}

/// 切换冻结态；返回切换后是否处于冻结
pub fn toggle(app: &AppHandle) -> bool {
    if is_frozen() {
        unfreeze(app);
        false
    } else {
        freeze(app);
        true
    }
}

/// 冻结：隐藏窗口 + 停侧车 + 低功耗 + 注销热键
pub fn freeze(app: &AppHandle) {
    if FROZEN.swap(true, Ordering::Relaxed) {
        return; // 已经在冻结态
    }
    log::info!("[freeze] 进入游戏模式：隐藏窗口 + 停侧车 + 低功耗 + 注销热键");

    // 1) 快照 + 隐藏所有窗口（含主面板；解冻时按快照逐个还原）
    let mut wins: Vec<(String, bool)> = Vec::new();
    for (label, win) in app.webview_windows() {
        let vis = win.is_visible().unwrap_or(false);
        // 冻结前把状态记进日志：出问题时能直接看出是"隐藏/最小化"还是"跑屏幕外了"
        log::info!(
            "[freeze] 快照 {} visible={} minimized={} pos={:?} size={:?}",
            label,
            vis,
            win.is_minimized().unwrap_or(false),
            win.outer_position().ok(),
            win.outer_size().ok()
        );
        wins.push((label.clone(), vis));
        if vis {
            let _ = win.hide();
        }
    }
    let passthrough = crate::windows::ball_passthrough();

    // 2) 侧车进程结束（真正释放内存）
    {
        let music = app.state::<crate::MusicHandle>();
        crate::sidecar::stop_music_bridge(&music.0);
        let cockpit = app.state::<crate::CockpitHandle>();
        crate::sidecar::kill_child(&cockpit.0.child);
        cockpit.0.main_active.store(false, Ordering::Relaxed);
    }

    // 3) 低功耗
    apply_low_power(true);

    // 4) 注销本软件全部全局快捷键（冻结期间按快捷键不会有任何反应）
    crate::unregister_configured_hotkeys(app);
    crate::voice::disable_shortcut(app);

    *SNAP.lock().unwrap_or_else(|e| e.into_inner()) = Some(Snap { wins, passthrough });
    log::info!("[freeze] 已冻结（托盘菜单可恢复）");
}

/// 解冻：恢复优先级/工作集 → 重启侧车 → 重注册热键 → 还原窗口与穿透
pub fn unfreeze(app: &AppHandle) {
    if !FROZEN.swap(false, Ordering::Relaxed) {
        return;
    }
    log::info!("[freeze] 退出游戏模式：恢复正常运行");

    // 1) 低功耗关掉（先恢复调度，后面的重启才有性能）
    apply_low_power(false);

    // 2) 侧车按配置重启（sync/start 内部会判断模块开关与是否已运行）
    {
        let cockpit = app.state::<crate::CockpitHandle>();
        let st = cockpit.0.clone();
        crate::sidecar::sync_cockpit(app.clone(), st);
        let music = app.state::<crate::MusicHandle>();
        crate::sidecar::start_music_bridge(app.clone(), music.0.clone());
    }

    // 3) 热键重新注册
    crate::register_configured_hotkeys(app);
    crate::voice::register_shortcut(app); // 内部按语音配置判断

    // 4) 还原窗口可见性与穿透
    let snap = SNAP.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(snap) = snap {
        for (label, vis) in snap.wins {
            let Some(win) = app.get_webview_window(&label) else {
                log::warn!("[freeze] 恢复：窗口 {} 已不存在", label);
                continue;
            };
            if !vis {
                log::info!("[freeze] 恢复：{} 冻结前就是隐藏的 → 保持隐藏", label);
                continue;
            }
            // 主面板要"露脸"：走统一的显示路径（含 show/unminimize/set_focus + 失焦宽限），
            // 否则可能刚显示就被 closeOnBlur 藏掉，用户表现就是"呼号出来看不见"
            if label == "main" {
                crate::show_main_window(app);
            } else {
                crate::windows::show_inactive(&win);
            }
            ensure_on_screen(app, &win);
            log::info!(
                "[freeze] 恢复：{} visible={} minimized={} pos={:?} size={:?}",
                label,
                win.is_visible().unwrap_or(false),
                win.is_minimized().unwrap_or(false),
                win.outer_position().ok(),
                win.outer_size().ok()
            );
        }
        crate::windows::set_ball_passthrough(app, snap.passthrough);
    }
    log::info!("[freeze] 已恢复");
}

/// 屏幕越界保护：窗口整块落在所有显示器之外时重新居中。
/// （"面板不见了，可能是缩到看不见的地方"这类问题靠它兜底。）
fn ensure_on_screen(app: &AppHandle, win: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    let on = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            let mp = m.position();
            let ms = m.size();
            let (mx0, my0) = (mp.x, mp.y);
            let (mx1, my1) = (mx0 + ms.width as i32, my0 + ms.height as i32);
            // 只要有交集就算在屏幕内（允许部分越界）
            pos.x < mx1 && pos.x + size.width as i32 > mx0 && pos.y < my1 && pos.y + size.height as i32 > my0
        });
    if !on {
        log::warn!(
            "[freeze] 窗口 {} 整体在屏幕外（pos={:?} size={:?}）→ 重新居中",
            win.label(),
            pos,
            size
        );
        let _ = win.center();
    }
}

/// 低功耗开关：优先级 + EcoQoS（执行速度节流）+ 工作集
#[cfg(windows)]
fn apply_low_power(on: bool) {
    use std::ffi::c_void;
    /// PROCESS_POWER_THROTTLING_STATE
    #[repr(C)]
    struct ThrottlingState {
        version: u32,
        control_mask: u32,
        state_mask: u32,
    }
    const NORMAL_PRIORITY_CLASS: u32 = 0x0000_0020;
    const IDLE_PRIORITY_CLASS: u32 = 0x0000_0040;
    const PROCESS_POWER_THROTTLING_CURRENT_VERSION: u32 = 1;
    const PROCESS_POWER_THROTTLING_EXECUTION_SPEED: u32 = 0x1;
    const PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION: u32 = 0x4;
    /// ProcessInformationClass::ProcessPowerThrottling
    const PROCESS_POWER_THROTTLING_CLASS: u32 = 4;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn SetPriorityClass(h: *mut c_void, class: u32) -> i32;
        fn SetProcessInformation(h: *mut c_void, class: u32, info: *mut c_void, size: u32) -> i32;
        fn SetProcessWorkingSetSize(h: *mut c_void, min: usize, max: usize) -> i32;
    }
    #[link(name = "psapi")]
    unsafe extern "system" {
        fn EmptyWorkingSet(h: *mut c_void) -> i32;
    }

    unsafe {
        let h = GetCurrentProcess();
        let _ = SetPriorityClass(h, if on { IDLE_PRIORITY_CLASS } else { NORMAL_PRIORITY_CLASS });
        let mask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
        let mut st = ThrottlingState {
            version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            control_mask: mask,
            state_mask: if on { mask } else { 0 },
        };
        let ret = SetProcessInformation(
            h,
            PROCESS_POWER_THROTTLING_CLASS,
            &mut st as *mut _ as *mut c_void,
            std::mem::size_of::<ThrottlingState>() as u32,
        );
        if on {
            // 把工作集刷回系统：物理内存立刻还回去，解冻后按需换页回来
            let e = EmptyWorkingSet(h);
            let w = SetProcessWorkingSetSize(h, usize::MAX, usize::MAX);
            log::info!("[freeze] 低功耗开启：EcoQoS={} EmptyWorkingSet={} Trim={}", ret, e, w);
        } else {
            log::info!("[freeze] 低功耗关闭：EcoQoS={}", ret);
        }
    }
}

#[cfg(not(windows))]
fn apply_low_power(_on: bool) {}

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
    /// 所有窗口 label → (冻结前是否可见, 冻结前是否最小化)
    wins: Vec<(String, bool, bool)>,
    /// 冻结前 SC 球（岛）是否穿透
    passthrough: bool,
    /// 被"销毁"的悬浮窗 label（C 方案，解冻时按需重建）
    overlays: Vec<String>,
}

static SNAP: Mutex<Option<Snap>> = Mutex::new(None);

/// 冻结前硬件监控侧车的 main_active（解冻要还原，否则起来一秒就退）
static COCKPIT_WAS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 冻结时注入页面：暂停所有 CSS 动画/过渡，并让 setTimeout/setInterval/rAF 变成空转。
/// 只隐藏窗口时渲染进程照样在跑动画 —— 这是"冻结后 CPU/GPU 没降"的主因之一。
const PAUSE_JS: &str = r#"
(() => {
  if (window.__SC_FROZEN__) return;
  window.__SC_FROZEN__ = true;
  const d = document;
  const st = d.getElementById('sc-freeze-style') || d.createElement('style');
  st.id = 'sc-freeze-style';
  st.textContent = '*,*::before,*::after{animation-play-state:paused !important;transition:none !important;} video,audio{}.sc';
  (d.head || d.documentElement).appendChild(st);
  const isFrozen = () => window.__SC_FROZEN__ === true;
  const wrapTimer = (name) => {
    const orig = window[name];
    if (!orig || orig.__scWrapped) return;
    const wrapped = function (fn, ...rest) {
      if (typeof fn === 'function') {
        const guarded = function (...a) { if (isFrozen()) return; return fn.apply(this, a); };
        return orig.call(window, guarded, ...rest);
      }
      return orig.call(window, fn, ...rest);
    };
    wrapped.__scWrapped = true;
    try { window[name] = wrapped; } catch (e) {}
  };
  wrapTimer('setInterval');
  wrapTimer('setTimeout');
  if (!window.requestAnimationFrame.__scWrapped) {
    const origRaf = window.requestAnimationFrame.bind(window);
    const raf = function (cb) { return origRaf(function (t) { if (isFrozen()) { raf(cb); return; } cb(t); }); };
    raf.__scWrapped = true;
    window.requestAnimationFrame = raf;
  }
  // 正在播放的媒体也一起停（岛上可能有音频/视频元素）
  try { d.querySelectorAll('video,audio').forEach(m => { try { m.pause(); } catch (e) {} }); } catch (e) {}
})();
"#;

/// 解冻时注入页面：撤掉暂停
const RESUME_JS: &str = r#"
(() => {
  window.__SC_FROZEN__ = false;
  const st = document.getElementById('sc-freeze-style');
  if (st && st.parentNode) st.parentNode.removeChild(st);
})();
"#;

/// 挂起单个窗口的 WebView2（A：官方 TrySuspendAsync，必须窗口已隐藏）
fn pause_webview(app: &AppHandle, label: &str) {
    let Some(win) = app.get_webview_window(label) else {
        return;
    };
    // 先注入页面级暂停（B）——它一定生效，且对 TrySuspend 失败的情况也是兜底
    if let Err(e) = win.eval(PAUSE_JS) {
        log::warn!("[freeze] 注入页面暂停失败 {}: {}", label, e);
    }
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use webview2_com::TrySuspendCompletedHandler;
        use windows_core::Interface;
        let label2 = label.to_string();
        let label3 = label.to_string();
        let res = win.with_webview(move |pw| unsafe {
            let ctrl = pw.controller();
            // 关键：WebView2 要求"自己认为已隐藏"才允许挂起。window.hide() 只是 Win32 层 SW_HIDE，
            // wry 不会同步给 controller，所以必须显式 SetIsVisible(false)，
            // 否则 TrySuspend 直接返回 0x8007139F（状态不正确）——实测踩到。
            if let Err(e) = ctrl.SetIsVisible(false) {
                log::warn!("[freeze] {} SetIsVisible(false) 失败: {:?}", label2, e);
            }
            let Ok(core) = ctrl.CoreWebView2() else {
                log::warn!("[freeze] {} 取 CoreWebView2 失败", label2);
                return;
            };
            let Ok(v3) = core.cast::<ICoreWebView2_3>() else {
                log::warn!("[freeze] {} 不支持 ICoreWebView2_3（WebView2 版本过旧）", label2);
                return;
            };
            let handler = TrySuspendCompletedHandler::create(Box::new(move |hr, ok| {
                log::info!("[freeze] WebView2 挂起回调 {}: hr={:?} 成功={}", label3, hr, ok);
                Ok(())
            }));
            match v3.TrySuspend(&handler) {
                Ok(_) => log::info!("[freeze] 已请求挂起 WebView2: {}", label2),
                Err(e) => log::warn!("[freeze] 挂起 WebView2 失败 {}: {:?}", label2, e),
            }
        });
        if let Err(e) = res {
            log::warn!("[freeze] with_webview 调用失败 {}: {}", label, e);
        }
    }
}

/// 恢复单个窗口的 WebView2 渲染
fn resume_webview(app: &AppHandle, label: &str) {
    let Some(win) = app.get_webview_window(label) else {
        return;
    };
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use windows_core::Interface;
        let label2 = label.to_string();
        let res = win.with_webview(move |pw| unsafe {
            let ctrl = pw.controller();
            let Ok(core) = ctrl.CoreWebView2() else { return };
            let Ok(v3) = core.cast::<ICoreWebView2_3>() else { return };
            match v3.Resume() {
                Ok(_) => log::info!("[freeze] 已恢复 WebView2 渲染: {}", label2),
                Err(e) => log::warn!("[freeze] 恢复 WebView2 失败 {}: {:?}", label2, e),
            }
            // 挂起时把 controller 置为不可见，恢复时补回来
            if let Err(e) = ctrl.SetIsVisible(true) {
                log::warn!("[freeze] {} SetIsVisible(true) 失败: {:?}", label2, e);
            }
        });
        if let Err(e) = res {
            log::warn!("[freeze] 恢复 with_webview 调用失败 {}: {}", label, e);
        }
    }
    if let Err(e) = win.eval(RESUME_JS) {
        log::warn!("[freeze] 注入页面恢复失败 {}: {}", label, e);
    }
}

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
    let mut wins: Vec<(String, bool, bool)> = Vec::new(); // (label, visible, minimized)
    for (label, win) in app.webview_windows() {
        let vis = win.is_visible().unwrap_or(false);
        let min = win.is_minimized().unwrap_or(false);
        // 冻结前把状态记进日志：出问题时能直接看出是"隐藏/最小化"还是"跑屏幕外了"
        log::info!(
            "[freeze] 快照 {} visible={} minimized={} pos={:?} size={:?}",
            label,
            vis,
            min,
            win.outer_position().ok(),
            win.outer_size().ok()
        );
        wins.push((label.clone(), vis, min));
        if vis {
            let _ = win.hide();
        }
    }
    let passthrough = crate::windows::ball_passthrough();

    // 1.5) C 方案：把悬浮窗（岛 / 旁边小球 / 任务墙 / 提醒）**整个销毁**，而不是只隐藏。
    //      只隐藏的话它们的 renderer 还在（每个 60~112MB）；销毁后 WebView2 会回收这些渲染进程。
    //      主面板保留（它的 renderer 用 A 的挂起 + B 的页面暂停处理，面板状态不丢）。
    let mut overlays: Vec<String> = Vec::new();
    // 先把"菜单打开"标志清掉（拖放形态回到 collapsed），否则这个标志会残留成
    // ISLAND_MENU_OPEN=true，解冻后岛会被强制"不可穿透"，与用户设置不一致
    let _ = crate::windows::set_ball_shape(app, "collapsed");
    for (label, _, _) in wins.iter() {
        if label == "main" {
            continue;
        }
        if let Some(win) = app.get_webview_window(label) {
            overlays.push(label.clone());
            win.destroy().ok();
        }
    }
    if !overlays.is_empty() {
        log::info!("[freeze] 已销毁悬浮窗（C 方案省内存）: {:?}", overlays);
    }

    // 2) 剩下的窗口（主面板）停掉页面动画/定时器（B）+ 让 WebView2 挂起渲染（A）
    //    只隐藏窗口是不够的：渲染进程照样跑动画（这就是冻结后 CPU/GPU 几乎没降的原因）
    for (label, _, _) in wins.iter() {
        pause_webview(app, label);
    }

    // 3) 侧车进程结束（真正释放内存）
    {
        let music = app.state::<crate::MusicHandle>();
        crate::sidecar::stop_music_bridge(&music.0);
        let cockpit = app.state::<crate::CockpitHandle>();
        // 记下冻结前的 main_active，解冻时要还原，否则硬件监控起不来（实测日志：
        // 已启动 → 1 秒后退出）
        COCKPIT_WAS_ACTIVE.store(cockpit.0.main_active.load(Ordering::Relaxed), Ordering::Relaxed);
        crate::sidecar::kill_child(&cockpit.0.child);
        cockpit.0.main_active.store(false, Ordering::Relaxed);
    }

    // 3) 低功耗
    apply_low_power(true);

    // 4) 注销本软件全部全局快捷键（冻结期间按快捷键不会有任何反应）
    crate::unregister_configured_hotkeys(app);
    crate::voice::disable_shortcut(app);

    *SNAP.lock().unwrap_or_else(|e| e.into_inner()) = Some(Snap { wins, passthrough, overlays });
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
        // 还原冻结前的 main_active：不还原的话硬件监控会被 sync_cockpit 判定为"不该跑"，
        // 起来一秒就退（实测踩到）
        let was_active = COCKPIT_WAS_ACTIVE.swap(false, Ordering::Relaxed);
        if was_active {
            cockpit.0.main_active.store(true, Ordering::Relaxed);
        }
        let st = cockpit.0.clone();
        crate::sidecar::sync_cockpit(app.clone(), st);
        let music = app.state::<crate::MusicHandle>();
        crate::sidecar::start_music_bridge(app.clone(), music.0.clone());
    }

    // 页面恢复：先让 WebView2 继续渲染（A），再撤掉页面里的暂停（B）
    {
        let snap = SNAP.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = snap.as_ref() {
            for (label, _, _) in s.wins.iter() {
                resume_webview(app, label);
            }
        }
    }

    // 3) 热键重新注册
    crate::register_configured_hotkeys(app);
    crate::voice::register_shortcut(app); // 内部按语音配置判断

    // 4) 还原窗口与穿透
    let snap = SNAP.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(snap) = snap {
        // 4.1 主面板：show + unminimize + **重新套用保存的窗口几何**（否则会保持最小化/细条）
        if let Some((_, vis, _)) = snap.wins.iter().find(|(l, _, _)| l == "main") {
            if *vis {
                crate::show_main_window(app);
            } else {
                log::info!("[freeze] 恢复：main 冻结前就是隐藏的 → 保持隐藏");
            }
        }
        // 4.2 C 方案重建悬浮窗（按冻结前"存在过"的清单重建）
        for label in snap.overlays.iter() {
            match label.as_str() {
                "island" => match crate::windows::ensure_island(app) {
                    Ok(_) => log::info!("[freeze] 重建悬浮窗: island"),
                    Err(e) => log::error!("[freeze] 重建 island 失败: {}", e),
                },
                "tasklist" => {
                    if crate::windows::tasks_enabled() {
                        match crate::windows::ensure_tasklist(app) {
                            Ok(_) => log::info!("[freeze] 重建悬浮窗: tasklist"),
                            Err(e) => log::error!("[freeze] 重建 tasklist 失败: {}", e),
                        }
                    } else {
                        log::info!("[freeze] 任务模块已关闭，不重建 tasklist");
                    }
                }
                "deepseekball" => {
                    // 小球的出现规则：正在播放音乐且显示余额（sync 内部按配置判断，会自己决定建不建）
                    crate::sync_deepseekball_state(app);
                    log::info!("[freeze] 小球按当前规则恢复（播放中且显示余额才出现）");
                }
                other => log::info!("[freeze] 悬浮窗 {} 属于临时窗（提醒/气泡），不重建", other),
            }
        }
        // 4.3 穿透还原（岛重建之后再设置，避免落到已销毁的窗口上）
        crate::windows::restore_passthrough_state(app, snap.passthrough);
    }
    log::info!("[freeze] 已恢复");
}

/// 屏幕越界保护：窗口整块落在所有显示器之外时重新居中。
/// （"面板不见了，可能是缩到看不见的地方"这类问题靠它兜底。）
/// 解冻恢复、托盘/热键唤起、以及启动时恢复上次窗口状态之后都会调用一次。
pub(crate) fn ensure_on_screen(app: &AppHandle, win: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    // 最小化哨兵几何（Windows 用 -32000 表示"最小化中"）不能当成真位置判断，
    // 否则会对一个"最小化"的窗口做居中，把它的尺寸也一起带偏。
    if pos.x <= -30000 || pos.y <= -30000 {
        if win.is_minimized().unwrap_or(false) {
            log::info!("[freeze] 窗口 {} 仍处于最小化 → 先还原", win.label());
            let _ = win.unminimize();
            return;
        }
    }
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

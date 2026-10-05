//! M3 透明窗：灵动岛（SC球/翻译胶囊随后）
//! 规格照抄 Electron：frame=false、transparent、resizable=false、alwaysOnTop、skipTaskbar、
//! hasShadow=false、focusable=false、show=false；收起态鼠标穿透（setIgnoreMouseEvents(!expanded)）；
//! 360×340，位置预设 top-center(0.5,0.08) 等，custom 用 config.island.x/y。

use serde_json::{json, Value};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::config;

pub const ISLAND_WIDTH: f64 = 360.0;
pub const ISLAND_HEIGHT: f64 = 340.0;

fn position_preset(name: &str) -> (f64, f64) {
    match name {
        "top-left" => (0.12, 0.08),
        "top-right" => (0.88, 0.08),
        "bottom-center" => (0.5, 0.78),
        "bottom-left" => (0.12, 0.78),
        "bottom-right" => (0.88, 0.78),
        _ => (0.5, 0.08), // top-center
    }
}

/// 读 config.island 偏好（与 Electron getIslandPreferences 对齐，仅取壳需要的字段）
pub fn island_prefs() -> Value {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw).unwrap_or(json!({}))
    };
    let island = cfg.get("island").cloned().unwrap_or(json!({}));
    let g = |k: &str, d: bool| island.get(k).and_then(|v| v.as_bool()).unwrap_or(d);
    json!({
        "enabled": g("enabled", true),
        "position": island.get("position").and_then(|v| v.as_str()).unwrap_or("top-center"),
        "displayState": island.get("displayState").and_then(|v| v.as_str()).unwrap_or("collapsed"),
        "x": island.get("x").and_then(|v| v.as_f64()),
        "y": island.get("y").and_then(|v| v.as_f64()),
    })
}

/// 读 config.island 完整字段（事件广播给岛前端用；带 Electron getIslandPreferences 的默认值兜底）
pub fn island_full_prefs() -> Value {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw).unwrap_or(json!({}))
    };
    let island = cfg.get("island").cloned().unwrap_or(json!({}));
    let g = |k: &str, d: bool| island.get(k).and_then(|v| v.as_bool()).unwrap_or(d);
    let s = |k: &str, d: &str| island.get(k).and_then(|v| v.as_str()).unwrap_or(d).to_string();
    let legacy_deepseek = g("deepseekEnabled", false);
    let provider = island.get("balanceProvider").and_then(|v| v.as_str()).unwrap_or("");
    let balance_provider = if provider == "deepseek" || provider == "opencode" {
        provider.to_string()
    } else if legacy_deepseek {
        "deepseek".to_string()
    } else {
        "none".to_string()
    };
    json!({
        "enabled": g("enabled", false),
        "style": s("style", "capsule"),
        "position": s("position", "top-center"),
        "autoHideFullscreen": g("autoHideFullscreen", true),
        "musicEnabled": g("musicEnabled", true),
        "tasksEnabled": g("tasksEnabled", true),
        "cockpitEnabled": g("cockpitEnabled", false),
        "balanceProvider": balance_provider,
        "lyricBounce": g("lyricBounce", true),
        "orbitGlow": g("orbitGlow", true),
        "barsEnabled": g("barsEnabled", true),
        "displayState": s("displayState", "collapsed"),
        "deepseekEnabled": legacy_deepseek,
        "deepseekApiKey": island.get("deepseekApiKey").cloned().unwrap_or(Value::Null),
        "opencodeApiKey": island.get("opencodeApiKey").cloned().unwrap_or(Value::Null),
        "x": island.get("x").cloned().unwrap_or(Value::Null),
        "y": island.get("y").cloned().unwrap_or(Value::Null),
    })
}

/// 计算窗口 bounds（primary monitor，逻辑像素=Electron DIP 基准；工作区差异=任务栏，M3 先用整屏）
pub fn island_bounds(app: &tauri::AppHandle, prefs: &Value) -> (f64, f64, f64, f64) {
    let mut area = (0.0, 0.0, 1280.0, 800.0); // x, y, width, height 逻辑像素兜底
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let size = m.size();
        let pos = m.position();
        area = (
            pos.x as f64 / scale,
            pos.y as f64 / scale,
            size.width as f64 / scale,
            size.height as f64 / scale,
        );
    }
    let w = ISLAND_WIDTH.min(area.2.max(260.0));
    let h = ISLAND_HEIGHT.min(area.3.max(220.0));

    let position = prefs.get("position").and_then(|v| v.as_str()).unwrap_or("top-center");
    let (rx, ry) = position_preset(position);
    // 与 Electron islandPositionBounds 一致：clamp 到工作区内
    let x = if position == "custom" {
        prefs
            .get("x")
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .map(|cx| cx.min(area.0 + area.2 - w).max(area.0).round())
            .unwrap_or(area.0)
    } else {
        (area.0 + area.2 * rx - w / 2.0).round()
    };
    let y = if position == "custom" {
        prefs
            .get("y")
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .map(|cy| cy.min(area.1 + area.3 - h).max(area.1).round())
            .unwrap_or(area.1)
    } else {
        (area.1 + area.3 * ry).round()
    };
    (x, y, w, h)
}

/// 应用鼠标穿透（SC球=岛）：开关打开→恒定穿透；关闭→沿用原岛规则（收起态穿透、展开态可交互）；
/// 拖放菜单打开期间强制不穿透（否则点不到菜单）。
pub fn apply_passthrough(win: &tauri::WebviewWindow) {
    let _ = win.set_ignore_cursor_events(effective_island_passthrough());
}

/// SC球（岛）当前是否穿透——唯一判定入口：快捷键 / 设置开关 / 拖放守卫 / 状态变化都走这里。
/// 优先级：拖放菜单打开（不穿透）> 用户开关（穿透）> 岛自身显示状态（收起穿透、展开可交互）。
/// 用"菜单打开"而不是硬编码 false，避免用户开关被别处覆盖。
pub fn effective_island_passthrough() -> bool {
    use std::sync::atomic::Ordering;
    if ISLAND_MENU_OPEN.load(Ordering::Relaxed) {
        return false;
    }
    if BALL_PASSTHROUGH.load(Ordering::Relaxed) {
        return true;
    }
    let prefs = island_prefs();
    prefs.get("displayState").and_then(|v| v.as_str()) != Some("expanded")
}

/// 把穿透状态同时落到岛和旁边小球（小球跟随岛，不单独开关）
pub fn apply_island_and_ball_passthrough(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    let on = effective_island_passthrough();
    if let Some(win) = app.get_webview_window("island") {
        let _ = win.set_ignore_cursor_events(on);
    }
    if let Some(win) = app.get_webview_window("deepseekball") {
        let _ = win.set_ignore_cursor_events(on);
    }
    log::info!(
        "[island] 穿透生效 = {}（用户开关={} 菜单打开={} 显示态={:?}）",
        on,
        BALL_PASSTHROUGH.load(Ordering::Relaxed),
        ISLAND_MENU_OPEN.load(Ordering::Relaxed),
        island_prefs().get("displayState").cloned().unwrap_or(Value::Null)
    );
}

/// 创建或唤起灵动岛窗口
pub fn ensure_island(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("island") {
        return Ok(win);
    }
    let prefs = island_prefs();
    let (x, y, w, h) = island_bounds(app, &prefs);
    log::info!("[island] 创建窗口: pos=({}, {}) size=({}, {}) state={:?}", x, y, w, h, prefs);
    let builder = WebviewWindowBuilder::new(app, "island", WebviewUrl::App("island.html".into()))
        .title("ShortCut Island")
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .position(x, y)
        .inner_size(w, h)
        .initialization_script(crate::SHIM_JS);
    // 拖放必须显式开启：wry 只在拿到 drag-drop handler 时才交还 WebView2 的外部拖放，
    // 而 tauri.conf.json 的 dragDropEnabled 只作用于配置里声明的窗口（本项目全部动态创建）。
    // Batch 2 迁移：拖放接收方从"旁边小球"改到 SC球（岛）本体。
    #[cfg(windows)]
    let builder = builder.drag_and_drop(true);
    let win = match builder.build()
    {
        Ok(w) => w,
        Err(e) => {
            log::error!("[island] 创建失败: {}", e);
            return Err(e);
        }
    };
    attach_island_drop_handler(&win, app);
    let _ = win.set_focusable(false);
    let _ = win.set_always_on_top(true);
    restore_passthrough_from_config();
    apply_passthrough(&win);
    #[cfg(windows)]
    crate::webviewdrop::allow_external_drop(app, "island");
    spawn_island_drop_guard(app);
    // 逻辑坐标定位（与 Electron DIP 一致，DPI 缩放下位置记忆兼容）
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    show_inactive(&win); // 对齐 Electron islandWindow.showInactive()
    log::info!("[island] 已显示");
    Ok(win)
}

/// SC球（岛）拖放事件 → 岛前端：拖入高亮 / 松手吸附动画 + 格式菜单。
/// 事件名沿用 ball:* （前端 onBallDragover/onBallDrop 别名已就绪），避免大范围改名。
fn attach_island_drop_handler(win: &tauri::WebviewWindow, app: &tauri::AppHandle) {
    let app_ev = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::DragDrop(ev) = event {
            match ev {
                tauri::DragDropEvent::Enter { paths, .. } => {
                    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    log::info!("[island] 拖入 {} 个文件", list.len());
                    let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": true, "paths": list }));
                }
                tauri::DragDropEvent::Over { .. } => {}
                tauri::DragDropEvent::Leave => {
                    let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": false }));
                }
                tauri::DragDropEvent::Drop { paths, .. } => {
                    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    log::info!("[island] 球上松手，文件数={}", list.len());
                    let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": false }));
                    let _ = app_ev.emit("ball:drop", serde_json::json!({ "paths": list }));
                }
                _ => {}
            }
        }
    });
}

/// Alt+I / 前端 toggleIsland：存在则切换可见性，否则创建
pub fn toggle_island(app: &tauri::AppHandle) {
    match app.get_webview_window("island") {
        Some(win) => {
            if win.is_visible().unwrap_or(false) {
                let _ = win.hide();
            } else {
                show_inactive(&win); // 对齐 Electron showInactive：不抢主窗焦点
            }
        }
        None => {
            let prefs = island_prefs();
            if prefs.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
                let _ = ensure_island(app);
            }
        }
    }
}

/// 写 config.island 的一个字段（读-改-写，保持其他配置不动）
pub fn patch_island_config(app: &tauri::AppHandle, patch: Value) {
    let _ = app; // 预留事件通知
    let raw = config::read_config();
    let mut cfg: Value = if raw.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw).unwrap_or(json!({}))
    };
    let obj = cfg.as_object_mut().unwrap();
    let island = obj
        .entry("island")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap();
    if let Some(patch_obj) = patch.as_object() {
        for (k, v) in patch_obj {
            island.insert(k.clone(), v.clone());
        }
    }
    config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
}

/// 岛锚点（逻辑像素）：tasklist/SC球贴岛右侧（与 Electron taskListBounds/deepseekBallBounds 一致）
pub fn island_anchor(app: &tauri::AppHandle) -> (f64, f64, f64, f64) {
    if let Some(win) = app.get_webview_window("island") {
        if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
            let scale = win.scale_factor().unwrap_or(1.0);
            let x = pos.x as f64 / scale;
            let y = pos.y as f64 / scale;
            let w = size.width as f64 / scale;
            return (x, y, w, 0.0);
        }
    }
    let prefs = island_prefs();
    island_bounds(app, &prefs)
}

/// 通用覆盖窗创建（岛同族规格：透明/无边框/置顶/无影/跳过任务栏）
fn build_overlay(
    app: &tauri::AppHandle,
    id: &str,
    url: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    focusable: bool,
) -> tauri::Result<tauri::WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, id, WebviewUrl::App(url.into()))
        .title(format!("ShortCut {}", id))
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .position(x, y)
        .inner_size(w, h);
    // 拖放必须显式开启：wry 只在拿到 drag-drop handler 时才注册 OLE IDropTarget，
    // 而 tauri.conf.json 的 dragDropEnabled 只作用于配置里声明的窗口（本项目全部动态创建）。
    // 不开启时 Windows 找不到 drop 接收者 → 拖文件显示禁止光标（P3 拖放失效的根因）。
    #[cfg(windows)]
    let builder = builder.drag_and_drop(true);
    let win = builder
        .initialization_script(crate::SHIM_JS)
        .build()?;
    // Batch 2 迁移：拖放/高亮/格式菜单改由 SC球（岛）承载，旁边小球不再单独接拖放事件。
    let _ = win.set_focusable(focusable);
    let _ = win.set_always_on_top(true);
    Ok(win)
}

/// 无激活显示（Tauri 无 show_inactive：临时置不可聚焦再显示，语义等价 Electron showInactive）
pub fn show_inactive(win: &tauri::WebviewWindow) {
    let _ = win.set_focusable(false);
    let _ = win.show();
    let _ = win.set_focusable(true);
}

/// 任务墙窗口（340×430，岛右侧；Alt+U 切换创建/销毁）
pub fn ensure_tasklist(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("tasklist") {
        // 已显示则 no-op；未显示用无激活显示（不抢焦点 → 主窗不会失焦隐藏）
        if !win.is_visible().unwrap_or(false) {
            show_inactive(&win);
        }
        return Ok(win);
    }
    let (ix, iy, iw, _) = island_anchor(app);
    let win = build_overlay(app, "tasklist", "tasklist.html", ix + iw + 8.0, iy, 340.0, 430.0, false);
    if let Ok(ref w) = win {
        show_inactive(w);
    }
    win
}

pub fn destroy_tasklist(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("tasklist") {
        let _ = win.destroy();
    }
}

/// 旁边小球尺寸（46×46，贴岛右侧；不接拖放，只跟随岛的穿透状态）
pub const BALL_SIZE: f64 = 46.0;

/// SC球（岛）鼠标穿透开关（true=穿透，点击落到下层）。用静态变量记住状态：
/// Tauri 没有 ignore_cursor_events 的 getter，同时写进配置以便重启后保持。
static BALL_PASSTHROUGH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 拖放菜单是否打开（打开期间强制不穿透，保证菜单可点）
static ISLAND_MENU_OPEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 读取用户设定的穿透开关（SC球=岛；旁边小球跟随）
pub fn ball_passthrough() -> bool {
    BALL_PASSTHROUGH.load(std::sync::atomic::Ordering::Relaxed)
}

/// 从配置恢复穿透开关（island.ballClickThrough；旧版本也写这个键）
pub fn restore_passthrough_from_config() {
    let through = config::read_config_value()
        .and_then(|c| c.get("island").and_then(|i| i.get("ballClickThrough")).and_then(|v| v.as_bool()))
        .unwrap_or(false);
    BALL_PASSTHROUGH.store(through, std::sync::atomic::Ordering::Relaxed);
    log::info!("[island] 从配置恢复穿透开关 = {}", through);
}

/// 【SC球（岛）鼠标穿透】on=true 岛不接收鼠标；关闭时回到"收起穿透/展开可交互"。
/// 旁边小球跟随同一状态（不单独开关）。
pub fn set_ball_passthrough(app: &tauri::AppHandle, on: bool) {
    BALL_PASSTHROUGH.store(on, std::sync::atomic::Ordering::Relaxed);
    apply_island_and_ball_passthrough(app);
    // 落盘（重启后保持一致）
    if let Some(mut cfg) = config::read_config_value() {
        if let Some(island) = cfg.get_mut("island").and_then(|i| i.as_object_mut()) {
            island.insert("ballClickThrough".into(), serde_json::json!(on));
        }
        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    }
    let _ = app.emit("ball:passthrough", serde_json::json!({ "on": on }));
    // 回读 Windows 实际状态（排查"设置里点了没变化"：是没调进去，还是调了没生效）
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetWindowLongW(hwnd: *mut std::ffi::c_void, index: i32) -> i32;
        }
        for label in ["island", "deepseekball"] {
            if let Some(win) = app.get_webview_window(label) {
                if let Ok(h) = win.hwnd() {
                    let ex = unsafe { GetWindowLongW(h.0 as *mut std::ffi::c_void, -20) };
                    log::info!(
                        "[island] {} 鼠标穿透：请求={} 实际可穿透={} ex=0x{:X}",
                        label, on, ex & 0x20 != 0, ex
                    );
                }
            }
        }
    }
    #[cfg(not(windows))]
    log::info!("[island] 鼠标穿透 = {}", on);
}

/// 拖放守卫：Windows 命中测试会整体跳过"穿透"窗口，所以穿透开着时文件拖到 SC球（岛）上收不到。
/// 这里用轻量轮询：光标进入岛的窗口范围且左键按住（= 正在拖东西）→ 临时解除穿透让拖放落下来；
/// 松手或移开 → 恢复用户设定的穿透状态。这样"文件拖放"就不受穿透开关影响了。
pub fn spawn_island_drop_guard(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetAsyncKeyState(vkey: i32) -> i16;
        }
        #[repr(C)]
        struct Pt { x: i32, y: i32 }
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetCursorPos(p: *mut Pt) -> i32;
        }
        const VK_LBUTTON: i32 = 0x01;
        let mut armed = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(120));
            let Some(win) = app.get_webview_window("island") else {
                continue;
            };
            // 只在"当前确实穿透"时才需要守卫；菜单打开/非穿透时清掉残留
            if !effective_island_passthrough() {
                if armed {
                    armed = false;
                    apply_island_and_ball_passthrough(&app);
                }
                continue;
            }
            let down = unsafe { GetAsyncKeyState(VK_LBUTTON) } < 0;
            let mut pt = Pt { x: 0, y: 0 };
            let ok = unsafe { GetCursorPos(&mut pt) } != 0;
            let mut inside = false;
            if ok {
                if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
                    // outer_position/outer_size 都是物理像素；岛整窗就是拖放落点（远大于原来的 46px 小球）
                    let (x0, y0) = (pos.x, pos.y);
                    let (x1, y1) = (x0 + size.width as i32, y0 + size.height as i32);
                    inside = pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1;
                }
            }
            let want = down && inside;
            if want != armed {
                armed = want;
                if want {
                    let _ = win.set_ignore_cursor_events(false);
                    if let Some(ball) = app.get_webview_window("deepseekball") {
                        let _ = ball.set_ignore_cursor_events(false);
                    }
                } else {
                    apply_island_and_ball_passthrough(&app);
                }
                log::info!(
                    "[island] 拖放守卫：{}穿透（光标在岛上且按住左键={}）",
                    if want { "临时解除" } else { "恢复" },
                    down
                );
            }
        }
    });
}

/// SC球（岛）拖放形态：collapsed（常态）/ hint（拖入提示）/ menu（格式菜单）。
/// 迁移后菜单在岛自己的 360×340 透明窗内渲染（不再改窗口尺寸），这里只负责
/// "菜单/提示打开期间一定可交互"，避免穿透把菜单点击吃掉。
pub fn set_ball_shape(app: &tauri::AppHandle, shape: &str) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if app.get_webview_window("island").is_none() {
        return Err("SC球（岛）窗口不存在".to_string());
    }
    ISLAND_MENU_OPEN.store(shape != "collapsed", Ordering::Relaxed);
    apply_island_and_ball_passthrough(app);
    log::info!("[island] 拖放形态={}（菜单打开={}）", shape, shape != "collapsed");
    Ok(())
}

/// 旁边小球（46×46，岛右侧偏下；位置随岛、穿透随岛，不接拖放）
pub fn ensure_deepseekball(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("deepseekball") {
        position_deepseekball(app);
        return Ok(win);
    }
    let (ix, iy, iw, _) = island_anchor(app);
    let win = build_overlay(app, "deepseekball", "deepseekball.html", ix + iw + 8.0, iy + 8.0, BALL_SIZE, BALL_SIZE, false);
    if let Ok(ref w) = win {
        show_inactive(w); // 对齐 Electron deepseekBallWindow.showInactive()
        // Batch 2 迁移：小球不再是拖放接收方，穿透状态完全跟随 SC球（岛）
        restore_passthrough_from_config();
        apply_island_and_ball_passthrough(app);
    }
    win
}

/// SC球跟随岛位置（与 Electron positionDeepseekBall 一致）
pub fn position_deepseekball(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("deepseekball") {
        let (ix, iy, iw, _) = island_anchor(app);
        let _ = win.set_position(tauri::LogicalPosition::new(ix + iw + 8.0, iy + 8.0));
    }
}

/// M5 提醒窗：340×128 透明窗，岛上方堆叠（对齐 createReminderWindow）
pub fn ensure_reminder_window(app: &tauri::AppHandle, board_id: &str, task_id: &str, index: usize) -> bool {
    let label = format!("reminder-{}-{}", board_id, task_id);
    if app.get_webview_window(&label).is_some() {
        return false;
    }
    // 岛位置锚定
    let (ix, iy, iw) = match app.get_webview_window("island") {
        Some(island) => {
            let pos = island.outer_position().ok();
            let scale = island.current_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
            let size = island.outer_size().ok();
            match (pos, size) {
                (Some(p), Some(s)) => ((p.x as f64 / scale).round() as i32, (p.y as f64 / scale).round() as i32, (s.width as f64 / scale).round() as i32),
                _ => (120, 120, 360),
            }
        }
        None => (120, 120, 360),
    };
    let x = ix + (iw - 340) / 2;
    let y = iy + 60 + (index as i32) * 132;
    let url = WebviewUrl::App("reminder.html".into());
    let result = WebviewWindowBuilder::new(app, &label, url)
        .title("reminder")
        .inner_size(340.0, 128.0)
        .position(x as f64, y as f64)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .initialization_script(crate::SHIM_JS)
        .build();
    match result {
        Ok(w) => {
            let _ = w.set_focusable(false);
            let _ = w.set_position(tauri::LogicalPosition::new(x as f64, y as f64));
            let _ = w.show();
            let payload = serde_json::json!({ "boardId": board_id, "taskId": task_id });
            let _ = app.emit_to(&label, "electron:ReminderData", payload);
            log::info!("[windows] 提醒窗已创建 {} idx={}", label, index);
            true
        }
        Err(e) => {
            log::error!("[windows] 提醒窗创建失败 {}: {:?}", label, e);
            false
        }
    }
}
/// M5：销毁 SC 球（销毁前通知合并状态，对齐 Electron destroyDeepseekBall）
pub fn destroy_deepseekball(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("deepseekball") {
        use tauri::Emitter;
        let _ = app.emit("deepseek:merge", ());
        let _ = app.emit("balance:merge", ());
        let _ = win.destroy();
    }
}
/// M5：判断屏幕逻辑坐标是否在岛范围内（对齐 pointInIsland）
pub fn point_in_island(app: &tauri::AppHandle, screen_x: f64, screen_y: f64) -> bool {
    let Some(island) = app.get_webview_window("island") else {
        return false;
    };
    let Ok(pos) = island.outer_position() else { return false };
    let Ok(size) = island.outer_size() else { return false };
    let scale = island.current_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let (x, y, w, h) = (
        pos.x as f64 / scale,
        pos.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    );
    screen_x >= x && screen_x <= x + w && screen_y >= y && screen_y <= y + h
}

/// M5：主显示器工作区（逻辑坐标，对齐 display.workArea）
pub fn monitor_work_area(app: &tauri::AppHandle) -> (f64, f64, f64, f64) {
    if let Some(m) = app.primary_monitor().ok().flatten() {
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        // 粗略任务栏扣除：底部 48 逻辑像素
        let logical_h = size.height as f64 / scale;
        return (
            pos.x as f64 / scale,
            pos.y as f64 / scale,
            size.width as f64 / scale,
            (logical_h - 48.0).max(200.0),
        );
    }
    (0.0, 0.0, 1536.0, 816.0)
}
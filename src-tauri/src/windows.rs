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

/// 应用鼠标穿透：收起态穿透，展开态可交互（与 Electron applyIslandMousePassthrough 一致）
pub fn apply_passthrough(win: &tauri::WebviewWindow) {
    let prefs = island_prefs();
    let expanded = prefs.get("displayState").and_then(|v| v.as_str()) == Some("expanded");
    let _ = win.set_ignore_cursor_events(!expanded);
}

/// 创建或唤起灵动岛窗口
pub fn ensure_island(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("island") {
        return Ok(win);
    }
    let prefs = island_prefs();
    let (x, y, w, h) = island_bounds(app, &prefs);
    log::info!("[island] 创建窗口: pos=({}, {}) size=({}, {}) state={:?}", x, y, w, h, prefs);
    let win = match WebviewWindowBuilder::new(app, "island", WebviewUrl::App("island.html".into()))
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
        .initialization_script(crate::SHIM_JS)
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            log::error!("[island] 创建失败: {}", e);
            return Err(e);
        }
    };
    let _ = win.set_focusable(false);
    let _ = win.set_always_on_top(true);
    apply_passthrough(&win);
    // 逻辑坐标定位（与 Electron DIP 一致，DPI 缩放下位置记忆兼容）
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    show_inactive(&win); // 对齐 Electron islandWindow.showInactive()
    log::info!("[island] 已显示");
    Ok(win)
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
    let label = id.to_string();
    let app_ev = app.clone();
    let win = builder
        .initialization_script(crate::SHIM_JS)
        .build()?;
    // SC 球拖放：拖入 → 高亮提示；松手 → 交给球前端弹格式菜单
    // （on_window_event 是 WebviewWindow 上的方法，不是 builder 的）
    if label == "deepseekball" {
        win.on_window_event(move |event| {
            if let tauri::WindowEvent::DragDrop(ev) = event {
                match ev {
                    tauri::DragDropEvent::Enter { paths, .. } => {
                        let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                        log::info!("[ball] 拖入 {} 个文件", list.len());
                        let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": true, "paths": list }));
                    }
                    tauri::DragDropEvent::Over { .. } => {}
                    tauri::DragDropEvent::Leave => {
                        let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": false }));
                    }
                    tauri::DragDropEvent::Drop { paths, .. } => {
                        let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                        log::info!("[ball] 球上松手，文件数={}", list.len());
                        let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": false }));
                        let _ = app_ev.emit("ball:drop", serde_json::json!({ "paths": list }));
                    }
                    _ => {}
                }
            }
        });
    }
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

/// SC 球展开菜单（拖入/松手后）：保持球视觉位置不动，向右下生长；越界则向左上生长
pub const BALL_SIZE: f64 = 46.0;
pub const BALL_HINT_W: f64 = 190.0;
pub const BALL_HINT_H: f64 = 64.0;
pub const BALL_MENU_W: f64 = 310.0;
pub const BALL_MENU_H: f64 = 380.0;

/// 球的鼠标穿透开关（true=穿透，点击落到下层）。用静态变量记住状态：
/// Tauri 没有 ignore_cursor_events 的 getter，同时写进配置以便重启后保持。
static BALL_PASSTHROUGH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 读取球穿透状态
pub fn ball_passthrough() -> bool {
    BALL_PASSTHROUGH.load(std::sync::atomic::Ordering::Relaxed)
}

/// 设置球穿透（on=true 时球不接收鼠标/拖放）
pub fn set_ball_passthrough(app: &tauri::AppHandle, on: bool) {
    BALL_PASSTHROUGH.store(on, std::sync::atomic::Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("deepseekball") {
        let _ = win.set_ignore_cursor_events(on);
    }
    // 落盘（重启后保持一致）
    if let Some(mut cfg) = config::read_config_value() {
        if let Some(island) = cfg.get_mut("island").and_then(|i| i.as_object_mut()) {
            island.insert("ballClickThrough".into(), serde_json::json!(on));
        }
        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    }
    let _ = app.emit("ball:passthrough", serde_json::json!({ "on": on }));
    log::info!("[ball] 鼠标穿透 = {}", on);
}

/// 球的展开形态：collapsed（46×46）/ hint（拖入提示）/ menu（格式菜单）
pub fn set_ball_shape(app: &tauri::AppHandle, shape: &str) -> Result<(), String> {
    let win = app
        .get_webview_window("deepseekball")
        .ok_or_else(|| "SC球窗口不存在".to_string())?;
    let (tw, th) = match shape {
        "menu" => (BALL_MENU_W, BALL_MENU_H),
        "hint" => (BALL_HINT_W, BALL_HINT_H),
        _ => (BALL_SIZE, BALL_SIZE),
    };
    // 收起态锚点：岛右侧偏下（与 Electron deepseekBallBounds 一致）
    let (ax, ay, _, _) = island_anchor(app);
    let ball_x = ax + island_width(app) + 8.0;
    let ball_y = ay + 8.0;

    // 生长方向：默认向右下；越界则贴边（保证菜单完整可见）
    let (mon_w, mon_h) = primary_monitor_size(app).unwrap_or((1920.0, 1080.0));
    let mut x = ball_x;
    let mut y = ball_y;
    if x + tw > mon_w - 8.0 {
        x = (ball_x + BALL_SIZE - tw).max(8.0);
    }
    if y + th > mon_h - 8.0 {
        y = (ball_y + BALL_SIZE - th).max(8.0);
    }
    win.set_size(tauri::LogicalSize::new(tw, th))
        .map_err(|e| format!("改尺寸失败: {e}"))?;
    win.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("改位置失败: {e}"))?;
    // 展开时一定可交互（穿透开着就点不动菜单）
    if shape != "collapsed" {
        let _ = win.set_ignore_cursor_events(false);
    } else if ball_passthrough() {
        let _ = win.set_ignore_cursor_events(true);
    }
    log::info!("[ball] 形态={} 尺寸={}x{} 位置=({:.0},{:.0})", shape, tw, th, x, y);
    Ok(())
}

/// 岛当前宽度（球贴岛右侧用）
fn island_width(app: &tauri::AppHandle) -> f64 {
    if let Some(win) = app.get_webview_window("island") {
        if let Ok(size) = win.outer_size() {
            let scale = win.scale_factor().unwrap_or(1.0);
            return size.width as f64 / scale;
        }
    }
    180.0
}

/// 主显示器逻辑尺寸
fn primary_monitor_size(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let win = app.get_webview_window("deepseekball")?;
    let mon = win.current_monitor().ok().flatten()?;
    let scale = mon.scale_factor();
    Some((mon.size().width as f64 / scale, mon.size().height as f64 / scale))
}

/// SC球（46×46，岛右侧偏下；位置随岛）
pub fn ensure_deepseekball(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("deepseekball") {
        position_deepseekball(app);
        return Ok(win);
    }    let (ix, iy, iw, _) = island_anchor(app);
    let win = build_overlay(app, "deepseekball", "deepseekball.html", ix + iw + 8.0, iy + 8.0, BALL_SIZE, BALL_SIZE, false);
    if let Ok(ref w) = win {
        show_inactive(w); // 对齐 Electron deepseekBallWindow.showInactive()
        // 恢复配置里的穿透状态
        let through = config::read_config_value()
            .and_then(|c| c.get("island").and_then(|i| i.get("ballClickThrough")).and_then(|v| v.as_bool()))
            .unwrap_or(false);
        BALL_PASSTHROUGH.store(through, std::sync::atomic::Ordering::Relaxed);
        if through {
            let _ = w.set_ignore_cursor_events(true);
        }
        // SC球要能接收"拖文件到球上"（Batch 2）：同样需要交还 WebView2 的外部拖放
        #[cfg(windows)]
        crate::webviewdrop::allow_external_drop(app, "deepseekball");
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
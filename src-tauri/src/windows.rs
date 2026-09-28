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
    let _ = win.show();
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
                let _ = win.show();
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
    let win = WebviewWindowBuilder::new(app, id, WebviewUrl::App(url.into()))
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
        .inner_size(w, h)
        .initialization_script(crate::SHIM_JS)
        .build()?;
    let _ = win.set_focusable(focusable);
    let _ = win.set_always_on_top(true);
    Ok(win)
}

/// 任务墙窗口（340×430，岛右侧；Alt+U 切换创建/销毁）
pub fn ensure_tasklist(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("tasklist") {
        let _ = win.show();
        return Ok(win);
    }
    let (ix, iy, iw, _) = island_anchor(app);
    let win = build_overlay(app, "tasklist", "tasklist.html", ix + iw + 8.0, iy, 340.0, 430.0, false);
    if let Ok(ref w) = win {
        let _ = w.show();
    }
    win
}

pub fn destroy_tasklist(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("tasklist") {
        let _ = win.destroy();
    }
}

/// SC球（46×46，岛右侧偏下；位置随岛）
pub fn ensure_deepseekball(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("deepseekball") {
        position_deepseekball(app);
        return Ok(win);
    }
    let (ix, iy, iw, _) = island_anchor(app);
    let win = build_overlay(app, "deepseekball", "deepseekball.html", ix + iw + 8.0, iy + 8.0, 46.0, 46.0, false);
    if let Ok(ref w) = win {
        let _ = w.show();
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
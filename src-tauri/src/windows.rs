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

/// 上一次真正下发的穿透值（-1 = 尚未下发）。
///
/// 为什么必须缓存：Tauri 的 `set_ignore_cursor_events` 会 `SetWindowPos(..., SWP_FRAMECHANGED)`。
/// 在**拖拽进行中**重复下发同一个值，会让 Windows 重新做一次拖放命中测试，
/// 岛会收到一次 Leave、OLE 目标被丢掉 → 松手时 drop 落到岛下面的窗口上，
/// 表现就是「出现了松手自动识别，但松手之后没有任何反应」（实测日志里永远只有"拖入"、没有"球上松手"）。
static PASSTHROUGH_APPLIED: std::sync::atomic::AtomicI8 = std::sync::atomic::AtomicI8::new(-1);

/// 拖拽活跃截止时刻（毫秒时间戳，0 = 无拖拽）。
/// 岛收到 Enter/Leave 都会往后顺延，保证「拖拽期间（含刚 Leave 的短暂瞬间）岛一定可交互」，
/// 这样即使 Windows 抖了一次 Leave，松手仍然落在岛上，能收到 drop。
static DRAG_ACTIVE_UNTIL_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 标记"拖拽活跃"，往后顺延 `ms` 毫秒
pub fn mark_drag_active(ms: u64) {
    DRAG_ACTIVE_UNTIL_MS.store(now_ms().saturating_add(ms), std::sync::atomic::Ordering::Relaxed);
}

/// 立即结束拖拽活跃标记
pub fn clear_drag_active() {
    DRAG_ACTIVE_UNTIL_MS.store(0, std::sync::atomic::Ordering::Relaxed);
}

fn drag_active() -> bool {
    let until = DRAG_ACTIVE_UNTIL_MS.load(std::sync::atomic::Ordering::Relaxed);
    until > 0 && now_ms() < until
}

/// 岛"可见内容"在窗口内的矩形（**逻辑/CSS 像素**，相对窗口左上角）。
///
/// 为什么需要：岛窗口是固定 360×340 的透明窗（远大于收起态那颗球），
/// 如果整窗接收鼠标，球周围那一大圈透明区就会吞掉桌面点击。
/// 所以"不穿透"时也不该整窗可交互，而应只在**可见内容上**可交互——
/// 这个矩形由岛前端（`.island-root` 的 getBoundingClientRect）上报，随布局变化更新。
/// 默认值取整窗：前端没上报时退化为"整窗可交互"，与改动前的展开态行为一致（安全兜底）。
static ISLAND_HIT_RECT: std::sync::Mutex<(f64, f64, f64, f64)> =
    std::sync::Mutex::new((0.0, 0.0, ISLAND_WIDTH, ISLAND_HEIGHT));

/// 岛前端上报可见内容矩形（逻辑像素，窗口坐标系）
pub fn set_island_hit_rect(x: f64, y: f64, w: f64, h: f64) {
    let mut r = match ISLAND_HIT_RECT.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    let next = (x, y, w.max(0.0), h.max(0.0));
    let same = (*r).0 == next.0 && (*r).1 == next.1 && (*r).2 == next.2 && (*r).3 == next.3;
    if same {
        return; // 没变化不刷日志
    }
    *r = next;
    log::info!("[island] 可见内容矩形 = ({:.0},{:.0},{:.0}×{:.0})", x, y, w, h);
}

fn island_hit_rect() -> (f64, f64, f64, f64) {
    match ISLAND_HIT_RECT.lock() {
        Ok(g) => *g,
        Err(e) => *e.into_inner(),
    }
}

/// 光标是否落在岛的**可见内容**上（物理↔逻辑像素按窗口缩放比换算）
#[cfg(windows)]
fn cursor_over_island_content(app: &tauri::AppHandle) -> bool {
    #[repr(C)]
    struct Pt {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetCursorPos(p: *mut Pt) -> i32;
    }
    let Some(win) = app.get_webview_window("island") else {
        return false;
    };
    let mut pt = Pt { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return false;
    }
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return false;
    };
    if size.width == 0 || size.height == 0 {
        return false;
    }
    // outer_* 是物理像素；缩放比用"实际宽 / 逻辑宽"直接求，比 scale_factor 更贴合真实窗口
    let scale = size.width as f64 / ISLAND_WIDTH;
    let lx = (pt.x - pos.x) as f64 / scale;
    let ly = (pt.y - pos.y) as f64 / scale;
    let (rx, ry, rw, rh) = island_hit_rect();
    lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh
}

#[cfg(not(windows))]
fn cursor_over_island_content(_app: &tauri::AppHandle) -> bool {
    true
}

/// SC球（岛）当前是否穿透——唯一判定入口：快捷键 / 设置开关 / 拖放守卫 / 状态变化都走这里。
///
/// 优先级与语义（2026-10-13 修正，见 docs/球穿透开关修复说明.md）：
///   1. 拖拽进行中 / 拖放菜单打开 → **不穿透**（否则收不到拖放、点不到菜单）
///   2. 用户开关打开（启用穿透）→ **恒定穿透**（连可见的球一起穿透，交给下层窗口）
///   3. 展开态 → **不穿透**（整窗可交互，就是原来的行为）
///   4. 收起 / 迷你态 → **跟随可见内容**：光标在球的矩形内则不穿透，移开即穿透
///
/// 第 4 条是本次修复的核心：改之前"非展开态"一律穿透，导致"启用穿透"开关在收起态
/// 怎么切都没差别（`PASSTHROUGH_APPLIED` 缓存发现值没变，连窗口样式都不下发），
/// 用户看到的就是"状态变了，但实际还是能穿透"。
pub fn effective_island_passthrough(app: &tauri::AppHandle) -> bool {
    use std::sync::atomic::Ordering;
    if drag_active() {
        return false;
    }
    if ISLAND_MENU_OPEN.load(Ordering::Relaxed) {
        return false;
    }
    if BALL_PASSTHROUGH.load(Ordering::Relaxed) {
        return true;
    }
    let prefs = island_prefs();
    if prefs.get("displayState").and_then(|v| v.as_str()) == Some("expanded") {
        return false;
    }
    !cursor_over_island_content(app)
}

/// 把穿透状态同时落到岛和旁边小球（小球跟随岛，不单独开关）
pub fn apply_island_and_ball_passthrough(app: &tauri::AppHandle) {
    let on = effective_island_passthrough(app);
    apply_island_and_ball_passthrough_value(app, on, false);
}

/// 让缓存失效：窗口刚创建/重建、或外部改过样式之后必须调用一次
pub fn reset_passthrough_cache() {
    PASSTHROUGH_APPLIED.store(-1, std::sync::atomic::Ordering::Relaxed);
}

/// 下发穿透；`force=false` 时值没变就不碰窗口样式（见 [`PASSTHROUGH_APPLIED`] 的说明）
pub fn apply_island_and_ball_passthrough_value(app: &tauri::AppHandle, on: bool, force: bool) {
    use std::sync::atomic::Ordering;
    let want: i8 = if on { 1 } else { 0 };
    let prev = PASSTHROUGH_APPLIED.load(Ordering::Relaxed);
    if !force && prev == want {
        return; // 值没变：绝不再调 set_ignore_cursor_events，避免拖拽中途扰动 OLE 目标
    }
    PASSTHROUGH_APPLIED.store(want, Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("island") {
        let _ = win.set_ignore_cursor_events(on);
    }
    if let Some(win) = app.get_webview_window("deepseekball") {
        let _ = win.set_ignore_cursor_events(on);
    }
    log::info!(
        "[island] 穿透生效 = {}（用户开关={} 菜单打开={} 拖拽活跃={} 显示态={:?}）",
        on,
        BALL_PASSTHROUGH.load(Ordering::Relaxed),
        ISLAND_MENU_OPEN.load(Ordering::Relaxed),
        drag_active(),
        island_prefs().get("displayState").cloned().unwrap_or(Value::Null)
    );
}

/// 创建或唤起灵动岛窗口
/// 任务模块是否启用（游戏模式重建 tasklist 前要判断）
pub fn tasks_enabled() -> bool {
    island_prefs()
        .get("tasksEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

pub fn ensure_island(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    // 游戏模式（冻结后台）期间不建悬浮窗：冻结时它们已被销毁（C 方案省内存），
    // 解冻时由 freeze::unfreeze 统一重建，避免拖放守卫/余额同步等路径把窗口偷偷拉回来。
    if crate::freeze::is_frozen() {
        return Err(std::io::Error::other("游戏模式冻结中，不创建悬浮窗").into());
    }
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
    // 新窗口刚建出来，缓存必须失效，否则"值没变"会让我们跳过真正需要的下发
    reset_passthrough_cache();
    apply_island_and_ball_passthrough(app);
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
                    // 记下路径 + 标记"本次还没收到 Drop"：OLE 不投递时的兜底要用
                    DRAG_DROPPED.store(false, std::sync::atomic::Ordering::Relaxed);
                    note_drag_paths(list.clone());
                    // 拖拽期间岛必须保持可交互（否则松手时 drop 会落到岛下面的窗口上）
                    mark_drag_active(3000);
                    apply_island_and_ball_passthrough(&app_ev);
                    let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": true, "paths": list }));
                }
                tauri::DragDropEvent::Over { .. } => {
                    mark_drag_active(3000); // 拖拽持续中，不断续期
                    // 注意：这个 Tauri 版本的 Over 事件不带 paths，路径只在 Enter/Drop 里拿
                }
                tauri::DragDropEvent::Leave => {
                    // Leave 可能是 Windows 抖出来的（窗口样式/命中测试扰动），
                    // 所以这里不立刻恢复穿透：留 1.5s 宽限，松手仍能落在岛上收到 drop。
                    mark_drag_active(1500);
                    let _ = app_ev.emit("ball:dragover", serde_json::json!({ "active": false }));
                }
                tauri::DragDropEvent::Drop { paths, .. } => {
                    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    log::info!("[island] 球上松手，文件数={}", list.len());
                    DRAG_DROPPED.store(true, std::sync::atomic::Ordering::Relaxed);
                    note_drag_paths(Vec::new());
                    // 松手后交给前端「识别态」维持可交互（menu 形态），这里结束拖拽活跃标记
                    clear_drag_active();
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
    if crate::freeze::is_frozen() {
        return Err(std::io::Error::other("游戏模式冻结中，不创建悬浮窗").into());
    }
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

/// 「正在播放音乐 且 岛在显示余额」——旁边小球的出现条件（由前端 island.tsx 通过
/// setBalanceMusicPlaying 上报）。只有它为 true 时小球才存在，其余时间小球不应常驻。
pub static BALL_MUSIC_PLAYING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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

/// 只还原穿透的**运行期状态**（不写配置、不触发"配置变更 → 重建小球"）。
/// 游戏模式解冻恢复穿透值时用这个：写配置会连带把小球窗口重建一次（实测有闪烁）。
pub fn restore_passthrough_state(app: &tauri::AppHandle, on: bool) {
    BALL_PASSTHROUGH.store(on, std::sync::atomic::Ordering::Relaxed);
    apply_island_and_ball_passthrough(app);
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
        /// 松手后的宽限期：OLE 的 drop 投递可能比"左键抬起"晚几十~几百毫秒，
        /// 如果一检测到松开就恢复穿透，drop 会被岛下面的窗口抢走（实测导致"松手后没反应"）。
        const RELEASE_GRACE_MS: u64 = 500;
        let mut armed = false;
        let mut release_until: Option<std::time::Instant> = None;
        loop {
            // 轮询间隔自适应：只有在"穿透值会随光标变化"时才需要快轮询
            // （启用穿透=恒定穿透、展开态=整窗可交互，两者都与光标无关）。
            // 收起/迷你态快轮询是给"球可点、周围不挡"用的：慢了会出现"快速点一下没反应"。
            let needs_cursor = !BALL_PASSTHROUGH.load(Ordering::Relaxed)
                && island_prefs().get("displayState").and_then(|v| v.as_str()) != Some("expanded");
            std::thread::sleep(std::time::Duration::from_millis(if needs_cursor { 40 } else { 120 }));
            let Some(win) = app.get_webview_window("island") else {
                continue;
            };
            // 注意：这里**不能**因为"当前不穿透"就 continue 掉整个循环——
            // 拖拽活跃期间 passthrough 恒为 false，若提前 continue 就永远走不到"松手兜底"分支。
            // 穿透下发统一放在循环末尾（带缓存，值没变不会重复扰动窗口样式）。
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
            let now = std::time::Instant::now();

            if down && inside {
                // 左键按住且光标在岛上：这次多半是拖放，岛必须保持可交互
                armed = true;
                release_until = None;
                mark_drag_active(1000);
            } else if armed {
                // 松手（或拖出岛外）：先给宽限期，让真正的 Drop 有机会投递过来
                let t = *release_until.get_or_insert(now + std::time::Duration::from_millis(RELEASE_GRACE_MS));
                if now >= t {
                    armed = false;
                    release_until = None;
                    // 宽限期过了还没有 Drop：说明 OLE 根本没投递（浏览器/聊天窗口拖图常见），
                    // 用拖入时记下的路径自己补一个 drop，别让用户"松手后毫无反应"
                    synthesize_drop_if_pending(&app, inside);
                }
            }

            // 穿透下发：拖拽活跃 / 菜单打开 → 一定可交互；否则回到用户设定
            if drag_active() || ISLAND_MENU_OPEN.load(std::sync::atomic::Ordering::Relaxed) {
                apply_island_and_ball_passthrough_value(&app, false, false);
            } else {
                apply_island_and_ball_passthrough(&app);
            }
        }
    });
}

/// 一次拖拽的全部路径（Enter/Over 时记下，Drop 后清空）
static DRAG_PATHS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
/// 本次拖拽是否已经真的收到过 Drop
static DRAG_DROPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

fn note_drag_paths(paths: Vec<String>) {
    if let Ok(mut v) = DRAG_PATHS.lock() {
        *v = paths;
    }
}

fn take_drag_paths() -> Vec<String> {
    DRAG_PATHS.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

/// OLE 没投递 Drop 时的兜底：用拖入时记下的路径补发一次 `ball:drop`
fn synthesize_drop_if_pending(app: &tauri::AppHandle, cursor_inside: bool) {
    use std::sync::atomic::Ordering;
    if DRAG_DROPPED.load(Ordering::Relaxed) {
        note_drag_paths(Vec::new());
        return;
    }
    DRAG_DROPPED.store(true, Ordering::Relaxed);
    let paths = take_drag_paths();
    if paths.is_empty() || !cursor_inside {
        return; // 不是"在岛上松手"的一次真拖放，别乱补
    }
    log::info!("[island] 松手（OLE 未投递，补发 drop）文件数={}", paths.len());
    let _ = app.emit("ball:dragover", serde_json::json!({ "active": false }));
    let _ = app.emit("ball:drop", serde_json::json!({ "paths": paths }));
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
    if crate::freeze::is_frozen() {
        return Err(std::io::Error::other("游戏模式冻结中，不创建悬浮窗").into());
    }
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
        reset_passthrough_cache(); // 小球是新窗口，缓存失效后必须真正下发一次
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
    if crate::freeze::is_frozen() {
        return false; // 游戏模式期间不弹提醒
    }
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
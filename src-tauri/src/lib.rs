//! ShortCut Tauri 2 壳——M1 最小壳
//! 设计：前端 electronAPI shim（initialization_script 注入）→ 统一 invoke `electron_api` 命令
//! → 本文件 match 分发。未实现的 method 返回 Null 兜底，前端不崩；按里程碑逐步补齐。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

mod config;
mod control;
mod usage;
mod windows;

/// electronAPI shim：渲染层每次访问 window.electronAPI 的任意方法都落到 invoke('electron_api')。
/// 回调型（onXxx）映射到 tauri 事件 'electron:<name>'。
/// __TAURI__ 由 withGlobalTauri 注入；若 shim 先于其执行，等待就绪后再装配。
pub(crate) const SHIM_JS: &str = r#"
(() => {
  if (window.__SHORTCUT_SHIM__) return;
  window.__SHORTCUT_SHIM__ = true;
  const install = () => {
    if (window.__SHORTCUT_API__) return;
    if (!window.__TAURI__ || !window.__TAURI__.core) return;
    const invoke = (m, ...a) => window.__TAURI__.core.invoke('electron_api', { method: m, args: a });
    const api = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop.startsWith('on') && prop.length > 2) {
          return (cb) => {
            const ev = 'electron:' + prop.slice(2);
            try { window.__TAURI__.event.listen(ev, (e) => { try { cb(e.payload); } catch (_) {} }); } catch (_) {}
          };
        }
        return (...args) => invoke(prop, ...args).catch(() => null);
      }
    });
    Object.defineProperty(window, 'electronAPI', { value: api, writable: false, configurable: false });
    window.__SHORTCUT_API__ = true;
  };
  install();
  if (!window.__SHORTCUT_API__) {
    const t = setInterval(() => { install(); if (window.__SHORTCUT_API__) clearInterval(t); }, 20);
    setTimeout(() => clearInterval(t), 10000);
  }
})();
"#;

#[tauri::command]
fn electron_api(app: tauri::AppHandle, window: tauri::WebviewWindow, method: String, args: Vec<Value>) -> Value {
    match method.as_str() {
        // ---- 应用信息 ----
        "getAppVersion" => json!(app.package_info().version.to_string()),
        "getAppName" => json!(app.package_info().name.clone()),
        "getPlatform" => json!("win32"),

        // ---- 窗口控制 ----
        "minimizeWindow" => { let _ = window.minimize(); Value::Null }
        "maximizeWindow" => { let _ = window.is_maximized().map(|m| if m { let _ = window.unmaximize(); } else { let _ = window.maximize(); }); Value::Null }
        "hideWindow" => { let _ = window.hide(); Value::Null }
        "closeWindow" => { let _ = window.hide(); Value::Null } // 主窗口关闭=隐藏到托盘（与 Electron 行为一致）
        "showWindow" => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            Value::Null
        }
        "quitApp" => { app.exit(0); Value::Null }

        // ---- 系统信息（占位：M2 补齐真实实现）----
        "getSystemInfo" => json!({ "platform": "win32", "arch": "x64", "release": "" }),

        // ---- M2：配置（%APPDATA%\ShortCut 硬兼容）----
        "readConfig" => json!(config::read_config()),
        "writeConfig" => {
            let data = args.first().and_then(|v| v.as_str()).unwrap_or("");
            config::write_config(data);
            Value::Null
        }
        "getPath" => {
            let name = args.first().and_then(|v| v.as_str()).unwrap_or("userData");
            let p = match name {
                "userData" => config::user_data_dir(),
                "downloads" => dirs_home().join("Downloads"),
                "home" => dirs_home(),
                "temp" => std::env::temp_dir(),
                _ => config::user_data_dir(),
            };
            json!(p.to_string_lossy().to_string())
        }
        "isMaximized" => json!(window.is_maximized().unwrap_or(false)),

        // ---- M2：开机自启 ----
        "getOpenAtLogin" => {
            use tauri_plugin_autostart::ManagerExt;
            json!(app.autolaunch().is_enabled().unwrap_or(false))
        }
        "setOpenAtLogin" => {
            use tauri_plugin_autostart::ManagerExt;
            let enable = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            let al = app.autolaunch();
            let r = if enable { al.enable() } else { al.disable() };
            json!(r.is_ok())
        }

        // ---- M2：通知 / 打开外部 ----
        "showNotification" => {
            use tauri_plugin_notification::NotificationExt;
            let title = args.first().and_then(|v| v.as_str()).unwrap_or("ShortCut");
            let body = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let _ = app.notification().builder().title(title).body(body).show();
            Value::Null
        }
        "openExternal" => {
            use tauri_plugin_opener::OpenerExt;
            if let Some(url) = args.first().and_then(|v| v.as_str()) {
                let _ = app.opener().open_url(url, None::<&str>);
            }
            Value::Null
        }

        // ---- M2：使用统计（usage-record.json 数据层；采集器 M5 接入）----
        "getUsageData" => {
            let date = args.first().and_then(|v| v.as_str()).map(|s| s.to_string());
            let record = usage::UsageRecord::load();
            json!(usage::payload(&record, date.as_deref()))
        }
        "setUsageEnabled" => {
            let mut record = usage::UsageRecord::load();
            record.enabled = args.first().and_then(|v| v.as_bool()).unwrap_or(true);
            record.save();
            json!(usage::payload(&record, None))
        }
        "clearUsageData" => {
            let mut record = usage::UsageRecord::load();
            record.days.clear();
            record.save();
            json!(usage::payload(&record, None))
        }
        "deleteUsageDay" => {
            let mut record = usage::UsageRecord::load();
            if let Some(key) = args.first().and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                record.days.remove(&key);
                record.save();
                json!(usage::payload(&record, Some(&key)))
            } else {
                json!(usage::payload(&record, None))
            }
        }
        "addUsageIgnored" => {
            let mut record = usage::UsageRecord::load();
            if let Some(key) = args.first().and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
                if !record.ignored.contains(&key) {
                    record.ignored.push(key);
                    record.save();
                }
            }
            json!(usage::payload(&record, None))
        }
        "removeUsageIgnored" => {
            let mut record = usage::UsageRecord::load();
            if let Some(key) = args.first().and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase()) {
                record.ignored.retain(|item| item != &key);
                record.save();
            }
            json!(usage::payload(&record, None))
        }
        "addUsageBackgroundApp" => {
            let mut record = usage::UsageRecord::load();
            if let Some(key) = args.first().and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
                if !record.background_apps.contains(&key) {
                    record.background_apps.push(key);
                    record.save();
                }
            }
            json!(usage::payload(&record, None))
        }
        "removeUsageBackgroundApp" => {
            let mut record = usage::UsageRecord::load();
            if let Some(key) = args.first().and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase()) {
                record.background_apps.retain(|item| item != &key);
                record.save();
            }
            json!(usage::payload(&record, None))
        }

        // ---- M2：剪贴板 / 文件操作 ----
        "copyText" => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            if let Some(text) = args.first().and_then(|v| v.as_str()) {
                let _ = app.clipboard().write_text(text);
            }
            Value::Null
        }
        "openFile" => {
            if let Some(p) = args.first().and_then(|v| v.as_str()) {
                let _ = std::process::Command::new("cmd").args(["/C", "start", "", p]).spawn();
            }
            Value::Null
        }
        "openFolder" => {
            if let Some(p) = args.first().and_then(|v| v.as_str()) {
                let _ = std::process::Command::new("explorer").arg(p).spawn();
            }
            Value::Null
        }
        "showInFolder" => {
            if let Some(p) = args.first().and_then(|v| v.as_str()) {
                let _ = std::process::Command::new("explorer").arg("/select,").arg(p).spawn();
            }
            Value::Null
        }

        // ---- M3：透明窗（灵动岛；SC球/胶囊随后）----
        "toggleIsland" => {
            windows::toggle_island(&app);
            Value::Null
        }
        "getIslandState" => {
            let prefs = windows::island_prefs();
            let visible = app
                .get_webview_window("island")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            let mut state = prefs.clone();
            if let Some(obj) = state.as_object_mut() {
                obj.insert("visible".into(), json!(visible));
            }
            state
        }
        "setIsland" => {
            if let Some(patch) = args.first().cloned() {
                let was_pos = windows::island_prefs();
                windows::patch_island_config(&app, patch);
                if let Some(win) = app.get_webview_window("island") {
                    let now = windows::island_prefs();
                    let pos_changed = now.get("position") != was_pos.get("position")
                        || now.get("x") != was_pos.get("x")
                        || now.get("y") != was_pos.get("y");
                    if pos_changed {
                        let (x, y, _, _) = windows::island_bounds(&app, &now);
                        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
                    }
                    windows::apply_passthrough(&win);
                }
            }
            Value::Null
        }
        "moveIslandTo" => {
            let x = args.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            if let Some(win) = app.get_webview_window("island") {
                let _ = win.set_position(tauri::LogicalPosition::new(x, y));
            }
            windows::patch_island_config(
                &app,
                json!({ "x": x, "y": y, "position": "custom" }),
            );
            windows::position_deepseekball(&app);
            Value::Null
        }
        "getIslandBounds" => match app.get_webview_window("island") {
            Some(win) => {
                let pos = win.outer_position().unwrap_or_default();
                let size = win.outer_size().unwrap_or_default();
                json!({ "x": pos.x, "y": pos.y, "width": size.width, "height": size.height })
            }
            None => Value::Null,
        },

        // ---- M3：任务墙窗 / SC球壳（数据管道 M5 接入）----
        "startTaskList" | "refreshTaskList" => {
            let _ = windows::ensure_tasklist(&app);
            Value::Null
        }
        "stopTaskList" => {
            windows::destroy_tasklist(&app);
            Value::Null
        }
        "startDeepseekBall" => {
            let _ = windows::ensure_deepseekball(&app);
            Value::Null
        }
        "stopDeepseekBall" => {
            if let Some(win) = app.get_webview_window("deepseekball") {
                let _ = win.destroy();
            }
            Value::Null
        }

        // ---- M4：控制板块（sj 服务 Rust 化；授权默认 pair 模式 9823）----
        "startControl" => {
            let port = args.first().and_then(|v| v.as_u64()).unwrap_or(9823) as u16;
            let auth_mode = args
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or("pair")
                .to_string();
            match start_control(&app, port, &auth_mode) {
                Ok(status) => status,
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "stopControl" => {
            stop_control(&app);
            json!({ "ok": true })
        }
        "restartControl" => {
            let (port, mode) = {
                let state = app.state::<ControlHandle>();
                let guard = state.0.lock().unwrap();
                match guard.as_ref() {
                    Some((st, srv)) => (srv.port, st.auth_mode.clone()),
                    None => (9823, "pair".to_string()),
                }
            };
            stop_control(&app);
            match start_control(&app, port, &mode) {
                Ok(status) => status,
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "getControlStatus" => {
            let state = app.state::<ControlHandle>();
            let guard = state.0.lock().unwrap();
            match guard.as_ref() {
                Some((st, _)) => {
                    let clients = if st.auth_mode == "pair" {
                        Value::from(st.sessions.lock().unwrap().len())
                    } else {
                        Value::Null
                    };
                    json!({
                        "running": st.running.load(std::sync::atomic::Ordering::SeqCst),
                        "port": st.port,
                        "authMode": st.auth_mode,
                        "pairCode": *st.pair_code.lock().unwrap(),
                        "clients": clients,
                        "injector": st.injector.is_ready(),
                        "urls": control::lan_urls_pub(st.port),
                    })
                }
                None => json!({ "running": false }),
            }
        }
        "resetControlCode" => {
            let state = app.state::<ControlHandle>();
            let guard = state.0.lock().unwrap();
            match guard.as_ref() {
                Some((st, _)) => {
                    let code = control::new_pair_code_pub();
                    *st.pair_code.lock().unwrap() = code.clone();
                    st.sessions.lock().unwrap().clear();
                    json!({ "pairCode": code })
                }
                None => json!({ "error": "not running" }),
            }
        }

        // ---- 未迁移方法兜底：返回空对象，前端不崩（按里程碑补齐）----
        _ => {
            log::debug!("[shim] 未实现的 electronAPI 方法: {}", method);
            Value::Null
        }
    }
}

/// 下载/主目录等兜底解析
fn dirs_home() -> std::path::PathBuf {
    std::env::var("USERPROFILE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// M4 控制服务句柄（shutdown 通道 + 状态）
pub struct ControlHandle(pub Mutex<Option<(Arc<control::ControlState>, control::ControlServer)>>);

/// sj 静态资源目录：生产=resource_dir/resources/sj，开发=CARGO_MANIFEST_DIR/../resources/sj
fn sj_static_root(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(rd) = app.path().resource_dir() {
        let p = rd.join("resources").join("sj");
        if p.join("index.html").exists() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("sj")
}

fn start_control(app: &tauri::AppHandle, port: u16, auth_mode: &str) -> Result<Value, String> {
    // 已在运行则先停掉
    {
        let state = app.state::<ControlHandle>();
        let mut guard = state.0.lock().unwrap();
        if guard.is_some() {
            drop(guard);
            drop(state);
            stop_control(app);
        }
    }
    let root = sj_static_root(app);
    let injector = control::Injector::start(root.join("inject.ps1"));
    let code = control::new_pair_code_pub();
    let st = Arc::new(control::ControlState {
        port,
        auth_mode: auth_mode.to_string(),
        static_tokens: vec![],
        pair_code: Mutex::new(code.clone()),
        sessions: Mutex::new(HashMap::new()),
        recent_input: Mutex::new(Vec::new()),
        clip_history: Mutex::new(Vec::new()),
        clip_busy: std::sync::atomic::AtomicBool::new(false),
        injector,
        static_root: root,
        running: std::sync::atomic::AtomicBool::new(false),
    });
    let server = tauri::async_runtime::block_on(control::spawn_server(st.clone()))?;
    *app.state::<ControlHandle>().0.lock().unwrap() = Some((st.clone(), server));
    Ok(json!({
        "ok": true,
        "running": true,
        "port": port,
        "authMode": auth_mode,
        "pairCode": code,
        "injector": st.injector.is_ready(),
        "urls": control::lan_urls_pub(port),
    }))
}

fn stop_control(app: &tauri::AppHandle) {
    if let Some((st, server)) = app.state::<ControlHandle>().0.lock().unwrap().take() {
        let _ = server.shutdown.send(true);
        st.running.store(false, std::sync::atomic::Ordering::SeqCst);
        log::info!("[control] 已停止 :{}", server.port);
    }
}

/// 托盘菜单事件 → 主窗口显示/退出
fn handle_tray_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "show" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// 主面板开关（Alt+Space，与 Electron toggleWindow 一致：可见则隐藏，否则唤起）
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(ControlHandle(std::sync::Mutex::new(None)))
        .plugin(
            // 全局快捷键（键位与 Electron 版一致）：Alt+Space 壳内消化；
            // Alt+I/Alt+U/Alt+S/Alt+D 以事件转发前端（灵动岛/任务墙/截图在 M3/M5 接线）
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        // 插件键名为 W3C code 格式（alt+keyi/alt+keys…），兼容 alt+x 简写
                        let key = shortcut.into_string().to_lowercase();
                        let norm = key.replace("key", "");
                        log::info!("[hotkey] 触发: {} -> {}", key, norm);
                        match norm.as_str() {
                            "alt+space" => toggle_main_window(app),
                            "alt+i" => windows::toggle_island(app),
                            "alt+u" => {
                                // 与 Electron taskListHotkey 一致：存在则销毁，否则创建
                                if app.get_webview_window("tasklist").is_some() {
                                    windows::destroy_tasklist(app);
                                } else {
                                    let _ = windows::ensure_tasklist(app);
                                }
                            }
                            "alt+s" => { let _ = app.emit("electron:shortcut", "screenshot-full"); }
                            "alt+d" => { let _ = app.emit("electron:shortcut", "screenshot-region"); }
                            _ => {}
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // 文件日志最先初始化（%LOCALAPPDATA%\com.wanan.shortcut\logs\tauri.log）
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("tauri".into()) }),
                    ])
                    .build(),
            )?;

            // 配置损坏自愈（与 Electron 启动行为一致）
            config::restore_from_backup_if_needed();

            // 注册全局快捷键（注册失败写日志——Electron 版同名键位如果被占也需要知道）
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let gs = app.global_shortcut();
                for k in ["alt+space", "alt+i", "alt+u", "alt+s", "alt+d"] {
                    match gs.register(k) {
                        Ok(_) => log::info!("[hotkey] 注册成功: {}", k),
                        Err(e) => log::error!("[hotkey] 注册失败: {} ({})", k, e),
                    }
                }
            }

            // 主窗口：Rust builder 创建（initialization_script 只能挂在 builder 上；conf 不再定义窗口）
            let win = app
                .get_webview_window("main")
                .unwrap_or_else(|| {                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                        .title("ShortCut")
                        .inner_size(1280.0, 800.0)
                        .min_inner_size(960.0, 640.0)
                        .resizable(true)
                        .initialization_script(SHIM_JS)
                        .build()
                        .expect("failed to build main window")
                });
            let _ = win;

            // 托盘：显示主面板 / 退出
            let show = MenuItem::with_id(app, "show", "显示主面板", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_tray_event(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    // 左键单击 = 显示主面板
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![electron_api])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

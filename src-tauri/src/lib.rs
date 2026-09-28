//! ShortCut Tauri 2 壳——M1 最小壳
//! 设计：前端 electronAPI shim（initialization_script 注入）→ 统一 invoke `electron_api` 命令
//! → 本文件 match 分发。未实现的 method 返回 Null 兜底，前端不崩；按里程碑逐步补齐。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

mod cloud;
mod license;
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

        // ---- M4 云控制（wss relay；与局域网模式互斥）----
        "startCloudControl" => match cloud::start_cloud(sj_static_root(&app)) {
            Ok(_handle) => {
                app.state::<CloudHandleState>().0.lock().unwrap().replace(_handle);
                let state = app.state::<CloudHandleState>().0.lock().unwrap().as_ref().map(|h| h.state.status_json()).unwrap_or(json!({}));
                json!({ "success": true, "status": state })
            }
            Err(e) => json!({ "success": false, "error": e }),
        },
        "stopCloudControl" => {
            let state = app.state::<CloudHandleState>();
            if let Some(h) = state.0.lock().unwrap().take() {
                let _ = h.shutdown.send(true);
            }
            json!({ "ok": true })
        }
        "getCloudControlStatus" => {
            let state = app.state::<CloudHandleState>();
            let guard = state.0.lock().unwrap();
            match guard.as_ref() {
                Some(h) => h.state.status_json(),
                None => json!({ "active": false, "connected": false, "connecting": false, "injector": false, "lastError": "" }),
            }
        }


        // ---- M5：任务墙数据（config.scTaskList + taskBoards.notes，语义照抄 Electron）----
        "getTaskList" => {
            let cfg = task_cfg(&app);
            json!(resolve_task_list(&cfg))
        }
        "addTaskFromDrag" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !board_id.is_empty() && !task_id.is_empty() {
                let raw = config::read_config();
                let mut cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
                if let Some(list) = cfg.as_object_mut().unwrap().entry("scTaskList").or_insert_with(|| json!([])).as_array_mut() {
                    let dup = list.iter().any(|e| e.get("boardId").and_then(|v| v.as_str()) == Some(board_id.as_str()) && e.get("taskId").and_then(|v| v.as_str()) == Some(task_id.as_str()));
                    if !dup {
                        list.push(json!({ "boardId": board_id, "taskId": task_id, "addedAt": chrono::Local::now().timestamp_millis() }));
                        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
                    }
                }
            }
            json!(resolve_task_list(&task_cfg(&app)))
        }
        "completeTaskInList" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            json!({ "ok": patch_task_flag(&app, board_id, task_id, true) })
        }
        "removeTaskFromList" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let raw = config::read_config();
            let mut cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
            let mut changed = false;
            if let Some(list) = cfg.as_object_mut().unwrap().get_mut("scTaskList").and_then(|v| v.as_array_mut()) {
                let before = list.len();
                list.retain(|e| !(e.get("boardId").and_then(|v| v.as_str()) == Some(board_id) && e.get("taskId").and_then(|v| v.as_str()) == Some(task_id)));
                changed = list.len() != before;
            }
            if changed {
                config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
            }
            json!({ "ok": changed })
        }
        "locateTaskFromList" => {
            let board_id = args.first().cloned().unwrap_or(Value::Null);
            let task_id = args.get(1).cloned().unwrap_or(Value::Null);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = app.emit("electron:TaskLocate", json!({ "boardId": board_id, "taskId": task_id }));
            }
            Value::Null
        }

        // ---- M5：翻译（代理 API，对齐 main.ts translateText）----
        "translateText" => {
            let text = args.first().and_then(|v| v.as_str()).unwrap_or("").trim().chars().take(5000).collect::<String>();
            let from = args.get(1).and_then(|v| v.as_str()).unwrap_or("auto").to_string();
            let to = args.get(2).and_then(|v| v.as_str()).unwrap_or("zh").to_string();
            const LANGS: [&str; 14] = ["auto","zh","en","jp","kor","fra","de","ru","spa","ara","th","it","pt","vie"];
            if text.is_empty() {
                json!({ "success": false, "error": "请输入需要翻译的文字" })
            } else if !LANGS.contains(&from.as_str()) || !LANGS.contains(&to.as_str()) || to == "auto" {
                json!({ "success": false, "error": "不支持的语言类型" })
            } else {
                match tauri::async_runtime::block_on(async {
                    tokio::task::spawn_blocking(move || {
                        let resp = ureq::post("https://shortcut.326415.xyz/api/translate")
                            .timeout(std::time::Duration::from_millis(12_000))
                            .send_json(json!({ "text": text, "from": from, "to": to }))
                            .map_err(|e| e.to_string())?;
                        resp.into_json::<Value>().map_err(|e| e.to_string())
                    }).await.map_err(|e| e.to_string())?
                }) {
                    Ok(payload) => payload,
                    Err(e) => json!({ "success": false, "error": e }),
                }
            }
        }

        // ---- M5：网站图标（抓页面找 favicon → data:URL）----
        "getWebsiteIcon" => {
            let raw = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            match tauri::async_runtime::block_on(async {
                tokio::task::spawn_blocking(move || fetch_website_icon(&raw)).await
                    .map_err(|e| e.to_string())?
            }) {
                Ok(icon) => icon,
                Err(_) => Value::Null,
            }
        }

        // ---- M5：绑定身份读取（config.sync 节，对齐 sync/binding.ts getStoredBinding）----
        "syncGetBinding" => {
            let cfg = task_cfg(&app);
            let sync = cfg.get("sync").cloned().unwrap_or(json!({}));
            let bind_id = sync.get("bindId").and_then(|v| v.as_str()).unwrap_or("");
            if bind_id.is_empty() {
                Value::Null
            } else {
                json!({
                    "bindId": bind_id,
                    "code": sync.get("bindCode").and_then(|v| v.as_str()).unwrap_or(""),
                    "bindUrl": sync.get("bindUrl").and_then(|v| v.as_str()).unwrap_or("")
                })
            }
        }

        // ---- M5：更新检查（读 electron-updater latest.yml 对比版本；完整下载安装 M6 接 tauri updater）----
        "getUpdateState" => {
            json!({ "status": "idle", "checking": false, "downloading": false })
        }
        "checkForUpdates" => {
            match tauri::async_runtime::block_on(async {
                tokio::task::spawn_blocking(|| {
                    let resp = ureq::get("https://shortcut.326415.xyz/updates/latest.yml")
                        .timeout(std::time::Duration::from_millis(10_000))
                        .call()
                        .map_err(|e| e.to_string())?;
                    resp.into_string().map_err(|e| e.to_string())
                }).await.map_err(|e| e.to_string())?
            }) {
                Ok(yml) => {
                    let latest = yml.lines()
                        .find_map(|l| l.strip_prefix("version: ").map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string()))
                        .unwrap_or_default();
                    let current = app.package_info().version.to_string();
                    let has_update = version_gt(&latest, &current);
                    json!({ "status": if has_update { "available" } else { "up-to-date" }, "current": current, "version": latest, "hasUpdate": has_update })
                }
                Err(e) => json!({ "status": "error", "error": e }),
            }
        }

        // ---- M5：文件系统 ----
        "fileExists" => {
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("");
            json!(std::path::Path::new(p).exists())
        }
        "getFileInfo" => {
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("");
            match std::fs::metadata(p) {
                Ok(m) => json!({
                    "exists": true,
                    "isFile": m.is_file(),
                    "isDirectory": m.is_dir(),
                    "size": m.len(),
                    "modified": m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64),
                }),
                Err(_) => json!({ "exists": false }),
            }
        }
        "getFileIcon" => {
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            json!(file_icon_cached(&p))
        }
        "getFileIcons" => {
            let paths: Vec<String> = args.first().and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
            let mut out = Vec::new();
            for p in &paths {
                out.push(json!({ "path": p, "icon": file_icon_cached(p) }));
            }
            json!(out)
        }
        "runBat" => {
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !p.is_empty() && std::path::Path::new(&p).exists() {
                let _ = std::process::Command::new("cmd").args(["/C", &p]).creation_flags(0x08000000).spawn();
                json!({ "ok": true })
            } else {
                json!({ "ok": false, "error": "not found" })
            }
        }
        "getInstalledSoftware" => {
            json!(tauri::async_runtime::block_on(async {
                tokio::task::spawn_blocking(|| {
                    let ps = "$ErrorActionPreference='SilentlyContinue';$out=@();Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | ForEach-Object { if($_.DisplayName){ $out += [PSCustomObject]@{ name=$_.DisplayName; version=$_.DisplayVersion; publisher=$_.Publisher; installDate=$_.InstallDate } } }; $out | ConvertTo-Json -Compress -Depth 2";
                    match std::process::Command::new("powershell.exe")
                        .args(["-NoProfile", "-NonInteractive", "-Command", ps])
                        .creation_flags(0x08000000)
                        .output()
                    {
                        Ok(o) => {
                            let text = String::from_utf8_lossy(&o.stdout);
                            serde_json::from_str::<Value>(&text).unwrap_or(json!([]))
                        }
                        Err(_) => json!([]),
                    }
                }).await.unwrap_or(json!([]))
            }))
        }

        // ---- M5：激活授权（license 系列，对齐 license:* IPC）----
        "getLicenseState" => {
            let mut st = license::read_license_pub();
            if let Some(obj) = st.as_object_mut() {
                obj.insert("machineCode".into(), json!(license::machine_code()));
            }
            st
        }
        "activateLicense" => {
            let code = args.first().and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let result = license::check_license(&app, Some(code.clone()));
            let success = result.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let mut out = result;
            if let Some(obj) = out.as_object_mut() {
                obj.insert("code".into(), json!(code));
                obj.insert("status".into(), json!(if success { "active" } else { "invalid" }));
            }
            license::broadcast_gate(&app);
            out
        }
        "getLicensePolicy" => license::license_request_pub(
            "policy",
            json!({ "machineCode": license::machine_code(), "clientInfo": license::client_info(&app) }),
        )
        .unwrap_or_else(|_| json!({ "success": false, "message": "无法连接激活服务器" })),
        "startTrial" => {
            let result = license::license_request_pub(
                "trial",
                json!({ "machineCode": license::machine_code(), "clientInfo": license::client_info(&app) }),
            )
            .unwrap_or_else(|_| json!({ "success": false, "message": "无法连接激活服务器" }));
            let success = result.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let got_code = result.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if success && !got_code.is_empty() {
                license::write_license_pub(&app, json!({
                    "code": got_code,
                    "machineCode": license::machine_code(),
                    "plan": result.get("tier").cloned().unwrap_or(Value::Null),
                    "status": "active",
                    "expiresAt": result.get("expiresAt").cloned().unwrap_or(Value::Null),
                    "lastCheckAt": chrono::Local::now().to_rfc3339(),
                    "message": result.get("message").cloned().unwrap_or(Value::Null),
                    "tier": result.get("tier").cloned().unwrap_or(Value::Null),
                    "activationPolicy": result.get("activationPolicy").cloned().unwrap_or(Value::Null),
                    "moduleAccess": result.get("moduleAccess").cloned().unwrap_or(Value::Null),
                    "featureAccess": result.get("featureAccess").cloned().unwrap_or(Value::Null),
                    "guestEnabled": result.get("guestEnabled").cloned().unwrap_or(Value::Null),
                    "contactLine": result.get("contactLine").cloned().unwrap_or(Value::Null),
                }));
                license::broadcast_gate(&app);
            }
            let mut out = result;
            if let Some(obj) = out.as_object_mut() {
                obj.insert("machineCode".into(), json!(license::machine_code()));
            }
            out
        }
        "checkLicenseCmd" => license::check_license(&app, None),
        "getLicenseGate" => license::gate_payload(&app, Some(license::check_license(&app, None))),
        "licenseGatePassed" => {
            // gate 通过：任务墙按需创建（island.tasksEnabled !== false 且有任务）
            let cfg = task_cfg(&app);
            let tasks_enabled = cfg.get("island").and_then(|i| i.get("tasksEnabled")).and_then(|v| v.as_bool()).unwrap_or(true);
            if tasks_enabled && !resolve_task_list(&cfg).is_empty() {
                let _ = windows::ensure_tasklist(&app);
            }
            json!(true)
        }
        // ---- 未迁移方法兜底：返回空对象，前端不崩（按里程碑补齐）----
        _ => {
            log::debug!("[shim] 未实现的 electronAPI 方法: {}", method);
            Value::Null
        }
    }
}


/// M5 任务墙：读 config（供 resolve）
fn task_cfg(_app: &tauri::AppHandle) -> Value {
    let raw = config::read_config();
    if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) }
}

/// M5 任务墙：scTaskList → 渲染条目（剔除失效引用，对齐 resolveTaskList）
fn resolve_task_list(cfg: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let list = match cfg.get("scTaskList").and_then(|v| v.as_array()) {
        Some(l) => l.clone(),
        None => return out,
    };
    for entry in &list {
        let board_id = entry.get("boardId").and_then(|v| v.as_str()).unwrap_or("");
        let task_id = entry.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
        let task = cfg.get("taskBoards").and_then(|b| b.as_array())
            .and_then(|boards| boards.iter().find(|b| b.get("id").and_then(|v| v.as_str()) == Some(board_id)))
            .and_then(|b| b.get("notes").and_then(|n| n.as_array()))
            .and_then(|notes| notes.iter().find(|n| n.get("id").and_then(|v| v.as_str()) == Some(task_id)));
        if let Some(task) = task {
            out.push(json!({
                "boardId": board_id,
                "taskId": task_id,
                "title": task.get("text").and_then(|v| v.as_str()).unwrap_or("无标题任务"),
                "done": task.get("done").and_then(|v| v.as_bool()).unwrap_or(false),
                "addedAt": entry.get("addedAt").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    out
}

/// M5 任务墙：置任务 done 标志（写回 config.taskBoards）
fn patch_task_flag(_app: &tauri::AppHandle, board_id: &str, task_id: &str, done: bool) -> bool {
    let raw = config::read_config();
    let mut cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let mut changed = false;
    if let Some(boards) = cfg.as_object_mut().unwrap().get_mut("taskBoards").and_then(|v| v.as_array_mut()) {
        if let Some(board) = boards.iter_mut().find(|b| b.get("id").and_then(|v| v.as_str()) == Some(board_id)) {
            if let Some(notes) = board.get_mut("notes").and_then(|n| n.as_array_mut()) {
                if let Some(note) = notes.iter_mut().find(|n| n.get("id").and_then(|v| v.as_str()) == Some(task_id)) {
                    if let Some(obj) = note.as_object_mut() {
                        obj.insert("done".into(), json!(done));
                        changed = true;
                    }
                }
            }
        }
    }
    if changed {
        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    }
    changed
}

/// M5 网站图标：抓 HTML 找 favicon → 抓图标 → data:URL（对齐 getWebsiteIcon）
fn fetch_website_icon(raw: &str) -> Result<Value, String> {
    let url = raw.trim();
    let page_url = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{}", url.trim_start_matches('/'))
    };
    let resp = ureq::get(&page_url)
        .timeout(std::time::Duration::from_millis(6_000))
        .set("Accept", "text/html,application/xhtml+xml")
        .call()
        .map_err(|e| e.to_string())?;
    let final_url = resp.get_url().to_string();
    let html: String = resp.into_string().unwrap_or_default().chars().take(512 * 1024).collect();
    // link[rel~=icon] href
    let mut icon_url: Option<String> = None;
    for cap_off in html.match_indices("<link") {
        let tag_end = html[cap_off.0..].find('>').map(|i| cap_off.0 + i).unwrap_or(html.len());
        let tag = &html[cap_off.0..tag_end];
        let lower = tag.to_lowercase();
        if lower.contains("rel") && lower.contains("icon") && !lower.contains("apple-touch") {
            if let Some(href_pos) = lower.find("href") {
                let rest = &tag[href_pos..];
                if let Some(eq) = rest.find('=') {
                    let after = rest[eq + 1..].trim_start();
                    if let Some(q1) = after.find('"') {
                        if let Some(q2) = after[q1 + 1..].find('"') {
                            icon_url = Some(after[q1 + 1..q1 + 1 + q2].to_string());
                            break;
                        }
                    }
                }
            }
        }
    }
    let icon_url = match icon_url {
        Some(u) => {
            if u.starts_with("http://") || u.starts_with("https://") {
                u
            } else if u.starts_with("//") {
                format!("https:{}", u)
            } else if u.starts_with('/') {
                let origin = final_url.split("/").take(3).collect::<Vec<_>>().join("/");
                format!("{}{}", origin, u)
            } else {
                format!("{}/{}", final_url.trim_end_matches('/'), u)
            }
        }
        None => {
            // origin/favicon.ico 兜底
            let origin = final_url.split("/").take(3).collect::<Vec<_>>().join("/");
            format!("{}/favicon.ico", origin)
        }
    };
    let icon = ureq::get(&icon_url)
        .timeout(std::time::Duration::from_millis(6_000))
        .set("Accept", "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8")
        .call()
        .map_err(|e| e.to_string())?;
    let mime_full = icon.content_type().to_string();
    let mime = mime_full.split(';').next().unwrap_or("image/x-icon").to_string();
    let mut buf = Vec::new();
    icon.into_reader().take(300 * 1024).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(json!(format!("data:{};base64,{}", mime, control::base64_encode(&buf))))
}

/// M5：语义化版本比较（latest > current 才提示更新）
fn version_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v').split('.').map(|p| p.chars().filter_map(|c| c.to_digit(10)).fold(0u64, |acc, d| acc * 10 + d as u64)).collect()
    };
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..3 {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y { return x > y; }
    }
    false
}

/// M5：文件图标提取（PowerShell ExtractAssociatedIcon + icons 目录缓存）
fn file_icon_cached(path: &str) -> Value {
    if path.is_empty() || !std::path::Path::new(path).exists() {
        return Value::Null;
    }
    // 缓存键：路径哈希（FNV-1a）+ 文件名
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let fname = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let cache = config::icons_dir().join(format!("fileicon-{:016x}-{}.png", hash, fname.chars().filter(|c| c.is_ascii_alphanumeric()).take(20).collect::<String>()));
    if let Ok(data) = std::fs::read(&cache) {
        return json!(format!("data:image/png;base64,{}", control::base64_encode(&data)));
    }
    // PowerShell 提取
    let esc = path.replace('\'', "''");
    let ps = format!(
        "$ErrorActionPreference='SilentlyContinue';Add-Type -AssemblyName System.Drawing;$i=[System.Drawing.Icon]::ExtractAssociatedIcon('{}');if($i){{$ms=New-Object IO.MemoryStream;$i.ToBitmap().Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))}}",
        esc
    );
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .creation_flags(0x08000000)
        .output();
    if let Ok(o) = out {
        let b64 = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !b64.is_empty() {
            if let Ok(bytes) = use_base64_decode(&b64) {
                let _ = std::fs::create_dir_all(config::icons_dir());
                let _ = std::fs::write(&cache, &bytes);
            }
            return json!(format!("data:image/png;base64,{}", b64));
        }
    }
    Value::Null
}

/// 简易 base64 解码（仅缓存写入用）
fn use_base64_decode(s: &str) -> Result<Vec<u8>, ()> {
    const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut vals = Vec::with_capacity(s.len());
    for b in s.bytes() {
        if b == b'=' || b == b'\r' || b == b'\n' { continue; }
        vals.push(TBL.iter().position(|t| *t == b).ok_or(())? as u32);
    }
    let mut out = Vec::with_capacity(vals.len() * 3 / 4);
    for chunk in vals.chunks(4) {
        if chunk.len() < 2 { break; }
        let n = (chunk[0] << 18) | (chunk[1] << 12) | (chunk.get(2).copied().unwrap_or(0) << 6) | chunk.get(3).copied().unwrap_or(0);
        out.push((n >> 16) as u8);
        if chunk.len() > 2 { out.push((n >> 8) as u8); }
        if chunk.len() > 3 { out.push(n as u8); }
    }
    Ok(out)
}
/// 下载/主目录等兜底解析
fn dirs_home() -> std::path::PathBuf {
    std::env::var("USERPROFILE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// M4 控制服务句柄（shutdown 通道 + 状态）
pub struct ControlHandle(pub Mutex<Option<(Arc<control::ControlState>, control::ControlServer)>>);

/// M4 云控制句柄
pub struct CloudHandleState(pub Mutex<Option<cloud::CloudHandle>>);

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
        let guard = state.0.lock().unwrap();
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
        .manage(CloudHandleState(std::sync::Mutex::new(None)))
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

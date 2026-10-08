//! ShortCut Tauri 2 壳——M1 最小壳
//! 设计：前端 electronAPI shim（initialization_script 注入）→ 统一 invoke `electron_api` 命令
//! → 本文件 match 分发。未实现的 method 返回 Null 兜底，前端不崩；按里程碑逐步补齐。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::Update as UpdaterUpdate;

static UPDATE_PENDING: std::sync::OnceLock<Mutex<Option<(UpdaterUpdate, Vec<u8>)>>> = std::sync::OnceLock::new();

fn update_pending() -> &'static Mutex<Option<(UpdaterUpdate, Vec<u8>)>> {
    UPDATE_PENDING.get_or_init(|| Mutex::new(None))
}

/// 启动参数 / 右键菜单带来的待处理文件（前端挂载时 take 走）
/// (paths, action) —— action ∈ {"convert", "extract"}
static PENDING_DROP: Mutex<Option<(Vec<String>, String)>> = Mutex::new(None);

/// 转换板块"失焦不自动隐藏"守卫：前端切到转换页时置 true。
/// 拖文件进面板时焦点在资源管理器上，若此时按 closeOnBlur 隐藏，拖放必然失败。
static BLUR_GUARD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 冷启动专为右键"直接执行"而启动：不显示主窗/岛屿，干完退出（"不走软件"）

/// 把命令行带来的文件交给前端：写 pending + 发事件（两路都走，谁先到都能拿到）
fn queue_drop(app: &tauri::AppHandle, paths: Vec<String>, action: String) {
    if paths.is_empty() {
        log::info!("[drop] queue_drop 收到空文件列表 action={}（忽略）", action);
        return;
    }
    log::info!("[drop] queue_drop action={} 文件数={} 首个={:?}", action, paths.len(), paths.first());
    if let Ok(mut guard) = PENDING_DROP.lock() {
        // 连续两次右键时合并，避免后者覆盖前者
        match guard.as_mut() {
            Some((existing, act)) if *act == action => {
                for p in paths.iter() {
                    if !existing.contains(p) {
                        existing.push(p.clone());
                    }
                }
            }
            _ => *guard = Some((paths.clone(), action.clone())),
        }
    }
    let merged = PENDING_DROP
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or((paths, action));
    match app.emit(
        "converter:drop",
        serde_json::json!({ "paths": merged.0, "action": merged.1, "fromShell": true }),
    ) {
        Ok(_) => log::info!("[drop] 已 emit converter:drop（前端挂载前会丢，靠 pending 兜底）"),
        Err(e) => log::error!("[drop] emit converter:drop 失败: {}", e),
    }
}
use tauri:: {
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

mod cloud;
mod codex;
mod voice;
mod license;
mod sidecar;
mod sync;
mod transfer;
/// 移动互联统一枢纽：身份 / 请求 / 模块注册表的**唯一入口**（sync/transfer/cloud 共用）
mod hub;
/// rpc 能力（手机一次性指令 → 桌面执行 → 回执）
mod rpc;
mod config;
mod control;
mod converter;
mod directcmd;
mod shellmenu;
mod webviewdrop;
mod usage;
mod windows;
/// 游戏模式（冻结后台）：托盘菜单一键开关，无额外热键
mod freeze;

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
    const EVENT_ALIASES = {
      onIslandMusic: 'electron:IslandMusic',
      onIslandCockpit: 'electron:IslandCockpit',
      onCockpitData: 'electron:CockpitData',
      onTaskLocate: 'electron:TaskLocate',
      onLicenseChanged: 'electron:LicenseChanged',
      onReminderData: 'electron:ReminderData',
      onConfigChanged: 'config:changed',
      onIslandConfig: 'island:config',
      onTaskListData: 'tasklist:data',
      onUpdateState: 'update:state',
      onShortcutFailed: 'shortcut:failed',
      onWindowWillShow: 'window:will-show',
      onBalanceMerge: 'balance:merge',
      onDeepseekMerge: 'deepseek:merge',
      onVoiceStatus: 'voice:status',
      onVoiceSession: 'voice:session',
      onVoicePolish: 'voice:polish',
      onVoicePolishError: 'voice:polishError',
      onConverterDrop: 'converter:drop',
      onConverterDragover: 'converter:dragover',
  onBallDragover: 'ball:dragover',
  onBallDrop: 'ball:drop',
  onBallPassthrough: 'ball:passthrough',
      onConverterProgress: 'converter:progress',
      onConverterDone: 'converter:done',
      onConverterError: 'converter:error',
    };
    const api = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (EVENT_ALIASES[prop]) {
          const ev = EVENT_ALIASES[prop];
          return (cb) => {
            try {
              const p = window.__TAURI__.event.listen(ev, (e) => {
                if (ev === 'island:config') {
                  const pv = e && e.payload ? e.payload : null;
                  try { window.__TAURI__.core.invoke('electron_api', { method: 'debugLog', args: ['收到 island:config @' + location.pathname + ' style=' + (pv && pv.style) + ' display=' + (pv && pv.displayState)] }); } catch (_) {}
                }
                try { cb(e.payload); } catch (err) { try { window.__TAURI__.core.invoke('electron_api', { method: 'debugLog', args: ['回调异常 ' + ev + ': ' + err] }); } catch (_) {} }
              });
              try { window.__TAURI__.core.invoke('electron_api', { method: 'debugLog', args: ['listen注册: ' + ev] }); } catch (_) {}
              if (p && typeof p.then === 'function') {
                let unlisten = null;
                p.then((fn) => { unlisten = fn; }).catch(() => { try { window.__TAURI__.core.invoke('electron_api', { method: 'debugLog', args: ['listen失败: ' + ev] }); } catch (_) {} });
                return () => { if (unlisten) { try { unlisten(); } catch (_) {} } else { p.then((fn) => { try { fn(); } catch (_) {} }).catch(() => {}); } };
              }
              return p;
            } catch (_) { return () => {}; }
          };
        }
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
async fn electron_api(app: tauri::AppHandle, window: tauri::WebviewWindow, method: String, args: Vec<Value>) -> Value {
    // async 命令：跑在 Tauri 运行时线程池——同步命令会占主线程，
    // 其中的 block_on 会死锁（唤醒信号也要走主线程消息循环 → 转圈圈不返回）
    match method.as_str() {
        // ---- 应用信息 ----
        "getAppVersion" | "getVersion" => json!(app.package_info().version.to_string()),
        "getAppName" => json!(app.package_info().name.clone()),
        "getPlatform" => json!("win32"),

        // ---- 窗口控制 ----
        "minimizeWindow" => { let _ = window.minimize(); Value::Null }
        "maximizeWindow" => { let _ = window.is_maximized().map(|m| if m { let _ = window.unmaximize(); } else { let _ = window.maximize(); }); Value::Null }
        "hideWindow" => { let _ = window.hide(); Value::Null }
        "closeWindow" => { let _ = window.hide(); Value::Null } // 主窗口关闭=隐藏到托盘（与 Electron 行为一致）
        "resizeWindow" => {
            // 内容自适应窗口（任务墙高度跟随任务条目数；窗口=发起 invoke 的窗口）
            let w = args.first().and_then(|v| v.as_f64()).unwrap_or(0.0);
            let h = args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
            if w >= 1.0 && h >= 1.0 {
                let _ = window.set_size(tauri::LogicalSize::new(w, h));
            }
            Value::Null
        }
        // ── 资源管理器右键菜单（P3）──
        "setBlurGuard" => {
            // 转换板块：拖放期间焦点在资源管理器，不能按 closeOnBlur 隐藏
            let on = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            BLUR_GUARD.store(on, std::sync::atomic::Ordering::Relaxed);
            log::info!("[blur] 失焦隐藏守卫 = {}", on);
            json!({ "success": true, "guard": on })
        }
        // 前端日志通道（拖放/右键菜单链路排查用，写进 tauri.log）
        "debugLog" => {
            let msg = args.first().and_then(|v| v.as_str()).unwrap_or("");
            log::info!("[fe] {}", msg);
            Value::Null
        }
        "shellMenuState" => {
            let (_, format) = shellmenu::load_settings();
            json!({
                "available": shellmenu::available(),
                "enabled": shellmenu::is_enabled(),
                "format": format,
                "formats": shellmenu::COMPRESS_FORMATS,
            })
        }
        "shellMenuSet" => {
            let enabled = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            let format = args.get(1).and_then(|v| v.as_str()).unwrap_or("zip");
            match shellmenu::set_enabled_with_format(enabled, format) {
                Ok(state) => json!({ "success": true, "enabled": state, "format": shellmenu::normalize_format(format) }),
                Err(e) => json!({ "success": false, "enabled": false, "error": e }),
            }
        }
        // 前端挂载时取走启动参数/右键菜单带来的文件（取走即清空）
        "converterTakePending" => {
            let pending = PENDING_DROP
                .lock()
                .ok()
                .and_then(|mut guard| guard.take());
            match pending {
                Some(p) => json!({ "paths": p.0, "action": p.1 }),
                None => Value::Null,
            }
        }
        // ── SC 球（Batch 2：拖放转格式 + 穿透开关）──
        "ballShape" => {
            let shape = args.first().and_then(|v| v.as_str()).unwrap_or("collapsed");
            match windows::set_ball_shape(&app, shape) {
                Ok(()) => json!({ "success": true, "shape": shape }),
                Err(e) => json!({ "success": false, "error": e }),
            }
        }
        "ballPassthrough" => {
            let on = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            windows::set_ball_passthrough(&app, on);
            json!({ "success": true, "on": on })
        }
        "ballState" => json!({
            "passthrough": windows::ball_passthrough(),
            "shortcut": ball_passthrough_shortcut(),
        }),
        // 球菜单里的"打开转换面板"：把文件交给主面板（复用既有 pending 通道，会自动切模块）
        "ballOpenInPanel" => {
            let paths: Vec<String> = args
                .first()
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            queue_drop(&app, paths, "convert".into());
            json!({ "success": true })
        }
        // ── 转换板块（docs/文件转换板块开发计划.md）──
        "converterDetect" => {
            let paths: Vec<String> = args
                .first()
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            json!(converter::detect_files(paths))
        }
        "converterConvert" => {
            let id = converter::uuid_like::new_id();
            let src = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let target = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let quality = args.get(2).and_then(|v| v.as_f64()).unwrap_or(85.0) as u8;
            let bitrate = args.get(3).and_then(|v| v.as_f64()).unwrap_or(192.0) as u32;
            let out_dir = args.get(4).and_then(|v| v.as_str()).map(String::from);
            converter::start_convert(app.clone(), id.clone(), src, target, quality, bitrate, out_dir);
            json!({ "success": true, "id": id })
        }
        "converterExtract" => {
            let id = converter::uuid_like::new_id();
            let src = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let password = args.get(1).and_then(|v| v.as_str()).map(String::from);
            let out_dir = args.get(2).and_then(|v| v.as_str()).map(String::from);
            converter::start_extract(app.clone(), id.clone(), src, password, out_dir);
            json!({ "success": true, "id": id })
        }
        "converterCompress" => {
            let id = converter::uuid_like::new_id();
            let paths: Vec<String> = args
                .first()
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let flavor = args.get(1).and_then(|v| v.as_str()).unwrap_or("zip").to_string();
            let out_path = args.get(2).and_then(|v| v.as_str()).map(String::from);
            let password = args.get(3).and_then(|v| v.as_str()).map(String::from);
            let level = args.get(4).and_then(|v| v.as_f64()).unwrap_or(6.0) as i64;
            converter::start_compress(app.clone(), id.clone(), paths, flavor, out_path, password, level);
            json!({ "success": true, "id": id })
        }
        // 转换完成后定位产物：打开所在目录并选中文件（目录则直接打开）
        // 需求见 docs/island-drop-convert-rework.md §2.4
        "revealInExplorer" => {
            let path = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            if path.is_empty() {
                json!({ "success": false, "error": "路径为空" })
            } else {
                let p = std::path::PathBuf::from(&path);
                let target = if p.is_dir() {
                    p.clone()
                } else {
                    p.parent().map(|d| d.to_path_buf()).unwrap_or_else(|| p.clone())
                };
                let exists = target.exists();
                if !exists {
                    log::warn!("[reveal] 目标不存在: {}", target.display());
                    json!({ "success": false, "error": "路径不存在" })
                } else if p.is_dir() {
                    // 目录：直接打开
                    match std::process::Command::new("explorer.exe").arg(&path).spawn() {
                        Ok(_) => {
                            log::info!("[reveal] 打开目录 {}", path);
                            json!({ "success": true })
                        }
                        Err(e) => json!({ "success": false, "error": e.to_string() }),
                    }
                } else {
                    // 文件：打开所在目录并选中（/select, 后不能有空格）
                    let arg = format!("/select,{}", path);
                    match std::process::Command::new("explorer.exe").arg(arg).spawn() {
                        Ok(_) => {
                            log::info!("[reveal] 打开并选中 {}", path);
                            json!({ "success": true })
                        }
                        Err(e) => json!({ "success": false, "error": e.to_string() }),
                    }
                }
            }
        }
        "converterPickFiles" => {
            use tauri_plugin_dialog::DialogExt;
            let app2 = app.clone();
            let files = tauri::async_runtime::spawn_blocking(move || {
                app2.dialog().file().blocking_pick_files()
            })
            .await
            .unwrap_or(None);
            json!(files.map(|list| list.iter().map(|f| f.to_string()).collect::<Vec<_>>()))
        }
        "converterPickDir" => {
            use tauri_plugin_dialog::DialogExt;
            let app2 = app.clone();
            let dir = tauri::async_runtime::spawn_blocking(move || {
                app2.dialog().file().blocking_pick_folder()
            })
            .await
            .unwrap_or(None);
            json!(dir.map(|d| d.to_string()))
        }
        "converterHistory" => {
            json!(converter::history::load())
        }
        "converterHistoryRemove" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            if id == "clear" {
                converter::history::clear();
            } else if !id.is_empty() {
                converter::history::remove(id);
            }
            json!({ "success": true })
        }
        "showWindow" => {
            // 仅从隐藏转显示时通知（已可见时重复 show 是 no-op，
            // 多余的 will-show 会让前端重置选中项/重播动画 → "点一下面板就刷新"）
            if !window.is_visible().unwrap_or(false) {
                let _ = app.emit("window:will-show", ());
            }
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            Value::Null
        }
        "quitApp" => { app.exit(0); Value::Null }

        // ---- 系统信息（占位：M2 补齐真实实现）----
        "getSystemInfo" => json!({ "platform": "win32", "arch": "x64", "release": "" }),

        // ---- M2：配置（%APPDATA%\ShortCut 硬兼容）----
        "readConfig" => {
            let mut raw = config::read_config();
            if raw.is_empty() {
                // 文件存在但读出空（锁冲突/竞态）→ 尝试从健康备份自愈后再读
                config::restore_from_backup_if_needed();
                raw = config::read_config();
                if !raw.is_empty() {
                    log::warn!("[config] readConfig 空读取，已从备份自愈 {} 字节", raw.len());
                }
            }
            log::info!("[config] readConfig 命令返回 {} 字节", raw.len());
            json!(raw)
        }
        "writeConfig" => {
            let data = args.first().and_then(|v| v.as_str()).unwrap_or("");
            log::info!("[config] writeConfig 命令收到 {} 字节", data.len());
            config::write_config(data);
            // 对齐 Electron config:write：只写文件 + syncModuleServices，零事件广播。
            // （主窗是发起者，config:changed/island:config 回声会让主窗全量重载 → 面板闪屏）
            sync_deepseekball_state(&app);
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
        "openTarget" => {
            // 用 opener 插件（ShellExecute）：原实现是 `cmd /C start "" <path>`，
            // 目标文件不存在时静默失败（转换失败/文件被移走 → 点了"没反应"），
            // 且会闪黑框、对特殊字符路径解析不可靠。
            use tauri_plugin_opener::OpenerExt;
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("").trim();
            if p.is_empty() {
                json!({ "success": false, "error": "路径为空" })
            } else {
                let path = std::path::Path::new(p);
                let target: Option<std::path::PathBuf> = if path.exists() {
                    Some(path.to_path_buf())
                } else {
                    // 文件不在了 → 退化为打开所在文件夹（避免"点了没反应"）
                    path.parent().filter(|d| d.exists()).map(|d| d.to_path_buf())
                };
                match target {
                    Some(t) => match app.opener().open_path(t.to_string_lossy().to_string(), None::<&str>) {
                        Ok(_) => json!({ "success": true, "opened": t.to_string_lossy() }),
                        Err(e) => json!({ "success": false, "error": format!("打开失败: {}", e) }),
                    },
                    None => json!({ "success": false, "error": format!("路径不存在: {}", p) }),
                }
            }
        }
        // ---- M5：文件选择对话框（tauri-plugin-dialog，对齐 dialog:* IPC）----
        "openFile" => {
            match app.dialog().file().blocking_pick_file() {
                Some(p) => json!(p.to_string()),
                None => Value::Null,
            }
        }
        "openImportFile" => {
            match app.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file() {
                Some(p) => json!(p.to_string()),
                None => Value::Null,
            }
        }
        "openIconFile" => {
            match app.dialog().file().add_filter("Images", &["png", "jpg", "jpeg", "webp", "ico", "svg"]).blocking_pick_file() {
                Some(p) => {
                    let path = p.to_string();
                    match std::fs::read(&path) {
                        Ok(data) => {
                            let mime = match path.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
                                "png" => "image/png",
                                "jpg" | "jpeg" => "image/jpeg",
                                "webp" => "image/webp",
                                "svg" => "image/svg+xml",
                                _ => "image/x-icon",
                            };
                            json!(format!("data:{};base64,{}", mime, control::base64_encode(&data)))
                        }
                        Err(_) => Value::Null,
                    }
                }
                None => Value::Null,
            }
        }
        "saveFile" => {
            let default_name = args.first().and_then(|v| v.as_str()).unwrap_or("export.json").to_string();
            match app.dialog().file().add_filter("JSON", &["json"]).set_file_name(&default_name).blocking_save_file() {
                Some(p) => json!(p.to_string()),
                None => Value::Null,
            }
        }
        "readFile" => {
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("");
            std::fs::read_to_string(p).map(|s| json!(s)).unwrap_or(Value::Null)
        }
        "writeFile" => {
            let p = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let data = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
            match std::fs::write(&p, data) {
                Ok(_) => json!({ "success": true }),
                Err(e) => json!({ "success": false, "error": e.to_string() }),
            }
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
            // 完整配置（前端任务墙设置页需要 tasksEnabled 等功能字段）
            let prefs = windows::island_full_prefs();
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
            // Electron 签名对齐（IslandPanel.updateIsland 传 12 个位置参数）：
            // setIsland(enabled, style, position, autoHideFullscreen, musicEnabled, lyricBounce,
            //           displayState, orbitGlow, barsEnabled, tasksEnabled, cockpitEnabled, provider)
            let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
            let patch = serde_json::Map::from_iter([
                ("enabled".to_string(), arg(0)),
                ("style".to_string(), arg(1)),
                ("position".to_string(), arg(2)),
                ("autoHideFullscreen".to_string(), arg(3)),
                ("musicEnabled".to_string(), arg(4)),
                ("lyricBounce".to_string(), arg(5)),
                ("displayState".to_string(), arg(6)),
                ("orbitGlow".to_string(), arg(7)),
                ("barsEnabled".to_string(), arg(8)),
                ("tasksEnabled".to_string(), arg(9)),
                ("cockpitEnabled".to_string(), arg(10)),
                ("balanceProvider".to_string(), arg(11)),
            ].into_iter().filter(|(_, v)| !v.is_null()));
            if !patch.is_empty() {
                log::info!("[island] setIsland patch 字段: {:?}", patch.keys().collect::<Vec<_>>());
                // 关键：窗口级响应判断必须用完整配置——island_prefs() 只有 5 个壳字段，
                // 之前 now.get("tasksEnabled") 恒为 None → unwrap_or(true) → 禁用永远不生效
                let was = windows::island_full_prefs();
                windows::patch_island_config(&app, Value::Object(patch));
                let now = windows::island_full_prefs();
                let enabled = now.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
                let display_changed = now.get("displayState") != was.get("displayState");
                // ── 岛窗口级响应（对齐 Electron applyConfig 的岛分支）──
                if !enabled {
                    // 启用开关关闭 → 隐藏岛（Electron destroyIslandWindow；隐藏可保留窗口以便快速恢复）
                    if let Some(win) = app.get_webview_window("island") {
                        let _ = win.hide();
                        log::info!("[island] 已按配置隐藏岛");
                    }
                } else if display_changed || app.get_webview_window("island").is_none() {
                    // 显示模式切换（collapsed/mini/expanded 尺寸位置不同）→ 重建窗口（前端重载后按新配置渲染）
                    if let Some(win) = app.get_webview_window("island") {
                        let _ = win.destroy();
                    }
                    match windows::ensure_island(&app) {
                        Ok(_) => log::info!("[island] 已按新模式重建岛"),
                        Err(e) => log::error!("[island] 重建失败: {}", e),
                    }
                    windows::position_deepseekball(&app);
                } else if let Some(win) = app.get_webview_window("island") {
                    let pos_changed = now.get("position") != was.get("position")
                        || now.get("x") != was.get("x")
                        || now.get("y") != was.get("y");
                    if pos_changed {
                        let (x, y, _, _) = windows::island_bounds(&app, &now);
                        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
                        windows::position_deepseekball(&app);
                    }
                    let _ = win.show();
                    // 显示态变化（collapsed/mini/expanded）→ 重算穿透，旁边小球跟随（Batch 2 迁移）
                    windows::apply_island_and_ball_passthrough(&app);
                }
                // ── 板块级响应 ──
                // 任务板块关闭 → 销毁任务墙 + 全部提醒窗（Electron islandTasksOk=false 分支）
                let tasks_ok = now.get("tasksEnabled").and_then(|v| v.as_bool()).unwrap_or(true);
                if !tasks_ok {
                    if let Some(w) = app.get_webview_window("tasklist") {
                        let _ = w.destroy();
                    }
                    for (label, w) in app.webview_windows() {
                        if label.starts_with("reminder") {
                            let _ = w.destroy();
                        }
                    }
                    log::info!("[island] 任务板块已关闭：任务墙/提醒窗已销毁");
                } else {
                    // 启用即默认显示（ensure_tasklist 内部用无激活显示，不抢主窗焦点）
                    match windows::ensure_tasklist(&app) {
                        Ok(_w) => {
                            log::info!("[island] 任务板块已启用：任务墙已显示");
                        }
                        Err(e) => log::error!("[island] 任务墙启用失败: {}", e),
                    }
                }
                // 音乐板块关闭 → 停音乐桥；开启 → 确保桥在跑（Electron islandMusicOk 分支）
                let music_ok = now.get("musicEnabled").and_then(|v| v.as_bool()).unwrap_or(true);
                let mh = app.state::<MusicHandle>();
                if !music_ok {
                    sidecar::stop_music_bridge(&mh.0);
                    log::info!("[island] 音乐板块已关闭：音乐桥已停止");
                } else if island_feature_ok(&app) {
                    sidecar::start_music_bridge(app.clone(), mh.0.clone());
                }
                // 事件广播（岛前端已确认能收到 island:config）
                // 关键：payload 必须是完整 island 配置（island_prefs 只有 5 个壳字段，
                // 之前用它导致前端 style/musicEnabled 等全部 undefined → 永远回退旧值）
                let full = windows::island_full_prefs();
                log::info!("[island] 广播 island:config style={} music={} cockpit={} provider={} display={}",
                    full.get("style").and_then(|v| v.as_str()).unwrap_or(""),
                    full.get("musicEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
                    full.get("cockpitEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
                    full.get("balanceProvider").and_then(|v| v.as_str()).unwrap_or(""),
                    full.get("displayState").and_then(|v| v.as_str()).unwrap_or(""));
                // 事件通知：对齐 Electron——island:config 只发岛窗口（webContents.send 语义）。
                // 不全局广播：主窗是发起者，回声会覆盖前端 state（开关跳回原状/面板重渲闪屏）。
                // Electron setIsland 里也没有 config:changed，删除。
                let full = windows::island_full_prefs();
                log::info!("[island] setIsland 通知 style={} music={} cockpit={} provider={} display={}",
                    full.get("style").and_then(|v| v.as_str()).unwrap_or(""),
                    full.get("musicEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
                    full.get("cockpitEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
                    full.get("balanceProvider").and_then(|v| v.as_str()).unwrap_or(""),
                    full.get("displayState").and_then(|v| v.as_str()).unwrap_or(""));
                if let Some(island) = app.get_webview_window("island") {
                    let _ = island.emit("island:config", full.clone());
                    let _ = island.emit("electron:IslandConfig", full.clone());
                }
                if let Some(ball) = app.get_webview_window("deepseekball") {
                    let _ = ball.emit("island:config", full.clone());
                }
                // SC 球对齐配置（Electron applyConfig 语义：provider 关/feature 关 → 销毁；球在 → 重建刷新样式）
                sync_deepseekball_state(&app);
                // 对齐 Electron return { success, island }：发起方（主窗/任务墙）凭返回值
                // 同步本地 store，避免后续全量回写用旧值覆盖他处刚改的开关
                return json!({ "success": true, "island": full });
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
        // M3 补齐：拖动增量移动（对齐 island:move——delta 逻辑像素，工作区夹紧）
        "moveIsland" => {
            let delta_x = args.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let delta_y = args.get(3).and_then(|v| v.as_f64()).unwrap_or(0.0);
            if let Some(win) = app.get_webview_window("island") {
                let pos = win.outer_position().unwrap_or_default();
                let size = win.outer_size().unwrap_or_default();
                let scale = win.current_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
                let (px, py, pw, ph) = (
                    pos.x as f64 / scale,
                    pos.y as f64 / scale,
                    size.width as f64 / scale,
                    size.height as f64 / scale,
                );
                let (mx, my, mw, mh) = windows::monitor_work_area(&app);
                let next_x = (px + delta_x).clamp(mx, (mx + mw - pw).max(mx));
                let next_y = (py + delta_y).clamp(my, (my + mh - ph).max(my));
                let _ = win.set_position(tauri::LogicalPosition::new(next_x, next_y));
                windows::position_deepseekball(&app);
                json!({ "success": true })
            } else {
                json!({ "success": false, "error": "灵动岛窗口不存在" })
            }
        }
        // M3 补齐：拖动结束——把当前位置写回岛配置（对齐 island:finishMove）
        "finishIslandMove" => {
            if let Some(win) = app.get_webview_window("island") {
                let pos = win.outer_position().unwrap_or_default();
                let scale = win.current_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
                let (lx, ly) = (pos.x as f64 / scale, pos.y as f64 / scale);
                windows::patch_island_config(&app, json!({ "position": "custom", "x": lx, "y": ly }));
            }
            Value::Null
        }

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
            match start_control(&app, port, &auth_mode).await {
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
            match start_control(&app, port, &mode).await {
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
                let Some(mut cfg) = config::read_config_value() else {
                    return json!(resolve_task_list(&task_cfg(&app)));
                };
                if let Some(list) = cfg.as_object_mut().unwrap().entry("scTaskList").or_insert_with(|| json!([])).as_array_mut() {
                    let dup = list.iter().any(|e| e.get("boardId").and_then(|v| v.as_str()) == Some(board_id.as_str()) && e.get("taskId").and_then(|v| v.as_str()) == Some(task_id.as_str()));
                    if !dup {
                        list.push(json!({ "boardId": board_id, "taskId": task_id, "addedAt": chrono::Local::now().timestamp_millis() }));
                        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
                        let _ = app.emit("tasklist:data", json!(resolve_task_list(&task_cfg(&app))));
                    }
                }
            }
            json!(resolve_task_list(&task_cfg(&app)))
        }
        "completeTaskInList" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let ok = patch_task_flag(&app, board_id, task_id, true);
            if ok {
                let _ = app.emit("tasklist:data", json!(resolve_task_list(&task_cfg(&app))));
            }
            json!({ "ok": ok })
        }
        "removeTaskFromList" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let Some(mut cfg) = config::read_config_value() else {
                return json!({ "ok": false });
            };
            let mut changed = false;
            if let Some(list) = cfg.as_object_mut().unwrap().get_mut("scTaskList").and_then(|v| v.as_array_mut()) {
                let before = list.len();
                list.retain(|e| !(e.get("boardId").and_then(|v| v.as_str()) == Some(board_id) && e.get("taskId").and_then(|v| v.as_str()) == Some(task_id)));
                changed = list.len() != before;
            }
            if changed {
                config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
                let _ = app.emit("tasklist:data", json!(resolve_task_list(&task_cfg(&app))));
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
                match tokio::task::spawn_blocking(move || {
                    let resp = ureq::post("https://shortcut.326415.xyz/api/translate")
                        .timeout(std::time::Duration::from_millis(12_000))
                        .send_json(json!({ "text": text, "from": from, "to": to }))
                        .map_err(|e| e.to_string())?;
                    resp.into_json::<Value>().map_err(|e| e.to_string())
                }).await {
                    Ok(Ok(payload)) => payload,
                    Ok(Err(e)) => json!({ "success": false, "error": e }),
                    Err(e) => json!({ "success": false, "error": e.to_string() }),
                }
            }
        }

        // ---- M5：网站图标（抓页面找 favicon → data:URL）----
        "getWebsiteIcon" => {
            let raw = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            match tokio::task::spawn_blocking(move || fetch_website_icon(&raw)).await {
                Ok(Ok(icon)) => icon,
                _ => Value::Null,
            }
        }

        // ---- M5：绑定同步（sync:* 对齐 binding/engine/init.ts）----
        "syncGetBinding" => sync::sync_get_binding(),
        "syncPullNow" => sync::sync_pull_now(),
        // ---- M5：移动互联枢纽状态（身份摘要 + 模块清单；前端 shim 是通用 Proxy，无需改 TS）----
        "hubStatus" => json!({
            "identity": hub::identity_summary(),
            "modules": hub::modules_summary(),
        }),

        // ---- M5：文件快传（fileTransfer:* 对齐 file-transfer.ts）----
        "fileTransferGetState" => transfer::get_state(),
        "fileTransferSendText" => {
            let text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            transfer::send_text(text)
        }
        "fileTransferSendFile" => {
            let path = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            tokio::task::spawn_blocking(move || transfer::send_file(&path)).await.unwrap_or_else(|e| json!({ "success": false, "message": e.to_string() }))
        }
        "fileTransferDownload" => {
            let file_id = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
            tokio::task::spawn_blocking(move || transfer::download(&file_id, &name)).await.unwrap_or_else(|e| json!({ "success": false, "message": e.to_string() }))
        }
        "fileTransferDelete" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            transfer::delete_message(id)
        }
        "fileTransferShareText" => {
            let text = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let code = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let hours = args.get(2).and_then(|v| v.as_i64()).unwrap_or(24);
            transfer::share_text(text, code, hours)
        }
        "fileTransferShareList" => transfer::share_list(),
        "fileTransferShareDelete" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            transfer::share_delete(id)
        }
        "fileTransferClaim" => {
            let code = args.first().and_then(|v| v.as_str()).unwrap_or("");
            transfer::claim(code)
        }

        // ---- M5：更新检查（读 electron-updater latest.yml 对比版本；完整下载安装 M6 接 tauri updater）----
        "getUpdateState" => {
            json!({ "status": "idle", "checking": false, "downloading": false })
        }
        "checkForUpdates" => {
            match tokio::task::spawn_blocking(|| {
                let resp = ureq::get("https://shortcut.326415.xyz/updates/latest.yml")
                    .timeout(std::time::Duration::from_millis(10_000))
                    .call()
                    .map_err(|e| e.to_string())?;
                resp.into_string().map_err(|e| e.to_string())
            }).await
            {
                Ok(Ok(yml)) => {
                    let latest = yml.lines()
                        .find_map(|l| l.strip_prefix("version: ").map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string()))
                        .unwrap_or_default();
                    let current = app.package_info().version.to_string();
                    let has_update = version_gt(&latest, &current);
                    json!({ "status": if has_update { "available" } else { "up-to-date" }, "current": current, "version": latest, "hasUpdate": has_update })
                }
                Ok(Err(e)) => json!({ "status": "error", "error": e }),
                Err(e) => json!({ "status": "error", "error": e.to_string() }),
            }
        }
        // M6：应用内更新（tauri updater，对齐 update:download/install）
        "downloadUpdate" => {
            use tauri_plugin_updater::UpdaterExt;
            let updater = match app.updater() {
                Ok(u) => u,
                Err(e) => return json!({ "success": false, "message": e.to_string() }),
            };
            let update = match updater.check().await {
                Ok(Some(u)) => u,
                Ok(None) => {
                    let _ = app.emit("update:state", json!({ "state": "up-to-date" }));
                    return json!({ "success": false, "message": "当前已是最新版本" });
                }
                Err(e) => {
                    let _ = app.emit("update:state", json!({ "state": "error", "message": e.to_string() }));
                    return json!({ "success": false, "message": e.to_string() });
                }
            };
            let _ = app.emit("update:state", json!({ "state": "downloading" }));
            let app2 = app.clone();
            let mut downloaded: u64 = 0;
            let result = update
                .download(
                    &mut |chunk, total| {
                        downloaded += chunk as u64;
                        let _ = app2.emit("update:state", json!({ "state": "downloading", "received": downloaded, "total": total }));
                    },
                    &mut || {},
                )
                .await;
            match result {
                Ok(bytes) => {
                    *update_pending().lock().unwrap() = Some((update, bytes));
                    let _ = app.emit("update:state", json!({ "state": "downloaded" }));
                    json!({ "success": true })
                }
                Err(e) => {
                    let _ = app.emit("update:state", json!({ "state": "error", "message": e.to_string() }));
                    json!({ "success": false, "message": e.to_string() })
                }
            }
        }
        "installUpdate" => {
            let pending = update_pending().lock().unwrap().take();
            match pending {
                Some((update, bytes)) => {
                    let _ = app.emit("update:state", json!({ "state": "installing" }));
                    if let Err(e) = update.install(&bytes[..]) {
                        json!({ "success": false, "message": e.to_string() })
                    } else {
                        // install 已启动安装器，正常退出当前实例
                        std::process::exit(0);
                        #[allow(unreachable_code)]
                        json!({ "success": true })
                    }
                }
                None => json!({ "success": false, "message": "请先下载更新" }),
            }
        }
        "getUpdateState" => {
            let pending = update_pending().lock().unwrap().is_some();
            json!({ "state": if pending { "downloaded" } else { "idle" } })
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
            // 对齐 shell:runBat：参数是 bat 内容，写临时文件后 Start-Process 隐藏运行
            let content = args.first().and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let run_as_admin = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            if content.is_empty() {
                json!({ "success": false, "error": "BAT content is empty" })
            } else {
                let bat_dir = config::user_data_dir().join("bat");
                let _ = std::fs::create_dir_all(&bat_dir);
                let bat_path = bat_dir.join(format!("shortcut-{}.bat", chrono::Local::now().timestamp_millis()));
                let normalized = content.trim_start_matches('\u{feff}');
                let _ = std::fs::write(&bat_path, format!("@chcp 65001 >nul\r\n{}\r\n", normalized));
                let target = bat_path.to_string_lossy().to_string();
                let cwd = bat_path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                let admin = if run_as_admin { "1" } else { "0" };
                let ps = "$ErrorActionPreference='Stop';$params=@{FilePath=$env:SHORTCUT_TARGET;WorkingDirectory=$env:SHORTCUT_CWD;PassThru=$true};if($env:SHORTCUT_RUN_AS_ADMIN -eq '1'){$params.Verb='RunAs'};$process=Start-Process @params;if(-not $process){throw 'Windows did not create the target process.'}";
                let ok = std::process::Command::new("powershell.exe")
                    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps])
                    .env("SHORTCUT_TARGET", &target)
                    .env("SHORTCUT_CWD", &cwd)
                    .env("SHORTCUT_RUN_AS_ADMIN", admin)
                    .creation_flags(0x08000000)
                    .spawn()
                    .is_ok();
                json!({ "success": ok, "error": if ok { Value::Null } else { json!("启动失败") } })
            }
        }
        "getInstalledSoftware" => {
            json!(tokio::task::spawn_blocking(|| {
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
            }).await.unwrap_or(json!([])))
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
        "checkLicenseCmd" | "checkLicense" => license::check_license(&app, None),
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

        // ---- M5：任务提醒（reminder，对齐 reminder:* IPC + 30s 扫描）----
        "getReminderData" => {
            // 窗口 label 编码任务键：reminder-<boardId>-<taskId>
            let label = window.label().to_string();
            let rest = label.strip_prefix("reminder-").unwrap_or("");
            let (board_id, task_id) = match rest.split_once('-') {
                Some((b, t)) => (b.to_string(), t.to_string()),
                None => (String::new(), String::new()),
            };
            let cfg = task_cfg(&app);
            let task = cfg.get("taskBoards").and_then(|b| b.as_array())
                .and_then(|boards| boards.iter().find(|b| b.get("id").and_then(|v| v.as_str()) == Some(board_id.as_str())))
                .and_then(|b| b.get("notes").and_then(|n| n.as_array()))
                .and_then(|notes| notes.iter().find(|n| n.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str())));
            match task {
                Some(t) => json!({ "boardId": board_id, "taskId": task_id, "title": t.get("text").and_then(|v| v.as_str()).unwrap_or("任务提醒") }),
                None => Value::Null,
            }
        }
        "confirmReminder" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            mark_task_reminded(&app, board_id, task_id);
            if let Some(w) = app.get_webview_window(&format!("reminder-{}-{}", board_id, task_id)) {
                let _ = w.destroy();
            }
            json!(true)
        }
        "viewReminder" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = app.emit("electron:TaskLocate", json!({ "boardId": board_id, "taskId": task_id }));
            }
            let b = board_id.to_string();
            let t = task_id.to_string();
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                if let Some(w) = handle.get_webview_window(&format!("reminder-{}-{}", b, t)) {
                    let _ = w.destroy();
                }
            });
            json!(true)
        }

        // ---- M5：任务看板勾选（toggleTaskDone）----
        "toggleTaskDone" => {
            let board_id = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let task_id = args.get(1).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let Some(mut cfg) = config::read_config_value() else {
                return json!({ "ok": false });
            };
            let mut changed = false;
            if let Some(boards) = cfg.as_object_mut().unwrap().get_mut("taskBoards").and_then(|v| v.as_array_mut()) {
                if let Some(board) = boards.iter_mut().find(|b| b.get("id").and_then(|v| v.as_str()) == Some(board_id.as_str())) {
                    if let Some(notes) = board.get_mut("notes").and_then(|n| n.as_array_mut()) {
                        if let Some(note) = notes.iter_mut().find(|n| n.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str())) {
                            if let Some(obj) = note.as_object_mut() {
                                let cur = obj.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
                                obj.insert("done".into(), json!(!cur));
                                obj.insert("updatedAt".into(), json!(chrono::Local::now().to_rfc3339()));
                                changed = true;
                            }
                        }
                    }
                }
            }
            if changed {
                config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
            }
            json!({ "ok": changed })
        }

        // ---- M5：音乐桥 + 硬件监控 + 余额开关（sidecar/配置类）----
        "startMusicBridge" => {
            let st = app.state::<MusicHandle>();
            sidecar::start_music_bridge(app.clone(), st.0.clone())
        }
        "stopMusicBridge" => {
            let st = app.state::<MusicHandle>();
            sidecar::stop_music_bridge(&st.0);
            json!(true)
        }
        "getMusicState" => {
            let st = app.state::<MusicHandle>();
            let latest = st.0.latest.lock().unwrap().clone();
            if latest.is_null() { json!({ "available": false }) } else { latest }
        }
        "controlMusic" => {
            let action = args.first().and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            log::info!("[music] controlMusic 请求: {}", action);
            if let Some(script) = sidecar::music_bridge_script_pub() {
                sidecar::run_music_command(&script, &["-Control".to_string(), action])
            } else {
                json!({ "success": false, "error": "音乐桥接脚本不存在" })
            }
        }
        "seekMusic" => {
            let ms = args.first().and_then(|v| v.as_f64()).unwrap_or(0.0).round() as i64;
            if let Some(script) = sidecar::music_bridge_script_pub() {
                sidecar::run_music_command(&script, &["-Seek".to_string(), ms.to_string()])
            } else {
                json!({ "success": false, "error": "音乐桥接脚本不存在" })
            }
        }
        "startCockpit" => {
            let st = app.state::<CockpitHandle>();
            st.0.main_active.store(true, std::sync::atomic::Ordering::SeqCst);
            let result = sidecar::sync_cockpit(app.clone(), st.0.clone());
            result
        }
        "stopCockpit" => {
            let st = app.state::<CockpitHandle>();
            st.0.main_active.store(false, std::sync::atomic::Ordering::SeqCst);
            sidecar::sync_cockpit(app.clone(), st.0.clone());
            json!(true)
        }
        "getIslandCockpitState" => {
            let st = app.state::<CockpitHandle>();
            let latest = st.0.latest.lock().unwrap().clone();
            if latest.is_null() { json!({}) } else { latest }
        }
        "setBalanceKey" | "setDeepseekKey" | "setOpenCodeKey" => {
            let key = args.get(1).and_then(|v| v.as_str()).or_else(|| args.first().and_then(|v| v.as_str())).unwrap_or("");
            let provider = if method == "setOpenCodeKey" { "opencode" } else if method == "setDeepseekKey" { "deepseek" } else { args.first().and_then(|v| v.as_str()).unwrap_or("deepseek") };
            sidecar::set_balance_key(provider, key)
        }
        "setBalanceMusicPlaying" | "setDeepseekMusicPlaying" => {
            // 恢复最初规则：小球**只在"正在播放音乐 且 显示了余额"时出现**。
            // 前端 island.tsx 传来的 playing 就是 (showMusic && balanceProvider !== 'none')：
            // 此时岛身被音乐/歌词占用，余额没地方显示 → 小球飞出来挂在岛旁边；
            // 音乐一停，岛自己就显示余额了 → 小球收回（折叠动画后销毁，不再常驻）。
            let playing = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            windows::BALL_MUSIC_PLAYING.store(playing, std::sync::atomic::Ordering::Relaxed);
            if playing {
                match windows::ensure_deepseekball(&app) {
                    Ok(_) => log::info!("[deepseekball] 播放中且显示余额 → 小球出现"),
                    Err(e) => log::error!("[deepseekball] 播放态创建失败: {}", e),
                }
                let _ = app.emit("balance:merge", serde_json::json!({ "merged": false }));
            } else {
                // 先播放"折叠回岛"动画，再收起窗口；期间若又开始播放就不销毁
                let _ = app.emit("balance:merge", serde_json::json!({ "merged": true }));
                let app_bg = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(360));
                    if windows::BALL_MUSIC_PLAYING.load(std::sync::atomic::Ordering::Relaxed) {
                        return; // 又开始播放了，这次不销毁
                    }
                    if app_bg.get_webview_window("deepseekball").is_some() {
                        windows::destroy_deepseekball(&app_bg);
                        log::info!("[deepseekball] 未播放音乐 → 收起小球（恢复原出现规则）");
                    }
                });
            }
            json!(true)
        }
        // shim listen 注册诊断（岛/球事件不生效排查）
        "debugLog" => {
            let msg = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            log::info!("[shim] {}", msg);
            Value::Null
        }
        // 区域截图：选区窗加载源图（base64 data URL）
        "getScreenshotData" => {
            let p = capture_temp_path();
            match std::fs::read(&p) {
                Ok(bytes) => {
                    use base64::Engine as _;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    json!({ "success": true, "dataUrl": format!("data:image/png;base64,{}", b64) })
                }
                Err(e) => json!({ "success": false, "error": e.to_string() }),
            }
        }
        // 区域截图：物理坐标裁剪 → 剪贴板 → 关选区窗
        "captureRegion" => {
            let num = |i: usize| args.get(i).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let (lx, ly, lw, lh) = (num(0), num(1), num(2), num(3));
            let scale = app.get_webview_window("capture")
                .and_then(|w| w.current_monitor().ok().flatten())
                .map(|m| m.scale_factor())
                .unwrap_or(1.0);
            let (x, y, w, h) = ((lx * scale).round() as i64, (ly * scale).round() as i64, (lw * scale).round() as i64, (lh * scale).round() as i64);
            if w < 1 || h < 1 {
                return json!({ "success": false, "error": "选区无效" });
            }
            match ps_crop_to_clipboard(x, y, w, h) {
                Ok(_) => {
                    if let Some(w) = app.get_webview_window("capture") {
                        let _ = w.destroy();
                    }
                    notify(&app, "所选区域已写入剪贴板");
                    log::info!("[capture] 区域截图完成 {}x{} @{},{} (scale={})", w, h, x, y, scale);
                    json!({ "success": true })
                }
                Err(e) => {
                    log::error!("[capture] 区域裁剪失败: {}", e);
                    json!({ "success": false, "error": "裁剪写入剪贴板失败" })
                }
            }
        }
        "openBalancePlatform" => {            let provider = args.first().and_then(|v| v.as_str()).unwrap_or("deepseek");
            let url = if provider == "opencode" { "https://opencode.net" } else { "https://platform.deepseek.com" };
            use tauri_plugin_opener::OpenerExt;
            let opened = app.opener().open_url(url, None::<&str>);
            log::info!("[ball] openBalancePlatform provider={} url={} ok={:?}", provider, url, opened.is_ok());
            json!(opened.is_ok())
        }
        "openDeepseekPlatform" => {
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url("https://platform.deepseek.com", None::<&str>);
            json!(true)
        }
        "openOpenCodePlatform" => {
            use tauri_plugin_opener::OpenerExt;
            let _ = app.opener().open_url("https://opencode.net", None::<&str>);
            json!(true)
        }
        "getBalanceData" | "getDeepseekBalance" => {
            let force = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            tokio::task::spawn_blocking(move || sidecar::get_balance_data(force)).await
                .unwrap_or_else(|e| json!({ "error": e.to_string() }))
        }
        "getTheme" => {
            let dark = std::process::Command::new("reg.exe")
                .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "/v", "AppsUseLightTheme"])
                .creation_flags(0x08000000)
                .output()
                .map(|o| {
                    let text = String::from_utf8_lossy(&o.stdout);
                    !text.contains("0x0")
                })
                .unwrap_or(true);
            json!(if dark { "dark" } else { "light" })
        }
        "overlapTaskDrag" => {
            let (sx, sy) = (
                args.first().and_then(|v| v.as_f64()).unwrap_or(0.0),
                args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0),
            );
            let tasks_enabled = task_cfg(&app).get("island").and_then(|i| i.get("tasksEnabled")).and_then(|v| v.as_bool()).unwrap_or(true);
            if tasks_enabled && windows::point_in_island(&app, sx, sy) {
                let _ = windows::ensure_tasklist(&app);
            }
            json!(true)
        }
        "dropTaskOnList" => {
            let (sx, sy) = (
                args.first().and_then(|v| v.as_f64()).unwrap_or(0.0),
                args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0),
            );
            let board_id = args.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let task_id = args.get(3).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let tasks_enabled = task_cfg(&app).get("island").and_then(|i| i.get("tasksEnabled")).and_then(|v| v.as_bool()).unwrap_or(true);
            if tasks_enabled && windows::point_in_island(&app, sx, sy) {
                let Some(mut cfg) = config::read_config_value() else {
                    return json!(true);
                };
                let dup = cfg.get("scTaskList").and_then(|v| v.as_array()).map(|l| l.iter().any(|e| e.get("boardId").and_then(|v| v.as_str()) == Some(board_id.as_str()) && e.get("taskId").and_then(|v| v.as_str()) == Some(task_id.as_str()))).unwrap_or(false);
                if !dup && !board_id.is_empty() && !task_id.is_empty() {
                    if let Some(obj) = cfg.as_object_mut() {
                        let list = obj.entry("scTaskList").or_insert_with(|| json!([]));
                        if let Some(arr) = list.as_array_mut() {
                            arr.push(json!({ "boardId": board_id, "taskId": task_id, "addedAt": chrono::Local::now().to_rfc3339() }));
                        }
                    }
                    config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
                    let _ = windows::ensure_tasklist(&app);
                }
            }
            json!(true)
        }

        // ---- M5：Codex 供应商预设（codex:* 对齐）----
        "getCodexState" | "getCodexPresetState" => codex::read_current_state(),
        "saveCurrentCodexPreset" => {
            let data = args.first().cloned().unwrap_or(json!({}));
            codex::save_current_preset(&data)
        }
        "saveCodexPreset" => {
            let data = args.first().cloned().unwrap_or(json!({}));
            codex::save_preset(&data)
        }
        "deleteCodexPreset" => {
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            codex::delete_preset(id)
        }
        "applyCodexPreset" => match codex::apply_preset(args.first().and_then(|v| v.as_str()).unwrap_or("")) {
            Ok(_) => {
                let mut out = json!({ "success": true });
                if let Some(obj) = out.as_object_mut() {
                    obj.insert("state".into(), codex::read_current_state());
                }
                out
            }
            Err(e) => json!({ "success": false, "error": e }),
        },
        "restoreCodexPreset" => match codex::restore_config() {
            Ok(_) => {
                let mut out = json!({ "success": true });
                if let Some(obj) = out.as_object_mut() {
                    obj.insert("state".into(), codex::read_current_state());
                }
                out
            }
            Err(e) => json!({ "success": false, "error": e }),
        },
        "openCodexFile" => {
            use tauri_plugin_opener::OpenerExt;
            let which = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let path = match which {
                "auth" => codex::codex_home_dir().join("auth.json"),
                "models" => codex::codex_home_dir().join("models.json"),
                _ => codex::codex_home_dir().join("config.toml"),
            };
            if !path.exists() {
                json!({ "success": false, "error": "文件不存在" })
            } else {
                let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
                json!({ "success": true })
            }
        }
        "openCodexPresetDir" => {
            use tauri_plugin_opener::OpenerExt;
            let id = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let dir = codex::codex_home_dir().join("shortcut-presets").join(id);
            if !dir.exists() {
                json!({ "success": false, "error": "方案目录不存在" })
            } else {
                let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
                json!({ "success": true })
            }
        }

        // ---- M5：语音输入（voice:* 对齐 voice-input.ts）----
        "voiceOpen" => voice::voice_open(&app),
        "voiceStart" => voice::voice_start(&app),
        "voiceConfirm" => voice::voice_confirm(&app),
        "voiceToggle" => voice::voice_toggle(&app),
        "voiceCancel" => voice::voice_cancel(&app),
        "voiceGetConfig" => voice::voice_get_config(&app),
        "voiceGetStats" => voice::get_voice_stats(),
        "voiceAudio" => {
            let chunk = args.first().and_then(|v| v.as_str()).unwrap_or("");
            voice::voice_audio(chunk)
        }
        "voiceRegisterShortcut" => {
            voice::register_shortcut(&app);
            json!(true)
        }
        "voiceBridgeEvent" => {
            // 桥按键事件（SPACE/ENTER/ESC）由窗口层转发
            let event = args.first().and_then(|v| v.as_str()).unwrap_or("");
            match event {
                "toggle" => {
                    voice::toggle_pause(&app);
                    json!(true)
                }
                "confirm" => {
                    voice::confirm_and_type(&app);
                    json!(true)
                }
                "cancel" => {
                    voice::cancel_session(&app);
                    json!(true)
                }
                _ => json!(true),
            }
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
    let Some(mut cfg) = config::read_config_value() else {
        return false;
    };
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

/// M5 sidecar 句柄
pub struct MusicHandle(pub Arc<sidecar::MusicState>);
pub struct CockpitHandle(pub Arc<sidecar::CockpitState>);

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

pub fn sj_static_root_pub() -> std::path::PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("sj")
}

async fn start_control(app: &tauri::AppHandle, port: u16, auth_mode: &str) -> Result<Value, String> {
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
    let server = control::spawn_server(st.clone()).await?;
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
/// 托盘菜单：显示主面板 / 游戏模式（冻结后台）/ 分隔线 / 退出。
/// 抽成函数是因为游戏模式切换后要重建菜单来更新勾选态。
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "显示主面板", true, None::<&str>)?;
    let freeze_item = CheckMenuItem::with_id(
        app,
        "freeze-toggle",
        "游戏模式（冻结后台）",
        true,
        freeze::is_frozen(),
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(app, &[&show, &freeze_item, &sep, &quit])
}

/// 主面板"刚被程序化显示"的时刻（毫秒时间戳，0 = 无）。
///
/// 主窗有"失焦即隐藏"（closeOnBlur 默认开）。程序化 show 之后如果不给它一点宽限，
/// 一旦外部把焦点抢回去就会立刻触发隐藏 —— 表现就是"呼出后屏幕上没看见"。
static MAIN_SHOWN_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 主面板"真正获得焦点"的时刻（毫秒时间戳，0 = 从未获得）。
/// 用来区分"用户点走了"（真实失焦）和"程序化显示时被前台锁抢走焦点"（不应隐藏）。
static MAIN_FOCUSED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 显示主面板（托盘「显示主面板」/ Alt+Space / 解冻恢复都走这里，行为保持一致）
fn show_main_window(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        log::error!("[main] 显示失败：主窗不存在（label=main）");
        return;
    };
    let was_visible = w.is_visible().unwrap_or(false);
    if !was_visible {
        // 仅从隐藏转显示时通知（已可见时是 no-op，多余通知会让前端重播动画）
        let _ = app.emit("window:will-show", ());
    }
    let _ = w.show();
    let _ = w.unminimize();
    // 关键：最小化过的窗口 unminimize() 之后经常还是"最小化那套几何"（Windows 把最小化窗口
    // 放在 -32000,-32000、尺寸只剩标题栏），表现就是面板回来成了细条或仍是最小化。
    // 所以这里**重新套用保存的窗口几何**（window-state.json），再做屏幕越界检查。
    restore_window_state(&w);
    let _ = w.set_focus();
    // 屏幕外兜底：窗口位置若因多显示器变化/上次异常退出而跑到屏幕外，这里直接拉回屏幕中间
    freeze::ensure_on_screen(app, &w);
    MAIN_SHOWN_AT.store(now_millis(), std::sync::atomic::Ordering::Relaxed);
    // 前台锁兜底：Windows 常把前台焦点还给原来的窗口，导致面板"显示成功但被压在后面/看不见"。
    // 这里做一次短暂的置顶脉冲，保证用户确实看到面板（600ms 后自动取消置顶）。
    if !w.is_focused().unwrap_or(false) {
        let _ = w.set_always_on_top(true);
        let w2 = w.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(600));
            let _ = w2.set_always_on_top(false);
            let _ = w2.set_focus();
        });
    }
    // 记录状态：下次"面板看不见"时，日志能直接指出是隐藏/最小化还是跑到屏幕外
    log::info!(
        "[main] 显示主面板：was_visible={} now_visible={} minimized={} focused={} pos={:?} size={:?}",
        was_visible,
        w.is_visible().unwrap_or(false),
        w.is_minimized().unwrap_or(false),
        w.is_focused().unwrap_or(false),
        w.outer_position().ok(),
        w.outer_size().ok()
    );
}

fn handle_tray_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "show" => show_main_window(app),
        "quit" => app.exit(0),
        // 游戏模式：冻结全部后台（隐藏悬浮窗/停侧车/降功耗/注销热键），再点一次恢复原状。
        // 这是冻结态唯一的恢复入口，所以托盘图标本身不隐藏。
        "freeze-toggle" => {
            let frozen = freeze::toggle(app);
            // 菜单项勾选态随冻结状态重建（图标/提示也一并更新）
            if let Some(tray) = app.tray_by_id("main-tray") {
                if let Ok(menu) = build_tray_menu(app) {
                    let _ = tray.set_menu(Some(menu));
                }
                let tip = if frozen { "ShortCut · 游戏模式（已冻结后台）" } else { "ShortCut" };
                let _ = tray.set_tooltip(Some(tip));
            }
            log::info!("[freeze] 托盘切换 → {}", if frozen { "冻结" } else { "解冻" });
        }
        _ => {}
    }
}

/// 主面板开关（Alt+Space，与 Electron toggleWindow 一致：可见则隐藏，否则唤起）
fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        log::error!("[main] Alt+Space 唤起失败：主窗不存在");
        return;
    };
    // 注意判定用 "可见且已最小化也算在显示"：最小化时 Win32 仍算 visible，
    // 那时应当唤起（show+unminimize）而不是再 hide 一次。
    let visible = w.is_visible().unwrap_or(false);
    let minimized = w.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = w.hide();
    } else {
        show_main_window(app); // 与托盘「显示主面板」/解冻恢复共用一套动作（含失焦宽限）
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// M5 提醒：标记任务已提醒（remindedAt + done=true）
fn mark_task_reminded(_app: &tauri::AppHandle, board_id: &str, task_id: &str) {
    let Some(mut cfg) = config::read_config_value() else {
        return;
    };
    let mut changed = false;
    if let Some(boards) = cfg.as_object_mut().unwrap().get_mut("taskBoards").and_then(|v| v.as_array_mut()) {
        if let Some(board) = boards.iter_mut().find(|b| b.get("id").and_then(|v| v.as_str()) == Some(board_id)) {
            if let Some(notes) = board.get_mut("notes").and_then(|n| n.as_array_mut()) {
                if let Some(note) = notes.iter_mut().find(|n| n.get("id").and_then(|v| v.as_str()) == Some(task_id)) {
                    if let Some(obj) = note.as_object_mut() {
                        obj.insert("remindedAt".into(), json!(chrono::Local::now().to_rfc3339()));
                        obj.insert("done".into(), json!(true));
                        changed = true;
                    }
                }
            }
        }
    }
    if changed {
        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    }
}

/// M5 提醒：扫描到期任务并弹提醒窗（对齐 scanDueReminders，30s 周期）
fn scan_due_reminders(app: &tauri::AppHandle) {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let tasks_enabled = cfg.get("island").and_then(|i| i.get("tasksEnabled")).and_then(|v| v.as_bool()).unwrap_or(true);
    if !tasks_enabled {
        return;
    }
    let now = chrono::Utc::now().timestamp_millis();
    let mut count = 0usize;
    if let Some(boards) = cfg.get("taskBoards").and_then(|v| v.as_array()) {
        for board in boards {
            let board_id = board.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if let Some(notes) = board.get("notes").and_then(|v| v.as_array()) {
                for note in notes {
                    let reminder_at = note.get("reminderAt").and_then(|v| v.as_str()).unwrap_or("");
                    let reminded = note.get("remindedAt").and_then(|v| v.as_str()).unwrap_or("");
                    if reminder_at.is_empty() || !reminded.is_empty() {
                        continue;
                    }
                    let due = chrono::DateTime::parse_from_rfc3339(reminder_at).map(|d| d.timestamp_millis()).unwrap_or(i64::MIN);
                    if due > now {
                        continue;
                    }
                    let task_id = note.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if windows::ensure_reminder_window(app, &board_id, &task_id, count) {
                        count += 1;
                    }
                }
            }
        }
    }
}

/// URL 百分号编码（无新依赖的极简实现）
fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// 主窗状态持久化（独立文件 window-state.json，避免被前端 writeConfig 全量覆盖）
fn window_state_path() -> std::path::PathBuf {
    config::user_data_dir().join("window-state.json")
}

fn save_window_state(win: &tauri::WebviewWindow) {
    let pos = win.outer_position().unwrap_or_default();
    let size = win.outer_size().unwrap_or_default();
    let maximized = win.is_maximized().unwrap_or(false);
    // 明显异常的坐标（显示器外漂移）不保存，回退默认位置
    if pos.x.abs() > 20000 || pos.y.abs() > 20000 {
        return;
    }
    let st = json!({
        "x": pos.x, "y": pos.y,
        "width": size.width, "height": size.height,
        "maximized": maximized,
    });
    let _ = std::fs::write(window_state_path(), st.to_string());
}

fn restore_window_state(win: &tauri::WebviewWindow) {
    let p = window_state_path();
    let txt = match std::fs::read_to_string(&p) {
        Ok(t) => t,
        Err(_) => return, // 首次运行无状态文件 → 默认 900×600 居中
    };
    let v: Value = match serde_json::from_str(&txt) {
        Ok(v) => v,
        Err(_) => return,
    };
    let num = |k: &str| v.get(k).and_then(|z| z.as_f64());
    let (x, y, w, h) = match (num("x"), num("y"), num("width"), num("height")) {
        (Some(x), Some(y), Some(w), Some(h)) => (x, y, w, h),
        _ => return,
    };
    if w < 600.0 || h < 400.0 || w > 20000.0 || h > 20000.0 {
        return;
    }
    let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
    let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    if v.get("maximized").and_then(|z| z.as_bool()).unwrap_or(false) {
        let _ = win.maximize();
    }
    log::info!("[main] 已恢复上次窗口状态: pos=({},{}) size={}x{} maximized={}", x as i32, y as i32, w as u32, h as u32,
        v.get("maximized").and_then(|z| z.as_bool()).unwrap_or(false));
}

/// ---------- 截图（对齐 Electron captureCurrentDisplay / startRegionCapture）----------
const CAPTURE_TEMP_PNG: &str = "shortcut-capture.png";

fn capture_temp_path() -> std::path::PathBuf {
    std::env::temp_dir().join(CAPTURE_TEMP_PNG)
}

/// 光标所在屏全屏截图（物理像素）→ 可选写剪贴板/存临时 PNG
/// PowerShell -STA（Clipboard 需要 STA）+ System.Drawing CopyFromScreen
fn ps_capture_screen(to_clipboard: bool, save_path: Option<&std::path::Path>) -> Result<(), String> {
    use std::os::windows::process::CommandExt as _;
    let save = save_path
        .map(|p| p.to_string_lossy().replace('\\', "\\\\"))
        .unwrap_or_default();
    let clip = if to_clipboard { "$true" } else { "$false" };
    let script = format!(
        "Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; \
         $s=[System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position); \
         $b=$s.Bounds; \
         $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); \
         $g=[System.Drawing.Graphics]::FromImage($bmp); \
         $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); \
         if ({clip}) {{ [System.Windows.Forms.Clipboard]::SetImage($bmp); }}; \
         if ('{save}' -ne '') {{ $bmp.Save('{save}',[System.Drawing.Imaging.ImageFormat]::Png); }}; \
         Write-Output ok",
        clip = clip,
        save = save,
    );
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() && String::from_utf8_lossy(&out.stdout).contains("ok") {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

/// 裁剪临时 PNG 的指定物理区域 → 写剪贴板（对齐 Electron image.crop + clipboard.writeImage）
fn ps_crop_to_clipboard(x: i64, y: i64, w: i64, h: i64) -> Result<(), String> {
    use std::os::windows::process::CommandExt as _;
    let p = capture_temp_path().to_string_lossy().replace('\\', "\\\\");
    let script = format!(
        "Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; \
         $src=[System.Drawing.Bitmap]::FromFile('{p}'); \
         $rect=New-Object System.Drawing.Rectangle({x},{y},{w},{h}); \
         $crop=$src.Clone($rect,$src.PixelFormat); \
         [System.Windows.Forms.Clipboard]::SetImage($crop); \
         $src.Dispose(); \
         Remove-Item '{p}' -ErrorAction SilentlyContinue; \
         Write-Output ok",
        p = p, x = x, y = y, w = w, h = h,
    );
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() && String::from_utf8_lossy(&out.stdout).contains("ok") {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

fn notify(app: &tauri::AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title("ShortCut").body(body).show();
}

/// Alt+S：当前屏幕全屏 → 剪贴板
fn capture_full_screen(app: &tauri::AppHandle) {
    match ps_capture_screen(true, None) {
        Ok(_) => {
            notify(app, "当前屏幕已写入剪贴板");
            log::info!("[capture] 全屏截图完成");
        }
        Err(e) => {
            log::error!("[capture] 全屏截图失败: {}", e);
            notify(app, "全屏截图失败");
        }
    }
}

/// Alt+D：区域截图（全屏快照 → 全屏遮罩选区窗 → 裁剪写剪贴板）
fn start_region_capture(app: &tauri::AppHandle) {
    use tauri::WebviewUrl;
    use tauri::WebviewWindowBuilder;
    // 光标所在屏 bounds（物理）
    let (mx, my, mw, mh, scale) = match app.cursor_position().ok().and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten()) {
        Some(m) => {
            let b = m.position();
            let s = m.size();
            (b.x, b.y, s.width, s.height, m.scale_factor())
        }
        None => (0, 0, 1920, 1080, 1.0),
    };
    if let Err(e) = ps_capture_screen(false, Some(&capture_temp_path())) {
        log::error!("[capture] 快照失败: {}", e);
        return;
    }
    // 旧选区窗销毁重建（对齐 Electron captureOverlay.destroy）
    if let Some(old) = app.get_webview_window("capture") {
        let _ = old.destroy();
    }
    let build = WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("capture.html".into()))
        .title("ShortCut 区域截图")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(true)
        .visible(false)
        .initialization_script(crate::SHIM_JS)
        .position(mx as f64 / scale, my as f64 / scale)
        .inner_size(mw as f64 / scale, mh as f64 / scale);
    match build.build() {
        Ok(w) => {
            let _ = w.show();
            log::info!("[capture] 区域截图选区窗已显示 ({}x{} @{},{} scale={})", mw, mh, mx, my, scale);
        }
        Err(e) => log::error!("[capture] 选区窗创建失败: {}", e),
    }
}

/// island.music 授权特性是否可用（license.featureAccess，默认允许）
fn island_feature_ok(app: &tauri::AppHandle) -> bool {
    let _ = app;
    let cfg = config::read_config_value().unwrap_or(json!({}));
    cfg.get("license").and_then(|l| l.get("featureAccess")).and_then(|f| f.as_array())
        .and_then(|a| a.iter().find(|f| f.get("id").and_then(|v| v.as_str()) == Some("island.music")).and_then(|f| f.get("allowed")).and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

/// 音乐控制（Alt+Z/X/C → 音乐桥 -Control，对齐 Electron runMusicBridgeCommand）
fn run_music_control(app: &tauri::AppHandle, action: &str) {
    if let Some(script) = sidecar::music_bridge_script_pub() {
        let r = sidecar::run_music_command(&script, &["-Control".to_string(), action.to_string()]);
        log::info!("[music] 快捷键控制 {}: {:?}", action, r.get("success"));
    } else {
        log::warn!("[music] 快捷键控制失败：音乐桥接脚本不存在");
    }
    let _ = app;
}

/// SC 球状态对齐配置（对齐 Electron applyConfig）：
/// provider 关 / island.balance feature 关 / island 模块关 → 销毁；
/// 球已存在（音乐驱动或此前创建）且配置变了 → 重建以刷新样式与供应商；
/// 球不存在且音乐未驱动 → 不主动创建（等岛 setBalanceMusicPlaying）。
fn sync_deepseekball_state(app: &tauri::AppHandle) {
    // 游戏模式冻结中：小球已随悬浮窗一起销毁（C 方案），这里一律不重建
    if freeze::is_frozen() {
        return;
    }    let cfg = config::read_config_value().unwrap_or(json!({}));
    let island = cfg.get("island").cloned().unwrap_or(json!({}));
    let provider_raw = island.get("balanceProvider").and_then(|v| v.as_str()).unwrap_or("");
    let deepseek_on = island.get("deepseekEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
    let effective = if provider_raw == "deepseek" || provider_raw == "opencode" {
        provider_raw
    } else if deepseek_on {
        "deepseek"
    } else {
        "none"
    };
    let island_module_on = cfg.get("modules").and_then(|m| m.as_array())
        .map(|a| a.iter().any(|m| m.get("id").and_then(|v| v.as_str()) == Some("island") && m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)))
        .unwrap_or(true);
    let balance_feature_on = cfg.get("license").and_then(|l| l.get("featureAccess")).and_then(|f| f.as_array())
        .and_then(|a| a.iter().find(|f| f.get("id").and_then(|v| v.as_str()) == Some("island.balance")).and_then(|f| f.get("allowed")).and_then(|v| v.as_bool()))
        .unwrap_or(true);
    // 恢复最初规则：小球只在「正在播放音乐 且 显示了余额」时出现，不再常驻。
    // 这里额外要求"当前确实在播放"，所以启动/改配置都不会凭空拉起小球。
    let should_show = island_module_on
        && balance_feature_on
        && effective != "none"
        && windows::BALL_MUSIC_PLAYING.load(std::sync::atomic::Ordering::Relaxed);
    if !should_show {
        if app.get_webview_window("deepseekball").is_some() {
            windows::destroy_deepseekball(app);
            log::info!("[deepseekball] 配置关闭余额显示 → 销毁");
        }
        return;
    }
    let style = island.get("style").and_then(|v| v.as_str()).unwrap_or("capsule").to_string();
    let signature = format!("{}|{}", effective, style);
    static LAST_BALL_SIG: std::sync::OnceLock<std::sync::Mutex<String>> = std::sync::OnceLock::new();
    let slot = LAST_BALL_SIG.get_or_init(|| std::sync::Mutex::new(String::new()));
    let changed = {
        let mut last = slot.lock().unwrap_or_else(|e| e.into_inner());
        if *last == signature { false } else { *last = signature.clone(); true }
    };
    match app.get_webview_window("deepseekball") {
        // 配置说该显示但窗口不在（启动、或刚从音乐态恢复）→ 创建
        None => match windows::ensure_deepseekball(app) {
            Ok(_) => log::info!("[deepseekball] 按配置创建（provider={} style={}）", effective, style),
            Err(e) => log::error!("[deepseekball] 创建失败: {}", e),
        },
        // 已存在且 provider/style 变了 → 重建刷新
        Some(_) if changed => {
            windows::destroy_deepseekball(app);
            let _ = windows::ensure_deepseekball(app);
            log::info!("[deepseekball] 配置变更 → 重建（provider={} style={}）", effective, style);
        }
        // 已存在且无变化 → 什么都不做（避免每次写配置都闪一下）
        Some(_) => {}
    }
}

/// 翻译气泡：复刻 Electron showTranslationBubble（data:URL 动态窗 → Tauri 静态 bubble.html + query 传参）
pub fn show_translation_bubble(app: &tauri::AppHandle, source: &str, translated: &str, error: &str) {
    // cursor_position 是物理像素；窗口 position 是逻辑像素 → 除以主显示器缩放
    let scale = app.primary_monitor().ok().flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let (mx, my) = match app.cursor_position() {
        Ok(p) => (p.x / scale, p.y / scale),
        Err(_) => (120.0, 120.0),
    };
    if let Some(old) = app.get_webview_window("translationBubble") {
        let _ = old.close();
    }
    let mut url = String::from("bubble.html?");
    if !error.is_empty() {
        url.push_str(&format!("e={}", url_encode(error)));
    } else {
        url.push_str(&format!("s={}&r={}", url_encode(source), url_encode(translated)));
    }
    let _ = tauri::WebviewWindowBuilder::new(app, "translationBubble", tauri::WebviewUrl::App(url.into()))
        .title("translation")
        .position(mx + 12.0, my + 16.0)
        .inner_size(390.0, 280.0)
        .decorations(false)
        .transparent(true)
        .shadow(false) // Windows DWM 会给窗口画 1px 边框/阴影，这就是"外层线框"
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false) // 不抢焦点，不打断用户输入
        .initialization_script(crate::SHIM_JS) // 页面用 electronAPI.closeWindow() 自关
        .build();
    // 关闭时机由页面控制：5 秒无交互自动关闭 / 固定按钮常显（对齐 Electron 纸条）
}

/// Alt+E 划词翻译：快照剪贴板 → SendKeys ^c → 读回 → 翻译 → 气泡（对齐 Electron translateCurrentSelection）
pub fn translate_current_selection(app: &tauri::AppHandle) {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        let cb = app2.clipboard();
        let snapshot = cb.read_text().unwrap_or_default();
        let _ = cb.write_text("");
        // 模拟 Ctrl+C（STA powershell，与 Electron main.ts 一致；阻塞 ~1s 放 blocking 池）
        let _ = tokio::task::spawn_blocking(|| {
            std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command",
                    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')",
                ])
                .creation_flags(0x08000000)
                .output()
        })
        .await;
        tokio::time::sleep(std::time::Duration::from_millis(180)).await;
        let selected: String = cb.read_text().unwrap_or_default().trim().chars().take(5000).collect();
        let _ = cb.write_text(&snapshot);
        if selected.is_empty() {
            show_translation_bubble(&app2, "", "", "没有读取到选中的文字");
            return;
        }
        let body = json!({ "text": selected, "from": "auto", "to": "zh" });
        let result = tokio::task::spawn_blocking(move || {
            ureq::post("https://shortcut.326415.xyz/api/translate")
                .timeout(std::time::Duration::from_millis(12_000))
                .send_json(body)
                .map_err(|e| e.to_string())?
                .into_json::<Value>()
                .map_err(|e| e.to_string())
        })
        .await;
        match result {
            Ok(Ok(v)) => {
                if v.get("success").and_then(|x| x.as_bool()).unwrap_or(false) {
                    let translated = v.get("translatedText").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    show_translation_bubble(&app2, &selected, &translated, "");
                } else {
                    let err = v.get("error").and_then(|x| x.as_str()).unwrap_or("翻译失败").to_string();
                    show_translation_bubble(&app2, "", "", &err);
                }
            }
            Ok(Err(e)) => show_translation_bubble(&app2, "", "", &e),
            Err(e) => show_translation_bubble(&app2, "", "", &e.to_string()),
        }
    });
}

/// 冲突检测：Electron 版在跑 → tasklist 精确匹配（两版并行会竞争写 config.json）
/// 本程序多开由 tauri-plugin-single-instance（命名互斥体）兜底
fn conflicting_instance_running() -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("tasklist")
            .args(["/NH", "/FO", "CSV"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let first = line.split(',').next().unwrap_or("").trim_matches('"').to_ascii_lowercase();
            if first == "shortcut.exe" {
                return Some(
                    "检测到旧版 ShortCut（Electron）正在运行。\n\n两版同时运行会竞争写配置文件、造成任务墙/快捷方式数据丢失。\n\n请先退出旧版（托盘图标 → 退出），再启动本程序。".to_string(),
                );
            }
        }
    }
    None
}

/// SC 球鼠标穿透的全局快捷键（配置 island.ballPassthroughShortcut，缺省 Ctrl+Alt+B）
fn ball_passthrough_shortcut() -> String {
    config::read_config_value()
        .and_then(|c| c.get("island").and_then(|i| i.get("ballPassthroughShortcut")).and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| "Ctrl+Alt+B".to_string())
}

/// 当前配置下"应该处于注册状态"的全局快捷键清单（不含任何冻结热键，冻结不靠热键）。
///
/// 抽成一份清单的目的：游戏模式（冻结后台）要**全部注销**、退出游戏模式要**按同样条件重新注册**，
/// 两处必须是同一份判断，否则会出现"解冻后某个快捷键没回来"。
pub(crate) fn configured_hotkeys() -> Vec<String> {
    let mut list: Vec<String> = ["alt+space", "alt+i", "alt+u", "alt+s", "alt+d"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    // Ctrl+Alt+B 切换 SC 球鼠标穿透（需求 5.2）
    list.push(ball_passthrough_shortcut());
    let cfg = config::read_config_value().unwrap_or(json!({}));
    let module_on = |id: &str| {
        cfg.get("modules")
            .and_then(|m| m.as_array())
            .map(|a| {
                a.iter().any(|m| {
                    m.get("id").and_then(|v| v.as_str()) == Some(id)
                        && m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)
                })
            })
            .unwrap_or(true)
    };
    let feature_on = |id: &str| {
        cfg.get("license")
            .and_then(|l| l.get("featureAccess"))
            .and_then(|f| f.as_array())
            .and_then(|a| {
                a.iter()
                    .find(|f| f.get("id").and_then(|v| v.as_str()) == Some(id))
                    .and_then(|f| f.get("allowed"))
                    .and_then(|v| v.as_bool())
            })
            .unwrap_or(true)
    };
    // Alt+E 划词翻译：translate 模块启用（bubble 特性未被禁）才注册，对齐 Electron ensureGlobalShortcut
    if module_on("translate") && feature_on("translate.bubble") {
        list.push("alt+e".to_string());
    }
    // 音乐控制快捷键：island 模块 + island.music feature（对齐 Electron islandMusicOk）
    if module_on("island") && feature_on("island.music") {
        list.extend(["alt+z", "alt+x", "alt+c"].iter().map(|s| s.to_string()));
    }
    list
}

/// 注册全部全局快捷键（启动时、以及退出游戏模式时调用）
pub(crate) fn register_configured_hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    for k in configured_hotkeys() {
        match gs.register(k.as_str()) {
            Ok(_) => log::info!("[hotkey] 注册成功: {}", k),
            Err(e) => log::error!("[hotkey] 注册失败: {} ({})", k, e),
        }
    }
}

/// 注销全部全局快捷键（进游戏模式时调用：冻结期间按快捷键不该有任何反应）
pub(crate) fn unregister_configured_hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    for k in configured_hotkeys() {
        if gs.unregister(k.as_str()).is_ok() {
            log::info!("[hotkey] 已注销: {}（游戏模式）", k);
        }
    }
}

/// 快捷键归一化：注册名与插件回传的 W3C code 名对齐（keyb → b、大写转小写）
fn normalize_accel(acc: &str) -> String {
    // 插件回传的是 W3C code 名（control+alt+keyb），配置里写的是 Ctrl+Alt+B：
    // 修饰键也必须归一化，否则两边永远不相等（Ctrl+Alt+B 之前就是这么失效的）。
    let lower = acc.to_lowercase();
    let mut parts: Vec<String> = lower
        .split('+')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .map(|p| match p.as_str() {
            "ctrl" | "control" => "control".to_string(),
            "win" | "meta" | "super" | "cmd" => "super".to_string(),
            "option" => "alt".to_string(),
            other => {
                if let Some(rest) = other.strip_prefix("key") {
                    if rest.len() == 1 { rest.to_string() } else { other.to_string() }
                } else if let Some(rest) = other.strip_prefix("digit") {
                    rest.to_string()
                } else {
                    other.to_string()
                }
            }
        })
        .collect();
    parts.sort();
    parts.dedup();
    parts.join("+")
}
pub fn run() {
    // 右键菜单/脚本的"直接执行"参数（--compress/--extract/--shellmenu-on/off）：
    // 在进 Tauri 之前同步干完并结束进程——不建窗口、不依赖正在运行的实例，
    // 也不受"运行中的实例是管理员"影响（UIPI 会拦住普通权限进程的转发）。
    if directcmd::try_run() {
        return;
    }
    tauri::Builder::default()
        // 单实例必须最先注册：第二实例启动时回调把已有实例带到前台，自身退出
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            log::info!("[drop] 第二实例转交 args={:?}", args);
            // 注：--compress/--extract/--shellmenu-* 已在进 Tauri 之前由 directcmd 处理并结束进程，
            // 这里只会收到 --convert（老流程）或无参数（仅前台化）。
            match shellmenu::parse_cli(&args) {
                Some((action, paths)) => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                    queue_drop(app, paths, action);
                }
                None => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                    log::info!("[shell] 第二实例参数无动作，仅前台化");
                }
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ControlHandle(std::sync::Mutex::new(None)))
        .manage(CloudHandleState(std::sync::Mutex::new(None)))
        .manage(MusicHandle(Arc::new(sidecar::MusicState { child: std::sync::Arc::new(std::sync::Mutex::new(None)), latest: std::sync::Arc::new(std::sync::Mutex::new(Value::Null)), starting: std::sync::atomic::AtomicBool::new(false) })))
        .manage(CockpitHandle(Arc::new(sidecar::CockpitState { child: std::sync::Arc::new(std::sync::Mutex::new(None)), latest: std::sync::Arc::new(std::sync::Mutex::new(Value::Null)), main_active: std::sync::atomic::AtomicBool::new(false), starting: std::sync::atomic::AtomicBool::new(false) })))
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
                                // 任务模块开关已迁移到任务墙右上角设置入口。
                                // 禁用状态下墙被销毁（入口随之消失），Alt+U 成为唯一重新启用通道：
                                // tasksEnabled=false → Alt+U = 重新启用并显示
                                let tasks_on = config::read_config_value()
                                    .as_ref()
                                    .and_then(|c| c.get("island"))
                                    .and_then(|i| i.get("tasksEnabled"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(true);
                                if tasks_on {
                                    // 与 Electron taskListHotkey 一致：存在则销毁，否则创建
                                    if app.get_webview_window("tasklist").is_some() {
                                        windows::destroy_tasklist(app);
                                    } else {
                                        let _ = windows::ensure_tasklist(app);
                                    }
                                } else {
                                    // 重新启用：写回配置 + 显示任务墙
                                    windows::patch_island_config(app, json!({ "tasksEnabled": true }));
                                    match windows::ensure_tasklist(app) {
                                        Ok(_) => log::info!("[tasklist] Alt+U 重新启用任务模块"),
                                        Err(e) => log::error!("[tasklist] Alt+U 重新启用失败: {}", e),
                                    }
                                }
                            }
                            "alt+s" => capture_full_screen(app),
                            "alt+d" => start_region_capture(app),
                            "alt+e" => translate_current_selection(app),
                            // SC 球鼠标穿透切换（需求 5.2，默认 Ctrl+Alt+B）
                            k if normalize_accel(k) == normalize_accel(&ball_passthrough_shortcut()) => {
                                let next = !windows::ball_passthrough();
                                windows::set_ball_passthrough(app, next);
                                log::info!("[ball] 快捷键切换穿透 → {}", next);
                            }
                            // 音乐控制（对齐 Electron musicHotkeys：Alt+Z/X/C）
                            "alt+z" => run_music_control(app, "prev"),
                            "alt+x" => run_music_control(app, "toggle"),
                            "alt+c" => run_music_control(app, "next"),
                            _ => {}
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // 实例守卫：Electron 版并行 / 自身多开都会竞争写 config.json
            if let Some(reason) = conflicting_instance_running() {
                use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
                app.dialog()
                    .message(reason)
                    .title("ShortCut 启动中止")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::Ok)
                    .blocking_show();
                app.handle().exit(1);
                return Ok(());
            }

            // 文件日志最先初始化（%LOCALAPPDATA%\com.wanan.shortcut\logs\tauri.log）
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("tauri".into()) }),
                    ])
                    .build(),
            )?;

            // 清理历史崩溃/强杀遗留的孤儿进程：
            // 1) 硬件监控进程（专属进程名，安全）
            // 2) 音乐桥 powershell —— 关键字必须**运行时拼接**再匹配。
            //    踩过的坑：把关键字字面量写进这条清理命令自己的命令行里，会连"执行清理的 shell"
            //    一起被匹配到并杀掉（实测外层 shell 直接被 Stop-Process 干掉，退出码 -1，
            //    孤儿永远清不掉）。所以这里用 ('netmusic' + '-bridge') 拼出来，命令行里不出现字面量。
            {
                let hk = std::process::Command::new("taskkill")
                    .args(["/F", "/IM", "ShortCut.HardwareMonitor.exe"])
                    .creation_flags(0x08000000)
                    .output();
                match hk {
                    Ok(o) if o.status.success() => log::info!("[cleanup] 已清理硬件监控孤儿进程"),
                    Ok(o) => log::warn!("[cleanup] 硬件监控清理返回非零: {}", o.status),
                    Err(e) => log::warn!("[cleanup] 硬件监控清理执行失败: {}", e),
                }
                let sweep = "$pat = ('netmusic' + '-bridge'); $n = 0; \
                    Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | \
                    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ('*' + $pat + '*') } | \
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n = $n + 1 }; \
                    Write-Output ('killed=' + $n)";
                let mk = std::process::Command::new("powershell.exe")
                    .args(["-NoProfile", "-NonInteractive", "-Command", sweep])
                    .creation_flags(0x08000000)
                    .output();
                match mk {
                    Ok(o) if o.status.success() => log::info!(
                        "[cleanup] 音乐桥孤儿清理: {}",
                        String::from_utf8_lossy(&o.stdout).trim()
                    ),
                    Ok(o) => log::warn!(
                        "[cleanup] 音乐桥清理失败: {} {}",
                        o.status,
                        String::from_utf8_lossy(&o.stderr).trim()
                    ),
                    Err(e) => log::warn!("[cleanup] 音乐桥清理执行失败: {}", e),
                }
            }

            // 配置损坏自愈（与 Electron 启动行为一致）
            config::restore_from_backup_if_needed();

            // 移动互联模块注册表：桌面端本地声明（服务端清单由 hub::server_modules() 拉取，60 秒缓存）
            hub::register_module("taskwall", "任务墙", &["pull", "publish", "ack"]);
            hub::register_module("fileTransfer", "文件快传", &["send", "download", "share", "claim"]);
            hub::register_module("control", "云控制", &["realtime", "inject", "clipboard"]);

            // 桌面端凭证（deskToken）引导：旧装机只有绑定码，升级后自动换一次并落盘。
            // 网络请求最长 15s，放后台线程，不阻塞启动。失败只记日志（服务端兼容期仍可继续）。
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                if hub::ensure_ready().is_some() {
                    log::info!("[hub] 桌面端凭证已就绪");
                }
                // 启动只打一次模块清单摘要（来源 server=服务端 / local=本地回退）
                let summary = hub::modules_summary();
                log::info!(
                    "[hub] 模块清单：来源={} 条数={}",
                    summary.get("source").and_then(|v| v.as_str()).unwrap_or("local"),
                    summary.get("count").and_then(|v| v.as_i64()).unwrap_or(0)
                );
                log::info!("[hub] 身份摘要: {}", hub::identity_summary());
            });

            // rpc 能力：每 8 秒拉取一次手机投递的"一次性指令"（board=rpc）并执行、回执。
            // 未绑定/游戏模式冻结时 pull_and_run_rpc 内部会直接跳过，失败只记 warn。
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                        let h = handle.clone();
                        let _ = tokio::task::spawn_blocking(move || {
                            let r = rpc::pull_and_run_rpc(h);
                            if r.get("handled").and_then(|v| v.as_i64()).unwrap_or(0) > 0 {
                                log::info!("[rpc] 本轮处理 {}", r);
                            }
                        })
                        .await;
                    }
                });
            }

            // 注册全局快捷键（注册失败写日志——Electron 版同名键位如果被占也需要知道）
            // 清单集中在 configured_hotkeys()：游戏模式（冻结后台）会整份注销、退出时整份重注册
            register_configured_hotkeys(app.handle());

            // 主窗口：Rust builder 创建（initialization_script 只能挂在 builder 上；conf 不再定义窗口）
            // 尺寸对齐 Electron 版：900×600 / min 600×400
            let win = app
                .get_webview_window("main")
                .unwrap_or_else(|| {
                    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                        .title("ShortCut")
                        .inner_size(900.0, 600.0)
                        .min_inner_size(600.0, 400.0)
                        .decorations(false) // 前端自绘标题栏，去掉系统标题栏（之前漏了导致双层）
                        .visible(false) // Electron show:false——启动隐藏，Alt+Space/托盘唤出
                        .resizable(true);
                    // 拖放显式开启（同 windows.rs build_overlay）：不开启则窗口没有 OLE
                    // IDropTarget，拖文件进面板会显示禁止光标（拖放彻底失效的根因）
                    #[cfg(windows)]
                    let builder = builder.drag_and_drop(true);
                    builder
                        .initialization_script(SHIM_JS)
                        .build()
                        .expect("failed to build main window")
                });
            // 首次启动主窗直接显示（用户期望启动即见；之后关闭=隐藏到托盘）
            {
                restore_window_state(&win);
                // 上次保存的位置若已落在屏幕外（换显示器/分辨率变了），恢复后立刻拉回可见区
                freeze::ensure_on_screen(app.handle(), &win);
                // 让 WebView2 交还外部拖放（wry 把它关了 → 整窗禁止光标、拖放事件永不触发；
                // 详见 webviewdrop.rs）。改回 true 后 wry 的 WindowEvent::DragDrop 恢复，
                // 并且**带真实文件路径**，前端直接进转换列表。
                #[cfg(windows)]
                webviewdrop::allow_external_drop(app.handle(), "main");
                let w = win.clone();
                std::thread::spawn(move || {
                    // 等 WebView 首帧渲染，避免白屏闪烁
                    std::thread::sleep(std::time::Duration::from_millis(450));
                    let _ = w.show();
                    let _ = w.set_focus();
                    log::info!("[main] 启动显示主窗");
                });
            }
            // Electron 语义对齐：关闭=隐藏到托盘；失焦=自动隐藏（closeOnBlur !== false，与 main.ts blur 一致）
            {
                let win2 = win.clone();
                let app2 = app.handle().clone();
                // 拖放悬停标志：拖放期间资源管理器持有焦点，主窗不得自动隐藏
                static DRAG_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
                win.on_window_event(move |event| {
                    match event {
                        // 记录"真正获得焦点"的时刻：只有稳定拿到过焦点之后的失焦，才算用户主动点走
                        tauri::WindowEvent::Focused(true) => {
                            MAIN_FOCUSED_AT.store(now_millis(), std::sync::atomic::Ordering::Relaxed);
                        }
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            save_window_state(&win2);
                            let _ = win2.hide();
                        }
                        tauri::WindowEvent::DragDrop(ev) => match ev {
                            tauri::DragDropEvent::Enter { .. } => {
                                DRAG_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
                                log::info!("[drop] 拖放进入窗口");
                                let _ = app2.emit("converter:dragover", serde_json::json!({ "active": true }));
                            }
                            tauri::DragDropEvent::Drop { paths, .. } => {
                                DRAG_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
                                let list: Vec<String> = paths
                                    .iter()
                                    .map(|p| p.to_string_lossy().into_owned())
                                    .collect();
                                log::info!("[drop] 窗口内松手，文件数={}", list.len());
                                let _ = app2.emit(
                                    "converter:drop",
                                    serde_json::json!({ "paths": list, "action": "convert" }),
                                );
                                let _ = app2.emit("converter:dragover", serde_json::json!({ "active": false }));
                            }
                            tauri::DragDropEvent::Leave { .. } => {
                                DRAG_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
                                let _ = app2.emit("converter:dragover", serde_json::json!({ "active": false }));
                            }
                            _ => {}
                        },
                        tauri::WindowEvent::Focused(false) => {
                            // 拖放进行中不隐藏（文件正从资源管理器拖入）
                            if DRAG_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
                                return;
                            }
                            // 转换板块不隐藏（BLUR_GUARD）：拖文件进来时焦点在资源管理器，
                            // 一旦隐藏就再也接不到 drop
                            if BLUR_GUARD.load(std::sync::atomic::Ordering::Relaxed) {
                                return;
                            }
                            // 刚被程序化显示（托盘/Alt+Space/解冻恢复）的 800ms 内不因失焦隐藏：
                            // 否则焦点被外部抢走的瞬间就会把面板藏掉，用户看到的是"呼出后没反应"
                            let shown_at = MAIN_SHOWN_AT.load(std::sync::atomic::Ordering::Relaxed);
                            let focused_at = MAIN_FOCUSED_AT.load(std::sync::atomic::Ordering::Relaxed);
                            let now_ms = now_millis();
                            if shown_at > 0 && now_ms.saturating_sub(shown_at) < 800 {
                                log::info!("[main] 失焦但在显示宽限期内，不隐藏");
                                return;
                            }
                            // 焦点没稳定拿到过就失焦（Windows 前台锁把焦点抢回去了）：
                            // 这不是"用户点走了"，藏掉只会让人以为面板坏了 —— 实测一秒内连藏三次。
                            if focused_at == 0 || now_ms.saturating_sub(focused_at) < 400 {
                                log::info!("[main] 失焦但未曾稳定获得焦点（前台抢焦点），不隐藏");
                                return;
                            }
                            // closeOnBlur 配置（缺省开启）：主窗失焦自动隐藏。
                            // 但鼠标仍在窗口矩形内 = 用户在拖动/窗口内操作导致的失焦，不隐藏
                            let cfg = crate::config::read_config_value();
                            let close_on_blur = cfg
                                .as_ref()
                                .and_then(|c| c.get("closeOnBlur"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(true);
                            if close_on_blur {
                                let in_window = (|| -> Option<bool> {
                                    let cur = app2.cursor_position().ok()?;
                                    let pos = win2.outer_position().ok()?;
                                    let size = win2.outer_size().ok()?;
                                    let (cx, cy) = (cur.x, cur.y);
                                    let (wx, wy, ww, wh) = (pos.x as f64, pos.y as f64, size.width as f64, size.height as f64);
                                    Some(cx >= wx && cx <= wx + ww && cy >= wy && cy <= wy + wh)
                                })()
                                .unwrap_or(false);
                                if !in_window {
                                    log::info!("[main] 失焦且光标在窗外 → 隐藏主面板");
                                    let _ = win2.hide();
                                }
                            }
                        }
                        _ => {}
                    }
                });
            }

            // 右键菜单 / 命令行启动参数：
            //  - --compress/--extract = **直接执行**（不开面板、不显示窗口；冷启动干完就退出）
            //  - --convert = 老流程，转交前端加进转换列表
            let cli: Vec<String> = std::env::args().collect();
            match shellmenu::parse_cli(&cli) {
                Some((action, paths)) => {
                    log::info!("[shell] 冷启动参数 action={} 文件数={}", action, paths.len());
                    // --compress/--extract/--shellmenu-* 不会走到这里（directcmd 已在进 Tauri 前处理）
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    queue_drop(app.handle(), paths, action);
                }
                None => log::info!("[shell] 冷启动无动作参数（args={:?}）", cli),
            }

            // 托盘：显示主面板 / 游戏模式（冻结后台）/ 分隔线 / 退出
            let menu = build_tray_menu(app.handle())?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_tray_event(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    // 左键单击 = 切换主面板（对齐 Electron tray.on('click', toggleWindow)）
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // M5：任务提醒扫描（30s 周期）
    {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                // 游戏模式（冻结后台）：连提醒弹窗都不该出现，直接跳过这一轮
                if freeze::is_frozen() {
                    continue;
                }
                scan_due_reminders(&handle);
            }
        });
    }

            // 音乐桥：按配置主动启动（对齐 Electron island.music 启用即采集；
            // 不依赖岛前端挂载时序——岛 mount 的 startMusicBridge 是唯一入口时存在竞态）
            {
                let cfg = config::read_config_value().unwrap_or(json!({}));
                let island_module_on = cfg.get("modules").and_then(|m| m.as_array())
                    .map(|a| a.iter().any(|m| m.get("id").and_then(|v| v.as_str()) == Some("island") && m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)))
                    .unwrap_or(true);
                let music_enabled = cfg.get("island").and_then(|i| i.get("musicEnabled")).and_then(|v| v.as_bool()).unwrap_or(false);
                let music_feature = cfg.get("license").and_then(|l| l.get("featureAccess")).and_then(|f| f.as_array())
                    .and_then(|a| a.iter().find(|f| f.get("id").and_then(|v| v.as_str()) == Some("island.music")).and_then(|f| f.get("allowed")).and_then(|v| v.as_bool()))
                    .unwrap_or(true);
                if island_module_on && music_enabled && music_feature
                {
                    let st = app.state::<MusicHandle>();
                    sidecar::start_music_bridge(app.handle().clone(), st.0.clone());
                    log::info!("[music] 启动时按配置预启动音乐桥");
                }
                // 岛（SC球）：配置启用则启动即显示（对齐 Electron createIslandWindow，不再需要 Alt+I 手动唤出）
                {
                    let cfg2 = config::read_config_value().unwrap_or(json!({}));
                    let island_on = cfg2.get("island").and_then(|i| i.get("enabled")).and_then(|v| v.as_bool()).unwrap_or(false);
                    if island_module_on && island_on {
                        if app.get_webview_window("island").is_none() {
                            let handle = app.handle().clone();
                            match windows::ensure_island(&handle) {
                                Ok(_) => log::info!("[island] 启动时按配置创建并显示"),
                                Err(e) => log::error!("[island] 启动创建失败: {}", e),
                            }
                        }
                        // SC 球（余额/音乐球）状态对齐
                        sync_deepseekball_state(app.handle());
                    }
                    // 任务板块启用时启动即显示任务墙（ensure_tasklist 内部无激活显示）
                    let tasks_enabled = cfg2.get("island").and_then(|i| i.get("tasksEnabled")).and_then(|v| v.as_bool()).unwrap_or(true);
                    if island_module_on && tasks_enabled && app.get_webview_window("tasklist").is_none() {
                        let handle = app.handle().clone();
                        if windows::ensure_tasklist(&handle).is_ok() {
                            log::info!("[tasklist] 启动时按配置显示任务墙");
                        }
                    }
                }
            }
    Ok(())
        })
        .invoke_handler(tauri::generate_handler![electron_api])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // 退出前保存主窗状态
                if let Some(w) = app.get_webview_window("main") {
                    save_window_state(&w);
                }
                // 退出清理 sidecar 子进程，避免孤儿（音乐桥 powershell / 硬件监控进程）
                use tauri::Manager;
                if let Some(mh) = app.try_state::<MusicHandle>() {
                    sidecar::kill_child(&mh.0.child);
                }
                if let Some(ch) = app.try_state::<CockpitHandle>() {
                    sidecar::kill_child(&ch.0.child);
                }
            }
        });
}

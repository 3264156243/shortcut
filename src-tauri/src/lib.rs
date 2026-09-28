//! ShortCut Tauri 2 壳——M1 最小壳
//! 设计：前端 electronAPI shim（initialization_script 注入）→ 统一 invoke `electron_api` 命令
//! → 本文件 match 分发。未实现的 method 返回 Null 兜底，前端不崩；按里程碑逐步补齐。

use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

/// electronAPI shim：渲染层每次访问 window.electronAPI 的任意方法都落到 invoke('electron_api')。
/// 回调型（onXxx）映射到 tauri 事件 'electron:<name>'。
/// __TAURI__ 由 withGlobalTauri 注入；若 shim 先于其执行，等待就绪后再装配。
const SHIM_JS: &str = r#"
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
fn electron_api(app: tauri::AppHandle, window: tauri::WebviewWindow, method: String, args: Value) -> Value {
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

        // ---- 未迁移方法兜底：返回空对象，前端不崩（按里程碑补齐）----
        _ => {
            log::debug!("[shim] 未实现的 electronAPI 方法: {}", method);
            Value::Null
        }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 主窗口（conf 已定义，这里拿句柄挂 shim）
            let win = app
                .get_webview_window("main")
                .unwrap_or_else(|| {
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                        .title("ShortCut")
                        .build()
                        .unwrap()
                });
            let _ = win.initialization_script(SHIM_JS);

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
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![electron_api])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

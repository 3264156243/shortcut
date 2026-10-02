//! 让 WebView2 交还外部拖放（P3 "拖不进来"的根因修复）
//!
//! 实测结论（别再重复踩这些坑）：
//!   1) WebView2 的子窗（Chrome_WidgetWin_1 / Chrome_RenderWidgetHostHWND）属于 msedgewebview2 进程，
//!      OLE 判定落点是「光标下窗口沿父链向上找第一个已注册 drop target」，命中的是 Chromium 自己的；
//!      wry 又把 WebView2 的 `AllowExternalDrop` 置成 false（wry 以为自己的 IDropTarget 接住了），
//!      于是 Chromium 对文件拖放一律返回 DROPEFFECT_NONE：整窗禁止光标、wry 的
//!      WindowEvent::DragDrop 永远不触发 —— 这就是"拖文件进来没反应"的根因。
//!   2) 在自有窗口上重新注册 IDropTarget 无效：跨进程 RegisterDragDrop 虽返回成功却不会生效
//!      （已试过接管窗口链上全部 15 个窗口，DragEnter 一次都没被调用）。
//!   3) 把 `AllowExternalDrop` 改回 true 即可：Chromium 收下拖放并**转交给宿主的 drop target**
//!      （wry 注册的那个），于是 Tauri 的 WindowEvent::DragDrop 恢复工作，并且**带真实文件路径**。
//!
//! 注意：wry 在创建 webview 时做了这件事，所以要在窗口建好后再改回来（带重试，controller 异步就绪）。

/// 把指定窗口的 WebView2 `AllowExternalDrop` 设为 true
#[cfg(windows)]
pub fn allow_external_drop_once(app: &tauri::AppHandle, label: &str) -> bool {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller4;
    use windows_core::Interface;

    let Some(win) = app.get_webview_window(label) else {
        log::warn!("[drop] 窗口 {} 不存在，无法开启外部拖放", label);
        return false;
    };
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let label2 = label.to_string();
    let dispatched = win.with_webview(move |pw| {
        // PlatformWebview::controller() 已返回类型化的 ICoreWebView2Controller
        let ctrl = pw.controller();
        let res: Result<(), String> = unsafe {
            match ctrl.cast::<ICoreWebView2Controller4>() {
                Ok(c4) => c4
                    .SetAllowExternalDrop(true)
                    .map_err(|e| format!("SetAllowExternalDrop 失败: {e:?}")),
                Err(e) => Err(format!("取 ICoreWebView2Controller4 失败: {e:?}")),
            }
        };
        log::info!("[drop] 窗口 {} 开启外部拖放: {:?}", label2, res);
        let _ = tx.send(res);
    });
    if let Err(e) = dispatched {
        log::error!("[drop] with_webview 调用失败({}): {}", label, e);
        return false;
    }
    matches!(rx.recv_timeout(std::time::Duration::from_secs(5)), Ok(Ok(())))
}

#[cfg(not(windows))]
pub fn allow_external_drop_once(_app: &tauri::AppHandle, _label: &str) -> bool {
    false
}

/// 带重试的开启（WebView2 controller 异步就绪，首次调用可能还没准备好）
pub fn allow_external_drop(app: &tauri::AppHandle, label: &str) {
    if allow_external_drop_once(app, label) {
        return;
    }
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        for delay in [800u64, 1500, 3000, 6000] {
            std::thread::sleep(std::time::Duration::from_millis(delay));
            let a = app.clone();
            let l = label.clone();
            let l2 = l.clone();
            let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let done2 = done.clone();
            let a2 = a.clone();
            if app
                .run_on_main_thread(move || {
                    let ok = allow_external_drop_once(&a2, &l);
                    done2.store(ok, std::sync::atomic::Ordering::Relaxed);
                })
                .is_err()
            {
                log::warn!("[drop] {} 开启外部拖放调度失败", l2);
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
            if done.load(std::sync::atomic::Ordering::Relaxed) {
                log::info!("[drop] 窗口 {} 外部拖放已开启（第 {} 轮重试成功）", label, delay);
                return;
            }
        }
        log::error!("[drop] 窗口 {} 外部拖放开启失败（重试耗尽）", label);
    });
}

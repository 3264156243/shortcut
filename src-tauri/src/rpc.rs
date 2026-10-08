//! rpc 能力（桌面侧）：拉取手机投递的一次性指令 → 执行 → 回执 → ack。
//!
//! 服务端只负责"可靠投递 + 结果暂存"（`api.php` 的 `module.invoke` / `module.invoke.result`
//! / `module.invoke.status`），指令语义完全在桌面端解释，因此这里必须**白名单**执行，
//! 不允许把服务端传来的字符串当命令跑。
//!
//! 通道复用既有的队列能力：指令入队 `board=rpc`，结果入队 `board=rpc-result`。

use serde_json::{json, Value};

use crate::hub;

/// 与 `server/sync/api.php` 的 module.invoke 白名单保持一致
const METHODS: [&str; 2] = ["open", "ping"];

/// 执行单条指令，返回 (invokeId, ok, message)
fn run_one(app: &tauri::AppHandle, task: &Value) -> (String, bool, String) {
    let id = task.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let method = task.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let target = task
        .get("params")
        .and_then(|p| p.get("target"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if !METHODS.contains(&method) {
        return (id, false, format!("不支持的指令: {}", method));
    }
    match method {
        "ping" => (id, true, "pong".to_string()),
        "open" => {
            if target.is_empty() {
                return (id, false, "缺少 target".to_string());
            }
            // 复用主面板「打开目标」同一条能力（opener 插件 → ShellExecute）
            use tauri_plugin_opener::OpenerExt;
            let ok = if target.starts_with("http://") || target.starts_with("https://") {
                app.opener().open_url(target.clone(), None::<&str>).is_ok()
            } else {
                app.opener().open_path(target.clone(), None::<&str>).is_ok()
            };
            if ok {
                (id, true, format!("已打开 {}", target))
            } else {
                (id, false, format!("打开失败: {}", target))
            }
        }
        other => (id, false, format!("不支持的指令: {}", other)),
    }
}

/// 拉取 `board=rpc` 的待执行指令并逐条执行，最后 ack 已处理项。
/// 由 `lib.rs` 的后台线程每 8 秒调用一次；未绑定/冻结时直接跳过。
pub fn pull_and_run_rpc(app: tauri::AppHandle) -> Value {
    if crate::freeze::is_frozen() {
        return json!({ "success": false, "message": "游戏模式冻结中" });
    }
    let pulled = match hub::api_post("module.pull", json!({ "board": "rpc" })) {
        Ok(v) => v,
        Err(e) => return json!({ "success": false, "message": e }),
    };
    let tasks = pulled.get("tasks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if tasks.is_empty() {
        return json!({ "success": true, "handled": 0 });
    }

    let mut handled: Vec<Value> = Vec::new();
    for task in tasks.iter() {
        let (id, ok, message) = run_one(&app, task);
        if id.is_empty() {
            continue;
        }
        log::info!("[rpc] 指令 {} → ok={} {}", id, ok, message);
        // 回执：失败也只记日志（下一轮还会重试，避免结果丢失时手机端一直 pending）
        if let Err(e) = hub::api_post(
            "module.invoke.result",
            json!({ "invokeId": id, "ok": ok, "message": message }),
        ) {
            log::warn!("[rpc] 回执上报失败 {}: {}", id, e);
            continue;
        }
        handled.push(json!(id));
    }

    if !handled.is_empty() {
        if let Err(e) = hub::api_post("module.ack", json!({ "board": "rpc", "taskIds": handled })) {
            log::warn!("[rpc] ack 失败: {}", e);
        }
    }
    json!({ "success": true, "handled": handled.len() })
}

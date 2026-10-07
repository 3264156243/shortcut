//! M5 绑定同步——对齐 electron/sync/{binding,engine,init}.ts
//! bind.create/bind.info/bind.claimToken/bind.boards.update + pull/ack 拉取引擎 + 任务便签写入

use rand::Rng;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::config;

const SYNC_API_URL: &str = "https://shortcut.326415.xyz/sync/api.php";
/// get_bind_info 内存缓存 TTL：一次文件上传会连打数次绑定查询，缓存后 60 秒内只发一次
const BIND_CACHE_TTL: Duration = Duration::from_secs(60);

static BIND_CACHE: OnceLock<Mutex<Option<(Instant, Value)>>> = OnceLock::new();
/// bind.claimToken 被服务端明确拒绝（如"该绑定已签发过桌面凭证"）→ 不再重复请求
static CLAIM_REJECTED: AtomicBool = AtomicBool::new(false);

fn bind_cache() -> &'static Mutex<Option<(Instant, Value)>> {
    BIND_CACHE.get_or_init(|| Mutex::new(None))
}

/// 清空 get_bind_info 缓存（绑定新建 / 解绑 / deskToken 变更后必须调用）
pub fn invalidate_bind_cache() {
    if let Ok(mut guard) = bind_cache().lock() {
        *guard = None;
    }
    CLAIM_REJECTED.store(false, Ordering::Relaxed);
}

fn request(payload: Value) -> Result<Value, String> {
    let resp = ureq::post(SYNC_API_URL)
        .timeout(std::time::Duration::from_millis(10_000))
        .send_json(payload)
        .map_err(|e| e.to_string())?;
    resp.into_json::<Value>().map_err(|e| e.to_string())
}

fn read_desk_token() -> Option<String> {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let token = cfg.get("sync")?.get("deskToken").and_then(|v| v.as_str())?.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// 桌面端凭证（deskToken）—— 读配置 sync.deskToken，读不到返回空串
pub fn desk_token() -> String {
    read_desk_token().unwrap_or_default()
}

fn store_desk_token(token: &str) {
    // parse 失败绝不能把空骨架写回（防数据覆盖）
    let Some(mut cfg) = config::read_config_value() else {
        log::warn!("[sync] store_desk_token 跳过：config.json 解析失败");
        return;
    };
    if let Some(obj) = cfg.as_object_mut() {
        let sync = obj.entry("sync").or_insert_with(|| json!({}));
        if let Some(sobj) = sync.as_object_mut() {
            sobj.insert("deskToken".into(), json!(token));
        }
    }
    config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    invalidate_bind_cache();
}

/// 桌面凭证引导：本地已有 → 直接返回；否则用 bindId + bindCode 调 bind.claimToken 换取并落盘。
/// 失败只记日志（兼容期内旧绑定仍可用免凭证通道），返回 None。
pub fn ensure_desk_token() -> Option<String> {
    if let Some(token) = read_desk_token() {
        return Some(token);
    }
    if CLAIM_REJECTED.load(Ordering::Relaxed) {
        return None;
    }
    let Some((bind_id, code, _)) = stored_binding() else {
        return None;
    };
    if code.is_empty() {
        return None;
    }
    match request(json!({ "action": "bind.claimToken", "bindId": bind_id, "code": code })) {
        Ok(data) => {
            let ok = data.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let token = data.get("deskToken").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if ok && !token.is_empty() {
                store_desk_token(&token);
                log::info!("[sync] 桌面凭证已签发（bindId={}）", bind_id);
                return Some(token);
            }
            // 服务端明确拒绝（已签发过 / 绑定码无效）——重试无意义，避免每次都打网络
            CLAIM_REJECTED.store(true, Ordering::Relaxed);
            log::warn!(
                "[sync] 桌面凭证签发失败: {}",
                data.get("message").and_then(|v| v.as_str()).unwrap_or("响应缺少 deskToken")
            );
            None
        }
        Err(e) => {
            log::warn!("[sync] 桌面凭证签发请求失败: {}", e);
            None
        }
    }
}

fn stored_binding() -> Option<(String, String, String)> {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let sync = cfg.get("sync")?;
    let bind_id = sync.get("bindId").and_then(|v| v.as_str())?.to_string();
    if bind_id.is_empty() {
        return None;
    }
    Some((
        bind_id,
        sync.get("bindCode").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        sync.get("bindUrl").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    ))
}

fn store_binding(bind_id: &str, code: &str, bind_url: &str) {
    // parse 失败绝不能把空骨架写回（防数据覆盖）
    let Some(mut cfg) = config::read_config_value() else {
        log::warn!("[sync] store_binding 跳过：config.json 解析失败");
        return;
    };
    if let Some(obj) = cfg.as_object_mut() {
        let sync = obj.entry("sync").or_insert_with(|| json!({}));
        if let Some(sobj) = sync.as_object_mut() {
            sobj.insert("bindId".into(), json!(bind_id));
            sobj.insert("bindCode".into(), json!(code));
            sobj.insert("bindUrl".into(), json!(bind_url));
        }
    }
    config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
}

fn create_binding() -> Result<Value, String> {
    let data = request(json!({ "action": "bind.create" }))?;
    if data.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let Some(bind_id) = data.get("bindId").and_then(|v| v.as_str()) {
            let code = data.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let bind_url = data
                .get("bindUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("https://shortcut.326415.xyz/mobile/?bind={}", bind_id));
            store_binding(bind_id, code, &bind_url);
            // 桌面凭证只在这一处明文返回一次，必须与绑定信息一同落盘
            let desk = data.get("deskToken").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if desk.is_empty() {
                log::warn!("[sync] bind.create 未返回 deskToken（bindId={}）", bind_id);
            } else {
                store_desk_token(&desk);
            }
            invalidate_bind_cache();
            return Ok(json!({ "bindId": bind_id, "code": code, "bindUrl": bind_url, "deskToken": desk }));
        }
    }
    Err("创建绑定失败".to_string())
}

/// 对齐 getOrCreateBind/getBindInfo：stored → bind.info 校验 → 有效复用 / 无效重建 / 网络失败沿用 stored
/// 带 60 秒内存缓存（绑定变更时会失效），避免一次文件上传连打多次绑定查询
pub fn get_bind_info() -> Result<Value, String> {
    if let Ok(guard) = bind_cache().lock() {
        if let Some((at, cached)) = guard.as_ref() {
            if at.elapsed() < BIND_CACHE_TTL {
                return Ok(cached.clone());
            }
        }
    }
    let result = get_bind_info_uncached();
    if let Ok(info) = &result {
        if let Ok(mut guard) = bind_cache().lock() {
            *guard = Some((Instant::now(), info.clone()));
        }
    }
    result
}

fn get_bind_info_uncached() -> Result<Value, String> {
    let Some((bind_id, code, bind_url)) = stored_binding() else {
        return create_binding();
    };
    // 旧绑定升级引导：本地还没有桌面凭证时先尝试 claimToken（失败只记日志，兼容期仍可继续）
    ensure_desk_token();
    let desk = desk_token();
    match request(json!({ "action": "bind.info", "bindId": bind_id, "deskToken": desk })) {
        Ok(data) => {
            let success = data.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if success {
                let valid = data.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);
                if valid {
                    // 没带有效凭证时服务端**不返回** code/bindUrl —— 保留已有值，绝不覆盖成空串
                    let new_code = data
                        .get("code")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or(code.as_str());
                    let new_url = data
                        .get("bindUrl")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or(bind_url.as_str());
                    store_binding(&bind_id, new_code, new_url);
                    return Ok(json!({
                        "bindId": bind_id,
                        "code": new_code,
                        "bindUrl": new_url,
                        "deskToken": desk_token(),
                        "deskTokenValid": data.get("deskTokenValid").and_then(|v| v.as_bool()).unwrap_or(false),
                    }));
                }
                return create_binding();
            }
            Ok(json!({ "bindId": bind_id, "code": code, "bindUrl": bind_url, "deskToken": desk }))
        }
        Err(_) => Ok(json!({ "bindId": bind_id, "code": code, "bindUrl": bind_url, "deskToken": desk })),
    }
}

pub fn get_stored_bind_id() -> Option<String> {
    stored_binding().map(|(id, _, _)| id)
}

fn publish_board_names(names: &[String]) -> bool {
    let Some(bind_id) = get_stored_bind_id() else { return false };
    let mut boards: Vec<String> = Vec::new();
    for n in names {
        let t = n.trim().to_string();
        if !t.is_empty() && !boards.contains(&t) {
            boards.push(t);
        }
    }
    boards.truncate(50);
    match request(json!({ "action": "bind.boards.update", "bindId": bind_id, "deskToken": desk_token(), "boards": boards })) {
        Ok(d) => d.get("success").and_then(|v| v.as_bool()).unwrap_or(false),
        Err(_) => false,
    }
}

/// taskwall 板块启用检查（config.modules 数组 enabled !== false）
fn taskwall_enabled() -> bool {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    if let Some(list) = cfg.get("modules").and_then(|v| v.as_array()) {
        for entry in list {
            if entry.get("id").and_then(|v| v.as_str()) == Some("taskwall") {
                return entry.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            }
        }
    }
    true
}

fn read_board_names() -> Vec<String> {
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    cfg.get("taskBoards")
        .and_then(|v| v.as_array())
        .map(|boards| boards.iter().filter_map(|b| b.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

/// 便签样式（对齐 createTaskNote）
fn create_task_note(task: &Value, z_index: i64) -> Value {
    const TAPES: [&str; 7] = ["#c0392b", "#e67e22", "#f39c12", "#27ae60", "#2980b9", "#8e44ad", "#e84393"];
    let mut rng = rand::rng();
    let id = task
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("rmt_{}", (0..12).map(|_| format!("{:02x}", rng.random_range(0..256))).collect::<String>()));
    let now = chrono::Local::now().to_rfc3339();
    let long_text = task.get("longText").and_then(|v| v.as_bool()).unwrap_or(false);
    let reminder_enabled = task.get("reminderEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
    json!({
        "id": id,
        "text": task.get("text").and_then(|v| v.as_str()).unwrap_or(""),
        "longText": if long_text { json!(true) } else { Value::Null },
        "details": if long_text { task.get("details").cloned().unwrap_or(Value::Null) } else { Value::Null },
        "reminderAt": if reminder_enabled { task.get("reminderAt").cloned().unwrap_or(Value::Null) } else { Value::Null },
        "done": false,
        "x": 4.0 + rng.random_range(0.0..58.0),
        "y": 5.0 + rng.random_range(0.0..52.0),
        "rotation": rng.random_range(-1.7..1.7),
        "tape": TAPES[rng.random_range(0..TAPES.len())],
        "zIndex": z_index,
        "createdAt": now,
        "updatedAt": now,
    })
}

/// 拉取 taskwall 队列并写入本地任务墙（对齐 pullBoard + taskwall consumer）
pub fn pull_taskwall() -> Value {
    let Some(bind_id) = get_stored_bind_id() else {
        return json!({ "board": "taskwall", "count": 0, "error": "尚未建立联动绑定" });
    };
    let data = match request(json!({ "action": "pull", "board": "taskwall", "bindId": bind_id, "deskToken": desk_token() })) {
        Ok(d) => d,
        Err(_) => return json!({ "board": "taskwall", "count": 0, "error": "同步服务暂时不可用" }),
    };
    if !data.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        let msg = data.get("message").and_then(|v| v.as_str()).unwrap_or("拉取任务失败");
        return json!({ "board": "taskwall", "count": 0, "error": msg });
    }
    let tasks: Vec<Value> = data
        .get("tasks")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().take(500).filter(|t| t.get("text").and_then(|x| x.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false)).cloned().collect())
        .unwrap_or_default();
    if tasks.is_empty() {
        return json!({ "board": "taskwall", "count": 0 });
    }

    // 写入 config.taskBoards（parse 失败中止，防覆盖）
    let Some(mut cfg) = config::read_config_value() else {
        return json!({ "board": "taskwall", "count": 0, "error": "本地配置读取失败，云端任务已保留" });
    };
    let mut imported = 0i64;
    {
        let obj = cfg.as_object_mut().unwrap();
        let boards = obj.entry("taskBoards").or_insert_with(|| json!([]));
        if let Some(arr) = boards.as_array_mut() {
            for task in &tasks {
                let board_name = task.get("boardName").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "默认任务墙".to_string());
                let board_idx = arr.iter().position(|b| b.get("name").and_then(|v| v.as_str()) == Some(board_name.as_str()));
                let board_idx = match board_idx {
                    Some(i) => i,
                    None => {
                        let now = chrono::Local::now().to_rfc3339();
                        let mut rng = rand::rng();
                        let id = format!("sync_{}", (0..8).map(|_| format!("{:02x}", rng.random_range(0..256))).collect::<String>());
                        arr.push(json!({ "id": id, "name": board_name, "notes": [], "createdAt": now, "updatedAt": now }));
                        arr.len() - 1
                    }
                };
                let board = &mut arr[board_idx];
                let notes_empty = board.get("notes").and_then(|n| n.as_array()).map(|n| n.is_empty()).unwrap_or(true);
                let existing_ids: Vec<String> = board.get("notes").and_then(|n| n.as_array()).map(|n| n.iter().filter_map(|x| x.get("id").and_then(|i| i.as_str()).map(|s| s.to_string())).collect()).unwrap_or_default();
                let task_id = task.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if existing_ids.iter().any(|x| x == task_id) {
                    continue;
                }
                let max_z = board.get("notes").and_then(|n| n.as_array()).map(|n| n.iter().filter_map(|x| x.get("zIndex").and_then(|z| z.as_i64())).max().unwrap_or(0)).unwrap_or(0);
                let note = create_task_note(task, max_z + 1);
                let note_obj = note.clone();
                if let Some(nobj) = board.as_object_mut() {
                    let notes_val = nobj.entry("notes").or_insert_with(|| if notes_empty { json!([]) } else { json!([]) });
                    if let Some(narr) = notes_val.as_array_mut() {
                        narr.insert(0, note_obj);
                    }
                    nobj.insert("updatedAt".into(), json!(chrono::Local::now().to_rfc3339()));
                }
                imported += 1;
            }
        }
    }
    if imported > 0 {
        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    }

    // ack
    let task_ids: Vec<String> = tasks.iter().filter_map(|t| t.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
    let ack = request(json!({ "action": "ack", "board": "taskwall", "bindId": bind_id, "deskToken": desk_token(), "taskIds": task_ids }));
    match ack {
        Ok(a) if a.get("success").and_then(|v| v.as_bool()).unwrap_or(false) => {}
        _ => {
            return json!({ "board": "taskwall", "count": imported, "error": "任务已写入本地，但云端确认失败，下次将自动去重" });
        }
    }
    json!({ "board": "taskwall", "count": imported })
}

/// 对齐 sync:getBinding
pub fn sync_get_binding() -> Value {
    match get_bind_info() {
        Ok(info) => {
            publish_board_names(&read_board_names());
            json!({ "success": true, "bindId": info["bindId"], "code": info["code"], "bindUrl": info["bindUrl"] })
        }
        Err(e) => json!({ "success": false, "message": e }),
    }
}

/// 对齐 sync:pullNow
pub fn sync_pull_now() -> Value {
    if !taskwall_enabled() {
        return json!({ "success": false, "count": 0, "results": [], "message": "任务墙已禁用，请先在板块管理中启用" });
    }
    let result = pull_taskwall();
    let count = result.get("count").and_then(|v| v.as_i64()).unwrap_or(0);
    let error = result.get("error").and_then(|v| v.as_str());
    json!({
        "success": error.is_none(),
        "results": [result],
        "count": count,
        "message": error.map(|s| json!(s)).unwrap_or(Value::Null),
    })
}

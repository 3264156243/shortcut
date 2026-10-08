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
/// 自动拉取（启动一次 / 实时唤醒）的并发去重：同一时刻只允许一个拉取在跑。
/// 两个拉取并发跑会各自 read_config_value() 再 write_config() → 后写的那份把先写的便签冲掉。
static PULL_BUSY: AtomicBool = AtomicBool::new(false);

/// PULL_BUSY 的 RAII 释放（panic 也能释放，否则一次异常会让自动拉取永久失效）
struct PullBusyGuard;
impl Drop for PullBusyGuard {
    fn drop(&mut self) {
        PULL_BUSY.store(false, Ordering::SeqCst);
    }
}

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

/// 供 `hub` 复用的 api.php HTTP 客户端（**唯一**的 ureq 出口，避免各模块重复造超时/错误文案）。
/// 错误文案带真实原因（审计 D8）：`请求超时` / `网络错误: <e>` / `服务暂时不可用: <message>`。
pub fn api_post(payload: Value) -> Result<Value, String> {
    let resp = match ureq::post(SYNC_API_URL)
        .timeout(std::time::Duration::from_millis(15_000))
        .send_json(payload)
    {
        Ok(r) => r,
        Err(ureq::Error::Status(_, _)) => return Err("服务暂时不可用: 服务端返回非 2xx".to_string()),
        Err(ureq::Error::Transport(t)) => {
            let msg = t.to_string();
            return Err(if msg.to_lowercase().contains("timed out") || msg.to_lowercase().contains("timeout") {
                "请求超时".to_string()
            } else {
                format!("网络错误: {}", msg)
            });
        }
    };
    resp.into_json::<Value>()
        .map_err(|e| format!("服务暂时不可用: {}", e))
}

/// 桌面凭证的落盘文件：**不能放 config.json**。
/// 前端的 writeConfig 是整份覆盖，放配置里会被冲掉（实测踩到：签发成功但字段长度 0），
/// 而服务端此时已认为"该绑定签发过凭证"，客户端反而被拒。独立文件与 window-state.json 同思路。
fn desk_token_file() -> std::path::PathBuf {
    let dir = config::config_dir();
    let _ = std::fs::create_dir_all(&dir);
    dir.join("desk-token.json")
}

fn read_desk_token() -> Option<String> {
    // 1) 独立文件（权威）
    if let Ok(raw) = std::fs::read_to_string(desk_token_file()) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            if let Some(t) = v.get("deskToken").and_then(|x| x.as_str()) {
                let t = t.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    // 2) 兼容：早期版本曾写进 config.sync.deskToken（可能已被前端覆盖，仅作兜底）
    let raw = config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let token = cfg.get("sync")?.get("deskToken").and_then(|v| v.as_str())?.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// 桌面端凭证（deskToken）—— 读独立文件，读不到返回空串。
/// 注意：对外统一经 `hub::desk_token()` 暴露给各业务模块（sync 只保留绑定/凭证实现）。
pub fn desk_token() -> String {
    read_desk_token().unwrap_or_default()
}

fn store_desk_token(token: &str) {
    if token.trim().is_empty() {
        return;
    }
    let body = json!({ "deskToken": token.trim(), "savedAt": chrono::Local::now().to_rfc3339() });
    match std::fs::write(desk_token_file(), body.to_string()) {
        Ok(_) => {
            log::info!("[sync] 桌面凭证已落盘（desk-token.json）");
            invalidate_bind_cache();
        }
        Err(e) => log::warn!("[sync] 桌面凭证落盘失败: {}", e),
    }
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

/// 上报墙名列表的失败原因（原来只返回 bool，失败原因被丢弃 → 静默失败，真机排查困难）
#[derive(Debug, Clone)]
pub enum BoardPublishError {
    /// 还没绑定（没拿到 bindId）
    NotBound,
    /// 请求发不出去（网络/DNS/超时）
    Transport(String),
    /// 服务端明确返回 success != true
    Rejected(String),
    /// 服务端返回成功但没有 success 字段（契约异常）
    Malformed,
}

impl std::fmt::Display for BoardPublishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BoardPublishError::NotBound => write!(f, "尚未绑定桌面端（缺少 bindId）"),
            BoardPublishError::Transport(e) => write!(f, "请求失败: {}", e),
            BoardPublishError::Rejected(m) => write!(f, "服务端拒绝: {}", m),
            BoardPublishError::Malformed => write!(f, "服务端响应缺少 success 字段"),
        }
    }
}

/// 归一化墙名（去空白、去空、去重），与 publish 时上报的顺序一致。
fn normalized_board_names(names: &[String]) -> Vec<String> {
    let mut boards: Vec<String> = Vec::new();
    for n in names {
        let t = n.trim().to_string();
        if !t.is_empty() && !boards.contains(&t) {
            boards.push(t);
        }
    }
    boards.truncate(50);
    boards
}

/// 把墙名列表上报给服务端（`bind.boards.update`）。
///
/// **失败绝不静默**：网络异常、服务端拒绝、响应缺 `success` 都会返回具体错误并打日志，
/// 调用方（publish_board_names_now）负责把错误暴露到 UI/日志。
fn publish_board_names(names: &[String]) -> Result<Vec<String>, BoardPublishError> {
    let Some(bind_id) = get_stored_bind_id() else {
        return Err(BoardPublishError::NotBound);
    };
    let boards = normalized_board_names(names);
    // 上报的墙名必须与本地真实配置一致：空列表也要发（让手机端回到"默认任务墙"，
    // 而不是停留在上一次的陈旧墙名上推送 → 桌面按名找不到 → 新建一面墙）。
    let resp = request(json!({
        "action": "bind.boards.update",
        "bindId": bind_id,
        "deskToken": desk_token(),
        "boards": boards
    }));
    match resp {
        Err(e) => Err(BoardPublishError::Transport(e)),
        Ok(d) => match d.get("success").and_then(|v| v.as_bool()) {
            Some(true) => Ok(boards),
            Some(false) => Err(BoardPublishError::Rejected(
                d.get("message").and_then(|v| v.as_str()).unwrap_or("服务端未给出原因").to_string(),
            )),
            None => Err(BoardPublishError::Malformed),
        },
    }
}

/// 把本地墙名上报给服务端（`bind.boards.update`）——手机端 `board.list` 拿到的就是这个列表。
/// 桌面**没上报过**时手机端只有"默认任务墙"，推送的 boardName 与桌面真实墙名不一致 → 落到新建墙。
///
/// 成功/失败都打日志（失败是 warn + 具体原因），返回值仍为 bool 以便复用既有调用点。
pub fn publish_board_names_now() -> bool {
    match publish_board_names(&read_board_names()) {
        Ok(boards) => {
            log::info!("[sync] 已上报墙名列表（{} 项）: {:?}", boards.len(), boards);
            true
        }
        Err(e) => {
            // 这里是"手机上又只剩默认任务墙"的关键排查点：以前失败只写一句笼统 warn，
            // 看不出到底是没绑定、网络挂了还是服务端拒绝了。
            log::warn!("[sync] 墙名列表上报失败: {}（本地墙名: {:?}）", e, read_board_names());
            false
        }
    }
}

/// 应用句柄（lib.rs setup 里注册一次）：拉取写入配置后广播刷新用。未注册时静默跳过。
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// 注册应用句柄（只生效一次；重复注册忽略）
pub fn register_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// 拉取写入 config.json 后通知界面刷新。
/// 写文件本身不会让**已打开**的界面看到新便签（主窗只在 loadConfig 时读盘），
/// 所以这里广播一次：
/// - `config:changed` → 主窗 App.tsx 收到后 loadConfig()（新便签 + 新 activeTaskBoardId 才可见）
/// - `tasklist:data`  → 独立的任务清单窗（src/tasklist.tsx）重渲列表
fn broadcast_config_refresh() {
    let Some(app) = APP_HANDLE.get() else { return };
    use tauri::Emitter;
    let _ = app.emit("config:changed", ());
    let cfg = crate::task_cfg(app);
    let _ = app.emit("tasklist:data", json!(crate::resolve_task_list(&cfg)));
}

/// 墙名重新上报的命令入口（`publishBoardNames` IPC）。
///
/// 桌面**建墙 / 删墙 / 改名**之后必须重新上报，否则手机端下拉框会一直停留在旧墙名上，
/// 用户按旧墙名推送 → 桌面按名找不到 → 新建一面墙（"手机端看到的墙列表 ≠ 桌面真实墙名"）。
/// 返回结构化结果，失败原因直接可读（不再静默）。未绑定时不算错误，返回 skipped。
pub fn publish_board_names_cmd() -> Value {
    let local = read_board_names();
    match publish_board_names(&local) {
        Ok(boards) => {
            log::info!("[sync] 墙名列表已上报（{} 项）: {:?}", boards.len(), boards);
            json!({ "success": true, "boards": boards })
        }
        Err(BoardPublishError::NotBound) => {
            log::info!("[sync] 未绑定，跳过墙名上报");
            json!({ "success": true, "skipped": true, "reason": "not-bound" })
        }
        Err(e) => {
            log::warn!("[sync] 墙名列表上报失败: {}（本地墙名: {:?}）", e, local);
            json!({ "success": false, "message": e.to_string(), "boards": local })
        }
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
    // 本次实际写入的墙（第一条落点的墙 id）与新建墙数量：
    // - target_board_id 用于写入后把 activeTaskBoardId 切过去（否则"收到了却看不到"）
    // - new_boards > 0 时才需要重新上报墙名（手机端 board.list 才是真实墙名）
    let mut target_board_id: Option<String> = None;
    let mut new_boards = 0i64;
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
                        new_boards += 1;
                        arr.len() - 1
                    }
                };
                let board = &mut arr[board_idx];
                let board_id = board.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
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
                if target_board_id.is_none() && !board_id.is_empty() {
                    target_board_id = Some(board_id);
                }
                imported += 1;
            }
        }
    }
    if imported > 0 {
        // 写入后可见：把当前活动墙切到本次写入的那面墙（任务墙 UI 只渲染 activeTaskBoardId，
        // 不切的话新墙里的便签"收到了却看不到"）。与当前不同才改，避免无意义写盘。
        if let Some(target) = target_board_id.clone() {
            let current = cfg.get("activeTaskBoardId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if current != target {
                if let Some(obj) = cfg.as_object_mut() {
                    obj.insert("activeTaskBoardId".into(), json!(target));
                }
                log::info!("[sync] 当前任务墙已切到本次写入的墙: {} -> {}", if current.is_empty() { "(空)" } else { &current }, target);
            }
        }
        config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
        // 写盘不会让已打开的界面自己刷新 → 广播一次（新便签 + 新 activeTaskBoardId 才会显示）
        broadcast_config_refresh();
    }
    // 新建了墙 → 重新上报墙名，手机端 board.list 才会拿到真实墙名列表
    if new_boards > 0 {
        log::info!("[sync] 新建了 {} 面墙，重新上报墙名列表", new_boards);
        publish_board_names_now();
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
            // 拿绑定信息时顺带上报一次墙名；用 _now 版本以便失败有明确日志（不再静默）
            publish_board_names_now();
            json!({ "success": true, "bindId": info["bindId"], "code": info["code"], "bindUrl": info["bindUrl"] })
        }
        Err(e) => json!({ "success": false, "message": e }),
    }
}

/// 自动拉取入口（**启动一次** 与 **中继实时唤醒** 共用）：
/// - 任务墙板块被禁用 → None（不打扰用户）
/// - 已有拉取在跑 → None（并发去重；队列是 peek 不删，任务不会被丢，下一次拉取照样取到）
/// - 否则返回 `Some(pull_taskwall() 的结果)`
///
/// 手动拉取（`syncPullNow`）走 `sync_pull_now` 不走这里，语义要保留"用户点了必须给答复"。
pub fn auto_pull_taskwall() -> Option<Value> {
    if !taskwall_enabled() {
        log::info!("[sync] 自动拉取跳过：任务墙板块已禁用");
        return None;
    }
    if PULL_BUSY.swap(true, Ordering::SeqCst) {
        log::info!("[sync] 自动拉取跳过：已有一次拉取在进行（队列任务不会丢）");
        return None;
    }
    let _guard = PullBusyGuard;
    Some(pull_taskwall())
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

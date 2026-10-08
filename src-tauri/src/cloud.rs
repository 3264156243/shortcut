//! M4 云控制 WS 客户端——对齐 electron/control-cloud.ts
//! 桌面 ⇄(wss relay)⇄ 手机；bindId+ticket 认证；心跳 25s；api 转发注入器；指数退避重连。
//!
//! **连接与控制模式解耦（2026-10-09 修）**：这条 WS 不再只属于"控制板块云端模式"。
//! 中继每个 bindId **只保留一个桌面连接**（`server/control-relay/relay.js` 里新的桌面连接会顶掉旧的），
//! 所以"任务墙实时唤醒（sync-wake）"与"云控制指令转发"必须共用同一条连接：
//! - 连接：本地已绑定（有 bindId）即维持，不依赖面板是否点过"云端连接"；
//! - 控制通道：`control_enabled` 开关（面板"云端连接"/"停止"）只决定**注入器是否运行、api 指令是否执行**。
//!
//! 修之前的症状：用户没开云控制 → 桌面根本没有这条 WS → 中继 `/notify` 判"桌面离线"
//! → 手机 push 只进队列，桌面要等启动拉取/手动"同步云端"才看得到。

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;

use crate::control::{self, ClipItem, Injector};

const RELAY_URL: &str = "wss://shortcut.326415.xyz/relay-ws";
const RECONNECT_BASE_MS: u64 = 3000;
const RECONNECT_MAX_MS: u64 = 30000;
const HEARTBEAT_MS: u64 = 25000;
const API_TIMEOUT_MS: u64 = 8000;

pub struct CloudState {
    pub ws_state: Mutex<String>, // idle | connecting | authed
    pub last_error: Mutex<String>,
    pub clip_history: Mutex<Vec<ClipItem>>,
    pub clip_busy: AtomicBool,
    /// 输入注入器：**惰性启动**——只有控制通道打开（面板"云端连接"）时才创建；
    /// 关掉控制通道即置回 None（注入器 stdin EOF → inject.ps1 自行退出），不常驻多余进程。
    pub injector: Mutex<Option<Injector>>,
    /// 控制通道开关（面板"云端连接" / "停止"）：只影响注入器与 api 指令执行，
    /// **不影响 WS 连接本身**（连接在已绑定时常驻，任务墙实时唤醒靠它）
    pub control_enabled: AtomicBool,
    /// inject.ps1 所在静态目录（惰性启动注入器时用）
    pub static_root: PathBuf,
}

impl CloudState {
    pub fn status_json(&self) -> Value {
        let ws_state = self.ws_state.lock().unwrap().clone();
        let control = self.control_enabled.load(Ordering::SeqCst);
        let linked = ws_state == "authed";
        json!({
            // active 仍是"控制板块云端模式是否在跑"（ControlPanel 据此在"云模式/局域网/未运行"之间切换）。
            // 连接现在常驻，不能再用 ws_state 单独判定，否则没开云控制时面板也会显示"云端连接 · 运行中"。
            "active": control && ws_state != "idle",
            "connected": linked,
            "connecting": ws_state == "connecting",
            "injector": control && self.injector_ready(),
            // 附加诊断字段（前端未使用）：实时唤醒链路状态，"桌面到底在线吗"一眼可查
            "link": ws_state,
            "controlEnabled": control,
            "syncLink": linked,
            "lastError": self.last_error.lock().unwrap().clone(),
        })
    }

    /// 注入器是否已 READY（未启动 = false）
    fn injector_ready(&self) -> bool {
        match self.injector.lock() {
            Ok(g) => g.as_ref().map(|i| i.is_ready()).unwrap_or(false),
            Err(_) => false,
        }
    }

    /// 控制通道是否可用（开关打开 + 注入器 READY）
    pub fn control_ready(&self) -> bool {
        self.control_enabled.load(Ordering::SeqCst) && self.injector_ready()
    }

    /// 往注入器送一条指令（未启动 = false）
    fn inject(&self, cmd: &str) -> bool {
        match self.injector.lock() {
            Ok(g) => g.as_ref().map(|i| i.inject(cmd)).unwrap_or(false),
            Err(_) => false,
        }
    }

    /// 打开控制通道（面板"云端连接"）：启动注入器 + 允许 api 指令执行。幂等。
    pub fn enable_control(&self) {
        let need_start = match self.injector.lock() {
            Ok(g) => g.is_none(),
            Err(_) => false,
        };
        if need_start {
            let inj = Injector::start(self.static_root.join("inject.ps1"));
            if let Ok(mut g) = self.injector.lock() {
                *g = Some(inj);
            }
        }
        self.control_enabled.store(true, Ordering::SeqCst);
        log_cloud("control channel enabled (injector starting)");
    }

    /// 关闭控制通道（面板"停止"）：注入器退出（stdin EOF → inject.ps1 退出），注入类指令一律 503。
    /// **不关 WS**：任务墙实时唤醒仍要走这条连接（中继每个 bindId 只保留一条桌面连接）。
    pub fn disable_control(&self) {
        self.control_enabled.store(false, Ordering::SeqCst);
        if let Ok(mut g) = self.injector.lock() {
            *g = None;
        }
        log_cloud("control channel disabled (sync-wake link kept)");
    }
}

pub struct CloudHandle {
    pub shutdown: watch::Sender<bool>,
    pub state: Arc<CloudState>,
    /// 建连时使用的 bindId：绑定身份变了（服务端判定旧绑定失效 → 本地重建绑定）要重建连接，
    /// 否则这条 WS 会一直挂在旧 bindId 上，中继按新 bindId 的 `/notify` 永远找不到桌面。
    pub bind_id: String,
}

/// 取云控制票据：身份注入与超时/错误文案统一走 hub（不再自己拼 bindId/deskToken 直接 POST）。
/// `bind_id` / `bind_code` 仅用于日志定位；桌面端以 deskToken 为准，bindCode 是服务端兼容期参数。
fn fetch_ticket(bind_id: &str, _bind_code: &str) -> Result<String, String> {
    let data = match crate::hub::api_post("control.ticket", json!({ "role": "desktop" })) {
        Ok(v) => v,
        Err(e) => return Err(format!("获取云端连接凭证失败: {}", e)),
    };
    match data.get("ticket").and_then(|t| t.as_str()) {
        Some(t) if !t.is_empty() => Ok(t.to_string()),
        _ => {
            let msg = data
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("获取云端连接凭证失败")
                .to_string();
            log_cloud(&format!("ticket 失败 bindId={} : {}", bind_id, msg));
            Err(msg)
        }
    }
}

/// 云模式 API 转发（对齐 control-cloud.ts handleApi；注入器进程内直调，不走 HTTP）
async fn handle_api(st: &Arc<CloudState>, path: &str, body: &Value) -> (bool, u16, Value) {
    let ready = st.control_ready();
    let wrap = |ok: bool, status: u16, data: Value| (ok, status, data);
    // 控制通道没打开（面板没点过"云端连接"）：只答 ping（回报能力状态），其余一律 503。
    // 连接常驻后手机端可能"看到桌面在线"，这里必须显式拒绝注入/剪贴板类指令——
    // 与修之前"桌面离线 → 中继直接回 503 desktop offline"的可达性保持一致。
    if path != "/api/ping" && !st.control_enabled.load(Ordering::SeqCst) {
        log_cloud(&format!("api <- {} 拒绝：控制通道未启用", path));
        return wrap(false, 503, json!({ "error": "control channel disabled" }));
    }
    let s = body.as_object().cloned().unwrap_or_default();
    match path {
        "/api/ping" => wrap(true, 200, json!({ "ok": true, "injector": ready })),
        "/api/type" => {
            let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if text.is_empty() || text.len() > 2000 {
                return wrap(false, 400, json!({ "error": "empty or too long" }));
            }
            if !ready {
                return wrap(false, 503, json!({ "ok": false }));
            }
            let ok = st.inject(&format!("TYPE {}", control::base64_encode(text.as_bytes())));
            wrap(ok, if ok { 200 } else { 503 }, json!({ "ok": ok }))
        }
        "/api/key" => {
            if !ready {
                return wrap(false, 503, json!({ "ok": false }));
            }
            let vk = control::resolve_vk(s.get("key").unwrap_or(&Value::Null));
            let ok = match vk {
                Some(v) => st.inject(&format!("KEY {}", v)),
                None => false,
            };
            wrap(ok, if ok { 200 } else { 400 }, json!({ "ok": ok }))
        }
        "/api/combo" => {
            if !ready {
                return wrap(false, 503, json!({ "ok": false }));
            }
            let keys = s.get("keys").cloned().unwrap_or_else(|| s.get("key").cloned().unwrap_or(Value::Null));
            let items: Vec<Value> = match &keys {
                Value::Array(a) => a.clone(),
                Value::String(str_) => str_
                    .split(['+', '-'])
                    .map(|p| json!(p.to_string()))
                    .collect(),
                _ => vec![],
            };
            let mut vks: Vec<u32> = Vec::new();
            for item in &items {
                match control::resolve_vk(item) {
                    Some(v) if !vks.contains(&v) => vks.push(v),
                    Some(_) => {}
                    None => return wrap(false, 400, json!({ "ok": false })),
                }
            }
            if vks.is_empty() {
                return wrap(false, 400, json!({ "ok": false }));
            }
            let joined = vks.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",");
            let ok = st.inject(&format!("COMBO {}", joined));
            wrap(ok, if ok { 200 } else { 400 }, json!({ "ok": ok }))
        }
        "/api/mouse" => {
            if !ready {
                return wrap(false, 503, json!({ "ok": false }));
            }
            let (dx, dy) = (
                s.get("dx").and_then(|v| v.as_f64()).unwrap_or(0.0).round() as i64,
                s.get("dy").and_then(|v| v.as_f64()).unwrap_or(0.0).round() as i64,
            );
            let ok = if dx == 0 && dy == 0 {
                true
            } else {
                st.inject(&format!("MOUSE {} {}", dx, dy))
            };
            wrap(ok, if ok { 200 } else { 400 }, json!({ "ok": ok }))
        }
        "/api/click" => {
            if !ready {
                return wrap(false, 503, json!({ "ok": false }));
            }
            let b = s.get("button").and_then(|v| v.as_str()).unwrap_or("left").to_lowercase();
            let ok = if ["left", "right", "middle"].contains(&b.as_str()) {
                st.inject(&format!("CLICK {}", b))
            } else {
                false
            };
            wrap(ok, if ok { 200 } else { 400 }, json!({ "ok": ok }))
        }
        "/api/wheel" => {
            if !ready {
                return wrap(false, 503, json!({ "ok": false }));
            }
            let d = s.get("delta").and_then(|v| v.as_f64()).unwrap_or(0.0).round() as i64;
            let ok = if d == 0 { true } else { st.inject(&format!("WHEEL {}", d)) };
            wrap(ok, if ok { 200 } else { 400 }, json!({ "ok": ok }))
        }
        "/api/clipboard/refresh" => {
            if st.clip_busy.swap(true, Ordering::SeqCst) {
                return wrap(false, 503, json!({ "error": "busy" }));
            }
            let current = control::read_pc_clipboard().await;
            st.clip_busy.store(false, Ordering::SeqCst);
            let current = match current {
                Some(t) => {
                    let mut h = st.clip_history.lock().unwrap();
                    if !h.last().map(|x| x.text == t).unwrap_or(false) {
                        h.push(ClipItem { id: format!("c{}", control::now_ms()), text: t.clone(), at: control::now_ms() });
                        let over = h.len().saturating_sub(40);
                        h.drain(0..over);
                    }
                    Value::from(t)
                }
                None => Value::Null,
            };
            let history: Vec<Value> = st
                .clip_history
                .lock()
                .unwrap()
                .iter()
                .map(|x| {
                    json!({
                        "id": x.id, "text": x.text,
                        "preview": if x.text.chars().count() > 160 { format!("{}…", x.text.chars().take(160).collect::<String>()) } else { x.text.clone() },
                        "length": x.text.chars().count(), "at": x.at,
                    })
                })
                .collect();
            wrap(true, 200, json!({ "current": current, "history": history }))
        }
        "/api/clipboard/paste" => {
            let text = s.get("text").and_then(|v| v.as_str()).map(|x| x.to_string()).unwrap_or_default();
            if text.is_empty() || text.len() > 20000 || !ready {
                return wrap(false, if !ready { 503 } else { 400 }, json!({ "ok": false }));
            }
            // 500 字符分块逐段 TYPE（与 server.js pasteClipboardText 一致）
            let mut ok = true;
            for chunk in text.chars().collect::<Vec<_>>().chunks(500) {
                let piece: String = chunk.iter().collect();
                if !st.inject(&format!("TYPE {}", control::base64_encode(piece.as_bytes()))) {
                    ok = false;
                    break;
                }
            }
            wrap(ok, if ok { 200 } else { 503 }, json!({ "ok": ok }))
        }
        "/api/clipboard/clear" => {
            st.clip_history.lock().unwrap().clear();
            wrap(true, 200, json!({ "ok": true }))
        }
        _ => wrap(false, 400, json!({ "error": "unknown path" })),
    }
}

fn log_cloud(msg: &str) {
    let dir = crate::config::user_data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let line = format!("{} {}\n", chrono::Local::now().to_rfc3339(), msg);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("control-cloud.log"))
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

async fn connect_once(st: &Arc<CloudState>, bind_id: &str, bind_code: &str) -> Result<(), String> {
    st.ws_state.lock().unwrap().replace_range(.., "connecting");
    // ticket（ureq 同步 → blocking 线程）
    let (bid, bcode) = (bind_id.to_string(), bind_code.to_string());
    let ticket = tokio::task::spawn_blocking(move || fetch_ticket(&bid, &bcode))
        .await
        .map_err(|e| e.to_string())??;

    let (ws, _) = tokio_tungstenite::connect_async(RELAY_URL)
        .await
        .map_err(|e| format!("relay 连接失败: {}", e))?;
    let (mut sink, mut stream) = ws.split();
    let auth = json!({ "auth": { "role": "desktop", "bindId": bind_id, "ticket": ticket } });
    sink.send(Message::Text(auth.to_string()))
        .await
        .map_err(|e| format!("auth 发送失败: {}", e))?;

    let mut heartbeat = tokio::time::interval(Duration::from_millis(HEARTBEAT_MS));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut authed = false;

    loop {
        tokio::select! {
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let msg: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(_) => continue };
                        match msg.get("t").and_then(|t| t.as_str()).unwrap_or("") {
                            "auth-ok" => {
                                authed = true;
                                st.ws_state.lock().unwrap().replace_range(.., "authed");
                                *st.last_error.lock().unwrap() = String::new();
                                log_cloud("auth-ok (relay connected)");
                            }
                            "auth-fail" => {
                                let err = msg.get("error").and_then(|e| e.as_str()).unwrap_or("鉴权失败").to_string();
                                log_cloud(&format!("auth-fail: {}", err));
                                *st.last_error.lock().unwrap() = err;
                                return Ok(()); // 断开重取 ticket 重试
                            }
                            "api" if authed => {
                                let id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let api_path = msg.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let body = msg.get("body").cloned().unwrap_or(json!({}));
                                let is_high_freq = api_path == "/api/mouse" || api_path == "/api/wheel" || api_path == "/api/click";
                                log_cloud(&format!("api <- {} id={} control={} injector={}", api_path, id, if st.control_enabled.load(Ordering::SeqCst) { "on" } else { "OFF" }, if st.injector_ready() { "ready" } else { "NOT-READY" }));
                                let result = tokio::time::timeout(
                                    Duration::from_millis(API_TIMEOUT_MS),
                                    handle_api(st, &api_path, &body),
                                )
                                .await
                                .unwrap_or((false, 504, json!({ "error": "timeout" })));
                                let (ok, status, data) = result;
                                if !ok || !is_high_freq {
                                    log_cloud(&format!("api -> res id={} path={} ok={} status={}", id, api_path, ok, status));
                                }
                                let reply = json!({ "t": "api-res", "id": id, "ok": ok, "status": status, "data": data });
                                if sink.send(Message::Text(reply.to_string())).await.is_err() {
                                    log_cloud("reply send FAIL");
                                    return Ok(());
                                }
                            }
                            // 任务墙实时唤醒：手机 push 入队后，api.php 问中继"桌面在线吗"，
                            // 在线则由中继转来这条 → 桌面立刻拉取（第三个拉取时机之外的"实时"路径）。
                            "sync-wake" if authed => {
                                let board = msg.get("board").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let count = msg.get("count").and_then(|v| v.as_i64()).unwrap_or(0);
                                log_cloud(&format!("sync-wake <- board={} count={}", board, count));
                                if !board.is_empty() && board != "taskwall" {
                                    log_cloud(&format!("sync-wake 忽略：暂不支持的板块 {}", board));
                                } else {
                                    // 拉取是同步 HTTP（ureq）+ 写 config：必须离开 WS 循环。
                                    // spawn_blocking **不 await**——await 会把这条循环卡住十几秒，
                                    // 期间心跳与 api 转发全部停摆。并发去重在 sync::auto_pull_taskwall 内部。
                                    // JoinHandle 丢弃 = 任务继续跑（不 detach 也没关系，返回的句柄只是句柄）
                                    let _ = tokio::task::spawn_blocking(|| match crate::sync::auto_pull_taskwall() {
                                        Some(r) => match r.get("error").and_then(|v| v.as_str()) {
                                            Some(e) => log::warn!("[sync] 收到实时唤醒，拉取失败: {}", e),
                                            None => log::info!(
                                                "[sync] 收到实时唤醒，已拉取 {} 条",
                                                r.get("count").and_then(|v| v.as_i64()).unwrap_or(0)
                                            ),
                                        },
                                        None => log::info!("[sync] 收到实时唤醒，本次已跳过（拉取进行中或任务墙已禁用）"),
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(format!("relay 断开: {}", e)),
                    None => return Err("relay closed".to_string()),
                }
            }
            _ = heartbeat.tick(), if authed => {
                let _ = sink.send(Message::Text(json!({ "t": "ping" }).to_string())).await;
            }
        }
    }
}

async fn connect_loop(mut shutdown_rx: watch::Receiver<bool>, st: Arc<CloudState>, bind_id: String, bind_code: String) {
    let mut attempts: u32 = 0;
    loop {
        match connect_once(&st, &bind_id, &bind_code).await {
            Ok(()) => {
                // auth-fail 或正常断开：立即重试（重取 ticket）
                attempts = 0;
            }
            Err(e) => {
                *st.last_error.lock().unwrap() = e;
                attempts += 1;
            }
        }
        if st.ws_state.lock().unwrap().clone() != "idle" {
            *st.ws_state.lock().unwrap() = "idle".into();
        }
        let wait = RECONNECT_BASE_MS
            .saturating_mul(1.6_f64.powi(attempts.min(8) as i32).round() as u64)
            .min(RECONNECT_MAX_MS);
        log_cloud(&format!("socket close (attempt={}) retry in {}ms", attempts, wait));
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(wait)) => {}
            _ = shutdown_rx.changed() => {
                log_cloud("cloud control stopping");
                return;
            }
        }
    }
}

/// 建立桌面 ⇄ 中继的 WS 长连接（读取 config.sync 绑定身份；返回错误 = 未绑定等启动失败）。
///
/// **注意**：这里只建连接，**不启动注入器**——注入器由 [`CloudState::enable_control`] 在
/// 用户点"云端连接"时惰性启动。连接常驻是为了让中继 `/notify` 找得到桌面（任务墙实时唤醒），
/// 与控制板块的模式无关；云控制的指令通道复用同一条连接（中继每个 bindId 只保留一条桌面连接）。
pub fn start_cloud(static_root: PathBuf) -> Result<CloudHandle, String> {
    // 绑定身份：config.sync { bindId, bindCode }
    let raw = crate::config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let sync = cfg.get("sync").cloned().unwrap_or(json!({}));
    let bind_id = sync.get("bindId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let bind_code = sync.get("bindCode").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if bind_id.is_empty() {
        return Err("尚未建立联动绑定，请先在「联动绑定」板块完成绑定".to_string());
    }

    let st = Arc::new(CloudState {
        ws_state: Mutex::new("idle".to_string()),
        last_error: Mutex::new(String::new()),
        clip_history: Mutex::new(Vec::new()),
        clip_busy: AtomicBool::new(false),
        injector: Mutex::new(None),
        control_enabled: AtomicBool::new(false),
        static_root,
    });

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let st2 = st.clone();
    let handle_bind = bind_id.clone();
    // 可能从同步命令路径调用（主线程无 reactor）——tauri::async_runtime::spawn 内部自带运行时
    tauri::async_runtime::spawn(async move {
        connect_loop(shutdown_rx, st2, bind_id, bind_code).await;
    });
    Ok(CloudHandle { shutdown: shutdown_tx, state: st, bind_id: handle_bind })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cloud() -> Arc<CloudState> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("sj");
        Arc::new(CloudState {
            ws_state: Mutex::new("authed".to_string()),
            last_error: Mutex::new(String::new()),
            clip_history: Mutex::new(Vec::new()),
            clip_busy: AtomicBool::new(false),
            // 控制通道打开的常态（真实启动路径由 enable_control 惰性起注入器，这里直接构造等价状态）
            injector: Mutex::new(Some(Injector::start(root.join("inject.ps1")))),
            control_enabled: AtomicBool::new(true),
            static_root: root,
        })
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn handle_api_semantics() {
        let st = test_cloud();
        // ping
        let (ok, code, data) = handle_api(&st, "/api/ping", &json!({})).await;
        assert!(ok && code == 200 && data["ok"] == true);
        // type 空文本 → 400
        let (ok, code, _) = handle_api(&st, "/api/type", &json!({ "text": "" })).await;
        assert!(!ok && code == 400);
        // type 超长 → 400
        let long = "x".repeat(2001);
        let (ok, code, _) = handle_api(&st, "/api/type", &json!({ "text": long })).await;
        assert!(!ok && code == 400);
        // type 正常（注入器可能未 READY → 503；但不该 400/panic）
        let (_, code, data) = handle_api(&st, "/api/type", &json!({ "text": "云控测试" })).await;
        assert!((code == 200 || code == 503) && data["ok"].is_boolean());
        // key 无效键名 → 400
        let (ok, code, _) = handle_api(&st, "/api/key", &json!({ "key": "nosuchkey" })).await;
        assert!(!ok && code == 400);
        // combo ctrl+c 有效 VK → 200/503
        let (_, code, _) = handle_api(&st, "/api/combo", &json!({ "keys": ["ctrl", "c"] })).await;
        assert!(code == 200 || code == 503);
        // unknown path → 400
        let (ok, code, _) = handle_api(&st, "/api/unknown", &json!({})).await;
        assert!(!ok && code == 400);
        // clipboard/clear → 200
        let (ok, code, _) = handle_api(&st, "/api/clipboard/clear", &json!({})).await;
        assert!(ok && code == 200);
    }

    /// 控制通道没打开（面板没点"云端连接"）时：仍答 ping，但注入/剪贴板类指令一律 503。
    /// 连接现在常驻（任务墙实时唤醒），所以这条门禁是"云控制必须用户显式开启"的唯一保证。
    #[tokio::test(flavor = "multi_thread")]
    async fn control_channel_off_blocks_injection() {
        let st = test_cloud();
        st.disable_control();
        assert!(!st.control_enabled.load(Ordering::SeqCst));
        assert!(st.injector.lock().unwrap().is_none(), "关闭控制通道应让注入器退出");
        let (ok, code, data) = handle_api(&st, "/api/ping", &json!({})).await;
        assert!(ok && code == 200 && data["injector"] == false);
        for path in ["/api/type", "/api/key", "/api/combo", "/api/mouse", "/api/click", "/api/wheel", "/api/clipboard/paste", "/api/clipboard/refresh"] {
            let (ok, code, _) = handle_api(&st, path, &json!({ "text": "x" })).await;
            assert!(!ok && code == 503, "{} 在控制通道关闭时必须 503", path);
        }
        // 重新打开：注入器重新创建（READY 与否都算可用路径，不该 503 control-disabled）
        st.enable_control();
        assert!(st.control_enabled.load(Ordering::SeqCst));
        assert!(st.injector.lock().unwrap().is_some());
    }
}

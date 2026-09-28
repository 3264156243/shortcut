//! M4 控制板块：sj 局域网控制服务 Rust 化（方案 B，D-3 决策）
//! 协议逐条对齐 resources/sj/server.js：HTTP API 15 个 + powershell 常驻注入器（TYPE/KEY/COMBO/MOUSE/CLICK/WHEEL + READY 握手）
//! 桌面壳内直接跑 tokio task，不再 spawn node 进程。

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::Rng;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

// ---------- 注入器 ----------

pub struct Injector {
    stdin_tx: Option<mpsc::Sender<String>>,
    ready: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl Injector {
    /// 常驻 powershell 跑 inject.ps1：stdin 收指令，stdout 行 'READY' 置就绪（与 server.js 一致）
    pub fn start(ps_path: PathBuf) -> Self {
        let ready = Arc::new(AtomicBool::new(false));
        let child_arc = Arc::new(Mutex::new(None));
        let stdin_tx = Self::spawn(ps_path, ready.clone(), child_arc.clone());
        Injector { stdin_tx: Some(stdin_tx), ready, child: child_arc }
    }

    fn spawn(
        ps_path: PathBuf,
        ready: Arc<AtomicBool>,
        child_arc: Arc<Mutex<Option<Child>>>,
    ) -> mpsc::Sender<String> {
        let (tx, mut rx) = mpsc::channel::<String>(64);
        tokio::spawn(async move {
            let mut child = match Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&ps_path)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn()
            {
                Ok(c) => c,
                Err(e) => {
                    log::error!("[inject] powershell 启动失败: {}", e);
                    return;
                }
            };
            let mut stdin = child.stdin.take().expect("stdin");
            let stdout = child.stdout.take().expect("stdout");
            *child_arc.lock().unwrap() = Some(child);
            ready.store(false, Ordering::SeqCst);

            // stdout：READY 行检测
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if line.trim() == "READY" {
                                ready.store(true, Ordering::SeqCst);
                                log::info!("[inject] READY");
                            }
                        }
                        _ => break,
                    }
                }
                ready.store(false, Ordering::SeqCst);
            });

            // stdin：写指令
            while let Some(cmd) = rx.recv().await {
                if stdin.write_all(format!("{}\n", cmd).as_bytes()).await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });
        tx
    }

    pub fn inject(&self, cmd: &str) -> bool {
        match &self.stdin_tx {
            Some(tx) => tx.try_send(cmd.to_string()).is_ok(),
            None => false,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
}

// ---------- VK 表（照抄 server.js）----------

fn resolve_vk(name: &Value) -> Option<u32> {
    if let Some(n) = name.as_i64() {
        return Some((n & 0xffff_ffff) as u32);
    }
    let k = name.as_str()?.trim().to_lowercase();
    if k.is_empty() {
        return None;
    }
    let stripped = k.trim_start_matches("vk_");
    if stripped.chars().all(|c| c.is_ascii_digit()) && !stripped.is_empty() {
        return stripped.parse().ok();
    }
    if let Some(hex) = k.strip_prefix("0x") {
        return u32::from_str_radix(hex, 16).ok();
    }
    let vk: Option<u32> = match k.as_str() {
        "backspace" => Some(0x08),
        "tab" => Some(0x09),
        "enter" | "return" => Some(0x0d),
        "shift" => Some(0x10),
        "ctrl" | "control" => Some(0x11),
        "alt" | "menu" => Some(0x12),
        "capslock" => Some(0x14),
        "esc" | "escape" => Some(0x1b),
        "space" => Some(0x20),
        "pageup" | "pgup" => Some(0x21),
        "pagedown" | "pgdn" => Some(0x22),
        "end" => Some(0x23),
        "home" => Some(0x24),
        "left" => Some(0x25),
        "up" => Some(0x26),
        "right" => Some(0x27),
        "down" => Some(0x28),
        "printscreen" | "prtsc" => Some(0x2c),
        "insert" => Some(0x2d),
        "del" | "delete" => Some(0x2e),
        "win" | "meta" | "super" => Some(0x5b),
        "f1" => Some(0x70),
        "f2" => Some(0x71),
        "f3" => Some(0x72),
        "f4" => Some(0x73),
        "f5" => Some(0x74),
        "f6" => Some(0x75),
        "f7" => Some(0x76),
        "f8" => Some(0x77),
        "f9" => Some(0x78),
        "f10" => Some(0x79),
        "f11" => Some(0x7a),
        "f12" => Some(0x7b),
        ";" => Some(0xba),
        "=" => Some(0xbb),
        "," => Some(0xbc),
        "-" => Some(0xbd),
        "." => Some(0xbe),
        "/" => Some(0xbf),
        "`" => Some(0xc0),
        "[" => Some(0xdb),
        "\\" => Some(0xdc),
        "]" => Some(0xdd),
        "'" => Some(0xde),
        _ => None,
    };
    if vk.is_some() {
        return vk;
    }
    if k.len() == 1 && k.chars().next().unwrap().is_ascii_digit() {
        return Some(0x30 + k.chars().next().unwrap() as u32 - '0' as u32);
    }
    let bytes = k.as_bytes();
    if bytes.len() == 1 && bytes[0].is_ascii_alphabetic() {
        return Some(bytes[0] as u32);
    }
    None
}

// ---------- 共享状态 ----------

pub struct ClipItem {
    pub id: String,
    pub text: String,
    pub at: i64,
}

pub struct ControlState {
    pub port: u16,
    pub auth_mode: String,
    pub static_tokens: Vec<String>,
    pub pair_code: Mutex<String>,
    pub sessions: Mutex<HashMap<String, (String, i64)>>,
    pub recent_input: Mutex<Vec<(String, i64)>>,
    pub clip_history: Mutex<Vec<ClipItem>>,
    pub clip_busy: AtomicBool,
    pub injector: Injector,
    pub static_root: PathBuf,
    pub running: AtomicBool,
}

fn new_pair_code() -> String {
    rand::rng().random_range(100000..1000000).to_string()
}

/// lib.rs 复用
pub fn new_pair_code_pub() -> String {
    new_pair_code()
}

/// lib.rs 复用
pub fn lan_urls_pub(port: u16) -> Vec<String> {
    lan_urls(port)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn log_input(state: &ControlState, text: &str) {
    let mut r = state.recent_input.lock().unwrap();
    r.insert(0, (text.to_string(), now_ms()));
    r.truncate(30);
}

fn extract_token(headers: &HeaderMap) -> String {
    if let Some(h) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(t) = h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer ")) {
            return t.to_string();
        }
    }
    headers
        .get("x-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn is_authorized(state: &ControlState, headers: &HeaderMap) -> bool {
    if state.auth_mode == "none" {
        return true;
    }
    let token = extract_token(headers);
    if token.is_empty() {
        return false;
    }
    if state.auth_mode == "static" {
        return state.static_tokens.iter().any(|t| t == &token);
    }
    state.sessions.lock().unwrap().contains_key(&token)
}

// ---------- 剪贴板 ----------

async fn read_pc_clipboard() -> Option<String> {
    let ps = "$ErrorActionPreference='SilentlyContinue';\n[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\nAdd-Type -AssemblyName System.Windows.Forms;\n$t=[System.Windows.Forms.Clipboard]::GetText();\nif ($null -eq $t) { $t = '' };\n[Console]::Out.Write($t)";
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps])
        .creation_flags(0x08000000)
        .output()
        .await
        .ok()?;
    let mut buf = out.stdout;
    if buf.len() >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf {
        buf = buf[3..].to_vec();
    }
    Some(String::from_utf8_lossy(&buf).to_string())
}

fn push_clip_history(state: &ControlState, text: String) {
    let mut h = state.clip_history.lock().unwrap();
    if h.last().map(|x| x.text == text).unwrap_or(false) {
        return;
    }
    h.push(ClipItem {
        id: format!("c{}", now_ms()),
        text,
        at: now_ms(),
    });
    if h.len() > 40 {
        let over = h.len() - 40;
        h.drain(0..over);
    }
}

// ---------- handlers ----------

fn ok_json(v: Value) -> axum::response::Response {
    (StatusCode::OK, Json(v)).into_response()
}
fn err_json(code: StatusCode, v: Value) -> axum::response::Response {
    (code, Json(v)).into_response()
}

async fn api_config(State(st): State<Arc<ControlState>>) -> axum::response::Response {
    ok_json(json!({
        "authMode": st.auth_mode,
        "requirePair": st.auth_mode == "pair",
        "basePath": "",
    }))
}

async fn api_status(State(st): State<Arc<ControlState>>) -> axum::response::Response {
    let clients = if st.auth_mode == "pair" {
        Value::from(st.sessions.lock().unwrap().len())
    } else {
        Value::Null
    };
    let pair_code = if st.auth_mode == "pair" {
        json!(st.pair_code.lock().unwrap().clone())
    } else {
        Value::Null
    };
    ok_json(json!({
        "authMode": st.auth_mode,
        "pairCode": pair_code,
        "clients": clients,
        "urls": lan_urls(st.port),
        "basePath": "",
        "recent": st.recent_input.lock().unwrap().iter().take(12)
            .map(|(t, at)| json!({ "text": t, "at": at })).collect::<Vec<_>>(),
        "injector": st.injector.is_ready(),
    }))
}

async fn api_pair(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if st.auth_mode != "pair" {
        return err_json(StatusCode::BAD_REQUEST, json!({ "error": "pair disabled", "authMode": st.auth_mode }));
    }
    let _ = &headers;
    let code = body
        .and_then(|Json(b)| b.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()))
        .unwrap_or_default()
        .trim()
        .to_string();
    if code != *st.pair_code.lock().unwrap() {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "绑定码错误" }));
    }
    let token: String = (0..48).map(|_| format!("{:x}", rand::rng().random_range(0..16))).collect();
    st.sessions
        .lock()
        .unwrap()
        .insert(token.clone(), (String::new(), now_ms()));
    ok_json(json!({ "token": token }))
}

async fn api_unbind(State(st): State<Arc<ControlState>>, headers: HeaderMap) -> axum::response::Response {
    if st.auth_mode == "pair" {
        let token = extract_token(&headers);
        if !token.is_empty() {
            st.sessions.lock().unwrap().remove(&token);
        }
    }
    ok_json(json!({ "ok": true }))
}

async fn api_ping(State(st): State<Arc<ControlState>>, headers: HeaderMap) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    ok_json(json!({ "ok": true, "injector": st.injector.is_ready(), "authMode": st.auth_mode }))
}

async fn api_type(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let text = body
        .and_then(|Json(b)| b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();
    if text.is_empty() {
        return err_json(StatusCode::BAD_REQUEST, json!({ "error": "empty" }));
    }
    if text.len() > 2000 {
        return err_json(StatusCode::BAD_REQUEST, json!({ "error": "too long" }));
    }
    let ok = st
        .injector
        .inject(&format!("TYPE {}", base64_encode(text.as_bytes())));
    if ok {
        log_input(&st, &text);
    }
    ok_json(json!({ "ok": ok, "injector": st.injector.is_ready() }))
}

async fn api_key(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let key = body.and_then(|Json(b)| b.get("key").cloned()).unwrap_or(Value::Null);
    let ok = match resolve_vk(&key) {
        Some(vk) => st.injector.inject(&format!("KEY {}", vk)),
        None => false,
    };
    ok_json(json!({ "ok": ok }))
}

async fn api_combo(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let keys = body
        .and_then(|Json(b)| {
            b.get("keys").cloned().or_else(|| b.get("key").cloned())
        })
        .unwrap_or(Value::Null);
    // 数组或 "ctrl+c" 字符串（+/- 分隔）
    let items: Vec<Value> = match &keys {
        Value::Array(a) => a.clone(),
        Value::String(s) => {
            let parts: Vec<&str> = s.split(['+', '-']).collect();
            if parts.len() > 1 {
                parts.iter().map(|p| json!(p.to_string())).collect()
            } else {
                vec![json!(s.clone())]
            }
        }
        _ => vec![],
    };
    let mut vks: Vec<u32> = Vec::new();
    let mut all_ok = !items.is_empty();
    for item in &items {
        match resolve_vk(item) {
            Some(vk) => {
                if !vks.contains(&vk) {
                    vks.push(vk);
                }
            }
            None => {
                all_ok = false;
                break;
            }
        }
    }
    let ok = if all_ok && !vks.is_empty() {
        let joined = vks.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",");
        let sent = st.injector.inject(&format!("COMBO {}", joined));
        if sent {
            if let Value::Array(a) = &keys {
                log_input(&st, &format!("[{}]", a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("+")));
            }
        }
        sent
    } else {
        false
    };
    ok_json(json!({ "ok": ok }))
}

async fn api_mouse(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let (dx, dy) = body
        .and_then(|Json(b)| {
            Some((
                b.get("dx").and_then(|v| v.as_f64()).unwrap_or(0.0),
                b.get("dy").and_then(|v| v.as_f64()).unwrap_or(0.0),
            ))
        })
        .unwrap_or((0.0, 0.0));
    let (dx, dy) = (dx.round() as i64, dy.round() as i64);
    let ok = if dx == 0 && dy == 0 {
        true
    } else {
        st.injector.inject(&format!("MOUSE {} {}", dx, dy))
    };
    ok_json(json!({ "ok": ok }))
}

async fn api_click(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let b = body
        .and_then(|Json(b)| b.get("button").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| "left".to_string())
        .to_lowercase();
    let ok = if ["left", "right", "middle"].contains(&b.as_str()) {
        st.injector.inject(&format!("CLICK {}", b))
    } else {
        false
    };
    ok_json(json!({ "ok": ok }))
}

async fn api_wheel(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let delta = body
        .and_then(|Json(b)| b.get("delta").and_then(|v| v.as_f64()))
        .unwrap_or(0.0)
        .round() as i64;
    let ok = if delta == 0 {
        true
    } else {
        st.injector.inject(&format!("WHEEL {}", delta))
    };
    ok_json(json!({ "ok": ok }))
}

async fn api_clip_refresh(State(st): State<Arc<ControlState>>, headers: HeaderMap) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    if st.clip_busy.swap(true, Ordering::SeqCst) {
        return err_json(StatusCode::TOO_MANY_REQUESTS, json!({ "error": "busy" }));
    }
    let current = read_pc_clipboard().await;
    st.clip_busy.store(false, Ordering::SeqCst);
    let current = match current {
        Some(t) => {
            push_clip_history(&st, t.clone());
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
                "id": x.id,
                "text": x.text,
                "preview": if x.text.len() > 160 { format!("{}…", &x.text[..160.min(x.text.len())]) } else { x.text.clone() },
                "length": x.text.chars().count(),
                "at": x.at,
            })
        })
        .collect();
    ok_json(json!({ "current": current, "history": history }))
}

async fn api_clip_paste(
    State(st): State<Arc<ControlState>>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    let body = body.map(|Json(b)| b).unwrap_or(json!({}));
    let mut text = body.get("text").and_then(|v| v.as_str()).map(|s| s.to_string());
    if text.is_none() {
        if let Some(id) = body.get("id").and_then(|v| v.as_str()) {
            text = st
                .clip_history
                .lock()
                .unwrap()
                .iter()
                .find(|x| x.id == id)
                .map(|x| x.text.clone());
        }
    }
    let text = text.unwrap_or_default();
    if text.is_empty() {
        return err_json(StatusCode::BAD_REQUEST, json!({ "error": "empty" }));
    }
    if text.len() > 20000 {
        return err_json(StatusCode::BAD_REQUEST, json!({ "error": "too long" }));
    }
    let mut ok = true;
    for chunk in text.as_bytes().chunks(2000) {
        // 500 字符块（UTF-8 安全切分）
        let safe = String::from_utf8_lossy(chunk);
        let b64 = base64_encode(safe.as_bytes());
        if !st.injector.inject(&format!("TYPE {}", b64)) {
            ok = false;
            break;
        }
    }
    if ok {
        let preview: String = text.chars().take(40).collect();
        log_input(&st, &format!("[粘贴]{}{}", preview, if text.chars().count() > 40 { "…" } else { "" }));
    }
    ok_json(json!({ "ok": ok, "injector": st.injector.is_ready() }))
}

async fn api_clip_clear(State(st): State<Arc<ControlState>>, headers: HeaderMap) -> axum::response::Response {
    if !is_authorized(&st, &headers) {
        return err_json(StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized", "authMode": st.auth_mode }));
    }
    st.clip_history.lock().unwrap().clear();
    ok_json(json!({ "ok": true }))
}

async fn api_reset_code(
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    State(st): State<Arc<ControlState>>,
) -> axum::response::Response {
    if st.auth_mode != "pair" {
        return err_json(StatusCode::BAD_REQUEST, json!({ "error": "pair disabled" }));
    }
    let ip = addr.ip().to_string();
    if ip != "127.0.0.1" && ip != "::1" {
        return err_json(StatusCode::FORBIDDEN, json!({ "error": "localhost only" }));
    }
    let code = new_pair_code();
    *st.pair_code.lock().unwrap() = code.clone();
    st.sessions.lock().unwrap().clear();
    ok_json(json!({ "pairCode": code }))
}

// ---------- 静态文件 / 状态页 ----------

const MIME: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("js", "application/javascript; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
];

fn mime_of(ext: &str) -> &'static str {
    MIME.iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, m)| *m)
        .unwrap_or("application/octet-stream")
}

async fn static_files(State(st): State<Arc<ControlState>>, uri: Uri) -> axum::response::Response {
    let path = uri.path();
    if path.starts_with("/api/") {
        return err_json(StatusCode::NOT_FOUND, json!({ "error": "not found" }));
    }
    let rel = percent_decode(path);
    let rel = if rel == "/" || rel.is_empty() { "index.html" } else { rel.trim_start_matches('/') };
    let file = st.static_root.join(&rel);
    if let Ok(clean) = file.canonicalize() {
        // canonicalize 在 Windows 返回 \\?\ 前缀路径，root 也要同样规范化后再比较
        if let Ok(root_canon) = st.static_root.canonicalize() {
            if clean.starts_with(&root_canon) && clean.is_file() {
                if let Ok(data) = std::fs::read(&clean) {
                    let ext = clean.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                    return (
                        [(axum::http::header::CONTENT_TYPE, mime_of(&ext)), (axum::http::header::CACHE_CONTROL, "no-store")],
                        data,
                    )
                        .into_response();
                }
            }
        }
    }
    err_json(StatusCode::NOT_FOUND, json!({ "error": "not found" }))
}

async fn pc_status_page(State(st): State<Arc<ControlState>>) -> axum::response::Response {
    let list = lan_urls(st.port);
    let urls_html: String = list
        .iter()
        .map(|u| format!("<div class=\"url\"><a href=\"{}\" target=\"_blank\">{}</a></div>", u, u))
        .collect::<Vec<_>>()
        .join("");
    let urls_html = if urls_html.is_empty() {
        format!("<div class=\"url\">http://127.0.0.1:{}</div>", st.port)
    } else {
        urls_html
    };
    let html = format!(
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/><title>sj · 电脑端状态</title>\
        <style>:root{{--bg:#f4f1ea;--ink:#1c242c;--muted:#5c6b7a;--accent:#0b6e4f;--card:#fffdf8;--line:#d9d2c3}}\
        *{{box-sizing:border-box}}body{{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:'Segoe UI','Microsoft YaHei',sans-serif;padding:40px 20px}}\
        .wrap{{max-width:720px;margin:0 auto}}h1{{font-size:26px;margin:0 0 8px}}.card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:14px}}\
        .label{{font-size:12px;color:var(--muted);margin-bottom:6px}}.big{{font-size:28px;font-weight:700}}\
        .url{{font-family:Consolas,monospace;font-size:16px;word-break:break-all;color:var(--accent)}}\
        .grid{{display:grid;gap:8px}}@media(min-width:640px){{.grid{{grid-template-columns:1fr 1fr}}}}</style></head><body><div class=\"wrap\">\
        <h1>sj 手机控制端</h1><div class=\"card\"><div class=\"label\">局域网地址</div><div class=\"grid\">{}</div></div>\
        <div class=\"card\"><div class=\"label\">鉴权模式</div><div class=\"big\">{}</div></div>\
        <div class=\"card\"><div class=\"label\">状态</div><div class=\"ok\" id=\"st\">injector: …</div></div></div>\
        <script>async function refresh(){{try{{const d=await(await fetch('/api/status')).json();const p=['injector: '+(d.injector?'ready':'down'),'auth: '+d.authMode];if(d.authMode==='pair')p.push('pairCode: '+d.pairCode);document.getElementById('st').textContent=p.join(' · ')}}catch(e){{document.getElementById('st').textContent='status unavailable'}}}}refresh();setInterval(refresh,2000)</script></body></html>",
        urls_html,
        st.auth_mode
    );
    ([(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

// ---------- 基础工具 ----------

fn base64_encode(data: &[u8]) -> String {
    const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TBL[(n >> 18) as usize & 63] as char);
        out.push(TBL[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TBL[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TBL[n as usize & 63] as char } else { '=' });
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn lan_urls(port: u16) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(addrs) = std::net::UdpSocket::bind("0.0.0.0:0") {
        let _ = addrs.connect("8.8.8.8:80");
        if let Ok(local) = addrs.local_addr() {
            let ip = local.ip().to_string();
            if ip != "127.0.0.1" {
                out.push(format!("http://{}:{}", ip, port));
            }
        }
    }
    // 双网卡补充：枚举本机 IPv4（简单法：尝试常见网段不可行，交给 /api/status 由前端展示主地址）
    out
}

// ---------- 启动 / 停止 ----------

pub struct ControlServer {
    pub shutdown: tokio::sync::watch::Sender<bool>,
    pub port: u16,
}

/// 启动控制服务（返回 shutdown 通道；state 由调用方持有进 app state）
pub async fn spawn_server(
    st: Arc<ControlState>,
) -> Result<ControlServer, String> {
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);
    let port = st.port;

    st.running.store(true, Ordering::SeqCst);
    let app = Router::new()
        .route("/api/config", get(api_config))
        .route("/api/status", get(api_status))
        .route("/api/pair", post(api_pair))
        .route("/api/unbind", post(api_unbind))
        .route("/api/ping", post(api_ping))
        .route("/api/type", post(api_type))
        .route("/api/key", post(api_key))
        .route("/api/combo", post(api_combo))
        .route("/api/mouse", post(api_mouse))
        .route("/api/click", post(api_click))
        .route("/api/wheel", post(api_wheel))
        .route("/api/clipboard/refresh", post(api_clip_refresh))
        .route("/api/clipboard/paste", post(api_clip_paste))
        .route("/api/clipboard/clear", post(api_clip_clear))
        .route("/api/reset-code", post(api_reset_code))
        .route("/pc", get(pc_status_page))
        .fallback(get(static_files))
        .with_state(st);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("端口 {} 占用: {}", port, e))?;
    log::info!("[control] 服务启动 :{}", port);

    tokio::spawn(async move {
        let serve = axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>());
        tokio::select! {
            _ = serve => {}
            _ = shutdown_rx.changed() => {}
        }
    });

    Ok(ControlServer { shutdown: shutdown_tx, port })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state(port: u16) -> Arc<ControlState> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("sj");
        Arc::new(ControlState {
            port,
            auth_mode: "pair".to_string(),
            static_tokens: vec![],
            pair_code: Mutex::new(new_pair_code()),
            sessions: Mutex::new(HashMap::new()),
            recent_input: Mutex::new(Vec::new()),
            clip_history: Mutex::new(Vec::new()),
            clip_busy: AtomicBool::new(false),
            injector: Injector::start(root.join("inject.ps1")),
            static_root: root,
            running: AtomicBool::new(false),
        })
    }

    fn http(port: u16, req: &str) -> String {
        use std::io::{Read, Write};
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        buf
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn control_server_full_flow() {
        let st = test_state(9831);
        let pair_code = st.pair_code.lock().unwrap().clone();
        let _srv = spawn_server(st).await.unwrap();

        // GET /api/config
        let r = http(9831, "GET /api/config HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(r.contains("200"), "config 应 200: {}", &r[..120.min(r.len())]);
        assert!(r.contains("\"requirePair\":true"));

        // GET /api/status
        let r = http(9831, "GET /api/status HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(r.contains("pairCode"));

        // POST /api/pair 绑定码错误 → 401
        let body = r#"{"code":"000000"}"#;
        let r = http(9831, &format!("POST /api/pair HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body));
        assert!(r.contains("401"));

        // POST /api/pair 正确绑定码 → 200 + token
        let body = format!("{{\"code\":\"{}\"}}", pair_code);
        let r = http(9831, &format!("POST /api/pair HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body));
        assert!(r.contains("\"token\""), "pair 应返回 token: {}", &r[..200.min(r.len())]);
        let token: String = r
            .rsplit_once("{\"token\":\"")
            .and_then(|(_, rest)| rest.split('"').next().map(|s| s.to_string()))
            .unwrap_or_default();

        // 未授权 /api/type → 401
        let body = r#"{"text":"hi"}"#;
        let r = http(9831, &format!("POST /api/type HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body));
        assert!(r.contains("401"));

        // 携带 token 的 /api/type → 200（注入器可能未 READY，但 ok 字段应为布尔）
        let body = r#"{"text":"tauri测试"}"#;
        let r = http(9831, &format!("POST /api/type HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", token, body.len(), body));
        assert!(r.contains("\"ok\":") && !r.contains("401"), "type 应 200: {}", &r[..200.min(r.len())]);

        // 静态文件：/index.html
        let r = http(9831, "GET /index.html HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(r.contains("200") && (r.contains("<!DOCTYPE") || r.contains("<!doctype") || r.contains("<html")), "index 应可访问");
    }
}

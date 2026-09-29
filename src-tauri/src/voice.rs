//! M5 语音输入——对齐 electron/voice-input.ts（703 行）
//! 桥进程（PowerShell 按键钩子+打字）+ DashScope ASR WS 流 + LLM 润色 + 胶囊窗

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager};
use std::io::BufRead as _;
use tokio_tungstenite::tungstenite::Message;

const ASR_MODEL: &str = "qwen-audio-3.0-asr-flash-streaming";
const VOICE_HOTKEY: &str = "alt+h";

// ---------- 配置（config.voice 节）----------

fn voice_config() -> Value {
    let raw = crate::config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    cfg.get("voice").cloned().unwrap_or(json!({}))
}

fn write_voice_config(patch: &Value) {
    // parse 失败绝不能把空骨架写回（防数据覆盖）
    let Some(mut cfg) = crate::config::read_config_value() else {
        log::warn!("[voice] write_voice_config 跳过：config.json 解析失败");
        return;
    };
    if let Some(obj) = cfg.as_object_mut() {
        let voice = obj.entry("voice").or_insert_with(|| json!({}));
        if let (Some(vo), Some(po)) = (voice.as_object_mut(), patch.as_object()) {
            for (k, v) in po {
                vo.insert(k.clone(), v.clone());
            }
        }
    }
    crate::config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
}

fn bridge_script_path() -> std::path::PathBuf {
    let candidates = [
        crate::sj_static_root_pub().join("../scripts/voice-input-bridge.ps1"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/scripts/voice-input-bridge.ps1"),
    ];
    candidates.iter().find(|p| p.exists()).cloned().unwrap_or_else(|| candidates[0].clone())
}

// ---------- 统计 ----------

fn stats_file() -> std::path::PathBuf {
    crate::config::config_dir().join("voice-stats.json")
}

fn today_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn record_voice_stat(kind: &str, amount: i64) {
    let mut stats: Value = std::fs::read_to_string(stats_file())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(json!({}));
    let key = today_key();
    let obj = stats.as_object_mut().unwrap();
    let day = obj.entry(key).or_insert_with(|| json!({ "calls": 0, "chars": 0 }));
    if let Some(dobj) = day.as_object_mut() {
        match kind {
            "call" => {
                let calls = dobj.entry("calls").or_insert(json!(0));
                *calls = json!(calls.as_i64().unwrap_or(0) + 1);
            }
            _ => {
                let chars = dobj.entry("chars").or_insert(json!(0));
                *chars = json!(chars.as_i64().unwrap_or(0) + amount);
            }
        }
    }
    let _ = std::fs::write(stats_file(), serde_json::to_string(&stats).unwrap_or_default());
}

pub fn get_voice_stats() -> Value {
    std::fs::read_to_string(stats_file())
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(json!({}))
}

// ---------- 会话状态 ----------

pub struct VoiceSession {
    pub running: AtomicBool,
    pub listening: AtomicBool,
    pub processing: AtomicBool,
    pub committed: Mutex<String>,
    pub partial: Mutex<String>,
    pub last_raw: Mutex<String>,
    pub last_final_norm: Mutex<String>,
    pub asr_tx: Mutex<Option<tokio::sync::mpsc::UnboundedSender<Message>>>,
}

impl VoiceSession {
    fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            listening: AtomicBool::new(false),
            processing: AtomicBool::new(false),
            committed: Mutex::new(String::new()),
            partial: Mutex::new(String::new()),
            last_raw: Mutex::new(String::new()),
            last_final_norm: Mutex::new(String::new()),
            asr_tx: Mutex::new(None),
        }
    }
    fn reset(&self) {
        *self.committed.lock().unwrap() = String::new();
        *self.partial.lock().unwrap() = String::new();
        *self.last_raw.lock().unwrap() = String::new();
        *self.last_final_norm.lock().unwrap() = String::new();
        *self.asr_tx.lock().unwrap() = None;
        self.running.store(false, Ordering::SeqCst);
        self.listening.store(false, Ordering::SeqCst);
        self.processing.store(false, Ordering::SeqCst);
    }
    fn session_text(&self) -> String {
        format!("{}{}", self.committed.lock().unwrap(), self.partial.lock().unwrap())
    }
}

static SESSION: OnceLock<VoiceSession> = OnceLock::new();
static BRIDGE_STDIN: OnceLock<Mutex<Option<std::process::ChildStdin>>> = OnceLock::new();

fn session() -> &'static VoiceSession {
    SESSION.get_or_init(VoiceSession::new)
}

fn bridge_stdin() -> &'static Mutex<Option<std::process::ChildStdin>> {
    BRIDGE_STDIN.get_or_init(|| Mutex::new(None))
}

fn bridge_write(line: &str) {
    if let Ok(mut guard) = bridge_stdin().lock() {
        if let Some(stdin) = guard.as_mut() {
            let _ = stdin.write_all(format!("{}\n", line).as_bytes());
            let _ = stdin.flush();
        }
    }
}

fn send_to_window(app: &tauri::AppHandle, channel: &str, payload: Value) {
    if let Some(win) = app.get_webview_window("voice") {
        let _ = win.emit(channel, payload);
    }
}

// ---------- 桥进程（PowerShell：按键钩子 + 焦点查询 + 打字）----------

pub fn ensure_bridge(app: &tauri::AppHandle) {
    {
        let guard = bridge_stdin().lock().unwrap();
        if guard.is_some() {
            return;
        }
    }
    let script = bridge_script_path();
    if !script.exists() {
        send_to_window(app, "voice:status", json!({ "state": "error", "message": "输入桥脚本缺失" }));
        return;
    }
    use std::os::windows::process::CommandExt;
    let child = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .creation_flags(0x08000000)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return;
    };
    let stdin = child.stdin.take();
    *bridge_stdin().lock().unwrap() = stdin;
    let Some(stdout) = child.stdout.take() else {
        *bridge_stdin().lock().unwrap() = None;
        return;
    };
    let app_handle = app.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let l = line.trim();
            match l {
                "EVENT|SPACE" => toggle_pause(&app_handle),
                "EVENT|ENTER" => confirm_and_type(&app_handle),
                "EVENT|ESC" => cancel_session(&app_handle),
                "READY|HOOK" => {
                    send_to_window(&app_handle, "voice:status", json!({ "state": "ready", "message": "按键控制已就绪（空格=暂停，回车=确认）" }));
                }
                _ if l.starts_with("ERR|") => {
                    send_to_window(&app_handle, "voice:status", json!({ "state": "error", "message": format!("按键控制异常: {}", &l[4..]) }));
                }
                _ => {}
            }
        }
        *bridge_stdin().lock().unwrap() = None;
    });
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

/// 焦点检测（桥 F 命令 + FOCUS|1 应答；桥不可用放行）——简化为放行 + 桥就绪检查
pub fn query_focus(app: &tauri::AppHandle) -> bool {
    ensure_bridge(app);
    // 桥未就绪时放行（与 Electron 语义一致：桥不可用放行）
    true
}

// ---------- ASR WS 流（DashScope 百炼）----------

fn resolve_ws_url(workspace_value: &str) -> Result<String, String> {
    let value = workspace_value.trim();
    if value.is_empty() {
        return Err("Workspace ID 为空".to_string());
    }
    if value.to_lowercase().contains("{workspaceid}") {
        return Err("Workspace ID 不能填写 {WorkspaceId} 模板，请填写实际 llm-xxxxxx ID".to_string());
    }
    if value.starts_with("ws://") || value.starts_with("wss://") {
        // 简化域名校验：仅接受 maas.aliyuncs.com 域
        if !value.to_lowercase().contains("maas.aliyuncs.com") {
            return Err("WebSocket 地址不是百炼北京区工作区专属地址".to_string());
        }
        if let Some(rest) = value.split("://").nth(1) {
            let host = rest.split('/').next().unwrap_or("");
            return Ok(format!("wss://{}/api-ws/v1/inference", host));
        }
        return Err("WebSocket 地址无效".to_string());
    }
    let re = regex::Regex::new(r"(?i)llm-[a-z0-9]+").unwrap();
    let workspace_id = re
        .find(value)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| value.to_string());
    if !regex::Regex::new(r"(?i)^llm-[a-z0-9]+$").unwrap().is_match(&workspace_id) {
        return Err("Workspace ID 格式错误，应类似 llm-xxxxxxxx".to_string());
    }
    Ok(format!("wss://{}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference", workspace_id))
}

fn normalize_for_dedup(s: &str) -> String {
    s.chars().filter(|c| !"。．.!！?？,，、;；:： ".contains(*c)).collect()
}

/// 对齐 applyRawResult：partial 覆盖 / final 追加去重
fn apply_raw_result(app: &tauri::AppHandle, text: &str, is_partial: bool) {
    let s = session();
    if !s.running.load(Ordering::SeqCst) {
        return;
    }
    let t = text.trim().to_string();
    if t.is_empty() {
        return;
    }
    if *s.last_raw.lock().unwrap() == t {
        return;
    }
    *s.last_raw.lock().unwrap() = t.clone();
    if is_partial {
        let committed = s.committed.lock().unwrap().clone();
        if !committed.is_empty() && t.starts_with(&committed) {
            *s.partial.lock().unwrap() = t[committed.len()..].to_string();
        } else {
            *s.partial.lock().unwrap() = t;
        }
    } else {
        let norm = normalize_for_dedup(&t);
        let last_norm = s.last_final_norm.lock().unwrap().clone();
        if !last_norm.is_empty() && norm == last_norm {
            return;
        }
        let mut committed = s.committed.lock().unwrap();
        committed.push_str(&t);
        *s.last_final_norm.lock().unwrap() = norm;
        *s.partial.lock().unwrap() = String::new();
    }
    let full = s.session_text();
    send_to_window(app, "voice:session", json!(full));
}

pub fn spawn_asr_stream(app: &tauri::AppHandle, api_key: &str, workspace_id: &str) -> bool {
    let url = match resolve_ws_url(workspace_id) {
        Ok(u) => u,
        Err(e) => {
            send_to_window(app, "voice:status", json!({ "state": "error", "message": e }));
            return false;
        }
    };
    let task_id: String = (0..16).map(|_| format!("{:02x}", rand::rng().random_range(0..256))).collect();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    *session().asr_tx.lock().unwrap() = Some(tx);
    let app = app.clone();
    let api_key = api_key.to_string();
    tauri::async_runtime::spawn(async move {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let Ok(mut request) = url.as_str().into_client_request() else {
            send_to_window(&app, "voice:status", json!({ "state": "error", "message": "WebSocket 地址无效" }));
            return;
        };
        if let Ok(value) = tokio_tungstenite::tungstenite::http::HeaderValue::from_str(&format!("bearer {}", api_key)) {
            request.headers_mut().insert("Authorization", value);
        }
        let connect = tokio_tungstenite::connect_async(request).await;
        let Ok((mut ws, _)) = connect else {
            send_to_window(&app, "voice:status", json!({ "state": "error", "message": "连接失败" }));
            return;
        };
        let run_task = json!({
            "header": { "action": "run-task", "task_id": task_id, "streaming": "duplex" },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": ASR_MODEL,
                "parameters": { "sample_rate": 16000, "format": "wav" },
                "input": {},
            }
        });
        if ws.send(Message::Text(run_task.to_string().into())).await.is_err() {
            return;
        }
        loop {
            tokio::select! {
                out = rx.recv() => {
                    match out {
                        Some(msg) => { if ws.send(msg).await.is_err() { break; } }
                        None => {
                            // 会话结束：finish-task
                            let finish = json!({ "header": { "action": "finish-task", "task_id": task_id }, "payload": { "input": {} } });
                            let _ = ws.send(Message::Text(finish.to_string().into())).await;
                            let _ = ws.send(Message::Close(None)).await;
                            break;
                        }
                    }
                }
                read = ws.next() => {
                    match read {
                        Some(Ok(Message::Text(text))) => {
                            let Ok(msg) = serde_json::from_str::<Value>(&text) else { continue };
                            let event = msg.pointer("/header/event").and_then(|v| v.as_str()).unwrap_or("");
                            match event {
                                "task-started" => {
                                    send_to_window(&app, "voice:status", json!({ "state": "listening", "message": "识别中…" }));
                                }
                                "result-generated" => {
                                    let sentence = msg.pointer("/payload/output/sentence");
                                    if let Some(sentence) = sentence {
                                        if let Some(t) = sentence.get("text").and_then(|v| v.as_str()) {
                                            let is_partial = sentence.get("end_time").map(|v| v.is_null()).unwrap_or(true);
                                            apply_raw_result(&app, t, is_partial);
                                        }
                                    }
                                }
                                "task-failed" => {
                                    let err = msg.pointer("/header/error_message").and_then(|v| v.as_str()).unwrap_or("识别失败");
                                    send_to_window(&app, "voice:status", json!({ "state": "error", "message": err }));
                                }
                                "task-finished" => {
                                    let _ = ws.send(Message::Close(None));
                                    break;
                                }
                                _ => {}
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Ok(_)) => {}
                        Some(Err(_)) => break,
                    }
                }
            }
        }
    });
    true
}



// ---------- 结构润色（SSE 流式 chat/completions）----------

fn structure_prompt() -> String {
    "你是一个语音转文字整理助手。用户给你一段语音识别出的文字（可能含重复、口语化、错别字）。请把它整理成通顺、自然的文本：\n1) 合并完全重复的内容，只保留一处；\n2) 修正确定无疑的错别字；\n3) 让语句通顺自然，去掉口语口头禅（如\"诶\"\"嗯\"\"然后\"等），补全缺失的标点，但**保持原文的完整信息与自然表达，不要缩减、不要提炼、不要改写原意**；\n4) **不要添加任何编号、序号、数字、点号前缀**，也不要自己换行拆分；\n5) 直接输出整理后的整段文字。\n**只输出最终结果**，不要任何解释、前言、引号、markdown 代码块。".to_string()
}

fn has_multiple_lines(s: &str) -> bool {
    s.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).count() >= 2
}

fn should_structure(original: &str) -> bool {
    let re = regex::Regex::new(r"第[一二三四五六七八九十百\d]+[点项条个]|几点|[一二三四五六七八九十百]+点|[一二三四五六七八九十百]+个(任务|要点|需求|事项)|第一个是|第二个是|第三个是|第一点|第二点|第三点|1\.\s*[^0-9]|2\.\s*[^0-9]").unwrap();
    re.is_match(original)
}

/// 对齐 formatStructuredResult
fn format_structured_result(raw: &str, structure: bool) -> String {
    let mut s = raw.trim().to_string();
    s = regex::Regex::new(r"(?s)^```[a-zA-Z]*\n?").unwrap().replace_all(&s, "").to_string();
    s = regex::Regex::new(r"(?s)\n?```$").unwrap().replace_all(&s, "").to_string();
    s = s.trim_matches(|c: char| "\"'`“”".contains(c)).to_string();
    let mut lines: Vec<String> = s
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    lines.dedup();
    if !structure {
        let mut parts: Vec<String> = Vec::new();
        for l in &lines {
            let clean = regex::Regex::new(r"^[^\p{Han}A-Za-z0-9]{1,6}\s*[.、．)）]?").unwrap().replace_all(l, "").trim().to_string();
            if !clean.is_empty() {
                parts.push(clean.trim_end_matches(|c: char| "。．!？、；:，!?,;:".contains(c)).to_string());
            }
        }
        if parts.is_empty() {
            return String::new();
        }
        return format!("{}。", parts.join("，"));
    }
    let strip_prefix = |l: &str| -> String {
        let t = regex::Regex::new(r"^(?:\d+\s*[.、．)）]|[^0-9\p{Han}]{1,6}\s*[.、．)）]|\d+\s*$)").unwrap().replace_all(l, "").to_string();
        let t = regex::Regex::new(r"^[^\p{Han}]{1,10}\.\s*").unwrap().replace_all(&t, "").to_string();
        t.trim().trim_end_matches(|c: char| "。．!？、；:，!?,;:".contains(c)).to_string()
    };
    if lines.len() > 1 {
        let cleaned: Vec<String> = lines.iter().map(|l| strip_prefix(l)).filter(|l| !l.is_empty()).collect();
        if cleaned.is_empty() {
            return raw.trim().to_string();
        }
        if cleaned.len() > 1 && cleaned[0].chars().count() <= 24 {
            let head = cleaned[0].trim_end_matches(|c: char| "。．!？、： ,!?,:".contains(c)).to_string();
            let items: Vec<String> = cleaned[1..].iter().enumerate().map(|(i, it)| format!("{}. {}", i + 1, it)).collect();
            if !items.is_empty() {
                return if head.is_empty() {
                    items.join("\n")
                } else {
                    format!("{}：\n{}", head, items.join("\n"))
                };
            }
            return cleaned[0].clone();
        }
        return cleaned.iter().map(|l| l.trim_end_matches(|c: char| "。．!？、 ,!?,".contains(c))).collect::<Vec<_>>().join("");
    }
    lines.join("").trim_end_matches(|c: char| "。．!？、 ,!?".contains(c)).to_string()
}

pub fn structure_with_llm_blocking(text: &str) -> String {
    let cfg = voice_config();
    let p = cfg.get("polishProvider").cloned().unwrap_or(json!({}));
    let base = p.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let key = p.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let model = {
        let m = p.get("model").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if m.is_empty() { "qwen-plus".to_string() } else { m }
    };
    if base.is_empty() || key.is_empty() {
        return text.to_string();
    }
    let url = if base.to_lowercase().ends_with("/chat/completions") {
        base.clone()
    } else {
        format!("{}/chat/completions", base.trim_end_matches('/'))
    };
    let body = json!({
        "model": model,
        "stream": true,
        "enable_thinking": false,
        "messages": [
            { "role": "system", "content": structure_prompt() },
            { "role": "user", "content": text }
        ]
    });
    let resp = ureq::post(&url)
        .timeout(std::time::Duration::from_millis(30_000))
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {}", key))
        .send_string(&body.to_string());
    let Ok(resp) = resp else {
        return format_structured_result(text, should_structure(text) || has_multiple_lines(text));
    };
    if resp.status() >= 400 {
        return format_structured_result(text, should_structure(text) || has_multiple_lines(text));
    }
    let mut full = String::new();
    let mut reader = std::io::BufReader::new(resp.into_reader());
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let l = line.trim();
                if let Some(data) = l.strip_prefix("data:") {
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }
                    if let Ok(j) = serde_json::from_str::<Value>(data) {
                        let delta = j.pointer("/choices/0/delta/content").and_then(|v| v.as_str());
                        let msg = j.pointer("/choices/0/message/content").and_then(|v| v.as_str());
                        if let Some(piece) = delta.or(msg) {
                            full.push_str(piece);
                        }
                    }
                }
            }
        }
    }
    if full.is_empty() {
        return format_structured_result(text, should_structure(text) || has_multiple_lines(text));
    }
    format_structured_result(&full, should_structure(text) || has_multiple_lines(&full))
}

// ---------- 会话控制 ----------

fn close_stream() {
    let tx = session().asr_tx.lock().unwrap().take();
    drop(tx); // receiver 收到 None → finish + close
}

pub fn end_session(app: &tauri::AppHandle) {
    let s = session();
    if !s.running.swap(false, Ordering::SeqCst) {
        return;
    }
    s.listening.store(false, Ordering::SeqCst);
    close_stream();
    bridge_write("D");
    s.reset();
    send_to_window(app, "voice:status", json!({ "state": "stopped", "message": "已结束" }));
}

pub fn toggle_pause(app: &tauri::AppHandle) {
    let s = session();
    if !s.running.load(Ordering::SeqCst) {
        return;
    }
    if s.listening.fetch_not(Ordering::SeqCst) {
        send_to_window(app, "voice:status", json!({ "state": "paused", "message": "已暂停（空格继续）" }));
    } else {
        send_to_window(app, "voice:status", json!({ "state": "listening", "message": "识别中…" }));
    }
}

pub fn confirm_and_type(app: &tauri::AppHandle) {
    let s = session();
    if !s.running.load(Ordering::SeqCst) {
        return;
    }
    let text = s.session_text().trim().to_string();
    s.running.store(false, Ordering::SeqCst);
    s.listening.store(false, Ordering::SeqCst);
    close_stream();
    bridge_write("D");
    let win = app.get_webview_window("voice");
    if text.is_empty() {
        if let Some(w) = &win {
            let _ = w.close();
        }
        return;
    }
    if s.processing.load(Ordering::SeqCst) {
        return;
    }
    s.processing.store(true, Ordering::SeqCst);
    send_to_window(app, "voice:status", json!({ "state": "processing", "message": "整理中…" }));
    let app = app.clone();
    std::thread::spawn(move || {
        let cfg = voice_config();
        let mode = cfg.get("polishMode").and_then(|v| v.as_str()).unwrap_or("llm").to_string();
        let out = if mode != "off" {
            structure_with_llm_blocking(&text)
        } else {
            text.clone()
        };
        session().processing.store(false, Ordering::SeqCst);
        let win = app.get_webview_window("voice");
        if let Some(w) = &win {
            let _ = w.hide();
        }
        let out = out.trim().to_string();
        if !out.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(180));
            let encoded = base64::engine::general_purpose::STANDARD.encode(out.as_bytes());
            bridge_write(&format!("T|{}", encoded));
            record_voice_stat("chars", out.chars().count() as i64);
        }
        if let Some(w) = app.get_webview_window("voice") {
            let _ = w.close();
        }
    });
}

pub fn cancel_session(app: &tauri::AppHandle) {
    end_session(app);
    if let Some(w) = app.get_webview_window("voice") {
        let _ = w.close();
    }
}

// ---------- 窗口 ----------

pub fn open_voice_window(app: &tauri::AppHandle) {
    let cfg = voice_config();
    if let Some(win) = app.get_webview_window("voice") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("voice:getConfig", cfg);
        return;
    }
    let saved_pos = cfg.get("windowPos").cloned().unwrap_or(json!({}));
    let saved_size = cfg.get("windowSize").cloned().unwrap_or(json!({}));
    let width = saved_size.get("width").and_then(|v| v.as_f64()).filter(|v| v.is_finite()).map(|v| v.clamp(220.0, 600.0)).unwrap_or(320.0);
    let height = saved_size.get("height").and_then(|v| v.as_f64()).filter(|v| v.is_finite()).map(|v| v.clamp(44.0, 200.0)).unwrap_or(52.0);
    let (monitor_x, monitor_y, monitor_w, monitor_h) = (0.0f64, 0.0f64, 1536.0f64, 864.0f64);
    let mut x = monitor_x + (monitor_w - width) / 2.0;
    let mut y = monitor_y + monitor_h - height - 12.0;
    if let (Some(px), Some(py)) = (saved_pos.get("x").and_then(|v| v.as_f64()), saved_pos.get("y").and_then(|v| v.as_f64())) {
        x = px.clamp(monitor_x - 20.0, monitor_x + monitor_w - width + 20.0);
        y = py.clamp(monitor_y - 20.0, monitor_y + monitor_h - 20.0);
    }
    let web_url = "voiceinput.html";
    let result = tauri::WebviewWindowBuilder::new(
        app,
        "voice",
        tauri::WebviewUrl::App(web_url.into()),
    )
    .title("Shortcut Voice")
    .inner_size(width, height)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .resizable(true)
    .min_inner_size(220.0, 44.0)
    .max_inner_size(600.0, 200.0)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .initialization_script(crate::SHIM_JS)
    .focused(false)
    .visible(false)
    .build();
    match result {
        Ok(win) => {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit("voice:getConfig", cfg);
            record_voice_stat("call", 0);
            let app2 = app.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) = event {
                    // 位置尺寸变化写回配置（简化：仅 moved）
                    if let tauri::WindowEvent::Moved(_) = event {
                        if let Some(w) = app2.get_webview_window("voice") {
                            if let Ok(pos) = w.outer_position() {
                                write_voice_config(&json!({ "windowPos": { "x": pos.x, "y": pos.y } }));
                            }
                        }
                    }
                }
            });
        }
        Err(_) => {}
    }
}

pub fn toggle_voice_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("voice") {
        let _ = win.close();
        return;
    }
    open_voice_window(app);
}

// ---------- 命令入口 ----------

pub fn voice_open(app: &tauri::AppHandle) -> Value {
    open_voice_window(app);
    json!(true)
}

pub fn voice_get_config(app: &tauri::AppHandle) -> Value {
    register_shortcut(app);
    voice_config()
}

pub fn voice_start(app: &tauri::AppHandle) -> Value {
    let cfg = voice_config();
    let api_key = cfg.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let workspace = cfg.get("workspaceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if api_key.is_empty() || workspace.is_empty() {
        send_to_window(app, "voice:status", json!({ "state": "error", "message": "请在语音板块填写 百炼 API Key 与 Workspace ID" }));
        return json!({ "success": false, "message": "未配置 API Key / Workspace ID" });
    }
    ensure_bridge(app);
    let ok = query_focus(app);
    if !ok {
        send_to_window(app, "voice:status", json!({ "state": "error", "message": "请先把光标放到要输入的输入框内，再开始语音输入" }));
        return json!({ "success": false, "message": "焦点不在输入框" });
    }
    let s = session();
    s.running.store(true, Ordering::SeqCst);
    s.listening.store(true, Ordering::SeqCst);
    s.processing.store(false, Ordering::SeqCst);
    *s.committed.lock().unwrap() = String::new();
    *s.partial.lock().unwrap() = String::new();
    *s.last_raw.lock().unwrap() = String::new();
    *s.last_final_norm.lock().unwrap() = String::new();
    let started = spawn_asr_stream(app, &api_key, &workspace);
    if started {
        bridge_write("A");
    }
    json!({ "success": started })
}

pub fn voice_audio(chunk_b64: &str) -> Value {
    if !session().listening.load(Ordering::SeqCst) {
        return json!(false);
    }
    let Ok(data) = base64::engine::general_purpose::STANDARD.decode(chunk_b64) else {
        return json!(false);
    };
    if let Some(tx) = session().asr_tx.lock().unwrap().as_ref() {
        let _ = tx.send(Message::Binary(data.into()));
    }
    json!(true)
}

pub fn voice_confirm(app: &tauri::AppHandle) -> Value {
    confirm_and_type(app);
    json!({ "success": true })
}

pub fn voice_toggle(app: &tauri::AppHandle) -> Value {
    toggle_pause(app);
    json!({ "success": true })
}

pub fn voice_cancel(app: &tauri::AppHandle) -> Value {
    cancel_session(app);
    json!({ "success": true })
}

/// Alt+H 全局热键注册（voice:getConfig / 启动时调用）
pub fn register_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let cfg = voice_config();
    if cfg.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
        let _ = app.global_shortcut().unregister(VOICE_HOTKEY);
        return;
    }
    let app2 = app.clone();
    let _ = app.global_shortcut().on_shortcut(VOICE_HOTKEY, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            toggle_voice_window(&app2);
        }
    });
}

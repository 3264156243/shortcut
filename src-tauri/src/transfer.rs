//! M5 文件快传——对齐 electron/file-transfer.ts（sync/api.php + sync/file.php 分片上传/流式下载）

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::config;
use crate::hub;
use crate::sync;
use base64::Engine;

const FILE_URL: &str = "https://shortcut.326415.xyz/sync/file.php";
const CHUNK_SIZE: usize = 2 * 1024 * 1024;
const HISTORY_LIMIT: usize = 300;

static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_TASKS: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
static HISTORY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn cancelled() -> &'static Mutex<HashSet<String>> {
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}
fn active_tasks_store() -> &'static Mutex<HashMap<String, Value>> {
    ACTIVE_TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn history_lock() -> &'static Mutex<()> {
    HISTORY_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferHistoryItem {
    id: String,
    time: String,
    direction: String,
    name: String,
    size: u64,
    status: String,
    channel: String,
    #[serde(default)]
    local_path: String,
    #[serde(default)]
    source_path: String,
    #[serde(default)]
    file_id: String,
    #[serde(default)]
    note: String,
}

fn history_file() -> PathBuf {
    config::config_dir().join("transfer-history.json")
}

fn load_history_inner() -> Vec<TransferHistoryItem> {
    std::fs::read_to_string(history_file())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_history_inner(items: &[TransferHistoryItem]) {
    config::ensure_dirs();
    let path = history_file();
    let tmp = path.with_extension("json.tmp");
    if let Ok(raw) = serde_json::to_string_pretty(items) {
        if std::fs::write(&tmp, raw).is_ok() {
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

fn push_history(item: TransferHistoryItem) {
    let Ok(_guard) = history_lock().lock() else {
        return;
    };
    let mut items = load_history_inner();
    items.retain(|row| row.id != item.id);
    items.insert(0, item);
    items.truncate(HISTORY_LIMIT);
    save_history_inner(&items);
}

fn emit_progress(
    app: &AppHandle,
    task_id: &str,
    direction: &str,
    name: &str,
    total: u64,
    transferred: u64,
    started: Instant,
    status: &str,
    channel: &str,
    file_id: &str,
) {
    let elapsed = started.elapsed().as_secs_f64().max(0.001);
    let speed = transferred as f64 / elapsed;
    let remaining = total.saturating_sub(transferred);
    let eta = if speed > 1.0 {
        remaining as f64 / speed
    } else {
        0.0
    };
    let payload = json!({
        "taskId": task_id, "direction": direction, "name": name, "total": total,
        "transferred": transferred, "progress": if total > 0 { transferred as f64 / total as f64 } else { 0.0 },
        "speed": speed, "eta": eta, "status": status, "channel": channel, "fileId": file_id,
    });
    if let Ok(mut tasks) = active_tasks_store().lock() {
        if matches!(status, "completed" | "failed" | "cancelled") {
            tasks.remove(task_id);
        } else {
            tasks.insert(task_id.to_string(), payload.clone());
        }
    }
    let _ = app.emit("file-transfer:progress", payload);
}

fn is_cancelled(task_id: &str) -> bool {
    cancelled()
        .lock()
        .map(|set| set.contains(task_id))
        .unwrap_or(false)
}

fn clear_cancel(task_id: &str) {
    if let Ok(mut set) = cancelled().lock() {
        set.remove(task_id);
    }
}

fn transfer_resume_key(path: &Path, stat: &std::fs::Metadata) -> String {
    let modified = stat
        .modified()
        .ok()
        .and_then(|v| v.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|v| v.as_secs())
        .unwrap_or(0);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    hasher.update(stat.len().to_le_bytes());
    hasher.update(modified.to_le_bytes());
    format!(
        "resume_{}",
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
    )
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" | "log" => "text/plain",
        "zip" => "application/zip",
        "json" => "application/json",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn finish_history(
    app: &AppHandle,
    task_id: &str,
    direction: &str,
    name: &str,
    size: u64,
    status: &str,
    local_path: &str,
    source_path: &str,
    file_id: &str,
    note: &str,
    started: Instant,
) {
    emit_progress(
        app,
        task_id,
        direction,
        name,
        size,
        if status == "completed" { size } else { 0 },
        started,
        status,
        "cloud",
        file_id,
    );
    push_history(TransferHistoryItem {
        id: task_id.to_string(),
        time: chrono::Local::now().to_rfc3339(),
        direction: direction.to_string(),
        name: name.to_string(),
        size,
        status: status.to_string(),
        channel: "cloud".to_string(),
        local_path: local_path.to_string(),
        source_path: source_path.to_string(),
        file_id: file_id.to_string(),
        note: note.to_string(),
    });
}

/// 手写 percent-encode（不引入新依赖）：仅保留 RFC 3986 unreserved 字符，其余按 UTF-8 字节转 %XX
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// 发一个 transfer.* 动作：身份拼装（bindId/deskToken/side）与错误文案全部交给 hub。
/// 未绑定时 hub 返回 `{success:false, message:"联动绑定尚未建立"}`——与原 with_binding 语义一致。
fn with_binding(action: &str, payload: Value) -> Value {
    match hub::api_post(action, payload) {
        Ok(v) => v,
        Err(e) => hub::err_result(e),
    }
}

/// multipart/form-data 手工构造（ureq 2 无内建 multipart）
fn upload_chunk(
    bind_id: &str,
    desk_token: &str,
    file_id: &str,
    index: usize,
    chunk_hash: &str,
    chunk: &[u8],
    name: &str,
) -> Result<Value, String> {
    let boundary = "----ShortcutBoundaryRust";
    let mut body: Vec<u8> = Vec::new();
    let mut add_field = |name: &str, value: &str| {
        body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n",
                boundary, name, value
            )
            .as_bytes(),
        );
    };
    add_field("action", "uploadChunk");
    add_field("bindId", bind_id);
    add_field("side", "desktop");
    add_field("deskToken", desk_token);
    add_field("fileId", file_id);
    add_field("chunkIndex", &index.to_string());
    add_field("chunkHash", chunk_hash);
    let multipart_name = name.replace(['\r', '\n', '"'], "_");
    body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"chunk\"; filename=\"{}.part\"\r\nContent-Type: application/octet-stream\r\n\r\n", boundary, multipart_name).as_bytes());
    body.extend_from_slice(chunk);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let resp = ureq::post(FILE_URL)
        .timeout(std::time::Duration::from_millis(120_000))
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={}", boundary),
        )
        .send(&body[..])
        .map_err(|e| e.to_string())?;
    resp.into_json::<Value>()
        .map_err(|_| "文件分片上传失败".to_string())
}

fn upload_file(app: &AppHandle, task_id: &str, file_path: &str) -> Value {
    clear_cancel(task_id);
    let started = Instant::now();
    // 身份统一从 hub 取（bind_id 内部有 60 秒缓存，不再每次重新解析绑定）
    let Some(bind_id) = hub::bind_id() else {
        return json!({ "success": false, "message": "联动绑定尚未建立" });
    };
    let path = std::path::Path::new(file_path);
    let stat = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return json!({ "success": false, "message": "文件不存在" }),
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let size = stat.len();
    if size == 0 {
        return json!({ "success": false, "message": "不能发送空文件" });
    }
    let resume_key = transfer_resume_key(path, &stat);
    emit_progress(
        app,
        task_id,
        "upload",
        &name,
        size,
        0,
        started,
        "preparing",
        "cloud",
        "",
    );
    let init = with_binding(
        "transfer.fileInit",
        json!({ "name": name, "size": size, "mime": mime_for_path(path), "chunkSize": CHUNK_SIZE, "resumeKey": resume_key }),
    );
    if !init
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        finish_history(
            app,
            task_id,
            "upload",
            &name,
            size,
            "failed",
            "",
            file_path,
            "",
            init.get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("文件初始化失败"),
            started,
        );
        return init;
    }
    let Some(file_obj) = init.get("file").cloned() else {
        return json!({ "success": false, "message": "文件初始化失败" });
    };
    let file_id = file_obj
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // chunkCount 取不到或为 0 = 初始化失败，绝不能让"零分片"走到 fileComplete 报成功
    let chunk_count = match file_obj.get("chunkCount").and_then(|v| v.as_i64()) {
        Some(n) if n > 0 => n as usize,
        _ => {
            finish_history(
                app,
                task_id,
                "upload",
                &name,
                size,
                "failed",
                "",
                file_path,
                &file_id,
                "文件初始化失败",
                started,
            );
            return json!({ "success": false, "message": "文件初始化失败" });
        }
    };
    let desk_token = hub::desk_token();
    let uploaded: HashSet<usize> = file_obj
        .get("uploaded")
        .and_then(|v| v.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|v| v.as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_default();
    let mut transferred = uploaded
        .iter()
        .map(|index| {
            std::cmp::min(
                CHUNK_SIZE as u64,
                size.saturating_sub(*index as u64 * CHUNK_SIZE as u64),
            )
        })
        .sum::<u64>();
    emit_progress(
        app,
        task_id,
        "upload",
        &name,
        size,
        transferred,
        started,
        "running",
        "cloud",
        &file_id,
    );

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            finish_history(
                app,
                task_id,
                "upload",
                &name,
                size,
                "failed",
                "",
                file_path,
                &file_id,
                &e.to_string(),
                started,
            );
            return json!({ "success": false, "message": e.to_string() });
        }
    };
    let mut chunk = vec![0u8; CHUNK_SIZE];
    for index in 0..chunk_count {
        let expected = std::cmp::min(
            CHUNK_SIZE as u64,
            size.saturating_sub(index as u64 * CHUNK_SIZE as u64),
        ) as usize;
        if uploaded.contains(&index) {
            if file
                .seek(std::io::SeekFrom::Current(expected as i64))
                .is_err()
            {
                finish_history(
                    app,
                    task_id,
                    "upload",
                    &name,
                    size,
                    "failed",
                    "",
                    file_path,
                    &file_id,
                    "无法恢复文件读取位置",
                    started,
                );
                return json!({ "success": false, "message": "无法恢复文件读取位置" });
            }
            continue;
        }
        if is_cancelled(task_id) {
            let _ = with_binding("transfer.fileCancel", json!({ "fileId": file_id }));
            finish_history(
                app,
                task_id,
                "upload",
                &name,
                size,
                "cancelled",
                "",
                file_path,
                &file_id,
                "用户取消",
                started,
            );
            clear_cancel(task_id);
            return json!({ "success": false, "cancelled": true, "message": "传输已取消" });
        }
        let mut read = 0usize;
        while read < expected {
            match file.read(&mut chunk[read..expected]) {
                Ok(0) => {
                    finish_history(
                        app,
                        task_id,
                        "upload",
                        &name,
                        size,
                        "failed",
                        "",
                        file_path,
                        &file_id,
                        "文件在上传过程中发生变化",
                        started,
                    );
                    return json!({ "success": false, "message": "文件在上传过程中发生变化，请重新发送" });
                }
                Ok(n) => read += n,
                Err(e) => {
                    finish_history(
                        app,
                        task_id,
                        "upload",
                        &name,
                        size,
                        "failed",
                        "",
                        file_path,
                        &file_id,
                        &e.to_string(),
                        started,
                    );
                    return json!({ "success": false, "message": e.to_string() });
                }
            }
        }
        let mut hasher = Sha256::new();
        hasher.update(&chunk[..expected]);
        let chunk_hash: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();
        let result = match upload_chunk(
            &bind_id,
            &desk_token,
            &file_id,
            index,
            &chunk_hash,
            &chunk[..expected],
            &name,
        ) {
            Ok(v) => v,
            Err(e) => {
                finish_history(
                    app, task_id, "upload", &name, size, "failed", "", file_path, &file_id, &e,
                    started,
                );
                return json!({ "success": false, "message": e });
            }
        };
        if !result
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            finish_history(
                app,
                task_id,
                "upload",
                &name,
                size,
                "failed",
                "",
                file_path,
                &file_id,
                result
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("分片上传失败"),
                started,
            );
            return result;
        }
        transferred += expected as u64;
        emit_progress(
            app,
            task_id,
            "upload",
            &name,
            size,
            transferred,
            started,
            "running",
            "cloud",
            &file_id,
        );
    }
    let mut extra = [0u8; 1];
    if file.read(&mut extra).unwrap_or(1) != 0 {
        finish_history(
            app,
            task_id,
            "upload",
            &name,
            size,
            "failed",
            "",
            file_path,
            &file_id,
            "文件在上传过程中发生变化",
            started,
        );
        return json!({ "success": false, "message": "文件在上传过程中发生变化，请重新发送" });
    }
    let completed = with_binding("transfer.fileComplete", json!({ "fileId": file_id }));
    if completed
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        finish_history(
            app,
            task_id,
            "upload",
            &name,
            size,
            "completed",
            "",
            file_path,
            &file_id,
            "",
            started,
        );
    } else {
        finish_history(
            app,
            task_id,
            "upload",
            &name,
            size,
            "failed",
            "",
            file_path,
            &file_id,
            completed
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("文件完成失败"),
            started,
        );
    }
    completed
}

fn configured_download_dir() -> PathBuf {
    if let Some(cfg) = config::read_config_value()
        && let Some(value) = cfg
            .get("fileTransfer")
            .and_then(|v| v.get("downloadDirectory"))
            .and_then(|v| v.as_str())
        && !value.trim().is_empty()
    {
        return PathBuf::from(value.trim());
    }
    std::env::var("USERPROFILE")
        .map(|home| PathBuf::from(home).join("Downloads").join("ShortCut 快传"))
        .unwrap_or_else(|_| std::env::temp_dir().join("ShortCut 快传"))
}

fn safe_download_name(name: &str, fallback: &str) -> String {
    let source = if name.trim().is_empty() {
        fallback
    } else {
        name
    };
    let mut value: String = source
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    value = value.trim().trim_end_matches(['.', ' ']).to_string();
    if value.is_empty() {
        return "download".to_string();
    }
    let stem = Path::new(&value)
        .file_stem()
        .and_then(|part| part.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .is_some_and(|n| matches!(n.parse::<u8>(), Ok(1..=9)))
        || stem
            .strip_prefix("LPT")
            .is_some_and(|n| matches!(n.parse::<u8>(), Ok(1..=9)));
    if reserved {
        value.insert(0, '_');
    }
    value
}

fn available_target(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("download");
    let ext = path.extension().and_then(|v| v.to_str());
    for index in 1..10_000 {
        let candidate = match ext {
            Some(ext) if !ext.is_empty() => dir.join(format!("{} ({index}).{}", stem, ext)),
            _ => dir.join(format!("{} ({index})", stem)),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!(
        "{}-{}",
        name,
        chrono::Local::now().timestamp_millis()
    ))
}

fn download_from_url(
    app: &AppHandle,
    task_id: &str,
    url: &str,
    name: &str,
    fallback: &str,
    file_id: &str,
) -> Value {
    clear_cancel(task_id);
    let started = Instant::now();
    let downloads = configured_download_dir();
    if let Err(e) = std::fs::create_dir_all(&downloads) {
        return json!({ "success": false, "message": format!("无法创建下载目录: {e}") });
    }
    let safe_name = safe_download_name(name, fallback);
    let part_key = safe_download_name(file_id, fallback);
    let tmp = downloads.join(format!(".shortcut-{}.part", part_key));
    let mut offset = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
    let mut request = ureq::get(url).timeout(std::time::Duration::from_millis(300_000));
    if offset > 0 {
        request = request.set("Range", &format!("bytes={offset}-"));
    }
    let resp = match request.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(416, _)) => {
            let _ = std::fs::remove_file(&tmp);
            offset = 0;
            match ureq::get(url)
                .timeout(std::time::Duration::from_millis(300_000))
                .call()
            {
                Ok(r) => r,
                Err(e) => return json!({ "success": false, "message": e.to_string() }),
            }
        }
        Err(e) => return json!({ "success": false, "message": e.to_string() }),
    };
    if offset > 0 && resp.status() != 206 {
        offset = 0;
        let _ = std::fs::remove_file(&tmp);
    }
    let response_len: u64 = resp
        .header("Content-Length")
        .and_then(|h| h.parse().ok())
        .unwrap_or(0);
    let total = resp
        .header("Content-Range")
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(offset + response_len);
    let expected_hash = resp
        .header("X-Checksum-Sha256")
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if expected_hash.len() != 64 || !expected_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return json!({ "success": false, "message": "服务端未提供有效的文件校验值" });
    }
    let mut reader = resp.into_reader();
    let mut file = match OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(&tmp)
    {
        Ok(f) => f,
        Err(e) => return json!({ "success": false, "message": e.to_string() }),
    };
    let mut received = offset;
    emit_progress(
        app, task_id, "download", &safe_name, total, received, started, "running", "cloud", file_id,
    );
    let mut buf = [0u8; 65536];
    loop {
        if is_cancelled(task_id) {
            let _ = file.flush();
            drop(file);
            finish_history(
                app,
                task_id,
                "download",
                &safe_name,
                total,
                "cancelled",
                &tmp.to_string_lossy(),
                "",
                file_id,
                "可继续下载",
                started,
            );
            clear_cancel(task_id);
            return json!({ "success": false, "cancelled": true, "resumable": true, "message": "下载已暂停，可继续" });
        }
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if file.write_all(&buf[..n]).is_err() {
                    drop(file);
                    finish_history(
                        app,
                        task_id,
                        "download",
                        &safe_name,
                        total,
                        "failed",
                        &tmp.to_string_lossy(),
                        "",
                        file_id,
                        "文件保存失败，可继续",
                        started,
                    );
                    return json!({ "success": false, "resumable": true, "message": "文件保存失败，可继续" });
                }
                received += n as u64;
                emit_progress(
                    app, task_id, "download", &safe_name, total, received, started, "running",
                    "cloud", file_id,
                );
            }
            Err(e) => {
                drop(file);
                finish_history(
                    app,
                    task_id,
                    "download",
                    &safe_name,
                    total,
                    "failed",
                    &tmp.to_string_lossy(),
                    "",
                    file_id,
                    "网络中断，可继续",
                    started,
                );
                return json!({ "success": false, "resumable": true, "message": format!("网络中断，可继续: {e}") });
            }
        }
    }
    if let Err(e) = file.flush() {
        drop(file);
        let _ = std::fs::remove_file(&tmp);
        return json!({ "success": false, "message": format!("文件保存失败: {e}") });
    }
    drop(file);
    if total > 0 && received != total {
        finish_history(
            app,
            task_id,
            "download",
            &safe_name,
            total,
            "failed",
            &tmp.to_string_lossy(),
            "",
            file_id,
            "文件下载不完整，可继续",
            started,
        );
        return json!({ "success": false, "resumable": true, "message": "文件下载不完整，可继续" });
    }
    let mut hash_file = match std::fs::File::open(&tmp) {
        Ok(file) => file,
        Err(e) => return json!({ "success": false, "message": e.to_string() }),
    };
    let mut hasher = Sha256::new();
    loop {
        match hash_file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(e) => return json!({ "success": false, "message": e.to_string() }),
        }
    }
    let actual_hash: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();
    if !expected_hash.is_empty() && expected_hash != actual_hash {
        let _ = std::fs::remove_file(&tmp);
        finish_history(
            app,
            task_id,
            "download",
            &safe_name,
            total,
            "failed",
            "",
            "",
            file_id,
            "文件完整性校验失败",
            started,
        );
        return json!({ "success": false, "message": "文件完整性校验失败" });
    }
    let target = available_target(&downloads, &safe_name);
    if std::fs::rename(&tmp, &target).is_err() {
        return json!({ "success": false, "message": "文件保存失败" });
    }
    finish_history(
        app,
        task_id,
        "download",
        &safe_name,
        total,
        "completed",
        &target.to_string_lossy(),
        "",
        file_id,
        "",
        started,
    );
    json!({ "success": true, "path": target.to_string_lossy(), "name": target.file_name().unwrap_or_default().to_string_lossy(), "size": received, "sha256": actual_hash })
}

fn download_file(app: &AppHandle, task_id: &str, file_id: &str, name: &str) -> Value {
    let Some(bind_id) = hub::bind_id() else {
        return json!({ "success": false, "message": "联动绑定尚未建立" });
    };
    let url = format!(
        "{}?action=download&bindId={}&side=desktop&fileId={}&deskToken={}",
        FILE_URL,
        percent_encode(&bind_id),
        percent_encode(file_id),
        percent_encode(&hub::desk_token())
    );
    download_from_url(app, task_id, &url, name, file_id, file_id)
}

// ---------- 命令入口 ----------

pub fn get_state() -> Value {
    match sync::get_bind_info() {
        Ok(binding) => {
            let mut result = with_binding("transfer.messages", json!({}));
            if let Some(obj) = result.as_object_mut() {
                obj.insert("bound".into(), json!(true));
                obj.insert("binding".into(), binding);
            }
            result
        }
        Err(_) => json!({ "success": false, "bound": false, "message": "联动绑定尚未建立" }),
    }
}

pub fn send_text(text: &str) -> Value {
    with_binding("transfer.sendText", json!({ "text": text }))
}

pub fn send_file(app: &AppHandle, task_id: &str, file_path: &str) -> Value {
    upload_file(app, task_id, file_path)
}

pub fn send_bytes(app: &AppHandle, task_id: &str, name: &str, encoded: &str) -> Value {
    let safe = safe_download_name(name, "粘贴图片.png");
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return json!({ "success": false, "message": "剪贴板图片读取失败" });
    };
    if bytes.is_empty() {
        return json!({ "success": false, "message": "剪贴板图片为空" });
    }
    let dir = config::config_dir()
        .join("transfer-temp")
        .join(safe_download_name(task_id, "task"));
    if std::fs::create_dir_all(&dir).is_err() {
        return json!({ "success": false, "message": "无法创建临时目录" });
    }
    let path = dir.join(safe);
    if let Err(e) = std::fs::write(&path, bytes) {
        return json!({ "success": false, "message": e.to_string() });
    }
    let result = upload_file(app, task_id, &path.to_string_lossy());
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_dir(dir);
    result
}

pub fn download(app: &AppHandle, task_id: &str, file_id: &str, name: &str) -> Value {
    download_file(app, task_id, file_id, name)
}

pub fn preview_url(file_id: &str) -> Value {
    let Some(bind_id) = hub::bind_id() else {
        return Value::Null;
    };
    json!(format!(
        "{}?action=preview&bindId={}&fileId={}&deskToken={}",
        FILE_URL,
        percent_encode(&bind_id),
        percent_encode(file_id),
        percent_encode(&hub::desk_token())
    ))
}

pub fn download_shared(
    app: &AppHandle,
    task_id: &str,
    token: &str,
    file_id: &str,
    name: &str,
) -> Value {
    if !token.starts_with("dl_") || token.len() != 51 {
        return json!({ "success": false, "message": "共享下载令牌无效" });
    }
    let url = format!(
        "{}?action=download&token={}",
        FILE_URL,
        percent_encode(token)
    );
    download_from_url(app, task_id, &url, name, "shared-file", file_id)
}

pub fn delete_message(message_id: &str) -> Value {
    with_binding("transfer.delete", json!({ "messageId": message_id }))
}

pub fn favorite(message_id: &str, favorite: bool) -> Value {
    with_binding(
        "transfer.favorite",
        json!({ "messageId": message_id, "favorite": favorite }),
    )
}

pub fn cancel(task_id: &str) -> Value {
    if task_id.trim().is_empty() {
        return json!({ "success": false, "message": "任务标识为空" });
    }
    if let Ok(mut set) = cancelled().lock() {
        set.insert(task_id.to_string());
    }
    json!({ "success": true, "taskId": task_id })
}

pub fn active_tasks() -> Value {
    let values = active_tasks_store()
        .lock()
        .map(|tasks| tasks.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    json!({ "success": true, "tasks": values })
}

pub fn history() -> Value {
    let _guard = history_lock().lock().ok();
    json!({ "success": true, "history": load_history_inner() })
}

pub fn history_remove(id: &str) -> Value {
    let Ok(_guard) = history_lock().lock() else {
        return json!({ "success": false, "message": "历史记录暂时不可用" });
    };
    let mut items = load_history_inner();
    if id == "clear" {
        items.clear();
    } else {
        items.retain(|row| row.id != id);
    }
    save_history_inner(&items);
    json!({ "success": true })
}

pub fn share_text(text: &str, code: &str, hours: i64) -> Value {
    with_binding(
        "transfer.share",
        json!({ "text": text, "code": code, "hours": hours }),
    )
}

pub fn share_file(message_id: &str, code: &str, hours: i64) -> Value {
    with_binding(
        "transfer.share",
        json!({ "messageId": message_id.trim_start_matches("msg_"), "code": code, "hours": hours }),
    )
}

pub fn share_list() -> Value {
    with_binding("transfer.shares", json!({}))
}

pub fn share_delete(id: &str) -> Value {
    with_binding("transfer.shareDelete", json!({ "id": id }))
}

pub fn claim(code: &str) -> Value {
    // 无需身份的动作走 hub 的公开通道（不再自带 request()）
    match hub::api_post_public("transfer.claim", json!({ "code": code })) {
        Ok(v) => v,
        Err(e) => hub::err_result(e),
    }
}

// 供 lib.rs 判断下载目录
pub fn downloads_dir() -> std::path::PathBuf {
    configured_download_dir()
}

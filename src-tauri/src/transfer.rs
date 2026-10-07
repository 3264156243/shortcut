//! M5 文件快传——对齐 electron/file-transfer.ts（sync/api.php + sync/file.php 分片上传/流式下载）

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::config;
use crate::hub;
use crate::sync;

const FILE_URL: &str = "https://shortcut.326415.xyz/sync/file.php";
const CHUNK_SIZE: usize = 2 * 1024 * 1024;

/// 手写 percent-encode（不引入新依赖）：仅保留 RFC 3986 unreserved 字符，其余按 UTF-8 字节转 %XX
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(*b as char),
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
fn upload_chunk(bind_id: &str, desk_token: &str, file_id: &str, index: usize, chunk_hash: &str, chunk: &[u8], name: &str) -> Result<Value, String> {
    let boundary = "----ShortcutBoundaryRust";
    let mut body: Vec<u8> = Vec::new();
    let mut add_field = |name: &str, value: &str| {
        body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n", boundary, name, value).as_bytes());
    };
    add_field("action", "uploadChunk");
    add_field("bindId", bind_id);
    add_field("side", "desktop");
    add_field("deskToken", desk_token);
    add_field("fileId", file_id);
    add_field("chunkIndex", &index.to_string());
    add_field("chunkHash", chunk_hash);
    body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"chunk\"; filename=\"{}.part\"\r\nContent-Type: application/octet-stream\r\n\r\n", boundary, name).as_bytes());
    body.extend_from_slice(chunk);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let resp = ureq::post(FILE_URL)
        .timeout(std::time::Duration::from_millis(30_000))
        .set("Content-Type", &format!("multipart/form-data; boundary={}", boundary))
        .send(&body[..])
        .map_err(|e| e.to_string())?;
    resp.into_json::<Value>().map_err(|_| "文件分片上传失败".to_string())
}

fn upload_file(file_path: &str) -> Value {
    // 身份统一从 hub 取（bind_id 内部有 60 秒缓存，不再每次重新解析绑定）
    let Some(bind_id) = hub::bind_id() else {
        return json!({ "success": false, "message": "联动绑定尚未建立" });
    };
    let path = std::path::Path::new(file_path);
    let stat = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return json!({ "success": false, "message": "文件不存在" }),
    };
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".to_string());
    let size = stat.len() as usize;
    let init = with_binding(
        "transfer.fileInit",
        json!({ "name": name, "size": size, "mime": "application/octet-stream", "chunkSize": CHUNK_SIZE }),
    );
    if !init.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        return init;
    }
    let Some(file_obj) = init.get("file").cloned() else {
        return json!({ "success": false, "message": "文件初始化失败" });
    };
    let file_id = file_obj.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // chunkCount 取不到或为 0 = 初始化失败，绝不能让"零分片"走到 fileComplete 报成功
    let chunk_count = match file_obj.get("chunkCount").and_then(|v| v.as_i64()) {
        Some(n) if n > 0 => n as usize,
        _ => return json!({ "success": false, "message": "文件初始化失败" }),
    };
    let desk_token = hub::desk_token();

    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(e) => return json!({ "success": false, "message": e.to_string() }),
    };
    for index in 0..chunk_count {
        let start = index * CHUNK_SIZE;
        let end = std::cmp::min(start + CHUNK_SIZE, size);
        if start >= size {
            break;
        }
        let chunk = &data[start..end];
        let mut hasher = Sha256::new();
        hasher.update(chunk);
        let chunk_hash: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
        let result = match upload_chunk(&bind_id, &desk_token, &file_id, index, &chunk_hash, chunk, &name) {
            Ok(v) => v,
            Err(e) => return json!({ "success": false, "message": e }),
        };
        if !result.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
            return result;
        }
    }
    with_binding("transfer.fileComplete", json!({ "fileId": file_id }))
}

fn download_file(file_id: &str, name: &str) -> Value {
    // file.php 不是 api.php：HTTP 方式（GET + 查询串）保持原样，只把"从哪拿身份"换成 hub
    let Some(bind_id) = hub::bind_id() else {
        return json!({ "success": false, "message": "联动绑定尚未建立" });
    };
    // 查询串参数一律 percent-encode（bindId/fileId/deskToken 都不允许裸拼）
    let url = format!(
        "{}?action=download&bindId={}&side=desktop&fileId={}&deskToken={}",
        FILE_URL,
        percent_encode(&bind_id),
        percent_encode(file_id),
        percent_encode(&hub::desk_token())
    );
    let resp = match ureq::get(&url).timeout(std::time::Duration::from_millis(60_000)).call() {
        Ok(r) => r,
        Err(e) => return json!({ "success": false, "message": e.to_string() }),
    };
    let total: usize = resp
        .header("Content-Length")
        .and_then(|h| h.parse().ok())
        .unwrap_or(0);
    // 目标文件名安全化
    let base_name = if !name.is_empty() { name } else if !file_id.is_empty() { file_id } else { "download" };
    let safe_name: String = base_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')') { c } else { '_' })
        .collect::<String>()
        .trim()
        .to_string();
    let safe_name = if safe_name.is_empty() { "download".to_string() } else { safe_name };
    let downloads = std::env::var("USERPROFILE").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_else(|_| std::env::temp_dir());
    let target = downloads.join(&safe_name);
    let tmp = std::env::temp_dir().join(format!("download-{}-sc.part", chrono::Local::now().timestamp_millis()));

    let mut reader = resp.into_reader();
    let mut file = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(e) => return json!({ "success": false, "message": e.to_string() }),
    };
    use std::io::Read as _;
    let mut received = 0usize;
    let mut buf = [0u8; 65536];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                use std::io::Write as _;
                if file.write_all(&buf[..n]).is_err() {
                    let _ = std::fs::remove_file(&tmp);
                    return json!({ "success": false, "message": "文件保存失败" });
                }
                received += n;
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return json!({ "success": false, "message": e.to_string() });
            }
        }
    }
    drop(file);
    if total > 0 && received != total {
        let _ = std::fs::remove_file(&tmp);
        return json!({ "success": false, "message": "文件下载不完整" });
    }
    if std::fs::rename(&tmp, &target).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return json!({ "success": false, "message": "文件保存失败" });
    }
    json!({ "success": true, "path": target.to_string_lossy(), "size": received })
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

pub fn send_file(file_path: &str) -> Value {
    upload_file(file_path)
}

pub fn download(file_id: &str, name: &str) -> Value {
    download_file(file_id, name)
}

pub fn delete_message(message_id: &str) -> Value {
    with_binding("transfer.delete", json!({ "messageId": message_id }))
}

pub fn share_text(text: &str, code: &str, hours: i64) -> Value {
    with_binding("transfer.share", json!({ "text": text, "code": code, "hours": hours }))
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
    config::user_data_dir()
}

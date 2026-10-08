//! 移动互联统一枢纽（hub）——桌面端访问 `/sync/api.php` 的**唯一入口**。
//!
//! 收敛三件此前被各模块各自实现的事（审计 D9 / D8）：
//! 1. **身份**：绑定解析只走 `sync::get_bind_info()`（自带 60 秒缓存），调用方不再各自解析；
//! 2. **请求**：自动注入 `bindId + deskToken + side=desktop`，统一超时与**带真实原因**的错误文案；
//! 3. **模块注册表**：本地声明 + 服务端 `module.list` 清单（60 秒缓存，只缓存成功结果）。
//!
//! 绑定实现本身仍留在 `sync.rs`（bind.create / bind.info / bind.claimToken / 凭证落盘），
//! hub 只做"对外唯一门面"，不重复造 HTTP 客户端、不重复落盘。
//!
//! 桌面端对 `api.php` 只有**两个**出口（审计 D8 收敛完成）：
//! - [`api_post`]：带身份（bindId + deskToken + side=desktop）；未绑定直接返回失败；
//! - [`api_post_raw`]：**不带身份**、不解析身份，调用方自己组织完整 body（bind.* 等自证动作走它）。

use serde_json::{json, Value};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::sync;

/// api.php 请求超时由 `sync::api_post` 统一设定（15 秒，与原 transfer.rs 一致）。
/// 该函数是**唯一**的 ureq 出口，`hub::api_post` / `hub::api_post_raw` 都经它发请求。
/// 服务端模块清单缓存 TTL：启动会打一次，之后 60 秒内不重复
const MODULE_CACHE_TTL: Duration = Duration::from_secs(60);
/// 本地声明的模块（lib.rs 启动时 register_module 注册）
static LOCAL_MODULES: OnceLock<Mutex<Vec<Value>>> = OnceLock::new();
/// 服务端 module.list 成功结果缓存（失败不写缓存）
static SERVER_MODULES: OnceLock<Mutex<Option<(Instant, Value)>>> = OnceLock::new();

/// 声明式默认清单（版本对齐演示）：注册表为空时作为兜底，避免任何入口都答"空模块表"。
/// lib.rs 启动注册的是同一批 id，因此正常运行时这里不会被用到。
const DEFAULT_MODULES: [(&str, &str, &[&str]); 4] = [
    ("taskwall", "任务墙", &["pull", "publish", "ack"]),
    ("fileTransfer", "文件快传", &["send", "download", "share", "claim"]),
    ("control", "云控制", &["realtime", "inject", "clipboard"]),
    ("desktop", "桌面指令", &["rpc"]),
];

/// 取得本地模块存储（**只做一次初始化**，不在锁内回调任何可能再次取锁的函数）；
/// 初始化时填入声明式默认清单，避免启动前（或注册失败时）答"空模块表"。
fn local_modules_store() -> &'static Mutex<Vec<Value>> {
    LOCAL_MODULES.get_or_init(|| {
        Mutex::new(
            DEFAULT_MODULES
                .iter()
                .map(|(id, label, caps)| module_entry(id, label, caps))
                .collect(),
        )
    })
}

/// 读取本地模块清单的**唯一**出口（空表时补回默认清单，逻辑在锁内一次完成）
fn local_modules_snapshot() -> Vec<Value> {
    match local_modules_store().lock() {
        Ok(mut guard) => {
            if guard.is_empty() {
                for (id, label, caps) in DEFAULT_MODULES.iter() {
                    guard.push(module_entry(id, label, caps));
                }
            }
            guard.clone()
        }
        Err(_) => DEFAULT_MODULES
            .iter()
            .map(|(id, label, caps)| module_entry(id, label, caps))
            .collect(),
    }
}

fn module_entry(id: &str, label: &str, capabilities: &[&str]) -> Value {
    json!({
        "id": id,
        "label": label,
        "capabilities": capabilities,
        "side": "desktop",
    })
}

fn server_modules_cache() -> &'static Mutex<Option<(Instant, Value)>> {
    SERVER_MODULES.get_or_init(|| Mutex::new(None))
}

// ────────────────────────────── 身份 ──────────────────────────────

/// 桌面端凭证（deskToken）——薄封装，实际实现与落盘仍在 sync.rs
pub fn desk_token() -> String {
    sync::desk_token()
}

/// 取当前 bindId：内部走 `sync::get_bind_info()`（60 秒缓存），**不会**每次调用都发网络请求。
/// 未绑定 / 绑定服务不可用时返回 None。
pub fn bind_id() -> Option<String> {
    match sync::get_bind_info() {
        Ok(info) => info
            .get("bindId")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        Err(_) => None,
    }
}

/// 凭证引导：委托 `sync::ensure_desk_token()`（本地已有直接返回，否则 bind.claimToken 换取并落盘）。
/// 失败只记日志并返回 None（兼容期内旧绑定仍可用免凭证通道）。
pub fn ensure_ready() -> Option<String> {
    let token = sync::ensure_desk_token();
    match &token {
        Some(_) => log::info!("[hub] 身份就绪（deskToken 可用）"),
        None => log::warn!("[hub] 身份未就绪（无 deskToken，继续走兼容通道）"),
    }
    token
}

/// 身份摘要，供日志 / 前端 `hubStatus` 使用：
/// `{ bound, bindId, deskTokenValid, source }`
/// source: bind.info（有效绑定）/ local（本地绑定未校验）/ none（未绑定）
pub fn identity_summary() -> Value {
    let token = desk_token();
    match sync::get_bind_info() {
        Ok(info) => {
            let bind = info.get("bindId").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if bind.is_empty() {
                return json!({ "bound": false, "bindId": "", "deskTokenValid": false, "source": "none" });
            }
            let valid = info.get("deskTokenValid").and_then(|v| v.as_bool()).unwrap_or(false) || !token.is_empty();
            json!({
                "bound": true,
                "bindId": bind,
                // 凭证存在即算可用（服务端 deskTokenValid 字段在兼容期可能缺失）
                "deskTokenValid": valid,
                "source": "bind.info",
            })
        }
        Err(_) => {
            // 绑定服务不可用：不假装未绑定——本地有 bindId 就照实报 bound + source=local
            match sync::get_stored_bind_id() {
                Some(id) if !id.is_empty() => json!({
                    "bound": true,
                    "bindId": id,
                    "deskTokenValid": !token.is_empty(),
                    "source": "local",
                }),
                _ => json!({ "bound": false, "bindId": "", "deskTokenValid": false, "source": "none" }),
            }
        }
    }
}

// ────────────────────────────── 请求 ──────────────────────────────

/// 向 `/sync/api.php` 发一个动作。自动带上 `bindId + deskToken + side=desktop`，调用方不用再关心拼装。
/// 未建立绑定时返回 `{ success:false, message:"联动绑定尚未建立" }`（与 transfer.rs 原语义一致）。
pub fn api_post(action: &str, payload: Value) -> Result<Value, String> {
    let bind_id = match bind_id() {
        Some(id) => id,
        None => return Ok(json!({ "success": false, "message": "联动绑定尚未建立" })),
    };
    api_post_with_bind(action, payload, &bind_id, true)
}

/// 同 api_post，但允许不带身份（例如 `module.list` 这类公开目录）。
/// 只附带**本地已存在**的 bindId（纯读 config，不发 bind.info、也不会顺手新建绑定），
/// 因此公开动作不会像 api_post 那样触发身份解析——避免"查一次公开目录打一次绑定查询"。
pub fn api_post_public(action: &str, payload: Value) -> Result<Value, String> {
    let bind_id = sync::get_stored_bind_id().unwrap_or_default();
    api_post_with_bind(action, payload, &bind_id, false)
}

/// 第二个（也是最后一个）api.php 出口：**不解析身份、不注入 bindId/deskToken**，
/// 只负责"发一个 JSON 到 api.php 并解析响应"——超时与错误文案与 [`api_post`] 完全一致
/// （两者共用 `sync::api_post` 这一层 HTTP 实现，因此不存在第二份 ureq 客户端）。
///
/// 适用：`bind.create` / `bind.info` / `bind.claimToken` / `bind.boards.update` 这类
/// **自证身份**的动作（身份就在 body 里），以及需要自己拼板的 `pull` / `ack`。
/// 注意：本函数**不得**调用 `bind_id()` / `get_bind_info()`，否则会与绑定解析形成递归。
pub fn api_post_raw(action: &str, payload: Value) -> Result<Value, String> {
    let mut body = payload;
    if !body.is_object() {
        body = json!({});
    }
    if let Some(obj) = body.as_object_mut() {
        obj.insert("action".into(), json!(action));
    }
    match sync::api_post(body) {
        Ok(v) => Ok(v),
        Err(e) => {
            log::warn!("[hub] {} 请求失败: {}", action, e);
            Err(e)
        }
    }
}

/// 真正发请求：统一注入 action / bindId / side / deskToken，统一超时与错误文案。
/// `with_auth=true` 时 bindId 必非空——由 api_post 前置检查保证。
fn api_post_with_bind(action: &str, payload: Value, bind_id: &str, with_auth: bool) -> Result<Value, String> {
    let mut body = payload;
    if !body.is_object() {
        body = json!({});
    }
    if with_auth {
        if let Some(obj) = body.as_object_mut() {
            obj.insert("bindId".into(), json!(bind_id));
            obj.insert("side".into(), json!("desktop"));
            obj.insert("deskToken".into(), json!(desk_token()));
        }
    }
    api_post_raw(action, body)
}

/// 把 hub 错误转成 transfer.rs 风格的结果对象（调用方需要 `{success,message}` 时用）
pub fn err_result(e: String) -> Value {
    json!({ "success": false, "message": e })
}

// ────────────────────────── 模块注册表 ──────────────────────────

/// 注册一个本地模块声明（幂等：同 id 幂等覆盖）。lib.rs 启动时调用。
pub fn register_module(id: &str, label: &str, capabilities: &[&str]) {
    let entry = module_entry(id, label, capabilities);
    if let Ok(mut guard) = local_modules_store().lock() {
        if let Some(slot) = guard.iter_mut().find(|m| m.get("id").and_then(|v| v.as_str()) == Some(id)) {
            *slot = entry;
        } else {
            guard.push(entry);
        }
    }
}

/// 本地声明的模块清单（纯本地，无网络）
pub fn local_modules() -> Vec<Value> {
    local_modules_snapshot()
}

/// 服务端模块清单：调 `module.list`（公开目录，不带身份），成功结果缓存 60 秒。
/// 失败时返回 `{ success:false, message, modules: local_modules() }`，绝不缓存失败结果。
pub fn server_modules() -> Value {
    if let Ok(guard) = server_modules_cache().lock() {
        if let Some((at, cached)) = guard.as_ref() {
            if at.elapsed() < MODULE_CACHE_TTL {
                return cached.clone();
            }
        }
    }
    match api_post_public("module.list", json!({})) {
        Ok(data) if data.get("success").and_then(|v| v.as_bool()).unwrap_or(false) => {
            if let Ok(mut guard) = server_modules_cache().lock() {
                *guard = Some((Instant::now(), data.clone()));
            }
            data
        }
        Ok(data) => {
            // 服务端明确回错：带上它的 message，回退本地清单
            let msg = data
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("服务端未返回模块清单")
                .to_string();
            log::warn!("[hub] module.list 未成功: {}", msg);
            json!({ "success": false, "message": msg, "modules": local_modules_snapshot() })
        }
        Err(e) => {
            log::warn!("[hub] module.list 失败: {}", e);
            json!({ "success": false, "message": e, "modules": local_modules_snapshot() })
        }
    }
}

/// `{ source: "server"|"local", modules: [...] }`——供日志与前端 `hubStatus` 使用
pub fn modules_summary() -> Value {
    let data = server_modules();
    let server_ok = data.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    let listed: Vec<Value> = data
        .get("modules")
        .and_then(|v| v.as_array())
        .map(|a| a.to_vec())
        .unwrap_or_default();
    // 服务端成功但清单为空 = 没有可用目录，回退本地声明（否则前端会显示空模块表）
    if server_ok && !listed.is_empty() {
        return json!({ "source": "server", "count": listed.len(), "modules": listed });
    }
    // 本地回退：统一经 local_modules() 对外暴露（避免绕过公开入口的旁路）
    let local = local_modules();
    json!({ "source": "local", "count": local.len(), "modules": local })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_module_is_idempotent() {
        register_module("test_mod", "测试模块", &["a", "b"]);
        register_module("test_mod", "测试模块2", &["c"]);
        let list = local_modules();
        let hits: Vec<&Value> = list.iter().filter(|m| m.get("id").and_then(|v| v.as_str()) == Some("test_mod")).collect();
        assert_eq!(hits.len(), 1, "同 id 应幂等覆盖而不是重复追加");
        assert_eq!(hits[0].get("label").and_then(|v| v.as_str()), Some("测试模块2"));
        assert_eq!(hits[0].get("capabilities").and_then(|v| v.as_array()).map(|a| a.len()), Some(1));
    }

    // 注意：modules_summary() 会打真实网络（module.list），因此**不加**单测，
    // 避免 `cargo test --all-targets` 触发外部请求。
}

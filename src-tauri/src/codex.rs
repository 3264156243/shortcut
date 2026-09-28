//! M5 Codex 供应商预设——对齐 electron/main.ts codex 系列函数（~550 行）
//! 存储：%APPDATA%/ShortCut/shortcut/codex-presets.json + ~/.codex/shortcut-presets/<id>/ 快照 + backup-shortcut/ 备份

use rand::Rng;
use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const CODEX_BACKUP_DIRNAME: &str = "backup-shortcut";

fn codex_default_model() -> Value {
    json!({
        "prefer_websockets": false,
        "support_verbosity": true,
        "default_verbosity": "low",
        "apply_patch_tool_type": "freeform",
        "web_search_tool_type": "text",
        "input_modalities": ["text"],
        "supports_image_detail_original": false,
        "truncation_policy": { "mode": "tokens", "limit": 10000 },
        "supports_parallel_tool_calls": true,
        "use_responses_lite": false,
    })
}

pub fn codex_home_dir() -> PathBuf {
    std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        std::env::var("USERPROFILE").map(|h| PathBuf::from(h).join(".codex")).unwrap_or_else(|_| PathBuf::from(".codex"))
    })
}

fn preset_file() -> PathBuf {
    config_user_data_shortcut().join("codex-presets.json")
}

fn config_user_data_shortcut() -> PathBuf {
    crate::config::config_dir()
}

fn codex_config_path() -> PathBuf { codex_home_dir().join("config.toml") }
fn codex_auth_path() -> PathBuf { codex_home_dir().join("auth.json") }
fn codex_models_path() -> PathBuf { codex_home_dir().join("models.json") }
fn codex_backup_dir() -> PathBuf { codex_home_dir().join(CODEX_BACKUP_DIRNAME) }
fn codex_preset_dir(preset_id: &str) -> PathBuf { codex_home_dir().join("shortcut-presets").join(preset_id) }

fn read_text(p: &Path) -> Option<String> { std::fs::read_to_string(p).ok() }
fn write_text_atomic(p: &Path, text: &str) {
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = p.with_extension("tmp");
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, p);
    }
}

// ---------- 预设存储 ----------

fn load_store() -> Value {
    read_text(&preset_file())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(json!({}))
}

fn save_store(store: &Value) {
    write_text_atomic(&preset_file(), &serde_json::to_string_pretty(store).unwrap_or_default());
}

pub fn load_presets() -> Vec<Value> {
    load_store().get("presets").and_then(|v| v.as_array()).cloned().unwrap_or_default()
}

fn save_presets(presets: Vec<Value>) {
    let mut store = load_store();
    if let Some(obj) = store.as_object_mut() {
        obj.insert("presets".into(), json!(presets));
    }
    save_store(&store);
}

fn shared_provider_id() -> String {
    load_store().get("sharedProviderId").and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn set_shared_provider_id(id: &str) {
    let mut store = load_store();
    if let Some(obj) = store.as_object_mut() {
        obj.insert("sharedProviderId".into(), json!(id));
    }
    save_store(&store);
}

fn last_applied() -> (String, String) {
    let store = load_store();
    (
        store.get("lastAppliedPresetName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        store.get("lastAppliedPresetProviderId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    )
}

fn set_last_applied(name: &str, provider_id: &str) {
    let mut store = load_store();
    if let Some(obj) = store.as_object_mut() {
        obj.insert("lastAppliedPresetName".into(), json!(name));
        obj.insert("lastAppliedPresetProviderId".into(), json!(provider_id));
    }
    save_store(&store);
}

// ---------- live config 解析 ----------

/// 解析 live config.toml 的当前 provider（对齐 parseCurrentCodexProvider）
pub fn parse_current_provider() -> Option<Value> {
    let raw = read_text(&codex_config_path())?;
    let provider_re = Regex::new(r#"(?m)^model_provider\s*=\s*"([^"]+)""#).ok()?;
    let model_re = Regex::new(r#"(?m)^model\s*=\s*"([^"]+)""#).ok()?;
    let provider_id = provider_re.captures(&raw)?.get(1)?.as_str().to_string();
    let model = model_re.captures(&raw).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
    let section_header = format!("model_providers.{}", provider_id);
    let mut name = String::new();
    let mut base_url = String::new();
    let mut wire_api = String::new();
    let mut api_key = String::new();
    let mut in_section = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_section = trimmed[1..trimmed.len() - 1] == section_header;
            continue;
        }
        if !in_section {
            continue;
        }
        let kv = Regex::new(r#"^([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"$"#).ok()?;
        if let Some(c) = kv.captures(trimmed) {
            let key = c.get(1)?.as_str();
            let value = c.get(2)?.as_str();
            match key {
                "name" => name = value.to_string(),
                "base_url" => base_url = value.to_string(),
                "wire_api" => wire_api = value.to_string(),
                "experimental_bearer_token" => api_key = value.to_string(),
                _ => {}
            }
        }
    }
    if base_url.is_empty() {
        return None;
    }
    Some(json!({
        "providerId": provider_id,
        "model": model,
        "name": name,
        "baseUrl": base_url,
        "wireApi": if wire_api.is_empty() { "chat" } else { &wire_api },
        "apiKey": if api_key.is_empty() { Value::Null } else { json!(api_key) },
    }))
}

fn ensure_default_preset() {
    if !load_presets().is_empty() {
        return;
    }
    let Some(current) = parse_current_provider() else { return };
    let base_url = current.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("");
    let model = current.get("model").and_then(|v| v.as_str()).unwrap_or("");
    if base_url.is_empty() || model.is_empty() {
        return;
    }
    let provider_id = current.get("providerId").and_then(|v| v.as_str()).unwrap_or("");
    let name = current.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(provider_id);
    let now = chrono::Local::now().to_rfc3339();
    let preset = json!({
        "id": format!("default-{}", provider_id),
        "name": name,
        "providerId": provider_id,
        "baseUrl": base_url,
        "wireApi": current.get("wireApi").cloned().unwrap_or(json!("chat")),
        "model": model,
        "apiKey": current.get("apiKey").cloned().unwrap_or(Value::Null),
        "isDefault": true,
        "createdAt": now,
        "updatedAt": now,
    });
    let mut presets = load_presets();
    presets.push(preset.clone());
    save_presets(presets);
    if shared_provider_id().is_empty() {
        set_shared_provider_id(provider_id);
    }
    let backup_config = codex_backup_dir().join("config.toml");
    let backup_models = codex_backup_dir().join("models.json");
    let config_text = read_text(&backup_config).unwrap_or_else(|| read_text(&codex_config_path()).unwrap_or_default());
    let models_text = read_text(&backup_models).or_else(|| read_text(&codex_models_path()));
    write_preset_snapshot(&preset, &config_text, models_text.as_deref());
}

// ---------- TOML 文本操作 ----------

fn build_provider_section(preset: &Value) -> Vec<String> {
    let provider_id = preset.get("providerId").and_then(|v| v.as_str()).unwrap_or("");
    let display = preset.get("displayProviderId").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(provider_id);
    let base_url = preset.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("");
    let wire_api = preset.get("wireApi").and_then(|v| v.as_str()).unwrap_or("chat");
    let mut lines = vec![
        format!("[model_providers.{}]", provider_id),
        format!("name = \"{}\"", display),
        format!("base_url = \"{}\"", base_url),
        format!("wire_api = \"{}\"", wire_api),
    ];
    let api_key = preset.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
    if !api_key.is_empty() {
        lines.push(format!("experimental_bearer_token = \"{}\"", api_key));
    } else {
        lines.push("env_key = \"OPENAI_API_KEY\"".to_string());
    }
    lines
}

/// 对齐 applyPresetToToml：替换 model_provider/model/review_model/model_catalog_json + provider 节
fn apply_preset_to_toml(config_text: &str, preset: &Value, keep_provider_key: bool) -> String {
    let catalog_value = codex_models_path().to_string_lossy().replace('\\', "/");
    let provider_id = preset.get("providerId").and_then(|v| v.as_str()).unwrap_or("");
    let model = preset.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let target_section = format!("model_providers.{}", provider_id);
    let section_re = Regex::new(r"^\[([^\]]+)\]$").unwrap();
    let mut output: Vec<String> = Vec::new();
    let mut current_section = String::new();
    let mut skip_provider_section = false;
    let mut provider_section_replaced = false;
    let mut provider_key_replaced = false;
    let mut model_key_replaced = false;
    let mut review_key_replaced = false;
    let mut catalog_key_replaced = false;
    let mut provider_insert_index: isize = -1;

    for line in config_text.lines() {
        let trimmed = line.trim();
        if let Some(c) = section_re.captures(trimmed) {
            current_section = c.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            skip_provider_section = false;
            if provider_insert_index < 0 {
                provider_insert_index = output.len() as isize;
            }
            if current_section == target_section {
                output.extend(build_provider_section(preset));
                provider_section_replaced = true;
                skip_provider_section = true;
                continue;
            }
            output.push(line.to_string());
            continue;
        }
        if skip_provider_section {
            continue;
        }
        if current_section.is_empty() {
            if Regex::new(r"^model_provider\s*=").unwrap().is_match(trimmed) {
                if keep_provider_key {
                    output.push(line.to_string());
                } else if !provider_key_replaced {
                    output.push(format!("model_provider = \"{}\"", provider_id));
                    provider_key_replaced = true;
                }
                continue;
            }
            if Regex::new(r"^model\s*=").unwrap().is_match(trimmed) {
                if !model_key_replaced {
                    output.push(format!("model = \"{}\"", model));
                    model_key_replaced = true;
                }
                continue;
            }
            if Regex::new(r"^review_model\s*=").unwrap().is_match(trimmed) {
                if !review_key_replaced {
                    output.push(format!("review_model = \"{}\"", model));
                    review_key_replaced = true;
                }
                continue;
            }
            if Regex::new(r"^model_catalog_json\s*=").unwrap().is_match(trimmed) {
                if !catalog_key_replaced {
                    output.push(format!("model_catalog_json = \"{}\"", catalog_value));
                    catalog_key_replaced = true;
                }
                continue;
            }
            output.push(line.to_string());
            continue;
        }
        output.push(line.to_string());
    }

    let mut missing_top: Vec<String> = Vec::new();
    if !provider_key_replaced {
        missing_top.push(format!("model_provider = \"{}\"", provider_id));
    }
    if !model_key_replaced {
        missing_top.push(format!("model = \"{}\"", model));
    }
    if !catalog_key_replaced {
        missing_top.push(format!("model_catalog_json = \"{}\"", catalog_value));
    }
    if !missing_top.is_empty() {
        let mut all = missing_top;
        all.extend(output);
        output = all;
    }
    if !provider_section_replaced {
        let mut section_lines = vec![String::new()];
        section_lines.extend(build_provider_section(preset));
        if provider_insert_index >= 0 && (provider_insert_index as usize) <= output.len() {
            let mut all: Vec<String> = output[..provider_insert_index as usize].to_vec();
            all.extend(section_lines);
            all.extend(output[provider_insert_index as usize..].to_vec());
            output = all;
        } else {
            output.extend(section_lines);
        }
    }
    format!("{}\n", output.join("\n"))
}

/// 对齐 normalizeSnapshotConfig：快照 provider 节统一为 sharedProviderId
fn normalize_snapshot_config(config_text: &str, shared_provider_id: &str) -> String {
    let provider_re = Regex::new(r#"(?m)^model_provider\s*=\s*"([^"]+)""#).unwrap();
    let source_provider = provider_re.captures(config_text).and_then(|c| c.get(1)).map(|m| m.as_str()).unwrap_or("");
    if source_provider.is_empty() {
        return config_text.to_string();
    }
    let section_re = Regex::new(r"^\[([^\]]+)\]$").unwrap();
    let source_section = format!("model_providers.{}", source_provider);
    let shared_section = format!("model_providers.{}", shared_provider_id);
    let mut output: Vec<String> = Vec::new();
    let mut current_section = String::new();
    let mut skip_section = String::new();
    let mut provider_key_replaced = false;
    for line in config_text.lines() {
        let trimmed = line.trim();
        if let Some(c) = section_re.captures(trimmed) {
            current_section = c.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            if current_section == source_section {
                output.push(format!("[{}]", shared_section));
                skip_section = String::new();
                continue;
            }
            if source_provider != shared_provider_id && current_section == shared_section {
                skip_section = current_section.clone();
                continue;
            }
            skip_section = String::new();
            output.push(line.to_string());
            continue;
        }
        if !skip_section.is_empty() {
            continue;
        }
        if current_section.is_empty() {
            if Regex::new(r"^model_provider\s*=").unwrap().is_match(trimmed) {
                if !provider_key_replaced {
                    output.push(format!("model_provider = \"{}\"", shared_provider_id));
                    provider_key_replaced = true;
                }
                continue;
            }
            output.push(line.to_string());
            continue;
        }
        output.push(line.to_string());
    }
    if !provider_key_replaced {
        output.insert(0, format!("model_provider = \"{}\"", shared_provider_id));
    }
    format!("{}\n", output.join("\n"))
}

// ---------- 快照文件 ----------

fn write_preset_snapshot(preset: &Value, config_text: &str, models_text: Option<&str>) {
    let id = preset.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let dir = codex_preset_dir(id);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join("config.toml"), config_text);
    if let Some(m) = models_text {
        let _ = std::fs::write(dir.join("models.json"), m);
    }
}

fn write_preset_files(preset: &Value, config_text: &str, models_text: Option<&str>, auth_text: Option<&str>) {
    let id = preset.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let dir = codex_preset_dir(id);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join("config.toml"), config_text);
    if let Some(m) = models_text {
        let _ = std::fs::write(dir.join("models.json"), m);
    }
    if let Some(a) = auth_text {
        let _ = std::fs::write(dir.join("auth.json"), a);
    }
}

fn read_preset_snapshot(preset_id: &str) -> (String, Option<String>) {
    let dir = codex_preset_dir(preset_id);
    let config = read_text(&dir.join("config.toml")).unwrap_or_default();
    let models = read_text(&dir.join("models.json"));
    (config, models)
}

fn backup_codex_config() {
    let backup_dir = codex_backup_dir();
    let _ = std::fs::create_dir_all(&backup_dir);
    for name in ["config.toml", "models.json"] {
        let source = codex_home_dir().join(name);
        if source.exists() {
            let _ = std::fs::copy(&source, backup_dir.join(name));
        }
    }
    let _ = std::fs::write(backup_dir.join("manifest.txt"), format!("backup_at={}\n", chrono::Local::now().to_rfc3339()));
}

fn ensure_model_in_catalog(model_slug: &str) {
    let models_path = codex_models_path();
    let mut catalog: Value = read_text(&models_path)
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(json!({ "models": [] }));
    if !catalog.get("models").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) {
        catalog = json!({ "models": [] });
    }
    if let Some(models) = catalog.get_mut("models").and_then(|v| v.as_array_mut()) {
        if models.iter().any(|item| item.get("slug").and_then(|v| v.as_str()) == Some(model_slug)) {
            return;
        }
        let mut template = models.first().cloned().unwrap_or_else(codex_default_model);
        if let Some(obj) = template.as_object_mut() {
            obj.insert("slug".into(), json!(model_slug));
            if obj.get("name").map(|n| n.is_string()).unwrap_or(false) {
                obj.insert("name".into(), json!(model_slug));
            }
        }
        models.push(template);
    }
    write_text_atomic(&models_path, &serde_json::to_string_pretty(&catalog).unwrap_or_default());
}

fn normalize_codex_preset(data: &Value, existing: Option<&Value>) -> Value {
    let now = chrono::Local::now().to_rfc3339();
    let id = existing
        .and_then(|e| e.get("id").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .or_else(|| data.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| format!("{}-{:x}", chrono::Local::now().timestamp_millis(), rand::rng().random_range(0u64..0xffffffffff)));
    let provider_id: String = data
        .get("providerId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let wire_api = data.get("wireApi").and_then(|v| v.as_str()).unwrap_or("chat");
    json!({
        "id": id,
        "name": data.get("name").and_then(|v| v.as_str()).unwrap_or("").trim(),
        "providerId": provider_id,
        "baseUrl": data.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("").trim(),
        "wireApi": if ["chat", "responses", "anthropic"].contains(&wire_api) { wire_api } else { "chat" },
        "model": data.get("model").and_then(|v| v.as_str()).unwrap_or("").trim(),
        "apiKey": data.get("apiKey").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        "icon": existing.and_then(|e| e.get("icon")).cloned().filter(|v| !v.is_null()).or_else(|| data.get("icon").cloned().filter(|v| !v.is_null())),
        "createdAt": existing.and_then(|e| e.get("createdAt").and_then(|v| v.as_str())).unwrap_or(&now),
        "updatedAt": now,
    })
}

fn ensure_preset_snapshots() {
    let presets = load_presets();
    for preset in &presets {
        let id = preset.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let is_default = preset.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false) || id.starts_with("default-");
        let config_path = codex_preset_dir(&id).join("config.toml");
        if config_path.exists() {
            let auth_path = codex_preset_dir(&id).join("auth.json");
            if !auth_path.exists() {
                if let Some(auth) = read_text(&codex_auth_path()) {
                    let _ = std::fs::write(&auth_path, auth);
                }
            }
            let models_path = codex_preset_dir(&id).join("models.json");
            if !models_path.exists() {
                if let Some(models) = read_text(&codex_models_path()) {
                    let _ = std::fs::write(&models_path, models);
                }
            }
            let shared = shared_provider_id();
            if !shared.is_empty() {
                if let Some(config) = read_text(&config_path) {
                    let source_provider = Regex::new(r#"(?m)^model_provider\s*=\s*"([^"]+)""#)
                        .ok()
                        .and_then(|re| re.captures(&config))
                        .and_then(|c| c.get(1))
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default();
                    if !source_provider.is_empty() && source_provider != shared {
                        let _ = std::fs::write(&config_path, normalize_snapshot_config(&config, &shared));
                    }
                }
            }
        } else {
            // 缺快照：从模板重建
            let default_preset = presets.iter().find(|p| {
                p.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false)
                    || p.get("id").and_then(|v| v.as_str()).unwrap_or("").starts_with("default-")
            });
            let template = default_preset
                .and_then(|dp| dp.get("id").and_then(|v| v.as_str()))
                .map(|dp_id| read_preset_snapshot(dp_id))
                .filter(|(c, _)| !c.is_empty())
                .unwrap_or_else(|| (read_text(&codex_config_path()).unwrap_or_default(), read_text(&codex_models_path())));
            let snapshot = build_preset_snapshot(preset, &template.0, template.1.as_deref());
            write_preset_snapshot(preset, &snapshot.0, snapshot.1.as_deref());
        }
        let _ = is_default;
    }
}

fn build_preset_snapshot(preset: &Value, template_config: &str, template_models: Option<&str>) -> (String, Option<String>) {
    let current_provider = Regex::new(r#"(?m)^model_provider\s*=\s*"([^"]+)""#)
        .ok()
        .and_then(|re| re.captures(template_config))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let preset_provider = preset.get("providerId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut preset_for_toml = preset.clone();
    if let Some(obj) = preset_for_toml.as_object_mut() {
        match &current_provider {
            Some(cp) if !cp.is_empty() => {
                obj.insert("providerId".into(), json!(cp));
                obj.insert("displayProviderId".into(), json!(preset_provider));
                let config = apply_preset_to_toml(template_config, &preset_for_toml, true);
                return (config, build_models_with_slug(template_models, preset.get("model").and_then(|v| v.as_str()).unwrap_or("")));
            }
            _ => {}
        }
    }
    let config = apply_preset_to_toml(template_config, &preset_for_toml, current_provider.is_some());
    (config, build_models_with_slug(template_models, preset.get("model").and_then(|v| v.as_str()).unwrap_or("")))
}

fn build_models_with_slug(template_models: Option<&str>, slug: &str) -> Option<String> {
    match template_models {
        Some(models) => {
            match serde_json::from_str::<Value>(models) {
                Ok(mut catalog) => {
                    let exists = catalog.get("models").and_then(|v| v.as_array()).map(|a| a.iter().any(|item| item.get("slug").and_then(|v| v.as_str()) == Some(slug))).unwrap_or(false);
                    if !exists {
                        if let Some(models_arr) = catalog.get_mut("models").and_then(|v| v.as_array_mut()) {
                            let mut template = models_arr.first().cloned().unwrap_or_else(codex_default_model);
                            if let Some(obj) = template.as_object_mut() {
                                obj.insert("slug".into(), json!(slug));
                                if obj.get("name").map(|n| n.is_string()).unwrap_or(false) {
                                    obj.insert("name".into(), json!(slug));
                                }
                            }
                            models_arr.push(template);
                        }
                    }
                    Some(serde_json::to_string_pretty(&catalog).unwrap_or_default())
                }
                Err(_) => Some(serde_json::to_string_pretty(&json!({ "models": [{ "slug": slug, "name": slug }] })).unwrap_or_default()),
            }
        }
        None => Some(serde_json::to_string_pretty(&json!({ "models": [ObjectMerge::default_model(slug)] })).unwrap_or_default()),
    }
}

// 辅助：默认模型 + slug
struct ObjectMerge;

impl ObjectMerge {
    fn default_model(slug: &str) -> Value {
        let mut v = codex_default_model();
        if let Some(obj) = v.as_object_mut() {
            obj.insert("slug".into(), json!(slug));
            obj.insert("name".into(), json!(slug));
        }
        v
    }
}

// ---------- 状态与应用 ----------

pub fn read_current_state() -> Value {
    ensure_default_preset();
    ensure_preset_snapshots();
    let current = parse_current_provider();
    let (last_name, last_provider) = last_applied();
    let current_provider_id = current.as_ref().and_then(|c| c.get("providerId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let current_preset_name = if !last_name.is_empty() && last_provider == current_provider_id {
        last_name
    } else {
        current
            .as_ref()
            .and_then(|c| c.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string()))
            .unwrap_or(current_provider_id.clone())
    };
    json!({
        "presets": load_presets(),
        "currentPresetName": current_preset_name,
        "currentProvider": current_provider_id,
        "currentModel": current.as_ref().and_then(|c| c.get("model")).cloned().unwrap_or(json!("")),
        "currentBaseUrl": current.as_ref().and_then(|c| c.get("baseUrl")).cloned().unwrap_or(json!("")),
        "currentWireApi": current.as_ref().and_then(|c| c.get("wireApi")).cloned().unwrap_or(json!("chat")),
        "backupExists": codex_backup_dir().join("config.toml").exists(),
    })
}

pub fn apply_preset(preset_id: &str) -> Result<(), String> {
    let preset = load_presets().into_iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(preset_id));
    let Some(preset) = preset else { return Err("方案不存在".to_string()) };
    let id = preset.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let (config, models) = read_preset_snapshot(id);
    if config.is_empty() {
        return Err("方案配置文件缺失".to_string());
    }
    let auth = read_text(&codex_preset_dir(id).join("auth.json"));
    backup_codex_config();
    write_text_atomic(&codex_config_path(), &config);
    if let Some(a) = &auth {
        write_text_atomic(&codex_auth_path(), a);
    }
    match &models {
        Some(m) => write_text_atomic(&codex_models_path(), m),
        None => ensure_model_in_catalog(preset.get("model").and_then(|v| v.as_str()).unwrap_or("")),
    }
    let applied_provider = Regex::new(r#"(?m)^model_provider\s*=\s*"([^"]+)""#)
        .ok()
        .and_then(|re| re.captures(&config))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| preset.get("providerId").and_then(|v| v.as_str()).unwrap_or("").to_string());
    set_last_applied(preset.get("name").and_then(|v| v.as_str()).unwrap_or(""), &applied_provider);
    Ok(())
}

pub fn restore_config() -> Result<(), String> {
    let backup_config = codex_backup_dir().join("config.toml");
    if !backup_config.exists() {
        return Err("没有可还原的备份".to_string());
    }
    let text = read_text(&backup_config).ok_or("还原失败")?;
    write_text_atomic(&codex_config_path(), &text);
    let models_backup = codex_backup_dir().join("models.json");
    if models_backup.exists() {
        if let Some(m) = read_text(&models_backup) {
            write_text_atomic(&codex_models_path(), &m);
        }
    }
    Ok(())
}

// ---------- 保存/删除（对齐 codex:saveCurrentPreset/savePreset/deletePreset）----------

fn read_live_auth_text() -> Option<String> { read_text(&codex_auth_path()) }
fn read_live_models_text() -> Option<String> { read_text(&codex_models_path()) }

pub fn save_current_preset(data: &Value) -> Value {
    let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let existing_id = data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let Some(config_text) = read_text(&codex_config_path()) else {
        return json!({ "success": false, "error": "当前 Codex 配置不存在" });
    };
    let Some(current) = parse_current_provider() else {
        return json!({ "success": false, "error": "无法解析当前 Codex 配置" });
    };
    let mut presets = load_presets();
    let existing_idx = if !existing_id.is_empty() {
        presets.iter().position(|p| p.get("id").and_then(|v| v.as_str()) == Some(existing_id.as_str()))
    } else if !name.is_empty() {
        presets.iter().position(|p| p.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase()) == Some(name.to_lowercase()))
    } else {
        None
    };
    let (last_name, last_provider) = last_applied();
    let now = chrono::Local::now().to_rfc3339();
    let current_provider_id = current.get("providerId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let preset_id: String;
    let preset_name: String;
    let is_default: bool;
    match existing_idx {
        Some(idx) => {
            let old_name = presets[idx].get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if let Some(obj) = presets[idx].as_object_mut() {
                if !name.is_empty() {
                    obj.insert("name".into(), json!(name));
                }
                obj.insert("providerId".into(), json!(current_provider_id));
                obj.insert("baseUrl".into(), current.get("baseUrl").cloned().unwrap_or(json!("")));
                obj.insert("wireApi".into(), current.get("wireApi").cloned().unwrap_or(json!("chat")));
                obj.insert("model".into(), current.get("model").cloned().unwrap_or(json!("")));
                let new_key = current.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
                if !new_key.is_empty() {
                    obj.insert("apiKey".into(), json!(new_key));
                }
                obj.insert("updatedAt".into(), json!(now));
            }
            if last_name == old_name && last_provider == current_provider_id {
                let new_name = if name.is_empty() { old_name.clone() } else { name.clone() };
                set_last_applied(&new_name, &current_provider_id);
            }
            preset_id = presets[idx].get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            preset_name = presets[idx].get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            is_default = presets[idx].get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false) || preset_id.starts_with("default-");
        }
        None => {
            preset_id = format!("{}-{:x}", chrono::Local::now().timestamp_millis(), rand::rng().random_range(0u64..0xffffffffff));
            preset_name = if name.is_empty() {
                current.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(&current_provider_id).to_string()
            } else {
                name.clone()
            };
            is_default = false;
            presets.push(json!({
                "id": preset_id,
                "name": preset_name,
                "providerId": current_provider_id,
                "baseUrl": current.get("baseUrl").cloned().unwrap_or(json!("")),
                "wireApi": current.get("wireApi").cloned().unwrap_or(json!("chat")),
                "model": current.get("model").cloned().unwrap_or(json!("")),
                "apiKey": current.get("apiKey").cloned().unwrap_or(Value::Null),
                "createdAt": now,
                "updatedAt": now,
            }));
        }
    }
    let shared = if shared_provider_id().is_empty() {
        set_shared_provider_id(&current_provider_id);
        current_provider_id.clone()
    } else {
        shared_provider_id()
    };
    let preset_for_snapshot = json!({ "id": preset_id, "providerId": current_provider_id });
    let preset_config_text = if is_default {
        config_text.clone()
    } else {
        normalize_snapshot_config(&config_text, &shared)
    };
    write_preset_files(
        &preset_for_snapshot,
        &preset_config_text,
        read_live_models_text().as_deref(),
        read_live_auth_text().as_deref(),
    );
    save_presets(presets);
    let _ = preset_name;
    let mut out = json!({ "success": true });
    if let Some(obj) = out.as_object_mut() {
        obj.insert("state".into(), read_current_state());
    }
    out
}

pub fn save_preset(data: &Value) -> Value {
    let presets = load_presets();
    let existing = presets.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == data.get("id").and_then(|v| v.as_str()));
    let preset = normalize_codex_preset(data, existing);
    let name_ok = preset.get("name").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let provider_ok = preset.get("providerId").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let base_ok = preset.get("baseUrl").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let model_ok = preset.get("model").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    if !name_ok || !provider_ok || !base_ok || !model_ok {
        return json!({ "success": false, "error": "请填写名称、请求地址、供应商ID和模型名" });
    }
    let mut new_presets = presets.clone();
    match new_presets.iter().position(|p| p.get("id").and_then(|v| v.as_str()) == preset.get("id").and_then(|v| v.as_str())) {
        Some(idx) => new_presets[idx] = preset.clone(),
        None => new_presets.push(preset.clone()),
    }
    save_presets(new_presets.clone());
    let preset_id = preset.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let template = if codex_preset_dir(&preset_id).join("config.toml").exists() {
        read_preset_snapshot(&preset_id)
    } else {
        let default_preset = new_presets.iter().find(|p| {
            p.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false)
                || p.get("id").and_then(|v| v.as_str()).unwrap_or("").starts_with("default-")
        });
        match default_preset.and_then(|dp| dp.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())) {
            Some(dp_id) if codex_preset_dir(&dp_id).join("config.toml").exists() => read_preset_snapshot(&dp_id),
            _ => (read_text(&codex_config_path()).unwrap_or_default(), read_live_models_text()),
        }
    };
    let snapshot = build_preset_snapshot(&preset, &template.0, template.1.as_deref());
    write_preset_snapshot(&preset, &snapshot.0, snapshot.1.as_deref());
    let mut out = json!({ "success": true });
    if let Some(obj) = out.as_object_mut() {
        obj.insert("state".into(), read_current_state());
    }
    out
}

pub fn delete_preset(id: &str) -> Value {
    let presets: Vec<Value> = load_presets().into_iter().filter(|p| p.get("id").and_then(|v| v.as_str()) != Some(id)).collect();
    save_presets(presets);
    let dir = codex_preset_dir(id);
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    let mut out = json!({ "success": true });
    if let Some(obj) = out.as_object_mut() {
        obj.insert("state".into(), read_current_state());
    }
    out
}
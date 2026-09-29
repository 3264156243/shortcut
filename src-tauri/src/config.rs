//! 配置读写——与 Electron 版语义完全一致（D-2 数据硬兼容）
//! 路径：%APPDATA%\ShortCut\shortcut\config.json
//! 写入：临时文件 + rename 原子写；写前按健康检查备份，保留最近 3 份；启动时损坏自动从备份恢复。

use std::fs;
use std::path::PathBuf;

pub const BACKUP_KEEP_COUNT: usize = 3;

/// 硬兼容 Electron 的 userData 路径：%APPDATA%\ShortCut
pub fn user_data_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| String::from("."));
    PathBuf::from(appdata).join("ShortCut")
}

pub fn config_dir() -> PathBuf {
    user_data_dir().join("shortcut")
}

pub fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

pub fn icons_dir() -> PathBuf {
    config_dir().join("icons")
}

pub fn usage_file() -> PathBuf {
    user_data_dir().join("usage-record.json")
}

pub fn ensure_dirs() {
    let _ = fs::create_dir_all(config_dir());
    let _ = fs::create_dir_all(icons_dir());
}

/// 与 Electron isHealthyConfigObject 一致：object 且 tabs/taskBoards 都是数组
fn is_healthy_config_object(v: &serde_json::Value) -> bool {
    v.is_object()
        && v.get("tabs").map(|t| t.is_array()).unwrap_or(false)
        && v.get("taskBoards").map(|t| t.is_array()).unwrap_or(false)
}

pub fn read_config() -> String {
    ensure_dirs();
    let f = config_file();
    if !f.exists() {
        return String::new();
    }
    // Windows 上多进程（Tauri/Electron 同时跑）可能瞬时锁冲突：重试 3 次
    for attempt in 0..3 {
        match fs::read_to_string(&f) {
            Ok(text) => return text,
            Err(_) if attempt < 2 => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => return String::new(),
        }
    }
    String::new()
}

/// 读配置并解析；**parse 失败返回 None**（调用方必须中止 read-modify-write，绝不能用空对象当基准写回）
pub fn read_config_value() -> Option<serde_json::Value> {
    let raw = read_config();
    if raw.is_empty() {
        return Some(serde_json::json!({}));
    }
    serde_json::from_str(&raw).ok()
}

/// 备份名：config.backup-YYYYMMDDHHMMSS.json（与 Electron 正则 ^config\.backup-\d{14}\.json$ 兼容）
fn backup_config() {
    let _ = (|| -> Result<(), Box<dyn std::error::Error>> {
        let f = config_file();
        if !f.exists() {
            return Ok(());
        }
        let current = fs::read_to_string(&f)?;
        let parsed: serde_json::Value = match serde_json::from_str(&current) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        };
        if !is_healthy_config_object(&parsed) {
            return Ok(());
        }
        let stamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
        let backup = config_dir().join(format!("config.backup-{}.json", stamp));
        if backup.exists() {
            return Ok(());
        }
        fs::copy(&f, &backup)?;
        // 清理：按名倒序，保留最近 BACKUP_KEEP_COUNT 份
        let mut backups: Vec<_> = fs::read_dir(config_dir())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| {
                n.starts_with("config.backup-")
                    && n.ends_with(".json")
                    && n.len() == "config.backup-14digits.json".len()
            })
            .collect();
        backups.sort();
        backups.reverse();
        for name in backups.iter().skip(BACKUP_KEEP_COUNT) {
            let _ = fs::remove_file(config_dir().join(name));
        }
        Ok(())
    })();
}

/// 启动时：当前配置不健康则从最新健康备份恢复（与 Electron restoreFromBackupIfNeeded 一致）
pub fn restore_from_backup_if_needed() {
    let _ = (|| -> Result<(), Box<dyn std::error::Error>> {
        ensure_dirs();
        let f = config_file();
        if !f.exists() {
            return Ok(());
        }
        let cfg: serde_json::Value = serde_json::from_str(&fs::read_to_string(&f)?)?;
        if is_healthy_config_object(&cfg) {
            return Ok(());
        }
        let mut backups: Vec<_> = fs::read_dir(config_dir())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| {
                n.starts_with("config.backup-")
                    && n.ends_with(".json")
                    && n.len() == "config.backup-14digits.json".len()
            })
            .collect();
        backups.sort();
        backups.reverse();
        for name in backups {
            let p = config_dir().join(&name);
            if let Ok(text) = fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if is_healthy_config_object(&v) {
                        fs::copy(&p, &f)?;
                        log::info!("[config] 已从备份恢复: {}", name);
                        return Ok(());
                    }
                }
            }
        }
        Ok(())
    })();
}

pub fn write_config(data: &str) {
    ensure_dirs();
    // 防缩水保险：现有配置健康且含数据，而新数据把核心数组弄丢/清空 → 拒绝写入
    let f = config_file();
    if f.exists() {
        if let (Ok(old), Ok(new)) = (
            serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&f).unwrap_or_default()),
            serde_json::from_str::<serde_json::Value>(data),
        ) {
            let old_has_data = array_len(&old, "taskBoards") > 0
                || array_len(&old, "tabs") > 0
                || array_len(&old, "scTaskList") > 0;
            let new_lost_data = old_has_data
                && array_len(&new, "taskBoards") == 0
                && array_len(&new, "tabs") == 0
                && array_len(&new, "scTaskList") == 0;
            if new_lost_data {
                log::warn!("[config] 拒绝缩水写入：新配置丢失全部 tabs/taskBoards/scTaskList 数据（原 {} 字节 → 新 {} 字节）", old.to_string().len(), data.len());
                return;
            }
        }
    }
    backup_config();
    // 临时文件 + rename 原子写（崩溃安全，与 Electron 一致）
    let tmp = config_file().with_extension("json.tmp");
    if fs::write(&tmp, data).is_ok() {
        let _ = fs::rename(&tmp, config_file());
    }
}

fn array_len(v: &serde_json::Value, key: &str) -> usize {
    v.get(key).and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0)
}

/// M5：岛驾驶舱开关（config.island.cockpitEnabled，默认 false）
pub fn read_config_island_cockpit_enabled() -> bool {
    let raw = read_config();
    let cfg: serde_json::Value = if raw.is_empty() { serde_json::json!({}) } else { serde_json::from_str(&raw).unwrap_or(serde_json::json!({})) };
    cfg.get("island").and_then(|i| i.get("cockpitEnabled")).and_then(|v| v.as_bool()).unwrap_or(false)
}
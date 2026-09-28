//! 使用统计数据层——usage-record.json 读写（结构照抄 Electron，含剥离 legacy icon 字段的语义）
//! 采集器（usage-monitor 快照）接入在 M5；本模块先支撑统计板块的配置与历史数据命令。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UsageRecord {
    pub enabled: bool,
    pub ignored: Vec<String>,
    pub background_apps: Vec<String>,
    pub days: BTreeMap<String, Value>,
}

impl UsageRecord {
    pub fn load() -> Self {
        let file = super::config::usage_file();
        if let Ok(raw) = fs::read_to_string(&file) {
            if let Ok(mut parsed) = serde_json::from_str::<UsageRecord>(&raw) {
                // 剥离 legacy icon 字段（与 Electron loadUsageRecord 一致）
                for day in parsed.days.values_mut() {
                    if let Some(apps) = day.get_mut("apps").and_then(|a| a.as_array_mut()) {
                        for app in apps.iter_mut() {
                            if let Some(obj) = app.as_object_mut() {
                                obj.remove("icon");
                            }
                        }
                    }
                }
                return parsed;
            }
        }
        UsageRecord {
            enabled: true,
            ignored: vec![],
            background_apps: vec![],
            days: BTreeMap::new(),
        }
    }

    pub fn save(&self) {
        let file = super::config::usage_file();
        if let Some(parent) = file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(self) {
            let tmp = file.with_extension("json.tmp");
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, &file);
            }
        }
    }
}

fn today_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn empty_day(date: &str) -> Value {
    let hourly = vec![0.0f64; 24];
    serde_json::json!({ "date": date, "apps": [], "sites": [], "hourly": hourly })
}

/// 与 Electron getUsageDataPayload 对齐（current 依赖采集器，M5 接入前恒 null）
pub fn payload(record: &UsageRecord, date_key: Option<&str>) -> Value {
    let key = date_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(today_key);
    let day = record.days.get(&key).cloned().unwrap_or_else(|| empty_day(&key));
    serde_json::json!({
        "enabled": record.enabled,
        "ignored": record.ignored,
        "backgroundApps": record.background_apps,
        "day": day,
        "current": null,
    })
}

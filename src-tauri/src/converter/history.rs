//! 转换历史——converter-history.json 独立存储（上限 200 条滚动淘汰）
//! 与 config.json 解耦，避免配置文件膨胀。

use crate::config;
use serde::{Deserialize, Serialize};
use std::fs;

pub const HISTORY_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    /// ISO 时间
    pub time: String,
    /// convert | extract | compress
    pub action: String,
    pub src: String,
    /// 成功输出路径/目录；失败为空
    #[serde(default)]
    pub out: String,
    /// ok | fail
    pub status: String,
    #[serde(default)]
    pub note: String,
}

pub fn load() -> Vec<HistoryItem> {
    let file = config::converter_history_file();
    let Ok(text) = fs::read_to_string(&file) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_else(|_| Vec::new())
}

fn save(items: &[HistoryItem]) {
    let file = config::converter_history_file();
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(items) {
        let _ = fs::write(&file, json);
    }
}

pub fn push(item: HistoryItem) {
    let mut items = load();
    items.insert(0, item);
    if items.len() > HISTORY_LIMIT {
        items.truncate(HISTORY_LIMIT);
    }
    save(&items);
}

pub fn remove(id: &str) {
    let mut items = load();
    items.retain(|it| it.id != id);
    save(&items);
}

pub fn clear() {
    save(&[]);
}

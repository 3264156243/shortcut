//! 文件类型探测——按扩展名分类（拖放/右键场景扩展名可靠；魔数增强留作后续）
//! 计划文档：docs/文件转换板块开发计划.md §6.1

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Image,
    Audio,
    Archive,
    Other,
}

/// 图片：输入格式（解码）
pub const IMAGE_INPUT_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "ico"];
/// 图片：输出格式（编码）
pub const IMAGE_TARGET_EXTS: &[&str] = &["png", "jpg", "webp", "bmp", "gif", "tiff", "ico"];
/// 压缩包：可解压
pub const ARCHIVE_EXTS: &[&str] = &[
    "zip", "tar", "gz", "tgz", "bz2", "tbz", "xz", "txz", "zst", "tzst",
];
/// 音频：可解码输入（symphonia 覆盖；.opus/.wma 无解码器 → 识别但 targets 空）
pub const AUDIO_INPUT_EXTS: &[&str] = &["wav", "mp3", "flac", "ogg", "m4a", "aac", "opus", "wma"];
/// 音频：可编码输出
pub const AUDIO_TARGET_EXTS: &[&str] = &["wav", "mp3", "flac", "opus"];

pub fn normalize_ext(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn kind_of(path: &Path) -> FileKind {
    let ext = normalize_ext(path);
    if IMAGE_INPUT_EXTS.contains(&ext.as_str()) {
        FileKind::Image
    } else if ARCHIVE_EXTS.contains(&ext.as_str()) {
        FileKind::Archive
    } else if AUDIO_INPUT_EXTS.contains(&ext.as_str()) {
        FileKind::Audio
    } else {
        FileKind::Other
    }
}

/// .tar.gz / .tgz 双后缀归一：返回压缩体系标识
pub fn archive_flavor(path: &Path) -> Option<&'static str> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let ext = normalize_ext(path);
    Some(match ext.as_str() {
        "zip" => "zip",
        "tar" => "tar",
        "tgz" | "tar.gz" if name.ends_with(".tar.gz") || ext == "tgz" => "tar.gz",
        "tbz" | "tbz2" if name.ends_with(".tar.bz2") || matches!(ext.as_str(), "tbz" | "tbz2") => "tar.bz2",
        "txz" if name.ends_with(".tar.xz") || ext == "txz" => "tar.xz",
        "tzst" if name.ends_with(".tar.zst") || ext == "tzst" => "tar.zst",
        "gz" if name.ends_with(".tar.gz") => "tar.gz",
        "bz2" if name.ends_with(".tar.bz2") => "tar.bz2",
        "xz" if name.ends_with(".tar.xz") => "tar.xz",
        "zst" if name.ends_with(".tar.zst") => "tar.zst",
        "gz" => "gz",
        "bz2" => "bz2",
        "xz" => "xz",
        "zst" => "zst",
        _ => return None,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedFile {
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub ext: String,
    pub size: u64,
    /// 建议目标格式（图片=可输出格式；音频=空（P2 接入）；压缩包=空（走解压动作））
    pub targets: Vec<String>,
    /// 压缩体系（仅 Archive 有值：zip/tar.gz/...）
    pub flavor: Option<String>,
}

pub fn detect(path: &str) -> DetectedFile {
    let p = Path::new(path);
    let kind = kind_of(p);
    let ext = normalize_ext(p);
    let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let targets: Vec<String> = match kind {
        FileKind::Image => IMAGE_TARGET_EXTS
            .iter()
            .filter(|t| **t != ext && !(ext == "jpeg" && **t == "jpg") && !(ext == "tif" && **t == "tiff"))
            .map(|t| t.to_string())
            .collect(),
        // symphonia 无 opus/wma 解码器 → 识别为音频但 targets 置空（UI 提示暂不支持）
        FileKind::Audio if ext == "wma" || ext == "opus" => Vec::new(),
        FileKind::Audio => AUDIO_TARGET_EXTS
            .iter()
            .filter(|t| **t != ext)
            .map(|t| t.to_string())
            .collect(),
        _ => Vec::new(),
    };
    let flavor = if kind == FileKind::Archive {
        archive_flavor(p).map(|s| s.to_string())
    } else {
        None
    };
    DetectedFile {
        path: path.to_string(),
        name: p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_string(),
        kind,
        ext,
        size,
        targets,
        flavor,
    }
}

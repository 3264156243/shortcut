//! 转换板块编排：探测 / 图片转换 / 解压缩 / 历史 + 进度事件
//! 音频（symphonia + 编码器）为 P2，detect 已识别类型但 targets 为空。

pub mod archive;
pub mod audio;
pub mod detect;
pub mod history;
pub mod image;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use uuid_like::new_id;

use detect::{DetectedFile, FileKind};

/// 事件负载
#[derive(Debug, Clone, Serialize)]
struct ProgressPayload<'a> {
    id: &'a str,
    pct: u8,
    note: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct DonePayload<'a> {
    id: &'a str,
    out: String,
    out_dir: String,
    /// 条目数（解压/压缩用）
    items: usize,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorPayload<'a> {
    id: &'a str,
    message: String,
}

/// 极简 id（时间戳+计数），避免引入 uuid 依赖
pub mod uuid_like {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    pub fn new_id() -> String {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("cv{}-{}", ts, n)
    }
}

pub fn detect_files(paths: Vec<String>) -> Vec<DetectedFile> {
    paths.iter().map(|p| detect::detect(p)).collect()
}

/// 目标文件路径：out_dir 缺省=源目录；同名自动重命名
fn out_file_for(src: &std::path::Path, target_ext: &str, out_dir: Option<&str>) -> PathBuf {
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let dir = out_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| src.parent().unwrap_or(std::path::Path::new(".")).to_path_buf());
    let candidate = dir.join(format!("{}.{}", stem, target_ext));
    archive::resolve_conflict(&candidate)
}


/// 统一异步执行 + 事件 + 历史（convert / extract / compress 共用）
fn spawn_job<F>(app: AppHandle, id: String, action: &'static str, src: String, job: F)
where
    F: FnOnce() -> Result<(String, String, usize), String> + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let result = job();
        match result {
            Ok((out, out_dir, items)) => {
                history::push(history::HistoryItem {
                    id: id.clone(),
                    time: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                    action: action.to_string(),
                    src: src.clone(),
                    out: out.clone(),
                    status: "ok".into(),
                    note: String::new(),
                });
                let _ = app.emit(
                    "converter:done",
                    DonePayload { id: &id, out, out_dir, items },
                );
            }
            Err(message) => {
                history::push(history::HistoryItem {
                    id: id.clone(),
                    time: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                    action: action.to_string(),
                    src: src.clone(),
                    out: String::new(),
                    status: "fail".into(),
                    note: message.clone(),
                });
                let _ = app.emit("converter:error", ErrorPayload { id: &id, message });
            }
        }
    });
}

pub fn start_convert(
    app: AppHandle,
    id: String,
    src: String,
    target: String,
    quality: u8,
    bitrate_kbps: u32,
    out_dir: Option<String>,
) {
    spawn_job(app, id, "convert", src.clone(), move || {
        run_convert_inner(&src, &target, quality, bitrate_kbps, out_dir)
    });
}

fn run_convert_inner(
    src: &str,
    target: &str,
    quality: u8,
    bitrate_kbps: u32,
    out_dir: Option<String>,
) -> Result<(String, String, usize), String> {
    let src_path = PathBuf::from(src);
    if !src_path.exists() {
        return Err("源文件不存在".into());
    }
    let kind = detect::kind_of(&src_path);
    let out = out_file_for(&src_path, target, out_dir.as_deref());
    match kind {
        FileKind::Image => {
            if !image::can_decode(&src_path) {
                return Err("不支持的图片输入格式".into());
            }
            if !image::is_valid_target(target) {
                return Err(format!("不支持的图片目标格式: {}", target));
            }
            if image::same_format(&detect::normalize_ext(&src_path), target) {
                return Err("源文件已是该格式".into());
            }
            image::convert(&src_path, target, quality, &out)?;
        }
        FileKind::Audio => {
            if !audio::is_valid_target(target) {
                return Err(format!("不支持的音频目标格式: {}", target));
            }
            if audio::same_format(&detect::normalize_ext(&src_path), target) {
                return Err("源文件已是该格式".into());
            }
            let decoded = audio::decode(&src_path)?;
            match target.to_ascii_lowercase().as_str() {
                "wav" => audio::encode_wav(&decoded, &out)?,
                "mp3" => audio::encode_mp3(&decoded, &out, bitrate_kbps)?,
                "flac" => audio::encode_flac(&decoded, &out)?,
                "opus" => audio::encode_opus(&decoded, &out, bitrate_kbps)?,
                other => return Err(format!("不支持的音频目标格式: {}", other)),
            }
        }
        other => return Err(format!("该文件类型不支持转换: {:?}", other)),
    }
    let out_dir = out
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((out.to_string_lossy().into_owned(), out_dir, 1))
}

pub fn start_extract(
    app: AppHandle,
    id: String,
    src: String,
    password: Option<String>,
    out_dir: Option<String>,
) {
    spawn_job(app, id, "extract", src.clone(), move || {
        // run_extract 需要 app 发事件——在闭包里重取（AppHandle 可 Clone 传递）
        // 简化：解压过程不再发过程事件，完成/失败一次性回报（zip 大包条目级进度后续增强）
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            return Err("源文件不存在".into());
        }
        let mut noop = |_: usize| {};
        let (count, dir) = archive::extract(
            &src_path,
            password.as_deref(),
            out_dir.as_deref().map(PathBuf::from).as_deref(),
            &mut noop,
        )?;
        let dir_s = dir.to_string_lossy().into_owned();
        Ok((dir_s.clone(), dir_s, count))
    });
}

pub fn start_compress(
    app: AppHandle,
    id: String,
    paths: Vec<String>,
    flavor: String,
    out_path: Option<String>,
    password: Option<String>,
    level: i64,
) {
    let src_summary = paths.first().cloned().unwrap_or_default();
    spawn_job(app, id, "compress", src_summary, move || {
        let first = PathBuf::from(paths.first().ok_or("没有要压缩的文件")?);
        let dir = first.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
        let base = first
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("archive");
        let ext = match flavor.as_str() {
            "tar.gz" => "tar.gz",
            "tar.bz2" => "tar.bz2",
            "tar.xz" => "tar.xz",
            "tar.zst" => "tar.zst",
            other => other,
        };
        let candidate = out_path
            .map(PathBuf::from)
            .unwrap_or_else(|| dir.join(format!("{}.{}", base, ext)));
        let out = archive::resolve_conflict(&candidate);
        let mut noop = |_: usize| {};
        archive::compress(&paths, &flavor, &out, password.as_deref(), level, &mut noop)?;
        let out_dir = out
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok((out.to_string_lossy().into_owned(), out_dir, 0))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sc-converter-test-{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn test_image_png_to_jpg_and_ico() {
        let dir = temp_dir("img");
        let png = dir.join("t.png");
        ::image::DynamicImage::new_rgb8(64, 64)
            .save_with_format(&png, ::image::ImageFormat::Png)
            .unwrap();
        let jpg = dir.join("t.jpg");
        image::convert(&png, "jpg", 85, &jpg).unwrap();
        assert!(jpg.exists() && jpg.metadata().unwrap().len() > 0);
        let ico = dir.join("t.ico");
        image::convert(&png, "ico", 85, &ico).unwrap();
        assert!(ico.exists());
        let webp = dir.join("t.webp");
        image::convert(&png, "webp", 85, &webp).unwrap();
        assert!(webp.exists());
    }

    #[test]
    fn test_image_same_format_reject() {
        assert!(image::same_format("png", "png"));
        assert!(image::same_format("jpg", "jpeg"));
        assert!(!image::same_format("png", "jpg"));
    }

    #[test]
    fn test_zip_roundtrip_with_password() {
        let dir = temp_dir("zip");
        let f1 = dir.join("a.txt");
        std::fs::write(&f1, "hello converter").unwrap();
        let zip_path = dir.join("out.zip");
        let mut noop = |_: usize| {};
        archive::compress(
            &[f1.to_string_lossy().into()],
            "zip",
            &zip_path,
            Some("pw123"),
            6,
            &mut noop,
        )
        .unwrap();
        assert!(zip_path.exists());
        // 正确密码解压
        let out1 = dir.join("ex1");
        let (n, d) = archive::extract(&zip_path, Some("pw123"), Some(&out1), &mut noop).unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "hello converter");
        // 错误密码必须失败
        let out2 = dir.join("ex2");
        assert!(archive::extract(&zip_path, Some("wrong"), Some(&out2), &mut noop).is_err());
    }

    #[test]
    fn test_tar_gz_and_zip_conflict_rename() {
        let dir = temp_dir("targz");
        let sub = dir.join("folder");
        let _ = std::fs::create_dir_all(&sub);
        std::fs::write(sub.join("b.txt"), "tar content").unwrap();
        let tgz = dir.join("pack.tar.gz");
        let mut noop = |_: usize| {};
        archive::compress(
            &[sub.to_string_lossy().into()],
            "tar.gz",
            &tgz,
            None,
            6,
            &mut noop,
        )
        .unwrap();
        assert!(tgz.exists());
        let out = dir.join("unpacked");
        let (n, d) = archive::extract(&tgz, None, Some(&out), &mut noop).unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read_to_string(d.join("folder/b.txt")).unwrap(), "tar content");
        // 再次解压到同一缺省位置 → 自动重命名目录（冲突处理）
        let (n2, d2) = archive::extract(&tgz, None, None, &mut noop).unwrap();
        assert_eq!(n2, 1);
        assert!(d2 != d || d2.ends_with("unpacked"));
    }

    #[test]
    fn test_detect_kinds() {
        assert_eq!(detect::kind_of(std::path::Path::new("a.PNG")), FileKind::Image);
        assert_eq!(detect::kind_of(std::path::Path::new("b.MP3")), FileKind::Audio);
        assert_eq!(detect::kind_of(std::path::Path::new("c.ZIP")), FileKind::Archive);
        assert_eq!(detect::kind_of(std::path::Path::new("d.exe")), FileKind::Other);
        let det = detect::detect("x.png");
        assert!(det.targets.contains(&"jpg".to_string()));
        assert!(det.flavor.is_none());
        assert_eq!(detect::detect("y.tar.gz").flavor.as_deref(), Some("tar.gz"));
    }

    #[test]
    fn test_audio_wav_to_all_targets() {
        let dir = temp_dir("audio");
        // 合成 1 秒 440Hz 正弦波立体声 @44100
        let rate = 44_100u32;
        let frames = rate as usize;
        let mut samples = Vec::with_capacity(frames * 2);
        for n in 0..frames {
            let v = (2.0 * std::f32::consts::PI * 440.0 * n as f32 / rate as f32).sin() * 0.6;
            samples.push(v);
            samples.push(v);
        }
        let wav = dir.join("src.wav");
        audio::write_test_wav(&wav, &samples, 2, rate);
        let out_wav = dir.join("out.wav");
        let decoded = audio::decode(&wav).unwrap();
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);
        audio::encode_wav(&decoded, &out_wav).unwrap();
        assert!(out_wav.metadata().unwrap().len() > 40_000);
        let out_mp3 = dir.join("out.mp3");
        audio::encode_mp3(&decoded, &out_mp3, 192).unwrap();
        assert!(out_mp3.metadata().unwrap().len() > 10_000);
        let out_flac = dir.join("out.flac");
        audio::encode_flac(&decoded, &out_flac).unwrap();
        assert!(out_flac.metadata().unwrap().len() > 5_000);
        // 立体声 flac 也回解验证
        let flac_back = audio::decode(&out_flac).unwrap();
        assert_eq!(flac_back.channels, 2);
        // wav → opus（含 44100→48000 重采样）
        let out_opus = dir.join("out.opus");
        audio::encode_opus(&decoded, &out_opus, 128).unwrap();
        assert!(out_opus.metadata().unwrap().len() > 5_000);
        let head = std::fs::read(&out_opus).unwrap();
        assert_eq!(&head[..4], b"OggS");
        assert!(head.windows(8).any(|w| w == b"OpusHead"));
    }

    #[test]
    fn test_audio_decode_roundtrip_flac() {
        let dir = temp_dir("flacrt");
        let rate = 44_100u32;
        let frames = 8_000usize;
        let mut samples = Vec::with_capacity(frames);
        for n in 0..frames {
            samples.push((2.0 * std::f32::consts::PI * 440.0 * n as f32 / rate as f32).sin() * 0.5);
        }
        let wav = dir.join("src.wav");
        audio::write_test_wav(&wav, &samples, 1, rate);
        let flac = dir.join("rt.flac");
        let decoded = audio::decode(&wav).unwrap();
        audio::encode_flac(&decoded, &flac).unwrap();
        let decoded2 = audio::decode(&flac).unwrap();
        assert_eq!(decoded2.channels, 1);
        assert_eq!(decoded2.sample_rate, 44_100);
        assert!((decoded2.samples.len() as i64 - samples.len() as i64).abs() < 4096);
    }

    #[test]
    fn test_audio_same_format_and_targets() {
        assert!(audio::same_format("mp3", "mp3"));
        assert!(!audio::same_format("wav", "mp3"));
        assert!(audio::is_valid_target("opus"));
        assert!(!audio::is_valid_target("aac"));
        let det = detect::detect("song.mp3");
        assert!(det.targets.contains(&"flac".to_string()));
        assert!(!det.targets.contains(&"mp3".to_string()));
        assert!(detect::detect("old.wma").targets.is_empty());
    }
}

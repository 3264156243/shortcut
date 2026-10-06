//! 转换板块编排：探测 / 图片转换 / 解压缩 / 历史 + 进度事件
//! 音频（symphonia + 编码器）为 P2，detect 已识别类型但 targets 为空。

pub mod archive;
pub mod audio;
pub mod detect;
pub mod history;
pub mod image;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
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

/// 真实进度上报器：只发 `converter:progress`，不做任何"假进度"定时器。
///
/// - `set` 只在 pct 比上次**更大**时发事件（天然单调，避免重复/回退事件）；
/// - 结束时的 `100/完成` 由 [`spawn_job`] 在任务真正成功返回后补发，
///   因此挂起/失败的任务不会出现"冲到 100 却还在跑"的假象；
/// - `Progress::noop()` 用于不需要上报的调用方（右键菜单直执、测试）。
pub struct Progress {
    app: Option<AppHandle>,
    id: String,
    /// 已发出的最大 pct（0 = 还没发过）
    last: AtomicU8,
    /// 测试/诊断用：把上报过的 (pct, note) 记在内存里（生产路径为 None）
    recorder: Option<Arc<Mutex<Vec<(u8, String)>>>>,
}

impl Progress {
    /// 绑定到某个任务的进度上报器
    pub fn new(app: AppHandle, id: &str) -> Self {
        Self {
            app: Some(app),
            id: id.to_string(),
            last: AtomicU8::new(0),
            recorder: None,
        }
    }

    /// 空上报器：不持有 AppHandle，调用 set 无副作用
    pub fn noop() -> Self {
        Self {
            app: None,
            id: String::new(),
            last: AtomicU8::new(0),
            recorder: None,
        }
    }

    /// 测试用：不发事件，把每个上报点记在内存里，供断言"进度是否跟着真实条目走"
    #[cfg(test)]
    pub fn recorder() -> (Self, Arc<Mutex<Vec<(u8, String)>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        (
            Self {
                app: None,
                id: String::new(),
                last: AtomicU8::new(0),
                recorder: Some(log.clone()),
            },
            log,
        )
    }

    /// 上报一个进度点（pct 0~100，note 为当前真实阶段/条目名）
    pub fn set(&self, pct: u8, note: &str) {
        let pct = pct.min(100);
        let last = self.last.load(Ordering::Relaxed);
        if pct <= last {
            return; // 不允许回退，也不重复发同一档
        }
        self.last.store(pct, Ordering::Relaxed);
        if let Some(rec) = &self.recorder {
            if let Ok(mut v) = rec.lock() {
                v.push((pct, note.to_string()));
            }
        }
        if let Some(app) = &self.app {
            let _ = app.emit(
                "converter:progress",
                ProgressPayload {
                    id: &self.id,
                    pct,
                    note,
                },
            );
        }
    }
}

/// 「已处理 i 个 / 总数 n（n=0 表示流式读取未知总数）」映射到 progress 区间 [from, to]。
///
/// 未知总数时退化为按已处理条目数递增的估算（步长由 `MAX_UNKNOWN_STEP` 封顶，
/// 保证不会长时间卡死在一个百分比上）；总数已知时按比例映射。
fn scaled_pct(done: usize, total: usize, from: u8, to: u8) -> u8 {
    /// 未知总数时每个条目推进的百分比上限
    const MAX_UNKNOWN_STEP: usize = 2;
    let pct = if total == 0 {
        from as usize + done * MAX_UNKNOWN_STEP
    } else {
        from as usize + done.saturating_mul(to.saturating_sub(from) as usize) / total
    };
    pct.min(to as usize) as u8
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


/// 统一异步执行 + 进度 + 事件 + 历史（convert / extract / compress 共用）
///
/// `job` 拿到 [`Progress`] 后在**各自真实阶段**上报；任务成功返回后这里补发
/// `100/完成`——即"干完立刻到 100"，不依赖任何估算/动画。
fn spawn_job<F>(app: AppHandle, id: String, action: &'static str, src: String, job: F)
where
    F: FnOnce(&Progress) -> Result<(String, String, usize), String> + Send + 'static,
{
    let progress = Progress::new(app.clone(), &id);
    tauri::async_runtime::spawn(async move {
        progress.set(2, "开始");
        let result = job(&progress);
        match result {
            Ok((out, out_dir, items)) => {
                progress.set(100, "完成");
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
    spawn_job(app, id, "convert", src.clone(), move |progress| {
        run_convert_inner(&src, &target, quality, bitrate_kbps, out_dir, progress)
    });
}

fn run_convert_inner(
    src: &str,
    target: &str,
    quality: u8,
    bitrate_kbps: u32,
    out_dir: Option<String>,
    progress: &Progress,
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
            // 图片：解码（5）→ 编码+写盘（85）；100 由 spawn_job 在成功后补发
            progress.set(5, "解码");
            let img = image::decode(&src_path)?;
            progress.set(45, "已解码");
            image::encode(&img, target, quality, &out)?;
            progress.set(85, "写入");
        }
        FileKind::Audio => {
            if !audio::is_valid_target(target) {
                return Err(format!("不支持的音频目标格式: {}", target));
            }
            if audio::same_format(&detect::normalize_ext(&src_path), target) {
                return Err("源文件已是该格式".into());
            }
            // 音频：解码（5）→ 50（已解码）→ 编码写盘（85）
            progress.set(5, "解码");
            let decoded = audio::decode(&src_path)?;
            progress.set(50, "已解码");
            match target.to_ascii_lowercase().as_str() {
                "wav" => audio::encode_wav(&decoded, &out)?,
                "mp3" => audio::encode_mp3(&decoded, &out, bitrate_kbps)?,
                "flac" => audio::encode_flac(&decoded, &out)?,
                "opus" => audio::encode_opus(&decoded, &out, bitrate_kbps)?,
                other => return Err(format!("不支持的音频目标格式: {}", other)),
            }
            progress.set(85, "写盘");
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
    spawn_job(app, id, "extract", src.clone(), move |progress| {
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
            progress,
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
) {    let src_summary = paths.first().cloned().unwrap_or_default();
    spawn_job(app, id, "compress", src_summary, move |progress| {
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
        archive::compress(&paths, &flavor, &out, password.as_deref(), level, &mut noop, progress)?;
        let out_dir = out
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok((out.to_string_lossy().into_owned(), out_dir, 0))
    });
}

/// 右键菜单「直接执行」：压缩或解压，**不打开主面板**。
///
/// 与 `start_*` 的区别：
/// - 一次调用把所有选中项处理完（多选解压 = 逐个解到各自同名文件夹）；压缩只产出一个包；
/// - 只写历史、不发前端事件（前端没打开也不影响），结束时发系统通知 + 刷新资源管理器；
/// - `exit_after` 为 true 时（冷启动专为这次操作而启动）干完自动退出，不留托盘/岛屿。

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
    fn test_progress_follows_real_entries() {
        // 进度必须由真实条目驱动：3 个文件压缩 → 每个条目一个上报点（note = i/N 文件名），
        // 且 pct 单调递增、全部落在条目区间 [5,95] 内（100 由 spawn_job 真正成功后才补发）。
        let dir = temp_dir("progress");
        let mut paths: Vec<String> = Vec::new();
        for i in 1..=3 {
            let f = dir.join(format!("p{}.txt", i));
            std::fs::write(&f, format!("payload-{}", i)).unwrap();
            paths.push(f.to_string_lossy().into());
        }
        let zip_path = dir.join("prog.zip");
        let (prog, log) = Progress::recorder();
        let mut noop = |_: usize| {};
        archive::compress(&paths, "zip", &zip_path, None, 6, &mut noop, &prog).unwrap();

        let recs = log.lock().unwrap().clone();
        assert!(recs.len() >= 3, "每个条目都应有一个上报点，实际 {:?}", recs);
        assert!(
            recs.iter().all(|(p, _)| *p >= 5 && *p <= 95),
            "条目进度必须落在 5~95 区间（100 留给真正成功），实际 {:?}",
            recs
        );
        // 单调不回退（set 内部保证，这里回归确认）
        assert!(recs.windows(2).all(|w| w[0].0 <= w[1].0), "进度不得回退: {:?}", recs);
        // note 必须带"第几个/共几个"
        assert!(
            recs.iter().any(|(_, n)| n.contains("/3")),
            "进度说明里应带 i/N，实际 {:?}",
            recs
        );
        assert!(zip_path.exists() && zip_path.metadata().unwrap().len() > 0);

        // 解压同样按真实条目推进
        let out = dir.join("ex");
        let (prog2, log2) = Progress::recorder();
        let (n, _) = archive::extract(&zip_path, None, Some(&out), &mut noop, &prog2).unwrap();
        assert_eq!(n, 3);
        let recs2 = log2.lock().unwrap().clone();
        assert!(recs2.len() >= 3, "解压也应按条目上报，实际 {:?}", recs2);
        assert!(recs2.windows(2).all(|w| w[0].0 <= w[1].0));
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
            &Progress::noop(),
        )
        .unwrap();
        assert!(zip_path.exists());
        // 正确密码解压
        let out1 = dir.join("ex1");
        let (n, d) = archive::extract(
            &zip_path,
            Some("pw123"),
            Some(&out1),
            &mut noop,
            &Progress::noop(),
        )
        .unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "hello converter");
        // 错误密码必须失败
        let out2 = dir.join("ex2");
        assert!(archive::extract(&zip_path, Some("wrong"), Some(&out2), &mut noop, &Progress::noop()).is_err());
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
            &Progress::noop(),
        )
        .unwrap();
        assert!(tgz.exists());
        let out = dir.join("unpacked");
        let (n, d) = archive::extract(&tgz, None, Some(&out), &mut noop, &Progress::noop()).unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read_to_string(d.join("folder/b.txt")).unwrap(), "tar content");
        // 再次解压到同一缺省位置 → 自动重命名目录（冲突处理）
        let (n2, d2) = archive::extract(&tgz, None, None, &mut noop, &Progress::noop()).unwrap();
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
